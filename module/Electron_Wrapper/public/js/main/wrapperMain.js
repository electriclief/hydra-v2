import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWrapperRegistry } from "../core/registry.js";
import { buildLayout, normalizeTemplate, spotFor } from "../core/template.js";
import { toPageUrl } from "../core/windowMap.js";
import { toBarTemplate, toTreeTemplate } from "../core/menuTree.js";
import { resolveTraySpec } from "../core/trayModel.js";
import { dispatch, normalizeSink } from "../core/events.js";
import { autoSelect } from "../core/visuals.js";
import { createStatePuller } from "../core/statePull.js";
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_ICON = path.join(MODULE_ROOT, "assets", "tray.png");
const PAGE_FILE = path.join(MODULE_ROOT, "public", "index.html");
const PRELOAD_FILE = path.join(MODULE_ROOT, "public", "preload.cjs");
async function resolveElectron(options) {
  if (options.electron) return options.electron;
  const mod = await import("electron");
  const electron = mod.default ?? mod;
  if (!electron || typeof electron.BrowserWindow !== "function") {
    throw new Error("[Electron_Wrapper] could not reach electron \u2014 pass {electron} when running outside a real app");
  }
  return electron;
}
async function createWrapperModule(options = {}) {
  const electron = await resolveElectron(options);
  const registry = createWrapperRegistry();
  const template = normalizeTemplate(options.template);
  const sink = normalizeSink(options.eventHandler);
  for (const entry of options.entries ?? []) registry.register(entry);
  const visualsByName = /* @__PURE__ */ new Map();
  let win = null;
  let tray = null;
  let trayEnabled = false;
  let quitting = false;
  let closedSent = false;
  let lastAuto = null;
  let puller = null;
  let removeIpc = null;
  const sendEvent = (kind, detail = {}) => dispatch(sink, { kind, ...detail });
  const paneViews = () => registry.tabs().map((t) => ({
    name: t.name,
    title: t.name,
    url: toPageUrl(t.path),
    visual: visualsByName.get(t.name) ?? "solid",
    closable: t.closable !== false,
    spot: spotFor(template, t)
  }));
  const pushPanes = () => {
    // a window whose renderer has gone away still answers isDestroyed() false for a moment; sending to its disposed
    // frame throws "Render frame was disposed" on every state pull, which buries the log and hides the real failure
    if (!win || win.isDestroyed()) return;
    if (!win.webContents || win.webContents.isDestroyed()) return;
    if (typeof win.webContents.isCrashed === "function" && win.webContents.isCrashed()) return;
    win.webContents.send("ew:panes", { panes: paneViews() });
  };
  const menuDispatch = (event) => {
    dispatch(sink, { ...event });
  };
  const buildBar = () => {
    const menus = registry.menus();
    electron.Menu.setApplicationMenu(
      menus.length > 0 ? electron.Menu.buildFromTemplate(toBarTemplate(menus, menuDispatch)) : null
    );
  };
  const show = () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  const hide = () => {
    if (win && !win.isDestroyed()) win.hide();
  };
  const quit = () => {
    quitting = true;
    if (!closedSent) {
      closedSent = true;
      sendEvent("app-closed");
    }
    electron.app.quit();
  };
  const unsubscribe = registry.subscribe(() => {
    pushPanes();
    buildBar();
  });
  const whenBooted = (async () => {
    await electron.app.whenReady();
    const winOpts = options.window ?? {};
    win = new electron.BrowserWindow({
      width: winOpts.width ?? 1200,
      height: winOpts.height ?? 800,
      title: winOpts.title ?? "Electron_Wrapper",
      show: winOpts.show !== false,
      ...winOpts.icon !== void 0 ? { icon: winOpts.icon } : {},
      webPreferences: {
        preload: PRELOAD_FILE,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    const readyHandler = () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("ew:bootstrap", {
          template,
          panes: paneViews(),
          layout: buildLayout(template, paneViews()),
          window: { title: winOpts.title ?? "Electron_Wrapper" },
          // absent unless the host asked for a footer - the wrapper never invents one
          status: options.status ?? null
        });
      }
    };
    const eventHandler = (_e, payload) => {
      if (payload && typeof payload === "object") {
        if (closedSent) return;
        const evt = payload;
        if (evt.kind === "tab-close" && typeof evt.name === "string") {
          const popped = registry.unregister("tab", evt.name);
          if (!popped) return;
        }
        dispatch(sink, { ...evt });
      }
    };
    electron.ipcMain.on("ew:ready", readyHandler);
    electron.ipcMain.on("ew:event", eventHandler);
    removeIpc = () => {
      electron.ipcMain.removeListener("ew:ready", readyHandler);
      electron.ipcMain.removeListener("ew:event", eventHandler);
    };
    win.on("close", (e) => {
      const ev = e;
      const quitOnClose = winOpts.quitOnClose === true;
      if (!quitting && trayEnabled && !quitOnClose && ev?.preventDefault) {
        ev.preventDefault();
        hide();
      }
    });
    win.on("closed", () => {
      if (!quitting && !trayEnabled) quit();
    });
    const traySpec = resolveTraySpec(
      options.tray,
      { show, quit },
      `${winOpts.title ?? "Electron_Wrapper"}`
    );
    trayEnabled = traySpec.enabled;
    if (traySpec.enabled) {
      const image = traySpec.icon ? traySpec.icon.startsWith("data:") ? electron.nativeImage.createFromDataURL(traySpec.icon) : electron.nativeImage.createFromPath(traySpec.icon) : electron.nativeImage.createFromPath(DEFAULT_ICON);
      tray = new electron.Tray(image);
      tray.setToolTip(traySpec.tooltip);
      tray.setContextMenu(electron.Menu.buildFromTemplate(toTreeTemplate("tray", traySpec.menu, menuDispatch)));
      tray.on("click", () => {
        if (win && !win.isDestroyed()) win.isVisible() ? hide() : show();
      });
      tray.on("double-click", () => show());
    }
    electron.app.on("before-quit", () => {
      if (!closedSent) {
        closedSent = true;
        sendEvent("app-closed");
      }
    });
    buildBar();
    await win.loadFile(PAGE_FILE);
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
            if (selected && win && !win.isDestroyed()) win.webContents.send("ew:select", { name: selected });
          }
        }
      });
      puller.start();
    }
  })();
  return {
    registry,
    template,
    whenBooted,
    register(entry) {
      return registry.register(entry);
    },
    unregister(kind, key) {
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
    async stop() {
      puller?.stop();
      unsubscribe();
      if (tray) {
        tray.destroy();
        tray = null;
      }
      removeIpc?.();
      removeIpc = null;
      win = null;
    }
  };
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL wrapperMain :: ${label}${extra ? " :: " + extra : ""}`);
  };
  const calls = [];
  const ipcHandlers = /* @__PURE__ */ new Map();
  const sent = [];
  const windowHandlers = /* @__PURE__ */ new Map();
  const seen = { winOpts: null, loaded: "", menuBar: null, trayMenus: 0, destroyed: 0, quit: 0, trays: 0 };
  const fakeWin = {
    loadFile: async (f) => {
      seen.loaded = f;
    },
    webContents: { send: (channel, ...args) => sent.push({ channel, args }) },
    on: (e, cb) => {
      windowHandlers.set(e, cb);
    },
    show: () => calls.push("show"),
    hide: () => calls.push("hide"),
    isVisible: () => true,
    isDestroyed: () => false,
    focus: () => calls.push("focus")
  };
  const fakeTray = {
    setToolTip: (t) => calls.push(`tray:tip:${t}`),
    setContextMenu: (_m) => {
      seen.trayMenus += 1;
    },
    on: (e, cb) => calls.push(`tray:on:${e}:${typeof cb}`),
    destroy: () => {
      seen.destroyed += 1;
    }
  };
  const electron = {
    app: {
      whenReady: async () => void 0,
      on: (e, cb) => {
        calls.push(`app:on:${e}`);
        void cb;
      },
      quit: () => {
        seen.quit += 1;
      }
    },
    BrowserWindow: function(opts) {
      seen.winOpts = opts;
      return fakeWin;
    },
    Menu: {
      setApplicationMenu: (mm) => {
        seen.menuBar = mm;
      },
      buildFromTemplate: (t) => ({ built: t })
    },
    Tray: function(_img) {
      seen.trays += 1;
      return fakeTray;
    },
    nativeImage: {
      createFromPath: (p) => ({ p }),
      createFromDataURL: (d) => ({ d })
    },
    ipcMain: {
      on: (ch, cb) => {
        ipcHandlers.set(ch, cb);
      },
      removeListener: (ch, cb) => {
        if (ipcHandlers.get(ch) === cb) ipcHandlers.delete(ch);
      }
    }
  };
  const events = [];
  const handler = {
    trigger: (_name, payload) => {
      events.push(payload);
    }
  };
  const m = await createWrapperModule({
    electron,
    template: { spots: [{ id: "main" }, { id: "side" }], arrangement: "row", defaultSpot: "main" },
    entries: [
      { type: "tab", name: "EH", path: "localhost:8126" },
      { type: "tab", name: "State", path: "localhost:8127", spot: "side" },
      { type: "menu", id: "file", label: "File", items: [{ label: "Quit" }] }
    ],
    tray: { tooltip: "Demo W" },
    window: { title: "T" },
    eventHandler: handler
  });
  await m.whenBooted;
  ok("a window was created", seen.winOpts !== null);
  const webPrefs = seen.winOpts?.webPreferences ?? {};
  ok("the preload is wired", String(webPrefs.preload).replace(/\\/g, "/").endsWith("public/preload.cjs"));
  ok("the wrapper page loaded", seen.loaded.replace(/\\/g, "/").endsWith("public/index.html"));
  ok("the tray was built (default ON)", seen.trays === 1);
  ok("the tray carries its tooltip", calls.some((c) => c === "tray:tip:Demo W"));
  ok("the tray got its context menu", seen.trayMenus === 1);
  ok("the menu bar was set from the registered menu", seen.menuBar !== null && seen.menuBar !== void 0);
  ok("ipc hands are listening", ipcHandlers.has("ew:ready") && ipcHandlers.has("ew:event"));
  ipcHandlers.get("ew:ready")?.();
  const boot = sent.find((s) => s.channel === "ew:bootstrap");
  const bootData = boot?.args[0];
  ok("bootstrap arrives with the template", bootData?.template.defaultSpot === "main");
  ok("bootstrap carries both panes with their urls", bootData?.panes.length === 2 && bootData.panes[0].url === "http://localhost:8126");
  ok("the neutral layout carries the two spots", bootData?.layout.root.content.length === 2);
  ok("the State tab sits in side", bootData?.panes.find((p) => p.name === "State")?.spot === "side");
  sent.length = 0;
  m.register({ type: "tab", name: "New", path: "localhost:9999" });
  const panesMsg = sent.find((s) => s.channel === "ew:panes");
  const panesData = panesMsg?.args[0];
  ok("a live registration pushes panes to the renderer", panesData?.panes.length === 3);
  events.length = 0;
  ipcHandlers.get("ew:event")?.({}, { kind: "tab-close", name: "New" });
  ok("closing a tab pops it from the registry", m.list().tabs.find((t) => t.name === "New") === void 0);
  ok("closing a tab informs the handler", events.some((e) => e.kind === "tab-close" && e.name === "New"));
  events.length = 0;
  ipcHandlers.get("ew:event")?.({}, { kind: "tab-close", name: "New" });
  ok("an echo of our own pop does not re-emit", events.length === 0);
  const built = seen.menuBar.built;
  events.length = 0;
  built[0]?.submenu?.[0]?.click?.();
  ok("a menu click goes out as an event", events.some((e) => e.kind === "menu-click" && e.id === "Quit"));
  const closeState = { prevented: false };
  windowHandlers.get("close")?.({
    preventDefault: () => {
      closeState.prevented = true;
    }
  });
  ok("the X hides into the tray instead of quitting", closeState.prevented === true && calls.includes("hide"));
  events.length = 0;
  m.quit();
  ok("the real quit sends app-closed exactly once", events.filter((e) => e.kind === "app-closed").length === 1 && seen.quit === 1);
  events.length = 0;
  ipcHandlers.get("ew:event")?.({}, { kind: "tab-close", name: "EH" });
  ok("post-quit tab-close is ignored", events.length === 0);
  await m.stop();
  ok("stop tears the tray down", seen.destroyed === 1);
  const m2 = await createWrapperModule({ electron, entries: [], tray: { enabled: false }, eventHandler: handler });
  await m2.whenBooted;
  ok("tray off means no tray is built", seen.trays === 1);
  events.length = 0;
  const quitBefore = seen.quit;
  windowHandlers.get("closed")?.();
  ok("no tray \u2014 closing the window closes the app", seen.quit === quitBefore + 1 && events.some((e) => e.kind === "app-closed"));
  await m2.stop();
  ok("no menus registered \u2014 the menu bar is cleared", seen.menuBar === null || seen.menuBar === void 0 || seen.menuBar.built?.length === 0);
}
export {
  createWrapperModule,
  runTests
};
//# sourceMappingURL=wrapperMain.js.map
