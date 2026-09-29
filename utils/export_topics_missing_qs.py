#!/usr/bin/env python3
# 

import csv
import json
import sys
from pathlib import Path


def first_value(obj, *keys):
    for key in keys:
        value = obj.get(key)
        if value is not None:
            return value
    return ""


def export_topics(topic_file: Path, output_csv: Path) -> None:
    with topic_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Support either:
    # { "topics": [...] }
    # or a bare [...]
    topics = data.get("topics", []) if isinstance(data, dict) else data

    rows = []

    for topic in topics:
        if not isinstance(topic, dict):
            continue

        topic_name = first_value(topic, "name", "title", "topic")
        topic_id = first_value(topic, "id", "topic_id")

        subtopics = topic.get("subtopics", []) or []

        # Keep a topic even when it has no subtopics.
        if not subtopics:
            rows.append({
                "topic": topic_name,
                "topic_id": topic_id,
                "subtopic": "",
                "subtopic_id": "",
            })
            continue

        for subtopic in subtopics:
            if not isinstance(subtopic, dict):
                continue

            rows.append({
                "topic": topic_name,
                "topic_id": topic_id,
                "subtopic": first_value(subtopic, "name", "title", "subtopic"),
                "subtopic_id": first_value(subtopic, "id", "subtopic_id"),
            })

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    with output_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["topic", "topic_id", "subtopic", "subtopic_id"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Exported {len(rows)} topic/subtopic rows to {output_csv}")


def load_topic_mappings(mapping_file: Path) -> dict:
    if not mapping_file.is_file():
        raise FileNotFoundError(f"Topic mapping file not found: {mapping_file}")

    with mapping_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    return {
        item.get("uuid"): item.get("mappings", []) or []
        for item in data.get("mappings", [])
        if item.get("uuid")
    }


def export_questions(
    questions_dir: Path,
    output_csv: Path,
    topic_mapping_file: Path = Path("data/mappings/question_topics.json"),
) -> None:
    rows = []
    topic_mappings = load_topic_mappings(topic_mapping_file)

    for path in sorted(questions_dir.rglob("question.json")):
        try:
            with path.open("r", encoding="utf-8") as f:
                q = json.load(f)
        except Exception as e:
            print(f"WARNING: Could not read {path}: {e}", file=sys.stderr)
            continue

        uuid = q.get("id", path.parent.name)

        # Export only questions with no topic mapping.
        if topic_mappings.get(uuid):
            continue

        rows.append({
            "uuid": uuid,
            "type": q.get("type", ""),
            "question": q.get("question", ""),
            "options": json.dumps(
                q.get("options", {}) or {},
                ensure_ascii=False,
                separators=(",", ":")
            ),
        })

    output_csv.parent.mkdir(parents=True, exist_ok=True)

    with output_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["uuid", "type", "question", "options"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Exported {len(rows)} unmapped questions to {output_csv}")

def main():
    # if len(sys.argv) != 3:
    #     print(
    #         "Usage: python export_topics_table.py "
    #         "<topic.json> <output.csv>"
    #     )
    #     sys.exit(1)

    # topic_file = Path(sys.argv[1])
    # output_csv = Path(sys.argv[2])

    topic_file = Path("data/topics.json")
    output_csv = Path("utils/topics.csv")

    if not topic_file.is_file():
        print(f"ERROR: File not found: {topic_file}", file=sys.stderr)
        sys.exit(1)

    export_topics(topic_file, output_csv)

    questions_dir = Path("data/questions")
    output_csv = Path("utils/questions.csv")

    if not questions_dir.is_dir():
        print(f"ERROR: Directory not found: {questions_dir}", file=sys.stderr)
        sys.exit(1)

    export_questions(questions_dir, output_csv)


if __name__ == "__main__":
    main()
