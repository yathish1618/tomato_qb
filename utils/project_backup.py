from pathlib import Path
import zipfile

from datetime import datetime

timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")

PROJECT_DIR = Path("../tomato_qb")
OUTPUT_ZIP = Path(f"../tomato_qb_{timestamp}.zip")

EXCLUDED_DIRS = {"questions", "groups", ".git", "node_modules"}


def create_backup():
    project_dir = PROJECT_DIR.resolve()

    with zipfile.ZipFile(
        OUTPUT_ZIP,
        "w",
        compression=zipfile.ZIP_DEFLATED
    ) as zf:

        for path in project_dir.rglob("*"):

            # Skip anything inside questions/ or groups/
            if any(
                part in EXCLUDED_DIRS
                for part in path.relative_to(project_dir).parts
            ):
                continue

            archive_path = path.relative_to(project_dir)

            if path.is_file():
                zf.write(path, archive_path)

        # Explicitly preserve the two empty directories
        for dirname in EXCLUDED_DIRS:
            folder = project_dir / dirname
            if folder.exists() and folder.is_dir():
                zf.writestr(dirname + "/", "")

    print(f"Backup created: {OUTPUT_ZIP.resolve()}")


if __name__ == "__main__":
    create_backup()