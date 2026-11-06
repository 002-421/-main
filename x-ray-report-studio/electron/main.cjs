const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { installUpdateArchive } = require('./update-install.cjs');
const { activateRendererUpdate, isUsableRenderer } = require('./live-update.cjs');
const { summarizeFrame } = require('./startup-diagnostics.cjs');
const UPDATE_MANIFEST = 'https://raw.githubusercontent.com/002-421/-main/codex/mri-report-studio/x-ray-report-studio/downloads/latest.json';

// Some Windows display drivers show a blank Electron surface despite the page
// loading successfully. This text editor is small enough to render in software.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-features', 'DirectComposition');

// Keep the existing profile path so the rename preserves drafts and settings.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'MRI Report Studio'));
app.setName('X-ray Report Studio');
let mainWindow;
let rendererUnresponsive = false;
let rendererReady = false;
let startupLogFile = '';
let startupLogQueue = Promise.resolve();
let startupWatchdog;
let startupFailureDialogOpen = false;
let startupRecoveryAttempted = false;
const sharedDictionaryDir = process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR
  ? path.resolve(process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR)
  : path.join(process.env.PUBLIC || path.dirname(app.getPath('appData')), 'Documents', 'MRI Report Studio');
const sharedDictionaryFile = path.join(sharedDictionaryDir, 'dictionary.json');
const personalDictionaryFile = path.join(app.getPath('userData'), 'dictionary.json');
let dictionaryQueue = Promise.resolve();
let updateInstalling = false;
let latestUpdateLogPath = '';
let activeApplicationVersion = app.getVersion();
let pendingRendererReady;
let liveUpdateInProgress = false;

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
  startupLogQueue = startupLogQueue.then(() => fs.appendFile(startupLogFile, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, 'utf8')).catch(() => {});
  return startupLogQueue;
}

async function showStartupFailure(message) {
  if (startupFailureDialogOpen || !mainWindow || mainWindow.isDestroyed()) return;
  startupFailureDialogOpen = true;
  await logStartup({ event: 'startup-failure', message, logFile: startupLogFile });
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
    queue = queue.then(() => fs.appendFile(filename, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, 'utf8')).catch(() => {});
    return queue;
  };
  await log({ event: 'log-start', applicationVersion: app.getVersion(), platform: process.platform });
  return { filename, log };
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

