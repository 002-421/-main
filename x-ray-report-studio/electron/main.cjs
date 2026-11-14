const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, session, shell } = require('electron');
const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { installUpdateArchive, verifySha256, writeShortcutAtomically } = require('./update-install.cjs');
const { activateRendererUpdate, isUsableRenderer, smokeTestInstalledApp } = require('./live-update.cjs');
const { createUserDataBackup } = require('./user-data-backup.cjs');
const { CURRENT_DATA_SCHEMA, readJson, writeJsonAtomic, ensureDataSchema, canRollback } = require('./install-state.cjs');
const { STABLE_MANIFEST, BETA_MANIFEST, selectedChannel, profileForLaunch, validateManifest, chooseUpdate } = require('./update-channel.cjs');
const { changeUpdateChannel } = require('./channel-preference.cjs');
const { downloadHttps } = require('./update-download.cjs');
const { sanitizeUpdateLogEvent, sanitizeStartupLogEvent } = require('./log-safety.cjs');
const { summarizeFrame } = require('./startup-diagnostics.cjs');
const TEST_KIT_MARKER = path.join(process.resourcesPath, 'app', 'xrs-test-mode.json');
let TEST_KIT_ROOT = '';
let INVALID_TEST_KIT_LAUNCH = false;
if (app.isPackaged && fsSync.existsSync(TEST_KIT_MARKER)) {
  try {
    const marker = JSON.parse(fsSync.readFileSync(TEST_KIT_MARKER, 'utf8'));
    const requestedRoot = process.env.XRS_TEST_ROOT ?? '';
    if (marker.format === 'xrs-isolated-test-kit' && marker.allowLocalUpdateFiles === true) {
      if (path.isAbsolute(requestedRoot)) TEST_KIT_ROOT = path.resolve(requestedRoot);
      else INVALID_TEST_KIT_LAUNCH = true;
    }
  } catch { INVALID_TEST_KIT_LAUNCH = true; }
}

// Some Windows display drivers show a blank Electron surface despite the page
// loading successfully. This text editor is small enough to render in software.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-features', 'DirectComposition');

// Channel preference is local to this Windows account. Beta always uses a
// separate Chromium profile; a prerelease executable can never open Stable data.
const channelSettingsFile = path.join(TEST_KIT_ROOT ? path.join(TEST_KIT_ROOT, 'AppData') : app.getPath('appData'), 'X-ray Report Studio Channel.json');
let channelPreference = null;
try { channelPreference = JSON.parse(fsSync.readFileSync(channelSettingsFile, 'utf8')); } catch { /* Default to Stable, or Beta for a prerelease executable. */ }
let activeProfile = profileForLaunch(app.getVersion(), channelPreference);
let activeUpdateChannel = selectedChannel(channelPreference?.channel ?? (activeProfile === 'beta' ? 'beta' : 'stable'));
if (TEST_KIT_ROOT) {
  app.setPath('appData', path.join(TEST_KIT_ROOT, 'AppData'));
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(TEST_KIT_ROOT, 'Profile'));
} else if (!INVALID_TEST_KIT_LAUNCH) {
  if (!app.commandLine.hasSwitch('user-data-dir'))
    app.setPath('userData', path.join(app.getPath('appData'), activeProfile === 'beta' ? 'MRI Report Studio Beta' : 'MRI Report Studio'));
}
if (activeProfile === 'beta' || TEST_KIT_ROOT) app.setPath('sessionData', path.join(app.getPath('userData'), 'Session Data'));
app.setName('X-ray Report Studio');
let mainWindow;
let rendererUnresponsive = false;
let rendererReady = false;
let startupLogFile = '';
let startupLogQueue = Promise.resolve();
let startupWatchdog;
let startupFailureDialogOpen = false;
let startupRecoveryAttempted = false;
const sharedDictionaryDir = activeProfile === 'beta' && !TEST_KIT_ROOT
  ? path.join(app.getPath('userData'), 'Shared Dictionary')
  : process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR
  ? path.resolve(process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR)
  : TEST_KIT_ROOT
    ? path.join(TEST_KIT_ROOT, 'Shared Dictionary')
    : path.join(process.env.PUBLIC || path.dirname(app.getPath('appData')), 'Documents', 'MRI Report Studio');
