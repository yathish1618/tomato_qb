from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, g, jsonify, request, send_from_directory

from content_model import normalize_content, plain_text_from_content

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DB = DATA / "question_bank.db"
FRONTEND = ROOT / "frontend" / "dist"
SOURCE_QUESTIONS = DATA / "questions"
SOURCE_GROUPS = DATA / "groups"

app = Flask(__name__, static_folder=None)

ALLOWED_TYPES = {"MCQ", "SUBJECTIVE"}
ALLOWED_GRADES = {str(i) for i in range(1, 13)} | {"12+"}
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
UUID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}$")


def db():
    if "db" not in g:
        conn = sqlite3.connect(DB)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def safe_id(value: str) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        abort(400)
    return value


def json_dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def json_loads(value, default):
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    sql = (DATA / "schema.sql").read_text(encoding="utf-8")
    conn = sqlite3.connect(DB)
    conn.executescript(sql)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.commit()
    conn.close()


def rebuild_fts(conn):
    conn.execute("DELETE FROM question_fts")
    rows = conn.execute(
        "SELECT id, content_json, options_json, solution_json, tags_json, source_json FROM questions"
    ).fetchall()
    for row in rows:
        text_parts = [
            plain_text_from_content(json_loads(row["content_json"], [])),
            plain_text_from_content(json_loads(row["options_json"], {})),
            plain_text_from_content(json_loads(row["solution_json"], [])),
            plain_text_from_content(json_loads(row["tags_json"], [])),
            plain_text_from_content(json_loads(row["source_json"], {})),
        ]
        conn.execute(
            "INSERT INTO question_fts(question_id, search_text) VALUES (?, ?)",
            (row["id"], " ".join(x for x in text_parts if x)),
        )
    conn.commit()


def serialize_question(row):
    q = dict(row)
    q["content"] = json_loads(q.pop("content_json"), [])
    q["options"] = json_loads(q.pop("options_json"), {})
    q["answer"] = json_loads(q.pop("answer_json"), None)
    q["solution"] = json_loads(q.pop("solution_json"), None)
    q["figures"] = json_loads(q.pop("figures_json"), [])
    q["tags"] = json_loads(q.pop("tags_json"), [])
    q["source"] = json_loads(q.pop("source_json"), {})
    q["topics"] = [
        {"topic_id": r[0], "subtopic_id": r[1]}
        for r in db().execute(
            "SELECT topic_id, subtopic_id FROM question_topics WHERE question_id = ? ORDER BY topic_id, subtopic_id",
            (q["id"],),
        ).fetchall()
    ]
    q["collections"] = [
        {"collection_id": r[0], "set_id": r[1]}
        for r in db().execute(
            "SELECT collection_id, set_id FROM question_collections WHERE question_id = ? ORDER BY collection_id, set_id",
            (q["id"],),
        ).fetchall()
    ]
    return q


def content_preview(content):
    text = plain_text_from_content(content)
    return re.sub(r"\s+", " ", text).strip()[:260]


