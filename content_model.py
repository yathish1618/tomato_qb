"""Canonical question content model helpers.

The runtime model stores question/option/solution/group content as ordered blocks:
- paragraph: rich inline text/math
- bullet_list / numbered_list
- table: rows of cells, each cell containing blocks
- figure: external asset reference
- math: standalone/display mathematics
"""
from __future__ import annotations

import re
from typing import Any

MATH_TOKEN_RE = re.compile(
    r"(?P<display>\$\$.*?\$\$|\\\[.*?\\\])|"
    r"(?P<inline>\$[^$\n]+?\$|\\\(.*?\\\))",
    flags=re.DOTALL,
)


def text_to_inlines(text: str) -> list[dict[str, Any]]:
    """Convert legacy mixed text/LaTeX into inline nodes without changing LaTeX."""
    if text is None:
        return []
    text = str(text)
    out: list[dict[str, Any]] = []
    pos = 0
    for m in MATH_TOKEN_RE.finditer(text):
        if m.start() > pos:
            out.append({"type": "text", "text": text[pos:m.start()]})
        raw = m.group(0)
        if m.group("display"):
            if raw.startswith("$$"):
                latex = raw[2:-2]
            else:
                latex = raw[2:-2]
            out.append({"type": "math", "latex": latex, "display": True})
        else:
            if raw.startswith("$"):
                latex = raw[1:-1]
            else:
                latex = raw[2:-2]
            out.append({"type": "math", "latex": latex, "display": False})
        pos = m.end()
    if pos < len(text):
        out.append({"type": "text", "text": text[pos:]})
    if not out:
        out.append({"type": "text", "text": text})
    return out


def legacy_text_to_content(text: str | None) -> list[dict[str, Any]]:
    """Wrap legacy question text as a single paragraph block."""
    value = "" if text is None else str(text)
    paragraphs = value.split("\n\n")
    return [
        {"type": "paragraph", "inlines": text_to_inlines(p)}
        for p in paragraphs
    ]


def legacy_option_to_content(value: str | None) -> list[dict[str, Any]]:
    return legacy_text_to_content(value)


def plain_text_from_content(blocks: Any) -> str:
    """Flatten canonical content to a searchable plain-text string."""
    pieces: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        typ = node.get("type")
        if typ == "text":
            pieces.append(str(node.get("text", "")))
        elif typ == "math":
            pieces.append(str(node.get("latex", "")))
        elif typ == "figure":
            pieces.append(str(node.get("alt", "")))
            pieces.append(str(node.get("caption", "")))
        else:
            for key, value in node.items():
                if key in {"type", "id", "marks", "display", "src", "alt"}:
                    continue
                walk(value)

    walk(blocks)
    return " ".join(x.strip() for x in pieces if str(x).strip())


def normalize_content(value: Any) -> list[dict[str, Any]]:
    """Ensure a content value is an array; accept legacy strings for migration."""
    if value is None:
        return []
    if isinstance(value, str):
        return legacy_text_to_content(value)
    if isinstance(value, list):
        return value
    raise ValueError("content must be an array of blocks")
