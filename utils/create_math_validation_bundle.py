#!/usr/bin/env python3
"""
Create a lightweight ZIP containing only question.json and group.json files
for MathJax validation.

Expected project structure:

project/
├── data/
│   ├── questions/
│   │   ├── <UUID>/
│   │   │   └── question.json
│   │   └── ...
│   └── groups/
│       ├── <UUID>/
│       │   └── group.json
│       └── ...

The output ZIP contains:

questions/<UUID>/question.json
groups/<UUID>/group.json
manifest.json

No images, source crops, figures, or other project files are included.
"""

from pathlib import Path
import argparse
import json
import zipfile


def collect_json_files(base_dir: Path, filename: str):
    if not base_dir.is_dir():
        return []

    return sorted(
        p for p in base_dir.rglob(filename)
        if p.is_file()
    )


def build_bundle():
    questions_dir = Path("data/questions")
    groups_dir = Path("data/groups")

    question_files = collect_json_files(questions_dir, "question.json")
    group_files = collect_json_files(groups_dir, "group.json")

    if not question_files and not group_files:
        raise FileNotFoundError(
            "No question.json or group.json files were found under "
            f"{project_dir / 'data'}."
        )

    manifest = {
        "format": "math-validation-bundle-v1",
        "questions": len(question_files),
        "groups": len(group_files),
        "files": []
    }
    output_zip = Path("utils/math-validation-bundle.zip")
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(
        output_zip,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as zf:

        for path in question_files:
            rel = path.relative_to(questions_dir)
            archive_name = Path("questions") / rel
            zf.write(path, archive_name.as_posix())

            manifest["files"].append({
                "type": "question",
                "path": archive_name.as_posix(),
            })

        for path in group_files:
            rel = path.relative_to(groups_dir)
            archive_name = Path("groups") / rel
            zf.write(path, archive_name.as_posix())

            manifest["files"].append({
                "type": "group",
                "path": archive_name.as_posix(),
            })

        zf.writestr(
            "manifest.json",
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
            ) + "\n",
        )

    print(f"Created: {output_zip}")
    print(f"Questions: {len(question_files)}")
    print(f"Groups:    {len(group_files)}")
    print(f"Total JSON files: {len(question_files) + len(group_files)}")


def main():

    build_bundle()


if __name__ == "__main__":
    main()
