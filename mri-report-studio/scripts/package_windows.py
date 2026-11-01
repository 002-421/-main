"""Package the app with the official, checksum-verified Windows Electron runtime."""
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import shutil
import subprocess
from package_setup import collect_licenses
from ai_runtime import VERSION as AI_RUNTIME_VERSION, prepare_ai_runtime

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

legacy_destination = RELEASE / 'MRI Alliance'
if legacy_destination.exists(): shutil.rmtree(legacy_destination)
for old_package in RELEASE.glob('MRI_Alliance*'):
    old_package.unlink()
destination = RELEASE / 'MRI Report Studio'
if destination.exists(): shutil.rmtree(destination)
destination.mkdir()
with ZipFile(archive) as package:
    for name in package.namelist():
        if not (destination / name).resolve().is_relative_to(destination.resolve()):
            raise RuntimeError('Invalid archive path')
    package.extractall(destination)
(destination / 'electron.exe').rename(destination / 'MRI Report Studio.exe')
subprocess.run([
    'node', str(ROOT / 'scripts/set_exe_icon.mjs'),
    str(destination / 'MRI Report Studio.exe'), str(ROOT / 'public/mri-report-studio.ico'),
], check=True)
app = destination / 'resources/app'
(app / 'electron').mkdir(parents=True)
(app / 'dist').mkdir()
for filename in ['main.cjs', 'preload.cjs', 'ai-model.cjs', 'ai-review.cjs']:
    shutil.copy2(ROOT / 'electron' / filename, app / 'electron' / filename)
ai_runtime = prepare_ai_runtime()
shutil.copytree(ai_runtime, app / 'node_modules', dirs_exist_ok=True)
shutil.copy2(ROOT / 'dist/index.html', app / 'dist/index.html')
shutil.copy2(ROOT / 'public/mri-report-studio.ico', app / 'dist/mri-report-studio.ico')
(app / 'package.json').write_text(json.dumps({
    'name': 'mri-report-studio', 'productName': 'MRI Report Studio',
    'version': json.loads((ROOT / 'package.json').read_text())['version'], 'main': 'electron/main.cjs', 'private': True,
    'dependencies': {'node-llama-cpp': AI_RUNTIME_VERSION, '@node-llama-cpp/win-x64': AI_RUNTIME_VERSION},
}, indent=2))
shutil.copy2(ROOT / 'README_RU.txt', destination / 'ПРОЧИТАЙТЕ.txt')

(destination / 'THIRD_PARTY_LICENSES.txt').write_text(collect_licenses([ai_runtime]), encoding='utf-8')
output = RELEASE / 'MRI_Report_Studio_Windows_x64.zip'
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as package:
    for file in sorted(destination.rglob('*')):
        if file.is_file(): package.write(file, file.relative_to(RELEASE))
print('Windows package:', output, 'bytes:', output.stat().st_size, flush=True)

# A browser-only edition runs by double-clicking one HTML file; no installation.
browser = RELEASE / 'MRI_Report_Studio.html'
shutil.copy2(ROOT / 'dist/index.html', browser)
print('Browser edition:', browser, flush=True)