def build_filter_sql(args, alias="q"):
    where = []
    params = []

    search = (args.get("search") or "").strip()
    if search:
        if UUID_RE.fullmatch(search):
            where.append(f"{alias}.id = ?")
            params.append(search)
        else:
            tokens = re.findall(r"[\w]+", search.lower(), flags=re.UNICODE)
            if tokens:
                fts_query = " AND ".join(f'"{t}"*' for t in tokens[:12])
                where.append(
                    f"{alias}.id IN (SELECT question_id FROM question_fts WHERE question_fts MATCH ?)"
                )
                params.append(fts_query)

    ftype = args.get("type") or ""
    if ftype:
        where.append(f"{alias}.type = ?")
        params.append(ftype)

    grade = args.get("grade") or ""
    if grade:
        where.append(f"{alias}.grade = ?")
        params.append(grade)

    difficulty = args.get("difficulty") or ""
    if difficulty:
        where.append(f"{alias}.difficulty = ?")
        params.append(difficulty)

    marks = args.get("marks") or ""
    if marks:
        where.append(f"{alias}.marks = ?")
        params.append(float(marks))

    status = args.get("status") or ""
    if status and status != "all":
        where.append(f"({alias}.review_status = ? OR {alias}.publication_status = ?)")
        params.extend([status, status])

    tag = (args.get("tag") or "").strip().lower()
    if tag:
        where.append(
            f"EXISTS (SELECT 1 FROM question_tags qt WHERE qt.question_id = {alias}.id AND lower(qt.tag) LIKE ?)"
        )
        params.append(f"%{tag}%")

    collection_id = args.get("collection_id") or ""
    set_id = args.get("set_id") or ""
    if collection_id == "__UNMAPPED_COLLECTION__":
        where.append(f"NOT EXISTS (SELECT 1 FROM question_collections qc WHERE qc.question_id = {alias}.id)")
    elif collection_id:
        where.append(
            f"EXISTS (SELECT 1 FROM question_collections qc WHERE qc.question_id = {alias}.id AND qc.collection_id = ?)"
        )
        params.append(collection_id)
    if set_id:
        where.append(
            f"EXISTS (SELECT 1 FROM question_collections qc WHERE qc.question_id = {alias}.id AND qc.set_id = ?)"
        )
        params.append(set_id)

    topic_id = args.get("topic_id") or ""
    subtopic_id = args.get("subtopic_id") or ""
    if topic_id == "__UNMAPPED_TOPIC__":
        where.append(f"NOT EXISTS (SELECT 1 FROM question_topics qt WHERE qt.question_id = {alias}.id)")
    elif topic_id:
        where.append(
            f"EXISTS (SELECT 1 FROM question_topics qt WHERE qt.question_id = {alias}.id AND qt.topic_id = ?)"
        )
        params.append(topic_id)

    if subtopic_id == "__UNMAPPED_SUBTOPIC__":
        where.append(
            f"NOT EXISTS (SELECT 1 FROM question_topics qt WHERE qt.question_id = {alias}.id AND qt.subtopic_id IS NOT NULL)"
        )
    elif subtopic_id:
        where.append(
            f"EXISTS (SELECT 1 FROM question_topics qt WHERE qt.question_id = {alias}.id AND qt.subtopic_id = ?)"
        )
        params.append(subtopic_id)

    return where, params


def question_order(alias="q"):
    return f"CASE WHEN {alias}.question_number IS NULL THEN 1 ELSE 0 END, {alias}.question_number, {alias}.id"


