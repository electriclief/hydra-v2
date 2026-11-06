/**
 * Basic_App — THE ELECTRON SHELL (CJS host).
 *
 * What it stands up, in order:
 *   1) the app's own door (public/js/basicServer.js) — the instance: services · pw · rm · state
 *   2) the Event_Handler, in-process — one log for the shell's clicks AND the runs' events
 *   3) the Electron_Wrapper around the app's own address — one full-window tab named "Basic";
 *      the wrapper also PULLS this tab's visual from the State door, so while a run is live
 *      the tab itself glows (Basic_App registers 'Basic' → highlighted / solid / flashing).
 *
 * Doors are pointed at by config — the shell never starts them (each module keeps its own
 * console on the node). Run:  electron electron/main.cjs   (or npm run shell)
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain } = require('electron');
const ui = require('./ui.cjs');

// CLAIM A PROFILE OF OUR OWN — before anything else touches app state.
// Electron defaults EVERY app to %APPDATA%\Electron. Two wrappers on one box then
// share one profile and one single-instance lock, so the second app hands off to
// the first and never opens a window. Each app must name itself; the lock below is
// then scoped to THIS app, which is what "one client" is supposed to mean.
app.setName('HydraBasicApp');
app.setPath('userData', path.join(app.getPath('appData'), 'HydraBasicApp'));

const HERE = __dirname;                                    // Basic_App/electron
const MODULE_ROOT = path.join(HERE, '..');                 // Basic_App
const SHELF = path.join(MODULE_ROOT, '..');                // module/ — the shelf of six

const PORT = Number(process.env.BASIC_PORT ?? 8130);
// --headless: raise the doors and stop. No window, no console windows — the debug path.
const HEADLESS = process.argv.includes('--headless');
const DOORS = {
  servicesUrl: process.env.BASIC_SERVICES_URL ?? 'http://127.0.0.1:8128',
  pwUrl: process.env.BASIC_PW_URL ?? 'http://127.0.0.1:8125',
  rmUrl: process.env.BASIC_RM_URL ?? 'http://127.0.0.1:8129',
  stateUrl: process.env.BASIC_STATE_URL ?? 'http://127.0.0.1:8127',
  schedulerUrl: process.env.BASIC_SCHEDULER_URL ?? 'http://127.0.0.1:8132',
};

const load = (rel) => import(pathToFileURL(path.join(MODULE_ROOT, rel)).href);
const loadShelf = (rel) => import(pathToFileURL(path.join(SHELF, rel)).href);

// ── THE DOORS ARE BORN INSIDE THE SHELL ───────────────────────────────────
// Operator rule: the five doors are NEVER free console windows. The shell starts
// whatever is missing, HIDDEN, and it hands every other door's console to
// ProcessWrapper — so each one lands as a tab inside this window (the Process tab)
// instead of a loose black window on the desktop. This is not a launcher script's
// job any more: start-hydra.cmd is for headless debugging only.
const NODE = process.env.HYDRA_NODE || 'node';
const DOOR_TABLE = [
  { key: 'state',     dir: 'State',           port: 8127 },
  // Event_Handler is ALSO loaded in-process below as the shell's event adapter; the door is
  // declared so its four MCP tools exist and the operator can see the process. The two log to
  // different files — reconcile before trusting either log as the whole story.
  { key: 'events',    dir: 'Event_Handler',   port: 8126 },
  { key: 'services',  dir: 'Services',        port: 8128 },
  { key: 'rm',        dir: 'ResourceManager', port: 8129 },
  { key: 'join',      dir: 'Join',            port: 8131 },
  { key: 'scheduler', dir: 'Scheduler',       port: 8132 },
  { key: 'menu',      dir: 'Menu',            port: 8133 },
  { key: 'sessiondiary', dir: 'SessionDiary', port: 8134, args: ['--scan', '120'] },
  { key: 'thoughts', dir: 'TrainOfThought', port: 8135 },
  // the basic server and its reader: everything above says WHAT this node offers, these two say WHO it is
  { key: 'core',   dir: 'Core',   port: 8136, script: 'src/main.js' },
  { key: 'mirror', dir: 'Mirror', port: 8137, script: 'src/main.js' },
  // Echidna is the agent's FACE, not the Menu's child: it is its own door so the Menu (or any node) can display
  // it, and so the talk thread keeps existing when the Menu is closed.
  { key: 'echidna', dir: 'Echidna', port: 8138 },
];

// ── THE WATCHDOGS ARE PROCESSES TOO ────────────────────────────────────────────
// Operator rule (2026-11-05), learned the hard way: a watchdog must never be an invisible
// scheduled task or a Startup-folder script. It is declared HERE and raised through
// ProcessWrapper like any door — so it is in the Process tab, killable by id, and it dies
// with the window. Adding a daemon to this box means adding a row to this table.
const POWERSHELL = process.env.HYDRA_POWERSHELL
  || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// SHELF is <shelf>\module, so the shelf's own scripts live one level up.
const SHELF_SCRIPTS = path.resolve(SHELF, '..', 'scripts');
const WATCHDOG_TABLE = [
  {
    name: 'standby-guard',
    tag: 'watch',
    command: POWERSHELL,
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SHELF_SCRIPTS, 'standby-guard.ps1')],
    cwd: SHELF_SCRIPTS,
  },
];

/** Raise every declared watchdog through ProcessWrapper, skipping the ones already live. */
async function ensureWatchdogs() {
  let list = [];
  try {
    const r = await fetch(`${DOORS.pwUrl}/api/processes`);
    if (r.ok) list = (await r.json()).processes || [];
  } catch { /* ProcessWrapper unreachable — ensureDoors already reported that */ }
  for (const w of WATCHDOG_TABLE) {
    const live = list.find((p) => p.name === w.name && p.life !== 'exited' && p.life !== 'failed' && p.life !== 'killed');
    if (live) {
      console.log(`[watch] ${w.name} already alive (${live.id})`);
      continue;
    }
    try {
      const r = await fetch(`${DOORS.pwUrl}/api/processes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(w),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const j = await r.json();
      console.log(`[watch] ${w.name} -> ProcessWrapper (${(j && j.process && j.process.id) || 'launched'})`);
    } catch (e) {
      console.log(`[watch] ${w.name} did not start: ${e.message}`);
    }
  }
}

/** Door argv. Extra flags come from the DOOR_TABLE row, so live-scan is data, not code. */
// 0.0.0.0, not 127.0.0.1: the LAN is the point. Every node's registry must be readable from every other node,
// which is exactly how .127 has always run. Loopback-only made 123 invisible to the rest of the house.
const doorArgs = (port, extra = [], script = 'public/js/main.js') => [script, '--port', String(port), '--host', '0.0.0.0', ...extra];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is a door answering at all? 404/401 counts — a live door is a live door. */
async function doorUp(port, p = '/') {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: ctl.signal });
    clearTimeout(timer);
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitDoor(port, p = '/', ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await doorUp(port, p)) return true;
    await sleep(500);
  }
  return false;
}

/** Start a door as a hidden child of the shell — no console window, ever. */
function spawnDoorHidden(dir, port, extra = [], script = 'public/js/main.js') {
  const cwd = path.join(SHELF, dir);
  const child = spawn(NODE, doorArgs(port, extra, script), {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
    detached: false,
  });
  child.on('error', (e) => console.log(`[doors] ${dir} spawn failed: ${e.message}`));
  return child;
}

/** Ask ProcessWrapper to run the door, so its console is a tab in this window. */
async function launchDoorViaPw(dir, port, name, extra = [], script = 'public/js/main.js') {
  const body = {
    name,
    command: NODE,
    args: doorArgs(port, extra, script),
    cwd: path.join(SHELF, dir),
    tag: 'door',
  };
  const r = await fetch(`${DOORS.pwUrl}/api/processes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST /api/processes -> ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j && j.process;
}

/**
 * THE ONE ENTRY POINT FOR THE STACK: ensure ProcessWrapper is up (hidden), then let it
 * own the other doors' consoles, so nothing is ever a loose window. Idempotent — doors
 * already answering are adopted, not restarted.
 * @returns {import('node:child_process').ChildProcess|null} the PW child, if we started it
 */
async function ensureDoors() {
  let pwChild = null;
  if (await doorUp(8125, '/api/processes')) {
    console.log('[doors] ProcessWrapper already up on 8125 — adopting it');
  } else {
    console.log('[doors] ProcessWrapper down — starting it hidden (no console window)');
    pwChild = spawnDoorHidden('ProcessWrapper', 8125);
    if (!(await waitDoor(8125, '/api/processes', 25000))) {
      throw new Error('ProcessWrapper never answered on 8125');
    }
    console.log('[doors] ProcessWrapper up on 8125');
  }
  for (const d of DOOR_TABLE) {
    if (await doorUp(d.port)) {
      console.log(`[doors] ${d.key} already up on ${d.port}`);
      continue;
    }
    try {
      const rec = await launchDoorViaPw(d.dir, d.port, `${d.key}-${d.port}`, d.args || [], d.script || 'public/js/main.js');
      console.log(`[doors] ${d.key} -> ProcessWrapper tab (${(rec && rec.id) || 'launched'})`);
    } catch (e) {
      console.log(`[doors] ${d.key} via PW failed (${e.message}) — hidden fallback`);
      spawnDoorHidden(d.dir, d.port, d.args || [], d.script || 'public/js/main.js');
    }
    if (!(await waitDoor(d.port, '/', 25000))) {
      console.log(`[doors] WARNING ${d.key} is not answering on ${d.port}`);
    }
  }
  await ensureWatchdogs();
  // A watchdog that is only raised at boot is a watchdog that dies once and stays dead - which is how the guard
  // disappeared for a minute while mining went unmanaged. Re-check on a slow interval; it is one GET per tick.
  setInterval(() => {
    ensureWatchdogs().catch((e) => console.log(`[watch] re-check failed: ${e.message}`));
  }, 30000).unref?.();
  return pwChild;
}


/**
 * Extra tabs the operator declares in electron/tabs.json:
 *   { "tabs": [ { "name": "YuE studio", "path": "localhost:8090" } ] }
 * A service that owns a page gets a tab here — the page lives in THIS window,
 * never in the system browser. Missing or broken file = no extra tabs, no failure.
 */
function extraTabs() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(HERE, 'tabs.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tabs) ? raw.tabs : [];
    return list
      .filter((t) => t && typeof t.name === 'string' && typeof t.path === 'string')
      .map((t) => ({ type: 'tab', name: t.name, path: t.path.replace(/^https?:\/\//, '') }));
  } catch {
    return [];
  }
}

async function main() {
  // 0) THE DOORS — hidden, owned, and answering BEFORE any window exists.
  //    ProcessWrapper keeps the other doors' consoles; the shell keeps ProcessWrapper.
  const pwChild = await ensureDoors();

  // 1) the app's own door
  const { createBasicServer } = await load('public/js/basicServer.js');

  // 2) the Event_Handler — in-process; unknown event names register themselves on first fire
  const ehMod = await loadShelf('Event_Handler/Event_Handler_module.js');
  const eh = ehMod.createModule({ logPath: path.join(MODULE_ROOT, 'data', 'events.log') });
  const seen = new Set();
  const ensure = (name) => {
    if (seen.has(name)) return;
    try {
      eh.handler.register(name, () => ({ ok: true }));
    } catch {
      /* already registered or refused — either way it is fine to try the fire */
    }
    seen.add(name);
  };
  const ehAdapter = {
    trigger: (name, payload) => {
      ensure(name);
      try {
        return eh.handler.trigger(name, payload ?? {}, { source: 'system' });
      } catch {
        return null;
      }
    },
  };

  // 1) the app's own door — wrap it if it is already answering (its own console),
  //    stand one up only when it is not (standalone shell)
  const basicUrl = `http://127.0.0.1:${PORT}`;
  let basic = null;
  let doorRunning = false;
  try {
    const probe = await fetch(basicUrl + '/api/basic/state');
    doorRunning = probe.ok;
  } catch {
    doorRunning = false;
  }
  if (doorRunning) {
    console.log(`[basic] the door is already answering on ${basicUrl} — wrapping the running one`);
  } else {
    const { createBasicServer } = await load('public/js/basicServer.js');
    basic = await createBasicServer({ doors: DOORS, port: PORT, host: '127.0.0.1', eh: ehAdapter });
    console.log(`[basic] UI + API on ${basic.url} (started by the shell)`);
  }
  console.log(`[basic] doors: services ${DOORS.servicesUrl} · pw ${DOORS.pwUrl} · rm ${DOORS.rmUrl} · state ${DOORS.stateUrl}`);

  if (HEADLESS) {
    // Debug path: the doors are up and owned (hidden); deliberately no window.
    console.log('[basic] headless — doors up, no window. Ctrl+C / kill this process to stop.');
    return;
  }

  // 3) the shell
  //    Renderer diagnostics: a blank white wrapper window means the page threw or a
  //    sub-frame refused to load, and electron swallows both by default. Log them.
  app.on('web-contents-created', (_evt, wc) => {
    wc.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${line})`);
    });
    wc.on('did-fail-load', (_e, code, desc, url) => {
      if (code !== -3) console.log(`[renderer] failed ${code} ${desc} ${url}`);
    });
  });
  // THE FACE: what this window shows, at which user level, and the menus that reach the rest.
  const SETTINGS_FILE = path.join(HERE, 'ui.json');
  const settings = ui.readSettings(SETTINGS_FILE);
  // a known address when it is free (8199), an ephemeral one when it is not — the menu always knows the real one
  const help = await ui
    .startHelpServer(SHELF, { port: Number(process.env.BASIC_HELP_PORT ?? 8199) })
    .catch(() => ui.startHelpServer(SHELF));
  console.log(`[ui] level=${settings.mode} tabs=${ui.visibleTabs(settings).map((t) => t.name).join(',')} help=${help.url}`);

  const ewMod = await loadShelf('Electron_Wrapper/Electron_Wrapper_module.js');
  const trayIcon = path.join(SHELF, 'Electron_Wrapper', 'assets', 'tray.png');
  const windowIcon = path.join(SHELF, 'Electron_Wrapper', 'assets', 'icon.png');
  const wrapper = await ewMod.createModule({
    electron: { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain },
    // The window is the face of the app: give it the Hydra mark and its own name, instead of Electron's
    // default diamond and the string "Electron_Wrapper" in the taskbar.
    window: fs.existsSync(windowIcon) ? { title: 'Hydra V2', icon: windowIcon } : { title: 'Hydra V2' },
    template: { spots: [{ id: 'main', title: 'Basic' }], arrangement: 'row' },
    entries: [
      // The catalog decides. Basic mode = the Menu and nothing else; the other levels add
      // Memory, Echidna and the plumbing, and View can tick any single tab on or off.
      ...ui.visibleTabs(settings).map(ui.tabEntry),
      // Anything still declared in tabs.json that the catalog does not know about.
      ...extraTabs().filter((t) => !ui.CATALOG.some((c) => c.name === t.name)),
      // The Process tab used to be listed here by hand; it is catalogue row 'Process' now.
    ],
    tray: fs.existsSync(trayIcon) ? { icon: trayIcon, tooltip: 'Basic — service shelf' } : { enabled: false },
    eventHandler: ehAdapter,
    state: { endpoint: DOORS.stateUrl },
    // The footer: one line, straight from the Scheduler's own book plus the standby guard's report. Nothing is
    // computed here - the shell asks the node what its card is doing and prints the answer verbatim.
    status: { url: `${DOORS.schedulerUrl}/api/statusline`, intervalMs: 2000, label: 'Process' },
  });
  await wrapper.whenBooted;

  // ── the hands behind the menu bar ──────────────────────────────────────────
  const reloadTabs = () => {
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      w.webContents
        .executeJavaScript("Array.from(document.querySelectorAll('iframe')).forEach(function (f) { f.src = f.src; });", true)
        .catch(() => { /* a window mid-teardown has nothing to reload */ });
    }
  };

  /** Best effort: bring the window forward and click that tab in the strip, if it is there yet. */
  const focusTab = (name) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    w.webContents
      .executeJavaScript(
        `(() => { const tabs = Array.from(document.querySelectorAll('.lm_tab, [role="tab"], .tab'));` +
          ` const hit = tabs.find((t) => (t.textContent || '').trim().startsWith(${JSON.stringify(name)}));` +
          ` if (hit) { hit.click(); return true; } return false; })()`,
        true,
      )
      .catch(() => { /* the strip may not be up yet */ });
  };

  const actions = {
    openTab(name) {
      const tab = ui.tabFor(name);
      if (!tab) return;
      wrapper.register(ui.tabEntry(tab));
      wrapper.show();
      focusTab(tab.name);
    },
    openHelp(moduleName) {
      wrapper.register({ type: 'tab', name: 'Help', path: `${help.url}${moduleName ? '/' + moduleName : '/'}` });
      wrapper.show();
      focusTab('Help');
    },
    setMode(mode) {
      settings.mode = mode;
      settings.showAll = false; // changing level means "use that level's defaults"
      ui.writeSettings(SETTINGS_FILE, settings);
      scheduleRefresh();
    },
    setShowAll(value) {
      settings.showAll = value === true;
      ui.writeSettings(SETTINGS_FILE, settings);
      scheduleRefresh();
    },
    resetTabs() {
      settings.tabs = {};
      ui.writeSettings(SETTINGS_FILE, settings);
      scheduleRefresh();
    },
    toggleTab(name) {
      const shown = ui.visibleTabs(settings).some((t) => t.name === name);
      settings.tabs[name] = !shown;
      ui.writeSettings(SETTINGS_FILE, settings);
      scheduleRefresh();
    },
    reload: reloadTabs,
    restart() {
      app.relaunch();
      app.exit(0);
    },
    quit() {
      app.quit();
    },
  };

  /**
   * Rebuilding the menu bar from inside a menu item's own click is how Electron dies on Windows: the menu being
   * handled is destroyed while it is still executing. Every settings change therefore lands on a timer, once the
   * click has returned, and only one rebuild is ever queued.
   */
  let refreshQueued = null;
  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = setTimeout(() => {
      refreshQueued = null;
      try {
        refresh();
      } catch (err) {
        console.error('[ui] refresh failed (window kept):', err);
      }
    }, 60);
  }

  /** Reconcile the window with the settings: tabs on/off, menu bar rebuilt. */
  function refresh() {
    const keep = new Set(ui.visibleTabs(settings).map((t) => t.name));
    for (const tab of ui.CATALOG) {
      if (keep.has(tab.name)) {
        try {
          wrapper.register(ui.tabEntry(tab));
        } catch (err) {
          console.error(`[ui] could not register tab ${tab.name}:`, err);
        }
      } else {
        try {
          wrapper.unregister('tab', tab.name);
        } catch {
          /* never registered */
        }
      }
    }
    try {
      ui.applyMenus(wrapper, settings, actions);
    } catch (err) {
      console.error('[ui] could not rebuild the menu bar:', err);
    }
    console.log(`[ui] level=${settings.mode} showAll=${settings.showAll} tabs=${[...keep].join(',')}`);
  }
  refresh();

  console.log('[basic] shell up — the Menu is the face; View sets the level');

  // THE CLOSE LAW: closing this window pops EVERYTHING — services, providers, every
  // thread and the master tic. Closing is a plain app-quit, so without this the window
  // died and the whole shelf kept running (proven: doors 8125-8131 all survived).
  // The window asks the root to stand down, and the root takes its children with it —
  // including this shell. Nothing is left behind, which is the point of a stop-all.
  let stopFired = false;
  const popEverything = () => {
    if (stopFired) return;
    stopFired = true;
    const url = `${DOORS.pwUrl}/api/stop`;
    console.log('[basic] the window closed — asking the root to pop everything');
    try {
      // fire and do not wait on the reply: we are asking the thing that is about to kill us
      void fetch(url, { method: 'POST' }).catch(() => { /* the root died mid-answer, as designed */ });
    } catch { /* nothing left to say */ }
  };

  app.on('window-all-closed', popEverything);
  app.on('before-quit', popEverything);

  // Ctrl+R / F5 reloads every tab's page IN PLACE. The tabs are cross-origin iframes, so a
  // src reassignment is the only reload that works from the shell — and it means a door's
  // page can be edited and picked up without restarting this window.
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toLowerCase();
      const reload = (input.control && key === 'r') || key === 'f5';
      if (!reload) return;
      event.preventDefault();
      win.webContents
        .executeJavaScript(
          "Array.from(document.querySelectorAll('iframe')).forEach(function (f) { f.src = f.src; });",
          true,
        )
        .catch(() => { /* a window mid-teardown has nothing to reload */ });
    });
  });

  app.on('will-quit', () => {
    if (basic) void basic.stop();
    // If the shell started ProcessWrapper, it does not outlive the window either.
    if (pwChild) {
      try {
        pwChild.kill();
      } catch {
        /* already gone */
      }
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    console.log('[basic] another instance was refused — one shelf per node');
  });
  app.whenReady().then(() => {
    main().catch((e) => {
      console.error('[basic] boot failed:', e);
      app.quit();
    });
  });
}
