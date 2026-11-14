import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { parseVersion, compareVersions, isUpdateAvailable } = require('../electron/update-version.cjs');
const { STABLE_MANIFEST, validateManifest, chooseUpdate } = require('../electron/update-channel.cjs');
const sha256 = 'a'.repeat(64);
const url = 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip';
const stable = validateManifest({ version: '0.4.57', url, sha256, notes: 'Stable' });
const testManifest = validateManifest({ version: '0.4.56', url: 'XRS_Test_Update_0.4.56.zip', sha256 }, '/tmp/XRS test');
const releaseWorkflow = await readFile(new URL('../../.github/workflows/xrs-06-publish-release.yml', import.meta.url), 'utf8');

test('Stable reads the existing latest.json and skips directly from 0.4.53, 0.4.54, 0.4.55 or 0.4.56 to 0.4.57', () => {
  assert.match(STABLE_MANIFEST, /\/latest\.json$/);
  for (const current of ['0.4.53', '0.4.54', '0.4.55', '0.4.56']) {
    const update = chooseUpdate('stable', current, [stable]);
    assert.equal(update.version, '0.4.57');
    assert.equal(update.currentVersion, current);
    assert.equal(update.available, true);
    assert.equal(isUpdateAvailable('0.4.57', current), true);
  }
});

test('Stable never selects prereleases and never offers a downgrade or same-version install', () => {
  const prerelease = { ...stable, version: '0.4.58-beta.1', channel: 'stable' };
  assert.equal(chooseUpdate('stable', '0.4.55', [stable, prerelease]).version, '0.4.57');
  assert.equal(chooseUpdate('stable', '0.4.57', [stable]).available, false);
  assert.equal(chooseUpdate('stable', '0.4.58', [stable]).available, false);
  assert.equal(isUpdateAvailable('0.4.57-beta.1', '0.4.55'), false);
});

test('version comparison accepts skipped stable releases and rejects malformed versions', () => {
  assert.equal(compareVersions('0.4.57', '0.4.56'), 1);
  assert.equal(compareVersions('0.4.57', '0.4.53'), 1);
  assert.deepEqual(parseVersion('0.4.57'), { parts: [0, 4, 57], beta: null });
  assert.equal(parseVersion('0.4.57-rc.1'), null);
  assert.equal(testManifest.url.startsWith('file:'), true);
});

test('manifest validation enforces stable version, known archive paths and SHA-256', () => {
  assert.equal(stable.version, '0.4.57');
  assert.equal(stable.sha256, sha256);
  assert.equal(stable.url, url);
  for (const invalidUrl of [
    'http://github.com/002-421/-main/downloads/X-ray_Report_Studio_Windows_Setup.zip',
    'https://evil.example/002-421/-main/downloads/X-ray_Report_Studio_Windows_Setup.zip',
    `${url}?token=secret`,
  ]) assert.throws(() => validateManifest({ version: '0.4.57', url: invalidUrl, sha256 }), /Недопустимая ссылка/);
  assert.throws(() => validateManifest({ version: '0.4.57-beta.1', url, sha256 }), /некорректные данные/);
  assert.throws(() => validateManifest({ version: '0.4.57', url, sha256: 'bad' }), /некорректные данные/);
});

test('0.4.53 and 0.4.55 legacy path checks accept the canonical Stable archive name', () => {
  const parsed = new URL(stable.url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, 'github.com');
  assert.equal(parsed.pathname.endsWith('/downloads/X-ray_Report_Studio_Windows_Setup.zip'), true);
});

test('release workflow publishes, restores, and verifies only the canonical Stable archive URL', () => {
  const canonical = 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip';
  assert.ok(releaseWorkflow.includes(`url='${canonical}'`));
  assert.ok(releaseWorkflow.includes(`manifest.get('url')=='${canonical}'`));
  assert.ok(releaseWorkflow.includes(`fallback['url']='${canonical}'`));
  assert.ok(releaseWorkflow.includes(`value['url']='${canonical}'`));
  assert.ok(releaseWorkflow.includes(`current.get('url')=='${canonical}'`));
  assert.match(releaseWorkflow, /copyfile\(old_zip,downloads\/['"]X-ray_Report_Studio_Windows_Setup\.zip['"]\)/);
  assert.match(releaseWorkflow, /Verified previous-version ZIP is unavailable; refusing to write a rollback manifest/);
  assert.match(releaseWorkflow, /tests\/user-data-backup\.test\.mjs/);
  assert.match(releaseWorkflow, /tests\/windows-integration\.test\.mjs/);
});
