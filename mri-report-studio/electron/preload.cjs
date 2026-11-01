const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  exportPDF: filename => ipcRenderer.invoke('report:export-pdf', filename),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
});
