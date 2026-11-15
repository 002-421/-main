import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runUpdateWorker, waitForParentExit } = require('../electron/update-worker.cjs');
const { writeJsonAtomic } = require('../electron/install-state.cjs');
const { acquireUpdateLease, inspectUpdateLease, releaseUpdateLease } = require('../electron/update-lease.cjs');

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs-worker-recovery-'));
  const currentRoot = path.join(root, 'App_0.4.58');
  const profile = path.join(root, 'Профиль', 'MRI Report Studio');
  const archive = path.join(root, 'updates', 'XRS-0.4.59.zip');
  const cacheRoot = path.dirname(archive);
  const installStateFile = path.join(profile, 'install-state.json');
  const executable = path.join(currentRoot, 'X-ray Report Studio.exe');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.mkdir(currentRoot, { recursive: true });
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(archive, 'synthetic verified update archive');
  await fs.writeFile(path.join(profile, 'workspace.json'), 'synthetic open document and tabs');
  await fs.writeFile(executable, 'synthetic old runtime');
  const previousState = {
    status: 'stable', launchAttempts: 0,
    current: { version: '0.4.58', root: currentRoot, executable, dataSchemaVersion: 1 },
    previous: { version: '0.4.57', root: path.join(root, 'App_0.4.57'), executable: path.join(root, 'App_0.4.57', 'X-ray Report Studio.exe'), dataSchemaVersion: 1 },
  };
  await writeJsonAtomic(installStateFile, previousState);
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const nextRoot = path.join(root, 'App_0.4.59');
  const config = {
    format: 'xrs-update-handoff', schemaVersion: 1, parentPid: 12345, archive, cacheRoot, sha256, version: '0.4.59', currentVersion: '0.4.58', currentRoot,
    userDataDir: profile, sharedDictionaryFile: '', backupRoot: path.join(root, 'Backups'), allowedBackupRoot: root,
    installStateFile, dataSchemaFile: path.join(profile, 'data-schema.json'), shortcutPath: path.join(root, 'Desktop', 'XRS.lnk'),
    logFile: path.join(profile, 'logs', 'update.log'),
    resultFile: path.join(root, 'updates', 'result.json'), handoffFile: path.join(root, 'updates', 'handoff.json'),
    previous: previousState.current, previousState, executable,
  };
  return { root, currentRoot, profile, archive, installStateFile, previousState, nextRoot, config };
}

function dependencies(f, overrides = {}) {
  const calls = { log: [], shortcut: [], launched: [], backup: 0, install: 0, smoke: 0 };
  return {
    calls,
    app: {}, shell: { writeShortcutLink: async () => true },
    waitForParentExit: async pid => { calls.parentPid = pid; },
    createUserDataBackup: async options => {
      calls.backup++;
      await options.onOperation({ event: 'file-operation-complete', phase: 'user-data-backup', operation: 'read-source-for-sha256', path: 'profile/workspace.json' });
      return { directory: path.join(f.root, 'Backups', 'verified'), files: 1, bytes: 28 };
    },
    installUpdateArchive: async options => { calls.install++; calls.installArchive = options.archive; return { root: f.nextRoot, executable: path.join(f.nextRoot, 'X-ray Report Studio.exe'), icon: '' }; },
    smokeTestInstalledApp: async () => { calls.smoke++; return { ready: true, version: '0.4.59' }; },
    writeJsonAtomic,
    ensureDataSchema: async () => ({ schemaVersion: 1 }),
    writeShortcutAtomically: async options => { calls.shortcut.push(options.target); },
    readShortcutTarget: async () => calls.shortcut.at(-1),
    launchDetached: (exe, args, options) => calls.launched.push({ exe, args, cwd: options.cwd }),
    log: async entry => calls.log.push(entry),
    ...overrides,
  };
}

