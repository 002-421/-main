"""Package the app with the official, checksum-verified Windows Electron runtime."""
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import shutil
from package_setup import collect_licenses

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.runtime-cache'
RELEASE = ROOT / 'release'
CACHE.mkdir(exist_ok=True)
RELEASE.mkdir(exist_ok=True)
version = json.loads((ROOT / 'node_modules/electron/package.json').read_text())['version']
artifact = f'electron-v{version}-win32-x64.zip'
base = f'https://github.com/electron/electron/releases/download/v{version}'

with urlopen(f'{base}/SHASUMS256.txt', timeout=60) as response:
    sums = response.read().decode('utf-8')
expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == artifact)
archive = CACHE / artifact
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()
if not archive.exists() or digest(archive) != expected:
    temporary = archive.with_suffix('.download')
    with urlopen(f'{base}/{artifact}', timeout=120) as response, temporary.open('wb') as output:
        shutil.copyfileobj(response, output)
    if digest(temporary) != expected:
        temporary.unlink()
        raise RuntimeError('Electron archive checksum mismatch; refusing to package.')
    temporary.replace(archive)
print('Official Windows Electron SHA256 verified:', expected, flush=True)

destination = RELEASE / 'MRI Alliance'
if destination.exists(): shutil.rmtree(destination)
destination.mkdir()
with ZipFile(archive) as package:
    for name in package.namelist():
        if not (destination / name).resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('Invalid archive path')
    package.extractall(destination)
(destination / 'electron.exe').rename(destination / 'MRI Alliance.exe')
app = destination / 'resources/app'
(app / 'electron').mkdir(parents=True)
(app / 'dist').mkdir()
for filename in ['main.cjs', 'preload.cjs']:
    shutil.copy2(ROOT / 'electron' / filename, app / 'electron' / filename)
shutil.copy2(ROOT / 'dist/index.html', app / 'dist/index.html')
shutil.copy2(ROOT / 'public/mri-alliance.ico', app / 'dist/mri-alliance.ico')
(app / 'package.json').write_text(json.dumps({
    'name': 'mri-report-studio', 'productName': 'MRI Alliance',
    'version': json.loads((ROOT / 'package.json').read_text())['version'], 'main': 'electron/main.cjs', 'private': True,
}, indent=2))
shutil.copy2(ROOT / 'README_RU.txt', destination / 'ПРОЧИТАЙТЕ.txt')

(destination / 'THIRD_PARTY_LICENSES.txt').write_text(collect_licenses(), encoding='utf-8')
example = ROOT / 'downloads/MRI_Alliance_Head_Template.docx'
if example.is_file():
    shutil.copy2(example, destination / example.name)

output = RELEASE / 'MRI_Alliance_Windows_x64.zip'
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as package:
    for file in sorted(destination.rglob('*')):
        if file.is_file(): package.write(file, file.relative_to(RELEASE))
print('Windows package:', output, 'bytes:', output.stat().st_size, flush=True)

# A browser-only edition runs by double-clicking one HTML file; no installation.
browser = RELEASE / 'MRI_Alliance.html'
shutil.copy2(ROOT / 'dist/index.html', browser)
print('Browser edition:', browser, flush=True)