def list_questions(args):
    try:
        page = max(1, int(args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        page_size = min(MAX_PAGE_SIZE, max(1, int(args.get("page_size", DEFAULT_PAGE_SIZE))))
    except ValueError:
        page_size = DEFAULT_PAGE_SIZE

    where, params = build_filter_sql(args)
    clause = " WHERE " + " AND ".join(where) if where else ""
    conn = db()

    total = conn.execute(f"SELECT COUNT(*) FROM questions q{clause}", params).fetchone()[0]
    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""
        SELECT q.id, q.type, q.group_id, q.question_number, q.grade,
               q.difficulty, q.marks, q.review_status, q.publication_status,
               q.content_json, q.tags_json
        FROM questions q
        {clause}
        ORDER BY {question_order()}
        LIMIT ? OFFSET ?
        """,
        [*params, page_size, offset],
    ).fetchall()

    result = []
    for row in rows:
        content = json_loads(row["content_json"], [])
        tags = json_loads(row["tags_json"], [])
        qid = row["id"]
        topics = [dict(x) for x in conn.execute(
            "SELECT topic_id, subtopic_id FROM question_topics WHERE question_id = ?",
            (qid,),
        ).fetchall()]
        collections = [dict(x) for x in conn.execute(
            "SELECT collection_id, set_id FROM question_collections WHERE question_id = ?",
            (qid,),
        ).fetchall()]
        result.append({
            "id": qid,
            "type": row["type"],
            "group_id": row["group_id"],
            "question_number": row["question_number"],
            "grade": row["grade"],
            "difficulty": row["difficulty"],
            "marks": row["marks"],
            "review_status": row["review_status"],
            "publication_status": row["publication_status"],
            "preview": content_preview(content),
            "tags": tags,
            "topics": topics,
            "collections": collections,
        })
    return {
        "questions": result,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def validate_content(value):
    if not isinstance(value, list):
        raise ValueError("content must be an array of blocks")
    return value


def validate_question_payload(data, qid):
    if data.get("id") != qid:
        return "Question ID cannot be changed."
    qtype = data.get("type")
    if qtype not in ALLOWED_TYPES:
        return "Invalid question type."
    if not isinstance(data.get("content"), list):
        return "Question content must be an array of blocks."
    grade = data.get("grade")
    if grade not in (None, "") and str(grade) not in ALLOWED_GRADES:
        return "Invalid grade."
    if qtype == "MCQ" and not isinstance(data.get("options"), dict):
        return "MCQ options must be an object."
    if not isinstance(data.get("tags", []), list):
        return "Tags must be an array."
    if not isinstance(data.get("topics", []), list):
        return "topics must be an array."
    if not isinstance(data.get("collections", []), list):
        return "collections must be an array."
    return None


def replace_relationships(conn, qid, table, rows, cols):
    conn.execute(f"DELETE FROM {table} WHERE question_id = ?", (qid,))
    if not rows:
        return
    placeholders = ",".join("?" for _ in cols)
    conn.executemany(
        f"INSERT INTO {table}(question_id, {','.join(cols)}) VALUES ({','.join(['?'] * (len(cols)+1))})",
        [(qid, *r) for r in rows],
    )


def update_fts_for_question(conn, qid):
    conn.execute("DELETE FROM question_fts WHERE question_id = ?", (qid,))
    row = conn.execute(
        "SELECT content_json, options_json, solution_json, tags_json, source_json FROM questions WHERE id = ?",
        (qid,),
    ).fetchone()
    if not row:
        return
    text = " ".join([
        plain_text_from_content(json_loads(row[0], [])),
        plain_text_from_content(json_loads(row[1], {})),
        plain_text_from_content(json_loads(row[2], [])),
        plain_text_from_content(json_loads(row[3], [])),
        plain_text_from_content(json_loads(row[4], {})),
    ])
    conn.execute("INSERT INTO question_fts(question_id, search_text) VALUES (?, ?)", (qid, text))


def catalog_collections():
    conn = db()
    collections = []
    for c in conn.execute("SELECT id, name, sort_order FROM collections ORDER BY lower(name), id"):
        sets = []
        for s in conn.execute(
            """SELECT s.id, s.name,
                      (SELECT COUNT(*) FROM question_collections qc WHERE qc.set_id = s.id) AS question_count
               FROM sets s WHERE s.collection_id = ? ORDER BY lower(s.name), s.id""",
            (c["id"],),
        ):
            sets.append({"id": s["id"], "name": s["name"], "question_count": s["question_count"]})
        count = conn.execute(
            "SELECT COUNT(*) FROM question_collections WHERE collection_id = ?",
            (c["id"],),
        ).fetchone()[0]
        collections.append({"id": c["id"], "name": c["name"], "question_count": count, "sets": sets})
    return {"collections": collections}


def catalog_topics():
    conn = db()
    topics = []
    for t in conn.execute("SELECT id, name FROM topics ORDER BY lower(name), id"):
        subs = []
        for s in conn.execute(
            """SELECT s.id, s.name,
                      (SELECT COUNT(*) FROM question_topics qt WHERE qt.subtopic_id = s.id) AS question_count
               FROM subtopics s WHERE s.topic_id = ? ORDER BY lower(s.name), s.id""",
            (t["id"],),
        ):
            subs.append({"id": s["id"], "name": s["name"], "question_count": s["question_count"]})
        count = conn.execute(
            "SELECT COUNT(*) FROM question_topics WHERE topic_id = ?",
            (t["id"],),
        ).fetchone()[0]
        topics.append({"id": t["id"], "name": t["name"], "question_count": count, "subtopics": subs})
    return {"topics": topics}


@app.route("/")
def public_home():
    return send_from_directory(FRONTEND, "public.html")


@app.route("/cms")
def cms_home():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/topics")
def topics_page():
    return send_from_directory(FRONTEND, "topics.html")


@app.route("/collections")
def collections_page():
    return send_from_directory(FRONTEND, "collections.html")


@app.route("/bulk-operations")
def bulk_operations_page():
    return send_from_directory(FRONTEND, "bulk-operations.html")


@app.get("/api/health")
def health():
    row = db().execute("SELECT COUNT(*) AS n FROM questions").fetchone()
    meta = {r["key"]: r["value"] for r in db().execute("SELECT key, value FROM schema_meta").fetchall()}
    return jsonify({
        "ok": True,
        "questions": row["n"],
        "schema_version": meta.get("schema_version"),
        "content_model_version": meta.get("content_model_version"),
    })


@app.get("/api/questions")
def questions_api():
    return jsonify(list_questions(request.args))


@app.get("/api/questions/<qid>")
def get_question(qid):
    qid = safe_id(qid)
    row = db().execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    if not row:
        abort(404)
    return jsonify(serialize_question(row))


@app.put("/api/questions/<qid>")
def save_question(qid):
    qid = safe_id(qid)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"success": False, "error": "Invalid JSON body."}), 400
    err = validate_question_payload(data, qid)
    if err:
        return jsonify({"success": False, "error": err}), 400

    conn = db()
    old = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    if not old:
        abort(404)

    now = utc_now()
    try:
        conn.execute("BEGIN")
        conn.execute(
            """
            UPDATE questions SET type=?, content_json=?, options_json=?, answer_json=?, solution_json=?,
                figures_json=?, group_id=?, grade=?, marks=?, difficulty=?, tags_json=?, source_json=?,
                review_status=?, publication_status=?, updated_at=? WHERE id=?
            """,
            (
                data.get("type"),
                json_dumps(validate_content(data.get("content"))),
                json_dumps(data.get("options", {})),
                json_dumps(data.get("answer")),
                json_dumps(data.get("solution")),
                json_dumps(data.get("figures", [])),
                data.get("group_id"),
                data.get("grade"),
                data.get("marks"),
                data.get("difficulty"),
                json_dumps(data.get("tags", [])),
                json_dumps(data.get("source", {})),
                data.get("review_status", "NEEDS_REVIEW"),
                data.get("publication_status", "DRAFT"),
                now,
                qid,
            ),
        )
        conn.execute("DELETE FROM question_topics WHERE question_id = ?", (qid,))
        for mapping in data.get("topics", []):
            conn.execute(
                "INSERT INTO question_topics(question_id, topic_id, subtopic_id) VALUES (?, ?, ?)",
                (qid, mapping["topic_id"], mapping["subtopic_id"]),
            )
        conn.execute("DELETE FROM question_collections WHERE question_id = ?", (qid,))
        for mapping in data.get("collections", []):
            conn.execute(
                "INSERT INTO question_collections(question_id, collection_id, set_id) VALUES (?, ?, ?)",
                (qid, mapping["collection_id"], mapping["set_id"]),
            )
        conn.execute("DELETE FROM question_tags WHERE question_id = ?", (qid,))
        for tag in data.get("tags", []):
            conn.execute("INSERT INTO question_tags(question_id, tag) VALUES (?, ?)", (qid, str(tag)))
        update_fts_for_question(conn, qid)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return jsonify({"success": True})


@app.get("/api/questions/<qid>/neighbors")
def question_neighbors(qid):
    qid = safe_id(qid)
    current = db().execute("SELECT id, question_number FROM questions WHERE id = ?", (qid,)).fetchone()
    if not current:
        abort(404)

    where, params = build_filter_sql(request.args)
    where.append("q.id != ?")
    params.append(qid)
    clause = " AND ".join(where)
    order = question_order()

    current_number = current["question_number"]

    if current_number is None:
        prev_condition = "q.question_number IS NULL AND q.id < ?"
        next_condition = "q.question_number IS NULL AND q.id > ?"
    else:
        prev_condition = "(q.question_number < ? OR (q.question_number = ? AND q.id < ?))"
        next_condition = "(q.question_number > ? OR (q.question_number = ? AND q.id > ?))"

    conn = db()
    prev_sql = f"SELECT q.id FROM questions q WHERE {clause} AND {prev_condition} ORDER BY q.question_number DESC, q.id DESC LIMIT 1"
    next_sql = f"SELECT q.id FROM questions q WHERE {clause} AND {next_condition} ORDER BY {order} LIMIT 1"

    if current_number is None:
        prev_params = [*params, qid]
        next_params = [*params, qid]
    else:
        prev_params = [*params, current_number, current_number, qid]
        next_params = [*params, current_number, current_number, qid]

    prev = conn.execute(prev_sql, prev_params).fetchone()
    nxt = conn.execute(next_sql, next_params).fetchone()
    return jsonify({"previous": prev[0] if prev else None, "next": nxt[0] if nxt else None})


@app.get("/api/groups/<gid>")
def get_group(gid):
    gid = safe_id(gid)
    row = db().execute("SELECT * FROM groups WHERE id = ?", (gid,)).fetchone()
    if not row:
        abort(404)
    group = dict(row)
    group["content"] = json_loads(group.pop("content_json"), [])
    group["figures"] = json_loads(group.pop("figures_json"), [])
    group["tags"] = json_loads(group.pop("tags_json"), [])
    group["source"] = json_loads(group.pop("source_json"), {})
    group["children"] = [r[0] for r in db().execute(
        "SELECT question_id FROM group_children WHERE group_id = ? ORDER BY sort_order",
        (gid,),
    ).fetchall()]
    return jsonify(group)


FIGURE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024
_figure_upload_lock = threading.Lock()
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@app.post("/api/questions/<qid>/figures")
def upload_question_figure(qid):
    qid = safe_id(qid)

    if not db().execute("SELECT 1 FROM questions WHERE id = ?", (qid,)).fetchone():
        abort(404)

    kind = (request.form.get("kind") or "").strip().lower()
    prefix = {
        "question": "ques_fig",
        "solution": "sol_fig",
    }.get(kind)
    if prefix is None:
        return jsonify({"success": False, "error": "kind must be 'question' or 'solution'."}), 400

    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"success": False, "error": "Choose an image file."}), 400

    data = uploaded.read()
    if not data:
        return jsonify({"success": False, "error": "The selected image is empty."}), 400
    if len(data) > FIGURE_UPLOAD_MAX_BYTES:
        return jsonify({
            "success": False,
            "error": f"Image is too large. Maximum size is {FIGURE_UPLOAD_MAX_BYTES // (1024 * 1024)} MB."
        }), 413
    if not data.startswith(_PNG_SIGNATURE):
        return jsonify({"success": False, "error": "The uploaded image must be a PNG."}), 400

    folder = SOURCE_QUESTIONS / qid
    try:
        with _figure_upload_lock:
            folder.mkdir(parents=True, exist_ok=True)

            highest = 0
            pattern = re.compile(rf"^{re.escape(prefix)}(\d+)\.png$", re.IGNORECASE)
            for path in folder.iterdir():
                if not path.is_file():
                    continue
                match = pattern.fullmatch(path.name)
                if match:
                    highest = max(highest, int(match.group(1)))

            filename = f"{prefix}{highest + 1}.png"
            path = folder / filename
            path.write_bytes(data)
    except Exception as exc:
        return jsonify({"success": False, "error": f"Could not store image: {exc}"}), 500

    src = (Path("data") / "questions" / qid / filename).as_posix()
    return jsonify({
        "success": True,
        "filename": filename,
        "src": src,
    })


@app.get("/api/questions/<qid>/source")
def question_source(qid):
    qid = safe_id(qid)
    path = SOURCE_QUESTIONS / qid / "source.png"
    if not path.exists():
        abort(404)
    return send_from_directory(path.parent, path.name)


@app.get("/api/tags")
def tags_api():
    rows = db().execute("SELECT DISTINCT tag FROM question_tags ORDER BY lower(tag)").fetchall()
    return jsonify([r[0] for r in rows])


@app.get("/api/collections")
def collections_api():
    return jsonify(catalog_collections())


@app.get("/api/topics")
def topics_api():
    return jsonify(catalog_topics())


@app.post("/api/collections")
def create_collection():
    body = request.get_json(silent=True) or {}
    cid = str(body.get("id") or body.get("name") or "").strip().lower()
    name = str(body.get("name") or "").strip()
    if not cid or not name:
        return jsonify({"success": False, "error": "Collection name is required."}), 400
    try:
        db().execute("INSERT INTO collections(id, name) VALUES (?, ?)", (cid, name))
        db().commit()
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "error": "Collection ID already exists."}), 409
    return jsonify({"success": True})


@app.post("/api/collections/<cid>/sets")
def create_set(cid):
    body = request.get_json(silent=True) or {}
    sid = str(body.get("id") or body.get("name") or "").strip().lower()
    name = str(body.get("name") or "").strip()
    try:
        db().execute("INSERT INTO sets(id, collection_id, name) VALUES (?, ?, ?)", (sid, cid, name))
        db().commit()
    except sqlite3.IntegrityError as exc:
        return jsonify({"success": False, "error": str(exc)}), 409
    return jsonify({"success": True})


@app.put("/api/collections/<cid>")
def rename_collection(cid):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "Collection name is required."}), 400
    cur = db().execute("UPDATE collections SET name = ? WHERE id = ?", (name, cid))
    db().commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify({"success": True})


@app.put("/api/collections/<cid>/sets/<sid>")
def rename_set(cid, sid):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "Set name is required."}), 400
    cur = db().execute("UPDATE sets SET name = ? WHERE id = ? AND collection_id = ?", (name, sid, cid))
    db().commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify({"success": True})


@app.post("/api/topics")
def create_topic():
    body = request.get_json(silent=True) or {}
    tid = str(body.get("id") or body.get("name") or "").strip().lower()
    name = str(body.get("name") or "").strip()
    if not tid or not name:
        return jsonify({"success": False, "error": "Topic name required."}), 400
    try:
        db().execute("INSERT INTO topics(id, name) VALUES (?, ?)", (tid, name))
        db().commit()
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "error": "Topic ID exists."}), 409
    return jsonify({"success": True})


@app.post("/api/topics/<tid>/subtopics")
def create_subtopic(tid):
    body = request.get_json(silent=True) or {}
    sid = str(body.get("id") or body.get("name") or "").strip().lower()
    name = str(body.get("name") or "").strip()
    try:
        db().execute("INSERT INTO subtopics(id, topic_id, name) VALUES (?, ?, ?)", (sid, tid, name))
        db().commit()
    except sqlite3.IntegrityError as exc:
        return jsonify({"success": False, "error": str(exc)}), 409
    return jsonify({"success": True})


@app.put("/api/topics/<tid>")
def rename_topic(tid):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    cur = db().execute("UPDATE topics SET name = ? WHERE id = ?", (name, tid))
    db().commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify({"success": True})


@app.put("/api/topics/<tid>/subtopics/<sid>")
def rename_subtopic(tid, sid):
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    cur = db().execute("UPDATE subtopics SET name = ? WHERE id = ? AND topic_id = ?", (name, sid, tid))
    db().commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify({"success": True})


_bulk_operation_lock = threading.Lock()
MAX_BULK_UPLOAD_BYTES = 50 * 1024 * 1024


def _run_bulk_json_script(script_name: str, uploaded_file, extra_args: list[str]):
    filename = (uploaded_file.filename or "").strip()
    if not filename:
        return jsonify({"success": False, "error": "Choose a JSON file."}), 400
    if not filename.lower().endswith(".json"):
        return jsonify({"success": False, "error": "Only .json files are supported."}), 400

    uploaded_file.stream.seek(0, 2)
    size = uploaded_file.stream.tell()
    uploaded_file.stream.seek(0)
    if size > MAX_BULK_UPLOAD_BYTES:
        return jsonify({
            "success": False,
            "error": f"JSON file is too large. Maximum size is {MAX_BULK_UPLOAD_BYTES // (1024 * 1024)} MB."
        }), 413

    script_path = ROOT / "utils" / script_name
    if not script_path.is_file():
        return jsonify({"success": False, "error": f"Bulk operation script not found: {script_name}"}), 500

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".json",
            prefix="tomato_bulk_",
            delete=False,
            dir=tempfile.gettempdir(),
        ) as tmp:
            temp_path = Path(tmp.name)
            uploaded_file.save(tmp)

        cmd = [
            sys.executable,
            str(script_path),
            "--json" if script_name == "delete_questions_from_json.py" else "--append-json",
            str(temp_path),
            "--db",
            str(DB),
            *extra_args,
        ]

        with _bulk_operation_lock:
            completed = subprocess.run(
                cmd,
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=300,
            )

        output = "\n".join(
            part for part in [completed.stdout.strip(), completed.stderr.strip()] if part
        ).strip()

        return jsonify({
            "success": completed.returncode == 0,
            "output": output,
            "returncode": completed.returncode,
            "filename": filename,
        }), (200 if completed.returncode == 0 else 400)

    except subprocess.TimeoutExpired:
        return jsonify({
            "success": False,
            "error": "The bulk operation timed out after 5 minutes."
        }), 504
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass


@app.post("/api/bulk/ingest-json")
def bulk_ingest_json():
    uploaded_file = request.files.get("file")
    if uploaded_file is None:
        return jsonify({"success": False, "error": "Choose a JSON file."}), 400
    return _run_bulk_json_script("migrate_json_to_sqlite.py", uploaded_file, [])


@app.post("/api/bulk/delete-json")
def bulk_delete_json():
    uploaded_file = request.files.get("file")
    if uploaded_file is None:
        return jsonify({"success": False, "error": "Choose a JSON file."}), 400
    return _run_bulk_json_script(
        "delete_questions_from_json.py",
        uploaded_file,
        ["--execute", "--backup"],
    )


@app.post("/api/questions/bulk-assign")
def bulk_assign():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids", [])
    cid = body.get("collection_id")
    sid = body.get("set_id")
    if not ids or not cid or not sid:
        return jsonify({"success": False, "error": "Select questions, collection and set."}), 400
    conn = db()
    if not conn.execute("SELECT 1 FROM sets WHERE id = ? AND collection_id = ?", (sid, cid)).fetchone():
        return jsonify({"success": False, "error": "Invalid collection/set."}), 400
    try:
        conn.execute("BEGIN")
        for raw_id in ids:
            qid = safe_id(str(raw_id))
            conn.execute("DELETE FROM question_collections WHERE question_id = ?", (qid,))
            conn.execute(
                "INSERT INTO question_collections(question_id, collection_id, set_id) VALUES (?, ?, ?)",
                (qid, cid, sid),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return jsonify({"success": True, "updated": len(ids)})


@app.route("/asset/<path:asset>")
def asset(asset):
    candidate = (ROOT / asset).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        abort(403)
    if not candidate.is_file():
        abort(404)
    return send_from_directory(candidate.parent, candidate.name)


# Serve built Vite assets after the explicit API/page routes above.
@app.route("/assets/<path:filename>")
def vite_asset(filename):
    return send_from_directory(FRONTEND / "assets", filename)


if __name__ == "__main__":
    init_db()
    print("TOMATO CMS: http://127.0.0.1:5000/cms")
    print("TOMATO Public: http://127.0.0.1:5000/")
    app.run(host="127.0.0.1", port=5000, debug=True)
