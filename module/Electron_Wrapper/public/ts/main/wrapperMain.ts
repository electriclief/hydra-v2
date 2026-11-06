/**
 * @module wrapperMain
 * @description The wrapper's main-process machine. Given an injected electron surface
 *              (or lazily importing electron inside a real app), `createWrapperModule`
 *              stands the whole thing up: the window with the wrapper page, the template
 *              + registered tabs (name + path → a div/iframe), the application menu
 *              bar built from registered menus, the app tray (default ON; icon as input),
 *              the event path OUT through the event-handler instance ("app closed"
 *              included), and the optional per-tab state pull (solid · highlighted ·
 *              flashing; a lone flashing tab auto-selects). Boots blank; decides nothing.
 * @intent The dumb terminal: throw 4 addresses + a template together and have an app
 *         with 4 tabs. The compiled binary never learns what a tab renders.
 *
 * NOTE (Electron ESM entries): with an ESM main-process entry file, Electron fires
 * 'ready' only after the entry module finishes evaluating. Never top-level-await
 * createModule(...) inside such an entry — a TLA that reaches app.whenReady()
 * deadlocks silently. Schedule with app.whenReady().then(...) instead.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWrapperRegistry, type EntryKind, type TabEntry, type WrapperEntry, type WrapperRegistry } from '../core/registry.js';
import { buildLayout, normalizeTemplate, spotFor, type LayoutDef, type PaneView, type TemplateDef } from '../core/template.js';
import { toPageUrl } from '../core/windowMap.js';
import { toBarTemplate, toTreeTemplate, type MenuDispatcher } from '../core/menuTree.js';
import { resolveTraySpec, type TrayOptions } from '../core/trayModel.js';
import { dispatch, normalizeSink, type EventSink, type WrapperEvent } from '../core/events.js';
import { autoSelect, type TabVisual } from '../core/visuals.js';
import { createStatePuller, type StatePuller } from '../core/statePull.js';

// --- Interface Definitions ---

/** The little piece of electron the wrapper actually touches — structural, injectable. */
export interface ElectronSurface {
  app: {
    whenReady(): Promise<void>;
    on(event: string, cb: (...args: unknown[]) => void): void;
    quit(): void;
  };
  BrowserWindow: new (opts: Record<string, unknown>) => EwBrowserWindow;
  Menu: { setApplicationMenu(menu: unknown): void; buildFromTemplate(template: unknown[]): unknown };
  Tray: new (image: unknown) => EwTray;
  nativeImage: {
    createFromPath(p: string): unknown;
    createFromDataURL(d: string): unknown;
  };
  ipcMain: {
    on(channel: string, cb: (...args: unknown[]) => void): void;
    removeListener(channel: string, cb: (...args: unknown[]) => void): void;
  };
}

