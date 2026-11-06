/**
 * preload.cjs - the thin bridge between the wrapper page and the main process.
 * contextIsolation stays on; the page only sees these five hands.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ElectronWrapperBridge', {
  /** Tell main we are up and ready for the bootstrap (template + panes). */
  ready: () => ipcRenderer.send('ew:ready'),
  /** The one-shot bootstrap: {template, panes, layout, window}. */
  onBootstrap: (cb) => ipcRenderer.on('ew:bootstrap', (_e, data) => cb(data)),
  /** Live pane updates: {panes} — add/pop/visuals. */
  onPanes: (cb) => ipcRenderer.on('ew:panes', (_e, data) => cb(data)),
  /** Auto-select: {name} — focus that tab. */
  onSelect: (cb) => ipcRenderer.on('ew:select', (_e, data) => cb(data)),
  /** Events out: {kind, name?, ...} — tabs, menus' trail is main-side. */
  sendEvent: (evt) => ipcRenderer.send('ew:event', evt),
});
