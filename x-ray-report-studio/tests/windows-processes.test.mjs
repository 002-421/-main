import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { waitForNoProfileProcesses, hasOtherXrsProcess } = require('../electron/windows-processes.cjs');

function waitForProcessClose(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not exit within ${timeoutMs} ms.`)), timeoutMs);
    child.once('close', code => { clearTimeout(timer); resolve(code); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('profile process inspection waits for active processes and fails closed at timeout', async () => {
  let polls = 0;
  const states = [];
  await waitForNoProfileProcesses({ installRoot: 'synthetic-install-root', userDataDir: 'synthetic-profile' }, {
    timeoutMs: 100, pollMs: 1,
    query: async () => ++polls < 3,
    onState: async state => states.push(state),
  });
  assert.equal(polls, 3);
  assert.deepEqual(states, ['other-process-running', 'other-process-running', 'clear']);
  await assert.rejects(waitForNoProfileProcesses({}, {
    timeoutMs: 1, pollMs: 1, query: async () => true,
  }), { code: 'PROFILE_STILL_IN_USE' });
});

test('Windows CIM process query runs and confirms an idle synthetic install root', { skip: process.platform !== 'win32' }, async () => {
  assert.equal(await hasOtherXrsProcess({
    installRoot: process.cwd(),
    userDataDir: process.env.TEMP ?? process.cwd(),
    workerPid: process.pid,
  }), false);
});

test('independent Electron updater waits for the real parent Electron process before profile backup', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs-independent-worker-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await Promise.race([waitForProcessClose(child, 5000, 'Electron test process').catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    }));
    await fs.rm(root, { recursive: true, force: true });
  });
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const electronExe = path.join(testDir, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const parentApp = path.join(root, 'parent-app'), workerApp = path.join(root, 'worker-app');
  const profile = path.join(root, 'Profile', 'MRI Report Studio'), installRoot = path.join(root, 'Install', 'App_0.4.58');
  const cacheRoot = path.join(root, 'Cache'), archive = path.join(cacheRoot, 'XRS-0.4.59.zip');
  const marker = path.join(root, 'worker-events.json'), resultFile = path.join(root, 'worker-result.json');
  const shortcutPath = path.join(root, 'Desktop', 'XRS.lnk'), logFile = path.join(profile, 'logs', 'update.log');
  await Promise.all([fs.mkdir(parentApp, { recursive: true }), fs.mkdir(workerApp, { recursive: true }), fs.mkdir(profile, { recursive: true }), fs.mkdir(installRoot, { recursive: true }), fs.mkdir(cacheRoot, { recursive: true }), fs.mkdir(path.dirname(shortcutPath), { recursive: true })]);
  const parentProfile = path.join(root, 'ParentProfile'); await fs.mkdir(parentProfile);
  await fs.writeFile(path.join(parentApp, 'package.json'), JSON.stringify({ name: 'parent-fixture', version: '1.0.0', main: 'main.cjs' }));
  await fs.writeFile(path.join(parentApp, 'main.cjs'), "const {app}=require('electron');app.whenReady().then(()=>setTimeout(()=>app.quit(),2200));");
  const parentExe = path.join(installRoot, 'X-ray Report Studio.exe'); await fs.writeFile(parentExe, 'synthetic previous executable marker');
  await fs.writeFile(path.join(profile, 'workspace.json'), 'synthetic open document');
  await fs.writeFile(archive, 'synthetic verified archive');
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const installStateFile = path.join(profile, 'install-state.json'), dataSchemaFile = path.join(profile, 'data-schema.json');
  await fs.writeFile(installStateFile, JSON.stringify({ status: 'stable', current: { version: '0.4.58', root: installRoot, executable: parentExe, dataSchemaVersion: 1 }, previous: null }));
  const config = {
    format: 'xrs-update-handoff', schemaVersion: 1, parentPid: 0, archive, cacheRoot, sha256,
    version: '0.4.59', currentVersion: '0.4.58', currentRoot: installRoot, installationParent: path.dirname(installRoot),
    userDataDir: profile, sharedDictionaryFile: '', backupRoot: path.join(root, 'Backups'), allowedBackupRoot: root,
    installStateFile, dataSchemaFile, shortcutPath, logFile, resultFile,
    handoffFile: path.join(cacheRoot, 'handoff.json'), previous: { version: '0.4.58', root: installRoot, executable: parentExe, dataSchemaVersion: 1 },
  };
  const configFile = path.join(cacheRoot, 'handoff.json');
  const workerEntrypoint = path.join(workerApp, 'main.cjs');
  const workerModule = path.resolve(testDir, '../electron/update-worker.cjs');
  const stateModule = path.resolve(testDir, '../electron/install-state.cjs');
  await fs.writeFile(path.join(workerApp, 'package.json'), JSON.stringify({ name: 'worker-fixture', version: '1.0.0', main: 'main.cjs' }));
  await fs.writeFile(configFile, JSON.stringify(config));
  const workerSource = `
    const fs=require('node:fs/promises');const {app,shell}=require('electron');
    const {runUpdateWorker}=require(${JSON.stringify(workerModule)});const {writeJsonAtomic}=require(${JSON.stringify(stateModule)});
    app.whenReady().then(async()=>{try{const c=JSON.parse(await fs.readFile(process.env.XRS_WORKER_CONFIG,'utf8'));c.parentPid=Number(process.env.XRS_PARENT_PID);
      const events=[];const result=await runUpdateWorker(c,{app,shell,writeJsonAtomic,
        waitForProfileIdle:async()=>{},createUserDataBackup:async()=>{try{process.kill(c.parentPid,0);throw new Error('parent Electron process is still running');}catch(e){if(e.message==='parent Electron process is still running')throw e;}
          events.push('backup-after-parent-exit');await fs.writeFile(process.env.XRS_WORKER_EVENTS,JSON.stringify(events));return{files:1,bytes:20};},
        installUpdateArchive:async()=>({root:${JSON.stringify(path.join(root,'Install','App_0.4.59'))},executable:${JSON.stringify(path.join(root,'Install','App_0.4.59','X-ray Report Studio.exe'))}),
        smokeTestInstalledApp:async()=>({ready:true,version:'0.4.59'}),writeShortcutAtomically:async o=>fs.writeFile(o.shortcutPath,o.target),
        readShortcutTarget:async f=>fs.readFile(f,'utf8'),launchDetached:async()=>{events.push('candidate-launch');await fs.writeFile(process.env.XRS_WORKER_EVENTS,JSON.stringify(events));},log:async()=>{}});
      await fs.writeFile(process.env.XRS_WORKER_RESULT,JSON.stringify(result));
    }catch(e){await fs.writeFile(process.env.XRS_WORKER_RESULT,JSON.stringify({error:e.message,code:e.code}));}finally{app.quit();}});
  `;
  await fs.writeFile(workerEntrypoint, workerSource);
  const parent = spawn(electronExe, [parentApp, `--user-data-dir=${parentProfile}`], { cwd: parentApp, windowsHide: true, stdio: 'ignore' });
  children.push(parent);
  let parentExit;
  const parentClosed = waitForProcessClose(parent, 15000, 'Parent Electron process').then(code => { parentExit = code; return code; });
  config.parentPid = parent.pid; await fs.writeFile(configFile, JSON.stringify(config));
  const worker = spawn(electronExe, [workerApp, `--user-data-dir=${path.join(root, 'WorkerProfile')}`], {
    cwd: workerApp, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, XRS_WORKER_CONFIG: configFile, XRS_WORKER_RESULT: resultFile, XRS_WORKER_EVENTS: marker, XRS_PARENT_PID: String(parent.pid) },
  });
  children.push(worker);
  const workerClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Independent Electron worker did not finish within 30 seconds.')), 30000);
    worker.once('close', code => { clearTimeout(timer); resolve(code); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  await new Promise(resolve => setTimeout(resolve, 500));
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' }, 'backup must not start while the Electron parent is still alive');
  await Promise.all([parentClosed, workerClosed]);
  assert.equal(parentExit, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(resultFile, 'utf8')), { installed: true, version: '0.4.59' });
  assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), ['backup-after-parent-exit', 'candidate-launch']);
  assert.equal(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8'), 'synthetic open document');
});
