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

test('Stable updater verifies a local user-data backup before changing the installed application', () => {
  assert.doesNotMatch(main, /updates:set-channel|channel-preference/);
  assert.match(main, /createVerifiedUserDataBackup/);
  assert.match(main, /user-data-backup-start/);
  assert.match(main, /user-data-backup-verified/);
  assert.ok(main.indexOf('await createVerifiedUserDataBackup()') < main.indexOf('installUpdateArchive({'));
  assert.match(main, /verifySha256\(archive,update\.sha256\)/);
  assert.match(main, /errorCode, phase: updatePhase/);
});
