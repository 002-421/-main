import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { installUpdateArchive, writeShortcutAtomically } = require('../electron/update-install.cjs');
const { createUserDataBackup, verifyUserDataBackup } = require('../electron/user-data-backup.cjs');
const { CURRENT_DATA_CONTRACT } = require('../electron/data-compatibility.cjs');
const {
  canRollback, samePath, isInstallConfirmed,
  getPendingFirstStartAction, reconcileStableInstallState, recordFirstStartAttempt, confirmFirstStart,
} = require('../electron/install-state.cjs');

async function createWindowsShortcut(filename, { target, cwd, icon }) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const electronExe = path.join(testDir, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const worker = path.join(testDir, 'windows-shortcut-worker.cjs');
  await execFileAsync(electronExe, [worker], {
    env: { ...process.env, XRS_SHORTCUT_PATH: filename, XRS_SHORTCUT_TARGET: target, XRS_SHORTCUT_CWD: cwd, XRS_SHORTCUT_ICON: icon },
    windowsHide: true,
  });
  return true;
}

test('Windows paths with spaces and Cyrillic keep old installs, atomically replace shortcuts and verify a profile backup', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'XRS интеграция test '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const installParent = path.join(root, 'Установка X-ray Report Studio');
  const currentRoot = path.join(installParent, 'App_0.4.53');
  const appData = path.join(root, 'Профиль пользователя', 'AppData');
  const profile = path.join(root, 'Профиль пользователя', 'Данные приложения');
  const backupRoot = path.join(appData, 'X-ray Report Studio Backups');
  await fs.mkdir(path.join(currentRoot, 'resources', 'app', 'electron'), { recursive: true });
  await fs.mkdir(path.join(currentRoot, 'resources', 'app', 'dist'), { recursive: true });
  await fs.writeFile(path.join(currentRoot, 'X-ray Report Studio.exe'), 'synthetic runtime');
  await fs.writeFile(path.join(currentRoot, 'resources', 'electron.dll'), 'synthetic runtime dependency');
  await fs.writeFile(path.join(currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'previous synthetic app');

  const updatePackage = {
    'X-ray Report Studio Setup/app/package.json': strToU8(JSON.stringify({ version: '0.4.54', main: 'electron/main.cjs' })),
    'X-ray Report Studio Setup/app/electron/main.cjs': strToU8('updated synthetic app'),
    'X-ray Report Studio Setup/app/dist/index.html': strToU8('<html>synthetic update</html>'),
  };
  // The production updater stages downloaded archives in the ASCII-named OS temp
  // directory before calling tar.exe; keep the destination path Unicode below.
  const archiveDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs05-update-'));
  t.after(() => fs.rm(archiveDirectory, { recursive: true, force: true }));
  const archive = path.join(archiveDirectory, 'synthetic-update.zip');
  await fs.writeFile(archive, Buffer.from(zipSync(updatePackage)));
  const installed = await installUpdateArchive({ archive, currentRoot, version: '0.4.54' });
  assert.equal(await fs.readFile(path.join(currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'previous synthetic app');
  assert.equal(await fs.readFile(path.join(installed.root, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'updated synthetic app');
  assert.equal(await fs.readFile(path.join(installed.root, 'resources', 'electron.dll'), 'utf8'), 'synthetic runtime dependency');

  const shortcutDirectory = path.join(root, 'Shortcuts');
  await fs.mkdir(shortcutDirectory, { recursive: true });
  const shortcut = path.join(shortcutDirectory, 'X-ray Report Studio Тест.lnk');
  const oldTarget = path.join(currentRoot, 'X-ray Report Studio.exe');
  const newTarget = installed.executable;
  await writeShortcutAtomically({ shortcutPath: shortcut, target: oldTarget, cwd: currentRoot, icon: '', writeShortcutLink: createWindowsShortcut });
  await writeShortcutAtomically({ shortcutPath: shortcut, target: newTarget, cwd: installed.root, icon: '', writeShortcutLink: createWindowsShortcut });
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const electronExe = path.join(testDir, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const worker = path.join(testDir, 'windows-shortcut-worker.cjs');
  const { stdout } = await execFileAsync(electronExe, [worker], {
    env: { ...process.env, XRS_SHORTCUT_PATH: shortcut }, windowsHide: true,
  });
  const actualTarget = JSON.parse(stdout).target;
  const canonicalTargets = typeof actualTarget === 'string'
    ? await Promise.all([fs.realpath(actualTarget), fs.realpath(newTarget)])
    : [];
  if (canonicalTargets.length !== 2
      || canonicalTargets[0].toLocaleLowerCase('en-US') !== canonicalTargets[1].toLocaleLowerCase('en-US')) {
    throw new Error(`Synthetic shortcut target mismatch: expected ${newTarget}; actual ${actualTarget ?? '<missing>'}.`);
  }

  const storage = path.join(profile, 'Local Storage', 'leveldb');
  await fs.mkdir(storage, { recursive: true });
  await fs.writeFile(path.join(storage, 'synthetic-workspace.ldb'), JSON.stringify({ reports: ['SYNTHETIC REPORT A', 'SYNTHETIC REPORT B'] }));
  await fs.writeFile(path.join(profile, 'dictionary.json'), JSON.stringify(['синтетическое-слово']));
  const backup = await createUserDataBackup({ userDataDir: profile, backupRoot, allowedBackupRoot: appData, forbiddenRoots: [currentRoot, installed.root], version: '0.4.54' });
  assert.equal((await verifyUserDataBackup(backup.directory)).files, 2);
  assert.equal(await fs.readFile(path.join(backup.directory, 'data', 'profile', 'dictionary.json'), 'utf8'), '["синтетическое-слово"]');

  const state = { status: 'stable', current: { version: '0.4.54', root: installed.root }, previous: { version: '0.4.53', root: currentRoot, executable: oldTarget, dataSchemaVersion: 1 } };
  assert.equal(canRollback({ installState: state, dataState: { schemaVersion: 1, dataContract: CURRENT_DATA_CONTRACT }, currentRoot: installed.root }).available, true);
  assert.equal(canRollback({ installState: state, dataState: { schemaVersion: 1, dataContract: 'future-unknown-contract' }, currentRoot: installed.root }).available, false);
});

test('Windows .56 → .57 → .58 handoff and stale Stable-state recovery validate the real shortcut and runtime', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'XRS обновление Stable '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installParent = path.join(root, 'Установка X-ray Report Studio');
  const shortcut = path.join(root, 'Ярлыки', 'X-ray Report Studio.lnk');
  const roots = Object.fromEntries(['0.4.56', '0.4.57', '0.4.58'].map(version => [version, path.join(installParent, version === '0.4.57' ? 'App_0.4.57-366a1757' : `App_${version}`)]));
  const executables = Object.fromEntries(Object.entries(roots).map(([version, appRoot]) => [version, path.join(appRoot, 'X-ray Report Studio.exe')]));
  for (const [version, executable] of Object.entries(executables)) {
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, `synthetic Electron runtime ${version}`);
  }
  await fs.mkdir(path.dirname(shortcut), { recursive: true });
  const setShortcut = target => writeShortcutAtomically({ shortcutPath: shortcut, target, cwd: path.dirname(target), icon: '', writeShortcutLink: createWindowsShortcut });
  const getShortcutTarget = async () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const electronExe = path.join(testDir, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
    const worker = path.join(testDir, 'windows-shortcut-worker.cjs');
    const { stdout } = await execFileAsync(electronExe, [worker], { env: { ...process.env, XRS_SHORTCUT_PATH: shortcut }, windowsHide: true });
    return JSON.parse(stdout).target;
  };
  const canonicalTargetIs = async expected => {
    const actual = await getShortcutTarget();
    const [realActual, realExpected] = await Promise.all([fs.realpath(actual), fs.realpath(expected)]);
    return realActual.toLocaleLowerCase('en-US') === realExpected.toLocaleLowerCase('en-US');
  };
  await setShortcut(executables['0.4.56']);
  let state = {
    status: 'pending-first-start', launchAttempts: 0,
    current: { version: '0.4.57', root: roots['0.4.57'], executable: executables['0.4.57'] },
    previous: { version: '0.4.56', root: roots['0.4.56'], executable: executables['0.4.56'] },
  };
  assert.equal(getPendingFirstStartAction(state, roots['0.4.56'], executables['0.4.56'], '0.4.56'), 'handoff-to-candidate');
  assert.equal(state.launchAttempts, 0, 'the old runtime must not consume the first-start confirmation');
  await setShortcut(state.current.executable);
  assert.equal(await canonicalTargetIs(executables['0.4.57']), true, 'Windows .lnk resolves to the actual 0.4.57 executable');
  assert.equal(getPendingFirstStartAction(state, roots['0.4.57'], executables['0.4.57'], '0.4.57'), 'candidate');
  state = recordFirstStartAttempt(state, roots['0.4.57'], executables['0.4.57'], '0.4.57', '2026-01-01T00:00:00.000Z');
  state = confirmFirstStart(state, roots['0.4.57'], executables['0.4.57'], '0.4.57', '2026-01-01T00:00:01.000Z');
  assert.equal(state.status, 'stable');

  state = {
    status: 'pending-first-start', launchAttempts: 0,
    current: { version: '0.4.58', root: roots['0.4.58'], executable: executables['0.4.58'] },
    previous: { version: state.current.version, root: state.current.root, executable: state.current.executable },
  };
  assert.equal(getPendingFirstStartAction(state, roots['0.4.57'], executables['0.4.57'], '0.4.57'), 'handoff-to-candidate');
  await setShortcut(state.current.executable);
  assert.equal(await canonicalTargetIs(executables['0.4.58']), true, 'Windows .lnk resolves to the actual 0.4.58 executable');
  const actualExecutable = await fs.realpath(executables['0.4.58']);
  const actualRoot = path.dirname(actualExecutable);
  assert.equal(samePath(state.current.root, actualRoot), true, '8.3 and long Windows paths identify the same installed directory');
  assert.equal(getPendingFirstStartAction(state, actualRoot, actualExecutable, '0.4.58'), 'candidate');
  state = recordFirstStartAttempt(state, actualRoot, actualExecutable, '0.4.58', '2026-01-01T00:00:02.000Z');
  state = confirmFirstStart(state, actualRoot, actualExecutable, '0.4.58', '2026-01-01T00:00:03.000Z');
  assert.equal(state.status, 'stable');
  assert.equal(state.current.version, '0.4.58');
  assert.equal(isInstallConfirmed(state, actualRoot, actualExecutable, '0.4.58'), true);

  const actualAppPath = path.join(roots['0.4.58'], 'resources', 'app');
  await fs.mkdir(path.join(actualAppPath, 'electron'), { recursive: true });
  await fs.writeFile(path.join(actualAppPath, 'package.json'), JSON.stringify({ version: '0.4.58', main: 'electron/main.cjs' }));
  await fs.writeFile(path.join(actualAppPath, 'electron', 'main.cjs'), 'synthetic app entry');
  const staleStableState = {
    status: 'stable', launchAttempts: 0,
    current: { version: '0.4.57', root: roots['0.4.57'], executable: executables['0.4.57'], dataSchemaVersion: 1 },
    previous: { version: '0.4.56', root: roots['0.4.56'], executable: executables['0.4.56'], dataSchemaVersion: 1 },
  };
  await setShortcut(executables['0.4.58']);
  const actualShortcutTarget = await getShortcutTarget();
  const recovered = reconcileStableInstallState({
    installState: staleStableState,
    dataState: { schemaVersion: 1, dataContract: CURRENT_DATA_CONTRACT },
    runtimeVersion: '0.4.58', runtimeRoot: roots['0.4.58'],
    runtimeExecutable: executables['0.4.58'], runtimeAppPath: actualAppPath,
    shortcutTarget: actualShortcutTarget,
  });
  assert.ok(recovered, 'real Windows shortcut and matching packaged runtime allow conservative state repair');
  assert.equal(recovered.status, 'stable');
  assert.equal(recovered.current.version, '0.4.58');
  assert.equal(recovered.previous.version, '0.4.57');
  assert.equal(isInstallConfirmed(recovered, roots['0.4.58'], executables['0.4.58'], '0.4.58'), true);
  assert.equal(canRollback({ installState: recovered, dataState: { schemaVersion: 1, dataContract: CURRENT_DATA_CONTRACT }, currentRoot: roots['0.4.58'] }).available, true);
  assert.equal(reconcileStableInstallState({
    installState: staleStableState,
    dataState: { schemaVersion: 1, dataContract: CURRENT_DATA_CONTRACT },
    runtimeVersion: '0.4.58', runtimeRoot: roots['0.4.58'],
    runtimeExecutable: executables['0.4.58'], runtimeAppPath: actualAppPath,
    shortcutTarget: executables['0.4.57'],
  }), null, 'mismatched shortcut prevents recovery from confirming Stable');
});
