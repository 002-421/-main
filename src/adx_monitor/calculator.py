from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

Signal = Literal["BUY", "SELL", "HOLD"]


@dataclass(frozen=True)
class Candle:
    time: str
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class AdxPoint:
    time: str
    plus_di: float | None
    minus_di: float | None
    adx: float | None
    signal: Signal


def calculate_adx(candles: Iterable[Candle], period: int = 14, threshold: float = 20.0) -> list[AdxPoint]:
    """Calculate Wilder ADX values and simple DI-cross trading signals.

    BUY appears when +DI crosses above -DI while ADX is at or above ``threshold``.
    SELL appears when -DI crosses above +DI while ADX is at or above ``threshold``.
    Other rows are marked HOLD.
    """
    rows = list(candles)
    if period < 2:
        raise ValueError("ADX period must be at least 2.")
    if len(rows) < period * 2:
        return [AdxPoint(row.time, None, None, None, "HOLD") for row in rows]

    true_ranges = [0.0]
    plus_dm = [0.0]
    minus_dm = [0.0]
    for current, previous in zip(rows[1:], rows[:-1]):
        up_move = current.high - previous.high
        down_move = previous.low - current.low
        plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0.0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0.0)
        true_ranges.append(max(current.high - current.low, abs(current.high - previous.close), abs(current.low - previous.close)))

    smoothed_tr = [None] * len(rows)
    smoothed_plus = [None] * len(rows)
    smoothed_minus = [None] * len(rows)
    plus_di: list[float | None] = [None] * len(rows)
    minus_di: list[float | None] = [None] * len(rows)
    dx: list[float | None] = [None] * len(rows)

    start = period
    smoothed_tr[start] = sum(true_ranges[1 : start + 1])
    smoothed_plus[start] = sum(plus_dm[1 : start + 1])
    smoothed_minus[start] = sum(minus_dm[1 : start + 1])

    for index in range(start, len(rows)):
        if index > start:
            assert smoothed_tr[index - 1] is not None
            assert smoothed_plus[index - 1] is not None
            assert smoothed_minus[index - 1] is not None
            smoothed_tr[index] = smoothed_tr[index - 1] - (smoothed_tr[index - 1] / period) + true_ranges[index]
            smoothed_plus[index] = smoothed_plus[index - 1] - (smoothed_plus[index - 1] / period) + plus_dm[index]
            smoothed_minus[index] = smoothed_minus[index - 1] - (smoothed_minus[index - 1] / period) + minus_dm[index]

        tr = smoothed_tr[index] or 0.0
        if tr == 0:
            plus_di[index] = 0.0
            minus_di[index] = 0.0
            dx[index] = 0.0
            continue
        plus_di[index] = 100 * (smoothed_plus[index] or 0.0) / tr
        minus_di[index] = 100 * (smoothed_minus[index] or 0.0) / tr
        di_sum = plus_di[index] + minus_di[index]
        dx[index] = 0.0 if di_sum == 0 else 100 * abs(plus_di[index] - minus_di[index]) / di_sum

    adx: list[float | None] = [None] * len(rows)
    first_adx_index = period * 2 - 1
    initial_dx = [value for value in dx[period : first_adx_index + 1] if value is not None]
    if len(initial_dx) == period:
        adx[first_adx_index] = sum(initial_dx) / period
        for index in range(first_adx_index + 1, len(rows)):
            assert adx[index - 1] is not None
            assert dx[index] is not None
            adx[index] = ((adx[index - 1] * (period - 1)) + dx[index]) / period

    points: list[AdxPoint] = []
    for index, row in enumerate(rows):
        signal: Signal = "HOLD"
        if index > 0 and adx[index] is not None and adx[index] >= threshold:
            previous_plus = plus_di[index - 1]
            previous_minus = minus_di[index - 1]
            current_plus = plus_di[index]
            current_minus = minus_di[index]
            if None not in (previous_plus, previous_minus, current_plus, current_minus):
                if previous_plus <= previous_minus and current_plus > current_minus:
                    signal = "BUY"
                elif previous_minus <= previous_plus and current_minus > current_plus:
                    signal = "SELL"
        points.append(AdxPoint(row.time, plus_di[index], minus_di[index], adx[index], signal))
    return points


def latest_signal(points: Iterable[AdxPoint]) -> AdxPoint | None:
    values = list(points)
    return values[-1] if values else None
