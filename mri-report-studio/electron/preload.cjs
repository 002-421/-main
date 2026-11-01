const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  exportPDF: filename => ipcRenderer.invoke('report:export-pdf', filename),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
  aiModelStatus: () => ipcRenderer.invoke('ai:model-status'),
  downloadAIModel: () => ipcRenderer.invoke('ai:model-download'),
  onAIModelProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('ai:model-progress', listener);
    return () => ipcRenderer.removeListener('ai:model-progress', listener);
  },
});
