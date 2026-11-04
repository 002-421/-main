import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { installUpdateArchive, launchUpdatedApp } = require('../electron/update-install.cjs');

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

test('update installs app files beside the runtime and redirects the desktop shortcut', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.directory, { recursive: true, force: true }));
  let shortcut;
  const log = [];
  const result = await installUpdateArchive({
    archive: f.archive,
    currentRoot: f.currentRoot,
    version: '0.4.14',
    extractArchive: fakeExtractor(f.packageRoot),
    log: async entry => log.push(entry),
    writeShortcut: async (...args) => { shortcut = args; },
  });
  assert.equal(await fs.readFile(path.join(result.root, 'resources', 'electron.dll'), 'utf8'), 'runtime');
  assert.equal(await fs.readFile(path.join(result.root, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'new app');
  assert.equal(await fs.stat(path.join(result.root, 'resources', 'default_app.asar')).then(() => true, () => false), false);
  assert.equal(await fs.readFile(path.join(f.currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'old app');
  assert.ok(log.some(entry => entry.event === 'runtime-copy-skip'));
  assert.deepEqual(shortcut, [result.executable, result.root, path.join(result.root, 'resources', 'app', 'dist', 'x-ray-report-studio.ico')]);
});

test('invalid update package leaves the current installation untouched', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.directory, { recursive: true, force: true }));
  await assert.rejects(installUpdateArchive({
    archive: f.archive,
    currentRoot: f.currentRoot,
    version: '0.4.14',
    extractArchive: async () => {},
    writeShortcut: async () => assert.fail('shortcut must not change'),
  }), /отсутствуют файлы приложения/);
  assert.equal(await fs.readFile(path.join(f.currentRoot, 'resources', 'app', 'electron', 'main.cjs'), 'utf8'), 'old app');
});

test('updated app launches detached from its new installation folder', () => {
  const child = new EventEmitter();
  let unreferenced = false;
  child.unref = () => { unreferenced = true; };
  let launch;
  launchUpdatedApp('/apps/App_0.4.17/X-ray Report Studio.exe', {
    spawnImpl: (...args) => { launch = args; return child; },
  });
  assert.deepEqual(launch, [
    '/apps/App_0.4.17/X-ray Report Studio.exe',
    [],
    { cwd: '/apps/App_0.4.17', detached: true, windowsHide: true, stdio: 'ignore' },
  ]);
  assert.equal(unreferenced, true);
});

