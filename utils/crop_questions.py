from pathlib import Path
from PIL import Image


QUESTIONS_DIR = Path("questions")

# Three variants we want to visually compare.
TARGET_WIDTHS = [1200, 1000, 800]

# PNG compression level.
# 9 = maximum compression, still lossless.
PNG_COMPRESS_LEVEL = 9


def format_size(bytes_count):
    """Return a human-readable file size."""
    if bytes_count < 1024:
        return f"{bytes_count} B"

    if bytes_count < 1024 * 1024:
        return f"{bytes_count / 1024:.1f} KB"

    return f"{bytes_count / (1024 * 1024):.2f} MB"


def resize_image(source_path, output_path, target_width):
    """Resize while preserving aspect ratio."""

    with Image.open(source_path) as img:

        original_width, original_height = img.size

        # Already smaller than requested width.
        if original_width <= target_width:
            resized = img.copy()
        else:
            scale = target_width / original_width

            target_height = round(
                original_height * scale
            )

            resized = img.resize(
                (target_width, target_height),
                Image.LANCZOS,
            )

        # Save as optimized PNG.
        resized.save(
            output_path,
            format="PNG",
            optimize=True,
            compress_level=PNG_COMPRESS_LEVEL,
        )

        return (
            original_width,
            original_height,
            resized.width,
            resized.height,
        )


def main():

    if not QUESTIONS_DIR.exists():
        raise RuntimeError(
            f"Directory not found: {QUESTIONS_DIR}"
        )

    folders = sorted(
        path for path in QUESTIONS_DIR.iterdir()
        if path.is_dir()
    )

    if not folders:
        raise RuntimeError(
            f"No question folders found in {QUESTIONS_DIR}"
        )

    print("=" * 80)
    print("QUESTION IMAGE RESOLUTION TEST")
    print("=" * 80)
    print()

    total_original = 0
    total_outputs = {
        width: 0
        for width in TARGET_WIDTHS
    }

    for folder in folders:

        source_path = folder / "source.png"

        if not source_path.exists():
            print(f"[SKIP] {folder.name}: source.png not found")
            continue

        original_size = source_path.stat().st_size

        total_original += original_size

        print(f"{folder.name}")
        print("-" * 80)

        try:

            with Image.open(source_path) as img:
                original_width, original_height = img.size

            print(
                f"Original : "
                f"{original_width} × {original_height}    "
                f"{format_size(original_size)}"
            )

            for target_width in TARGET_WIDTHS:

                output_path = (
                    folder
                    / f"source_{target_width}.png"
                )

                (
                    ow,
                    oh,
                    nw,
                    nh,
                ) = resize_image(
                    source_path,
                    output_path,
                    target_width,
                )

                output_size = output_path.stat().st_size

                total_outputs[target_width] += output_size

                reduction = (
                    1
                    - output_size / original_size
                ) * 100

                print(
                    f"  {target_width:4d}px : "
                    f"{nw} × {nh}    "
                    f"{format_size(output_size):>10}    "
                    f"{reduction:5.1f}% smaller"
                )

        except Exception as e:

            print(
                f"  ERROR: {e}"
            )

        print()

    # --------------------------------------------------------
    # Overall results
    # --------------------------------------------------------

    print("=" * 80)
    print("TOTALS")
    print("=" * 80)

    print(
        f"Original total: "
        f"{format_size(total_original)}"
    )

    print()

    for width in TARGET_WIDTHS:

        total = total_outputs[width]

        reduction = (
            1 - total / total_original
        ) * 100

        print(
            f"{width:4d}px total: "
            f"{format_size(total):>10}    "
            f"{reduction:5.1f}% smaller"
        )


if __name__ == "__main__":
    main()