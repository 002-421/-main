"""Verify the unpublished portable Beta and updater payload."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.4.55-beta.1'


def verify_zip(filename, prefix, extras):
    with ZipFile(filename) as archive:
        names = set(archive.namelist())
        required = {f'{prefix}/electron/{module.name}' for module in (ROOT / 'electron').glob('*.cjs')}
        required |= {f'{prefix}/dist/index.html', f'{prefix}/package.json', *extras}
        missing = required - names
        if missing:
            raise RuntimeError(f'Missing Beta files: {sorted(missing)}')
        package = json.loads(archive.read(f'{prefix}/package.json'))
        if package.get('version') != VERSION:
            raise RuntimeError('The Beta package has a different application version.')
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f'Damaged Beta ZIP entry: {bad}')


def main():
    portable = ROOT / 'release/X-ray_Report_Studio_Windows_x64.zip'
    setup = ROOT / 'test-output/X-ray_Report_Studio_Windows_Beta_Setup.zip'
    manifest = json.loads((ROOT / 'test-output/XRS-08-beta-candidate.json').read_text(encoding='utf-8'))
    verify_zip(portable, 'X-ray Report Studio/resources/app', {
        'X-ray Report Studio/X-ray Report Studio.exe',
        'X-ray Report Studio/Start-XRS-Beta.cmd',
        'X-ray Report Studio/Start-XRS-Beta.ps1',
        'X-ray Report Studio/XRS-PreUpdate-Backup.ps1',
    })
    verify_zip(setup, 'X-ray Report Studio Setup/app', set())
    digest = hashlib.sha256(setup.read_bytes()).hexdigest()
    if manifest.get('version') != VERSION or manifest.get('sha256') != digest or not manifest.get('url', '').endswith('/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip'):
        raise RuntimeError('Candidate manifest does not match the Beta update ZIP.')
    print(f'VERIFIED: portable Beta and updater payload; setup SHA256={digest}', flush=True)


if __name__ == '__main__':
    main()