export interface EwBrowserWindow {
  loadFile(file: string): Promise<void>;
  webContents: { send(channel: string, ...args: unknown[]): void };
  on(event: string, cb: (...args: unknown[]) => void): void;
  show(): void;
  hide(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  focus(): void;
}

export interface EwTray {
  setToolTip(tooltip: string): void;
  setContextMenu(menu: unknown): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  destroy(): void;
}

export interface WrapperWindowOptions {
  title?: string;
  width?: number;
  height?: number;
  /** Path to a window/taskbar icon. */
  icon?: string;
  /** Start visible; default true. */
  show?: boolean;
  /** true → closing the window really closes the app (default: hide-to-tray when the tray is on). */
  quitOnClose?: boolean;
}

export interface WrapperStateOptions {
  /** The state door, e.g. "http://127.0.0.1:8127". */
  endpoint: string;
  intervalMs?: number;
}

/**
 * The footer's source. The wrapper does not know what the line means - it polls a URL that answers
 * `{ line: "..." }` and prints it. The host decides whose words those are (the Scheduler's, on this node).
 */
export interface WrapperStatusOptions {
  url: string;
  intervalMs?: number;
  label?: string;
}

export interface CreateWrapperOptions {
  /** Injected electron surface; when absent, the module imports electron itself (running inside an app). */
  electron?: ElectronSurface;
  /** The template (spots for tab insertions); absent → the default single spot. */
  template?: unknown;
  /** Initial registrations — tabs ({type:'tab', name, path, spot?}) and menus; live register() is the normal life. */
  entries?: unknown[];
  /** The app tray: default ON; icon as input; a menu tree with matching onclick. */
  tray?: TrayOptions;
  window?: WrapperWindowOptions;
  /** The event-handler instance (anything with .trigger(name, payload), or a plain function). */
  eventHandler?: unknown;
  /** Optional: pull each tab's state from a State door. */
  state?: WrapperStateOptions;
  /** Optional: a one-line footer, polled from a URL that answers { line }. */
  status?: WrapperStatusOptions;
}

export interface WrapperModule {
  registry: WrapperRegistry;
  template: TemplateDef;
  whenBooted: Promise<void>;
  register(entry: unknown): WrapperEntry;
  unregister(kind: EntryKind, key: string): boolean;
  list(): { tabs: TabEntry[]; menus: WrapperEntry[] };
  panes(): PaneView[];
  show(): void;
  hide(): void;
  sendEvent(kind: string, detail?: Record<string, unknown>): boolean;
  quit(): void;
  stop(): Promise<void>;
}

// --- Function Definitions ---

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_ICON = path.join(MODULE_ROOT, 'assets', 'tray.png');
const PAGE_FILE = path.join(MODULE_ROOT, 'public', 'index.html');
const PRELOAD_FILE = path.join(MODULE_ROOT, 'public', 'preload.cjs');

async function resolveElectron(options: CreateWrapperOptions): Promise<ElectronSurface> {
  if (options.electron) return options.electron;
  const mod = (await import('electron')) as { default?: ElectronSurface } & ElectronSurface;
  const electron = mod.default ?? mod;
  if (!electron || typeof electron.BrowserWindow !== 'function') {
    throw new Error('[Electron_Wrapper] could not reach electron — pass {electron} when running outside a real app');
  }
  return electron;
}

export async function createWrapperModule(options: CreateWrapperOptions = {}): Promise<WrapperModule> {
  const electron = await resolveElectron(options);

  const registry = createWrapperRegistry();
  const template = normalizeTemplate(options.template);
  const sink: EventSink | null = normalizeSink(options.eventHandler);

  for (const entry of options.entries ?? []) registry.register(entry);

  const visualsByName = new Map<string, TabVisual>();
  let win: EwBrowserWindow | null = null;
  let tray: EwTray | null = null;
  let trayEnabled = false;
  let quitting = false;
  let closedSent = false;
  let lastAuto: string | null = null;
  let puller: StatePuller | null = null;
  let removeIpc: (() => void) | null = null;

  const sendEvent = (kind: string, detail: Record<string, unknown> = {}): boolean =>
    dispatch(sink, { kind, ...detail });

  const paneViews = (): PaneView[] =>
    registry.tabs().map((t) => ({
      name: t.name,
      title: t.name,
      url: toPageUrl(t.path),
      visual: visualsByName.get(t.name) ?? 'solid',
      closable: t.closable !== false,
      spot: spotFor(template, t),
    }));

  const pushPanes = (): void => {
    if (win && !win.isDestroyed()) win.webContents.send('ew:panes', { panes: paneViews() });
  };

  const menuDispatch: MenuDispatcher = (event) => {
    dispatch(sink, { ...event });
  };

  const buildBar = (): void => {
    const menus = registry.menus();
    electron.Menu.setApplicationMenu(
      menus.length > 0 ? electron.Menu.buildFromTemplate(toBarTemplate(menus, menuDispatch)) : null,
    );
  };

  const show = (): void => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  const hide = (): void => {
    if (win && !win.isDestroyed()) win.hide();
  };

  const quit = (): void => {
    quitting = true;
    if (!closedSent) {
      closedSent = true;
      sendEvent('app-closed');
    }
    electron.app.quit();
  };

  // Registry changes: keep the renderer's panes and the menu bar current.
  const unsubscribe = registry.subscribe(() => {
    pushPanes();
    buildBar();
  });

  const whenBooted = (async () => {
    await electron.app.whenReady();

    const winOpts: WrapperWindowOptions = options.window ?? {};
    win = new electron.BrowserWindow({
      width: winOpts.width ?? 1200,
      height: winOpts.height ?? 800,
      title: winOpts.title ?? 'Electron_Wrapper',
      show: winOpts.show !== false,
      ...(winOpts.icon !== undefined ? { icon: winOpts.icon } : {}),
      webPreferences: {
        preload: PRELOAD_FILE,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const readyHandler = (): void => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ew:bootstrap', {
          template,
          panes: paneViews(),
          layout: buildLayout(template, paneViews()) as LayoutDef,
          window: { title: winOpts.title ?? 'Electron_Wrapper' },
          // absent unless the host asked for a footer - the wrapper never invents one
          status: options.status ?? null,
        });
      }
    };
    const eventHandler = (_e: unknown, payload: unknown): void => {
      if (payload && typeof payload === 'object') {
        if (closedSent) return; // the teardown tail belongs to nobody
        const evt = payload as { kind?: unknown; name?: unknown };
        if (evt.kind === 'tab-close' && typeof evt.name === 'string') {
          const popped = registry.unregister('tab', evt.name); // the tab is gone; reopen = register again
          if (!popped) return; // an echo of our own pop — never re-emitted
        }
        dispatch(sink, { ...(evt as Record<string, unknown>) } as unknown as WrapperEvent);
      }
    };
    electron.ipcMain.on('ew:ready', readyHandler);
    electron.ipcMain.on('ew:event', eventHandler);
    removeIpc = () => {
      electron.ipcMain.removeListener('ew:ready', readyHandler);
      electron.ipcMain.removeListener('ew:event', eventHandler);
    };

    win.on('close', (e: unknown) => {
      const ev = e as { preventDefault?: () => void };
      const quitOnClose = winOpts.quitOnClose === true;
      if (!quitting && trayEnabled && !quitOnClose && ev?.preventDefault) {
        ev.preventDefault(); // the window lives in the tray (V1's home); quit goes through the tray
        hide();
      }
    });
    win.on('closed', () => {
      if (!quitting && !trayEnabled) quit(); // no tray, no home — closing the window closes the app
    });

    // The tray comes WITH the wrapper — default ON; icon as input.
    const traySpec = resolveTraySpec(
      options.tray,
      { show, quit },
      `${winOpts.title ?? 'Electron_Wrapper'}`,
    );
    trayEnabled = traySpec.enabled;
    if (traySpec.enabled) {
      const image = traySpec.icon
        ? traySpec.icon.startsWith('data:')
          ? electron.nativeImage.createFromDataURL(traySpec.icon)
          : electron.nativeImage.createFromPath(traySpec.icon)
        : electron.nativeImage.createFromPath(DEFAULT_ICON);
      tray = new electron.Tray(image);
      tray.setToolTip(traySpec.tooltip);
      tray.setContextMenu(electron.Menu.buildFromTemplate(toTreeTemplate('tray', traySpec.menu, menuDispatch)));
      tray.on('click', () => {
        if (win && !win.isDestroyed()) (win.isVisible() ? hide() : show());
      });
      tray.on('double-click', () => show());
    }

    // A really-closing app says so, once, through the same hand every other event uses.
    electron.app.on('before-quit', () => {
      if (!closedSent) {
        closedSent = true;
        sendEvent('app-closed');
      }
    });

    buildBar();
    await win.loadFile(PAGE_FILE);

    // Optional fancy: pull each tab's state and mirror it.
    if (options.state?.endpoint) {
      puller = createStatePuller({
        endpoint: options.state.endpoint,
        intervalMs: options.state.intervalMs,
        names: () => registry.tabs().map((t) => t.name),
        onSnapshot: (entries) => {
          for (const entry of entries) visualsByName.set(entry.name, entry.visual);
          pushPanes();
          const selected = autoSelect(entries);
          if (selected !== lastAuto) {
            lastAuto = selected;
            if (selected && win && !win.isDestroyed()) win.webContents.send('ew:select', { name: selected });
          }
        },
      });
      puller.start();
    }
  })();

