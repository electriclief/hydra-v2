/**
 * ProcessWrapper — the console window host (electron).
 *
 * One window. The strip and the console pane live in the page served by the door
 * (http://127.0.0.1:8125/window.html); this host owns the native pieces:
 *   - the menu bar: File · View · Window · Help
 *   - the Window menu: the minimized consoles wait here (the page reports the list
 *     over IPC; clicking an item sends it back to be shown again)
 * Nothing here launches or kills anything — the page fires the events; the door acts.
 *
 * Run:  electron.exe window/main.cjs        (port override: PW_WINDOW_PORT=8125)
 */
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const http = require('node:http');
const path = require('node:path');

// CLAIM A PROFILE OF OUR OWN — before anything else touches app state.
// Electron defaults EVERY app to %APPDATA%\Electron, so two wrappers on one box
// share one profile: the single-instance lock belongs to whichever started first
// and the other silently hands off instead of opening a window. That is exactly
// how this window failed to appear. Each app must name itself.
app.setName('HydraProcessWrapper');
app.setPath('userData', path.join(app.getPath('appData'), 'HydraProcessWrapper'));

const PORT = Number(process.env.PW_WINDOW_PORT || 8125);
const PAGE = `http://127.0.0.1:${PORT}/window.html`;

let win = null;
let minimized = [];

function probeDoor() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1200 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForDoor(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await probeDoor()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function buildMenu() {
  const windowItems = minimized.length
    ? minimized.map((name) => ({
        label: name,
        click: () => win && win.webContents.send('cp:restore', name),
      }))
    : [{ label: '(nothing minimized)', enabled: false }];
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Reload page', role: 'reload' }, { type: 'separator' }, { label: 'Quit', role: 'quit' }] },
    { label: 'View', submenu: [{ label: 'Reload', role: 'reload' }, { label: 'Toggle DevTools', role: 'toggleDevTools' }, { type: 'separator' }, { label: 'Actual size', role: 'resetZoom' }, { label: 'Zoom in', role: 'zoomIn' }, { label: 'Zoom out', role: 'zoomOut' }] },
    { label: 'Window', submenu: [...windowItems, { type: 'separator' }, { label: 'Show all minimized', click: () => win && win.webContents.send('cp:restore', '*') }] },
    { label: 'Help', submenu: [{ label: 'About the console window', click: () => dialog.showMessageBox({ title: 'ProcessWrapper', message: 'ProcessWrapper - the console window', detail: `The door: ${PAGE}\nOne launch; consoles arrive as events ("add Process Console Display").\nMinimized displays wait in the Window menu.` }) }] },
  ]);
  Menu.setApplicationMenu(menu);
}

ipcMain.on('cp:minimized', (_evt, names) => {
  minimized = Array.isArray(names) ? names.map(String) : [];
  buildMenu();
});

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1150,
    height: 740,
    title: 'ProcessWrapper',
    backgroundColor: '#101214',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const up = await waitForDoor(15000);
  if (up) {
    await win.loadURL(PAGE);
  } else {
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="background:#101214;color:#d6d8da;font:14px Segoe UI">' +
            '<h2>ProcessWrapper</h2>' +
            `<p>The door is not answering on port ${PORT}.</p>` +
            '<p>Start it: <code>node public/js/main.js</code> in the ProcessWrapper folder, then File &gt; Reload page.</p>' +
            '</body>',
        ),
    );
  }
  buildMenu();
});

app.on('window-all-closed', () => app.quit());
