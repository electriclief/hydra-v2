# Electron_Wrapper

A GENERIC Electron shell: **a template + registered tabs**. Hand it a template (spot(s) for tab
insertions — "where tabs go and how to render") and register tabs — `{name, path}`, where the
path is an ADDRESS; the wrapper maps each tab as a div/iframe to its page. Register menus
(label → function, nested, with separators). Wire an event-handler instance and every tab
activation, tab close, menu click, tray click and the app's own close ("app closed") goes OUT as
an event through it. The module wraps; it decides nothing; it is **content-blind** — what a tab
renders (ComfyUI, anything) is nobody's business. The compiled app never needs updating: tabs
and menus are registered after run start, added and popped as life goes on.

It **ships WITH an app tray** — default ON, icon as input, a menu tree with matching onclick.
Point it at a State door and each tab's state is **pulled and mirrored**: solid (silent default)
· highlighted · flashing — and a lone flashing tab auto-selects. The Golden Layout dialect lives
only in `public/ts/renderer/app.ts`; the neutral arrangement is plain data, so the layout library
under the wrapper stays swappable.

## Core Modules

| File | Reason / Functionality |
| :--- | :--- |
| `public/ts/core/registry.ts` | Typed entries — tabs + menus; upsert by key; validates the wrapper's own house; subscribers hear every change. Boots blank. |
| `public/ts/core/template.ts` | The template as data: spots for tab insertions + arrangement; `buildLayout` composes the neutral arrangement (GL dialect lives in the renderer only). |
| `public/ts/core/windowMap.ts` | A registered `path` → a real page URL (`localhost:8088` → `http://localhost:8088`). |
| `public/ts/core/menuTree.ts` | Menu trees → native menu template, as pure data; every click runs the registrant's hand AND goes out as an event, isolated either way. |
| `public/ts/core/trayModel.ts` | The tray resolved as data: default ON, icon as input, menu tree with onclicks; Show·Quit fallback. |
| `public/ts/core/visuals.ts` | State value → solid / highlighted / flashing; a lone flashing tab auto-selects; mirror only, never clears. |
| `public/ts/core/statePull.ts` | Optional: pulls each tab's state from a State door; a down door or missing entry just reads solid. |
| `public/ts/core/events.ts` | The one hand OUT — an Event_Handler-shaped instance or a plain function; a throwing listener is isolated. |
| `public/ts/main/wrapperMain.ts` | The machine: `createWrapperModule` — window, menu bar, tray, IPC, state pull, close semantics. Accepts an injected electron surface (or resolves `electron` itself inside a real app). |
| `public/ts/renderer/app.ts` | The wrapper page: neutral arrangement → Golden Layout; tabs as div/iframe; visual classes; clicks/closes out via the preload bridge. |
| `public/ts/selftest.ts` | The gate counter — runs every module's `runTests()` and prints GREEN/RED. |
| `Electron_Wrapper_module.js` | THE ONE FILE LOADED — the embed entry (re-exports the surface, adds `createModule`). |

## Run it

```bash
npm test               # the gate: build → typecheck → selftest   (127 asserts)
node Electron_Wrapper_module.js   # the embed entry's own check
npm run docs           # regenerate Docs/index.html
```

The demo (a hand-runnable dumb terminal — edit the addresses, run, done):

```bash
# needs an electron binary: `npm i -D electron` here, or point at one:
ELECTRON_BIN="C:/path/to/electron.exe" npm run demo
```

Edit `demo/template.json` (tabs + spots + window/tray), relaunch, done. Events land in
`demo/events.log` and on stdout.

## Use it (embed into a host app)

```js
import { createModule } from './Electron_Wrapper/Electron_Wrapper_module.js';

const wrapper = await createModule({
  electron: { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain }, // or omit: resolved inside the app
  template: { spots: [{ id: 'main', title: 'Main' }, { id: 'side' }], arrangement: 'row' },
  entries: [
    { type: 'tab', name: 'Comfy A', path: '192.168.1.50:8188' },
    { type: 'tab', name: 'Comfy B', path: '192.168.1.51:8188', spot: 'side' },
    { type: 'menu', id: 'file', label: 'File', items: [{ label: 'Load', onClick: load }] },
  ],
  tray: { icon: 'C:/icons/tray.png', tooltip: 'My wrapper' }, // menu defaults to Show · Quit
  eventHandler: ehInstance,                                    // anything with .trigger(name, payload)
  state: { endpoint: 'http://127.0.0.1:8127' },                // optional fancies (flashing tabs)
});

await wrapper.whenBooted;

// live life — added/popped after launch is the normal way:
wrapper.register({ type: 'tab', name: 'Comfy C', path: '192.168.1.52:8188' }); // appears now
wrapper.unregister('tab', 'Comfy C');   // close = pop (the renderer's X does this too, + event out)
wrapper.register({ type: 'tab', name: 'Comfy C', path: '192.168.1.52:8188' }); // back
```

## Notes (honest list)

- **Clicks registered** = tab activations (switching), tab closes, menu clicks (menubar + tray),
  and the real app close (`app-closed`, sent exactly once). Clicks INSIDE a tab's page belong to
  that page — the wrapper never sees them.
- **The X hides to the tray** when the tray is on (V1's home); `window.quitOnClose: true`
  overrides. With the tray off, closing the window closes the app.
- **Tab names are keys** (in the registry and in state pulls) — keep them unique.
- **Tray icon** default is drawn by `scripts/make-assets.cjs` (`assets/tray.png`); pass
  `tray.icon` to override. The icon is INPUT, never compiled in.
- **Golden Layout**: `golden-layout` (GL2, npm) is a dependency; the vendored-JQuery-era 1.x of
  old is deliberately not carried. If another line ever wins, the swap lives in
  `public/ts/renderer/app.ts` alone.
- **ESM host entries**: with an ESM main-process entry file, Electron fires 'ready' only after
  the entry module finishes evaluating — never top-level-await `createModule(...)` there (it
  awaits `app.whenReady()`, which waits for the module: silent deadlock). Schedule with
  `app.whenReady().then(...)`. CJS hosts are unaffected.
