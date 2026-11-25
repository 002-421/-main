const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, session, shell } = require('electron');
const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { installUpdateArchive, verifySha256, writeShortcutAtomically } = require('./update-install.cjs');
const { activateRendererUpdate, isUsableRenderer } = require('./live-update.cjs');
const {
  CURRENT_DATA_SCHEMA, readJson, writeJsonAtomic, ensureDataSchema,
  getStartupFirstStartDecision, samePath, reconcileStableInstallState,
  recordFirstStartAttempt, confirmFirstStart,
} = require('./install-state.cjs');
const { STABLE_MANIFEST, validateManifest, chooseUpdate } = require('./update-channel.cjs');
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

// Stable releases use the established profile. Channel selection is not part
// of the public updater; test-kit runs can still isolate their profile below.
if (TEST_KIT_ROOT) {
  app.setPath('appData', path.join(TEST_KIT_ROOT, 'AppData'));
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(TEST_KIT_ROOT, 'Profile'));
} else if (!INVALID_TEST_KIT_LAUNCH) {
  if (!app.commandLine.hasSwitch('user-data-dir'))
    app.setPath('userData', path.join(app.getPath('appData'), 'MRI Report Studio'));
}
if (TEST_KIT_ROOT) app.setPath('sessionData', path.join(app.getPath('userData'), 'Session Data'));
app.setName('X-ray Report Studio');
const ownsSingleInstanceLock = app.requestSingleInstanceLock();
if (!ownsSingleInstanceLock) app.quit();
let mainWindow;
if (ownsSingleInstanceLock) app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
let rendererUnresponsive = false;
let rendererReady = false;
let startupLogFile = '';
let startupLogQueue = Promise.resolve();
let startupWatchdog;
let startupFailureDialogOpen = false;
let startupRecoveryAttempted = false;
const sharedDictionaryDir = process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR
  ? path.resolve(process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR)
  : TEST_KIT_ROOT
    ? path.join(TEST_KIT_ROOT, 'Shared Dictionary')
    : path.join(process.env.PUBLIC || path.dirname(app.getPath('appData')), 'Documents', 'MRI Report Studio');
const sharedDictionaryFile = path.join(sharedDictionaryDir, 'dictionary.json');
const personalDictionaryFile = path.join(app.getPath('userData'), 'dictionary.json');
let dictionaryQueue = Promise.resolve();
let updateInstalling = false;
let activeApplicationVersion = app.getVersion();
let pendingRendererReady;
let liveUpdateInProgress = false;
let activeApplicationRoot = path.dirname(process.execPath);
let activeRendererIndex = path.join(__dirname, '..', 'dist', 'index.html');
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
  startupLogQueue = startupLogQueue.then(async () => {
    if(await fs.stat(startupLogFile).then(s=>s.size>1000000).catch(()=>false))await fs.rename(startupLogFile,startupLogFile+'.previous').catch(()=>{});
    await fs.appendFile(startupLogFile, `${JSON.stringify({ time: new Date().toISOString(), ...safe })}\n`, 'utf8');
    const logs=(await fs.readdir(path.dirname(startupLogFile))).filter(n=>/^startup-.*\.log(?:\.previous)?$/.test(n)).sort();
    for(const name of logs.slice(0,-10))await fs.unlink(path.join(path.dirname(startupLogFile),name)).catch(()=>{});
  }).catch(() => {});
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
  let queue = Promise.resolve();
  const log = createUpdateLogWriter(filename, () => queue, value => { queue = value; });
  await log({ event: 'log-start', applicationVersion: app.getVersion(), platform: process.platform });
  return { filename, log };
}

