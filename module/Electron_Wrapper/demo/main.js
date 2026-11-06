/**
 * The demo app — the wrapper as a dumb terminal. Edit demo/template.json (addresses +
 * spots), run `npm run demo`, and an app with those tabs exists. (Electron main; ESM.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } from 'electron';

import { createModule } from '../Electron_Wrapper_module.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(here, '..');
const moduleDir = moduleRoot.replace(/\\/g, '/');

// The event sink: every event lands on stdout AND in demo/events.log — proof the
// event path is real (the smoke reads that file).
const logFile = path.join(here, 'events.log');
const sink = (name, payload) => {
  const line = `${new Date().toISOString()} ${name} ${JSON.stringify(payload)}`;
  console.log('[event]', line);
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* the log is best-effort */
  }
};

const cfg = JSON.parse(
  fs.readFileSync(path.join(here, 'template.json'), 'utf8').replaceAll('{MODULE_DIR}', moduleDir),
);

let wrapper = null;

const menus = [
  {
    type: 'menu',
    id: 'file',
    label: 'File',
    items: [
      { label: 'Report a click', onClick: () => console.log('[demo] a menu hand ran') },
      { type: 'separator' },
      { label: 'Quit', onClick: () => wrapper?.quit() }, // the real close → "app-closed" goes out
    ],
  },
];

// ESM MAIN-PROCESS TRAP (why this is a .then and not a top-level await): with an ESM
// entry, Electron fires 'ready' only after the entry module finishes evaluating.
// A top-level `await createModule(...)` would await app.whenReady() inside a module
// whose own evaluation is what ready waits for — a silent deadlock. Schedule instead.
app
  .whenReady()
  .then(async () => {
    wrapper = await createModule({
      electron: { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain },
      template: cfg.template,
      entries: [...cfg.tabs.map((t) => ({ type: 'tab', ...t })), ...menus],
      tray: cfg.tray,
      window: { ...cfg.window, icon: path.join(moduleRoot, 'assets', 'icon.png') },
      eventHandler: sink,
      // state: { endpoint: 'http://127.0.0.1:8127' },   // point at a State door for flashing tabs
    });
    await wrapper.whenBooted;
    console.log(
      `[demo] up — ${wrapper.list().tabs.length} tabs, ${wrapper.list().menus.length} menus, tray ${cfg.tray?.enabled !== false ? 'on' : 'off'}`,
    );
  })
  .catch((err) => {
    console.error('[demo] boot failed:', err);
    app.quit();
  });
