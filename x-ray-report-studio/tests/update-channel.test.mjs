import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseVersion, compareVersions, isUpdateAvailable } = require('../electron/update-version.cjs');
const { STABLE_MANIFEST, validateManifest, chooseUpdate } = require('../electron/update-channel.cjs');
const sha256 = 'a'.repeat(64);
const url = 'https://raw.githubusercontent.com/002-421/-main/codex/mri-report-studio/x-ray-report-studio/releases/0.4.56/downloads/X-ray_Report_Studio_Windows_Setup.zip';
const stable = validateManifest({ version: '0.4.56', url, sha256, notes: 'Stable' });
const testManifest = validateManifest({ version: '0.4.56', url: 'XRS_Test_Update_0.4.56.zip', sha256 }, '/tmp/XRS test');

test('Stable reads the existing latest.json and skips directly from 0.4.53 or 0.4.55 to 0.4.56', () => {
  assert.match(STABLE_MANIFEST, /\/latest\.json$/);
  for (const current of ['0.4.53', '0.4.55']) {
    const update = chooseUpdate('stable', current, [stable]);
    assert.equal(update.version, '0.4.56');
    assert.equal(update.currentVersion, current);
    assert.equal(update.available, true);
    assert.equal(isUpdateAvailable('0.4.56', current), true);
  }
});

test('Stable never selects prereleases and never offers a downgrade or same-version install', () => {
  const prerelease = { ...stable, version: '0.4.57-beta.1', channel: 'stable' };
  assert.equal(chooseUpdate('stable', '0.4.55', [stable, prerelease]).version, '0.4.56');
  assert.equal(chooseUpdate('stable', '0.4.56', [stable]).available, false);
  assert.equal(chooseUpdate('stable', '0.4.57', [stable]).available, false);
  assert.equal(isUpdateAvailable('0.4.57-beta.1', '0.4.55'), false);
});

test('version comparison accepts skipped stable releases and rejects malformed versions', () => {
  assert.equal(compareVersions('0.4.56', '0.4.55'), 1);
  assert.equal(compareVersions('0.4.56', '0.4.53'), 1);
  assert.deepEqual(parseVersion('0.4.56'), { parts: [0, 4, 56], beta: null });
  assert.equal(parseVersion('0.4.56-rc.1'), null);
  assert.equal(testManifest.url.startsWith('file:'), true);
});

test('manifest validation enforces stable version, known archive paths and SHA-256', () => {
  assert.equal(stable.version, '0.4.56');
  assert.equal(stable.sha256, sha256);
  assert.equal(stable.url, url);
  for (const invalidUrl of [
    'http://github.com/002-421/-main/downloads/X-ray_Report_Studio_Windows_Setup.zip',
    'https://evil.example/002-421/-main/downloads/X-ray_Report_Studio_Windows_Setup.zip',
    url.replace('/releases/0.4.56/', '/releases/0.4.55/'),
    `${url}?token=secret`,
  ]) assert.throws(() => validateManifest({ version: '0.4.56', url: invalidUrl, sha256 }), /Недопустимая ссылка/);
  assert.throws(() => validateManifest({ version: '0.4.56-beta.1', url, sha256 }), /некорректные данные/);
  assert.throws(() => validateManifest({ version: '0.4.56', url, sha256: 'bad' }), /некорректные данные/);
});

test('0.4.53 updater accepts versioned ZIP paths because the archive suffix and trusted GitHub host stay unchanged', () => {
  const parsed = new URL(stable.url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'raw.githubusercontent.com');
  assert.equal(parsed.pathname.endsWith('/downloads/X-ray_Report_Studio_Windows_Setup.zip'), true);
  assert.match(parsed.pathname, /\/releases\/0\.4\.56\/downloads\//);
});
