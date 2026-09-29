#!/usr/bin/env python3
"""Export the SQLite database back to the portable JSON-based project layout."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def loads(value, default):
    if value is None or value == "":
        return default
    return json.loads(value)


def dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_db(db_path: Path, output_root: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    data = output_root / "data"
    qdir = data / "questions"
    gdir = data / "groups"
    mappings = data / "mappings"
    qdir.mkdir(parents=True, exist_ok=True)
    gdir.mkdir(parents=True, exist_ok=True)
    mappings.mkdir(parents=True, exist_ok=True)

    collections = []
    for c in conn.execute("SELECT id, name, sort_order FROM collections ORDER BY COALESCE(sort_order, 999999), lower(name), id"):
        sets = [
            {"id": s["id"], "name": s["name"]}
            for s in conn.execute(
                "SELECT id, name FROM sets WHERE collection_id = ? ORDER BY COALESCE(sort_order, 999999), lower(name), id",
                (c["id"],),
            )
        ]
        collections.append({"id": c["id"], "name": c["name"], "sets": sets})
    dump(data / "collections.json", {"collections": collections})

    topics = []
    for t in conn.execute("SELECT id, name, sort_order FROM topics ORDER BY COALESCE(sort_order, 999999), lower(name), id"):
        subs = [
            {"id": s["id"], "name": s["name"]}
            for s in conn.execute(
                "SELECT id, name FROM subtopics WHERE topic_id = ? ORDER BY COALESCE(sort_order, 999999), lower(name), id",
                (t["id"],),
            )
        ]
        topics.append({"id": t["id"], "name": t["name"], "subtopics": subs})
    dump(data / "topics.json", {"topics": topics})

    qtopic = []
    for qid in [r[0] for r in conn.execute("SELECT id FROM questions ORDER BY id")]:
        rows = conn.execute(
            "SELECT topic_id, subtopic_id FROM question_topics WHERE question_id = ? ORDER BY topic_id, subtopic_id",
            (qid,),
        ).fetchall()
        qtopic.append({
            "uuid": qid,
            "mappings": [
                {"topic_id": r["topic_id"], "subtopic_id": r["subtopic_id"]}
                for r in rows
            ],
        })
    dump(mappings / "question_topics.json", {"mappings": qtopic})

    qcollection = []
    for qid in [r[0] for r in conn.execute("SELECT id FROM questions ORDER BY id")]:
        rows = conn.execute(
            "SELECT collection_id, set_id FROM question_collections WHERE question_id = ? ORDER BY collection_id, set_id",
            (qid,),
        ).fetchall()
        qcollection.append({
            "uuid": qid,
            "mappings": [
                {"collection_id": r["collection_id"], "set_id": r["set_id"]}
                for r in rows
            ],
        })
    dump(mappings / "question_collections.json", {"mappings": qcollection})

    for row in conn.execute("SELECT * FROM questions ORDER BY question_number, id"):
        q = {
            "id": row["id"],
            "type": row["type"],
            "content": loads(row["content_json"], []),
            "options": loads(row["options_json"], {}),
            "answer": loads(row["answer_json"], None),
            "solution": loads(row["solution_json"], None),
            "figures": loads(row["figures_json"], []),
            "group_id": row["group_id"],
            "grade": row["grade"],
            "tags": loads(row["tags_json"], []),
            "source": loads(row["source_json"], {}),
            "marks": row["marks"],
            "difficulty": row["difficulty"],
            "review_status": row["review_status"],
            "publication_status": row["publication_status"],
        }
        if row["created_at"] is not None:
            q["created_at"] = row["created_at"]
        if row["updated_at"] is not None:
            q["updated_at"] = row["updated_at"]
        source = q["source"] if isinstance(q["source"], dict) else {}
        if row["question_number"] is not None and "question_number" not in source:
            source["question_number"] = row["question_number"]
            q["source"] = source
        dump(qdir / row["id"] / "question.json", q)

    for row in conn.execute("SELECT * FROM groups ORDER BY id"):
        children = [r[0] for r in conn.execute(
            "SELECT question_id FROM group_children WHERE group_id = ? ORDER BY sort_order",
            (row["id"],),
        )]
        g = {
            "id": row["id"],
            "type": "GROUP",
            "content": loads(row["content_json"], []),
            "children": children,
            "marks": row["marks"],
            "figures": loads(row["figures_json"], []),
            "grade": row["grade"],
            "tags": loads(row["tags_json"], []),
            "source": loads(row["source_json"], {}),
            "review_status": row["review_status"],
            "publication_status": row["publication_status"],
        }
        if row["created_at"] is not None:
            g["created_at"] = row["created_at"]
        if row["updated_at"] is not None:
            g["updated_at"] = row["updated_at"]
        dump(gdir / row["id"] / "group.json", g)

    conn.close()
    print(f"Export complete: {output_root}")


def main():
    parser = argparse.ArgumentParser(description="Export SQLite back to the portable TOMATO JSON layout.")
    parser.add_argument("--db", default="data/question_bank.db")
    parser.add_argument("--output", default="exported_json")
    args = parser.parse_args()
    export_db(Path(args.db).resolve(), Path(args.output).resolve())


if __name__ == "__main__":
    main()
