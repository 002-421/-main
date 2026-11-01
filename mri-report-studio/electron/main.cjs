const { app, BrowserWindow, ipcMain, dialog, clipboard, ClipboardItem, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { modelDirectory, createModelManager } = require('./ai-model.cjs');
const { createAIReviewer } = require('./ai-review.cjs');

// Keep the existing profile path so the rename preserves drafts and settings.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'MRI Report Studio'));
app.setName('MRI Report Studio');
let mainWindow;
const aiModelStore = createModelManager({ root: modelDirectory({ userData: app.getPath('userData') }) });
const aiReviewer = createAIReviewer();

function requireMain(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Недоступный источник запроса.');
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
    mainWindow.setBackgroundColor('#ffffff');
    let pdf;
    try {
      pdf = await mainWindow.webContents.printToPDF({
        printBackground: true, pageSize: 'A4', preferCSSPageSize: true,
        margins: { top: 16 / 25.4, bottom: 27 / 25.4, left: 18 / 25.4, right: 18 / 25.4 },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="width:100%;font:8px Arial,sans-serif;line-height:1.1;color:#64748b"><div style="text-align:center">Данное заключение не является диагнозом и должно быть интерпретировано лечащим врачом на основании клинико-лабораторных данных и других диагностических исследований</div><div style="text-align:center;font-style:italic">Исследование выполнено на магнитно-резонансном томографе Philips Achieva с высокой напряженностью магнитного поля 1,5 Тесла</div><div style="text-align:right;color:#000"><span class="pageNumber"></span></div></div>',
      });
    } finally { mainWindow.setBackgroundColor('#eef1f5'); }
    await fs.writeFile(result.filePath, pdf);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('report:copy', async (event, html, text) => {
    requireMain(event);
    if (typeof html !== 'string' || typeof text !== 'string' || html.length > 5_000_000 || text.length > 2_000_000) throw new Error('Слишком большой документ.');
    await clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
  });
  ipcMain.handle('ai:model-status', async event => {
    requireMain(event);
    return aiModelStore.status();
  });
  ipcMain.handle('ai:model-download', async event => {
    requireMain(event);
    return aiModelStore.ensure(progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:model-progress', progress);
    });
  });
  ipcMain.handle('ai:review', async (event, blocks) => {
    requireMain(event);
    if (!(await aiModelStore.status()).ready) throw new Error('Сначала загрузите локальную модель Qwen 3 8B.');
    const progress = eventData => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:review-progress', eventData);
    };
    try {
      return await aiReviewer.review(blocks, aiModelStore.modelPath, progress);
    } catch (error) {
      if (error.code !== 'AI_MODEL_LOAD_FAILED') throw error;
      progress({ phase: 'diagnosing' });
      const engineDetails = (error.engineLogs ?? aiReviewer.getEngineLogs())
        .slice(-12).map(line => String(line).replaceAll(aiModelStore.modelPath, '[файл Qwen]').replaceAll('\\', '/'))
        .join('\n').slice(0, 4_000);
      const integrity = await aiModelStore.verifyIntegrity();
      if (!integrity.valid) {
        throw new Error(integrity.reason === 'checksum'
          ? `Файл Qwen в кэше повреждён (контрольная сумма не совпала). Закройте это окно, снова нажмите «ИИ проверка» и загрузите модель заново.${engineDetails ? `\n\nДиагностика llama.cpp:\n${engineDetails}` : ''}`
          : `Файл Qwen не прошёл проверку формата GGUF. Закройте это окно, снова нажмите «ИИ проверка» и загрузите модель заново.${engineDetails ? `\n\nДиагностика llama.cpp:\n${engineDetails}` : ''}`);
      }
      const totalGb = os.totalmem() / 1024 ** 3;
      const freeGb = os.freemem() / 1024 ** 3;
      const memoryAdvice = totalGb < 12 || freeGb < 6
        ? ` Сейчас доступно ${freeGb.toFixed(1)} ГБ из ${totalGb.toFixed(1)} ГБ ОЗУ; для Qwen 8B желательно иметь не менее 16 ГБ всего и около 6 ГБ свободной памяти.`
        : ` Доступно ${freeGb.toFixed(1)} ГБ из ${totalGb.toFixed(1)} ГБ ОЗУ.`;
      throw new Error(`Движок не открыл Qwen, хотя файл прошёл проверку SHA-256.${memoryAdvice} Закройте другие программы и повторите попытку. Если ошибка сохранится, пришлите это сообщение разработчику.${engineDetails ? `\n\nДиагностика llama.cpp:\n${engineDetails}` : ''}`);
    }
  });
});

app.on('window-all-closed', () => app.quit());