const sharedDictionaryFile = path.join(sharedDictionaryDir, 'dictionary.json');
const personalDictionaryFile = path.join(app.getPath('userData'), 'dictionary.json');
let dictionaryQueue = Promise.resolve();
let updateInstalling = false;
let latestUpdateLogPath = '';
let activeApplicationVersion = app.getVersion();
let pendingRendererReady;
let liveUpdateInProgress = false;
let activeApplicationRoot = path.dirname(process.execPath);
let installStateFile = '';
let dataSchemaFile = '';
let startupInstallState = null;
let currentDataState = null;
let pendingFirstLaunch = false;

function waitForRendererReady(timeoutMs = 20000) {
  rendererReady = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRendererReady?.resolve === onReady) pendingRendererReady = undefined;
      reject(new Error(`Интерфейс не подтвердил запуск за ${timeoutMs / 1000} секунд.`));
    }, timeoutMs);
    const onReady = () => { clearTimeout(timer); resolve(); };
    const onFailure = error => { clearTimeout(timer); reject(error); };
    pendingRendererReady = { resolve: onReady, reject: onFailure };
  });
}

function logStartup(event) {
  if (!startupLogFile) return startupLogQueue;
  const safe = sanitizeStartupLogEvent(event);
  startupLogQueue = startupLogQueue.then(() => fs.appendFile(startupLogFile, `${JSON.stringify({ time: new Date().toISOString(), ...safe })}\n`, 'utf8')).catch(() => {});
  return startupLogQueue;
}

async function showStartupFailure(message) {
  if (startupFailureDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  startupFailureDialogOpen = true;
  const reverted = await restoreShortcutAfterFailedFirstLaunch();
  if (reverted && startupInstallState?.previous?.executable) {
    app.relaunch({ execPath: startupInstallState.previous.executable, args: [`--user-data-dir=${app.getPath('userData')}`] });
    app.exit(0);
    return;
  }
  await logStartup({ event: 'startup-failure' });
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'X-ray Report Studio', message,
      detail: `Диагностический журнал: ${startupLogFile}`,
      buttons: ['Закрыть', 'Перезапустить'], defaultId: 1, cancelId: 0,
    });
    if (result.response === 1) {
      rendererReady = false;
      startupFailureDialogOpen = false;
      mainWindow.webContents.reload();
      startupWatchdog = setTimeout(() => { if (!rendererReady) void showStartupFailure('Интерфейс снова не запустился.'); }, 30000);
    } else { mainWindow.destroy(); app.quit(); }
  } catch { if (!mainWindow.isDestroyed()) mainWindow.destroy(); app.quit(); }
}

