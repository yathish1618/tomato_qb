from flask import Flask, jsonify, request, send_from_directory, abort
from pathlib import Path
from datetime import datetime
import json, shutil, tempfile, os, re

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
QUESTIONS = DATA / "questions"
BACKUPS = ROOT / "backups" / "questions"
FRONTEND = ROOT / "frontend"
COLLECTIONS_FILE = DATA / "collections.json"
TOPICS_FILE = DATA / "topics.json"
MAPPINGS = DATA / "mappings"
QUESTION_TOPICS_FILE = MAPPINGS / "question_topics.json"
QUESTION_COLLECTIONS_FILE = MAPPINGS / "question_collections.json"
GROUPS = DATA / "groups"

app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")

ALLOWED_GRADES = {str(i) for i in range(1, 13)} | {"12+"}
ALLOWED_TYPES = {"MCQ", "SUBJECTIVE", "GROUP"}


def safe_id(qid):
    if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", qid):
        abort(400)
    return qid


def qpath(qid):
    return QUESTIONS / safe_id(qid) / "question.json"


def group_path(gid):
    gid = safe_id(gid)
    candidates = [
        GROUPS / gid / "group.json",
        GROUPS / f"{gid}.json",
        DATA / "groups" / gid / "group.json",
        DATA / "groups" / f"{gid}.json",
        QUESTIONS / gid / "group.json",
    ]
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".json-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def load_collections():
    if not COLLECTIONS_FILE.exists():
        return {"collections": []}
    data = read_json(COLLECTIONS_FILE)
    if not isinstance(data, dict) or not isinstance(data.get("collections"), list):
        return {"collections": []}
    return data


def save_collections(data):
    write_json_atomic(COLLECTIONS_FILE, data)



def load_topics():
    if not TOPICS_FILE.exists():
        return {"topics": []}
    data = read_json(TOPICS_FILE)
    if not isinstance(data, dict) or not isinstance(data.get("topics"), list):
        return {"topics": []}
    return data

def save_topics(data):
    write_json_atomic(TOPICS_FILE, data)

def load_question_topics():
    if not QUESTION_TOPICS_FILE.exists():
        return {}

    data = read_json(QUESTION_TOPICS_FILE)
    result = {}

    for item in data.get("mappings", []):
        uuid = item.get("uuid")
        mappings = item.get("mappings", [])

        if uuid:
            result[uuid] = mappings

    return result


def load_question_collections():
    if not QUESTION_COLLECTIONS_FILE.exists():
        return {}

    data = read_json(QUESTION_COLLECTIONS_FILE)
    result = {}

    for item in data.get("mappings", []):
        uuid = item.get("uuid")
        mappings = item.get("mappings", [])

        if uuid:
            result[uuid] = mappings

    return result

def validate_topic_mappings(mappings):
    if not isinstance(mappings, list):
        raise ValueError("topics must be an array.")
    topics_by_id = {x.get("id"): x for x in load_topics().get("topics", []) if x.get("id")}
    for m in mappings:
        if not isinstance(m, dict): raise ValueError("Each topic mapping must be an object.")
        tid, sid = m.get("topic_id"), m.get("subtopic_id")
        if not tid or not sid: raise ValueError("Each topic mapping must contain topic_id and subtopic_id.")
        topic = topics_by_id.get(tid)
        if not topic: raise ValueError(f"Unknown topic_id: {tid}")
        valid = {s.get("id") for s in topic.get("subtopics", []) if s.get("id")}
        if sid not in valid: raise ValueError(f"subtopic_id '{sid}' does not belong to topic '{tid}'.")

def validate_collection_mappings(mappings):
    if not isinstance(mappings, list): raise ValueError("collections must be an array.")
    cm, smap = collection_map(), set_map()
    for m in mappings:
        if not isinstance(m, dict): raise ValueError("Each collection mapping must be an object.")
        cid, sid = m.get("collection_id"), m.get("set_id")
        if not cid or not sid: raise ValueError("Each collection mapping must contain collection_id and set_id.")
        if cid not in cm: raise ValueError(f"Unknown collection_id: {cid}")
        info = smap.get(sid)
        if not info: raise ValueError(f"Unknown set_id: {sid}")
        if info[0] != cid: raise ValueError(f"set_id '{sid}' does not belong to collection_id '{cid}'.")

def update_question_mapping(file_path, qid, mappings):
    data = read_json(file_path) if file_path.exists() else {"version": 1, "mappings": []}
    if not isinstance(data, dict): data = {"version": 1, "mappings": []}
    entries = data.setdefault("mappings", [])
    if not isinstance(entries, list): entries = []; data["mappings"] = entries
    existing = next((x for x in entries if x.get("uuid") == qid), None)
    if existing is None: entries.append({"uuid": qid, "mappings": mappings})
    else: existing["mappings"] = mappings
    write_json_atomic(file_path, data)

def slugify(value):
    s = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return s or "item"


def collection_map():
    data = load_collections()
    return {c.get("id"): c for c in data["collections"] if c.get("id")}


