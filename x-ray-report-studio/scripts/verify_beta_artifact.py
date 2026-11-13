"""Verify the unpublished Windows Beta ZIP is a complete portable Electron build."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.4.55-beta.1'
PREFIX = 'X-ray Report Studio/'
RUNTIME_ARCHIVE = ROOT / '.runtime-cache' / 'electron-v45.0.0-win32-x64.zip'


def main():
    archive_path = ROOT / 'test-output/X-ray_Report_Studio_Windows_Beta_Setup.zip'
    manifest_path = ROOT / 'test-output/XRS-08-beta-candidate.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    with ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        required = {
            PREFIX + 'X-ray Report Studio.exe',
            PREFIX + 'resources/default_app.asar',
            PREFIX + 'resources.pak',
            PREFIX + 'icudtl.dat',
            PREFIX + 'v8_context_snapshot.bin',
            PREFIX + 'resources/app/electron/main.cjs',
            PREFIX + 'resources/app/dist/index.html',
            PREFIX + 'resources/app/package.json',
            PREFIX + 'Start-XRS-Beta.cmd',
            PREFIX + 'Start-XRS-Beta.ps1',
            PREFIX + 'XRS-PreUpdate-Backup.ps1',
            PREFIX + 'THIRD_PARTY_LICENSES.txt',
        }
        required |= {PREFIX + 'resources/app/electron/' + item.name for item in (ROOT / 'electron').glob('*.cjs')}
        missing = required - names
        if missing:
            raise RuntimeError('Beta ZIP is incomplete: ' + ', '.join(sorted(missing)))
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f'Damaged Beta ZIP entry: {bad}')
        package = json.loads(archive.read(PREFIX + 'resources/app/package.json'))
        if package.get('version') != VERSION:
            raise RuntimeError('The Beta package has a different application version.')
        if not RUNTIME_ARCHIVE.is_file():
            raise RuntimeError('The verified official Electron runtime archive is missing.')
        with ZipFile(RUNTIME_ARCHIVE) as runtime:
            runtime_names = set(runtime.namelist())
            for item in runtime_names:
                target = PREFIX + ('X-ray Report Studio.exe' if item == 'electron.exe' else item)
                if target not in names:
                    raise RuntimeError(f'Beta ZIP is missing official Electron runtime file: {item}')
                if item != 'electron.exe' and archive.read(target) != runtime.read(item):
                    raise RuntimeError(f'Beta ZIP runtime file differs from official Electron archive: {item}')
        executable = archive.read(PREFIX + 'X-ray Report Studio.exe')
        if len(executable) < 1_000_000 or executable[:2] != b'MZ':
            raise RuntimeError('Beta Windows executable is missing or invalid.')
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    if (manifest.get('format') != 'xrs-portable-beta-candidate'
            or manifest.get('version') != VERSION
            or manifest.get('archive') != archive_path.name
            or manifest.get('bytes') != archive_path.stat().st_size
            or manifest.get('sha256') != digest):
        raise RuntimeError('Candidate manifest does not match the complete portable Beta ZIP.')
    print(f'VERIFIED: complete portable Beta ZIP matches official Electron runtime, launcher and backup tools; SHA256={digest}', flush=True)


if __name__ == '__main__':
    main()
