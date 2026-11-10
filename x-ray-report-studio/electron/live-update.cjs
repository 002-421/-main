const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Switch the current window to a packaged renderer, rolling back if it fails. */
async function activateRendererUpdate({ loadFile, installedIndex, previousIndex, waitForReady }) {
  let ready;
  try {
    ready = waitForReady();
    ready.catch(() => {});
    await loadFile(installedIndex);
    await ready;
    return { activated: true };
  } catch (error) {
    // Observe a failed/timed-out ready promise before starting the rollback.
    // A loadFile failure can happen before the renderer sends app:ready.
    try {
      const restored = waitForReady();
      await loadFile(previousIndex);
      await restored;
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function isUsableRenderer(details, frame) {
  const shell = details?.shell;
  return details?.appRoot === true
    && Number(details.templateCount) > 0
    && Number(details.textLength) >= 200
    && Number(details.viewport?.width) > 0
    && Number(details.viewport?.height) > 0
    && Number(shell?.width) > 0
    && Number(shell?.height) > 0
    && shell?.display !== 'none'
    && shell?.visibility === 'visible'
    && shell?.opacity !== '0'
    && Number(frame?.distinctSampleColors) >= 8;
}

async function smokeTestInstalledApp({ executable, timeoutMs = 30000, spawnProcess = spawn }) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'XRS_Smoke_Profile_'));
  const resultFile = path.join(profile, 'ready.json');
  let child;
  try {
    child = spawnProcess(executable, [`--user-data-dir=${path.join(profile, 'user-data')}`], {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, XRS_SMOKE_TEST_RESULT: resultFile },
    });
    let exitCode = null;
    child.once('exit', code => { exitCode = code ?? 1; });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = JSON.parse(await fs.readFile(resultFile, 'utf8'));
        if (result.ready === true && /^\d+\.\d+\.\d+$/.test(result.version)) return result;
        throw new Error('Новая версия не прошла проверку запуска редактора.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exitCode !== null) throw new Error(`Проверка первого запуска завершилась с кодом ${exitCode}.`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Новая версия не запустила редактор за отведённое время.');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { activateRendererUpdate, isUsableRenderer, smokeTestInstalledApp };
