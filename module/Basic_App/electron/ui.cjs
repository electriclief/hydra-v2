'use strict';
/**
 * The face of the shell: which tabs exist, which user level sees them, and the menus that open the rest.
 *
 * Operator ruling (2026-11-04):
 *   - Basic tab is gone; the Menu replaced it.
 *   - Diaries and Thoughts are the Memory module's sub-modules — not on a basic screen.
 *   - LLM chat belongs to Echidna/Phoenix — not on a basic screen.
 *   - Join, Scheduler and Process are plumbing: present, but launched from the menus, not shown by default.
 *   - Three user levels, because "tabs confuse me" is a real setting:
 *       basic        the Menu and nothing else
 *       advanced     Menu + Memory (Diaries, Thoughts), everything else a tick away in View
 *       development  every tab, including the doors themselves
 *
 * Nothing here starts a door. A tab is only an address; if the door is down the wrapper shows an empty frame.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MODES = ['basic', 'advanced', 'development'];

/** The catalog. `help` names the module folder whose help.html documents the thing behind the tab. */
const CATALOG = [
  { name: 'Menu', path: 'localhost:8133', group: 'the way in', help: 'Menu' },
  { name: 'Diaries', path: 'localhost:8134', group: 'memory', help: 'SessionDiary' },
  { name: 'Thoughts', path: 'localhost:8135', group: 'memory', help: 'TrainOfThought' },
  { name: 'LLM chat', path: 'localhost:8080', group: 'echidna', help: null },
  { name: 'Join', path: 'localhost:8131', group: 'plumbing', help: 'Join' },
  { name: 'Scheduler', path: 'localhost:8132', group: 'plumbing', help: 'Scheduler' },
  { name: 'Process', path: 'localhost:8125/window.html', group: 'plumbing', help: 'ProcessWrapper' },
  { name: 'State', path: 'localhost:8127', group: 'development', help: 'State' },
  { name: 'Services', path: 'localhost:8128', group: 'development', help: 'Services' },
  { name: 'Resources', path: 'localhost:8129', group: 'development', help: 'ResourceManager' },
  { name: 'Core', path: 'localhost:8136', group: 'development', help: 'Core' },
  { name: 'Mirror', path: 'localhost:8137', group: 'development', help: 'Mirror' },
];

/** Modules with a page but no tab: the shell itself. They belong in Help even though nothing opens them. */
const EXTRA_DOCS = [
  { name: 'Basic_App', folder: 'Basic_App' },
  { name: 'Electron_Wrapper', folder: 'Electron_Wrapper' },
  { name: 'Event_Handler', folder: 'Event_Handler' },
];

const DEFAULTS = {
  basic: ['Menu'],
  advanced: ['Menu', 'Diaries', 'Thoughts'],
  development: CATALOG.map((t) => t.name),
};

const EMPTY = { mode: 'advanced', showAll: false, tabs: {} };

function readSettings(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mode = MODES.includes(raw.mode) ? raw.mode : EMPTY.mode;
    return {
      mode,
      showAll: raw.showAll === true,
      tabs: raw.tabs && typeof raw.tabs === 'object' ? raw.tabs : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeSettings(file, settings) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.warn('[ui] could not save settings:', err.message);
    return false;
  }
}

/** Which tabs this level shows. An explicit per-tab override beats the level's default, both ways. */
function visibleTabs(settings) {
  const showAll = settings.showAll === true || settings.mode === 'development';
  return CATALOG.filter((tab) => {
    const override = settings.tabs[tab.name];
    // an explicit tick always wins, either way: unticking in Development hides it, ticking in Basic shows it
    if (typeof override === 'boolean') return override;
    return showAll || DEFAULTS[settings.mode].includes(tab.name);
  });
}

const tabFor = (name) => CATALOG.find((t) => t.name === name) || null;
const tabEntry = (tab) => ({ type: 'tab', name: tab.name, path: tab.path });

