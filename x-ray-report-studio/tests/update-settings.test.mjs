import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../src/workspace.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');

test('settings expose only current version and a manual Stable update check', () => {
  assert.match(workspace, /Текущая версия:[^`]+id="update-current-version"/);
  assert.match(workspace, /id="check-updates"[^>]*>Проверить обновления/);
  for (const removed of ['beta-opt-in', 'update-channel-select', 'auto-update', 'rollback-update', 'open-update-backups']) {
    assert.doesNotMatch(workspace, new RegExp(removed));
  }
  assert.doesNotMatch(preload, /updates:set-channel|updates:rollback|updates:open-backups/);
});

test('update checks have no startup or periodic trigger', () => {
  assert.equal((workspace.match(/checkForAppUpdates\(/g) ?? []).length, 2, 'one function declaration and one manual button handler');
  assert.doesNotMatch(workspace, /setInterval\([^)]*update|checkAutomaticUpdateIfDue|isAutomaticUpdateCheckDue/);
  assert.doesNotMatch(main, /setInterval\([^)]*update|checkForUpdates\(/);
});

test('Stable updater verifies the archive and stages beside the live install before committing the shortcut', () => {
  const installStart = main.indexOf("ipcMain.handle('updates:install'");
  const installEnd = main.indexOf("ipcMain.handle('report:copy'", installStart);
  const installHandler = main.slice(installStart, installEnd);
  assert.doesNotMatch(main, /updates:set-channel|channel-preference/);
  assert.match(installHandler, /verifySha256\(archive,update\.sha256\)/);
  assert.match(installHandler, /installUpdateArchive\(\{ archive: file, currentRoot: previousRoot, version: update\.version, log \}\)/);
  assert.match(installHandler, /activateRendererUpdate\(/);
  assert.match(installHandler, /pointShortcutTo\(installed\.executable, installed\.root\)/);
  assert.ok(installHandler.indexOf('installUpdateArchive(') < installHandler.indexOf('activateRendererUpdate('));
  assert.ok(installHandler.indexOf('activateRendererUpdate(') < installHandler.indexOf('pointShortcutTo(installed.executable'));
  assert.match(installHandler, /writeJsonAtomic\(installStateFile, nextInstallState\)/);
  assert.match(installHandler, /errorCode, phase: updatePhase/);
  assert.doesNotMatch(main, /runUpdateWorker|spawnDetachedUpdateWorker|acquireUpdateLease|inspectUpdateLease|user-data-backup/);
  assert.doesNotMatch(installHandler, /process\.execPath, app\.getVersion\(\).*Install|isInstallConfirmed/);
});
