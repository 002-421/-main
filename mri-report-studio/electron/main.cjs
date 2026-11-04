const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const UPDATE_MANIFEST = 'https://github.com/002-421/-main/raw/refs/heads/codex/mri-report-studio/mri-report-studio/downloads/latest.json';

// Keep the existing profile path so the rename preserves drafts and settings.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'MRI Report Studio'));
app.setName('MRI Report Studio');
let mainWindow;
const sharedDictionaryDir = process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR
  ? path.resolve(process.env.MRI_REPORT_STUDIO_DICTIONARY_DIR)
  : path.join(process.env.PUBLIC || path.dirname(app.getPath('appData')), 'Documents', 'MRI Report Studio');
const sharedDictionaryFile = path.join(sharedDictionaryDir, 'dictionary.json');
const personalDictionaryFile = path.join(app.getPath('userData'), 'dictionary.json');
let dictionaryQueue = Promise.resolve();
let updateInstalling = false;

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

async function renderPdf() {
  mainWindow.setBackgroundColor('#ffffff');
  try {
    return await mainWindow.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
      margins: { top: 16 / 25.4, bottom: 27 / 25.4, left: 18 / 25.4, right: 18 / 25.4 },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font:8px Arial,sans-serif;line-height:1.1;color:#64748b"><div style="text-align:center">Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом на основании клинико-лабораторных данных и других диагностических исследований</div><div style="text-align:center;font-style:italic">Исследование выполнено на томографе, указанном в протоколе</div><div style="text-align:right;color:#000"><span class="pageNumber"></span></div></div>',
    });
  } finally { mainWindow.setBackgroundColor('#eef1f5'); }
}

function downloadBuffer(url, limit, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Слишком много перенаправлений при загрузке обновления.'));
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com'].includes(target.hostname)) return reject(new Error('Недопустимый источник обновления.'));
    const request = https.get(target, { timeout: 30000, headers: { 'User-Agent': 'MRI-Report-Studio-Updater' } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        response.resume(); return resolve(downloadBuffer(new URL(response.headers.location, target).toString(), limit, redirects + 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Сервер обновлений ответил ${response.statusCode}.`)); }
      const chunks=[]; let total=0;
      response.on('data', chunk => { total += chunk.length; if (total > limit) { request.destroy(new Error('Файл обновления больше допустимого размера.')); } else chunks.push(chunk); });
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
  const bytes=await downloadBuffer(UPDATE_MANIFEST, 32_000);
  let manifest; try { manifest=JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Файл обновлений повреждён.'); }
  if (!manifest || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)
      || typeof manifest.url !== 'string' || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error('Файл обновлений содержит некорректные данные.');
  const artifact=new URL(manifest.url);
  if (artifact.protocol!=='https:' || !['raw.githubusercontent.com','github.com'].includes(artifact.hostname) || !artifact.pathname.endsWith('/downloads/MRI_Report_Studio_Windows_Setup.zip')) throw new Error('Недопустимая ссылка на установочный файл.');
  return { version: manifest.version, url: manifest.url, sha256: manifest.sha256.toLowerCase(), available: compareVersions(manifest.version, app.getVersion()) > 0 };
}

app.whenReady().then(() => {
  // All application resources are bundled. Clinical data is never sent to a server.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('documents'), path.basename(item.getFilename())),
    });
  });

  mainWindow = new BrowserWindow({
    width: 1500, height: 1000, minWidth: 900, minHeight: 650,
    title: 'MRI Report Studio', backgroundColor: '#eef1f5',
    icon: path.join(__dirname, '..', 'dist', 'mri-report-studio.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
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
  ipcMain.handle('updates:install', async event => {
    requireMain(event);
    if (updateInstalling) throw new Error('Установка обновления уже запущена.');
    if (process.platform !== 'win32') throw new Error('Автообновление установщика поддерживается в Windows-версии приложения.');
    const update=await getUpdateManifest();
    if (!update.available) return { available:false };
    const archive=await downloadBuffer(update.url, 250_000_000);
    const checksum=crypto.createHash('sha256').update(archive).digest('hex');
    if(checksum!==update.sha256) throw new Error('Контрольная сумма обновления не совпала. Установка остановлена.');
    const file=path.join(os.tmpdir(),`MRI_Report_Studio_${update.version}_${crypto.randomUUID()}.zip`);
    const statusFile=`${file}.status`;
    await fs.writeFile(file,archive,{flag:'wx'});
    const script=path.join(app.getAppPath(),'updater','update_windows.ps1');
    // -ExecutionPolicy applies only to this PowerShell process. -File ensures
    // the updater's param() block receives each argument through normal binding.
    const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,file,path.dirname(process.execPath),update.version,statusFile],{windowsHide:true,stdio:'ignore',detached:true});
    let childExitCode=null;
    child.once('exit',code=>{childExitCode=code;});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
    const deadline=Date.now()+10*60*1000;
    let status='';
    while(Date.now()<deadline){
      try{const observed=(await fs.readFile(statusFile,'utf8')).trim();if(observed==='ready'||observed.startsWith('error:')){status=observed;break;}}catch(error){if(error.code!=='ENOENT')throw error;}
      if(childExitCode!==null)throw new Error(`Установщик завершился без подтверждения запуска новой версии (код ${childExitCode}).`);
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!status)throw new Error('Установщик не подтвердил запуск новой версии. Повторите проверку или используйте установочный пакет вручную.');
    if(status.startsWith('error:'))throw new Error(status.slice(6)||'Установщик не смог запустить новую версию.');
    if(status!=='ready')throw new Error('Установщик вернул неизвестный статус.');
    updateInstalling=true;
    await fs.unlink(statusFile).catch(()=>{});
    setTimeout(()=>app.quit(),300);
    return { available:true, installing:true, version:update.version };
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
