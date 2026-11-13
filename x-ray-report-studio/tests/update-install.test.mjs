import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const { extractWithTar, installUpdateArchive, validateZipEntries, verifySha256, writeShortcutAtomically } = require('../electron/update-install.cjs');
const { activateRendererUpdate, isUsableRenderer, smokeTestInstalledApp } = require('../electron/live-update.cjs');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mri-update-test-'));
  const currentRoot = path.join(directory, 'App_0.4.13');
  await fs.mkdir(path.join(currentRoot, 'resources', 'app', 'electron'), { recursive: true });
  await fs.mkdir(path.join(currentRoot, 'resources', 'app', 'dist'), { recursive: true });
  await fs.writeFile(path.join(currentRoot, 'X-ray Report Studio.exe'), 'runtime exe');
  await fs.writeFile(path.join(currentRoot, 'resources', 'electron.dll'), 'runtime');
  await fs.writeFile(path.join(currentRoot, 'resources', 'default_app.asar'), 'unused Electron fallback');
  await fs.writeFile(path.join(currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'old app');
  const packageRoot = path.join(directory, 'package', 'X-ray Report Studio Setup', 'app');
  await fs.mkdir(path.join(packageRoot, 'electron'), { recursive: true });
  await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'electron', 'main.cjs'), 'new app');
  await fs.writeFile(path.join(packageRoot, 'dist', 'x-ray-report-studio.ico'), 'icon');
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({version:'0.4.14'}));
  const archive = path.join(directory, 'update.zip');
  await fs.writeFile(archive, 'verified archive');
  return { directory, currentRoot, packageRoot, archive };
}

function fakeExtractor(packageRoot) {
  return async (_archive, destination) => {
    const target = path.join(destination, 'X-ray Report Studio Setup', 'app');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(packageRoot, target, { recursive: true });
  };
}

test('update stages a side-by-side app but leaves shortcut commit to the caller', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.directory, { recursive: true, force: true }));
  const log = [];
  const result = await installUpdateArchive({
    archive: f.archive,
    currentRoot: f.currentRoot,
    version: '0.4.14',
    extractArchive: fakeExtractor(f.packageRoot),
    log: async entry => log.push(entry),
  });
  assert.equal(await fs.readFile(path.join(result.root, 'resources', 'electron.dll'), 'utf8'), 'runtime');
  assert.equal(await fs.readFile(path.join(result.root, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'new app');
  assert.equal(await fs.stat(path.join(result.root, 'resources', 'default_app.asar')).then(() => true, () => false), false);
  assert.equal(await fs.readFile(path.join(f.currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'old app');
  assert.equal(log.some(entry => Object.values(entry).some(value=>String(value).includes('default_app.asar'))),false,'installer logs do not include runtime paths');
  assert.equal(result.version, '0.4.14');
  assert.equal(result.icon, path.join(result.root, 'resources', 'app', 'dist', 'x-ray-report-studio.ico'));
  assert.ok(await fs.stat(result.executable));
});

test('0.4.54 to 0.4.55 local candidate keeps the previous app and synthetic user profile intact', async t => {
  const f=await fixture(); t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
  const profile=path.join(f.directory,'MRI Report Studio');
  await fs.mkdir(profile,{recursive:true});
  const userFiles={
    'workspace.json':'synthetic open reports and tab state',
    'templates.json':'synthetic custom template',
    'settings.json':'synthetic export and editor settings',
    'dictionary.json':'["synthetic-word"]',
  };
  for(const [name,value] of Object.entries(userFiles))await fs.writeFile(path.join(profile,name),value);
  const hashes=new Map(await Promise.all(Object.keys(userFiles).map(async name=>[name,await fs.readFile(path.join(profile,name))])));
  await fs.writeFile(path.join(f.currentRoot,'resources','app','package.json'),JSON.stringify({version:'0.4.54'}));
  await fs.writeFile(path.join(f.packageRoot,'package.json'),JSON.stringify({version:'0.4.55'}));

  const installed=await installUpdateArchive({archive:f.archive,currentRoot:f.currentRoot,version:'0.4.55',extractArchive:fakeExtractor(f.packageRoot)});
  assert.equal(installed.version,'0.4.55');
  assert.equal(await fs.readFile(path.join(installed.root,'resources','app','electron','main.cjs'),'utf8'),'new app');
  assert.equal(await fs.readFile(path.join(f.currentRoot,'resources','app','electron','main.cjs'),'utf8'),'old app');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.currentRoot,'resources','app','package.json'),'utf8')).version,'0.4.54');
  for(const [name,bytes] of hashes)assert.deepEqual(await fs.readFile(path.join(profile,name)),bytes,`${name} remains byte-for-byte unchanged`);
});

test('invalid update package leaves the current installation untouched', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.directory, { recursive: true, force: true }));
  await assert.rejects(installUpdateArchive({
    archive: f.archive,
    currentRoot: f.currentRoot,
    version: '0.4.14',
    extractArchive: async () => {},
  }), /отсутствуют файлы приложения/);
  assert.equal(await fs.readFile(path.join(f.currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'old app');
});

test('update archive must carry the exact version advertised by the manifest', async t => {
  const f=await fixture(); t.after(()=>fs.rm(f.directory,{recursive:true,force:true}));
  await assert.rejects(installUpdateArchive({archive:f.archive,currentRoot:f.currentRoot,version:'0.4.15',extractArchive:fakeExtractor(f.packageRoot)}),/не совпадает с манифестом/);
  assert.equal(await fs.readFile(path.join(f.currentRoot,'resources','app','electron','main.cjs'),'utf8'),'old app');
});

