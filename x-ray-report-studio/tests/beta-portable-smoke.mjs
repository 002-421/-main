import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
try {
  await mkdir(stable, { recursive: true });
  await writeFile(path.join(stable, 'synthetic-workspace.json'), '{"synthetic":true}');
  const env = { ...process.env, APPDATA: appData, PUBLIC: path.join(synthetic, 'Public') };
  await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(executable), 'Start-XRS-Beta.ps1'), '-ValidationOnly'], { env });
  application = await _electron.launch({ executablePath: executable, args: [], cwd: path.dirname(executable), env });
  const page = await application.firstWindow();
  await page.locator('#settings').waitFor();
  const state = await page.evaluate(() => window.desktop.getUpdateChannel());
  assert.equal(state.version, '0.4.55-beta.1');
  assert.equal(state.channel, 'beta');
  assert.equal(state.profile, 'beta');
  assert.equal(path.resolve(await application.evaluate(({ app }) => app.getPath('userData'))), path.resolve(beta));
  assert.equal(path.resolve(await application.evaluate(({ app }) => app.getPath('sessionData'))), path.resolve(path.join(beta, 'Session Data')));
  assert.equal(await readFile(path.join(stable, 'synthetic-workspace.json'), 'utf8'), '{"synthetic":true}');
  assert.equal(await stat(path.join(appData, 'X-ray Report Studio Backups')).then(() => true, () => false), true);
  console.log('PASS: packaged Windows Beta EXE starts after verified synthetic backup with an isolated profile.');
} finally {
  await application?.close();
  await rm(synthetic, { recursive: true, force: true });
}
