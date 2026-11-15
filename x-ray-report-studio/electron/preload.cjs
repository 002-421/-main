const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  reportDiagnostic: value => ipcRenderer.send('diagnostics:event', value),
  openDiagnostics: () => ipcRenderer.invoke('diagnostics:open'),
  dictionaryLoad: () => ipcRenderer.invoke('dictionary:load'),
  dictionaryMergeSave: words => ipcRenderer.invoke('dictionary:merge-save', words),
  reportReady: details => ipcRenderer.send('app:ready', details),
  getApplicationVersion: () => ipcRenderer.invoke('app:version'),
  onWordSaved: callback => ipcRenderer.on('report:word-saved', (_event, url) => callback(url)),
  exportPDF: filename => ipcRenderer.invoke('report:export-pdf', filename),
  previewPDF: () => ipcRenderer.invoke('report:preview-pdf'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: callback => {
    ipcRenderer.removeAllListeners('updates:progress');
    ipcRenderer.on('updates:progress', (_event, progress) => callback(progress));
  },
  clearUpdateProgress: () => ipcRenderer.removeAllListeners('updates:progress'),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
});
