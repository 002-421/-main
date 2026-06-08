from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}")
_REQUIRED_STEP_FIELDS = {
    "goto": ("url",),
    "click": ("selector",),
    "fill": ("selector", "value"),
    "select": ("selector", "value"),
    "press": ("selector", "key"),
    "wait_for_selector": ("selector",),
    "wait_for_timeout": ("milliseconds",),
    "download_click": ("selector",),
    "screenshot": ("path",),
}
_SUPPORTED_ACTIONS = frozenset(_REQUIRED_STEP_FIELDS)


@dataclass(frozen=True)
class AutomationConfig:
    site_name: str
    headless: bool
    slow_mo_ms: int
    timeout_ms: int
    download_dir: Path
    default_excel_name: str | None
    steps: list[dict[str, Any]]


def load_config(path: str | Path, overrides: dict[str, str] | None = None) -> AutomationConfig:
    config_path = Path(path)
    raw = _load_raw_config(config_path)
    if overrides:
        raw = _apply_overrides(raw, overrides)
    expanded = _expand_env(raw)
    return parse_config(expanded, base_dir=config_path.parent)


def parse_config(raw: dict[str, Any], base_dir: Path | None = None) -> AutomationConfig:
    base_dir = base_dir or Path.cwd()
    steps = raw.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("Config must contain a non-empty 'steps' list.")

    normalized_steps = []
    for index, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise ValueError(f"Step #{index} must be a mapping/dict.")
        action = step.get("action")
        if action not in _SUPPORTED_ACTIONS:
            supported = ", ".join(sorted(_SUPPORTED_ACTIONS))
            raise ValueError(f"Step #{index} has unsupported action {action!r}. Supported: {supported}.")
        for field in _REQUIRED_STEP_FIELDS[action]:
            if field not in step or step[field] in (None, ""):
                raise ValueError(f"Step #{index} action {action!r} requires field {field!r}.")
        normalized_steps.append(dict(step))

    download_dir = Path(raw.get("download_dir", "downloads"))
    if not download_dir.is_absolute():
        download_dir = base_dir / download_dir

    return AutomationConfig(
        site_name=str(raw.get("site_name", "Excel export")),
        headless=_as_bool(raw.get("headless", True)),
        slow_mo_ms=int(raw.get("slow_mo_ms", 0)),
        timeout_ms=int(raw.get("timeout_ms", 30_000)),
        download_dir=download_dir,
        default_excel_name=raw.get("default_excel_name"),
        steps=normalized_steps,
    )


def parse_overrides(values: list[str] | None) -> dict[str, str]:
    overrides: dict[str, str] = {}
    for value in values or []:
        if "=" not in value:
            raise ValueError(f"Override {value!r} must have KEY=VALUE format.")
        key, item_value = value.split("=", 1)
        key = key.strip()
        if not key:
            raise ValueError(f"Override {value!r} has an empty key.")
        overrides[key] = item_value
    return overrides


def _load_raw_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        if path.suffix.lower() == ".json":
            data = json.load(file)
        else:
            import yaml

            data = yaml.safe_load(file)
    if not isinstance(data, dict):
        raise ValueError("Config root must be a mapping/dict.")
    return data


def _apply_overrides(raw: dict[str, Any], overrides: dict[str, str]) -> dict[str, Any]:
    result = deepcopy(raw)
    for dotted_key, value in overrides.items():
        current: Any = result
        parts = dotted_key.split(".")
        for part in parts[:-1]:
            if not isinstance(current, dict):
                raise ValueError(f"Cannot apply override {dotted_key!r}: {part!r} is not a mapping.")
            current = current.setdefault(part, {})
        if not isinstance(current, dict):
            raise ValueError(f"Cannot apply override {dotted_key!r}: parent is not a mapping.")
        current[parts[-1]] = value
    return result


def _expand_env(value: Any) -> Any:
    if isinstance(value, str):
        return _ENV_PATTERN.sub(_replace_env_match, value)
    if isinstance(value, list):
        return [_expand_env(item) for item in value]
    if isinstance(value, dict):
        return {key: _expand_env(item) for key, item in value.items()}
    return value


def _replace_env_match(match: re.Match[str]) -> str:
    name = match.group(1)
    fallback = match.group(2)
    if name in os.environ:
        return os.environ[name]
    if fallback is not None:
        return fallback
    raise ValueError(f"Environment variable {name!r} is not set and no default was provided.")


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
    return bool(value)
