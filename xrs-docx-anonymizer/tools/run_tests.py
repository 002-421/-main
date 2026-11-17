"""Run the real test suite and emit build evidence without document identifiers."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import sys
import unittest

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
os.chdir(root)
suite = unittest.defaultTestLoader.discover("tests", top_level_dir=".")
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise SystemExit(1)
target = Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({
    "platform": platform.platform(),
    "python": platform.python_version(),
    "commit": os.environ.get("GITHUB_SHA", "local"),
    "utc": datetime.now(timezone.utc).isoformat(),
    "tests_run": result.testsRun,
    "failures": len(result.failures),
    "errors": len(result.errors),
    "skipped": len(result.skipped),
    "synthetic_data_only": True,
}, indent=2), encoding="utf-8")
