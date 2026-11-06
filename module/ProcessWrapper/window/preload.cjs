/**
 * The bridge between the console window page and its electron host.
 * The page reports the minimized list; the host answers with restore clicks.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cpWindow', {
  minimized: (names) => ipcRenderer.send('cp:minimized', names),
  onRestore: (handler) => ipcRenderer.on('cp:restore', (_evt, name) => handler(String(name))),
});
