from datetime import datetime

import pytest

from excel_export_automation.schedule import parse_delay_seconds, seconds_until_start_at


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, 0),
        ("15", 15),
        ("30s", 30),
        ("10m", 600),
        ("2h", 7200),
        ("1d", 86400),
    ],
)
def test_parse_delay_seconds(value: str | None, expected: int) -> None:
    assert parse_delay_seconds(value) == expected


def test_parse_delay_seconds_rejects_unknown_format() -> None:
    with pytest.raises(ValueError, match="Delay must be"):
        parse_delay_seconds("tomorrow")


def test_seconds_until_start_at_today() -> None:
    now = datetime(2026, 6, 8, 9, 0, 0)

    assert seconds_until_start_at("09:30", now=now) == 30 * 60


def test_seconds_until_start_at_rolls_to_next_day() -> None:
    now = datetime(2026, 6, 8, 9, 30, 0)

    assert seconds_until_start_at("09:30", now=now) == 24 * 60 * 60


def test_seconds_until_start_at_rejects_invalid_time() -> None:
    with pytest.raises(ValueError, match="valid 24-hour time"):
        seconds_until_start_at("25:00")