function validDictionaryWords(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(word => typeof word === 'string')
    .map(word => word.trim().toLocaleLowerCase('ru-RU'))
    .filter(word => /^[а-яёa-z-]{2,80}$/i.test(word)))].slice(0, 20000);
}
async function readDictionaryFile(filename) {
  try { return validDictionaryWords(JSON.parse(await fs.readFile(filename, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function dictionaryPath() {
  try { await fs.mkdir(sharedDictionaryDir, { recursive: true }); await fs.access(sharedDictionaryDir, require('node:fs').constants.W_OK); return sharedDictionaryFile; }
  catch { await fs.mkdir(path.dirname(personalDictionaryFile), { recursive: true }); return personalDictionaryFile; }
}
async function updateDictionary(words) {
  const filename = await dictionaryPath();
  const lockFile = `${filename}.lock`;
  let lock;
  for (let attempt = 0; attempt < 80 && !lock; attempt++) {
    try { lock = await fs.open(lockFile, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - (await fs.stat(lockFile)).mtimeMs > 120000) await fs.unlink(lockFile); } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!lock) throw new Error('Не удалось получить доступ к общему словарю. Повторите сохранение.');
  try {
    const merged = validDictionaryWords([...(await readDictionaryFile(filename)), ...validDictionaryWords(words)]);
    const temp = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    await fs.rename(temp, filename);
    return { words: merged, shared: filename === sharedDictionaryFile };
  } finally {
    await lock.close();
    await fs.unlink(lockFile).catch(() => {});
  }
}

function requireMain(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Недоступный источник запроса.');
}

async function createUpdateLogger() {
  const directory = path.join(app.getPath('userData'), 'logs');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `update-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  latestUpdateLogPath = filename;
  let queue = Promise.resolve();
  const log = entry => {
    const safe = sanitizeUpdateLogEvent(entry);
    queue = queue.then(() => fs.appendFile(filename, `${JSON.stringify({ time: new Date().toISOString(), ...safe })}\n`, 'utf8')).catch(() => {});
    return queue;
  };
  await log({ event: 'log-start', applicationVersion: app.getVersion(), platform: process.platform });
  return { filename, log };
}

function backupRoot() { return path.join(app.getPath('appData'), 'X-ray Report Studio Backups'); }
function shortcutLocation() { return TEST_KIT_ROOT ? path.join(TEST_KIT_ROOT, 'Shortcuts', 'X-ray Report Studio.lnk') : path.join(app.getPath('desktop'), 'X-ray Report Studio.lnk'); }
async function pointShortcutTo(executable, root) {
  const icon = path.join(root, 'resources', 'app', 'dist', 'x-ray-report-studio.ico');
  await fs.mkdir(path.dirname(shortcutLocation()), { recursive: true });
  await writeShortcutAtomically({
    shortcutPath: shortcutLocation(), target: executable, cwd: root, icon,
    writeShortcutLink: (filename, options) => shell.writeShortcutLink(filename, 'create', options),
  });
}

async function restoreShortcutAfterFailedFirstLaunch() {
  if (!pendingFirstLaunch || !startupInstallState?.previous?.executable) return false;
  const previous = startupInstallState.previous;
  if (!(await fs.stat(previous.executable).catch(() => null))) return false;
  try {
    await pointShortcutTo(previous.executable, previous.root);
    startupInstallState = { ...startupInstallState, status: 'startup-reverted', failedAt: new Date().toISOString() };
    await writeJsonAtomic(installStateFile, startupInstallState);
    pendingFirstLaunch = false;
    await logStartup({ event: 'update-first-start-reverted' });
    return true;
  } catch (error) {
    await logStartup({ event: 'update-first-start-revert-failed', errorCode: String(error.code ?? 'shortcut-error') });
    return false;
  }
}

async function markCurrentInstallHealthy() {
  if (!pendingFirstLaunch || !startupInstallState) return;
  startupInstallState = { ...startupInstallState, status: 'stable', launchAttempts: 0, healthyAt: new Date().toISOString() };
  await writeJsonAtomic(installStateFile, startupInstallState);
  pendingFirstLaunch = false;
  await logStartup({ event: 'update-first-start-confirmed', version: startupInstallState.current.version });
}

async function initializeInstallState() {
  installStateFile = path.join(app.getPath('userData'), 'install-state.json');
  dataSchemaFile = path.join(app.getPath('userData'), 'data-schema.json');
  currentDataState = await ensureDataSchema(dataSchemaFile, CURRENT_DATA_SCHEMA);
  startupInstallState = await readJson(installStateFile, null);
  activeApplicationRoot = path.dirname(process.execPath);
  const current = startupInstallState?.current;
  if (startupInstallState?.status !== 'pending-first-start' || !current || path.resolve(current.root) !== path.resolve(activeApplicationRoot)) return;
  pendingFirstLaunch = true;
  if (Number(startupInstallState.launchAttempts) >= 1) {
    const restored = await restoreShortcutAfterFailedFirstLaunch();
    if (restored && startupInstallState?.previous?.executable) {
      app.relaunch({ execPath: startupInstallState.previous.executable, args: [`--user-data-dir=${app.getPath('userData')}`] });
      app.exit(0);
      return;
    }
    if (!restored) {
      startupInstallState = { ...startupInstallState, status: 'startup-revert-required' };
      await writeJsonAtomic(installStateFile, startupInstallState);
    }
    pendingFirstLaunch = false;
    return;
  }
  startupInstallState = { ...startupInstallState, launchAttempts: 1, lastLaunchAt: new Date().toISOString() };
  pendingFirstLaunch = true;
  await writeJsonAtomic(installStateFile, startupInstallState);
}

async function openLatestUpdateLog() {
  const directory = path.join(app.getPath('userData'), 'logs');
  let filename = latestUpdateLogPath;
  if (!filename || !(await fs.stat(filename).catch(() => null))) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(entries.filter(entry => entry.isFile() && /^update-.*\.log$/.test(entry.name)).map(async entry => {
      const candidate = path.join(directory, entry.name);
      return { candidate, mtime: (await fs.stat(candidate)).mtimeMs };
    }));
    filename = files.sort((left, right) => right.mtime - left.mtime)[0]?.candidate ?? '';
  }
  if (!filename) throw new Error('Журнал обновлений ещё не создан.');
  const error = await shell.openPath(filename);
  if (error) throw new Error(`Не удалось открыть журнал: ${error}`);
}

async function getRollbackStatus() {
  try {
    const state = await readJson(installStateFile, null);
    const data = await ensureDataSchema(dataSchemaFile, CURRENT_DATA_SCHEMA);
    if (state?.status !== 'stable') return { available: false, reason: 'Для текущей установки ещё не подтверждён первый успешный запуск.' };
    const result = canRollback({ installState: state, dataState: data, currentRoot: activeApplicationRoot });
    if (!result.available) return result;
    if (!(await fs.stat(result.previousExecutable).catch(() => null))) return { available: false, reason: 'Файлы предыдущей версии не найдены.' };
    return { available: true, currentVersion: result.currentVersion, previousVersion: result.previousVersion };
  } catch {
    return { available: false, reason: 'Не удалось подтвердить совместимость формата пользовательских данных.' };
  }
}

async function createVerifiedUserDataBackup() {
  await dictionaryQueue;
  await session.defaultSession.flushStorageData();
  return createUserDataBackup({
    userDataDir: app.getPath('userData'), sharedDictionaryFile,
    backupRoot: backupRoot(), allowedBackupRoot: app.getPath('appData'), forbiddenRoots: [activeApplicationRoot], version: activeApplicationVersion,
  });
}

async function renderPdf() {
  mainWindow.setBackgroundColor('#ffffff');
  try {
    return await mainWindow.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
      margins: { top: 43 / 25.4, bottom: 27 / 25.4, left: 18 / 25.4, right: 18 / 25.4 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font:8px Arial,sans-serif;line-height:1.1;color:#64748b"><div style="text-align:center">Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом на основании клинико-лабораторных данных и других диагностических исследований</div><div style="text-align:center;font-style:italic">Исследование выполнено на томографе, указанном в протоколе</div><div style="text-align:right;color:#000"><span class="pageNumber"></span></div></div>',
    });
  } finally { mainWindow.setBackgroundColor('#eef1f5'); }
}

async function downloadBuffer(url, limit, redirects = 0, onProgress = () => {}) {
  const testTarget = new URL(url);
  if (TEST_KIT_ROOT && testTarget.protocol === 'file:') {
    const filename = path.resolve(fileURLToPath(testTarget));
    const updatesRoot = await fs.realpath(path.join(TEST_KIT_ROOT, 'Updates'));
    const realFilename = await fs.realpath(filename);
    const relative = path.relative(updatesRoot, realFilename);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Недопустимый путь к локальному тестовому обновлению.');
    const bytes = await fs.readFile(realFilename);
    if (bytes.length > limit) throw new Error('Файл обновления больше допустимого размера.');
    onProgress({ loaded: bytes.length, total: bytes.length, percent: 100 });
    return bytes;
  }
  return downloadHttps(url, limit, redirects, onProgress);
}
async function readUpdateManifest(kind) {
  let bytes;
  if (TEST_KIT_ROOT) {
    bytes = await fs.readFile(path.join(TEST_KIT_ROOT, 'Updates', kind === 'beta' ? 'beta.json' : 'latest.json'));
  } else {
    const manifestUrl = new URL(kind === 'beta' ? BETA_MANIFEST : STABLE_MANIFEST);
    manifestUrl.searchParams.set('check', `${Date.now()}-${crypto.randomUUID()}`);
    bytes = await downloadBuffer(manifestUrl.toString(), 32_000);
  }
  let manifest; try { manifest=JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Файл обновлений повреждён.'); }
  return validateManifest(manifest, kind, TEST_KIT_ROOT);
}
async function getUpdateManifest() {
  if (activeUpdateChannel === 'stable') return chooseUpdate('stable', activeApplicationVersion, [await readUpdateManifest('stable')]);
  const outcomes = await Promise.allSettled([readUpdateManifest('stable'), readUpdateManifest('beta')]);
  const candidates = outcomes.filter(result => result.status === 'fulfilled').map(result => result.value);
  if (!candidates.length) throw outcomes[0].reason;
  return chooseUpdate(activeUpdateChannel, activeApplicationVersion, candidates);
}

app.whenReady().then(async () => {
  if (INVALID_TEST_KIT_LAUNCH) {
    dialog.showErrorBox('XRS-05 test kit', 'Запустите эту тестовую копию через Run-Test-App.cmd. Профиль и рабочий ярлык не были открыты.');
    app.quit();
    return;
  }
  if (app.isPackaged && activeProfile === 'beta' && !TEST_KIT_ROOT && !app.commandLine.hasSwitch('user-data-dir')
      && fsSync.existsSync(path.join(app.getPath('appData'), 'MRI Report Studio')) && channelPreference?.onboarded !== true) {
    dialog.showErrorBox('X-ray Report Studio Beta', 'Перед первым запуском Beta закройте рабочую версию и запустите Start-XRS-Beta.cmd из тестового комплекта. Он проверит резервную копию, затем откроет отдельный профиль.');
    app.quit();
    return;
  }
  const exportSettingsFile = path.join(app.getPath('userData'), 'export-folders.json');
  let lastWordDirectory = '';
  try { const saved = JSON.parse(await fs.readFile(exportSettingsFile, 'utf8')); if (typeof saved.word === 'string' && path.isAbsolute(saved.word)) lastWordDirectory = saved.word; } catch {}

  startupLogFile = path.join(app.getPath('userData'), 'logs', `startup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  try { await initializeInstallState(); }
  catch { currentDataState = { schemaVersion: 0 }; startupInstallState = null; await logStartup({ event: 'install-metadata-unavailable' }); }
  if (currentDataState?.schemaVersion !== CURRENT_DATA_SCHEMA) {
    await dialog.showMessageBox({ type: 'error', title: 'X-ray Report Studio', message: 'Эта версия приложения несовместима с форматом сохранённых данных.', detail: 'Данные оставлены без изменений. Запустите приложение через ярлык последней рабочей версии.' });
    app.quit();
    return;
  }
  void fs.mkdir(path.dirname(startupLogFile), { recursive: true }).then(() => logStartup({ event: 'app-start', version: app.getVersion(), platform: process.platform, hardwareAcceleration: false, gpuCompositing: false, directComposition: false, executable: process.execPath, resources: process.resourcesPath }));
  ipcMain.on('app:ready', (event, details) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    rendererReady = true;
    clearTimeout(startupWatchdog);
    void logStartup({ event: 'renderer-ready', details });
    if (liveUpdateInProgress && pendingRendererReady) {
      void (async () => {
        try {
          await new Promise(resolve => setTimeout(resolve, 700));
          const frame = await mainWindow.webContents.capturePage();
          const summary = summarizeFrame(frame);
          await logStartup({ event: 'live-update-renderer-frame', summary });
          if (!isUsableRenderer(details, summary)) throw new Error('Интерфейс сообщил о запуске, но его область отображения пуста или не готова.');
          pendingRendererReady?.resolve();
          pendingRendererReady = undefined;
        } catch (error) {
          await logStartup({ event: 'live-update-renderer-validation-failed', message: error.message });
          pendingRendererReady?.reject(error);
          pendingRendererReady = undefined;
        }
      })();
    } else {
      pendingRendererReady?.resolve();
      pendingRendererReady = undefined;
    }
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const frame = await mainWindow.webContents.capturePage();
        const summary = summarizeFrame(frame);
        await logStartup({ event: 'startup-frame', ...summary });
        const usable = isUsableRenderer(details, summary);
        const smokeResult = process.env.XRS_SMOKE_TEST_RESULT;
        if (smokeResult && path.resolve(smokeResult).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(smokeResult) === 'ready.json') {
          await fs.writeFile(smokeResult, JSON.stringify({ ready: usable, version: app.getVersion() }), { flag: 'wx' }).catch(() => {});
          app.quit();
          return;
        }
        if (usable && !liveUpdateInProgress) await markCurrentInstallHealthy().catch(() => {});
        if (!liveUpdateInProgress && !usable) {
          if (!startupRecoveryAttempted) {
            startupRecoveryAttempted = true;
            rendererReady = false;
            await logStartup({ event: 'startup-render-recovery', action: 'reload-page' });
            startupWatchdog = setTimeout(() => {
              if (!rendererReady) void showStartupFailure('После повторной загрузки интерфейс не отобразился.');
            }, 20000);
            setTimeout(() => {
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
            }, 100);
          } else {
            void showStartupFailure('Интерфейс подтвердил запуск, но окно осталось пустым.');
          }
        }
      } catch (error) {
        await logStartup({ event: 'startup-frame-error', message: error.message });
      }
    }, 800);
  });
  // All application resources are bundled. Clinical data is never sent to a server.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.on('will-download', (_event, item, contents) => {
    const isWord = /\.docx$/i.test(item.getFilename());
    const directory = isWord && lastWordDirectory && require('node:fs').existsSync(lastWordDirectory) ? lastWordDirectory : app.getPath('documents');
    item.setSaveDialogOptions({
      title: 'Сохранить файл',
      defaultPath: path.join(directory, path.basename(item.getFilename())),
    });
    if (isWord) item.once('done', async (_event, state) => {
      if (state !== 'completed' || !item.getSavePath()) return;
      if(contents&&!contents.isDestroyed())contents.send('report:word-saved',item.getURL());
      lastWordDirectory = path.dirname(item.getSavePath());
      try { await fs.writeFile(exportSettingsFile, JSON.stringify({word: lastWordDirectory}), 'utf8'); } catch (error) { console.error('Не удалось сохранить папку Word:', error.message); }
    });
  });

  mainWindow = new BrowserWindow({
    width: 1500, height: 1000, minWidth: 900, minHeight: 650,
    title: 'X-ray Report Studio', backgroundColor: '#eef1f5',
    icon: path.join(__dirname, '..', 'dist', 'x-ray-report-studio.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true,
    },
  });
  startupWatchdog = setTimeout(() => { if (!rendererReady) void showStartupFailure('Интерфейс не запустился за 30 секунд.'); }, 30000);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => { void logStartup({ event: 'page-finished-loading' }); });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void logStartup({ event: 'page-load-failed', errorCode, isMainFrame });
    if (isMainFrame && errorCode !== -3 && !liveUpdateInProgress) void showStartupFailure(`Не удалось загрузить интерфейс приложения (${errorCode}).`);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details?.level >= 2) void logStartup({ event: 'renderer-console-error', level: details.level, line: details.lineNumber });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void logStartup({ event: 'renderer-process-gone', details });
    if (!rendererReady && !liveUpdateInProgress) void showStartupFailure('Процесс интерфейса приложения завершился при запуске.');
  });
  mainWindow.webContents.on('will-prevent-unload', event => event.preventDefault());
  mainWindow.webContents.on('unresponsive', () => {
    rendererUnresponsive = true;
    void logStartup({ event: 'renderer-unresponsive', rendererReady });
    if (!rendererReady) void showStartupFailure('Интерфейс приложения не отвечает при запуске.');
  });
  mainWindow.webContents.on('responsive', () => { rendererUnresponsive = false; });
  mainWindow.on('close', event => {
    if (updateInstalling) {
      event.preventDefault();
      return;
    }
    if (rendererUnresponsive) {
      event.preventDefault();
      mainWindow.destroy();
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  ipcMain.handle('report:export-pdf', async (event, name) => {
    requireMain(event);
    const filename = path.basename(String(name ?? 'МРТ_описание.pdf')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить описание в PDF',
      defaultPath: path.join(app.getPath('documents'), filename.endsWith('.pdf') ? filename : `${filename}.pdf`),
      filters: [{ name: 'Документ PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const pdf = await renderPdf();
    await fs.writeFile(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('report:preview-pdf', async event => {
    requireMain(event);
    const pdf = await renderPdf();
    return pdf.toString('base64');
  });
  ipcMain.handle('updates:check', async event => {
    requireMain(event);
    return getUpdateManifest();
  });
  ipcMain.handle('updates:channel', async event => {
    requireMain(event);
    return { channel: activeUpdateChannel, profile: activeProfile, version: activeApplicationVersion };
  });
  ipcMain.handle('updates:set-channel', async (event, requested) => {
    requireMain(event);
    if (updateInstalling) throw new Error('Дождитесь завершения установки обновления.');
    const result = await changeUpdateChannel({ requested, current: activeUpdateChannel, profile: activeProfile,
      backup: async () => {
      const betaRoot = path.join(app.getPath('appData'), 'MRI Report Studio Beta');
      const existing = await fs.lstat(betaRoot).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Каталог профиля Beta имеет небезопасный тип.');
      await createVerifiedUserDataBackup();
      }, persist: preference => writeJsonAtomic(channelSettingsFile, preference) });
    activeUpdateChannel = result.channel;
    if (result.restarting) setTimeout(() => { app.relaunch(); app.exit(0); }, 250);
    return result;
  });
  ipcMain.handle('app:version', async event => {
    requireMain(event);
    return activeApplicationVersion;
  });
  ipcMain.handle('updates:open-log', async event => {
    requireMain(event);
    return openLatestUpdateLog();
  });
  ipcMain.handle('updates:rollback-info', async event => {
    requireMain(event);
    return getRollbackStatus();
  });
  ipcMain.handle('updates:open-backups', async event => {
    requireMain(event);
    await fs.mkdir(backupRoot(), { recursive: true });
    const error = await shell.openPath(backupRoot());
    if (error) throw new Error(`Не удалось открыть папку резервных копий: ${error}`);
  });
  ipcMain.handle('updates:rollback', async event => {
    requireMain(event);
    if (process.platform !== 'win32') throw new Error('Мягкий откат ярлыка поддерживается в Windows-версии приложения.');
    if (updateInstalling) throw new Error('Обновление или откат уже выполняется.');
    updateInstalling = true;
    let state, previous, current;
    try {
    const info = await getRollbackStatus();
    if (!info.available) throw new Error(info.reason);
    state = await readJson(installStateFile, null);
    const backup = await createVerifiedUserDataBackup();
    previous = state.previous; current = state.current;
      await pointShortcutTo(previous.executable, previous.root);
      await writeJsonAtomic(installStateFile, { ...state, status: 'pending-first-start', launchAttempts: 0, current: previous, previous: current, lastRollbackAt: new Date().toISOString() });
      app.relaunch({ execPath: previous.executable, args: [`--user-data-dir=${app.getPath('userData')}`] });
      app.exit(0);
      return { starting: true, backupFiles: backup.files };
    } catch (error) {
      if (current?.executable && current?.root) await pointShortcutTo(current.executable, current.root).catch(() => {});
      if (state) await writeJsonAtomic(installStateFile, state).catch(() => {});
      throw error;
    } finally { updateInstalling = false; }
  });
  ipcMain.handle('updates:install', async event => {
    requireMain(event);
    if (updateInstalling) throw new Error('Установка обновления уже запущена.');
    if (process.platform !== 'win32') throw new Error('Автообновление установщика поддерживается в Windows-версии приложения.');
    updateInstalling = true;
    let logFile = '', log = async () => {};
    const sendProgress = progress => { if (!event.sender.isDestroyed()) event.sender.send('updates:progress', progress); };
    let file = '';
    let archiveBytes = 0;
    let updatePhase = 'manifest';
    try {
      const update=await getUpdateManifest();
      if (!update.available) return { available:false };
      ({ filename: logFile, log } = await createUpdateLogger());
      await log({ event: 'update-requested', currentVersion: activeApplicationVersion, targetVersion: update.version });
      sendProgress({stage:'downloading',loaded:0,total:0,percent:0});
      await log({ event: 'download-start' });
      let lastLoggedPercent = -10;
      const archive=await downloadBuffer(update.url, 250_000_000, 0, progress => {
        sendProgress({stage:'downloading',...progress});
        if (progress.percent !== null && progress.percent - lastLoggedPercent >= 10) {
          lastLoggedPercent = progress.percent;
          void log({ event: 'download-progress', ...progress });
        }
      });
      archiveBytes = archive.length;
      await log({ event: 'download-complete', bytes: archive.length });
      sendProgress({stage:'verifying',loaded:archive.length,total:archive.length,percent:100});
      const checksum=crypto.createHash('sha256').update(archive).digest('hex');
      await log({ event: 'checksum-check', expected: update.sha256, actual: checksum });
      if(!verifySha256(archive,update.sha256)) throw new Error('Контрольная сумма обновления не совпала. Установка остановлена.');
      await log({ event: 'checksum-verified' });
      file=path.join(os.tmpdir(),`X-ray_Report_Studio_${update.version}_${crypto.randomUUID()}.zip`);
      updatePhase = 'verified-archive-write';
      await log({ event: 'update-phase', phase:updatePhase });
      await fs.writeFile(file,archive,{flag:'wx'});
      sendProgress({stage:'installing',loaded:archive.length,total:archive.length,percent:100});
      updatePhase = 'data-schema';
      currentDataState = await ensureDataSchema(dataSchemaFile, CURRENT_DATA_SCHEMA);
      updatePhase = 'user-data-backup';
      await log({ event: 'user-data-backup-start' });
      const userBackup=await createVerifiedUserDataBackup();
      await log({ event: 'user-data-backup-verified', bytes: userBackup.bytes, files: userBackup.files });
      const previousRoot=activeApplicationRoot,previousVersion=activeApplicationVersion;
      const previousState=await readJson(installStateFile,null);
      if (previousState && (previousState.status !== 'stable' || !previousState.current || path.resolve(previousState.current.root) !== path.resolve(previousRoot)))
        throw new Error('Текущая установка не подтверждена как стабильная. Обновление отменено.');
      const previousDataSchema = previousState?.current?.dataSchemaVersion ?? CURRENT_DATA_SCHEMA;
      const previousExecutable=path.join(previousRoot,'X-ray Report Studio.exe');
      updatePhase = 'side-by-side-install';
      const installed = await installUpdateArchive({
        archive: file,
        currentRoot: previousRoot,
        version: update.version,
        log,
      });
      updatePhase = 'new-version-smoke-test';
      const smoke=await smokeTestInstalledApp({executable:installed.executable});
      if(smoke.version!==update.version)throw new Error('Проверка первого запуска сообщила неожиданную версию.');
      await log({ event: 'new-version-smoke-test-passed', targetVersion: update.version });
      activeApplicationVersion = update.version;
      rendererReady = false;
      liveUpdateInProgress = true;
      updatePhase = 'renderer-switch';
      const previousIndex = path.join(previousRoot, 'resources', 'app', 'dist', 'index.html');
      const installedIndex = path.join(installed.root, 'resources', 'app', 'dist', 'index.html');
      try {
        await activateRendererUpdate({
          loadFile: filename => mainWindow.loadFile(filename),
          installedIndex,
          previousIndex,
          waitForReady: waitForRendererReady,
        });
        const nextState={
          status:'pending-first-start',launchAttempts:0,installedAt:new Date().toISOString(),
          current:{version:update.version,root:installed.root,executable:installed.executable,dataSchemaVersion:CURRENT_DATA_SCHEMA},
          previous:{version:previousVersion,root:previousRoot,executable:previousExecutable,dataSchemaVersion:previousDataSchema},
        };
        await writeJsonAtomic(installStateFile,nextState);
        await pointShortcutTo(installed.executable,installed.root);
        startupInstallState=nextState;
        activeApplicationRoot=installed.root;
        liveUpdateInProgress = false;
        await log({ event: 'shortcut-committed', targetVersion:update.version });
      } catch (activationError) {
        liveUpdateInProgress = false;
        activeApplicationVersion = previousVersion;
        activeApplicationRoot = previousRoot;
        await writeJsonAtomic(installStateFile,startupInstallState??{status:'stable'}).catch(()=>{});
        await activateRendererUpdate({loadFile:filename=>mainWindow.loadFile(filename),installedIndex:previousIndex,previousIndex,waitForReady:waitForRendererReady}).catch(()=>{});
        const shortcutRestored = await pointShortcutTo(previousExecutable,previousRoot).then(()=>true,()=>false);
        await mainWindow.webContents.executeJavaScript(`(()=>{const label=document.querySelector('#application-version');if(label)label.textContent=${JSON.stringify(activeApplicationVersion)}})()`).catch(() => {});
        await log({ event: 'update-switch-failed', restored: shortcutRestored });
        if (!rendererReady) void showStartupFailure('Не удалось загрузить новую и предыдущую версии интерфейса.');
        throw activationError;
      }
      await log({ event: 'update-switch-complete', targetVersion: update.version });
    } catch (error) {
      const diagnostic = { event:'update-error', phase:updatePhase, message:error?.message ?? String(error), code:error?.code, syscall:error?.syscall };
      await log(diagnostic).catch(() => {});
      sendProgress({stage:'error',loaded:0,total:0,percent:0,message:diagnostic.message,phase:updatePhase,code:diagnostic.code,logFile});
      throw new Error(logFile?`${diagnostic.message} Журнал обновления: ${logFile}`:diagnostic.message);
    } finally { if (file) await fs.unlink(file).catch(() => {}); updateInstalling=false; }
    sendProgress({stage:'installed',loaded:archiveBytes,total:archiveBytes,percent:100});
    return { available:true, installing:false, version:activeApplicationVersion };
  });
  ipcMain.handle('report:copy', async (event, html, text) => {
    requireMain(event);
    if (typeof html !== 'string' || typeof text !== 'string' || html.length > 5_000_000 || text.length > 2_000_000) throw new Error('Слишком большой документ.');
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
  });
  ipcMain.handle('dictionary:load', async event => {
    requireMain(event);
    const filename = await dictionaryPath();
    return { words: await readDictionaryFile(filename), shared: filename === sharedDictionaryFile };
  });
  ipcMain.handle('dictionary:merge-save', async (event, words) => {
    requireMain(event);
    if (!Array.isArray(words) || words.length > 20000) throw new Error('Некорректный список слов.');
    const operation = dictionaryQueue.then(() => updateDictionary(words));
    dictionaryQueue = operation.catch(() => {});
    return operation;
  });
});

app.on('window-all-closed', () => app.quit());
