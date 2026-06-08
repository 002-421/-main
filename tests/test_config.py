from pathlib import Path

import pytest

from excel_export_automation.config import parse_config, parse_overrides
from excel_export_automation.runner import _download_filename


def test_parse_config_validates_and_resolves_download_dir(tmp_path: Path) -> None:
    config = parse_config(
        {
            "site_name": "test",
            "headless": "false",
            "download_dir": "out",
            "steps": [
                {"action": "goto", "url": "https://example.com"},
                {"action": "download_click", "selector": "#export"},
            ],
        },
        base_dir=tmp_path,
    )

    assert config.site_name == "test"
    assert config.headless is False
    assert config.download_dir == tmp_path / "out"
    assert len(config.steps) == 2


def test_parse_config_rejects_missing_required_field() -> None:
    with pytest.raises(ValueError, match="requires field 'selector'"):
        parse_config({"steps": [{"action": "click"}]})


def test_parse_overrides_requires_key_value_format() -> None:
    with pytest.raises(ValueError, match="KEY=VALUE"):
        parse_overrides(["headless"])


def test_download_filename_sanitizes_and_keeps_extension() -> None:
    filename = _download_filename(
        {"save_as": "отчет продаж {timestamp}.xlsx"},
        default_name=None,
        suggested_name="download.xlsx",
    )

    assert filename.startswith("отчет_продаж_")
    assert filename.endswith(".xlsx")
