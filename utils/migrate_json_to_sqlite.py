#!/usr/bin/env python3
r"""Migrate/import Tomato QB JSON question data into SQLite.

Modes
-----
1. Legacy/full migration mode (existing behavior):
     python utils/migrate_json_to_sqlite.py --project . --db data/question_bank.db --reset

2. Additive question-import mode (safe for importing a new scraped JSON file):
     python utils/migrate_json_to_sqlite.py \
         --append-json sample.json \
         --db data/question_bank.db

Additive mode is deliberately conservative:
- The existing database file is NEVER deleted.
- Existing question rows are NEVER overwritten.
- Existing tags, relationships, and FTS rows are NEVER deleted.
- Questions whose UUID already exists are skipped.
- Only genuinely new questions are inserted.
- Only question_tags and question_fts rows for newly inserted questions are added.
- Collections/topics/sets/subtopics are NOT modified. They can be mapped later.
- The operation is transactional: on any error, the entire additive import rolls back.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from content_model import legacy_text_to_content


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def question_number(source):
    value = (source or {}).get("question_number")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def source_content(value):
    if value is None:
        return None
    return legacy_text_to_content(str(value))


def plain_search_text(content, options, solution, tags, source):
    def flatten(x):
        if isinstance(x, str):
            return x
        if isinstance(x, list):
            return " ".join(flatten(v) for v in x)
        if isinstance(x, dict):
            return " ".join(
                flatten(v)
                for k, v in x.items()
                if k not in {"id", "type"}
            )
        return str(x) if x is not None else ""

    return " ".join(
        p
        for p in [
            flatten(content),
            flatten(options),
            flatten(solution),
            flatten(tags),
            flatten(source),
        ]
        if p
    )


# ---------------------------------------------------------------------------
# Lightweight validation matching the project's question/content schemas.
# This avoids adding a runtime dependency on jsonschema to the project.
# ---------------------------------------------------------------------------


def validate_uuid(value, field_name, q_index):
    if not isinstance(value, str):
        raise ValueError(
            f"Question {q_index}: '{field_name}' must be a UUID string."
        )
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise ValueError(
            f"Question {q_index}: '{field_name}' is not a valid UUID: {value!r}"
        ) from exc


def validate_inline(inline, where):
    if not isinstance(inline, dict):
        raise ValueError(f"{where}: inline must be an object")

    kind = inline.get("type")
    if kind == "text":
        if not isinstance(inline.get("text"), str):
            raise ValueError(f"{where}: text inline requires string 'text'")
        allowed = {"type", "text", "marks"}
        if set(inline) - allowed:
            raise ValueError(
                f"{where}: unexpected text-inline fields: {sorted(set(inline)-allowed)}"
            )
    elif kind == "math":
        if not isinstance(inline.get("latex"), str):
            raise ValueError(f"{where}: math inline requires string 'latex'")
        if "display" in inline and not isinstance(inline["display"], bool):
            raise ValueError(f"{where}: math 'display' must be boolean")
    else:
        raise ValueError(f"{where}: unsupported inline type {kind!r}")


def validate_blocks(blocks, where="content"):
    if not isinstance(blocks, list):
        raise ValueError(f"{where}: must be an array")

    for i, block in enumerate(blocks):
        p = f"{where}[{i}]"
        if not isinstance(block, dict):
            raise ValueError(f"{p}: block must be an object")

        kind = block.get("type")

        if kind == "paragraph":
            if not isinstance(block.get("inlines"), list):
                raise ValueError(f"{p}: paragraph requires array 'inlines'")
            for j, inline in enumerate(block["inlines"]):
                validate_inline(inline, f"{p}.inlines[{j}]")

        elif kind in {"bullet_list", "numbered_list"}:
            items = block.get("items")
            if not isinstance(items, list):
                raise ValueError(f"{p}: list requires array 'items'")
            for j, item in enumerate(items):
                ip = f"{p}.items[{j}]"
                if not isinstance(item, dict) or not isinstance(item.get("inlines"), list):
                    raise ValueError(f"{ip}: list item requires array 'inlines'")
                for k, inline in enumerate(item["inlines"]):
                    validate_inline(inline, f"{ip}.inlines[{k}]")

        elif kind == "table":
            rows = block.get("rows")
            if not isinstance(rows, list):
                raise ValueError(f"{p}: table requires array 'rows'")
            if "header_rows" in block and (
                not isinstance(block["header_rows"], int)
                or block["header_rows"] < 0
            ):
                raise ValueError(f"{p}: 'header_rows' must be a non-negative integer")
            for j, row in enumerate(rows):
                rp = f"{p}.rows[{j}]"
                if not isinstance(row, dict) or not isinstance(row.get("cells"), list):
                    raise ValueError(f"{rp}: row requires array 'cells'")
                for k, cell in enumerate(row["cells"]):
                    cp = f"{rp}.cells[{k}]"
                    if not isinstance(cell, dict) or not isinstance(cell.get("content"), list):
                        raise ValueError(f"{cp}: cell requires array 'content'")
                    validate_blocks(cell["content"], f"{cp}.content")

        elif kind == "figure":
            if not isinstance(block.get("src"), str):
                raise ValueError(f"{p}: figure requires string 'src'")
            for key in ("alt", "caption"):
                if key in block and not isinstance(block[key], str):
                    raise ValueError(f"{p}: figure '{key}' must be a string")

        elif kind == "math":
            if not isinstance(block.get("latex"), str):
                raise ValueError(f"{p}: math block requires string 'latex'")
            if block.get("display") is not True:
                raise ValueError(f"{p}: top-level math block requires display=true")

        else:
            raise ValueError(f"{p}: unsupported block type {kind!r}")


def validate_append_question(q, q_index):
    if not isinstance(q, dict):
        raise ValueError(f"Question {q_index}: record must be an object")

    required = {
        "id",
        "type",
        "content",
        "answer",
        "marks",
        "group_id",
        "source",
        "review_status",
        "publication_status",
    }
    missing = sorted(required - set(q))
    if missing:
        raise ValueError(
            f"Question {q_index}: missing required fields: {', '.join(missing)}"
        )

    validate_uuid(q["id"], "id", q_index)

    if q["type"] not in {"MCQ", "SUBJECTIVE"}:
        raise ValueError(f"Question {q_index}: invalid type {q['type']!r}")

    validate_blocks(q["content"])

    if q["type"] == "MCQ":
        options = q.get("options")
        if not isinstance(options, dict) or set(options) != {"A", "B", "C", "D"}:
            raise ValueError(
                f"Question {q_index}: MCQ options must contain exactly A, B, C and D"
            )
        for label in "ABCD":
            validate_blocks(options[label], f"options.{label}")

        answer = q.get("answer")
        if answer is not None and (not isinstance(answer, str) or answer not in {"A", "B", "C", "D"}):
            raise ValueError(
                f"Question {q_index} {q['id']}: MCQ answer must be one of A/B/C/D; got {answer!r}"
            )

    else:
        answer = q.get("answer")
        if answer is not None and not isinstance(answer, (str, list)):
            raise ValueError(f"Question {q_index}: invalid answer type")

    marks = q.get("marks")
    if marks is not None and not isinstance(marks, (int, float)):
        raise ValueError(f"Question {q_index}: marks must be number or null")

    group_id = q.get("group_id")
    if group_id is not None:
        validate_uuid(group_id, "group_id", q_index)

    if not isinstance(q.get("source"), dict):
        raise ValueError(f"Question {q_index}: source must be an object")

    tags = q.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise ValueError(f"Question {q_index}: tags must be an array of strings")


def table_exists(conn, table_name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','virtual table') AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def existing_question_ids(conn, ids):
    if not ids:
        return set()
    found = set()
    # Chunk for SQLite parameter limits.
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        placeholders = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"SELECT id FROM questions WHERE id IN ({placeholders})",
            chunk,
        ).fetchall()
        found.update(row[0] for row in rows)
    return found


def append_json_questions(json_path: Path, db_path: Path):
    if not json_path.is_file():
        raise FileNotFoundError(f"Input JSON file not found: {json_path}")

    if not db_path.is_file():
        raise FileNotFoundError(
            "Additive import requires an existing SQLite database.\n"
            f"Database not found: {db_path}\n"
            "The database will not be created in append mode."
        )

    data = read_json(json_path)
    if not isinstance(data, list):
        raise ValueError(
            f"Additive import expects the JSON file to contain an array of questions: {json_path}"
        )
    if not data:
        raise ValueError(f"Additive import JSON contains zero questions: {json_path}")

    ids_seen = set()
    records = []
    for idx, q in enumerate(data, start=1):
        validate_append_question(q, idx)
        qid = q["id"]
        if qid in ids_seen:
            raise ValueError(
                f"Duplicate question UUID {qid!r} appears more than once in the input JSON"
            )
        ids_seen.add(qid)
        records.append(q)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        required_tables = ["questions", "question_tags", "question_fts"]
        missing_tables = [t for t in required_tables if not table_exists(conn, t)]
        if missing_tables:
            raise RuntimeError(
                "Existing SQLite database is missing required table(s): "
                + ", ".join(missing_tables)
            )

        before = {
            "questions": conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0],
            "question_tags": conn.execute("SELECT COUNT(*) FROM question_tags").fetchone()[0],
            "question_fts": conn.execute("SELECT COUNT(*) FROM question_fts").fetchone()[0],
        }

        db_existing_ids = existing_question_ids(conn, list(ids_seen))
        to_insert = [q for q in records if q["id"] not in db_existing_ids]
        skipped = [q for q in records if q["id"] in db_existing_ids]

        print()
        print("=" * 70)
        print("ADDITIVE QUESTION IMPORT")
        print("=" * 70)
        print(f"Input JSON       : {json_path}")
        print(f"Target SQLite    : {db_path}")
        print(f"Input questions  : {len(records)}")
        print(f"Already in DB    : {len(skipped)} (will NOT be modified)")
        print(f"New questions    : {len(to_insert)}")
        print("Collections/topics/sets/subtopics: NOT modified")
        print("=" * 70)

        if not to_insert:
            print("\nNothing to insert. Existing database was left unchanged.")
            return

        conn.execute("BEGIN IMMEDIATE")

        for q in to_insert:
            qid = q["id"]
            raw_type = q["type"]
            options = q.get("options", {}) or {}
            solution = q.get("solution")
            source = q.get("source", {}) or {}
            tags = q.get("tags", []) or []
            group_id = q.get("group_id")

            if group_id is not None:
                group_row = conn.execute(
                    "SELECT 1 FROM groups WHERE id = ?",
                    (group_id,),
                ).fetchone()
                if group_row is None:
                    raise ValueError(
                        f"Question {qid} references group {group_id}, but that group does not exist in the existing DB."
                    )

            migrated_options = {
                label: (
                    value
                    if isinstance(value, list)
                    else source_content(value)
                )
                for label, value in options.items()
            }

            if solution is not None and not isinstance(solution, list):
                solution = source_content(solution)

            conn.execute(
                """
                INSERT INTO questions(
                    id,
                    type,
                    content_json,
                    options_json,
                    answer_json,
                    solution_json,
                    figures_json,
                    group_id,
                    question_number,
                    grade,
                    marks,
                    difficulty,
                    tags_json,
                    source_json,
                    review_status,
                    publication_status,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    qid,
                    raw_type,
                    dumps(q["content"]),
                    dumps(migrated_options),
                    dumps(q.get("answer")),
                    dumps(solution),
                    dumps(q.get("figures", []) or []),
                    group_id,
                    question_number(source),
                    q.get("grade"),
                    q.get("marks"),
                    q.get("difficulty"),
                    dumps(tags),
                    dumps(source),
                    q.get("review_status"),
                    q.get("publication_status"),
                    q.get("created_at"),
                    q.get("updated_at"),
                ),
            )

            # Add tags only for this newly inserted question.
            for tag in tags:
                conn.execute(
                    """
                    INSERT INTO question_tags(question_id, tag)
                    VALUES (?, ?)
                    """,
                    (qid, str(tag)),
                )

            # Add exactly one FTS row for this newly inserted question.
            search_text = plain_search_text(
                q["content"],
                migrated_options,
                solution,
                tags,
                source,
            )
            conn.execute(
                """
                INSERT INTO question_fts(question_id, search_text)
                VALUES (?, ?)
                """,
                (qid, search_text),
            )

        conn.commit()

        after = {
            "questions": conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0],
            "question_tags": conn.execute("SELECT COUNT(*) FROM question_tags").fetchone()[0],
            "question_fts": conn.execute("SELECT COUNT(*) FROM question_fts").fetchone()[0],
        }

        expected_questions = before["questions"] + len(to_insert)
        expected_fts = before["question_fts"] + len(to_insert)
        if after["questions"] != expected_questions:
            raise RuntimeError(
                f"Post-import verification failed for questions: expected {expected_questions}, got {after['questions']}"
            )
        if after["question_fts"] != expected_fts:
            raise RuntimeError(
                f"Post-import verification failed for FTS: expected {expected_fts}, got {after['question_fts']}"
            )

        print()
        print("IMPORT COMPLETE")
        print("-" * 70)
        print(f"Inserted questions : {len(to_insert)}")
        print(f"Skipped existing   : {len(skipped)}")
        print(f"Questions          : {before['questions']} -> {after['questions']}")
        print(f"Question tags      : {before['question_tags']} -> {after['question_tags']}")
        print(f"FTS rows           : {before['question_fts']} -> {after['question_fts']}")
        print("Existing questions : NOT modified")
        print("Existing DB        : NOT deleted")
        print("=" * 70)

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Legacy/full migration mode retained from the original utility.
# ---------------------------------------------------------------------------


