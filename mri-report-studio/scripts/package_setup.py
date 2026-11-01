"""Build the small Windows installer and offline browser downloads from dist/.

Run `npm run build` first. No runtime is downloaded by this packaging script;
Install.cmd downloads and verifies the official pinned Electron on Windows.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / 'downloads'
RELEASE = ROOT / 'release'
BUILD = ROOT / 'dist/index.html'


def collect_licenses():
    notices = []
    names = {'license', 'license.md', 'license.txt', 'licence', 'licence.md',
             'licence.txt', 'copying', 'copying.txt', 'copyright'}
    for manifest in sorted((ROOT / 'node_modules').glob('**/package.json')):
        try:
            metadata = json.loads(manifest.read_text(encoding='utf-8'))
            files = sorted(p for p in manifest.parent.iterdir()
                           if p.is_file() and p.name.lower() in names)
        except (ValueError, OSError):
            continue
        for notice in files:
            notices.append(f"\n{'=' * 60}\n{metadata.get('name')} {metadata.get('version')}\n"
                           f"{notice.read_text(encoding='utf-8', errors='replace')}\n")
    if not notices:
        raise RuntimeError('Dependency license notices are missing. Run npm ci first.')
    font_notice = ROOT / 'src/assets/fonts/LICENSE.txt'
    if not font_notice.is_file():
        raise RuntimeError('Bundled font license notices are missing.')
    notices.append(f"\n{'=' * 60}\nBundled DejaVu Sans and Carlito fonts\n"
                   f"{font_notice.read_text(encoding='utf-8')}\n")
    return ''.join(notices)


def write_zip(directory, output):
    """Use stable timestamps and regular file permissions in the download ZIP."""
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as package:
        for file in sorted(directory.rglob('*')):
            if file.is_file():
                info = ZipInfo(file.relative_to(directory.parent).as_posix(),
                               date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                package.writestr(info, file.read_bytes(), compresslevel=9)
    print(f'{output.relative_to(ROOT)}: {output.stat().st_size:,} bytes', flush=True)


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
    stage = RELEASE / 'download-packages'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir()
    setup = stage / 'MRI Alliance Setup'
    (setup / 'app/dist').mkdir(parents=True)
    (setup / 'app/electron').mkdir()
    shutil.copy2(BUILD, setup / 'app/dist/index.html')
    shutil.copy2(ROOT / 'public/mri-alliance.ico', setup / 'app/dist/mri-alliance.ico')
    for filename in ('main.cjs', 'preload.cjs'):
        shutil.copy2(ROOT / 'electron' / filename, setup / 'app/electron' / filename)
    (setup / 'app/package.json').write_text(json.dumps({
        'name': metadata['name'], 'productName': 'MRI Alliance',
        'version': metadata['version'], 'main': 'electron/main.cjs', 'private': True,
    }, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(ROOT / 'README_RU.txt', setup / 'README_RU.txt')
    (setup / 'Install.ps1').write_text(installer, encoding='utf-8-sig')

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
    (setup / 'START_HERE_RU.txt').write_text(
        f'УСТАНОВКА МРТ АЛЬЯНСА {metadata["version"]}\n\n'
        '1. Распакуйте весь архив.\n'
        '2. Запустите Install.cmd двойным щелчком.\n'
        '3. Дождитесь загрузки официальной среды запуска (около 150 МБ).\n'
        '4. Приложение откроется; его папка появится на рабочем столе в MRI Alliance.\n\n'
        'Интернет нужен для установки; готовое приложение работает без Интернета. '
        'Права администратора не нужны. Установщик не меняет ExecutionPolicy, настройки защиты, '
        'реестр или системные папки. SHA256 загруженного Electron проверяется; '
        'несовпадение прерывает установку. Существующие файлы не перезаписываются.\n\n'
        'При обновлении закройте старое приложение и запускайте новый EXE из новой папки App_… . '
        'Локальный рабочий черновик и настройки шаблонов сохраняются в профиле приложения.\n\n'
        'Install.ps1 — читаемый исходник команды. Папку app нужно оставить рядом с Install.cmd.\n',
        encoding='utf-8-sig')
    notices = collect_licenses()
    (setup / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8')
    example = DOWNLOADS / 'MRI_Alliance_Head_Template.docx'
    if example.is_file():
        shutil.copy2(example, setup / example.name)
    write_zip(setup, DOWNLOADS / 'MRI_Alliance_Windows_Setup.zip')

    browser = stage / 'MRI Alliance Browser'
    browser.mkdir()
    shutil.copy2(BUILD, browser / 'index.html')
    shutil.copy2(ROOT / 'README_RU.txt', browser / 'README_RU.txt')
    (browser / 'START_HERE_RU.txt').write_text(
        f'МРТ АЛЬЯНС {metadata["version"]} — БРАУЗЕРНАЯ ВЕРСИЯ\n\n'
        'Распакуйте архив целиком. Откройте index.html двойным щелчком в Chrome или Edge.\n'
        'Интернет и установка не нужны. Описания сохраняются кнопкой DOCX. '
        'Для PDF выберите «Сохранить как PDF» в окне печати.\n'
        'Локальный черновик и настройки связаны с этим браузером и адресом файла. '
        'Храните нужные описания отдельными файлами DOCX.\n', encoding='utf-8-sig')
    (browser / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8')
    if example.is_file():
        shutil.copy2(example, browser / example.name)
    write_zip(browser, DOWNLOADS / 'MRI_Alliance_Browser.zip')
    shutil.copy2(BUILD, DOWNLOADS / 'MRI_Alliance.html')
    (DOWNLOADS / 'THIRD_PARTY_LICENSES.txt').write_text(notices, encoding='utf-8')
    # Keep earlier download URLs useful: they must deliver the current app too.
    for suffix in ('Windows_Setup.zip', 'Browser.zip', '.html'):
        separator = '' if suffix.startswith('.') else '_'
        shutil.copy2(DOWNLOADS / f'MRI_Alliance{separator}{suffix}',
                     DOWNLOADS / f'MRI_Report_Studio{separator}{suffix}')
    preview = DOWNLOADS / 'MRI_Alliance_Preview.png'
    if preview.exists():
        shutil.copy2(preview, DOWNLOADS / 'MRI_Report_Studio_Preview.png')
    print('Standalone HTML and license notices updated.', flush=True)


if __name__ == '__main__':
    main()
