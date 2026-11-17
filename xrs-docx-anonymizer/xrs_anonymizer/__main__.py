import argparse
import json
from pathlib import Path

from .batch import BatchError, run_batch


def main():
    parser = argparse.ArgumentParser(description="XRS DOCX Anonymizer — автономная утилита")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--no-recursive", action="store_true")
    args = parser.parse_args()
    if args.source is None and args.output is None:
        from .gui import main as gui
        gui()
        return 0
    if args.source is None or args.output is None:
        parser.error("--source и --output нужно указать вместе")
    try:
        result = run_batch(args.source, args.output, recursive=not args.no_recursive)
        print(json.dumps(result, ensure_ascii=False))
        return 2 if result["BLOCKED"] else 0
    except BatchError as exc:
        print(str(exc))
    except Exception:
        print("Ошибка локальной обработки. Проверьте доступ к папкам и свободное место.")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
