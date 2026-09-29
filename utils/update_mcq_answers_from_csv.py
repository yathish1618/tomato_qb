from pathlib import Path
import csv
import json
from collections import defaultdict


def update_mcq_answers_from_csv(
    answer_csv,
    questions_dir="data/questions",
    collection_mapping_file="data/mappings/question_collections.json",
):
    """
    Update the `answer` field in individual MCQ question.json files
    using an answer-key CSV keyed by:

        collection_id + set_id + question number

    The question number is read from:

        question.json["source"]["question_number"]

    Collection/set membership is read from:

        data/mappings/question_collections.json

    A question is updated only when exactly ONE MCQ question matches
    the composite key.

    Multiple answers such as "A,D" are stored exactly as provided.
    """

    answer_csv = Path(answer_csv)
    questions_dir = Path(questions_dir)
    collection_mapping_file = Path(collection_mapping_file)

    # ------------------------------------------------------------
    # 1. Load answer key CSV
    # ------------------------------------------------------------

    answer_rows = []

    with answer_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        required_columns = {
            "collection_id",
            "set_id",
            "question",
            "answer",
        }

        missing = required_columns - set(reader.fieldnames or [])
        if missing:
            raise ValueError(
                f"Answer CSV is missing required columns: {sorted(missing)}"
            )

        for row_number, row in enumerate(reader, start=2):
            collection_id = (row.get("collection_id") or "").strip()
            set_id = (row.get("set_id") or "").strip()
            question_raw = (row.get("question") or "").strip()
            answer = (row.get("answer") or "").strip()

            if not collection_id or not set_id:
                print(
                    f"SKIP CSV row {row_number}: "
                    f"missing collection_id/set_id"
                )
                continue

            try:
                question_number = int(question_raw)
            except (TypeError, ValueError):
                print(
                    f"SKIP CSV row {row_number}: "
                    f"invalid question number: {question_raw!r}"
                )
                continue

            if not answer:
                print(
                    f"SKIP CSV row {row_number}: "
                    f"empty answer"
                )
                continue

            answer_rows.append({
                "csv_row": row_number,
                "collection_id": collection_id,
                "set_id": set_id,
                "question_number": question_number,
                "answer": answer,
            })

    # ------------------------------------------------------------
    # 2. Load question -> collection/set mappings
    # ------------------------------------------------------------

    with collection_mapping_file.open("r", encoding="utf-8") as f:
        mapping_data = json.load(f)

    if not isinstance(mapping_data, dict):
        raise ValueError(
            "question_collections.json must contain an object."
        )

    mapping_records = mapping_data.get("mappings", [])

    if not isinstance(mapping_records, list):
        raise ValueError(
            "question_collections.json['mappings'] must be a list."
        )

    # UUID -> set of (collection_id, set_id)
    question_collections = defaultdict(set)

    for record in mapping_records:
        uuid = record.get("uuid")
        mappings = record.get("mappings", [])

        if not uuid or not isinstance(mappings, list):
            continue

        for mapping in mappings:
            collection_id = mapping.get("collection_id")
            set_id = mapping.get("set_id")

            if collection_id and set_id:
                question_collections[uuid].add(
                    (str(collection_id), str(set_id))
                )

    # ------------------------------------------------------------
    # 3. Scan all question JSON files and build lookup index
    #
    #    lookup key:
    #        (collection_id, set_id, question_number)
    #
    #    value:
    #        list of question JSON paths
    #
    # ------------------------------------------------------------

    lookup = defaultdict(list)

    question_files = list(
        questions_dir.glob("*/question.json")
    )

    for question_file in question_files:

        try:
            with question_file.open("r", encoding="utf-8") as f:
                question = json.load(f)

        except (json.JSONDecodeError, OSError) as e:
            print(f"SKIP FILE {question_file}: {e}")
            continue

        uuid = question.get("id")

        if not uuid:
            print(
                f"SKIP FILE {question_file}: missing question ID"
            )
            continue

        # Only MCQs should receive answers from this answer key.
        if question.get("type") != "MCQ":
            continue

        # --------------------------------------------------------
        # Question number
        # --------------------------------------------------------

        source = question.get("source") or {}

        question_number = source.get("question_number")

        # Optional fallback if some legacy files have it top-level.
        if question_number is None:
            question_number = question.get("question_number")

        if question_number is None:
            continue

        try:
            question_number = int(question_number)
        except (TypeError, ValueError):
            continue

        # --------------------------------------------------------
        # Collection/set memberships
        # --------------------------------------------------------

        memberships = question_collections.get(uuid, set())

        if not memberships:
            continue

        for collection_id, set_id in memberships:
            key = (
                collection_id,
                set_id,
                question_number,
            )

            lookup[key].append(question_file)

    # ------------------------------------------------------------
    # 4. Process answer-key rows
    # ------------------------------------------------------------

    updated = 0
    skipped_no_match = 0
    skipped_multiple_matches = 0

    updated_files = []
    skipped = []

    for row in answer_rows:

        key = (
            row["collection_id"],
            row["set_id"],
            row["question_number"],
        )

        matches = lookup.get(key, [])

        # --------------------------------------------------------
        # No matching question
        # --------------------------------------------------------

        if len(matches) == 0:
            skipped_no_match += 1

            skipped.append({
                **row,
                "reason": "NO_MATCH",
            })

            continue

        # --------------------------------------------------------
        # Ambiguous: more than one question has same composite key
        # --------------------------------------------------------

        if len(matches) > 1:
            skipped_multiple_matches += 1

            skipped.append({
                **row,
                "reason": "MULTIPLE_MATCHES",
                "files": [str(p) for p in matches],
            })

            continue

        # --------------------------------------------------------
        # Exactly one match
        # --------------------------------------------------------

        question_file = matches[0]

        try:
            with question_file.open("r", encoding="utf-8") as f:
                question = json.load(f)

            # Store answer EXACTLY as provided by CSV.
            #
            # Examples:
            #   "A"
            #   "B"
            #   "A,D"
            #
            # We are intentionally NOT converting multi-answer
            # values into arrays yet.
            question["answer"] = row["answer"]

            with question_file.open("w", encoding="utf-8") as f:
                json.dump(
                    question,
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
                f.write("\n")

            updated += 1

            updated_files.append({
                "uuid": question.get("id"),
                "file": str(question_file),
                "collection_id": row["collection_id"],
                "set_id": row["set_id"],
                "question_number": row["question_number"],
                "answer": row["answer"],
            })

        except (json.JSONDecodeError, OSError) as e:
            skipped.append({
                **row,
                "reason": f"WRITE_ERROR: {e}",
            })

    # ------------------------------------------------------------
    # 5. Summary
    # ------------------------------------------------------------

    print()
    print("=" * 60)
    print("ANSWER KEY UPDATE SUMMARY")
    print("=" * 60)
    print(f"Answer-key rows:       {len(answer_rows)}")
    print(f"Updated:               {updated}")
    print(f"No match:              {skipped_no_match}")
    print(f"Multiple matches:      {skipped_multiple_matches}")
    print(f"Total skipped/issues:  {len(skipped)}")
    print("=" * 60)

    # Print ambiguous matches explicitly
    ambiguous = [
        item
        for item in skipped
        if item["reason"] == "MULTIPLE_MATCHES"
    ]

    if ambiguous:
        print()
        print("AMBIGUOUS MATCHES:")
        for item in ambiguous:
            print(
                f"  {item['collection_id']} / "
                f"{item['set_id']} / "
                f"Q{item['question_number']} -> "
                f"{item['files']}"
            )

    return {
        "answer_rows": len(answer_rows),
        "updated": updated,
        "skipped_no_match": skipped_no_match,
        "skipped_multiple_matches": skipped_multiple_matches,
        "skipped": skipped,
        "updated_files": updated_files,
    }

result = update_mcq_answers_from_csv(
    "utils/answer_key.csv"
)