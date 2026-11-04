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

/** Install app files beside the running copy and redirect the desktop shortcut. */
async function installUpdateArchive({ archive, currentRoot, version, desktop, writeShortcut, extractArchive = extractWithTar }) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'MRIReportStudio_Update_'));
  const stage = path.join(path.dirname(currentRoot), `.MRI_Report_Studio_stage_${randomUUID()}`);
  let newRoot;
  try {
    await extractArchive(archive, temporary);
    const sourceApp = path.join(temporary, 'MRI Report Studio Setup', 'app');
    if (!(await fs.stat(path.join(sourceApp, 'electron', 'main.cjs')).catch(() => null))) {
      throw new Error('В архиве обновления отсутствуют файлы приложения.');
    }

    const safeVersion = String(version).replace(/[^A-Za-z0-9._-]/g, '_');
    newRoot = path.join(path.dirname(currentRoot), `App_${safeVersion}`);
    while (await fs.stat(newRoot).then(() => true, () => false)) newRoot = path.join(path.dirname(currentRoot), `App_${safeVersion}_${randomUUID().slice(0, 8)}`);

    await fs.cp(currentRoot, stage, { recursive: true, errorOnExist: true, force: false });
    const targetApp = path.join(stage, 'resources', 'app');
    await fs.rm(targetApp, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetApp), { recursive: true });
    await fs.cp(sourceApp, targetApp, { recursive: true, errorOnExist: true, force: false });
    const executable = path.join(stage, 'MRI Report Studio.exe');
    if (!(await fs.stat(executable).catch(() => null))) throw new Error('В установленной копии не найден файл приложения.');

    await fs.rename(stage, newRoot);
    const installedExecutable = path.join(newRoot, 'MRI Report Studio.exe');
    const icon = path.join(newRoot, 'resources', 'app', 'dist', 'mri-report-studio.ico');
    await writeShortcut(installedExecutable, newRoot, icon);
    return { root: newRoot, executable: installedExecutable };
  } catch (error) {
    if (newRoot) await fs.rm(newRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { extractWithTar, installUpdateArchive };