def set_map():
    result = {}
    for c in load_collections()["collections"]:
        for s in c.get("sets", []):
            if s.get("id"):
                result[s["id"]] = (c["id"], s)
    return result


def validate_question(data, expected_id):
    if data.get("id") != expected_id: return "Question ID cannot be changed."
    if data.get("type") not in ALLOWED_TYPES: return "Invalid question type."
    grade = data.get("grade")
    if grade is not None and grade != "" and str(grade) not in ALLOWED_GRADES: return "Invalid grade."
    if not isinstance(data.get("tags", []), list): return "Tags must be an array."
    if data.get("type") == "MCQ" and not isinstance(data.get("options"), dict): return "MCQ options must be an object."
    try:
        validate_topic_mappings(data.get("topics", []))
        validate_collection_mappings(data.get("collections", []))
    except ValueError as exc: return str(exc)
    return None

def build_index():
    rows = []

    topic_map = load_question_topics()
    collection_map_data = load_question_collections()

    for p in sorted(QUESTIONS.glob("*/question.json")):
        try:
            q = read_json(p)
            rows.append({
                "id": q.get("id"),
                "type": q.get("type"),
                "group_id": q.get("group_id"),
                "preview": q.get("question", ""),
                "question_number": q.get("source", {}).get("question_number"),
                "pages": q.get("source", {}).get("pages", []),
                "review_status": q.get("review_status", "NEEDS_REVIEW"),
                "publication_status": q.get("publication_status", "DRAFT"),
                "grade": q.get("grade", ""),
                "difficulty": q.get("difficulty", ""),
                "marks": q.get("marks", 1),
                "tags": q.get("tags", []),
                "topics": topic_map.get(q.get("id"), []),
                "collections": collection_map_data.get(q.get("id"), []),
            })
        except Exception:
            continue
    return rows


