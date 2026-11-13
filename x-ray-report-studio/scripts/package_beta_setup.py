"""Package the complete unpublished Windows Beta portable build from package_windows.py."""
from pathlib import Path
from zipfile import ZIP_DEFLATED
import hashlib
import json
import tempfile

from package_setup import ROOT, write_zip

OUT = ROOT / 'test-output'
ARCHIVE = OUT / 'X-ray_Report_Studio_Windows_Beta_Setup.zip'
MANIFEST = OUT / 'XRS-08-beta-candidate.json'


def main():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if version != '0.4.55-beta.1':
        raise RuntimeError('This candidate packager is limited to 0.4.55-beta.1.')
    portable = ROOT / 'release' / 'X-ray Report Studio'
    required = [portable / 'X-ray Report Studio.exe', portable / 'resources' / 'app' / 'electron' / 'main.cjs',
                portable / 'Start-XRS-Beta.cmd', portable / 'Start-XRS-Beta.ps1',
                portable / 'XRS-PreUpdate-Backup.ps1']
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError('Build the complete Windows portable package first; missing: ' + ', '.join(missing))
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='xrs-beta-package-') as temporary:
        stage_root = Path(temporary)
        stage = stage_root / portable.name
        import shutil
        shutil.copytree(portable, stage)
        write_zip(stage, ARCHIVE, ZIP_DEFLATED)
    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    MANIFEST.write_text(json.dumps({
        'format': 'xrs-portable-beta-candidate', 'version': version,
        'archive': ARCHIVE.name, 'bytes': ARCHIVE.stat().st_size, 'sha256': digest,
        'notes': 'Неопубликованный portable Windows Beta artifact; не является пакетом встроенного updater.',
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Beta portable candidate: {ARCHIVE} SHA256={digest}', flush=True)


if __name__ == '__main__':
    main()