test('worker waits for the old Electron process, backs up after exit, stages side by side and only then commits shortcut/state', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const deps = dependencies(f);
  const result = await runUpdateWorker(f.config, deps);
  assert.deepEqual(result, { installed: true, version: '0.4.59' });
  assert.equal(deps.calls.parentPid, 12345);
  assert.equal(deps.calls.backup, 1);
  assert.equal(deps.calls.log.some(entry => entry.event === 'user-data-backup-override-authorized'), false);
  assert.equal(deps.calls.installArchive, f.archive);
  assert.ok(deps.calls.log.findIndex(entry => entry.event === 'update-worker-parent-exited') < deps.calls.log.findIndex(entry => entry.event === 'user-data-backup-start'));
  assert.ok(deps.calls.log.filter(entry => entry.event === 'file-operation-complete').every(entry => entry.processState === 'main-exited'));
  assert.equal(deps.calls.shortcut[0], path.join(f.nextRoot, 'X-ray Report Studio.exe'));
  assert.equal(deps.calls.launched[0].exe, path.join(f.nextRoot, 'X-ray Report Studio.exe'));
  const state = JSON.parse(await fs.readFile(f.installStateFile, 'utf8'));
  assert.equal(state.status, 'pending-first-start');
  assert.equal(state.current.version, '0.4.59');
  assert.equal(state.previous.version, '0.4.58');
  assert.equal(await fs.readFile(path.join(f.profile, 'workspace.json'), 'utf8'), 'synthetic open document and tabs');
  await assert.rejects(fs.stat(f.archive), { code: 'ENOENT' });
});

test('worker holds one profile lease through handoff and releases it before launching the candidate', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const lease = await acquireUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile, ownerPid: process.pid });
  f.config.leaseFile = lease.leaseFile;
  f.config.leaseAttemptId = lease.attemptId;
  const deps = dependencies(f, {
    launchDetached: async () => {
      assert.equal((await inspectUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile })).active, false);
    },
  });
  const result = await runUpdateWorker(f.config, deps);
  assert.deepEqual(result, { installed: true, version: '0.4.59' });
  assert.equal((await inspectUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile })).active, false);
});

test('a non-lock backup failure defaults to cancel and leaves the old install and verified archive untouched', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const failure = Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
  let prompts = 0;
  const deps = dependencies(f, {
    createUserDataBackup: async () => { throw failure; },
    confirmBackupFailure: async code => { prompts++; assert.equal(code, 'ENOSPC'); return 0; },
  });
  const result = await runUpdateWorker(f.config, deps);
  assert.deepEqual(result, { installed: false, errorCode: 'BACKUP_OVERRIDE_DECLINED', phase: 'user-data-backup', archiveRetained: true });
  assert.equal(prompts, 1);
  assert.equal(deps.calls.install, 0);
  assert.equal(deps.calls.shortcut.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(f.installStateFile, 'utf8')), f.previousState);
  assert.equal(await fs.readFile(f.archive, 'utf8'), 'synthetic verified update archive');
  assert.ok(deps.calls.log.some(entry => entry.event === 'user-data-backup-override-declined' && entry.errorCode === 'ENOSPC'));
  assert.equal(deps.calls.log.some(entry => entry.event === 'user-data-backup-verified'), false);
});

test('a non-lock backup failure continues only after explicit one-attempt consent and does not claim a verified backup', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const failure = Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
  const deps = dependencies(f, {
    createUserDataBackup: async () => { throw failure; },
    confirmBackupFailure: async code => { assert.equal(code, 'ENOSPC'); return 1; },
  });
  const result = await runUpdateWorker(f.config, deps);
  assert.deepEqual(result, { installed: true, version: '0.4.59' });
  assert.equal(deps.calls.install, 1);
  assert.equal(deps.calls.shortcut[0], path.join(f.nextRoot, 'X-ray Report Studio.exe'));
  assert.deepEqual(deps.calls.log.find(entry => entry.event === 'user-data-backup-override-authorized'), {
    event: 'user-data-backup-override-authorized', phase: 'user-data-backup', errorCode: 'ENOSPC',
    processState: 'main-exited', recoveryAction: 'continue-without-backup-for-this-attempt',
  });
  assert.equal(deps.calls.log.some(entry => entry.event === 'user-data-backup-verified'), false);
  assert.equal(await fs.readFile(path.join(f.profile, 'workspace.json'), 'utf8'), 'synthetic open document and tabs');
});

test('a locked profile file is a hard stop and never offers backup override', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const failure = Object.assign(new Error('synthetic locked file'), { code: 'EBUSY' });
  let prompts = 0, notices = 0;
  const deps = dependencies(f, {
    createUserDataBackup: async () => { throw failure; },
    confirmBackupFailure: async () => { prompts++; return 1; },
    showBackupBlocked: async code => { notices++; assert.equal(code, 'EBUSY'); },
  });
  const result = await runUpdateWorker(f.config, deps);
  assert.equal(result.errorCode, 'EBUSY');
  assert.equal(prompts, 0);
  assert.equal(notices, 1);
  assert.equal(deps.calls.install, 0);
  assert.equal(deps.calls.shortcut.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(f.installStateFile, 'utf8')), f.previousState);
  assert.equal(await fs.readFile(f.archive, 'utf8'), 'synthetic verified update archive');
});

