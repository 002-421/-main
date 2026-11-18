"""Exercise bundled CLI through a real frozen Windows executable."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.fixtures import minimal, write

executable = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="xrs-synthetic-") as directory:
    root = Path(directory)
    source = root / "input"
    source.mkdir()
    write(source / "SYNTHETIC.docx", minimal("Ф.И.О. пациента: Иванов Иван Иванович"))
    completed = subprocess.run([str(executable), "--source", str(source), "--output", str(root / "output")],
                               capture_output=True, timeout=90)
    if completed.returncode != 0:
        raise SystemExit("Frozen CLI synthetic smoke failed")
    report = json.loads((root / "output" / "Reports" / "summary.json").read_text(encoding="utf-8"))
    assert report["records"][0]["status"] == "PASS"
    assert report["aggregate"]["PASS"] == 1
    assert (root / "output" / "Anonymized" / "CASE-000001.docx").is_file()
print("Frozen CLI synthetic smoke passed")
