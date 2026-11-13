import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts/verify_windows_portable.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
const zipFixture = String.raw`
import struct
import sys
from zipfile import ZIP_STORED, ZipFile

archive, html_path, missing, corrupt = sys.argv[1:]
root = 'X-ray Report Studio/'
html = open(html_path, 'rb').read()
files = {
    root + 'X-ray Report Studio.exe': b'synthetic executable fixture',
    root + 'chrome_100_percent.pak': b'chromium scale resources',
    root + 'chrome_200_percent.pak': b'chromium scale resources',
    root + 'd3dcompiler_47.dll': b'synthetic runtime component',
    root + 'electron_wer.dll': b'synthetic runtime component',
    root + 'ffmpeg.dll': b'synthetic runtime component',
    root + 'icudtl.dat': b'synthetic locale data',
    root + 'resources.pak': b'chromium runtime resources with enough bytes to corrupt',
    root + 'resources/default_app.asar': b'official default app fixture',
    root + 'snapshot_blob.bin': b'synthetic v8 snapshot',
    root + 'v8_context_snapshot.bin': b'synthetic v8 context snapshot',
    root + 'locales/en-US.pak': b'synthetic locale resources',
    root + 'resources/app/dist/index.html': html,
    root + 'resources/app/electron/main.cjs': b'// synthetic app entry point',
}
if missing:
    files.pop(root + missing, None)
with ZipFile(archive, 'w', ZIP_STORED) as package:
    for name, contents in files.items():
        package.writestr(name, contents)
if corrupt == '1':
    with ZipFile(archive) as package:
        member = package.getinfo(root + 'resources.pak')
    with open(archive, 'r+b') as output:
        output.seek(member.header_offset + 26)
        name_length, extra_length = struct.unpack('<HH', output.read(4))
        data_offset = member.header_offset + 30 + name_length + extra_length
        output.seek(data_offset + 2)
        byte = output.read(1)
        output.seek(data_offset + 2)
        output.write(bytes([byte[0] ^ 0xff]))
`;

async function fixture(t, { missing = '', corrupt = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xrs-portable-verifier-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'portable.zip');
  const html = path.join(directory, 'index.html');
  const content = 'dictionary-ru 3.0.0 dictionary-en 4.0.0 OpenCorpora words.dawg абажур гиперинтенсивный';
  await writeFile(html, content, 'utf8');
  execFileSync(python, ['-c', zipFixture, archive, html, missing, corrupt ? '1' : '0']);
  return { archive, html };
}

function verify(archive, html) {
  return spawnSync(python, [verifier, archive, '--expected-html', html], { encoding: 'utf8' });
}

test('Electron 45 portable layout accepts official runtime files without legacy-only members', async t => {
  const { archive, html } = await fixture(t);
  const result = verify(archive, html);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PASS: portable ZIP has Electron runtime/);
  assert.doesNotMatch(result.stdout, /chrome_elf\.dll|electron\.asar/);
});

test('portable verifier still requires shipped Electron runtime components', async t => {
  const { archive, html } = await fixture(t, { missing: 'resources.pak' });
  const result = verify(archive, html);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required files:.*X-ray Report Studio\/resources\.pak/);
});

test('portable verifier rejects a ZIP with a damaged runtime member', async t => {
  const { archive, html } = await fixture(t, { corrupt: true });
  const result = verify(archive, html);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /corrupt ZIP member: X-ray Report Studio\/resources\.pak/);
});
