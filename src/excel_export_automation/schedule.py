from __future__ import annotations

import re
import time
from datetime import datetime, timedelta

_DELAY_PATTERN = re.compile(r"^\s*(\d+)\s*([smhd]?)\s*$", re.IGNORECASE)
_START_AT_PATTERN = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")
_UNITS_IN_SECONDS = {
    "": 1,
    "s": 1,
    "m": 60,
    "h": 60 * 60,
    "d": 24 * 60 * 60,
}


def parse_delay_seconds(value: str | None) -> int:
    if not value:
        return 0

    match = _DELAY_PATTERN.match(value)
    if not match:
        raise ValueError("Delay must be a number with optional unit: s, m, h or d, for example 30s, 10m, 2h.")

    amount = int(match.group(1))
    unit = match.group(2).lower()
    return amount * _UNITS_IN_SECONDS[unit]


def seconds_until_start_at(value: str | None, now: datetime | None = None) -> int:
    if not value:
        return 0

    match = _START_AT_PATTERN.match(value)
    if not match:
        raise ValueError("Start time must have HH:MM format, for example 09:30.")

    hour = int(match.group(1))
    minute = int(match.group(2))
    if hour > 23 or minute > 59:
        raise ValueError("Start time must be a valid 24-hour time from 00:00 to 23:59.")

    current = now or datetime.now()
    target = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= current:
        target += timedelta(days=1)
    return int((target - current).total_seconds())


def wait_before_start(delay_seconds: int) -> None:
    if delay_seconds <= 0:
        return
    time.sleep(delay_seconds)
