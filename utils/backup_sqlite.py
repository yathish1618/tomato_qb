#!/usr/bin/env python3
"""Create a consistent SQLite backup using SQLite's online backup API."""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


def backup_database(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)

    src = sqlite3.connect(source)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    print(f"Backup created: {destination}")


def main():
    parser = argparse.ArgumentParser(description="Back up a SQLite database safely.")
    parser.add_argument("--db", default="data/question_bank.db")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    backup_database(Path(args.db).resolve(), Path(args.output).resolve())


if __name__ == "__main__":
    main()
