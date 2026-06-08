from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .config import load_config, parse_overrides
from .runner import run_automation
from .schedule import parse_delay_seconds, seconds_until_start_at, wait_before_start


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a configured browser sequence and save an Excel export.",
    )
    parser.add_argument("--config", default="automation_config.yaml", help="Path to YAML/JSON config file.")
    parser.add_argument("--headless", choices=("true", "false"), help="Override headless mode.")
    parser.add_argument("--download-dir", help="Override the folder where downloaded Excel files are saved.")
    start_group = parser.add_mutually_exclusive_group()
    start_group.add_argument(
        "--delay",
        help="Wait before starting automation. Examples: 30s, 10m, 2h. Plain numbers are seconds.",
    )
    start_group.add_argument(
        "--start-at",
        help="Start automation at the next HH:MM time in 24-hour format, for example 09:30.",
    )
    parser.add_argument(
        "--set",
        dest="overrides",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Override a top-level or dotted config value, e.g. --set steps.0.value=123 is not supported for lists.",
    )
    parser.add_argument("--verbose", action="store_true", help="Show detailed step logs.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    overrides = parse_overrides(args.overrides)
    if args.headless:
        overrides["headless"] = args.headless
    if args.download_dir:
        overrides["download_dir"] = str(Path(args.download_dir).expanduser())

    delay_seconds = parse_delay_seconds(args.delay) or seconds_until_start_at(args.start_at)
    if delay_seconds > 0:
        print(f"Waiting {delay_seconds} seconds before starting automation...")
        wait_before_start(delay_seconds)

    config = load_config(args.config, overrides=overrides)
    downloads = run_automation(config)

    if downloads:
        print("Downloaded files:")
        for path in downloads:
            print(path)
    else:
        print("Automation completed. No download_click step produced a file.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
