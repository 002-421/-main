"""Generate demonstrably synthetic local inputs. Never reads any clinical documents."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.fixtures import minimal, rich_fixture, write


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    parser.add_argument("--bulk", type=int, default=20)
    args = parser.parse_args()
    if not 0 <= args.bulk <= 10000:
        parser.error("--bulk должен быть от 0 до 10000")
    if args.destination.exists():
        parser.error("Папка уже существует; выберите новую папку.")
    args.destination.mkdir(parents=True)
    rich_fixture(args.destination / "SYNTHETIC-identities-images.docx")
    write(args.destination / "SYNTHETIC-review.docx", minimal("Сравнение от 11.12.2024. Иванов Иван."))
    (args.destination / "SYNTHETIC-corrupted.docx").write_bytes(b"SYNTHETIC_INVALID_ZIP")
    for i in range(args.bulk):
        write(args.destination / f"SYNTHETIC-{i:06d}.docx", minimal())
    print(f"Создано синтетических DOCX: {args.bulk + 3}")


if __name__ == "__main__":
    main()
