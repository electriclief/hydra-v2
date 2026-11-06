/**
 * @module Event_Handler_module
 * @description THE ONE FILE LOADED — the embed entry for another code thread. A host
 *              thread loads THIS single file to gain the generic event handler inside
 *              ITS thread: register · trigger · log, with the quiet wrap that writes
 *              every outcome as its own event. IT EXPECTS A LOG PATH — createModule()
 *              and startModule() take `{ logPath }`: the host passes where events are
 *              logged. `npm start` is the other life: the module's own local thread,
 *              its own port.
 * @intent Operator standard (2026-09-16): every module ships one root file,
 *         `<Folder_Name>_module.js` (named after the module's folder), that gets added
 *         to some other code thread. Generic for all projects — no project words inside.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEventHandler } from './public/js/eventHandler.js';
import { createMcpRegistry } from './public/js/mcpTools.js';
import { startApiServer } from './public/js/apiServer.js';

// --- Function Definitions ---

// The surface, declared right here so one look at this file shows everything a host
// thread can reach. The implementations live in public/js/ — never a copy.
export { createEventHandler, EventHandler } from './public/js/eventHandler.js';
export { createLogStore } from './public/js/logStore.js';
export { createMcpRegistry, buildTools, ToolRefusal } from './public/js/mcpTools.js';
export { createMcpServer } from './public/js/mcpServer.js';
export { createApiServer, startApiServer } from './public/js/apiServer.js';
export { createEventHandlerClient, EventHandlerError, parseSse } from './public/js/client.js';

/**
 * The pieces, built in THIS thread. `logPath` is THE path — where events are logged
 * (one rolling JSONL file). The host passes one; the default lives under cwd.
 */
export function createModule(options = {}) {
  const logPath = options.logPath || path.join(process.cwd(), 'data', 'events.log');
  const handler = createEventHandler({
    logPath,
    retentionHours: options.retentionHours,
    maxBytes: options.maxBytes,
  });
  handler.start();
  return { handler, registry: createMcpRegistry(handler), logPath, options };
}

/**
 * The module's OWN little door: handler + API + MCP on a port — the thing an Api_Root
 * carries as (directory name, this port). port: 0 asks the OS; the real one comes back.
 */
export async function startModule(options = {}) {
  const built = createModule(options);
  const api = await startApiServer({
    handler: built.handler,
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
      built.handler.close();
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests() {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const results = [];
  const ok = (label, cond, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const waitFor = async (cond, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return cond();
  };

  // 1. the whole surface really sits on this one file
  ok('createEventHandler is here', typeof createEventHandler === 'function');
  ok('createMcpRegistry is here', typeof createMcpRegistry === 'function');
  ok('startApiServer is here', typeof startApiServer === 'function');
  ok('createModule is here', typeof createModule === 'function');
  ok('startModule is here', typeof startModule === 'function');

  // 2. createModule — a REAL handler in the host thread, logging to the path it was given
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwm-eh-'));
  const logPath = path.join(dir, 'events.log');
  const m = createModule({ logPath });
  ok('the host log path is honoured', m.logPath === logPath);
  m.handler.register('embed.ping', (payload) => ({ pong: payload?.n ?? null }), { description: 'the embed check ping' });
  const receipt = m.handler.trigger('embed.ping', { n: 1 }, { source: 'process' });
  ok('a trigger answers fire-and-forget', receipt.ok === true && receipt.name === 'embed.ping');
  ok('the outcome lands as its own event', await waitFor(() => m.handler.read({ name: 'embed.ping.result', limit: 5 }).matched === 1));
  const onDisk = fs.readFileSync(logPath, 'utf8');
  ok('one rolling file at the host path is the record', onDisk.includes('"embed.ping"') && onDisk.includes('embed.ping.result'));
  m.handler.close();

  // 3. startModule — its own little door on a REAL ephemeral port
  const s = await startModule({ port: 0, logPath: path.join(dir, 'events2.log') });
  ok('startModule binds a real port', Number.isInteger(s.port) && s.port > 0, `${s.port} ${s.url}`);
  const health = await (await fetch(s.url + '/health')).json();
  ok('the door answers /health', Boolean(health) && health.ok === true, JSON.stringify(health).slice(0, 120));
  s.handler.register('door.check', () => 'ok');
  const fired = await fetch(s.url + '/api/events/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'door.check', source: 'agent' }),
  });
  ok('a trigger walks the door', fired.status === 200);
  ok('the outcome lands on the door too', await waitFor(() => s.handler.read({ name: 'door.check.result', limit: 5 }).matched === 1));
  await s.stop();
  let closed = false;
  try {
    await fetch(s.url + '/health');
  } catch {
    closed = true;
  }
  ok('the door closes on stop', closed);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[Event_Handler_module] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(failed.join('\n'));
    process.exitCode = 1;
  }
}

// Run the check when this file is executed directly (`node Event_Handler_module.js`);
// a host thread that IMPORTS it only gets the surface.
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await runTests();
  // Windows/undici: let the sockets drain; force the door only if something lingers.
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
