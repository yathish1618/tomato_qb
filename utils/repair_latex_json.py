#!/usr/bin/env python3
"""
Repair known LaTeX corruption in raw question.json / group.json files.

IMPORTANT:
- This works on RAW JSON TEXT, before json.load()/JSON parsing.
- Default mode is DRY RUN. Use --apply to actually modify files.
- Only narrowly targeted LaTeX corruption patterns are changed.
- Existing correct \\frac / \\beta / \\alpha etc. are NOT changed.

Project structure expected:
    project/
      data/
        questions/<UUID>/question.json
        groups/<UUID>/group.json

Examples:
    # Dry-run entire project
    python repair_latex_json.py /path/to/project

    # Apply to entire project
    python repair_latex_json.py /path/to/project --apply

    # Apply only to specific UUIDs
    python repair_latex_json.py /path/to/project --apply \
        --uuids UUID1 UUID2

    # Read UUIDs from a text/CSV file (one UUID per line; header is ignored)
    python repair_latex_json.py /path/to/project --apply \
        --uuid-file uuids.txt
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


# ----------------------------------------------------------------------
# 1. JSON-valid escape sequences that can silently corrupt LaTeX.
#
# Example raw JSON:
#     "$\frac12$"
#
# Because \\f is a valid JSON escape, JSON parsing turns it into
# form-feed + "rac12". The raw JSON should instead contain:
#     "$\\frac12$"
#
# These replacements ONLY target known LaTeX commands whose initial
# character collides with a JSON escape.
# ----------------------------------------------------------------------

SINGLE_BACKSLASH_COMMANDS = [
    "begin",
    "beta",
    "binom",
    "frac",
    "forall",
    "rho",
    "right",
    "text",
    "theta",
    "times",
]

# Match exactly one backslash before a known command.
# The negative lookbehind prevents changing an already-correct \\command.
SINGLE_BACKSLASH_PATTERNS = [
    (
        re.compile(r"(?<!\\)\\(" + "|".join(map(re.escape, SINGLE_BACKSLASH_COMMANDS)) + r")"),
        lambda m: "\\\\" + m.group(1),
        "single-backslash-LaTeX-command",
    ),
]


# ----------------------------------------------------------------------
# 2. Known control-character corruption.
#
# These are cases where an upstream process has already interpreted a
# Python/escape sequence such as \\a or \\b before JSON was written.
#
# Example:
#     \\alpha  ->  \\u0007lpha
#     \\beta   ->  \\u0008eta
#
# The keys below are literal text as it appears in raw JSON files.
# ----------------------------------------------------------------------

CONTROL_CHAR_REPAIRS = {
    r"\u0007lpha": r"\\alpha",
    r"\u0007ngle": r"\\angle",
    r"\u0007rg": r"\\arg",
    r"\u0008eta": r"\\beta",
    r"\u0008inom": r"\\binom",
    r"\u000Baranothing": r"\\varanothing",  # placeholder guard; see exact entry below
    r"\u000Barnothing": r"\\varnothing",
    r"\u000C rac": r"\\frac",               # unlikely variant; kept harmless
    r"\u000Crac": r"\\frac",
    r"\u000Dight": r"\\right",
    r"\u000Dho": r"\\rho",
    r"\u0009ext": r"\\text",
    r"\u0009heta": r"\\theta",
    r"\u0009imes": r"\\times",
}

# Remove the intentionally defensive placeholder above.
CONTROL_CHAR_REPAIRS.pop(r"\u000Baranothing", None)


def load_uuid_filter(args: argparse.Namespace) -> set[str] | None:
    uuids: set[str] = set()

    if args.uuids:
        uuids.update(u.strip() for u in args.uuids if u.strip())

    if args.uuid_file:
        path = Path(args.uuid_file)
        for raw in path.read_text(encoding="utf-8").splitlines():
            value = raw.strip()
            if not value or value.lower() == "uuid":
                continue
            # Allow simple CSV files with UUID in the first column.
            value = value.split(",", 1)[0].strip().strip('"')
            if value:
                uuids.add(value)

    return uuids or None


def iter_target_files(project_dir: Path):
    for root_name, filename in [
        ("questions", "question.json"),
        ("groups", "group.json"),
    ]:
        base = project_dir / "data" / root_name
        if not base.is_dir():
            continue

        yield from sorted(base.rglob(filename))


def apply_repairs(raw: str):
    repaired = raw
    changes = []

    for pattern, replacement_fn, label in SINGLE_BACKSLASH_PATTERNS:
        repaired, count = pattern.subn(replacement_fn, repaired)
        if count:
            changes.append((label, count))

    for old, new in CONTROL_CHAR_REPAIRS.items():
        count = repaired.count(old)
        if count:
            repaired = repaired.replace(old, new)
            changes.append((f"control-character:{old}->{new}", count))

    return repaired, changes


def write_report(path: Path, rows):
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["uuid", "type", "file", "status", "changes"])
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Repair known LaTeX corruption in question/group JSON files."
    )
    parser.add_argument(
        "project_dir",
        type=Path,
        help="Question-bank project root.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually modify files. Without this flag the script is a dry-run.",
    )
    parser.add_argument(
        "--uuids",
        nargs="+",
        help="Only process these UUIDs.",
    )
    parser.add_argument(
        "--uuid-file",
        help="Text/CSV file containing UUIDs, one per line.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("latex_repair_report.csv"),
        help="CSV report path.",
    )

    args = parser.parse_args()

    project_dir = args.project_dir.resolve()
    uuid_filter = load_uuid_filter(args)

    if not project_dir.is_dir():
        raise SystemExit(f"Project directory not found: {project_dir}")

    report_rows = []
    files_seen = 0
    files_changed = 0
    replacements = 0

    for path in iter_target_files(project_dir):
        uuid = path.parent.name
        record_type = "group" if path.name == "group.json" else "question"

        if uuid_filter is not None and uuid not in uuid_filter:
            continue

        files_seen += 1

        raw = path.read_text(encoding="utf-8")
        repaired, changes = apply_repairs(raw)

        if not changes:
            report_rows.append([
                uuid,
                record_type,
                str(path),
                "UNCHANGED",
                "",
            ])
            continue

        files_changed += 1
        count = sum(n for _, n in changes)
        replacements += count

        report_rows.append([
            uuid,
            record_type,
            str(path),
            "WOULD_CHANGE" if not args.apply else "CHANGED",
            "; ".join(f"{label} x{n}" for label, n in changes),
        ])

        if args.apply:
            path.write_text(repaired, encoding="utf-8")

    write_report(args.report.resolve(), report_rows)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"Mode: {mode}")
    print(f"Files scanned: {files_seen}")
    print(f"Files with repairs: {files_changed}")
    print(f"Replacement occurrences: {replacements}")
    print(f"Report: {args.report.resolve()}")


if __name__ == "__main__":
    main()
