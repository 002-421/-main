from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import AutomationConfig

LOGGER = logging.getLogger(__name__)
_FILENAME_SAFE_PATTERN = re.compile(r"[^A-Za-zА-Яа-я0-9._-]+")


def run_automation(config: AutomationConfig) -> list[Path]:
    from playwright.sync_api import sync_playwright

    config.download_dir.mkdir(parents=True, exist_ok=True)
    downloaded_files: list[Path] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=config.headless, slow_mo=config.slow_mo_ms)
        context = browser.new_context(accept_downloads=True)
        context.set_default_timeout(config.timeout_ms)
        page = context.new_page()

        try:
            for index, step in enumerate(config.steps, start=1):
                LOGGER.info("Step %s/%s: %s", index, len(config.steps), _describe_step(step))
                downloaded = _execute_step(page, config, step)
                if downloaded:
                    downloaded_files.append(downloaded)
        finally:
            context.close()
            browser.close()

    return downloaded_files


def _execute_step(page: Any, config: AutomationConfig, step: dict[str, Any]) -> Path | None:
    action = step["action"]

    if action == "goto":
        page.goto(step["url"], wait_until=step.get("wait_until", "domcontentloaded"))
    elif action == "click":
        page.locator(step["selector"]).click()
    elif action == "fill":
        page.locator(step["selector"]).fill(str(step["value"]))
    elif action == "select":
        page.locator(step["selector"]).select_option(str(step["value"]))
    elif action == "press":
        page.locator(step["selector"]).press(str(step["key"]))
    elif action == "wait_for_selector":
        page.locator(step["selector"]).wait_for(state=step.get("state", "visible"))
    elif action == "wait_for_timeout":
        page.wait_for_timeout(int(step["milliseconds"]))
    elif action == "screenshot":
        path = _resolve_output_path(Path(step["path"]), config.download_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(path), full_page=bool(step.get("full_page", True)))
    elif action == "download_click":
        with page.expect_download() as download_info:
            page.locator(step["selector"]).click()
        download = download_info.value
        target = config.download_dir / _download_filename(step, config.default_excel_name, download.suggested_filename)
        download.save_as(str(target))
        LOGGER.info("Downloaded file: %s", target)
        return target
    else:
        raise ValueError(f"Unsupported action: {action}")

    pause_ms = int(step.get("pause_after_ms", 0))
    if pause_ms > 0:
        page.wait_for_timeout(pause_ms)
    return None


def _download_filename(step: dict[str, Any], default_name: str | None, suggested_name: str) -> str:
    name = step.get("save_as") or default_name or suggested_name
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = str(name).replace("{timestamp}", timestamp)
    return _FILENAME_SAFE_PATTERN.sub("_", name).strip("_") or suggested_name


def _resolve_output_path(path: Path, download_dir: Path) -> Path:
    if path.is_absolute():
        return path
    return download_dir / path


def _describe_step(step: dict[str, Any]) -> str:
    action = step["action"]
    if "selector" in step:
        return f"{action} {step['selector']}"
    if "url" in step:
        return f"{action} {step['url']}"
    return action