function describeUpdateFailure(error, phase, logFile) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code)
    ? error.code : 'UPDATE_FAILED';
  const errorType = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'SystemError'].includes(error?.name) ? error.name : '';
  const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : '';
  const operation = {
    'create-directory': 'создание временной папки',
    'extract-zip': 'распаковка проверенного архива',
    'copy-electron-runtime': 'копирование Electron runtime в новую папку',
    'verify-current-install': 'проверка текущей установки',
    'validate-install-input': 'проверка параметров установки',
    'invoke-install-update-archive': 'запуск установщика обновления',
    'remove-staged-app': 'замена файлов приложения в подготовленной папке',
    'copy-verified-app': 'копирование новой версии приложения',
    'activate-version-directory': 'подготовка отдельной папки версии',
  }[error?.xrsOperation];
  const phaseLabel = {
    manifest: 'проверка сведений об обновлении',
    download: 'загрузка архива',
    checksum: 'проверка SHA-256 архива',
    'write-archive': 'сохранение проверенного архива',
    'prepare-install': 'подготовка новой установки',
    'validate-package': 'проверка содержимого архива',
    'activate-renderer': 'проверка интерфейса новой версии',
    'switch-shortcut': 'переключение ярлыка',
    'commit-install-state': 'сохранение сведений о первом запуске',
  }[phase] ?? 'установка обновления';
  const reason = {
    EBUSY: 'файл занят другим процессом',
    EPERM: 'операция запрещена Windows',
    EACCES: 'нет доступа к файлу или папке',
    ENOSPC: 'недостаточно свободного места',
    ENOENT: 'не найден обязательный файл',
    EEXIST: 'целевой файл уже существует',
    EIO: 'ошибка чтения или записи диска',
    ETIMEDOUT: 'истекло время ожидания',
    UNSAFE_ARCHIVE: 'структура ZIP не прошла проверку безопасности',
    EXTRACT_FAILED: 'Windows не смогла распаковать ZIP',
    PACKAGE_VERSION_MISMATCH: 'версия внутри ZIP не совпадает с манифестом',
    INSTALL_ROOT_INVALID: 'не удалось определить каталог текущей установки',
    CURRENT_INSTALL_INVALID: 'файлы текущей установки недоступны',
    UPDATE_ARCHIVE_PATH_INVALID: 'не удалось определить путь проверенного архива',
    SHORTCUT_WRITE_FAILED: 'Windows не создала новый ярлык',
  }[code];
  const location = operation || phaseLabel;
  const diagnostic = [code, reason, code === 'UPDATE_FAILED' && errorType ? errorType : '', syscall].filter(Boolean).join(' — ');
  return `Обновление остановлено на этапе «${location}» (${diagnostic}). Предыдущая версия и профиль оставлены без изменений.${logFile ? ` Журнал обновления: ${logFile}` : ''}`;
}

function createUpdateLogWriter(filename, getQueue = () => Promise.resolve(), setQueue = () => {}) {
  return entry => {
    const safe = sanitizeUpdateLogEvent(entry);
    const queue = getQueue().then(() => fs.appendFile(filename, `${JSON.stringify({ time: new Date().toISOString(), ...safe })}\n`, 'utf8')).catch(() => {});
    setQueue(queue);
    return queue;
  };
}

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
  startupInstallState = confirmFirstStart(startupInstallState, activeApplicationRoot, process.execPath, app.getVersion());
  await writeJsonAtomic(installStateFile, startupInstallState);
  pendingFirstLaunch = false;
  await logStartup({ event: 'update-first-start-confirmed', version: startupInstallState.current.version });
}

async function initializeInstallState() {
  installStateFile = path.join(app.getPath('userData'), 'install-state.json');
  dataSchemaFile = path.join(app.getPath('userData'), 'data-schema.json');
  currentDataState = await ensureDataSchema(dataSchemaFile, CURRENT_DATA_SCHEMA);
  try { startupInstallState = await readJson(installStateFile, null); }
  catch (error) {
    startupInstallState = null;
    const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'INSTALL_STATE_UNREADABLE';
    await logStartup({ event: 'install-state-ignored', errorCode });
  }
  activeApplicationRoot = path.dirname(process.execPath);
  if (process.platform === 'win32' && startupInstallState?.status === 'stable'
      && (startupInstallState.current?.version !== app.getVersion()
        || !samePath(startupInstallState.current?.root, activeApplicationRoot)
        || !samePath(startupInstallState.current?.executable, process.execPath))) {
    try {
      const shortcutTarget = shell.readShortcutLink(shortcutLocation()).target;
      const repairedState = reconcileStableInstallState({
        installState: startupInstallState,
        dataState: currentDataState,
        runtimeVersion: app.getVersion(),
        runtimeRoot: activeApplicationRoot,
        runtimeExecutable: process.execPath,
        runtimeAppPath: app.getAppPath(),
        shortcutTarget,
      });
      if (repairedState) {
        const staleVersion = startupInstallState.current.version;
        await writeJsonAtomic(installStateFile, repairedState);
        startupInstallState = repairedState;
        await logStartup({ event: 'stable-install-state-reconciled', previousRecordedVersion: staleVersion, runtimeVersion: app.getVersion() });
      } else {
        await logStartup({ event: 'stable-install-state-mismatch-unrepaired', runtimeVersion: app.getVersion() });
      }
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'STATE_RECONCILE_FAILED';
      await logStartup({ event: 'stable-install-state-mismatch-unrepaired', errorCode, runtimeVersion: app.getVersion() });
    }
  }
  const current = startupInstallState?.current;
  const startupAction = getStartupFirstStartDecision(startupInstallState, activeApplicationRoot, process.execPath, app.getVersion());
  if (startupAction !== 'candidate' || !current) {
    if (startupAction === 'ignore-legacy-state')
      await logStartup({ event: 'legacy-pending-install-state-ignored', runtimeVersion: app.getVersion() });
    return 'normal';
  }
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
  startupInstallState = recordFirstStartAttempt(startupInstallState, activeApplicationRoot, process.execPath, app.getVersion());
  pendingFirstLaunch = true;
  await writeJsonAtomic(installStateFile, startupInstallState);
  return 'candidate';
}

