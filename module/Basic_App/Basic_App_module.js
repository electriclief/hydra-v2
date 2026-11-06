/**
 * Basic_App_module.js — THE ONE FILE another code thread loads (the embed entry).
 *
 * The shelf's instance layer: it stands a run up over the whole shelf, one at a time,
 * no queue — services → rm (poll·book·pop) → pw (launch·watch·kill) → state (variables)
 * → eh (events, passed in). Doors are pointed at by config; this entry starts NO other
 * module. Its own check:  node Basic_App_module.js
 */

import { pathToFileURL } from 'node:url';
import { createBasicServer } from './public/js/basicServer.js';

export { createBasicServer } from './public/js/basicServer.js';
export { createDoors, DoorError } from './public/js/doors.js';
export {
  buildBookInput,
  buildValues,
  busyFrom,
  freshOutputPath,
  inputFields,
  isLive,
  lazyOutputs,
  resolveLaunch,
  resolveTokens,
} from './public/js/runLogic.js';

/** Pieces in THIS thread, a door of its own (port 0 = the OS picks a free one). */
export async function createModule(options = {}) {
  return createBasicServer({
    doors: options.doors,
    port: options.port ?? 0,
    host: options.host ?? '127.0.0.1',
    eh: options.eh ?? null,
    watchMs: options.watchMs,
    publicDir: options.publicDir,
  });
}

/** The same, with a banner — a running app door. */
export async function startModule(options = {}) {
  const server = await createModule(options);
  console.log(`[Basic_App] ${server.url}`);
  return { url: server.url, port: server.port, stop: server.stop, server };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./public/js/selftest.js');
}
