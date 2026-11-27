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
  templateAdmin: {githubStatus:()=>ipcRenderer.invoke('templates:admin-github-status'),githubConnect:()=>ipcRenderer.invoke('templates:admin-github-connect'),githubComplete:id=>ipcRenderer.invoke('templates:admin-github-complete',id),githubCancel:()=>ipcRenderer.invoke('templates:admin-github-cancel'),pinStatus:()=>ipcRenderer.invoke('templates:admin-pin-status'),status:()=>ipcRenderer.invoke('templates:admin-status'),setup:(pin,confirm)=>ipcRenderer.invoke('templates:admin-setup',pin,confirm),unlock:pin=>ipcRenderer.invoke('templates:admin-unlock',pin),lock:token=>ipcRenderer.invoke('templates:admin-lock',token),draft:(token,proposal)=>ipcRenderer.invoke('templates:admin-draft',token,proposal),drafts:token=>ipcRenderer.invoke('templates:admin-drafts',token),export:(token,id)=>ipcRenderer.invoke('templates:admin-export',token,id),source:(token,channel,id,version)=>ipcRenderer.invoke('templates:admin-publication-source',token,channel,id,version),approve:(token,id)=>ipcRenderer.invoke('templates:admin-approve',token,id),changePin:(token,pin,confirm)=>ipcRenderer.invoke('templates:admin-change-pin',token,pin,confirm),publish:pin=>ipcRenderer.invoke('templates:admin-publish',pin),publications:token=>ipcRenderer.invoke('templates:admin-publication-history',token)},
  templateRevision: (id, version) => ipcRenderer.invoke('templates:revision', id, version),
  templateCatalogState: () => ipcRenderer.invoke('templates:state'),
  checkTemplateUpdates: () => ipcRenderer.invoke('templates:check'),
  installTemplateUpdates: (planId, confirmed) => ipcRenderer.invoke('templates:install', planId, confirmed),
  rollbackTemplateUpdates: confirmed => ipcRenderer.invoke('templates:rollback', confirmed),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateProgress: callback => {
    ipcRenderer.removeAllListeners('updates:progress');
    ipcRenderer.on('updates:progress', (_event, progress) => callback(progress));
  },
  clearUpdateProgress: () => ipcRenderer.removeAllListeners('updates:progress'),
  copyReport: (html, text) => ipcRenderer.invoke('report:copy', html, text),
  copyPlainText: text => ipcRenderer.invoke('report:copy-plain', text),
});