def backup_question(qid, old):
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_dir = BACKUPS / qid
    backup_dir.mkdir(parents=True, exist_ok=True)
    (backup_dir / f"{stamp}.json").write_text(
        json.dumps(old, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@app.get("/")
def public_home():
    return send_from_directory(FRONTEND, "public.html")


@app.get("/cms")
def cms_home():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/topics")
def topics_page():
    return send_from_directory(FRONTEND, "topics.html")

@app.get("/collections")
def collections_page():
    return send_from_directory(FRONTEND, "collections.html")

@app.get("/api/questions")
def questions():
    return jsonify({"questions": build_index()})


@app.get("/api/groups/<gid>")
def get_group(gid):
    p = group_path(gid)
    if not p.exists():
        abort(404)
    group = read_json(p)
    if not isinstance(group, dict):
        abort(500)
    return jsonify(group)


@app.get("/api/questions/<qid>/source")
def question_source(qid):
    p = QUESTIONS / safe_id(qid) / "source.png"
    if not p.exists():
        abort(404)
    return send_from_directory(p.parent, p.name)


@app.get("/api/questions/<qid>")
def get_question(qid):
    p = qpath(qid)
    if not p.exists():
        abort(404)

    question = read_json(p)

    topic_map = load_question_topics()
    collection_map_data = load_question_collections()

    question["topics"] = topic_map.get(qid, [])
    question["collections"] = collection_map_data.get(qid, [])

    return jsonify(question)


@app.put("/api/questions/<qid>")
def save_question(qid):
    p = qpath(qid)
    if not p.exists(): abort(404)
    data = request.get_json(silent=True)
    if not isinstance(data, dict): return jsonify({"success": False, "error": "Invalid JSON body."}), 400
    topics = data.get("topics", [])
    collections = data.get("collections", [])
    err = validate_question(data, qid)
    if err: return jsonify({"success": False, "error": err}), 400
    question_data = dict(data)
    question_data.pop("topics", None)
    question_data.pop("collections", None)
    old = read_json(p)
    backup_question(qid, old)
    write_json_atomic(p, question_data)
    update_question_mapping(QUESTION_TOPICS_FILE, qid, topics)
    update_question_mapping(QUESTION_COLLECTIONS_FILE, qid, collections)
    return jsonify({"success": True})


@app.get("/api/topics")
def topics_api():
    return jsonify(load_topics())

@app.post("/api/topics")
def create_topic():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Topic name required."}), 400
    data = load_topics()
    cid = slugify(body.get("id") or name)
    if any(c.get("id") == cid for c in data["topics"]):
        return jsonify({"success": False, "error": "Topic ID exists."}), 409
    data["topics"].append({"id": cid, "name": name, "subtopics": []})
    save_topics(data)
    return jsonify({"success": True, "topic": data["topics"][-1]})

@app.post("/api/topics/<cid>/subtopics")
def create_subtopic(cid):
    data = load_topics()
    topic = next((c for c in data["topics"] if c.get("id") == cid), None)
    if not topic: return jsonify({"success": False, "error": "Topic not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name: return jsonify({"success": False, "error": "Subtopic name required."}), 400
    sid = slugify(body.get("id") or name)
    if any(s.get("id") == sid for c in data["topics"] for s in c.get("subtopics", [])):
        return jsonify({"success": False, "error": "Subtopic ID exists."}), 409
    new_sub = {"id": sid, "name": name}
    topic.setdefault("subtopics", []).append(new_sub)
    save_topics(data)
    return jsonify({"success": True, "subtopic": new_sub})

@app.put("/api/topics/<cid>")
def rename_topic(cid):
    data = load_topics()
    topic = next((c for c in data["topics"] if c.get("id") == cid), None)
    if not topic: return jsonify({"success": False, "error": "Topic not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name: return jsonify({"success": False, "error": "Topic name required."}), 400
    topic["name"] = name
    save_topics(data)
    return jsonify({"success": True})

@app.put("/api/topics/<cid>/subtopics/<sid>")
def rename_subtopic(cid, sid):
    data = load_topics()
    topic = next((c for c in data["topics"] if c.get("id") == cid), None)
    if not topic: return jsonify({"success": False, "error": "Topic not found."}), 404
    sub = next((s for s in topic.get("subtopics", []) if s.get("id") == sid), None)
    if not sub: return jsonify({"success": False, "error": "Subtopic not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name: return jsonify({"success": False, "error": "Subtopic name required."}), 400
    sub["name"] = name
    save_topics(data)
    return jsonify({"success": True})

@app.get("/api/collections")
def collections():
    return jsonify(load_collections())


@app.post("/api/collections")
def create_collection():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Collection name is required."}), 400
    data = load_collections()
    cid = slugify(body.get("id") or name)
    existing = {c.get("id") for c in data["collections"]}
    if cid in existing:
        return jsonify({"success": False, "error": "Collection ID already exists."}), 409
    data["collections"].append({"id": cid, "name": name, "sets": []})
    save_collections(data)
    return jsonify({"success": True, "collection": data["collections"][-1]})


@app.post("/api/collections/<cid>/sets")
def create_set(cid):
    data = load_collections()
    collection = next((c for c in data["collections"] if c.get("id") == cid), None)
    if not collection:
        return jsonify({"success": False, "error": "Collection not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Set name is required."}), 400
    sid = slugify(body.get("id") or name)
    if any(s.get("id") == sid for c in data["collections"] for s in c.get("sets", [])):
        return jsonify({"success": False, "error": "Set ID already exists."}), 409
    new_set = {"id": sid, "name": name}
    collection.setdefault("sets", []).append(new_set)
    save_collections(data)
    return jsonify({"success": True, "set": new_set})


@app.put("/api/collections/<cid>")
def rename_collection(cid):
    data = load_collections()
    collection = next((c for c in data["collections"] if c.get("id") == cid), None)
    if not collection:
        return jsonify({"success": False, "error": "Collection not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Collection name is required."}), 400
    collection["name"] = name
    save_collections(data)
    return jsonify({"success": True, "collection": collection})


@app.put("/api/collections/<cid>/sets/<sid>")
def rename_set(cid, sid):
    data = load_collections()
    collection = next((c for c in data["collections"] if c.get("id") == cid), None)
    if not collection:
        return jsonify({"success": False, "error": "Collection not found."}), 404
    item = next((s for s in collection.get("sets", []) if s.get("id") == sid), None)
    if not item:
        return jsonify({"success": False, "error": "Set not found."}), 404
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Set name is required."}), 400
    item["name"] = name
    save_collections(data)
    return jsonify({"success": True, "set": item})


@app.post("/api/questions/bulk-assign")
def bulk_assign():
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    collection_id = body.get("collection_id", "")
    set_id = body.get("set_id", "")
    if not isinstance(ids, list) or not ids:
        return jsonify({"success": False, "error": "No questions selected."}), 400
    if not collection_id or collection_id not in collection_map():
        return jsonify({"success": False, "error": "Select a valid collection."}), 400
    sm = set_map().get(set_id) if set_id else None
    if not sm or sm[0] != collection_id:
        return jsonify({"success": False, "error": "Select a valid set belonging to that collection."}), 400

    updated, missing, failed = 0, [], []
    for raw_id in ids:
        try:
            qid = safe_id(str(raw_id))
            p = qpath(qid)
            if not p.exists():
                missing.append(qid)
                continue
            q = read_json(p)
            old = dict(q)
            q["collections"] = [{"collection_id": collection_id, "set_id": set_id}]
            backup_question(qid, old)
            write_json_atomic(p, q)
            updated += 1
        except Exception as exc:
            failed.append({"id": str(raw_id), "error": str(exc)})
    return jsonify({"success": not failed, "updated": updated, "missing": missing, "failed": failed})





@app.get("/api/tags")
def tags():
    p = DATA / "tag_pool.json"
    return jsonify(read_json(p) if p.exists() else [])


@app.get("/asset/<path:asset>")
def asset(asset):
    candidate = (ROOT / asset).resolve()
    if ROOT not in candidate.parents and candidate != ROOT:
        abort(403)
    if not candidate.is_file():
        abort(404)
    return send_from_directory(candidate.parent, candidate.name)


if __name__ == "__main__":
    print("TOMATO CMS: http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