/** The menu bar, as data. `actions` are the hands: openTab, setMode, toggleTab, openHelp, reload, restart. */
function menuSpec(settings, actions) {
  const tabs = visibleTabs(settings);
  const shown = new Set(tabs.map((t) => t.name));

  const tabItem = (tab) => ({
    id: `view-${tab.name}`,
    label: `${tab.name}${tab.group === 'plumbing' ? '' : ''}`,
    type: 'checkbox',
    checked: shown.has(tab.name),
    onClick: () => actions.toggleTab(tab.name),
  });

  return [
    {
      id: 'file',
      label: 'Hydra',
      items: [
        { id: 'reload', label: 'Reload every tab', onClick: () => actions.reload() },
        { type: 'separator' },
        { id: 'restart', label: 'Restart the window', onClick: () => actions.restart() },
        { id: 'quit', label: 'Quit Hydra', onClick: () => actions.quit() },
      ],
    },
    {
      id: 'modules',
      label: 'Modules',
      items: [
        ...CATALOG.filter((t) => t.group !== 'the way in').map((tab) => ({
          id: `open-${tab.name}`,
          label: `${tab.name}  —  ${tab.group}`,
          onClick: () => actions.openTab(tab.name),
        })),
        { type: 'separator' },
        { id: 'help-all', label: 'Module help…', onClick: () => actions.openHelp(null) },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          id: 'mode',
          label: 'User level',
          submenu: MODES.map((mode) => ({
            id: `mode-${mode}`,
            label: mode === 'basic' ? 'Basic — just the menu' : mode === 'advanced' ? 'Advanced — the usual tabs' : 'Development — everything',
            type: 'checkbox',
            checked: settings.mode === mode,
            onClick: () => actions.setMode(mode),
          })),
        },
        {
          id: 'show-all',
          label: 'Show every tab',
          type: 'checkbox',
          checked: settings.showAll === true,
          onClick: () => actions.setShowAll(settings.showAll !== true),
        },
        { type: 'separator' },
        ...CATALOG.map(tabItem),
        { type: 'separator' },
        { id: 'reset-tabs', label: 'Reset to this level’s defaults', onClick: () => actions.resetTabs() },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'help-index', label: 'All module help', onClick: () => actions.openHelp(null) },
        { type: 'separator' },
        ...CATALOG.filter((t) => t.help).map((tab) => ({
          id: `help-${tab.name}`,
          label: tab.help,
          onClick: () => actions.openHelp(tab.help),
        })),
        { type: 'separator' },
        ...EXTRA_DOCS.map((doc) => ({
          id: `help-${doc.folder}`,
          label: `${doc.name}  (shell)`,
          onClick: () => actions.openHelp(doc.folder),
        })),
      ],
    },
  ];
}

/**
 * The help server: a plain static server for module help pages, on an ephemeral port.
 * The Help menu opens a tab at it, so documentation is a tab like everything else — no browser, no file://.
 */
function startHelpServer(shelfDir, options = {}) {
  const port = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const bare = decodeURIComponent(url.pathname.replace(/^\/+/, '')).replace(/\/+$/, '');
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };

    if (!bare) {
      const extraRows = EXTRA_DOCS.map((doc) => {
        const file = path.join(shelfDir, doc.folder, 'help.html');
        const state = fs.existsSync(file) ? `<a href="/${doc.folder}">${doc.name}</a>` : `<span class="muted">${doc.name} - no help.html yet</span>`;
        return `<tr><td>${doc.folder} <span class="muted">(shell)</span></td><td>${state}</td></tr>`;
      }).join('');
      const rows = CATALOG.map((tab) => {
        if (!tab.help) return `<tr><td>${tab.name}</td><td class="muted">no page yet</td></tr>`;
        const file = path.join(shelfDir, tab.help, 'help.html');
        const state = fs.existsSync(file) ? `<a href="/${tab.help}">${tab.help}</a>` : `<span class="muted">${tab.help} — no help.html yet</span>`;
        return `<tr><td>${tab.name}</td><td>${state}</td></tr>`;
      }).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Hydra module help</title>
<style>body{margin:32px auto;max-width:70ch;background:#111318;color:#e5e7eb;font:15px/1.6 system-ui,Segoe UI,sans-serif}
h1{font-size:20px;font-weight:600;margin:0 0 4px}p.k{color:#a1a8b7;font-size:13px;margin:0 0 24px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 10px;border-bottom:1px solid #303541}
th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#a1a8b7}a{color:#8ab4f8;text-decoration:none}
.muted{color:#6b7280}</style></head><body><h1>Hydra module help</h1>
<p class="k">Every module's own page: what it is for, how it holds together, and what it needs from you.</p>
<table><tr><th>tab</th><th>documentation</th></tr>${rows}${extraRows}</table></body></html>`;
      return send(200, 'text/html; charset=utf-8', html);
    }

    const doc = CATALOG.find((t) => t.help && t.help.toLowerCase() === bare.toLowerCase());
    const shell = EXTRA_DOCS.find((d) => d.folder.toLowerCase() === bare.toLowerCase());
    const folder = doc ? doc.help : shell ? shell.folder : null;
    const file = folder ? path.join(shelfDir, folder, 'help.html') : null;
    if (!file || !fs.existsSync(file)) return send(404, 'text/plain; charset=utf-8', `no help page for "${bare}"`);
    return send(200, 'text/html; charset=utf-8', fs.readFileSync(file));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `localhost:${actual}`, close: () => server.close() });
    });
  });
}

/** Register the whole menu bar, replacing any previous one. */
function applyMenus(wrapper, settings, actions) {
  for (const id of ['file', 'modules', 'view', 'help']) {
    try {
      wrapper.unregister('menu', id);
    } catch {
      /* not there yet */
    }
  }
  for (const menu of menuSpec(settings, actions)) wrapper.register({ type: 'menu', ...menu });
}

module.exports = {
  MODES,
  CATALOG,
  EXTRA_DOCS,
  DEFAULTS,
  readSettings,
  writeSettings,
  visibleTabs,
  tabFor,
  tabEntry,
  menuSpec,
  applyMenus,
  startHelpServer,
};
