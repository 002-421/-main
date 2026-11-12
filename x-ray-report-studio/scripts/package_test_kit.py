"""Build an isolated Windows test kit plus a local synthetic 0.4.54 update."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'release'
OUTPUT = ROOT / 'test-output' / 'XRS-05-Windows-Test-Kit'
ARCHIVE = ROOT / 'test-output' / 'XRS-05-Windows-Test-Kit.zip'
MARKER = {'format': 'xrs-isolated-test-kit', 'allowLocalUpdateFiles': True}


def version_tuple(value):
    if not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise RuntimeError(f'Unsupported package version: {value}')
    return tuple(map(int, value.split('.')))


def write_zip(source, destination, prefix=''):
    with ZipFile(destination, 'w', ZIP_DEFLATED, compresslevel=6) as package:
        for file in sorted(source.rglob('*')):
            if file.is_file():
                name = '/'.join(part for part in (prefix, file.relative_to(source).as_posix()) if part)
                package.write(file, name)


def main():
    subprocess.run(['python', str(ROOT / 'scripts' / 'package_windows.py')], cwd=ROOT, check=True)
    portable = RELEASE / 'X-ray_Report_Studio_Windows_x64.zip'
    if not portable.is_file():
        raise RuntimeError('The checksum-verified Windows package was not created.')
    metadata = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    current_version = metadata['version']
    major, minor, patch = version_tuple(current_version)
    test_version = f'{major}.{minor}.{patch + 1}'
    shutil.rmtree(OUTPUT, ignore_errors=True)
    OUTPUT.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='xrs05-kit-') as temporary:
        extracted = Path(temporary)
        with ZipFile(portable) as package:
            for entry in package.infolist():
                target = (extracted / entry.filename).resolve()
                if not target.is_relative_to(extracted.resolve()):
                    raise RuntimeError('Windows package contains an unsafe path.')
            package.extractall(extracted)
        app_root = extracted / 'X-ray Report Studio'
        if not (app_root / 'X-ray Report Studio.exe').is_file():
            raise RuntimeError('The portable Windows app is incomplete.')
        base_app = app_root / 'resources' / 'app'
        marker_file = base_app / 'xrs-test-mode.json'
        marker_file.write_text(json.dumps(MARKER, indent=2) + '\n', encoding='utf-8')
        kit_app = OUTPUT / f'App_{current_version}'
        shutil.copytree(app_root, kit_app)

        update_root = OUTPUT / 'Updates'
        update_app = update_root / 'payload' / 'X-ray Report Studio Setup' / 'app'
        shutil.copytree(base_app, update_app)
        package_json = update_app / 'package.json'
        app_metadata = json.loads(package_json.read_text(encoding='utf-8'))
        app_metadata['version'] = test_version
        package_json.write_text(json.dumps(app_metadata, indent=2) + '\n', encoding='utf-8')
        update_name = f'XRS_Test_Update_{test_version}.zip'
        update_zip = update_root / update_name
        write_zip(update_root / 'payload', update_zip)
        shutil.rmtree(update_root / 'payload')
        update_manifest = {
            'version': test_version,
            'url': update_name,
            'sha256': hashlib.sha256(update_zip.read_bytes()).hexdigest(),
            'notes': 'Локальное синтетическое обновление для XRS-05. В релизный канал не отправляется.',
        }
        (update_root / 'latest.json').write_text(json.dumps(update_manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    launcher = r'''$ErrorActionPreference = 'Stop'
$kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:XRS_TEST_ROOT = Join-Path $kit 'XRS-Test-Data'
$env:MRI_REPORT_STUDIO_DICTIONARY_DIR = Join-Path $env:XRS_TEST_ROOT 'Shared Dictionary'
$shortcut = Join-Path $env:XRS_TEST_ROOT 'Shortcuts\X-ray Report Studio.lnk'
if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if (-not (Test-Path -LiteralPath $target)) { throw 'The isolated test shortcut points to a missing app.' }
    Start-Process -FilePath $target
} else {
    Start-Process -FilePath (Join-Path $kit 'App_CURRENT\X-ray Report Studio.exe')
}
'''.replace('App_CURRENT', f'App_{current_version}')
    (OUTPUT / 'Run-Test-App.ps1').write_text(launcher, encoding='utf-8-sig')
    (OUTPUT / 'Run-Test-App.cmd').write_text(
        '@echo off\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Test-App.ps1"\r\n',
        encoding='ascii',
    )
    (OUTPUT / 'README_XRS05_RU.md').write_text(
        (ROOT / 'WINDOWS_TEST_GUIDE_RU.md').read_text(encoding='utf-8'), encoding='utf-8')
    (OUTPUT / 'KIT_INFO.json').write_text(json.dumps({
        'format': 'xrs-05-windows-test-kit',
        'appVersion': current_version,
        'syntheticUpdateVersion': test_version,
        'updateManifest': 'Updates/latest.json',
        'testDataRoot': 'XRS-Test-Data',
        'publicUpdateChannelModified': False,
    }, indent=2) + '\n', encoding='utf-8')
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    write_zip(OUTPUT, ARCHIVE, 'XRS-05-Windows-Test-Kit')
    print(f'Isolated test kit: {ARCHIVE} ({ARCHIVE.stat().st_size:,} bytes)', flush=True)


if __name__ == '__main__':
    main()
