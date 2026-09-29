#!/usr/bin/env python3
"""Print useful record counts from the question-bank SQLite database."""
import argparse
import sqlite3


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="data/question_bank.db")
    args = p.parse_args()
    conn = sqlite3.connect(args.db)
    for table in ["questions", "groups", "collections", "sets", "topics", "subtopics", "question_topics", "question_collections", "question_tags"]:
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"{table:24} {n:>10}")
        except sqlite3.Error:
            pass
    conn.close()


if __name__ == "__main__":
    main()
