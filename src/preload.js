const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFiles: (folderPath) => ipcRenderer.invoke('read-files', folderPath),
  getImageData: (folderPath, fileName) => ipcRenderer.invoke('get-image-data', folderPath, fileName),
  renameFile: (payload) => ipcRenderer.invoke('rename-file', payload),
  moveToSkip: (payload) => ipcRenderer.invoke('move-to-skip', payload),
  loadDefaults: () => ipcRenderer.invoke('load-defaults'),
  saveDefaults: (defaults) => ipcRenderer.invoke('save-defaults', defaults)
})