  return {
    registry,
    template,
    whenBooted,
    register(entry: unknown): WrapperEntry {
      return registry.register(entry);
    },
    unregister(kind: EntryKind, key: string): boolean {
      return registry.unregister(kind, key);
    },
    list() {
      return { tabs: registry.tabs(), menus: registry.menus() };
    },
    panes: paneViews,
    show,
    hide,
    sendEvent,
    quit,
    async stop(): Promise<void> {
      puller?.stop();
      unsubscribe();
      if (tray) {
        tray.destroy();
        tray = null;
      }
      removeIpc?.();
      removeIpc = null;
      win = null;
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL wrapperMain :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  // A faithful little electron surface: the PLATFORM as input, so the machine runs for
  // real in plain node. (The live smoke run picks up everything a stub cannot see.)
  const calls: string[] = [];
  const ipcHandlers = new Map<string, (...args: unknown[]) => void>();
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const windowHandlers = new Map<string, (...args: unknown[]) => void>();
  const seen = { winOpts: null as Record<string, unknown> | null, loaded: '', menuBar: null as unknown, trayMenus: 0, destroyed: 0, quit: 0, trays: 0 };

  const fakeWin: EwBrowserWindow = {
    loadFile: async (f: string) => {
      seen.loaded = f;
    },
    webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) },
    on: (e: string, cb: (...a: unknown[]) => void) => {
      windowHandlers.set(e, cb);
    },
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    isVisible: () => true,
    isDestroyed: () => false,
    focus: () => calls.push('focus'),
  };
  const fakeTray: EwTray = {
    setToolTip: (t: string) => calls.push(`tray:tip:${t}`),
    setContextMenu: (_m: unknown) => {
      seen.trayMenus += 1;
    },
    on: (e: string, cb: (...a: unknown[]) => void) => calls.push(`tray:on:${e}:${typeof cb}`),
    destroy: () => {
      seen.destroyed += 1;
    },
  };
  const electron: ElectronSurface = {
    app: {
      whenReady: async () => undefined,
      on: (e: string, cb: (...a: unknown[]) => void) => {
        calls.push(`app:on:${e}`);
        void cb;
      },
      quit: () => {
        seen.quit += 1;
      },
    },
    BrowserWindow: function (opts: Record<string, unknown>) {
      seen.winOpts = opts;
      return fakeWin;
    } as unknown as ElectronSurface['BrowserWindow'],
    Menu: {
      setApplicationMenu: (mm: unknown) => {
        seen.menuBar = mm;
      },
      buildFromTemplate: (t: unknown[]) => ({ built: t }),
    },
    Tray: function (_img: unknown) {
      seen.trays += 1;
      return fakeTray;
    } as unknown as ElectronSurface['Tray'],
    nativeImage: {
      createFromPath: (p: string) => ({ p }),
      createFromDataURL: (d: string) => ({ d }),
    },
    ipcMain: {
      on: (ch: string, cb: (...a: unknown[]) => void) => {
        ipcHandlers.set(ch, cb);
      },
      removeListener: (ch: string, cb: (...a: unknown[]) => void) => {
        if (ipcHandlers.get(ch) === cb) ipcHandlers.delete(ch);
      },
    },
  };

