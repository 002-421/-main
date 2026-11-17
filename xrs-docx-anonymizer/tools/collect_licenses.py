"""Collect installed dependency notices for the portable distribution."""
import importlib.metadata as metadata
from pathlib import Path
import shutil
import sys


target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
for name in ["lxml", "pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "packaging", "pefile", "pywin32-ctypes"]:
    try:
        distribution = metadata.distribution(name)
    except metadata.PackageNotFoundError:
        continue
    folder = target / name
    folder.mkdir(exist_ok=True)
    (folder / "METADATA.txt").write_text(distribution.read_text("METADATA") or "", encoding="utf-8")
    for file in distribution.files or []:
        if any(word in file.name.lower() for word in ("license", "licence", "copying", "notice")):
            source = distribution.locate_file(file)
            if source.is_file():
                # Preserve full relative names to prevent license file collisions.
                destination = folder / str(file).replace("/", "__").replace("\\", "__")
                shutil.copyfile(source, destination)
    if not any(path.name != "METADATA.txt" for path in folder.iterdir()):
        raise SystemExit(f"No license files found for {name}")
# Python's distribution license is shipped in addition to bundled runtime notices.
for source in [Path(sys.base_prefix) / "LICENSE.txt", Path(sys.base_prefix) / "LICENSE"]:
    if source.is_file():
        shutil.copyfile(source, target / "PYTHON-LICENSE.txt")
        break
else:
    raise SystemExit("Python license was not found")
