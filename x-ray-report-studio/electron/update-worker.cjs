const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { installUpdateArchive, verifySha256, writeShortcutAtomically } = require('./update-install.cjs');
const { createUserDataBackup } = require('./user-data-backup.cjs');
const { smokeTestInstalledApp } = require('./live-update.cjs');
const { CURRENT_DATA_SCHEMA, readJson, writeJsonAtomic, samePath } = require('./install-state.cjs');
const { waitForNoProfileProcesses } = require('./windows-processes.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

async function waitForParentExit(pid, { timeoutMs = 180000, pollMs = 250, alive = isProcessAlive } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() >= deadline) {
      const error = new Error('The main application did not exit before the update worker timeout.');
      error.code = 'PARENT_EXIT_TIMEOUT';
      throw error;
    }
    await sleep(pollMs);
  }
}

function launchDetached(executable, args, options = {}) {
  const child = spawn(executable, args, { detached: true, windowsHide: true, stdio: 'ignore', ...options });
  child.unref();
}

async function runUpdateWorker(config, dependencies = {}) {
  const log = dependencies.log ?? (async () => {});
  const wait = dependencies.waitForParentExit ?? waitForParentExit;
  const waitForProfileIdle = dependencies.waitForProfileIdle ?? waitForNoProfileProcesses;
  const backup = dependencies.createUserDataBackup ?? createUserDataBackup;
  const install = dependencies.installUpdateArchive ?? installUpdateArchive;
  const smokeTest = dependencies.smokeTestInstalledApp ?? smokeTestInstalledApp;
  const writeShortcut = dependencies.writeShortcutAtomically ?? writeShortcutAtomically;
  const writeState = dependencies.writeJsonAtomic ?? writeJsonAtomic;
  const launch = dependencies.launchDetached ?? launchDetached;
  const readShortcutTarget = dependencies.readShortcutTarget ?? (filename => shell.readShortcutLink(filename).target);
  const app = dependencies.app;
  const shell = dependencies.shell;
  if (!app || !shell) throw new Error('Update worker requires the Electron app and shell interfaces.');
  if (config?.format !== 'xrs-update-handoff' || config.schemaVersion !== 1
      || !Number.isSafeInteger(config?.parentPid) || config.parentPid <= 0 || !/^[a-f0-9]{64}$/i.test(config.sha256)
      || typeof config.archive !== 'string' || typeof config.cacheRoot !== 'string' || !path.isAbsolute(config.cacheRoot)
      || !path.isAbsolute(config.archive) || !inside(config.cacheRoot, config.archive)
      || typeof config.userDataDir !== 'string' || !path.isAbsolute(config.userDataDir)
      || typeof config.currentRoot !== 'string' || !path.isAbsolute(config.currentRoot)
      || typeof config.installStateFile !== 'string' || !inside(config.userDataDir, config.installStateFile)
      || typeof config.dataSchemaFile !== 'string' || !inside(config.userDataDir, config.dataSchemaFile)
      || typeof config.version !== 'string' || !/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(config.version)
      || !config.previous || config.previous.version !== config.currentVersion
      || path.resolve(config.previous.root) !== path.resolve(config.currentRoot)
      || path.resolve(config.previous.executable) !== path.resolve(config.currentRoot, 'X-ray Report Studio.exe')
      || !path.isAbsolute(config.shortcutPath) || !path.isAbsolute(config.logFile)
      || !inside(config.userDataDir, config.logFile)) {
    throw new Error('Update handoff file is invalid.');
  }

  let phase = 'wait-for-main-exit';
  let activationStarted = false;
  let priorInstallState;
  let mainExited = false;
  let profileIdle = false;
  try {
    await log({ event: 'update-worker-start', phase, processState: 'main-running', operation: 'wait-for-parent' });
    await wait(config.parentPid);
    mainExited = true;
    await log({ event: 'update-worker-parent-exited', phase, processState: 'main-exited', operation: 'wait-for-parent' });
    phase = 'wait-for-profile-idle';
    await waitForProfileIdle({ installRoot: config.installationParent ?? path.dirname(config.currentRoot), userDataDir: config.userDataDir }, {
      onState: processState => log({ event: 'update-worker-process-state', phase, processState, operation: 'verify-profile-idle' }),
    });
    profileIdle = true;
    await log({ event: 'update-worker-profile-idle', phase, processState: 'no-other-xrs-processes', operation: 'verify-profile-idle' });

    phase = 'verify-cached-archive';
    await log({ event: 'file-operation-start', phase, operation: 'read-cached-archive', path: 'updates/verified/<candidate-archive>', processState: 'main-exited' });
    let archive;
    try {
      const archiveStat = await fs.lstat(config.archive);
      if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
        const error = new Error('Cached update archive has an unsafe file type.');
        error.code = 'UNSAFE_CACHED_ARCHIVE';
        throw error;
      }
      archive = await fs.readFile(config.archive);
      await log({ event: 'file-operation-complete', phase, operation: 'read-cached-archive', path: 'updates/verified/<candidate-archive>', processState: 'main-exited' });
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'FILE_OPERATION_FAILED';
      const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : undefined;
      await log({ event: 'file-operation-error', phase, operation: 'read-cached-archive', path: 'updates/verified/<candidate-archive>', errorCode, ...(syscall ? { syscall } : {}), processState: 'main-exited' });
      throw error;
    }
    if (!verifySha256(archive, config.sha256)) {
      const error = new Error('The cached update archive failed SHA-256 verification.');
      error.code = 'CACHED_ARCHIVE_CHECKSUM_MISMATCH';
      throw error;
    }
    await log({ event: 'cached-archive-verified', phase, operation: 'sha256', bytes: archive.length, expected: config.sha256, actual: config.sha256, processState: 'main-exited' });

    phase = 'user-data-backup';
    await log({ event: 'user-data-backup-start', phase, processState: 'main-exited' });
    const userBackup = await backup({
      userDataDir: config.userDataDir,
      sharedDictionaryFile: config.sharedDictionaryFile,
      backupRoot: config.backupRoot,
      allowedBackupRoot: config.allowedBackupRoot,
      forbiddenRoots: [config.currentRoot],
      version: config.currentVersion,
      onOperation: event => log({ ...event, processState: 'main-exited' }),
    });
    await log({ event: 'user-data-backup-verified', phase, bytes: userBackup.bytes, files: userBackup.files, processState: 'main-exited' });

    phase = 'side-by-side-install';
    const installed = await install({ archive: config.archive, currentRoot: config.currentRoot, version: config.version, log });
    phase = 'new-version-smoke-test';
    const smoke = await smokeTest({ executable: installed.executable });
    if (smoke.version !== config.version) {
      const error = new Error('The candidate startup check reported an unexpected version.');
      error.code = 'CANDIDATE_VERSION_MISMATCH';
      throw error;
    }
    await log({ event: 'new-version-smoke-test-passed', phase, targetVersion: config.version, processState: 'main-exited' });

    phase = 'first-start-commit';
    const previous = priorInstallState = await readJson(config.installStateFile, null);
    const nextState = {
      status: 'pending-first-start', launchAttempts: 0, installedAt: new Date().toISOString(),
      current: { version: config.version, root: installed.root, executable: installed.executable, dataSchemaVersion: CURRENT_DATA_SCHEMA },
      previous: config.previous,
    };
    activationStarted = true;
    await writeState(config.installStateFile, nextState);
    try {
      await writeShortcut({
        shortcutPath: config.shortcutPath, target: installed.executable, cwd: installed.root,
        icon: installed.icon,
        writeShortcutLink: (filename, options) => shell.writeShortcutLink(filename, 'create', options),
      });
      const actualShortcutTarget = await readShortcutTarget(config.shortcutPath);
      if (!samePath(actualShortcutTarget, installed.executable)) {
        const error = new Error('Windows shortcut does not resolve to the prepared update candidate.');
        error.code = 'SHORTCUT_TARGET_MISMATCH';
        throw error;
      }
    } catch (error) {
      if (previous) await writeState(config.installStateFile, previous);
      else await fs.unlink(config.installStateFile).catch(() => {});
      throw error;
    }
    await log({ event: 'shortcut-committed', phase, targetVersion: config.version, processState: 'main-exited' });
    launch(installed.executable, [`--user-data-dir=${config.userDataDir}`], { cwd: installed.root });
    await log({ event: 'new-runtime-launched', phase, targetVersion: config.version, processState: 'main-exited' });
    await fs.unlink(config.archive).catch(() => {});
    await fs.unlink(config.handoffFile).catch(() => {});
    return { installed: true, version: config.version };
  } catch (error) {
    const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'UPDATE_WORKER_FAILED';
    const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : undefined;
    await log({ event: 'update-worker-error', phase, errorCode, ...(syscall ? { syscall } : {}), processState: 'main-exited', recoveryAction: 'retain-current-and-cached-archive' });
    if (activationStarted) {
      try {
        if (priorInstallState) await writeState(config.installStateFile, priorInstallState);
        else await fs.unlink(config.installStateFile).catch(() => {});
        await writeShortcut({ shortcutPath: config.shortcutPath, target: config.previous.executable, cwd: config.previous.root, icon: '', writeShortcutLink: (filename, options) => shell.writeShortcutLink(filename, 'create', options) });
        await log({ event: 'update-worker-activation-restored', phase, restored: true, recoveryAction: 'restore-prior-state-and-shortcut' });
      } catch {
        await log({ event: 'update-worker-activation-restore-failed', phase, restored: false, recoveryAction: 'manual-support-required' });
      }
    }
    await fs.writeFile(config.resultFile, JSON.stringify({ status: 'failed', version: config.version, errorCode, phase, at: new Date().toISOString() }), { flag: 'w' }).catch(() => {});
    if (mainExited && profileIdle && config.previous?.executable && config.previous?.root) {
      try {
        launch(config.previous.executable, [`--user-data-dir=${config.userDataDir}`], { cwd: config.previous.root });
        await log({ event: 'previous-runtime-relaunched', phase, recoveryAction: 'launch-previous-version' });
      } catch {
        await log({ event: 'previous-runtime-relaunch-failed', phase, recoveryAction: 'manual-launch-from-existing-shortcut' });
      }
    }
    return { installed: false, errorCode, phase, archiveRetained: true };
  }
}

module.exports = { isProcessAlive, waitForParentExit, runUpdateWorker };
