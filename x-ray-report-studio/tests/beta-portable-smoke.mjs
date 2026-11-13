import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright-core';

if (process.platform !== 'win32') {
  console.log('SKIP: packaged Beta smoke test requires a Windows runner.');
  process.exit(0);
}
const root = process.cwd();
const executable = path.join(root, 'release', 'X-ray Report Studio', 'X-ray Report Studio.exe');
const synthetic = await mkdtemp(path.join(os.tmpdir(), 'XRS-Beta-Smoke-'));
const appData = path.join(synthetic, 'Roaming');
const stable = path.join(appData, 'MRI Report Studio');
const beta = path.join(appData, 'MRI Report Studio Beta');
let application;
const launchArgs = [`--user-data-dir=${beta}`, '--no-sandbox'];
async function launchBeta(env) {
  return _electron.launch({ executablePath: executable, args: launchArgs, cwd: path.dirname(executable), env });
}
async function canonical(file) { return (await realpath(file)).toLocaleLowerCase('en-US'); }
try {
  await mkdir(stable, { recursive: true });
  await writeFile(path.join(stable, 'synthetic-workspace.json'), '{"synthetic":true}');
  const env = { ...process.env, APPDATA: appData, PUBLIC: path.join(synthetic, 'Public') };
  await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(executable), 'Start-XRS-Beta.ps1'), '-ValidationOnly'], { env });
  application = await launchBeta(env);
  const page = await application.firstWindow();
  await page.locator('#settings').waitFor();
  const state = await page.evaluate(() => window.desktop.getUpdateChannel());
  assert.equal(state.version, '0.4.55-beta.1');
  assert.equal(state.channel, 'beta');
  assert.equal(state.profile, 'beta');
  const actualUserData = await application.evaluate(({ app }) => app.getPath('userData'));
  const actualSessionData = await application.evaluate(({ app }) => app.getPath('sessionData'));
  assert.equal(await canonical(actualUserData), await canonical(beta), 'packaged EXE must use the explicitly isolated temporary Beta profile');
  assert.equal(await canonical(actualSessionData), await canonical(path.join(beta, 'Session Data')));
  const realSynthetic = await canonical(synthetic), realProfile = await canonical(actualUserData);
  const relativeProfile = path.win32.relative(realSynthetic, realProfile);
  assert.ok(relativeProfile && !relativeProfile.startsWith('..') && !path.win32.isAbsolute(relativeProfile), 'packaged EXE must not write into the Windows runner account profile');
  assert.equal(await readFile(path.join(stable, 'synthetic-workspace.json'), 'utf8'), '{"synthetic":true}');
  assert.equal(await stat(path.join(appData, 'X-ray Report Studio Backups')).then(() => true, () => false), true);
  await page.evaluate(() => localStorage.setItem('xrs-beta-smoke-restart', 'synthetic-profile-retained'));
  await application.close();
  application = await launchBeta(env);
  const restartedPage = await application.firstWindow();
  await restartedPage.locator('#settings').waitFor();
  assert.equal(await restartedPage.evaluate(() => localStorage.getItem('xrs-beta-smoke-restart')), 'synthetic-profile-retained', 'Beta relaunch must reopen the same isolated profile');
  assert.equal(await canonical(await application.evaluate(({ app }) => app.getPath('userData'))), await canonical(beta));
  assert.equal(await readFile(path.join(stable, 'synthetic-workspace.json'), 'utf8'), '{"synthetic":true}', 'Beta startup and restart must not change Stable files');
  console.log('PASS: packaged Beta EXE and restart use the isolated temporary profile; Stable files are unchanged.');
} finally {
  await application?.close();
  await rm(synthetic, { recursive: true, force: true });
}
