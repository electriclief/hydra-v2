/**
 * @module Electron_Wrapper_module
 * @description THE ONE FILE LOADED - the embed entry for another code thread (an Electron
 *              main process). Loaded there, it adds the GENERIC wrapper to THAT app:
 *              createModule stands the wrapper up in the host's thread - the window with
 *              the template + registered tabs (name + path -> a div/iframe), the menu bar
 *              from registered menus, the app tray (default ON; icon as input; a menu tree
 *              with matching onclick), events OUT through the event-handler instance
 *              ("app closed" included), and the optional per-tab state pull (solid /
 *              highlighted / flashing). The compiled app never needs updating: tabs and
 *              menus are registered after run start. `npm start` is the other life: the
 *              module's own demo app. Generic for all projects - no project words inside.
 * @intent Operator standard (2026-09-16): every module ships one root file,
 *         `<Folder_Name>_module.js` (named after the module's folder), that gets added
 *         to some other code thread.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWrapperModule } from './public/js/main/wrapperMain.js';

// --- Function Definitions ---

// The surface, declared right here so one look at this file shows everything a host
// thread can reach. The implementations live in public/js/ - never a copy.
export { createWrapperModule as createModule };
export { createWrapperRegistry, canonicalEntry } from './public/js/core/registry.js';
export { normalizeTemplate, buildLayout, spotFor, DEFAULT_TEMPLATE } from './public/js/core/template.js';
export { toPageUrl, displayAddress, hasScheme } from './public/js/core/windowMap.js';
export { toBarTemplate, toTreeTemplate } from './public/js/core/menuTree.js';
export { resolveTraySpec, defaultTrayMenu } from './public/js/core/trayModel.js';
export { normalizeVisual, visualClass, autoSelect, applySnapshot } from './public/js/core/visuals.js';
export { createStatePuller, extractVisualValue } from './public/js/core/statePull.js';
export { normalizeSink, dispatch } from './public/js/core/events.js';

// --- Built-in Test Suite ---

export async function runTests() {
  const results = [];
  const ok = (label, cond, extra = '') => {
    console.assert(cond, `FAIL Electron_Wrapper_module :: ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. the whole surface really sits on this one file
  ok('createModule is here', typeof createWrapperModule === 'function');
  ok('the registry surface is here', typeof (await import('./public/js/core/registry.js')).createWrapperRegistry === 'function');
  ok('the template surface is here', typeof (await import('./public/js/core/template.js')).normalizeTemplate === 'function');
  ok('the tray surface is here', typeof (await import('./public/js/core/trayModel.js')).resolveTraySpec === 'function');

  // 2. createModule - a REAL module in THIS thread (the platform injected as input)
  const fakeWin = {
    loadFile: async () => undefined,
    webContents: { send: () => undefined },
    on: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    isVisible: () => true,
    isDestroyed: () => false,
    focus: () => undefined,
  };
  const stub = {
    app: { whenReady: async () => undefined, on: () => undefined, quit: () => undefined },
    BrowserWindow: function () {
      return fakeWin;
    },
    Menu: { setApplicationMenu: () => undefined, buildFromTemplate: (t) => ({ built: t }) },
    Tray: function () {
      return { setToolTip: () => undefined, setContextMenu: () => undefined, on: () => undefined, destroy: () => undefined };
    },
    nativeImage: { createFromPath: () => ({}), createFromDataURL: () => ({}) },
    ipcMain: { on: () => undefined, removeListener: () => undefined },
  };
  const events = [];
  const m = await createWrapperModule({
    electron: stub,
    entries: [{ type: 'tab', name: 'T', path: 'localhost:1' }],
    eventHandler: (name, payload) => events.push(payload),
    tray: { enabled: false },
  });
  await m.whenBooted;
  ok('a module stands in this thread', m.list().tabs.length === 1);
  m.register({ type: 'tab', name: 'U', path: 'localhost:2' });
  ok('live registration walks', m.list().tabs.length === 2);
  m.quit();
  ok('quit says app-closed', events.some((e) => e && e.kind === 'app-closed'));
  await m.stop();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[Electron_Wrapper_module] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(failed.join('\n'));
    process.exitCode = 1;
  }
}

// Run the check when this file is executed directly (`node Electron_Wrapper_module.js`);
// a host thread that IMPORTS it only gets the surface.
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await runTests();
  // Windows/undici: let the sockets drain; force the door only if something lingers.
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
