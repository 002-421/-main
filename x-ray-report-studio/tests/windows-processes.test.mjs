import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { waitForNoProfileProcesses, hasOtherXrsProcess } = require('../electron/windows-processes.cjs');
const execFileAsync = promisify(execFile);

function waitForProcessClose(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not exit within ${timeoutMs} ms.`)), timeoutMs);
    child.once('close', code => { clearTimeout(timer); resolve(code); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

async function terminateProcessTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && Number.isSafeInteger(child.pid)) {
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  } else {
    child.kill('SIGKILL');
  }
  await waitForProcessClose(child, 5000, 'Electron test process').catch(() => {});
}

async function readDiagnosticEvents(filename) {
  try { return (await fs.readFile(filename, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}

function makeWorkerSource({ root, workerModule, stateModule }) {
  const candidateRoot = path.join(root, 'Install', 'App_0.4.60');
  const candidateExecutable = path.join(candidateRoot, 'X-ray Report Studio.exe');
  return `
    const fs=require('node:fs/promises');const {app,shell}=require('electron');
    const {runUpdateWorker}=require(${JSON.stringify(workerModule)});const {writeJsonAtomic}=require(${JSON.stringify(stateModule)});
    const diag=async event=>fs.appendFile(process.env.XRS_WORKER_DIAGNOSTICS,JSON.stringify(event)+'\\n');
    diag({stage:'electron-process-started'}).catch(()=>{});
    app.whenReady().then(async()=>{try{await diag({stage:'electron-app-ready'});const c=JSON.parse(await fs.readFile(process.env.XRS_WORKER_CONFIG,'utf8'));c.parentPid=Number(process.env.XRS_PARENT_PID);
      const events=[];const result=await runUpdateWorker(c,{app,shell,writeJsonAtomic,
        waitForProfileIdle:async()=>{},createUserDataBackup:async()=>{try{process.kill(c.parentPid,0);throw new Error('parent Electron process is still running');}catch(e){if(e.message==='parent Electron process is still running')throw e;}
          events.push('backup-after-parent-exit');await fs.writeFile(process.env.XRS_WORKER_EVENTS,JSON.stringify(events));return{files:1,bytes:20};},
        installUpdateArchive:async()=>({root:${JSON.stringify(candidateRoot)},executable:${JSON.stringify(candidateExecutable)}}),
        smokeTestInstalledApp:async()=>({ready:true,version:'0.4.60'}),writeShortcutAtomically:async o=>fs.writeFile(o.shortcutPath,o.target),
        readShortcutTarget:async f=>fs.readFile(f,'utf8'),launchDetached:async()=>{events.push('candidate-launch');await fs.writeFile(process.env.XRS_WORKER_EVENTS,JSON.stringify(events));},
        log:async event=>{const safe={};for(const key of ['event','phase','operation','processState','errorCode','recoveryAction'])if(typeof event[key]==='string')safe[key]=event[key];await diag(safe);}});
      await fs.writeFile(process.env.XRS_WORKER_RESULT,JSON.stringify(result));
    }catch(e){await diag({stage:'worker-top-level-error',errorCode:typeof e.code==='string'?e.code:'UNCLASSIFIED'});await fs.writeFile(process.env.XRS_WORKER_RESULT,JSON.stringify({error:e.message,code:e.code}));}finally{app.quit();}});
  `;
}

test('generated Electron updater worker entrypoint passes Node syntax validation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs-worker-syntax-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entrypoint = path.join(root, 'main.cjs');
  const source = makeWorkerSource({
    root,
    workerModule: path.resolve('electron/update-worker.cjs'),
    stateModule: path.resolve('electron/install-state.cjs'),
  });
  await fs.writeFile(entrypoint, source);
  await execFileAsync(process.execPath, ['--check', entrypoint], { windowsHide: true });
});

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

test('independent Electron updater stages 0.4.60 from 0.4.59 after the real parent exits', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xrs-independent-worker-'));
  const children = [];
  t.after(async () => {
    await Promise.all(children.map(terminateProcessTree));
    await fs.rm(root, { recursive: true, force: true });
  });
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const electronExe = path.join(testDir, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const parentApp = path.join(root, 'parent-app'), workerApp = path.join(root, 'worker-app');
  const profile = path.join(root, 'Profile', 'MRI Report Studio'), installRoot = path.join(root, 'Install', 'App_0.4.59');
  const cacheRoot = path.join(root, 'Cache'), archive = path.join(cacheRoot, 'XRS-0.4.60.zip');
  const marker = path.join(root, 'worker-events.json'), resultFile = path.join(root, 'worker-result.json');
  const diagnosticsFile = path.join(root, 'worker-diagnostics.jsonl'), parentReadyFile = path.join(root, 'parent-ready.json');
  const shortcutPath = path.join(root, 'Desktop', 'XRS.lnk'), logFile = path.join(profile, 'logs', 'update.log');
  await Promise.all([fs.mkdir(parentApp, { recursive: true }), fs.mkdir(workerApp, { recursive: true }), fs.mkdir(profile, { recursive: true }), fs.mkdir(installRoot, { recursive: true }), fs.mkdir(cacheRoot, { recursive: true }), fs.mkdir(path.dirname(shortcutPath), { recursive: true })]);
  const parentProfile = path.join(root, 'ParentProfile'); await fs.mkdir(parentProfile);
  await fs.writeFile(path.join(parentApp, 'package.json'), JSON.stringify({ name: 'parent-fixture', version: '1.0.0', main: 'main.cjs' }));
  await fs.writeFile(path.join(parentApp, 'main.cjs'), `const fs=require('node:fs');const {app}=require('electron');app.whenReady().then(()=>{fs.writeFileSync(${JSON.stringify(parentReadyFile)},JSON.stringify({pid:process.pid}));setTimeout(()=>app.quit(),2200);});`);
  const parentExe = path.join(installRoot, 'X-ray Report Studio.exe'); await fs.writeFile(parentExe, 'synthetic previous executable marker');
  await fs.writeFile(path.join(profile, 'workspace.json'), 'synthetic open document');
  await fs.writeFile(archive, 'synthetic verified archive');
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const installStateFile = path.join(profile, 'install-state.json'), dataSchemaFile = path.join(profile, 'data-schema.json');
  await fs.writeFile(installStateFile, JSON.stringify({ status: 'stable', current: { version: '0.4.59', root: installRoot, executable: parentExe, dataSchemaVersion: 1 }, previous: null }));
  const config = {
    format: 'xrs-update-handoff', schemaVersion: 1, parentPid: 0, archive, cacheRoot, sha256,
    version: '0.4.60', currentVersion: '0.4.59', currentRoot: installRoot, installationParent: path.dirname(installRoot),
    userDataDir: profile, sharedDictionaryFile: '', backupRoot: path.join(root, 'Backups'), allowedBackupRoot: root,
    installStateFile, dataSchemaFile, shortcutPath, logFile, resultFile,
    handoffFile: path.join(cacheRoot, 'handoff.json'), previous: { version: '0.4.59', root: installRoot, executable: parentExe, dataSchemaVersion: 1 },
  };
  const configFile = path.join(cacheRoot, 'handoff.json');
  const workerEntrypoint = path.join(workerApp, 'main.cjs');
  const workerModule = path.resolve(testDir, '../electron/update-worker.cjs');
  const stateModule = path.resolve(testDir, '../electron/install-state.cjs');
  await fs.writeFile(path.join(workerApp, 'package.json'), JSON.stringify({ name: 'worker-fixture', version: '1.0.0', main: 'main.cjs' }));
  await fs.writeFile(configFile, JSON.stringify(config));
  const workerSource = makeWorkerSource({ root, workerModule, stateModule });
  await fs.writeFile(workerEntrypoint, workerSource);
  await execFileAsync(process.execPath, ['--check', workerEntrypoint], { windowsHide: true });
  const parent = spawn(electronExe, [parentApp, `--user-data-dir=${parentProfile}`], { cwd: parentApp, windowsHide: true, stdio: 'ignore' });
  children.push(parent);
  let parentExit;
  const parentReadyTimer = Date.now() + 10000;
  let parentRuntime;
  while (Date.now() < parentReadyTimer) {
    try { parentRuntime = JSON.parse(await fs.readFile(parentReadyFile, 'utf8')); break; }
    catch (error) {
      if (parent.exitCode !== null || parent.signalCode !== null) throw new Error(`Parent Electron exited before app readiness (exit=${parent.exitCode}, signal=${parent.signalCode}).`);
      if (error.code !== 'ENOENT') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  assert.ok(Number.isSafeInteger(parentRuntime?.pid) && parentRuntime.pid > 0, 'Parent Electron did not report its real runtime PID within 10000 ms.');
  const parentClosed = waitForProcessClose(parent, 15000, 'Parent Electron process').then(code => { parentExit = code; return code; });
  config.parentPid = parentRuntime.pid; await fs.writeFile(configFile, JSON.stringify(config));
  const worker = spawn(electronExe, [workerApp, `--user-data-dir=${path.join(root, 'WorkerProfile')}`], {
    cwd: workerApp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, XRS_WORKER_CONFIG: configFile, XRS_WORKER_RESULT: resultFile, XRS_WORKER_EVENTS: marker, XRS_WORKER_DIAGNOSTICS: diagnosticsFile, XRS_PARENT_PID: String(parentRuntime.pid) },
  });
  children.push(worker);
  for (const [stream, source] of [[worker.stdout, 'stdout'], [worker.stderr, 'stderr']]) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const safeChunk = String(chunk).slice(0, 2000);
      fs.appendFile(diagnosticsFile, `${JSON.stringify({ stage: `electron-${source}`, output: safeChunk })}\n`).catch(() => {});
    });
  }
  let workerTimedOut = false;
  const workerClosed = new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      workerTimedOut = true;
      const stages = await readDiagnosticEvents(diagnosticsFile);
      const lastStage = stages.at(-1)?.event || stages.at(-1)?.stage || 'no-worker-diagnostic';
      await terminateProcessTree(worker);
      reject(new Error(`Independent Electron worker timed out after 30000 ms; last stage: ${lastStage}; diagnostic events: ${JSON.stringify(stages)}.`));
    }, 30000);
    worker.once('close', code => { clearTimeout(timer); if (!workerTimedOut) resolve(code); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
  await new Promise(resolve => setTimeout(resolve, 500));
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' }, 'backup must not start while the Electron parent is still alive');
  const [, workerExitCode] = await Promise.all([parentClosed, workerClosed]);
  assert.equal(parentExit, 0);
  let workerResultText;
  try { workerResultText = await fs.readFile(resultFile, 'utf8'); }
  catch (error) {
    const stages = await readDiagnosticEvents(diagnosticsFile);
    throw new Error(`Electron worker exited with code ${workerExitCode} without writing its result (${error.code}); diagnostics: ${JSON.stringify(stages)}.`);
  }
  assert.deepEqual(JSON.parse(workerResultText), { installed: true, version: '0.4.60' });
  assert.deepEqual(JSON.parse(await fs.readFile(marker, 'utf8')), ['backup-after-parent-exit', 'candidate-launch']);
  assert.equal(await fs.readFile(path.join(profile, 'workspace.json'), 'utf8'), 'synthetic open document');
});
