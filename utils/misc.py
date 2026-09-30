import csv
import sqlite3
from pathlib import Path
from datetime import datetime
import shutil


# ============================================================
# CONFIGURATION
# ============================================================

DB_PATH = Path(r"C:\xampp\htdocs\tomato_qb\data\question_bank.db")
CSV_PATH = Path(r"C:\xampp\htdocs\tomato_qb\topic_tagging.csv")

# Create a backup before making any changes
CREATE_BACKUP = True


# ============================================================
# MAIN
# ============================================================

def tag_questions_from_csv():

    if not DB_PATH.exists():
        raise FileNotFoundError(f"SQLite database not found: {DB_PATH}")

    if not CSV_PATH.exists():
        raise FileNotFoundError(f"CSV file not found: {CSV_PATH}")

    # --------------------------------------------------------
    # Backup database
    # --------------------------------------------------------

    if CREATE_BACKUP:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = DB_PATH.with_name(
            f"{DB_PATH.stem}_backup_{timestamp}{DB_PATH.suffix}"
        )

        shutil.copy2(DB_PATH, backup_path)
        print(f"Database backup created:")
        print(f"  {backup_path}")
        print()

    # --------------------------------------------------------
    # Read CSV
    # --------------------------------------------------------

    mappings = []

    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)

        header = next(reader, None)

        if header is None:
            raise ValueError("CSV is empty.")

        for row_number, row in enumerate(reader, start=2):

            if len(row) != 2:
                raise ValueError(
                    f"CSV row {row_number} must contain exactly 2 columns. "
                    f"Found {len(row)}."
                )

            tag_pair = row[0].strip()
            topic_pair = row[1].strip()

            tags = [x.strip() for x in tag_pair.split("|")]
            topic_ids = [x.strip() for x in topic_pair.split("|")]

            if len(tags) != 2:
                raise ValueError(
                    f"CSV row {row_number}: expected two tags separated by '|'. "
                    f"Got: {tag_pair!r}"
                )

            if len(topic_ids) != 2:
                raise ValueError(
                    f"CSV row {row_number}: expected topic_id|subtopic_id. "
                    f"Got: {topic_pair!r}"
                )

            tag1, tag2 = tags
            topic_id, subtopic_id = topic_ids

            if not tag1 or not tag2:
                raise ValueError(
                    f"CSV row {row_number}: tags cannot be empty."
                )

            if not topic_id or not subtopic_id:
                raise ValueError(
                    f"CSV row {row_number}: topic_id and subtopic_id cannot be empty."
                )

            mappings.append({
                "row": row_number,
                "tag1": tag1,
                "tag2": tag2,
                "topic_id": topic_id,
                "subtopic_id": subtopic_id,
            })

    print(f"Loaded {len(mappings)} CSV mappings.")
    print()

    # --------------------------------------------------------
    # Connect to SQLite
    # --------------------------------------------------------

    conn = sqlite3.connect(DB_PATH)

    try:
        conn.execute("PRAGMA foreign_keys = ON")

        # Verify required tables exist
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }

        required_tables = {"question_tags", "question_topics"}

        missing = required_tables - tables

        if missing:
            raise RuntimeError(
                "Missing required SQLite table(s): "
                + ", ".join(sorted(missing))
            )

        total_matched = 0
        total_inserted = 0

        # ----------------------------------------------------
        # Process each CSV row
        # ----------------------------------------------------

        for mapping in mappings:

            tag1 = mapping["tag1"]
            tag2 = mapping["tag2"]
            topic_id = mapping["topic_id"]
            subtopic_id = mapping["subtopic_id"]

            # Find questions that contain BOTH tags.
            #
            # COUNT(DISTINCT tag) = 2 ensures that both tags
            # are present on the same question.
            #
            # Exact tag matching is intentional.
            #

            matched_questions = conn.execute(
                """
                SELECT question_id
                FROM question_tags
                WHERE tag IN (?, ?)
                GROUP BY question_id
                HAVING COUNT(DISTINCT tag) = 2
                """,
                (tag1, tag2)
            ).fetchall()

            question_ids = [row[0] for row in matched_questions]

            total_matched += len(question_ids)

            inserted_for_row = 0

            for question_id in question_ids:

                # Insert only if this exact mapping does not
                # already exist.

                cursor = conn.execute(
                    """
                    INSERT INTO question_topics
                        (question_id, topic_id, subtopic_id)
                    SELECT ?, ?, ?
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM question_topics
                        WHERE question_id = ?
                          AND topic_id = ?
                          AND subtopic_id = ?
                    )
                    """,
                    (
                        question_id,
                        topic_id,
                        subtopic_id,
                        question_id,
                        topic_id,
                        subtopic_id,
                    )
                )

                if cursor.rowcount == 1:
                    inserted_for_row += 1

            total_inserted += inserted_for_row

            print(
                f"{tag1} + {tag2}"
                f"  →  {topic_id} / {subtopic_id}"
            )

            print(
                f"    Questions matched: {len(question_ids):>4}"
                f" | New mappings added: {inserted_for_row:>4}"
            )

        # ----------------------------------------------------
        # Commit
        # ----------------------------------------------------

        conn.commit()

        print()
        print("=" * 65)
        print("COMPLETED")
        print("=" * 65)
        print(f"CSV mappings processed : {len(mappings)}")
        print(f"Questions matched      : {total_matched}")
        print(f"New topic mappings     : {total_inserted}")
        print()

    except Exception:
        conn.rollback()
        print()
        print("ERROR: No changes were committed.")
        raise

    finally:
        conn.close()


if __name__ == "__main__":
    tag_questions_from_csv()