function downloadBuffer(url, limit, redirects = 0, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений при загрузке обновления.'));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com'].includes(target.hostname)) return reject(new Error('Недопустимый источник обновления.'));
    const request = https.get(target, { timeout: 30000, headers: { 'User-Agent': 'MRI-Report-Studio-Updater', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        response.resume(); return resolve(downloadBuffer(new URL(response.headers.location, target).toString(), limit, redirects + 1, onProgress));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Сервер обновлений ответил ${response.statusCode}.`)); }
      const chunks=[]; let total=0;
      const expected = Number(response.headers['content-length']) || 0;
      onProgress({loaded:0,total:expected,percent:expected?0:null});
      response.on('data', chunk => { total += chunk.length; if (total > limit) { request.destroy(new Error('Файл обновления больше допустимого размера.')); } else { chunks.push(chunk); onProgress({loaded:total,total:expected,percent:expected?Math.min(100,Math.round(total/expected*100)):null}); } });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => request.destroy(new Error('Время ожидания сервера обновлений истекло.')));
    request.on('error', reject);
  });
}
function compareVersions(left, right) {
  const a=String(left).split('.').map(Number), b=String(right).split('.').map(Number);
  for(let i=0;i<Math.max(a.length,b.length);i++){const delta=(a[i]||0)-(b[i]||0);if(delta)return delta;}
  return 0;
}
async function getUpdateManifest() {
  const manifestUrl = new URL(UPDATE_MANIFEST);
  manifestUrl.searchParams.set('check', `${Date.now()}-${crypto.randomUUID()}`);
  const bytes=await downloadBuffer(manifestUrl.toString(), 32_000);
  let manifest; try { manifest=JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Файл обновлений повреждён.'); }
  if (!manifest || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)
      || typeof manifest.url !== 'string' || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('Файл обновлений содержит некорректные данные.');
  const artifact=new URL(manifest.url);
  if (artifact.protocol!=='https:' || !['raw.githubusercontent.com','github.com'].includes(artifact.hostname) || !artifact.pathname.endsWith('/downloads/X-ray_Report_Studio_Windows_Setup.zip')) throw new Error('Недопустимая ссылка на установочный файл.');
  return { version: manifest.version, currentVersion: activeApplicationVersion, url: manifest.url, sha256: manifest.sha256.toLowerCase(), available: compareVersions(manifest.version, activeApplicationVersion) > 0 };
}

app.whenReady().then(async () => {
  const exportSettingsFile = path.join(app.getPath('userData'), 'export-folders.json');
  let lastWordDirectory = '';
  try { const saved = JSON.parse(await fs.readFile(exportSettingsFile, 'utf8')); if (typeof saved.word === 'string' && path.isAbsolute(saved.word)) lastWordDirectory = saved.word; } catch {}

  startupLogFile = path.join(app.getPath('userData'), 'logs', `startup-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
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
        if (!liveUpdateInProgress && !isUsableRenderer(details, summary)) {
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
  session.defaultSession.on('will-download', (_event, item) => {
    const isWord = /\.docx$/i.test(item.getFilename());
    const directory = isWord && lastWordDirectory && require('node:fs').existsSync(lastWordDirectory) ? lastWordDirectory : app.getPath('documents');
    item.setSaveDialogOptions({
      title: 'Сохранить файл',
      defaultPath: path.join(directory, path.basename(item.getFilename())),
    });
    if (isWord) item.once('done', async (_event, state) => {
      if (state !== 'completed' || !item.getSavePath()) return;
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
  mainWindow.webContents.on('did-finish-load', () => { void logStartup({ event: 'page-finished-loading', url: mainWindow.webContents.getURL() }); });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    void logStartup({ event: 'page-load-failed', errorCode, errorDescription, validatedURL, isMainFrame });
    if (isMainFrame && errorCode !== -3 && !liveUpdateInProgress) void showStartupFailure(`Не удалось загрузить интерфейс приложения (${errorCode}).`);
  });
  mainWindow.webContents.on('console-message', (_event, details) => {
    if (details?.level >= 2) void logStartup({ event: 'renderer-console-error', level: details.level, message: details.message, line: details.lineNumber, source: details.sourceId });
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
  ipcMain.handle('app:version', async event => {
    requireMain(event);
    return activeApplicationVersion;
  });
  ipcMain.handle('updates:open-log', async event => {
    requireMain(event);
    return openLatestUpdateLog();
  });
  ipcMain.handle('updates:install', async (event, force = false) => {
    requireMain(event);
    if (updateInstalling) throw new Error('Установка обновления уже запущена.');
    if (process.platform !== 'win32') throw new Error('Автообновление установщика поддерживается в Windows-версии приложения.');
    if (typeof force !== 'boolean') throw new Error('Некорректный режим установки обновления.');
    const update=await getUpdateManifest();
    if (!update.available && !force) return { available:false };
    const { filename: logFile, log } = await createUpdateLogger();
    await log({ event: 'update-requested', currentVersion: app.getVersion(), targetVersion: update.version, archiveUrl: update.url });
    const sendProgress = progress => { if (!event.sender.isDestroyed()) event.sender.send('updates:progress', progress); };
    let file = '';
    let archiveBytes = 0;
    try {
      sendProgress({stage:'downloading',loaded:0,total:0,percent:0});
      await log({ event: 'download-start', url: update.url });
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
      if(checksum!==update.sha256) throw new Error('Контрольная сумма обновления не совпала. Установка остановлена.');
      await log({ event: 'checksum-verified' });
      file=path.join(os.tmpdir(),`X-ray_Report_Studio_${update.version}_${crypto.randomUUID()}.zip`);
      await fs.writeFile(file,archive,{flag:'wx'});
      sendProgress({stage:'installing',loaded:archive.length,total:archive.length,percent:100});
      const installed = await installUpdateArchive({
        archive: file,
        currentRoot: path.dirname(process.execPath),
        version: update.version,
        log,
        writeShortcut: async (target, cwd, icon) => {
          const shortcut = path.join(app.getPath('desktop'), 'X-ray Report Studio.lnk');
          const options = { target, cwd, icon, description: 'X-ray Report Studio' };
          const written = shell.writeShortcutLink(shortcut, 'replace', options)
            || shell.writeShortcutLink(shortcut, 'create', options);
          if (!written) throw new Error('Не удалось обновить ярлык приложения на рабочем столе.');
          await fs.unlink(path.join(app.getPath('desktop'), 'MRI Report Studio.lnk')).catch(() => {});
        },
      });
      await log({ event: 'update-files-ready', root: installed.root, targetVersion: update.version });
      const previousApplicationVersion = activeApplicationVersion;
      activeApplicationVersion = update.version;
      rendererReady = false;
      liveUpdateInProgress = true;
      const previousIndex = path.join(__dirname, '..', 'dist', 'index.html');
      const installedIndex = path.join(installed.root, 'resources', 'app', 'dist', 'index.html');
      try {
        await activateRendererUpdate({
          loadFile: filename => mainWindow.loadFile(filename),
          installedIndex,
          previousIndex,
          waitForReady: waitForRendererReady,
        });
      } catch (activationError) {
        liveUpdateInProgress = false;
        activeApplicationVersion = previousApplicationVersion;
        const oldExecutable = process.execPath;
        const oldRoot = path.dirname(oldExecutable);
        const oldIcon = path.join(oldRoot, 'resources', 'app', 'dist', 'x-ray-report-studio.ico');
        const oldShortcut = path.join(app.getPath('desktop'), 'X-ray Report Studio.lnk');
        const oldShortcutOptions = { target: oldExecutable, cwd: oldRoot, icon: oldIcon, description: 'X-ray Report Studio' };
        const shortcutRestored = shell.writeShortcutLink(oldShortcut, 'replace', oldShortcutOptions)
          || shell.writeShortcutLink(oldShortcut, 'create', oldShortcutOptions);
        await mainWindow.webContents.executeJavaScript(`(()=>{const label=document.querySelector('#application-version');if(label)label.textContent=${JSON.stringify(activeApplicationVersion)}})()`).catch(() => {});
        await log({ event: 'live-renderer-update-failed', message: activationError.message, rollbackError: activationError.rollbackError?.message });
        await log({ event: 'shortcut-rollback', restored: shortcutRestored, target: oldExecutable });
        if (!rendererReady) void showStartupFailure('Не удалось загрузить новую и предыдущую версии интерфейса.');
        throw new Error(`Файлы установлены, но новый интерфейс не запустился. Открыта предыдущая версия. ${activationError.message}`);
      }
      liveUpdateInProgress = false;
      await log({ event: 'live-renderer-update-complete', targetVersion: update.version });
    } catch (error) {
      await log({ event: 'update-error', message: error.message, stack: error.stack, logFile });
      sendProgress({stage:'error',loaded:0,total:0,percent:0,message:error.message,logFile});
      throw new Error(`${error.message} Журнал обновления: ${logFile}`);
    } finally { if (file) await fs.unlink(file).catch(() => {}); }
    updateInstalling=false;
    sendProgress({stage:'installed',loaded:archiveBytes,total:archiveBytes,percent:100});
    return { available:true, installing:false, version:update.version };
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