  const events: Array<Record<string, unknown>> = [];
  const handler = {
    trigger: (_name: string, payload: unknown) => {
      events.push(payload as Record<string, unknown>);
    },
  };

  const m = await createWrapperModule({
    electron,
    template: { spots: [{ id: 'main' }, { id: 'side' }], arrangement: 'row', defaultSpot: 'main' },
    entries: [
      { type: 'tab', name: 'EH', path: 'localhost:8126' },
      { type: 'tab', name: 'State', path: 'localhost:8127', spot: 'side' },
      { type: 'menu', id: 'file', label: 'File', items: [{ label: 'Quit' }] },
    ],
    tray: { tooltip: 'Demo W' },
    window: { title: 'T' },
    eventHandler: handler,
  });
  await m.whenBooted;

  ok('a window was created', seen.winOpts !== null);
  const webPrefs = (seen.winOpts?.webPreferences ?? {}) as Record<string, unknown>;
  ok('the preload is wired', String(webPrefs.preload).replace(/\\/g, '/').endsWith('public/preload.cjs'));
  ok('the wrapper page loaded', seen.loaded.replace(/\\/g, '/').endsWith('public/index.html'));
  ok('the tray was built (default ON)', seen.trays === 1);
  ok('the tray carries its tooltip', calls.some((c) => c === 'tray:tip:Demo W'));
  ok('the tray got its context menu', seen.trayMenus === 1);
  ok('the menu bar was set from the registered menu', seen.menuBar !== null && seen.menuBar !== undefined);
  ok('ipc hands are listening', ipcHandlers.has('ew:ready') && ipcHandlers.has('ew:event'));