def discover_source_files(project: Path):
    data = project / "data"
    questions_dir = data / "questions"
    groups_dir = data / "groups"

    print()
    print("=" * 70)
    print("SOURCE DATA CHECK")
    print("=" * 70)
    print(f"Project root : {project}")
    print(f"Data dir     : {data}")
    print(f"Questions dir: {questions_dir}")
    print(f"Groups dir   : {groups_dir}")

    if not project.is_dir():
        raise FileNotFoundError(f"Project directory does not exist:\n  {project}")
    if not data.is_dir():
        raise FileNotFoundError(f"Data directory does not exist:\n  {data}")
    if not questions_dir.is_dir():
        raise FileNotFoundError(f"Questions directory does not exist:\n  {questions_dir}")

    question_files = sorted(questions_dir.rglob("question.json"))
    if not question_files:
        raise RuntimeError(
            "No question.json files were found under:\n"
            f"  {questions_dir}\n\n"
            "Migration has been aborted. The target database has not been touched."
        )

    group_files = sorted(groups_dir.rglob("group.json")) if groups_dir.is_dir() else []

    print(f"Question JSON files found: {len(question_files)}")
    print(f"Group JSON files found   : {len(group_files)}")
    print("=" * 70)
    print()
    return data, question_files, group_files


def legacy_full_migrate(args):
    project = Path(args.project).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()
    schema_path = (
        Path(args.schema).expanduser().resolve()
        if args.schema
        else ROOT / "data" / "schema.sql"
    )

    data, question_files, group_files = discover_source_files(project)
    if not schema_path.is_file():
        raise FileNotFoundError(f"Schema file not found:\n  {schema_path}")

    question_records = []
    question_ids = set()
    for path in question_files:
        try:
            q = read_json(path)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in question file:\n  {path}\n  {e}") from e
        if not isinstance(q, dict):
            raise ValueError(f"Question JSON must contain an object:\n  {path}")
        qid = q.get("id")
        if not qid:
            raise ValueError(f"Question is missing 'id':\n  {path}")
        if qid in question_ids:
            raise ValueError(f"Duplicate question UUID '{qid}' found in:\n  {path}")
        question_ids.add(qid)
        question_records.append((path, q))

    group_records = []
    group_ids = set()
    for path in group_files:
        try:
            g = read_json(path)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in group file:\n  {path}\n  {e}") from e
        if not isinstance(g, dict):
            raise ValueError(f"Group JSON must contain an object:\n  {path}")
        gid = g.get("id")
        if not gid:
            raise ValueError(f"Group is missing 'id':\n  {path}")
        if gid in group_ids:
            raise ValueError(f"Duplicate group UUID '{gid}' found in:\n  {path}")
        group_ids.add(gid)
        group_records.append((path, g))

    if args.reset and db_path.exists():
        print(f"Removing existing SQLite database: {db_path}")
        db_path.unlink()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        conn.executescript(schema_path.read_text(encoding="utf-8"))

        collections_data = read_json(data / "collections.json", {"collections": []}) or {"collections": []}
        topics_data = read_json(data / "topics.json", {"topics": []}) or {"topics": []}
        qtopic_data = read_json(data / "mappings" / "question_topics.json", {"mappings": []}) or {"mappings": []}
        qcollection_data = read_json(data / "mappings" / "question_collections.json", {"mappings": []}) or {"mappings": []}

        conn.execute("BEGIN")

        for idx, collection in enumerate(collections_data.get("collections", [])):
            conn.execute(
                "INSERT OR REPLACE INTO collections(id, name, sort_order) VALUES (?, ?, ?)",
                (collection.get("id"), collection.get("name", ""), idx),
            )
            for sidx, item in enumerate(collection.get("sets", [])):
                conn.execute(
                    "INSERT OR REPLACE INTO sets(id, collection_id, name, sort_order) VALUES (?, ?, ?, ?)",
                    (item.get("id"), collection.get("id"), item.get("name", ""), sidx),
                )

        for idx, topic in enumerate(topics_data.get("topics", [])):
            conn.execute(
                "INSERT OR REPLACE INTO topics(id, name, sort_order) VALUES (?, ?, ?)",
                (topic.get("id"), topic.get("name", ""), idx),
            )
            for sidx, item in enumerate(topic.get("subtopics", [])):
                conn.execute(
                    "INSERT OR REPLACE INTO subtopics(id, topic_id, name, sort_order) VALUES (?, ?, ?, ?)",
                    (item.get("id"), topic.get("id"), item.get("name", ""), sidx),
                )

        topic_map = {
            item.get("uuid"): item.get("mappings") or []
            for item in qtopic_data.get("mappings", [])
            if item.get("uuid")
        }
        collection_map = {
            item.get("uuid"): item.get("mappings") or []
            for item in qcollection_data.get("mappings", [])
            if item.get("uuid")
        }

        for path, g in group_records:
            gid = g["id"]
            content = g.get("content") if isinstance(g.get("content"), list) else legacy_text_to_content(g.get("content", ""))
            source = g.get("source", {}) or {}
            tags = g.get("tags", []) or []
            conn.execute(
                """
                INSERT OR REPLACE INTO groups(
                    id,type,content_json,marks,figures_json,grade,tags_json,
                    source_json,review_status,publication_status,created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    gid,"GROUP",dumps(content),g.get("marks"),dumps(g.get("figures",[]) or []),
                    g.get("grade"),dumps(tags),dumps(source),g.get("review_status","NEEDS_REVIEW"),
                    g.get("publication_status","DRAFT"),g.get("created_at"),g.get("updated_at"),
                ),
            )

        for path, q in question_records:
            qid = q["id"]
            raw_type = q.get("type", "SUBJECTIVE")
            if raw_type not in {"MCQ", "SUBJECTIVE"}:
                raise ValueError(f"Unexpected question type {raw_type!r} in {path}")
            content = q.get("content") if isinstance(q.get("content"), list) else legacy_text_to_content(q.get("question", ""))
            options = q.get("options", {}) or {}
            migrated_options = {
                label: (value if isinstance(value, list) else source_content(value))
                for label, value in options.items()
            }
            solution = q.get("solution")
            if solution is not None and not isinstance(solution, list):
                solution = source_content(solution)
            source = q.get("source", {}) or {}
            tags = q.get("tags", []) or []
            group_id = q.get("group_id")
            if group_id and group_id not in group_ids:
                print(f"WARNING: question {qid} references missing group {group_id}; group_id set to NULL")
                group_id = None

            conn.execute(
                """
                INSERT OR REPLACE INTO questions(
                    id,type,content_json,options_json,answer_json,solution_json,figures_json,
                    group_id,question_number,grade,marks,difficulty,tags_json,source_json,
                    review_status,publication_status,created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    qid,raw_type,dumps(content),dumps(migrated_options),dumps(q.get("answer")),dumps(solution),
                    dumps(q.get("figures",[]) or []),group_id,question_number(source),q.get("grade"),
                    q.get("marks",1),q.get("difficulty"),dumps(tags),dumps(source),
                    q.get("review_status","NEEDS_REVIEW"),q.get("publication_status","DRAFT"),
                    q.get("created_at"),q.get("updated_at"),
                ),
            )

            conn.execute("DELETE FROM question_topics WHERE question_id = ?", (qid,))
            for mapping in topic_map.get(qid, []):
                if mapping.get("topic_id") and mapping.get("subtopic_id"):
                    conn.execute(
                        "INSERT OR IGNORE INTO question_topics(question_id,topic_id,subtopic_id) VALUES (?,?,?)",
                        (qid,mapping["topic_id"],mapping["subtopic_id"]),
                    )

            conn.execute("DELETE FROM question_collections WHERE question_id = ?", (qid,))
            for mapping in collection_map.get(qid, []):
                if mapping.get("collection_id") and mapping.get("set_id"):
                    conn.execute(
                        "INSERT OR IGNORE INTO question_collections(question_id,collection_id,set_id) VALUES (?,?,?)",
                        (qid,mapping["collection_id"],mapping["set_id"]),
                    )

            conn.execute("DELETE FROM question_tags WHERE question_id = ?", (qid,))
            for tag in tags:
                conn.execute("INSERT OR IGNORE INTO question_tags(question_id,tag) VALUES (?,?)", (qid,str(tag)))

        for path, g in group_records:
            gid = g["id"]
            conn.execute("DELETE FROM group_children WHERE group_id = ?", (gid,))
            for idx, child in enumerate(g.get("children",[]) or []):
                child_id = child if isinstance(child,str) else (child.get("id") or child.get("uuid"))
                if child_id and child_id in question_ids:
                    conn.execute(
                        "INSERT OR IGNORE INTO group_children(group_id,question_id,sort_order) VALUES (?,?,?)",
                        (gid,child_id,idx),
                    )

        conn.execute("DELETE FROM question_fts")
        rows = conn.execute(
            "SELECT id,content_json,options_json,solution_json,tags_json,source_json FROM questions"
        ).fetchall()
        for row in rows:
            search_text = plain_search_text(
                json.loads(row["content_json"]),
                json.loads(row["options_json"] or "{}"),
                json.loads(row["solution_json"]) if row["solution_json"] else None,
                json.loads(row["tags_json"] or "[]"),
                json.loads(row["source_json"] or "{}"),
            )
            conn.execute("INSERT INTO question_fts(question_id,search_text) VALUES (?,?)", (row["id"],search_text))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print("\n" + "=" * 70)
    print("MIGRATION COMPLETE")
    print("=" * 70)
    print(f"SQLite database: {db_path}")
    print(f"Questions       : {len(question_files)}")
    print(f"Groups          : {len(group_files)}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(description="Migrate or add Tomato QB JSON question data into SQLite.")

    parser.add_argument(
        "--append-json",
        default=None,
        help=(
            "Add questions from this JSON array to an existing SQLite DB. "
            "This mode never deletes/overwrites existing questions and does not modify topics/collections."
        ),
    )
    parser.add_argument("--project", default=".", help="Source project root for legacy/full migration mode.")
    parser.add_argument("--db", default="data/question_bank.db", help="Target SQLite database path.")
    parser.add_argument("--schema", default=None, help="Optional path to schema.sql for legacy/full migration mode.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Legacy/full migration only: replace the target DB after source validation succeeds.",
    )

    args = parser.parse_args()

    if args.append_json and args.reset:
        parser.error("--append-json and --reset are mutually exclusive. Additive mode never uses --reset.")

    try:
        if args.append_json:
            append_json_questions(
                Path(args.append_json).expanduser().resolve(),
                Path(args.db).expanduser().resolve(),
            )
        else:
            legacy_full_migrate(args)
    except Exception as exc:
        print()
        print("IMPORT/MIGRATION FAILED")
        print("-" * 70)
        print(str(exc))
        print("-" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
