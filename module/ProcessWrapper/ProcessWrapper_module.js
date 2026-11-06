/**
 * @module ProcessWrapper_module
 * @description THE ONE FILE LOADED — the embed entry for another code thread.
 *              A host thread (Api_Root, Server_process, Client_process,
 *              Guardian_process, a tool) loads THIS single file to gain the
 *              module's whole surface — the process table, the stream hub, the
 *              API server, the client, the saved-commands registry and the MCP
 *              registry (the agent face as list + call, ready for Api_Root) —
 *              inside ITS thread. `npm start` is the other life: it stands this
 *              module up as its OWN local thread with its own port.
 * @intent Operator standard (2026-09-16): every module ships one root file,
 *         `<Folder_Name>_module.js` (named after the module's folder), that
 *         gets added to some other code thread.
 *         This file stays thin — it re-exports the real implementations and
 *         adds nothing of its own but the two bundle helpers below. main() is
 *         intentionally NOT re-exported: it is the standalone-thread entry and
 *         attaches SIGINT/SIGTERM handlers to whoever calls it.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWrapper } from './public/js/processWrapper.js';
import { createStreamHub } from './public/js/streamHub.js';
import { startWrapper } from './public/js/main.js';
import { createPwMcpRegistry } from './public/js/mcpRegistry.js';
import { createSystemWatch } from './public/js/systemWatch.js';

// --- Function Definitions ---

// The surface, declared right here so one look at this file shows everything a
// host thread can reach. The implementations live in public/js/ — never a copy.
export { createWrapper, parseCommand } from './public/js/processWrapper.js';
export { createStreamHub } from './public/js/streamHub.js';
export { createApiServer, startApiServer } from './public/js/apiServer.js';
export { createProcessClient, ProcessWrapperError, parseSse } from './public/js/client.js';
export {
  defaultRegistry,
  stateToYaml,
  yamlToState,
  loadRegistry,
  saveRegistry,
  addCommand,
  updateCommand,
  removeCommand,
  getCommand,
  toSpec,
} from './public/js/registryStore.js';
export { startWrapper, parseArgs, banner } from './public/js/main.js';
export { createSystemWatch, parseSampleLine } from './public/js/systemWatch.js';
export { createPwMcpRegistry, createFileBridge } from './public/js/mcpRegistry.js';
export { ToolError } from './public/js/mcpServer.js';

/**
 * The pieces, built in THIS thread — no port opened. Use when the host wants
 * the table and the copies but not a server of its own.
 */
export function createModule(options = {}) {
  const full = {
    streamDir: path.join(process.cwd(), 'data', 'streams'),
    bufferLimitChars: 4_000_000,
    graceMs: 3000,
    ...options,
  };
  const wrapper = createWrapper({
    streamDir: full.streamDir,
    bufferLimitChars: full.bufferLimitChars,
    graceMs: full.graceMs,
    killTree: true,
  });
  const hub = createStreamHub(wrapper);
  const registry = createPwMcpRegistry({
    wrapper,
    hub,
    registryFile: typeof full.registryFile === 'string' ? full.registryFile : undefined,
  });
  return { wrapper, hub, registry, options: full };
}

/**
 * The module's OWN little door: wrapper + hub + the full API (GUI + MCP) on a
 * port — the thing an Api_Root carries as (directory name, this port).
 * port: 0 asks the OS for a free one; the real one comes back as `port`/`url`.
 */
export async function startModule(options = {}) {
  const running = await startWrapper(options);
  return { ...running, port: running.api.port, url: running.api.url };
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

  // 1. the whole surface really sits on this one file
  ok('createWrapper is re-exported', typeof createWrapper === 'function');
  ok('createStreamHub is re-exported', typeof createStreamHub === 'function');
  ok('startWrapper is re-exported', typeof startWrapper === 'function');
  ok('createSystemWatch is re-exported', typeof createSystemWatch === 'function');
  ok('createModule is here', typeof createModule === 'function');
  ok('startModule is here', typeof startModule === 'function');

  // 2. createModule: a REAL child runs inside the host thread — no port
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwm-'));
  const m = createModule({ streamDir: path.join(dir, 'streams'), graceMs: 500 });
  const rec = m.wrapper.launch({
    name: 'embed-check',
    command: process.execPath,
    args: ['-e', "console.log('embed-ok')"],
  });
  await m.wrapper.awaitExit(rec.id, 15000);
  const captured = m.wrapper.output(rec.id).text;
  ok('createModule runs a real child', captured.includes('embed-ok'), captured);
  const lifeFile = m.wrapper.get(rec.id)?.streamFile;
  ok(
    'one life = one file — the file is the ground truth',
    Boolean(lifeFile) && fs.readFileSync(lifeFile, 'utf8').includes('embed-ok'),
    String(lifeFile),
  );

  // 2b. the MCP registry — the agent face, ready for Api_Root (the first precedent)
  ok('createModule carries the mcp registry', typeof m.registry?.list === 'function' && typeof m.registry?.call === 'function');
  const tools = m.registry.list();
  ok('the registry advertises the whole tool table', tools.length >= 13, tools.map((t) => t.name).join(','));
  const healthCall = await m.registry.call('pw_health');
  ok('the registry call hand runs a real tool', healthCall.content[0].text.length > 10);

  await m.wrapper.shutdown(true);

  // 3. startModule: its own little door on a REAL ephemeral port
  const s = await startModule({
    port: 0,
    streamDir: path.join(dir, 'streams2'),
    registryFile: path.join(dir, 'data.yaml'),
  });
  ok('startModule binds a real port', Number.isInteger(s.port) && s.port > 0, `${s.port} ${s.url}`);
  const health = await (await fetch(s.url + '/health')).json();
  ok('the door answers /health', Boolean(health) && health.ok === true, JSON.stringify(health).slice(0, 120));
  await s.stop();
  let closed = false;
  try {
    await fetch(s.url + '/health');
  } catch {
    closed = true;
  }
  ok('the door closes on stop', closed);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[ProcessWrapper_module] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log(failed.join('\n'));
    process.exitCode = 1;
  }
}

// Run the check when this file is executed directly (`node ProcessWrapper_module.js`);
// a host thread that IMPORTS it only gets the surface.
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  await runTests();
  // Windows/undici: let the sockets drain; force the door only if something lingers.
  setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
}
