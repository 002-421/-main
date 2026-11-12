"""Prepare a Beta update candidate without touching downloads/latest.json."""
from pathlib import Path
from zipfile import ZIP_STORED
import hashlib
import json
import tempfile

from package_setup import ROOT, collect_licenses, normalized_text, write_zip

OUT = ROOT / 'test-output'
ARCHIVE = OUT / 'X-ray_Report_Studio_Windows_Beta_Setup.zip'
MANIFEST = OUT / 'XRS-08-beta-candidate.json'
URL = 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip'


def main():
    metadata = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    version = metadata['version']
    if version != '0.4.55-beta.1':
        raise RuntimeError('This candidate packager is limited to 0.4.55-beta.1.')
    if not (ROOT / 'dist/index.html').is_file():
        raise RuntimeError('Build the application before packaging Beta.')
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='xrs-beta-package-') as temporary:
        setup = Path(temporary) / 'X-ray Report Studio Setup'
        app = setup / 'app'
        (app / 'electron').mkdir(parents=True)
        (app / 'dist').mkdir()
        for source in sorted((ROOT / 'electron').glob('*.cjs')):
            (app / 'electron' / source.name).write_text(normalized_text(source), encoding='utf-8', newline='\n')
        if not (app / 'electron/main.cjs').exists():
            raise RuntimeError('Electron entry point is missing.')
        (app / 'dist/index.html').write_bytes((ROOT / 'dist/index.html').read_bytes())
        (app / 'dist/x-ray-report-studio.ico').write_bytes((ROOT / 'public/x-ray-report-studio.ico').read_bytes())
        (app / 'package.json').write_text(json.dumps({
            'name': metadata['name'], 'productName': 'X-ray Report Studio',
            'version': version, 'main': 'electron/main.cjs', 'private': True,
        }, indent=2) + '\n', encoding='utf-8')
        (setup / 'THIRD_PARTY_LICENSES.txt').write_text(collect_licenses(), encoding='utf-8')
        write_zip(setup, ARCHIVE, ZIP_STORED)
    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    MANIFEST.write_text(json.dumps({
        'version': version, 'url': URL, 'sha256': digest,
        'notes': 'Тестовая версия XRS-07 и переключение Stable/Beta. Публикация ожидает отдельного разрешения.',
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Beta candidate: {ARCHIVE} SHA256={digest}', flush=True)


if __name__ == '__main__':
    main()