test('an active or unverifiable XRS process is explained and never reaches the backup override', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const lease = await acquireUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile, ownerPid: process.pid });
  f.config.leaseFile = lease.leaseFile; f.config.leaseAttemptId = lease.attemptId;
  let prompts = 0, notices = 0;
  const deps = dependencies(f, {
    waitForProfileIdle: async () => { throw Object.assign(new Error('synthetic other XRS process'), { code: 'PROFILE_STILL_IN_USE' }); },
    confirmBackupFailure: async () => { prompts++; return 1; },
    showProcessBlocked: async code => { notices++; assert.equal(code, 'PROFILE_STILL_IN_USE'); },
  });
  const result = await runUpdateWorker(f.config, deps);
  assert.equal(result.errorCode, 'PROFILE_STILL_IN_USE');
  assert.equal(prompts, 0);
  assert.equal(notices, 1);
  assert.equal(deps.calls.backup, 0);
  assert.equal(deps.calls.install, 0);
  assert.equal(await fs.readFile(f.archive, 'utf8'), 'synthetic verified update archive');
  assert.equal((await inspectUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile })).active, false);
  const nextAttempt = await acquireUpdateLease({ cacheRoot: f.config.cacheRoot, userDataDir: f.profile, ownerPid: process.pid });
  await releaseUpdateLease(nextAttempt.leaseFile, nextAttempt.attemptId, process.pid);
});

test('backup failure retains old install, shortcut, state and verified archive, then relaunches old version', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const failure = Object.assign(new Error('locked synthetic profile file'), { code: 'EBUSY', syscall: 'read' });
  const deps = dependencies(f, { createUserDataBackup: async () => { throw failure; } });
  const result = await runUpdateWorker(f.config, deps);
  assert.equal(result.installed, false);
  assert.equal(result.errorCode, 'EBUSY');
  assert.equal(result.phase, 'user-data-backup');
  assert.equal(result.archiveRetained, true);
  assert.deepEqual(JSON.parse(await fs.readFile(f.installStateFile, 'utf8')), f.previousState);
  assert.equal(await fs.readFile(path.join(f.profile, 'workspace.json'), 'utf8'), 'synthetic open document and tabs');
  assert.equal(deps.calls.install, 0);
  assert.equal(deps.calls.shortcut.length, 0);
  assert.equal(deps.calls.launched[0].exe, f.config.previous.executable);
  assert.equal(await fs.readFile(f.archive, 'utf8'), 'synthetic verified update archive');
  assert.deepEqual(JSON.parse(await fs.readFile(f.config.resultFile, 'utf8')), {
    status: 'failed', version: '0.4.59', errorCode: 'EBUSY', phase: 'user-data-backup', at: JSON.parse(await fs.readFile(f.config.resultFile, 'utf8')).at,
  });
});

test('corrupt cached archive fails before backup or install and stays available for diagnosis', async t => {
  const f = await setup(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  f.config.sha256 = '0'.repeat(64);
  const deps = dependencies(f);
  const result = await runUpdateWorker(f.config, deps);
  assert.equal(result.errorCode, 'CACHED_ARCHIVE_CHECKSUM_MISMATCH');
  assert.equal(deps.calls.backup, 0);
  assert.equal(deps.calls.install, 0);
  assert.equal(deps.calls.shortcut.length, 0);
  assert.equal(deps.calls.launched[0].exe, f.config.previous.executable);
  assert.equal(await fs.readFile(f.archive, 'utf8'), 'synthetic verified update archive');
});

test('parent process wait polls until exit and has a bounded timeout', async () => {
  let polls = 0;
  await waitForParentExit(900, { timeoutMs: 100, pollMs: 1, alive: () => ++polls < 4 });
  assert.equal(polls, 4);
  await assert.rejects(waitForParentExit(901, { timeoutMs: 2, pollMs: 1, alive: () => true }), { code: 'PARENT_EXIT_TIMEOUT' });
});
