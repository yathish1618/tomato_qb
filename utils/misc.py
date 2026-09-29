from pathlib import Path
import json
import csv


def get_unique_question_types(questions_dir="data/questions"):
    types = set()

    for question_file in Path(questions_dir).glob("*/question.json"):
        try:
            with question_file.open("r", encoding="utf-8") as f:
                data = json.load(f)

            q_type = data.get("type")
            if q_type:
                types.add(q_type)

        except (json.JSONDecodeError, OSError) as e:
            print(f"Skipping {question_file}: {e}")

    return sorted(types)

def get_unique_tags(questions_dir="data/questions"):
    tags = set()

    for question_file in Path(questions_dir).glob("*/question.json"):
        try:
            with question_file.open("r", encoding="utf-8") as f:
                data = json.load(f)

            for tag in data.get("tags", []) or []:
                if tag:
                    tags.add(tag)

        except (json.JSONDecodeError, OSError) as e:
            print(f"Skipping {question_file}: {e}")

    return sorted(tags)


def update_question_collections_from_tags(
    tags,
    questions_dir="data/questions",
    mapping_file="data/mappings/question_collections.json",
):
    questions_dir = Path(questions_dir)
    mapping_file = Path(mapping_file)

    # Load existing collection mappings
    with mapping_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    mappings = data.setdefault("mappings", [])

    # UUID -> mapping entry for quick lookup
    mapping_by_uuid = {
        item["uuid"]: item
        for item in mappings
        if item.get("uuid")
    }

    updated = 0

    for tag in tags:
        for question_file in questions_dir.glob("*/question.json"):
            try:
                with question_file.open("r", encoding="utf-8") as f:
                    question = json.load(f)

                question_tags = question.get("tags", []) or []

                if tag not in question_tags:
                    continue

                uuid = question.get("id")
                if not uuid:
                    continue

                # Create mapping entry if it doesn't exist
                if uuid not in mapping_by_uuid:
                    entry = {
                        "uuid": uuid,
                        "mappings": []
                    }
                    mappings.append(entry)
                    mapping_by_uuid[uuid] = entry

                entry = mapping_by_uuid[uuid]
                q_mappings = entry.setdefault("mappings", [])

                # Check whether this exact ISI → tag mapping already exists
                existing = next(
                    (
                        m for m in q_mappings
                        if m.get("collection_id") == "isi"
                        and m.get("set_id") == tag
                    ),
                    None
                )

                if not existing:
                    q_mappings.append({
                        "collection_id": "isi",
                        "set_id": tag
                    })
                    updated += 1

            except (json.JSONDecodeError, OSError) as e:
                print(f"Skipping {question_file}: {e}")

    # Save
    with mapping_file.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Added {updated} collection mappings.")



def update_question_topics_from_json(
    input_json,
    mapping_file="data/mappings/question_topics.json",
):
    input_json = Path(input_json)
    mapping_file = Path(mapping_file)

    # Input format:
    # [
    #   {
    #     "uuid": "...",
    #     "mappings": [...]
    #   },
    #   {
    #     "uuid": "...",
    #     "mappings": null
    #   }
    # ]

    with input_json.open("r", encoding="utf-8") as f:
        incoming = json.load(f)

    if not isinstance(incoming, list):
        raise ValueError("Input JSON must be a list of UUID mapping objects.")

    # Load existing canonical mapping file.
    if mapping_file.exists():
        with mapping_file.open("r", encoding="utf-8") as f:
            existing_data = json.load(f)
    else:
        existing_data = {"mappings": []}

    if not isinstance(existing_data, dict):
        raise ValueError("question_topics.json must contain an object.")

    existing = existing_data.setdefault("mappings", [])

    # UUID -> existing entry
    by_uuid = {}

    for item in existing:
        uuid = item.get("uuid")
        if uuid:
            by_uuid[uuid] = item

    seen = set()
    updated = 0

    for item in incoming:
        uuid = item.get("uuid")

        if not uuid:
            raise ValueError("Encountered an input record without a UUID.")

        if uuid in seen:
            raise ValueError(f"Duplicate UUID in input JSON: {uuid}")

        seen.add(uuid)

        # IMPORTANT:
        # null means explicitly unmapped.
        mappings = item.get("mappings")
        if mappings is None:
            mappings = []

        if not isinstance(mappings, list):
            raise ValueError(
                f"Invalid mappings for UUID {uuid}: expected list or null."
            )

        if uuid in by_uuid:
            # Replace existing mapping completely.
            by_uuid[uuid]["mappings"] = mappings
        else:
            new_entry = {
                "uuid": uuid,
                "mappings": mappings,
            }
            existing.append(new_entry)
            by_uuid[uuid] = new_entry

        updated += 1

    # Write canonical file.
    with mapping_file.open("w", encoding="utf-8") as f:
        json.dump(existing_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Updated {updated} UUID mappings.")



def export_unmapped_collection_questions(
    questions_dir="data/questions",
    mapping_file="data/mappings/question_collections.json",
    output_file="utils/unmapped_questions.csv",
):
    with open(mapping_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    mapped = {
        item["uuid"]
        for item in data.get("mappings", [])
        if item.get("uuid") and item.get("mappings")
    }

    uuids = []

    for path in Path(questions_dir).glob("*/question.json"):
        with open(path, "r", encoding="utf-8") as f:
            q = json.load(f)

        uuid = q.get("id")
        if uuid and uuid not in mapped:
            uuids.append(uuid)

    with open(output_file, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["uuid"])
        writer.writerows([[uuid] for uuid in sorted(uuids)])

    print(f"Exported {len(uuids)} unmapped UUIDs to {output_file}")

# ts = ['bstat-bmath-uga-2015',
# 'bstat-bmath-uga-2016',
# 'bstat-bmath-uga-2017',
# 'bstat-bmath-uga-2018',
# 'bstat-bmath-uga-2019',
# 'bstat-bmath-uga-2020',
# 'bstat-bmath-uga-2021',
# 'bstat-bmath-uga-2022',
# 'bstat-bmath-uga-2023',
# 'bstat-bmath-uga-2024','bstat-bmath-uga-2025',
# 'bstat-bmath-uga-2026',
# 'bstat-bmath-ugb-2015',
# 'bstat-bmath-ugb-2016',
# 'bstat-bmath-ugb-2017',
# 'bstat-bmath-ugb-2018',
# 'bstat-bmath-ugb-2019',
# 'bstat-bmath-ugb-2020',
# 'bstat-bmath-ugb-2021',
# 'bstat-bmath-ugb-2022',
# 'bstat-bmath-ugb-2023',
# 'bstat-bmath-ugb-2024','bstat-bmath-ugb-2025',
# 'bstat-bmath-ugb-2026']

# update_question_collections_from_tags(ts)

# print(get_unique_tags())

update_question_topics_from_json(
    "utils/topic_mapping.json"
)

# export_unmapped_collection_questions()