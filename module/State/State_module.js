/**
 * @module State_module
 * @description THE ONE FILE LOADED — the embed entry for another code thread. A host
 *              thread loads THIS single file to gain the generic state registry inside
 *              ITS thread: register ANY object under a dotted-path name · pull it back
 *              (full or delta) · discover what is held · drop it. The registry boots
 *              BLANK and persists nothing — the host registers what it wants seen, and
 *              entries live exactly as long as their registrants. `npm start` is the
 *              other life: the module's own local thread, its own port.
 * @intent Operator standard (2026-09-16): every module ships one root file,
 *         `<Folder_Name>_module.js` (named after the module's folder), that gets added
 *         to some other code thread. Generic for all projects — no project words inside.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStateRegistry } from './public/js/stateRegistry.js';
import { createMcpRegistry } from './public/js/mcpTools.js';
import { startApiServer } from './public/js/apiServer.js';

// --- Function Definitions ---

// The surface, declared right here so one look at this file shows everything a host
// thread can reach. The implementations live in public/js/ — never a copy.
export { createStateRegistry, State, shaped, isShapedReply } from './public/js/stateRegistry.js';
export { createMcpRegistry, buildTools, ToolRefusal } from './public/js/mcpTools.js';
export { createMcpServer } from './public/js/mcpServer.js';
export { createApiServer, startApiServer } from './public/js/apiServer.js';
export { createStateClient, StateError, parseSse } from './public/js/client.js';

/**
 * The pieces, built in THIS thread. Nothing to pass in: the registry boots blank —
 * the host registers what it wants seen, in its own shape.
 */
export function createModule(options = {}) {
  const state = createStateRegistry();
  return { state, registry: createMcpRegistry(state), options };
}

/**
 * The module's OWN little door: the registry + API + MCP on a port — the thing an
 * Api_Root carries as (directory name, this port). port: 0 asks the OS; the real one
 * comes back.
 */
export async function startModule(options = {}) {
  const built = createModule(options);
  const api = await startApiServer({
    state: built.state,
    port: options.port ?? 0,
    host: options.host,
    token: options.token ?? null,
  });
  return {
    ...built,
    api,
    port: api.port,
    url: api.url,
    stop: async () => {
      await api.stop();
      built.state.close();
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests() {
  const results = [];
  const ok = (label, cond, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. the whole surface really sits on this one file
  ok('createStateRegistry is here', typeof createStateRegistry === 'function');
  ok('createMcpRegistry is here', typeof createMcpRegistry === 'function');
  ok('startApiServer is here', typeof startApiServer === 'function');
  ok('createModule is here', typeof createModule === 'function');
  ok('startModule is here', typeof startModule === 'function');

  // 2. createModule — a REAL registry in the host thread, blank until the host registers
  const m = createModule({});
  ok('the registry boots blank', m.state.discover().entries.length === 0);
  m.state.register('Host.Thing', { value: 42 });
  const pulled = await m.state.pull('Thing');
  ok('a pull resolves by leaf in the host thread', pulled.ok === true && pulled.content.value === 42);
  m.state.register('Host.Log', { log: 'a\nb\nc' }, { serving: { log: 'delta' } });
  const full = await m.state.pull('Host.Log');
  const delta = await m.state.pull('Host.Log', { marks: full.marks });
  ok('the delta path works in the host thread', full.full === true && delta.full === false && delta.content.log === '');
  m.state.close();

  // 3. startModule — its own little door on a REAL ephemeral port
  const s = await startModule({ port: 0 });
  ok('startModule binds a real port', Number.isInteger(s.port) && s.port > 0, `${s.port} ${s.url}`);
  const health = await (await fetch(s.url + '/health')).json();
  ok('the door answers /health', Boolean(health) && health.ok === true, JSON.stringify(health).slice(0, 120));
  await fetch(s.url + '/api/state/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Door.Check', content: { n: 1 } }),
  });
  const readBack = await (await fetch(s.url + '/api/state/pull?name=Door.Check')).json();
  ok('a pull walks the door', readBack.ok === true && readBack.content.n === 1);
  await s.stop();
  let closed = false;
  try {
    await fetch(s.url + '/health');
  } catch {
    closed = true;
  }
  ok('the door closes on stop', closed);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[State_module] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(failed.join('\n'));
    process.exitCode = 1;
  }
}

// Run the check when this file is executed directly (`node State_module.js`);
// a host thread that IMPORTS it only gets the surface.
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await runTests();
  // Windows/undici: let the sockets drain; force the door only if something lingers.
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
