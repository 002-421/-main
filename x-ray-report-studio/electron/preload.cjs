const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  exportPDF: filename => ipcRenderer.invoke('report:export-pdf', filename),
  previewPDF: () => ipcRenderer.invoke('report:preview-pdf'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: force => ipcRenderer.invoke('updates:install', force === true),
  openUpdateLog: () => ipcRenderer.invoke('updates:open-log'),
  onUpdateProgress: callback => {
    ipcRenderer.removeAllListeners('updates:progress');
    ipcRenderer.on('updates:progress', (_event, progress) => callback(progress));
  },
  clearUpdateProgress: () => ipcRenderer.removeAllListeners('updates:progress'),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
});
