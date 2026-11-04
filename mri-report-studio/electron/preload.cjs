const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  exportPDF: filename => ipcRenderer.invoke('report:export-pdf', filename),
  previewPDF: () => ipcRenderer.invoke('report:preview-pdf'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
});
