import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { parseVersion, compareVersions, isUpdateAvailable } = require('../electron/update-version.cjs');
const { STABLE_MANIFEST, BETA_MANIFEST, profileForLaunch, validateManifest, chooseUpdate } = require('../electron/update-channel.cjs');
const { changeUpdateChannel } = require('../electron/channel-preference.cjs');
const { downloadHttps } = require('../electron/update-download.cjs');
const sha256 = 'a'.repeat(64);
const stable = validateManifest({ version: '0.4.54', url: 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Setup.zip', sha256 }, 'stable');
const beta = validateManifest({ version: '0.4.55-beta.1', url: 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/x-ray-report-studio/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip', sha256 }, 'beta');

test('Stable never advertises Beta while Beta accepts newer prereleases and stable releases', () => {
  assert.match(STABLE_MANIFEST, /\/latest\.json$/);
  assert.match(BETA_MANIFEST, /\/beta\.json$/);
  assert.equal(chooseUpdate('stable', '0.4.54', [stable, beta]).available, false);
  assert.equal(chooseUpdate('beta', '0.4.54', [stable, beta]).version, '0.4.55-beta.1');
  assert.equal(chooseUpdate('beta', '0.4.55-beta.1', [stable, beta]).available, false);
  const released = { ...stable, version: '0.4.55' };
  assert.equal(chooseUpdate('beta', '0.4.55-beta.1', [released, beta]).version, '0.4.55');
  assert.equal(chooseUpdate('beta', '0.4.55', [stable, beta]).available, false);
});

test('prerelease ordering is monotonic and malformed versions are rejected', () => {
  assert.equal(compareVersions('0.4.55-beta.2', '0.4.55-beta.1'), 1);
  assert.equal(compareVersions('0.4.55', '0.4.55-beta.9'), 1);
  assert.equal(compareVersions('0.4.55-beta.1', '0.4.54'), 1);
  assert.equal(isUpdateAvailable('0.4.55-beta.1', '0.4.54', 'stable'), false);
  assert.equal(isUpdateAvailable('0.4.55-beta.1', '0.4.54', 'beta'), true);
  assert.equal(parseVersion('0.4.55-beta.0'), null);
  assert.equal(parseVersion('0.4.55-rc.1'), null);
});

test('manifest validation preserves fixed trusted hosts, filenames and checksums', () => {
  assert.equal(beta.sha256, sha256);
  for (const url of [
    'http://github.com/002-421/-main/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip',
    'https://evil.example/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip',
    stable.url,
    beta.url.replace('/codex/mri-report-studio/', '/main/'),
    `${beta.url}?other=1`,
  ]) assert.throws(() => validateManifest({ version: beta.version, url, sha256 }, 'beta'), /Недопустимая ссылка/);
  assert.throws(() => validateManifest({ version: beta.version, url: beta.url, sha256: 'bad' }, 'beta'), /некорректные данные/);
  assert.throws(() => validateManifest({ version: beta.version, url: beta.url, sha256 }, 'stable'), /некорректные данные/);
  assert.equal(validateManifest({ version: beta.version, url: 'XRS_Test_Update_0.4.55-beta.2.zip', sha256 }, 'beta', '/tmp/Тест с пробелом').url.startsWith('file:'), true);
});

test('Beta executable and opted-in Stable executable use an isolated profile', () => {
  assert.equal(profileForLaunch('0.4.54', null), 'stable');
  assert.equal(profileForLaunch('0.4.55-beta.1', null), 'beta');
  assert.equal(profileForLaunch('0.4.54', { profile: 'beta' }), 'beta');
  assert.equal(profileForLaunch('0.4.55-beta.1', { profile: 'stable' }), 'beta');
});

test('first Beta switch verifies a backup before changing the local channel', async () => {
  const events = [];
  const result = await changeUpdateChannel({ requested: 'beta', current: 'stable', profile: 'stable',
    backup: async () => { events.push('backup'); }, persist: async value => { events.push(value); } });
  assert.deepEqual(events, ['backup', { channel: 'beta', profile: 'beta', onboarded: true }]);
  assert.equal(result.restarting, true);
  let persisted = false;
  await assert.rejects(changeUpdateChannel({ requested: 'beta', current: 'stable', profile: 'stable',
    backup: async () => { throw new Error('backup failed'); }, persist: async () => { persisted = true; } }), /backup failed/);
  assert.equal(persisted, false);
  const stableAgain = await changeUpdateChannel({ requested: 'stable', current: 'beta', profile: 'beta',
    backup: async () => assert.fail('Beta-to-Stable never copies patient data'), persist: async value => { assert.equal(value.profile, 'beta'); } });
  assert.equal(stableAgain.restarting, false);
  assert.equal(stableAgain.profile, 'beta');
});

test('download errors and truncated packages cannot reach the installer', async () => {
  const request = (status, headers = {}, chunks = []) => (_url, _options, callback) => {
    const transport = new EventEmitter();
    transport.destroy = error => transport.emit('error', error);
    queueMicrotask(() => {
      const response = new PassThrough(); response.statusCode = status; response.headers = headers;
      callback(response);
      for (const chunk of chunks) response.write(Buffer.from(chunk));
      response.end();
    });
    return transport;
  };
  const url = 'https://github.com/002-421/-main/downloads/X-ray_Report_Studio_Windows_Beta_Setup.zip';
  await assert.rejects(downloadHttps(url, 100, 0, () => {}, request(404)), /ответил 404/);
  await assert.rejects(downloadHttps(url, 100, 0, () => {}, request(200, { 'content-length': '10' }, ['short'])), /не полностью/);
  await assert.rejects(downloadHttps(url, 4, 0, () => {}, request(200, { 'content-length': '5' }, ['12345'])), /больше допустимого размера/);
  await assert.rejects(downloadHttps(url, 100, 0, () => {}, request(302, { location: 'https://evil.example/payload.zip' })), /Недопустимый источник/);
});