async function renderPdf() {
  mainWindow.setBackgroundColor('#ffffff');
  try {
    return await mainWindow.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      displayHeaderFooter: false,
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
async function readUpdateManifest() {
  let bytes;
  if (TEST_KIT_ROOT) {
    bytes = await fs.readFile(path.join(TEST_KIT_ROOT, 'Updates', 'latest.json'));
  } else {
    const manifestUrl = new URL(STABLE_MANIFEST);
    manifestUrl.searchParams.set('check', `${Date.now()}-${crypto.randomUUID()}`);
    bytes = await downloadBuffer(manifestUrl.toString(), 32_000);
  }
  let manifest; try { manifest=JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Файл обновлений повреждён.'); }
  return validateManifest(manifest, TEST_KIT_ROOT);
}
async function getUpdateManifest() {
  return chooseUpdate('stable', activeApplicationVersion, [await readUpdateManifest()]);
}

app.whenReady().then(async () => {
  if (!ownsSingleInstanceLock) return;
  if (INVALID_TEST_KIT_LAUNCH) {
    dialog.showErrorBox('XRS-05 test kit', 'Запустите эту тестовую копию через Run-Test-App.cmd. Профиль и рабочий ярлык не были открыты.');
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
  for(const event of ['minimize','restore','resize'])mainWindow.on(event,()=>void logStartup({event:'window-'+event}));
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
    else if(!liveUpdateInProgress) void dialog.showMessageBox(mainWindow,{type:'error',message:'Процесс интерфейса завершился. Закройте и заново откройте XRS. Сохранённое рабочее пространство не удалено.',buttons:['Закрыть сообщение']});
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
  mainWindow.loadFile(activeRendererIndex);

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
  const templateUpdates=require('./template-update-service.cjs').createTemplateUpdateService({userData:app.getPath('userData'),appVersion:activeApplicationVersion,source:require('./template-source.cjs'),baseline:require('./template-baseline.cjs'),log:value=>void logStartup(value)});
  const templateAdmin=new (require('./template-admin.cjs').TemplateAdmin)({directory:path.join(app.getPath('userData'),'template-admin-v1'),baseline:require('./template-baseline.cjs').templates,allowedImages:require('./template-baseline.cjs').allowedImages,audit:value=>void logStartup(value),loadSource:async(id,version)=>{const row=await templateUpdates.revision(id,version);return row.builtin?require('./template-baseline.cjs').templates.find(t=>t.id===id):row.template;}});
  const adminCall=(name,fn)=>ipcMain.handle('templates:admin-'+name,async(event,...args)=>{requireMain(event);try{return await fn(event.sender.id,...args);}catch(e){throw Error(e.name==='TemplateProtocolError'?e.code:'ADMIN_OPERATION_FAILED');}});
  adminCall('status',()=>templateAdmin.status());adminCall('setup',(_owner,pin,confirm)=>templateAdmin.setup(pin,confirm));adminCall('unlock',(owner,pin)=>templateAdmin.unlock(pin,owner));adminCall('lock',(owner,token)=>templateAdmin.lock(token,owner));adminCall('draft',(owner,token,proposal)=>templateAdmin.draft(token,owner,proposal));adminCall('drafts',(owner,token)=>templateAdmin.drafts(token,owner));adminCall('export',(owner,token,id)=>templateAdmin.preparePublication(token,owner,id));adminCall('publish',(owner,token)=>templateAdmin.publish(token,owner));
  ipcMain.handle('templates:revision',async(event,id,version)=>{requireMain(event);return templateUpdates.revision(id,version);});
  ipcMain.handle('templates:state',async event=>{requireMain(event);return templateUpdates.state();});
  ipcMain.handle('templates:check',async event=>{requireMain(event);return templateUpdates.check();});
  ipcMain.handle('templates:install',async(event,planId,confirmed)=>{requireMain(event);if(typeof planId!=='string'||planId.length>100)throw Error('INVALID_PLAN');return templateUpdates.install(planId,confirmed===true);});
  ipcMain.handle('templates:rollback',async(event,confirmed)=>{requireMain(event);return templateUpdates.rollback(confirmed===true);});
  ipcMain.handle('updates:check', async event => {
    requireMain(event);
    return getUpdateManifest();
  });
  ipcMain.handle('app:version', async event => {
    requireMain(event);
    return activeApplicationVersion;
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
    let installed;
    let candidateIndex = '';
    let shortcutChanged = false;
    let rendererActivated = false;
    const previousRoot = activeApplicationRoot;
    const previousVersion = activeApplicationVersion;
    const previousIndex = activeRendererIndex;
    try {
      ({ filename: logFile, log } = await createUpdateLogger());
      const update=await getUpdateManifest();
      if (!update.available) {
        await log({ event: 'update-not-available', currentVersion: activeApplicationVersion });
        return { available:false };
      }
      await log({ event: 'update-requested', currentVersion: activeApplicationVersion, targetVersion: update.version });
      updatePhase = 'download';
      sendProgress({stage:'downloading',loaded:0,total:0,percent:0});
      await log({ event: 'download-start', operation: 'download-archive' });
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
      updatePhase = 'checksum';
      sendProgress({stage:'verifying',loaded:archive.length,total:archive.length,percent:100});
      const checksum=crypto.createHash('sha256').update(archive).digest('hex');
      await log({ event: 'checksum-check', expected: update.sha256, actual: checksum });
      if(!verifySha256(archive,update.sha256)) throw new Error('Контрольная сумма обновления не совпала. Установка остановлена.');
      await log({ event: 'checksum-verified', expected: update.sha256, actual: checksum });
      updatePhase = 'write-archive';
      file=path.join(os.tmpdir(),`X-ray_Report_Studio_${update.version}_${crypto.randomUUID()}.zip`);
      await fs.writeFile(file,archive,{flag:'wx'});
      await log({ event: 'verified-archive-written', targetVersion: update.version, bytes: archive.length, expected: update.sha256, actual: checksum, operation: 'write-verified-archive' });
      sendProgress({stage:'installing',loaded:archive.length,total:archive.length,percent:100});
      updatePhase = 'prepare-install';
      await log({
        event: 'install-call-start', phase: updatePhase, targetVersion: update.version,
        currentRootAvailable: typeof previousRoot === 'string' && previousRoot.length > 0,
        currentRootAbsolute: typeof previousRoot === 'string' && path.isAbsolute(previousRoot),
        archiveAvailable: typeof file === 'string' && file.length > 0,
      });
      installed = await installUpdateArchive({ archive: file, currentRoot: previousRoot, version: update.version, log });
      candidateIndex = path.join(installed.root, 'resources', 'app', 'dist', 'index.html');
      await log({ event: 'update-files-ready', targetVersion: update.version, operation: 'prepare-side-by-side-install' });

      updatePhase = 'activate-renderer';
      activeApplicationVersion = update.version;
      activeApplicationRoot = installed.root;
      activeRendererIndex = candidateIndex;
      rendererReady = false;
      liveUpdateInProgress = true;
      try {
        await activateRendererUpdate({
          loadFile: filename => mainWindow.loadFile(filename),
          installedIndex: candidateIndex,
          previousIndex,
          waitForReady: waitForRendererReady,
        });
      } catch (activationError) {
        activeApplicationVersion = previousVersion;
        activeApplicationRoot = previousRoot;
        activeRendererIndex = previousIndex;
        liveUpdateInProgress = false;
        await log({ event: 'live-renderer-update-failed', phase: updatePhase, errorCode: 'RENDERER_ACTIVATION_FAILED', recoveryAction: 'keep-previous-renderer-and-shortcut' });
        activationError.code ??= 'RENDERER_ACTIVATION_FAILED';
        throw activationError;
      }
      rendererActivated = true;

      updatePhase = 'switch-shortcut';
      await pointShortcutTo(installed.executable, installed.root);
      shortcutChanged = true;
      await log({ event: 'shortcut-updated', targetVersion: update.version, operation: 'atomic-shortcut-replacement' });

      updatePhase = 'commit-install-state';
      const nextInstallState = {
        status: 'pending-first-start', launchAttempts: 0,
        current: { version: update.version, root: installed.root, executable: installed.executable, dataSchemaVersion: currentDataState?.schemaVersion ?? CURRENT_DATA_SCHEMA },
        previous: { version: previousVersion, root: previousRoot, executable: path.join(previousRoot, 'X-ray Report Studio.exe'), dataSchemaVersion: currentDataState?.schemaVersion ?? CURRENT_DATA_SCHEMA },
      };
      await writeJsonAtomic(installStateFile, nextInstallState);
      startupInstallState = nextInstallState;
      liveUpdateInProgress = false;
      await log({ event: 'live-renderer-update-complete', targetVersion: update.version, recoveryAction: 'retain-previous-install-for-first-start-rollback' });
    } catch (error) {
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? error.code : 'UPDATE_FAILED';
      const syscall = typeof error?.syscall === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(error.syscall) ? error.syscall : undefined;
      const errorType = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'SystemError'].includes(error?.name) ? error.name : 'Unknown';
      updatePhase = error?.xrsPhase || updatePhase;
      if (shortcutChanged) {
        try {
          await pointShortcutTo(path.join(previousRoot, 'X-ray Report Studio.exe'), previousRoot);
          await log({ event: 'shortcut-rollback', phase: updatePhase, restored: true, recoveryAction: 'restore-previous-install' });
        } catch (rollbackError) {
          await log({ event: 'shortcut-rollback', phase: updatePhase, restored: false, errorCode: rollbackError?.code || 'SHORTCUT_ROLLBACK_FAILED', recoveryAction: 'previous-install-retained' });
        }
      }
      if (rendererActivated) {
        activeApplicationVersion = previousVersion;
        activeApplicationRoot = previousRoot;
        activeRendererIndex = previousIndex;
        rendererReady = false;
        liveUpdateInProgress = true;
        try {
          await activateRendererUpdate({
            loadFile: filename => mainWindow.loadFile(filename),
            installedIndex: previousIndex,
            previousIndex: candidateIndex,
            waitForReady: waitForRendererReady,
          });
          await log({ event: 'renderer-rollback', phase: updatePhase, restored: true, recoveryAction: 'restore-previous-renderer' });
        } catch (rollbackError) {
          await log({ event: 'renderer-rollback', phase: updatePhase, restored: false, errorCode: rollbackError?.code || 'RENDERER_ROLLBACK_FAILED', recoveryAction: 'previous-install-retained' });
        } finally { liveUpdateInProgress = false; }
      } else {
        activeApplicationVersion = previousVersion;
        activeApplicationRoot = previousRoot;
        activeRendererIndex = previousIndex;
        liveUpdateInProgress = false;
      }
      const operation = typeof error?.xrsOperation === 'string' ? error.xrsOperation
        : updatePhase === 'prepare-install' ? 'invoke-install-update-archive' : undefined;
      await log({ event: 'update-error', errorCode, errorType, phase: updatePhase, ...(operation ? { operation } : {}), ...(syscall ? { syscall } : {}), recoveryAction: 'retain-previous-install-and-profile' });
      const message = describeUpdateFailure({ ...error, code: errorCode, xrsOperation: operation }, updatePhase, logFile);
      sendProgress({stage:'error',loaded:0,total:0,percent:0,message,logFile});
      throw new Error(message);
    } finally {
      liveUpdateInProgress = false;
      if (file) await fs.unlink(file).catch(() => {});
      updateInstalling = false;
    }
    sendProgress({stage:'installed',loaded:archiveBytes,total:archiveBytes,percent:100});
    return { available:true, installing:false, version:activeApplicationVersion };
  });
  ipcMain.handle('report:copy', async (event, html, text) => {
    requireMain(event);
    if (typeof html !== 'string' || typeof text !== 'string' || html.length > 5_000_000 || text.length > 2_000_000) throw new Error('Слишком большой документ.');
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
  });
  ipcMain.handle('report:copy-plain', async (event, text) => {
    requireMain(event);
    if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Слишком большой документ.');
    await clipboard.writeText(text);
  });
  ipcMain.on('diagnostics:event',(event,value)=>{requireMain(event);if(value?.event==='renderer-exception')void logStartup({event:'renderer-exception',errorType:value.errorType,frames:value.frames});});
  ipcMain.handle('diagnostics:open',async event=>{requireMain(event);return shell.openPath(path.dirname(startupLogFile));});
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
