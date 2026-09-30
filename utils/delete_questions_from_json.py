#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path


def load_question_ids(json_path: Path) -> list[str]:
    with json_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Supports your current AfterBoards format:
    # [
    #   {"id": "...", ...},
    #   ...
    # ]
    #
    # Also supports:
    # {"questions": [{...}, {...}]}

    if isinstance(data, list):
        records = data
    elif isinstance(data, dict) and isinstance(data.get("questions"), list):
        records = data["questions"]
    else:
        raise ValueError(
            "Input JSON must be either a top-level array of question objects "
            "or an object containing a 'questions' array."
        )

    ids = []
    seen = set()

    for i, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise ValueError(f"Record #{i} is not a JSON object.")

        qid = record.get("id")

        if not isinstance(qid, str) or not qid.strip():
            raise ValueError(f"Record #{i} is missing a valid 'id'.")

        qid = qid.strip()

        if qid in seen:
            raise ValueError(f"Duplicate question id in JSON: {qid}")

        seen.add(qid)
        ids.append(qid)

    if not ids:
        raise ValueError("No question IDs found in the input JSON.")

    return ids


def count_related(conn: sqlite3.Connection, ids: list[str]) -> dict[str, int]:
    placeholders = ",".join("?" for _ in ids)
    params = tuple(ids)

    tables = {
        "questions": "SELECT COUNT(*) FROM questions WHERE id IN ({})",
        "question_fts": "SELECT COUNT(*) FROM question_fts WHERE question_id IN ({})",
        "question_tags": "SELECT COUNT(*) FROM question_tags WHERE question_id IN ({})",
        "question_topics": "SELECT COUNT(*) FROM question_topics WHERE question_id IN ({})",
        "question_collections": "SELECT COUNT(*) FROM question_collections WHERE question_id IN ({})",
        "group_children": "SELECT COUNT(*) FROM group_children WHERE question_id IN ({})",
    }

    return {
        name: int(conn.execute(sql.format(placeholders), params).fetchone()[0])
        for name, sql in tables.items()
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Delete questions from SQLite using IDs from an input JSON file."
    )

    parser.add_argument(
        "--json",
        required=True,
        help="JSON file containing the question IDs to delete.",
    )

    parser.add_argument(
        "--db",
        required=True,
        help="Path to question_bank.db.",
    )

    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually perform the deletion. Without this flag, only a dry run is performed.",
    )

    parser.add_argument(
        "--backup",
        action="store_true",
        help="Create a .bak copy of the database before deletion.",
    )

    args = parser.parse_args()

    json_path = Path(args.json).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()

    ids = load_question_ids(json_path)

    if not db_path.is_file():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        counts_before = count_related(conn, ids)

        placeholders = ",".join("?" for _ in ids)

        existing_rows = conn.execute(
            f"""
            SELECT id
            FROM questions
            WHERE id IN ({placeholders})
            """,
            tuple(ids),
        ).fetchall()

        existing_ids = {row["id"] for row in existing_rows}
        missing_ids = [qid for qid in ids if qid not in existing_ids]

        print("=" * 72)
        print("QUESTION DELETION CHECK")
        print("=" * 72)
        print(f"Input JSON          : {json_path}")
        print(f"SQLite database     : {db_path}")
        print(f"IDs in JSON         : {len(ids)}")
        print(f"Questions found     : {counts_before['questions']}")
        print(f"Questions not found : {len(missing_ids)}")
        print()

        print("Matching rows currently present:")
        for name in (
            "questions",
            "question_fts",
            "question_tags",
            "question_topics",
            "question_collections",
            "group_children",
        ):
            print(f"  {name:22s}: {counts_before[name]}")

        if missing_ids:
            print("\nQuestion IDs not present in DB:")
            for qid in missing_ids:
                print(f"  {qid}")

        if not args.execute:
            print("\nDRY RUN — no database changes were made.")
            return 0

        if counts_before["questions"] == 0:
            print("\nNothing to delete.")
            return 0

        if args.backup:
            backup_path = db_path.with_suffix(db_path.suffix + ".bak")
            shutil.copy2(db_path, backup_path)
            print(f"\nBackup created: {backup_path}")

        conn.execute("BEGIN")

        # question_fts has no foreign-key cascade, so remove these explicitly.
        conn.execute(
            f"""
            DELETE FROM question_fts
            WHERE question_id IN ({placeholders})
            """,
            tuple(ids),
        )

        # These dependent tables cascade automatically when the question row
        # is deleted:
        #   question_tags
        #   question_topics
        #   question_collections
        #   group_children
        deleted = conn.execute(
            f"""
            DELETE FROM questions
            WHERE id IN ({placeholders})
            """,
            tuple(ids),
        )

        conn.commit()

        counts_after = count_related(conn, ids)

        print()
        print("=" * 72)
        print("DELETION COMPLETE")
        print("=" * 72)
        print(f"Questions deleted : {deleted.rowcount}")

        print("\nRemaining matching rows:")
        for name in (
            "questions",
            "question_fts",
            "question_tags",
            "question_topics",
            "question_collections",
            "group_children",
        ):
            print(f"  {name:22s}: {counts_after[name]}")

        if any(counts_after.values()):
            print("\nWARNING: Some matching rows still remain.")
            return 2

        print("\nExisting unrelated questions and catalog tables were not modified.")
        return 0

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)