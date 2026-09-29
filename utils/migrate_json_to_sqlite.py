#!/usr/bin/env python3
r"""Migrate the existing JSON-backed question bank into SQLite.

Important safety behavior:
- Source JSON files are NEVER modified.
- The target database is NOT deleted until the source dataset has been
  verified and at least one question.json has been found.
- Question/group files are discovered recursively with rglob().
- Missing source directories and zero-question datasets fail loudly.
- A dry inspection of the source paths is printed before migration.

Example:

    python utils/migrate_json_to_sqlite.py ^
        --project "C:\xampp\htdocs\tomato_qb" ^
        --db "C:\xampp\htdocs\tomato-qb2\data\question_bank.db" ^
        --reset
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

# The schema/content-model files shipped with this utility set.
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
        raise FileNotFoundError(
            f"Project directory does not exist:\n  {project}"
        )

    if not data.is_dir():
        raise FileNotFoundError(
            f"Data directory does not exist:\n  {data}"
        )

    if not questions_dir.is_dir():
        raise FileNotFoundError(
            f"Questions directory does not exist:\n  {questions_dir}"
        )

    # Recursive discovery. This does not depend on a specific folder depth.
    question_files = sorted(questions_dir.rglob("question.json"))

    if not question_files:
        raise RuntimeError(
            "No question.json files were found under:\n"
            f"  {questions_dir}\n\n"
            "Migration has been aborted. The target database has not been touched."
        )

    if groups_dir.is_dir():
        group_files = sorted(groups_dir.rglob("group.json"))
    else:
        print("Groups directory not found; continuing with 0 groups.")
        group_files = []

    print(f"Question JSON files found: {len(question_files)}")
    print(f"Group JSON files found   : {len(group_files)}")
    print("=" * 70)
    print()

    return data, question_files, group_files


def migrate(args):
    project = Path(args.project).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()

    schema_path = (
        Path(args.schema).expanduser().resolve()
        if args.schema
        else ROOT / "data" / "schema.sql"
    )

    # Validate source BEFORE deleting/replacing the target database.
    data, question_files, group_files = discover_source_files(project)

    if not schema_path.is_file():
        raise FileNotFoundError(
            f"Schema file not found:\n  {schema_path}"
        )

    # Read all source JSON first so malformed input fails before any DB
    # transaction starts.
    question_records = []
    question_ids = set()

    for path in question_files:
        try:
            q = read_json(path)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Invalid JSON in question file:\n  {path}\n"
                f"  {e}"
            ) from e

        if not isinstance(q, dict):
            raise ValueError(
                f"Question JSON must contain an object:\n  {path}"
            )

        qid = q.get("id")
        if not qid:
            raise ValueError(f"Question is missing 'id':\n  {path}")

        if qid in question_ids:
            raise ValueError(
                f"Duplicate question UUID '{qid}' found in:\n  {path}"
            )

        question_ids.add(qid)
        question_records.append((path, q))

    group_records = []
    group_ids = set()

    for path in group_files:
        try:
            g = read_json(path)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Invalid JSON in group file:\n  {path}\n"
                f"  {e}"
            ) from e

        if not isinstance(g, dict):
            raise ValueError(
                f"Group JSON must contain an object:\n  {path}"
            )

        gid = g.get("id")
        if not gid:
            raise ValueError(f"Group is missing 'id':\n  {path}")

        if gid in group_ids:
            raise ValueError(
                f"Duplicate group UUID '{gid}' found in:\n  {path}"
            )

        group_ids.add(gid)
        group_records.append((path, g))

    # Only after the source dataset has passed validation do we touch the DB.
    if args.reset and db_path.exists():
        print(f"Removing existing SQLite database: {db_path}")
        db_path.unlink()

    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        conn.executescript(schema_path.read_text(encoding="utf-8"))

        collections_data = (
            read_json(
                data / "collections.json",
                {"collections": []},
            )
            or {"collections": []}
        )

        topics_data = (
            read_json(
                data / "topics.json",
                {"topics": []},
            )
            or {"topics": []}
        )

        qtopic_data = (
            read_json(
                data / "mappings" / "question_topics.json",
                {"mappings": []},
            )
            or {"mappings": []}
        )

        qcollection_data = (
            read_json(
                data / "mappings" / "question_collections.json",
                {"mappings": []},
            )
            or {"mappings": []}
        )

        # ------------------------------------------------------------
        # Begin database transaction
        # ------------------------------------------------------------
        conn.execute("BEGIN")

        # Collections + sets
        for idx, collection in enumerate(
            collections_data.get("collections", [])
        ):
            conn.execute(
                """
                INSERT OR REPLACE INTO collections(
                    id, name, sort_order
                )
                VALUES (?, ?, ?)
                """,
                (
                    collection.get("id"),
                    collection.get("name", ""),
                    idx,
                ),
            )

            for sidx, item in enumerate(
                collection.get("sets", [])
            ):
                conn.execute(
                    """
                    INSERT OR REPLACE INTO sets(
                        id, collection_id, name, sort_order
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        item.get("id"),
                        collection.get("id"),
                        item.get("name", ""),
                        sidx,
                    ),
                )

        # Topics + subtopics
        for idx, topic in enumerate(
            topics_data.get("topics", [])
        ):
            conn.execute(
                """
                INSERT OR REPLACE INTO topics(
                    id, name, sort_order
                )
                VALUES (?, ?, ?)
                """,
                (
                    topic.get("id"),
                    topic.get("name", ""),
                    idx,
                ),
            )

            for sidx, item in enumerate(
                topic.get("subtopics", [])
            ):
                conn.execute(
                    """
                    INSERT OR REPLACE INTO subtopics(
                        id, topic_id, name, sort_order
                    )
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        item.get("id"),
                        topic.get("id"),
                        item.get("name", ""),
                        sidx,
                    ),
                )

        # Mappings
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

        # ------------------------------------------------------------
        # Groups first
        # ------------------------------------------------------------
        for path, g in group_records:
            gid = g["id"]

            content = (
                g.get("content")
                if isinstance(g.get("content"), list)
                else legacy_text_to_content(
                    g.get("content", "")
                )
            )

            source = g.get("source", {}) or {}
            tags = g.get("tags", []) or []

            conn.execute(
                """
                INSERT OR REPLACE INTO groups(
                    id,
                    type,
                    content_json,
                    marks,
                    figures_json,
                    grade,
                    tags_json,
                    source_json,
                    review_status,
                    publication_status,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    gid,
                    "GROUP",
                    dumps(content),
                    g.get("marks"),
                    dumps(g.get("figures", []) or []),
                    g.get("grade"),
                    dumps(tags),
                    dumps(source),
                    g.get(
                        "review_status",
                        "NEEDS_REVIEW",
                    ),
                    g.get(
                        "publication_status",
                        "DRAFT",
                    ),
                    g.get("created_at"),
                    g.get("updated_at"),
                ),
            )

        # ------------------------------------------------------------
        # Questions
        # ------------------------------------------------------------
        for path, q in question_records:
            qid = q["id"]
            raw_type = q.get("type", "SUBJECTIVE")

            if raw_type not in {"MCQ", "SUBJECTIVE"}:
                raise ValueError(
                    f"Unexpected question type {raw_type!r} in {path}; "
                    "GROUP records belong in data/groups."
                )

            content = (
                q.get("content")
                if isinstance(q.get("content"), list)
                else legacy_text_to_content(
                    q.get("question", "")
                )
            )

            options = q.get("options", {}) or {}

            migrated_options = {
                label: (
                    value
                    if isinstance(value, list)
                    else source_content(value)
                )
                for label, value in options.items()
            }

            solution = q.get("solution")

            if solution is not None and not isinstance(
                solution, list
            ):
                solution = source_content(solution)

            source = q.get("source", {}) or {}
            tags = q.get("tags", []) or []
            created = q.get("created_at")
            updated = q.get("updated_at")

            group_id = q.get("group_id")

            if group_id and group_id not in group_ids:
                print(
                    f"WARNING: question {qid} references missing "
                    f"group {group_id}; group_id set to NULL"
                )
                group_id = None

            conn.execute(
                """
                INSERT OR REPLACE INTO questions(
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
                    dumps(content),
                    dumps(migrated_options),
                    dumps(q.get("answer")),
                    dumps(solution),
                    dumps(q.get("figures", []) or []),
                    group_id,
                    question_number(source),
                    q.get("grade"),
                    q.get("marks", 1),
                    q.get("difficulty"),
                    dumps(tags),
                    dumps(source),
                    q.get(
                        "review_status",
                        "NEEDS_REVIEW",
                    ),
                    q.get(
                        "publication_status",
                        "DRAFT",
                    ),
                    created,
                    updated,
                ),
            )

            # Topic mappings
            conn.execute(
                "DELETE FROM question_topics WHERE question_id = ?",
                (qid,),
            )

            for mapping in topic_map.get(qid, []):
                if (
                    mapping.get("topic_id")
                    and mapping.get("subtopic_id")
                ):
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO question_topics(
                            question_id,
                            topic_id,
                            subtopic_id
                        )
                        VALUES (?, ?, ?)
                        """,
                        (
                            qid,
                            mapping["topic_id"],
                            mapping["subtopic_id"],
                        ),
                    )

            # Collection mappings
            conn.execute(
                "DELETE FROM question_collections WHERE question_id = ?",
                (qid,),
            )

            for mapping in collection_map.get(qid, []):
                if (
                    mapping.get("collection_id")
                    and mapping.get("set_id")
                ):
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO question_collections(
                            question_id,
                            collection_id,
                            set_id
                        )
                        VALUES (?, ?, ?)
                        """,
                        (
                            qid,
                            mapping["collection_id"],
                            mapping["set_id"],
                        ),
                    )

            # Tags
            conn.execute(
                "DELETE FROM question_tags WHERE question_id = ?",
                (qid,),
            )

            for tag in tags:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO question_tags(
                        question_id,
                        tag
                    )
                    VALUES (?, ?)
                    """,
                    (
                        qid,
                        str(tag),
                    ),
                )

        # ------------------------------------------------------------
        # Group child ordering
        # ------------------------------------------------------------
        for path, g in group_records:
            gid = g["id"]

            conn.execute(
                "DELETE FROM group_children WHERE group_id = ?",
                (gid,),
            )

            for idx, child in enumerate(
                g.get("children", []) or []
            ):
                child_id = (
                    child
                    if isinstance(child, str)
                    else (
                        child.get("id")
                        or child.get("uuid")
                    )
                )

                if child_id and child_id in question_ids:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO group_children(
                            group_id,
                            question_id,
                            sort_order
                        )
                        VALUES (?, ?, ?)
                        """,
                        (
                            gid,
                            child_id,
                            idx,
                        ),
                    )

                elif child_id:
                    print(
                        f"WARNING: group {gid} references missing "
                        f"question {child_id}; skipped"
                    )

        # ------------------------------------------------------------
        # Rebuild FTS index
        # ------------------------------------------------------------
        conn.execute("DELETE FROM question_fts")

        rows = conn.execute(
            """
            SELECT
                id,
                content_json,
                options_json,
                solution_json,
                tags_json,
                source_json
            FROM questions
            """
        ).fetchall()

        for row in rows:
            search_text = plain_search_text(
                json.loads(row["content_json"]),
                json.loads(
                    row["options_json"] or "{}"
                ),
                (
                    json.loads(row["solution_json"])
                    if row["solution_json"]
                    else None
                ),
                json.loads(
                    row["tags_json"] or "[]"
                ),
                json.loads(
                    row["source_json"] or "{}"
                ),
            )

            conn.execute(
                """
                INSERT INTO question_fts(
                    question_id,
                    search_text
                )
                VALUES (?, ?)
                """,
                (
                    row["id"],
                    search_text,
                ),
            )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()

    print()
    print("=" * 70)
    print("MIGRATION COMPLETE")
    print("=" * 70)
    print(f"SQLite database: {db_path}")
    print(f"Questions       : {len(question_files)}")
    print(f"Groups          : {len(group_files)}")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Migrate the JSON-backed question bank into SQLite."
        )
    )

    parser.add_argument(
        "--project",
        default=".",
        help=(
            "Source project root containing data/questions "
            "and optionally data/groups."
        ),
    )

    parser.add_argument(
        "--db",
        default="data/question_bank.db",
        help=(
            "Target SQLite database path. "
            "Relative paths are resolved from the current "
            "working directory."
        ),
    )

    parser.add_argument(
        "--schema",
        default=None,
        help=(
            "Optional path to schema.sql. Defaults to the "
            "schema shipped with this utility set."
        ),
    )

    parser.add_argument(
        "--reset",
        action="store_true",
        help=(
            "Replace the target database after source validation "
            "has succeeded."
        ),
    )

    args = parser.parse_args()

    try:
        migrate(args)
    except Exception as exc:
        print()
        print("MIGRATION FAILED")
        print("-" * 70)
        print(str(exc))
        print("-" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