  ipcHandlers.get('ew:ready')?.();
  const boot = sent.find((s) => s.channel === 'ew:bootstrap');
  const bootData = boot?.args[0] as { template: TemplateDef; panes: PaneView[]; layout: LayoutDef } | undefined;
  ok('bootstrap arrives with the template', bootData?.template.defaultSpot === 'main');
  ok('bootstrap carries both panes with their urls', bootData?.panes.length === 2 && bootData.panes[0].url === 'http://localhost:8126');
  ok('the neutral layout carries the two spots', bootData?.layout.root.content.length === 2);
  ok('the State tab sits in side', bootData?.panes.find((p) => p.name === 'State')?.spot === 'side');

  sent.length = 0;
  m.register({ type: 'tab', name: 'New', path: 'localhost:9999' });
  const panesMsg = sent.find((s) => s.channel === 'ew:panes');
  const panesData = panesMsg?.args[0] as { panes: PaneView[] } | undefined;
  ok('a live registration pushes panes to the renderer', panesData?.panes.length === 3);

  events.length = 0;
  ipcHandlers.get('ew:event')?.({}, { kind: 'tab-close', name: 'New' });
  ok('closing a tab pops it from the registry', m.list().tabs.find((t) => t.name === 'New') === undefined);
  ok('closing a tab informs the handler', events.some((e) => e.kind === 'tab-close' && e.name === 'New'));

  // an echo (the renderer repeating our own pop) is dead on arrival
  events.length = 0;
  ipcHandlers.get('ew:event')?.({}, { kind: 'tab-close', name: 'New' });
  ok('an echo of our own pop does not re-emit', events.length === 0);

  const built = (seen.menuBar as { built: Array<{ label?: string; submenu?: Array<{ label?: string; click?: () => void }> }> }).built;
  events.length = 0;
  built[0]?.submenu?.[0]?.click?.();
  ok('a menu click goes out as an event', events.some((e) => e.kind === 'menu-click' && e.id === 'Quit'));

  const closeState = { prevented: false };
  windowHandlers.get('close')?.({
    preventDefault: () => {
      closeState.prevented = true;
    },
  });
  ok('the X hides into the tray instead of quitting', closeState.prevented === true && calls.includes('hide'));

  events.length = 0;
  m.quit();
  ok('the real quit sends app-closed exactly once', events.filter((e) => e.kind === 'app-closed').length === 1 && seen.quit === 1);

  // after the real quit, the renderer's teardown tail is ignored
  events.length = 0;
  ipcHandlers.get('ew:event')?.({}, { kind: 'tab-close', name: 'EH' });
  ok('post-quit tab-close is ignored', events.length === 0);

  await m.stop();
  ok('stop tears the tray down', seen.destroyed === 1);

  // Tray off: closing the window closes the app.
  const m2 = await createWrapperModule({ electron, entries: [], tray: { enabled: false }, eventHandler: handler });
  await m2.whenBooted;
  ok('tray off means no tray is built', seen.trays === 1);
  events.length = 0;
  const quitBefore = seen.quit;
  windowHandlers.get('closed')?.();
  ok('no tray — closing the window closes the app', seen.quit === quitBefore + 1 && events.some((e) => e.kind === 'app-closed'));
  await m2.stop();
  ok('no menus registered — the menu bar is cleared', seen.menuBar === null || seen.menuBar === undefined || (seen.menuBar as { built?: unknown[] }).built?.length === 0);
}
