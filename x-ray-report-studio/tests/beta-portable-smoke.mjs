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
const archive = path.join(root, 'test-output', 'X-ray_Report_Studio_Windows_Beta_Setup.zip');
const synthetic = await mkdtemp(path.join(os.tmpdir(), 'XRS-Beta-Smoke-'));
const extracted = path.join(synthetic, 'Распакованный Beta комплект');
const executable = path.join(extracted, 'X-ray Report Studio.exe');
const launcher = path.join(extracted, 'Start-XRS-Beta.cmd');
const pidFile = path.join(synthetic, 'beta-process.pid');
const appData = path.join(synthetic, 'Roaming');
const stable = path.join(appData, 'MRI Report Studio');
const beta = path.join(appData, 'MRI Report Studio Beta');
let application;
const launchArgs = [`--user-data-dir=${beta}`, '--no-sandbox'];
async function launchBeta(env) {
  return _electron.launch({ executablePath: executable, args: launchArgs, cwd: extracted, env });
}
async function canonical(file) { return (await realpath(file)).toLocaleLowerCase('en-US'); }
try {
  const quote = value => value.replaceAll("'", "''");
  await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(extracted)}' -Force`]);
  await mkdir(stable, { recursive: true });
  await writeFile(path.join(stable, 'synthetic-workspace.json'), '{"synthetic":true}');
  const env = { ...process.env, APPDATA: appData, PUBLIC: path.join(synthetic, 'Public'), XRS_BETA_USER_DATA_DIR: beta, XRS_BETA_SMOKE_PID_FILE: pidFile };
  assert.equal(await stat(launcher).then(() => true, () => false), true, 'the exact Beta ZIP must contain its standard CMD launcher');
  await promisify(execFile)('cmd.exe', ['/d', '/c', 'call', `"${launcher}"`], { cwd: extracted, env });
  for (let attempt = 0; attempt < 100 && !(await stat(pidFile).then(() => true, () => false)); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await stat(pidFile).then(() => true, () => false), true, 'standard CMD launcher must start the packaged EXE');
  const firstPid = (await readFile(pidFile, 'utf8')).trim();
  assert.match(firstPid, /^\d+$/);
  await promisify(execFile)('taskkill.exe', ['/PID', firstPid, '/T', '/F']);

  application = await launchBeta(env);
  let page = await application.firstWindow();
  await page.locator('#settings').waitFor();
  const state = await page.evaluate(() => window.desktop.getUpdateChannel());
  assert.equal(state.version, '0.4.55-beta.1');
  assert.equal(state.channel, 'beta');
  assert.equal(state.profile, 'beta');
  const actualUserData = await application.evaluate(({ app }) => app.getPath('userData'));
  const actualSessionData = await application.evaluate(({ app }) => app.getPath('sessionData'));
  assert.equal(await canonical(actualUserData), await canonical(beta), 'packaged EXE must use the isolated temporary Beta profile');
  assert.equal(await canonical(actualSessionData), await canonical(path.join(beta, 'Session Data')));
  const realSynthetic = await canonical(synthetic), realProfile = await canonical(actualUserData);
  const relativeProfile = path.win32.relative(realSynthetic, realProfile);
  assert.ok(relativeProfile && !relativeProfile.startsWith('..') && !path.win32.isAbsolute(relativeProfile), 'profile must stay inside temporary test data, not the runner account');
  assert.equal(await readFile(path.join(stable, 'synthetic-workspace.json'), 'utf8'), '{"synthetic":true}');
  assert.equal(await stat(path.join(appData, 'X-ray Report Studio Backups')).then(() => true, () => false), true);
  await page.evaluate(() => localStorage.setItem('xrs-beta-smoke-restart', 'synthetic-profile-retained'));
  await application.close();
  application = await launchBeta(env);
  page = await application.firstWindow();
  await page.locator('#settings').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('xrs-beta-smoke-restart')), 'synthetic-profile-retained', 'Beta relaunch must reopen the same isolated profile');
  assert.equal(await canonical(await application.evaluate(({ app }) => app.getPath('userData'))), await canonical(beta));
  assert.equal(await readFile(path.join(stable, 'synthetic-workspace.json'), 'utf8'), '{"synthetic":true}', 'Beta startup and restart must not change Stable files');
  console.log('PASS: extracted Beta ZIP includes runtime and launcher; CMD launch, isolated profile and restart were verified.');
} finally {
  await application?.close();
  await rm(synthetic, { recursive: true, force: true });
}
