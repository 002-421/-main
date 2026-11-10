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
const { canRollback } = require('../electron/install-state.cjs');

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
  if (typeof actualTarget !== 'string'
      || path.resolve(actualTarget).toLocaleLowerCase('en-US') !== path.resolve(newTarget).toLocaleLowerCase('en-US')) {
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
