"""Serial, bounded batch processing with exclusive output reservations."""
from __future__ import annotations

import csv
import json
import os
from collections import Counter
from pathlib import Path
import re
import threading

from .core import Result, process


class BatchError(Exception):
    pass


def require_local(path: Path):
    # Reject network shares before filesystem resolution can contact their server.
    if str(path).startswith(("\\\\", "//")):
        raise BatchError("Используйте локальные папки: сетевые UNC-пути не поддерживаются.")
    if os.name == "nt":
        import ctypes
        query = ctypes.windll.kernel32.GetDriveTypeW
        query.argtypes = [ctypes.c_wchar_p]
        query.restype = ctypes.c_uint
        if query(Path(os.path.abspath(path)).anchor) == 4:  # DRIVE_REMOTE
            raise BatchError("Используйте локальные папки: подключённый сетевой диск не поддерживается.")


def discover(source: Path, destination: Path, recursive=True) -> list[Path]:
    require_local(source)
    require_local(destination)
    if source.is_symlink():
        raise BatchError("Папка источника не должна быть символической ссылкой.")
    source = source.resolve()
    destination = destination.resolve()
    # Reject nested trees: repeated runs must not reprocess their own results.
    if source == destination or source in destination.parents or destination in source.parents:
        raise BatchError("Папки источника и результата не должны совпадать или быть вложены друг в друга.")
    if not source.is_dir() or source.is_symlink():
        raise BatchError("Выберите существующую папку источника без символической ссылки.")
    found = []
    for directory, dirs, files in os.walk(source, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink()) if recursive else []
        for filename in sorted(files):
            path = Path(directory) / filename
            if path.suffix.lower() == ".docx" and not filename.startswith("~$") and not path.is_symlink():
                found.append(path)
    return found


class Session:
    def __init__(self, destination: Path):
        require_local(destination)
        self.root = destination.resolve()
        self.lock = self.root / ".xrs-anonymizer.lock"
        self.lock_fd = None
        self.next_id = 1
        self.run_id = 1
        self.records = []

    def __enter__(self):
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            self.lock_fd = os.open(self.lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            raise BatchError("Папка результата занята. Если приложение аварийно завершилось, убедитесь, что другой запуск не работает, и удалите файл .xrs-anonymizer.lock.") from None
        try:
            for folder in ("Anonymized", "Review", "Reports", ".reservations"):
                path = self.root / folder
                if path.is_symlink():
                    raise BatchError("Папка результата содержит символическую ссылку.")
                path.mkdir(exist_ok=True)
            numbers = []
            for folder in ("Anonymized", "Review", ".reservations"):
                for path in (self.root / folder).iterdir():
                    match = re.fullmatch(r"CASE-(\d+)(?:\.docx|\.reserved)", path.name)
                    if match:
                        numbers.append(int(match[1]))
            self.next_id = max(numbers, default=0) + 1
            while (self.root / "Reports" / f"run-{self.run_id:06d}.json").exists():
                self.run_id += 1
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock.unlink(missing_ok=True)
            self.lock_fd = None

    def reserve(self) -> str:
        while True:
            code = f"CASE-{self.next_id:06d}"
            self.next_id += 1
            try:
                with (self.root / ".reservations" / f"{code}.reserved").open("xb"):
                    pass
                return code
            except FileExistsError:
                continue

    def reports(self):
        reportdir = self.root / "Reports"
        status_counts = Counter(record["status"] for record in self.records)
        review_reasons = Counter(
            code
            for record in self.records
            if record["status"] == "REVIEW_REQUIRED"
            for code in record.get("reason", "").split(";")
            if code
        )
        payload = {
            "records": self.records,
            "aggregate": {
                "total": len(self.records),
                "PASS": status_counts["PASS"],
                "REVIEW_REQUIRED": status_counts["REVIEW_REQUIRED"],
                "FAILED": status_counts["FAILED"],
                "common_review_reasons": [
                    {"code": code, "count": count}
                    for code, count in sorted(review_reasons.items(), key=lambda item: (-item[1], item[0]))
                ],
            },
        }
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        # Write the per-run history first; summary is a convenience snapshot of this run.
        history = reportdir / f"run-{self.run_id:06d}.json"
        temp = reportdir / ".report.tmp"
        with temp.open("w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, history)
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, reportdir / "summary.json")
        fields = [
            "record_type", "case_id", "status", "replaced_dates", "removed_images",
            "removed_headers", "categories", "reason", "count",
        ]
        with temp.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for record in self.records:
                writer.writerow({
                    "record_type": "CASE",
                    "case_id": record["case_id"],
                    "status": record["status"],
                    "replaced_dates": record["replaced_dates"],
                    "removed_images": record["removed_images"],
                    "removed_headers": record["removed_headers"],
                    "categories": ";".join(record["categories"]),
                    "reason": record["reason"],
                })
            for status in ("PASS", "REVIEW_REQUIRED", "FAILED"):
                writer.writerow({"record_type": "AGGREGATE", "status": status, "count": status_counts[status]})
            for code, count in payload["aggregate"]["common_review_reasons"]:
                writer.writerow({"record_type": "REVIEW_REASON", "status": "REVIEW_REQUIRED", "reason": code, "count": count})
        os.replace(temp, reportdir / "summary.csv")


def run_batch(source: Path, destination: Path, recursive=True, callback=None,
              cancel: threading.Event | None = None) -> dict:
    files = discover(source, destination, recursive)
    counts = {"total": len(files), "processed": 0, "PASS": 0, "REVIEW_REQUIRED": 0, "FAILED": 0, "cancelled": False}
    with Session(destination) as session:
        if callback:
            callback(dict(counts))
        for path in files:
            if cancel is not None and cancel.is_set():
                counts["cancelled"] = True
                break
            code = session.reserve()
            result, blob = process(path, code)
            if blob is not None:
                targetdir = "Anonymized" if result.status == "PASS" else "Review"
                target = session.root / targetdir / f"{code}.docx"
                try:
                    # Exclusive create prevents clobber even with files created by other programs.
                    with target.open("xb") as stream:
                        stream.write(blob)
                        stream.flush()
                        os.fsync(stream.fileno())
                except FileExistsError:
                    result = Result(code, reason="OUTPUT_COLLISION")
                except OSError:
                    target.unlink(missing_ok=True)
                    result = Result(code, reason="OUTPUT_WRITE_FAILED")
            session.records.append(result.record())
            counts["processed"] += 1
            counts[result.status] += 1
            # Per-case history survives interruption without retaining the original filename.
            session.reports()
            if callback:
                callback(dict(counts))
        if not files or counts["cancelled"]:
            session.reports()
    return counts
