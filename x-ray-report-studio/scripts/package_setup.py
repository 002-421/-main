"""Build the small Windows installer and offline browser downloads from dist/.

Run `npm run build` first. No runtime is downloaded by this packaging script;
Install.cmd downloads and verifies the official pinned Electron on Windows.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED, ZipInfo
import json
import re
import shutil
import hashlib

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / 'downloads'
RELEASE = ROOT / 'release'
BUILD = ROOT / 'dist/index.html'


def is_single_platform_package(metadata):
    """Exclude optional build binaries that are not part of the shipped app."""
    return any(len(values) == 1 for values in (metadata.get('os') or [], metadata.get('cpu') or []))


def collect_licenses():
    notices = []
    names = {'license', 'license.md', 'license.txt', 'licence', 'licence.md',
             'licence.txt', 'copying', 'copying.txt', 'copyright'}
    for manifest in sorted((ROOT / 'node_modules').glob('**/package.json')):
        try:
            metadata = json.loads(manifest.read_text(encoding='utf-8'))
            if is_single_platform_package(metadata):
                continue
            files = sorted(p for p in manifest.parent.iterdir()
                           if p.is_file() and p.name.lower() in names)
        except (ValueError, OSError):
            continue
        for notice in files:
            text = notice.read_text(encoding='utf-8', errors='replace')
            text = '\n'.join(line.rstrip() for line in text.splitlines()).rstrip()
            notices.append(f"\n{'=' * 60}\n{metadata.get('name')} {metadata.get('version')}\n{text}\n")
    if not notices:
        raise RuntimeError('Dependency license notices are missing. Run npm ci first.')
    font_notice = ROOT / 'src/assets/fonts/LICENSE.txt'
    if not font_notice.is_file():
        raise RuntimeError('Bundled font license notices are missing.')
    notices.append(f"\n{'=' * 60}\nBundled DejaVu Sans and Carlito fonts\n"
                   f"{font_notice.read_text(encoding='utf-8')}\n")
    notices.append('\n' + (ROOT / 'src/assets/morphology/LICENSE.txt').read_text(encoding='utf-8') + '\n')
    return ''.join(notices)


def write_zip(directory, output, compression=ZIP_DEFLATED):
    """Use stable timestamps and regular file permissions in the download ZIP."""
    compresslevel = 9 if compression == ZIP_DEFLATED else None
    with ZipFile(output, 'w', compression, compresslevel=compresslevel) as package:
        files = (file for file in directory.rglob('*') if file.is_file())
        for file in sorted(files, key=lambda path: path.relative_to(directory.parent).as_posix()):
            info = ZipInfo(file.relative_to(directory.parent).as_posix(),
                           date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3  # Use the same ZIP creator metadata on Windows and Unix.
            info.compress_type = compression
            info.external_attr = 0o100644 << 16
            package.writestr(info, file.read_bytes(), compresslevel=compresslevel)
    print(f'{output.relative_to(ROOT)}: {output.stat().st_size:,} bytes', flush=True)


def normalized_text(path):
    """Read text with universal newline handling for byte-stable ZIP output."""
    return path.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')


def main():
    if not BUILD.is_file():
        raise RuntimeError('dist/index.html is missing. Run npm run build first.')
    metadata = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    runtime_version = json.loads((ROOT / 'node_modules/electron/package.json').read_text(encoding='utf-8'))['version']
    installer = (ROOT / 'scripts/install_windows.ps1').read_text(encoding='utf-8')
    pinned = re.search(r'/download/v([^/]+)/electron-v([^/]+)-win32-x64\.zip', installer)
    if not pinned or pinned.group(1) != runtime_version or pinned.group(2) != runtime_version:
        raise RuntimeError('The installer runtime pin must match the installed Electron version.')
    if not re.search(r"\$expected = '[a-f0-9]{64}'", installer):
        raise RuntimeError('The installer SHA256 pin is missing.')

    DOWNLOADS.mkdir(exist_ok=True)
    RELEASE.mkdir(exist_ok=True)
    legacy_release = RELEASE / 'MRI Alliance'
    if legacy_release.exists(): shutil.rmtree(legacy_release)
    for old_package in RELEASE.glob('MRI_Alliance*'):
        if old_package.is_dir(): shutil.rmtree(old_package)
        else: old_package.unlink()
    stage = RELEASE / 'download-packages'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    setup = stage / 'X-ray Report Studio Setup'
    (setup / 'app/dist').mkdir(parents=True)
    (setup / 'app/electron').mkdir()
    (setup / 'app/dist/index.html').write_text(normalized_text(BUILD), encoding='utf-8', newline='\n')
    shutil.copy2(ROOT / 'public/x-ray-report-studio.ico', setup / 'app/dist/x-ray-report-studio.ico')
    shutil.copy2(ROOT / 'node_modules/rcedit/bin/rcedit-x64.exe', setup / 'app/dist/rcedit-x64.exe')
    # Keep the packaged Electron app in sync with its local CommonJS modules.
    # main.cjs and its transitive requires have grown over time; a fixed list
    # silently produces an installer that builds successfully but cannot boot.
    electron_sources = sorted((ROOT / 'electron').glob('*.cjs'))
    if not electron_sources or not any(source.name == 'main.cjs' for source in electron_sources):
        raise RuntimeError('Electron main-process modules are missing.')
    for source in electron_sources:
        (setup / 'app/electron' / source.name).write_text(normalized_text(source), encoding='utf-8', newline='\n')
    (setup / 'app/package.json').write_text(json.dumps({
        'name': metadata['name'], 'productName': 'X-ray Report Studio',
        'version': metadata['version'], 'main': 'electron/main.cjs', 'private': True,
    }, indent=2) + '\n', encoding='utf-8', newline='\n')
    (setup / 'README_RU.txt').write_text(normalized_text(ROOT / 'README_RU.txt'), encoding='utf-8', newline='\n')
    (setup / 'Install.ps1').write_bytes(b'\xef\xbb\xbf' + installer.replace('\r\n', '\n').replace('\r', '\n').replace('\n', '\r\n').encode('utf-8'))

    # Use an inline command so running Install.cmd does not require changing
    # PowerShell ExecutionPolicy. Keep the readable .ps1 alongside it.
    lines = []
    for source in installer.splitlines():
        line = source.strip()
        if not line or line.startswith('#'):
            continue
        if not line.endswith(('{', '}')):
            line += ';'
        lines.append(line)
    inline = ' '.join(lines).replace("('\"' + $destination + '\"')",
                                     '([char]34 + $destination + [char]34)')
    if '"' in inline:
        raise RuntimeError('Unexpected double quote in the inline PowerShell command.')
    command = ('@echo off\r\nsetlocal\r\nset "MRI_STUDIO_PACKAGE=%~dp0"\r\n'
               f'powershell.exe -NoLogo -NoProfile -Command "& {{ {inline} }}"\r\n')
    if len(command.encode('ascii')) > 8000:
        raise RuntimeError('The inline installer exceeds the Windows command-line limit.')
    (setup / 'Install.cmd').write_bytes(command.encode('ascii'))
    start_here = (
        f'УСТАНОВКА X-RAY REPORT STUDIO {metadata["version"]}\n\n'
        '1. Распакуйте весь архив.\n'
        '2. Запустите Install.cmd двойным щелчком.\n'
        '3. Дождитесь загрузки официальной среды запуска (около 150 МБ).\n'
        '4. Приложение откроется; его папка появится на рабочем столе в X-ray Report Studio.\n\n'
        'Интернет нужен для установки; готовое приложение работает без Интернета. '
        'Права администратора не нужны. Установщик не меняет ExecutionPolicy, настройки защиты, '
        'реестр или системные папки. SHA256 загруженного Electron проверяется; '
        'несовпадение прерывает установку. Существующие файлы не перезаписываются.\n\n'
        'При обновлении интерфейс сменится в открытом окне без перезапуска приложения. '
        'Изменения системной части вступят в силу при следующем запуске. '
        'Локальный рабочий черновик и настройки шаблонов сохраняются в профиле приложения.\n\n'
        'Install.ps1 — читаемый исходник команды. Папку app нужно оставить рядом с Install.cmd.\n')
    (setup / 'START_HERE_RU.txt').write_bytes(b'\xef\xbb\xbf' + start_here.replace('\n', '\r\n').encode('utf-8'))
    notices = collect_licenses()
    (setup / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8', newline='\n')
    setup_zip = DOWNLOADS / 'X-ray_Report_Studio_Windows_Setup.zip'
    # Store the setup archive without DEFLATE: zlib versions can produce
    # different compressed bytes on Linux and Windows for identical files,
    # which makes cross-run SHA256 comparisons unreliable.
    write_zip(setup, setup_zip, ZIP_STORED)
    manifest = {
        'version': metadata['version'],
        'url': 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip',
        'sha256': hashlib.sha256(setup_zip.read_bytes()).hexdigest(),
    }
    (DOWNLOADS / 'latest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    browser = stage / 'X-ray Report Studio Browser'
    browser.mkdir()
    shutil.copy2(BUILD, browser / 'index.html')
    shutil.copy2(ROOT / 'README_RU.txt', browser / 'README_RU.txt')
    (browser / 'START_HERE_RU.txt').write_text(
        f'X-RAY REPORT STUDIO {metadata["version"]} — БРАУЗЕРНАЯ ВЕРСИЯ\n\n'
        'Распакуйте архив целиком. Откройте index.html двойным щелчком в Chrome или Edge.\n'
        'Интернет и установка не нужны. Описания сохраняются кнопкой DOCX. '
        'Для PDF выберите «Сохранить как PDF» в окне печати.\n'
        'Локальный черновик и настройки связаны с этим браузером и адресом файла. '
        'Храните нужные описания отдельными файлами DOCX.\n', encoding='utf-8-sig')
    (browser / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8')
    write_zip(browser, DOWNLOADS / 'X-ray_Report_Studio_Browser.zip')
    shutil.copy2(BUILD, DOWNLOADS / 'X-ray_Report_Studio.html')
    (DOWNLOADS / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8')
    old_preview = DOWNLOADS / 'MRI_Alliance_Preview.png'
    if old_preview.exists(): old_preview.rename(DOWNLOADS / 'X-ray_Report_Studio_Preview.png')
    for pattern in ('MRI_Alliance*', 'MRI_Report_Studio*'):
        for old_name in DOWNLOADS.glob(pattern):
            old_name.unlink()
    print('Standalone HTML and license notices updated.', flush=True)


if __name__ == '__main__':
    main()