test('ZIP paths are validated before extraction, including traversal and Windows path forms', () => {
  const good=zipSync({'X-ray Report Studio Setup/app/electron/main.cjs':strToU8('ok')});
  assert.equal(validateZipEntries(Buffer.from(good)).length,1);
  for(const name of ['../escape.txt','..\\escape.txt','C:/escape.txt','/absolute.txt','folder/../escape.txt']) {
    const archive=Buffer.from(zipSync({[name]:strToU8('bad')}));
    assert.throws(()=>validateZipEntries(archive),/небезопасный путь/);
  }
});

test('SHA256 verification rejects mismatch and malformed digests', () => {
  const bytes=Buffer.from('verified');
  const {createHash}=require('node:crypto'),valid=createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifySha256(bytes,valid),true);
  assert.equal(verifySha256(bytes,'0'.repeat(64)),false);
  assert.equal(verifySha256(bytes,'not-a-digest'),false);
});

test('shortcut replacement writes beside the existing link and leaves it untouched when staging fails', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-shortcut-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const shortcut=path.join(dir,'Рабочий стол X-ray.lnk');await fs.writeFile(shortcut,'old shortcut');
  await assert.rejects(writeShortcutAtomically({shortcutPath:shortcut,target:'new.exe',cwd:dir,icon:'new.ico',writeShortcutLink:async()=>{throw new Error('write failed');}}),/write failed/);
  assert.equal(await fs.readFile(shortcut,'utf8'),'old shortcut');
  await writeShortcutAtomically({shortcutPath:shortcut,target:'new.exe',cwd:dir,icon:'new.ico',writeShortcutLink:async(temp,options)=>{await fs.writeFile(temp,JSON.stringify(options));return true;}});
  assert.match(await fs.readFile(shortcut,'utf8'),/new\.exe/);
});

test('first-launch smoke test reports only readiness and version from a synthetic app profile', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-smoke-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const {EventEmitter}=require('node:events');
  const result=await smokeTestInstalledApp({executable:path.join(directory,'X-ray Report Studio.exe'),timeoutMs:1000,spawnProcess:(_exe,args,options)=>{const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{};const profile=args[0].slice('--user-data-dir='.length);void fs.mkdir(profile,{recursive:true}).then(()=>fs.writeFile(options.env.XRS_SMOKE_TEST_RESULT,JSON.stringify({ready:true,version:'0.4.14'}))).then(()=>{child.exitCode=0;child.emit('exit',0);});return child;}});
  assert.deepEqual(result,{ready:true,version:'0.4.14'});
});

test('update archive extraction invokes the system tar command', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xray-tar-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const destination = path.join(directory, 'destination');
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, 'payload.txt'), 'update payload');
  const archive = path.join(directory, 'payload.tar');
  const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
  execFileSync(tarCommand, ['-cf', archive, '-C', source, 'payload.txt']);
  await extractWithTar(archive, destination, tarCommand);
  assert.equal(await fs.readFile(path.join(destination, 'payload.txt'), 'utf8'), 'update payload');
});

test('live update keeps the current window and resolves when the new renderer reports ready', async () => {
  let ready;
  const loaded = [];
  const operation = activateRendererUpdate({
    installedIndex: 'new/index.html', previousIndex: 'old/index.html',
    loadFile: async filename => { loaded.push(filename); ready(); },
    waitForReady: () => new Promise(resolve => { ready = resolve; }),
  });
  assert.deepEqual(await operation, { activated: true });
  assert.deepEqual(loaded, ['new/index.html']);
});

test('live update restores the previous renderer if loading the new one fails', async () => {
  let ready;
  const loaded = [];
  const operation = activateRendererUpdate({
    installedIndex: 'new/index.html', previousIndex: 'old/index.html',
    loadFile: async filename => {
      loaded.push(filename);
      if (filename.startsWith('new')) ready(new Error('new renderer failed'));
      else ready();
    },
    waitForReady: () => new Promise((resolve, reject) => { ready = error => error ? reject(error) : resolve(); }),
  });
  await assert.rejects(operation, /new renderer failed/);
  assert.deepEqual(loaded, ['new/index.html', 'old/index.html']);
});

test('live update rejects a blank renderer even when the document reported ready', () => {
  const details = {
    appRoot: true, templateCount: 113, textLength: 1500,
    viewport: { width: 1500, height: 1000 },
    shell: { width: 1500, height: 1000, display: 'flex', visibility: 'visible', opacity: '1' },
  };
  assert.equal(isUsableRenderer(details, { distinctSampleColors: 40 }), true);
  assert.equal(isUsableRenderer(details, { distinctSampleColors: 1 }), false);
  assert.equal(isUsableRenderer({ ...details, textLength: 0 }, { distinctSampleColors: 40 }), false);
});


test('first-launch smoke test rejects a new executable that exits before editor readiness', async t => {
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xrs-smoke-failure-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const {EventEmitter}=require('node:events');
 await assert.rejects(smokeTestInstalledApp({executable:path.join(directory,'X-ray Report Studio.exe'),timeoutMs:1000,spawnProcess:()=>{const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{};setTimeout(()=>{child.exitCode=1;child.emit('exit',1);},10);return child;}}),/кодом 1/);
});
