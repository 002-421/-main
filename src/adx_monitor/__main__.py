from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

from .calculator import AdxPoint, Candle, calculate_adx, latest_signal


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Отслеживание осциллятора ADX по OHLC CSV-файлу.")
    parser.add_argument("--csv", required=True, help="Путь к CSV с колонками time, high, low, close.")
    parser.add_argument("--period", type=int, default=14, help="Период ADX по Wilder, по умолчанию 14.")
    parser.add_argument("--threshold", type=float, default=20.0, help="Уровень силы тренда, по умолчанию 20.")
    parser.add_argument("--watch", type=float, default=0, help="Повторять расчет каждые N секунд.")
    parser.add_argument("--tail", type=int, default=10, help="Сколько последних строк вывести.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    while True:
        points = calculate_adx(read_candles(Path(args.csv)), period=args.period, threshold=args.threshold)
        print_report(points, tail=args.tail)
        if args.watch <= 0:
            break
        time.sleep(args.watch)
    return 0


def read_candles(path: Path) -> list[Candle]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        required = {"time", "high", "low", "close"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV must contain columns: {', '.join(sorted(required))}. Missing: {', '.join(sorted(missing))}.")
        return [Candle(row["time"], float(row["high"]), float(row["low"]), float(row["close"])) for row in reader]


def print_report(points: list[AdxPoint], tail: int) -> None:
    visible = points[-tail:] if tail > 0 else points
    print("time,+DI,-DI,ADX,signal")
    for point in visible:
        print(
            f"{point.time},{_format(point.plus_di)},{_format(point.minus_di)},{_format(point.adx)},{point.signal}",
        )
    latest = latest_signal(points)
    if latest:
        print(f"Latest: {latest.time} ADX={_format(latest.adx)} signal={latest.signal}")


def _format(value: float | None) -> str:
    return "" if value is None else f"{value:.2f}"


if __name__ == "__main__":
    sys.exit(main())
