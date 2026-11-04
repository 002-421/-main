const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr?.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-3000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `${command} завершился с кодом ${code}.`)));
  });
}

async function extractWithTar(archive, destination, tarCommand = 'tar.exe') {
  await run(tarCommand, ['-xf', archive, '-C', destination]);
}

function launchUpdatedApp(executable, { spawnImpl = spawn, onError = () => {} } = {}) {
  const child = spawnImpl(executable, [], {
    cwd: path.dirname(executable),
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.once('error', onError);
  child.unref();
  return child;
}

/** Install app files beside the running copy and redirect the desktop shortcut. */
async function installUpdateArchive({ archive, currentRoot, version, writeShortcut, extractArchive = extractWithTar, log = () => {} }) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'XRayReportStudio_Update_'));
  const stage = path.join(path.dirname(currentRoot), `.X-ray_Report_Studio_stage_${randomUUID()}`);
  let newRoot;
  try {
    await log({ event: 'extract-start', archive });
    await extractArchive(archive, temporary);
    await log({ event: 'extract-complete', temporary });
    const sourceApp = path.join(temporary, 'X-ray Report Studio Setup', 'app');
    if (!(await fs.stat(path.join(sourceApp, 'electron', 'main.cjs')).catch(() => null))) {
      throw new Error('В архиве обновления отсутствуют файлы приложения.');
    }

    const safeVersion = String(version).replace(/[^A-Za-z0-9._-]/g, '_');
    newRoot = path.join(path.dirname(currentRoot), `App_${safeVersion}`);
    while (await fs.stat(newRoot).then(() => true, () => false)) newRoot = path.join(path.dirname(currentRoot), `App_${safeVersion}_${randomUUID().slice(0, 8)}`);

    await log({ event: 'runtime-copy-start', from: currentRoot, to: stage });
    await fs.cp(currentRoot, stage, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: async source => {
        // Electron treats a .asar destination as a package. This stock archive
        // is unused when resources/app is present, so do not copy it.
        if (path.basename(source).toLowerCase() === 'default_app.asar') {
          await log({ event: 'runtime-copy-skip', source, reason: 'unused-default-app-archive' });
          return false;
        }
        return true;
      },
    });
    await log({ event: 'runtime-copy-complete' });
    const targetApp = path.join(stage, 'resources', 'app');
    await fs.rm(targetApp, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetApp), { recursive: true });
    await fs.cp(sourceApp, targetApp, { recursive: true, errorOnExist: true, force: false });
    await log({ event: 'app-copy-complete', sourceApp, targetApp });
    const executable = path.join(stage, 'X-ray Report Studio.exe');
    if (!(await fs.stat(executable).catch(() => null))) throw new Error('В установленной копии не найден файл приложения.');

    await fs.rename(stage, newRoot);
    await log({ event: 'install-folder-ready', root: newRoot });
    const installedExecutable = path.join(newRoot, 'X-ray Report Studio.exe');
    const icon = path.join(newRoot, 'resources', 'app', 'dist', 'x-ray-report-studio.ico');
    await writeShortcut(installedExecutable, newRoot, icon);
    await log({ event: 'shortcut-updated', target: installedExecutable });
    return { root: newRoot, executable: installedExecutable };
  } catch (error) {
    await log({ event: 'install-error', message: error.message, stack: error.stack, stage, newRoot });
    if (newRoot) await fs.rm(newRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { extractWithTar, installUpdateArchive, launchUpdatedApp };
