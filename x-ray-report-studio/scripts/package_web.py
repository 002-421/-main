#!/usr/bin/env python3
"""Package the single-file browser build as a versioned, independently verifiable ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def package_web(version: str, output_dir: Path) -> tuple[Path, str]:
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Expected a stable version such as 0.4.82")
    metadata = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if metadata.get("version") != version:
        raise ValueError("Built app version does not match the requested package version")
    html_path = ROOT / "dist" / "index.html"
    html = html_path.read_bytes()
    if metadata["name"].encode() not in html or version.encode() not in html:
        raise ValueError("Single-file browser build does not contain its expected app name and version")

    output_dir.mkdir(parents=True, exist_ok=True)
    name = f"XRS-{version}-Web.zip"
    archive_path = output_dir / name
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("index.html", html)
    with zipfile.ZipFile(archive_path) as archive:
        if archive.namelist() != ["index.html"] or archive.testzip() is not None:
            raise ValueError("Web ZIP must contain one valid index.html")
        if archive.read("index.html") != html:
            raise ValueError("Web ZIP contents differ from the verified build")

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (output_dir / f"XRS-{version}-Web.sha256").write_text(f"{digest}  {name}\n", encoding="ascii")
    return archive_path, digest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    path, digest = package_web(args.version, args.output_dir)
    print(f"Verified browser ZIP: {path} ({path.stat().st_size} bytes), SHA-256 {digest}")


if __name__ == "__main__":
    main()
