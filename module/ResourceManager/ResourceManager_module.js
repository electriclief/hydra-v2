/**
 * @module ResourceManager_module
 * @description THE ONE FILE another code thread loads — the embed entry. It re-exports the
 *              whole public surface and adds the two host hands: createModule() (the
 *              pieces, in the host thread, no port) and startModule() (this module's own
 *              little door on a port; port 0 = OS-assigned). Keep it thin — never a
 *              second implementation.
 * @intent House standard (2026-09-16, folder dialect): folder `ResourceManager` →
 *         `ResourceManager_module.js`. A host (Api_Root, later) loads THIS file; `npm start`
 *         (main.js) stands the module up as its own local thread instead. NOT re-exported:
 *         main() — it attaches signal handlers to whoever calls it.
 */

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createBookingStore } from './public/js/bookingStore.js';
import { collectReads, loadShareList } from './public/js/resourceRead.js';
import { validateBookRequest, normalizePath, pathsCollide, summarizeBooking, totalsOf } from './public/js/resourceSchema.js';
import { buildTools, createRmMcpRegistry, ToolRefusal } from './public/js/mcpTools.js';
import { createMcpServer } from './public/js/mcpServer.js';
import { createApiServer, startApiServer } from './public/js/apiServer.js';
import { serveStatic, contentTypeFor, resolveInside } from './public/js/staticFiles.js';
import { createRmClient, RmError } from './public/js/client.js';
import { mount as mountGui, GUI_IDS } from './public/js/browser/gui.js';

export {
  // the vocabulary + its two bits of bookkeeping
  validateBookRequest,
  normalizePath,
  pathsCollide,
  summarizeBooking,
  totalsOf,
  // the machine reader (one PowerShell pass; vram truth; the observed row)
  collectReads,
  loadShareList,
  // the register
  createBookingStore,
  // the agent face as a registry (Api_Root will mount the SAME object)
  buildTools,
  createRmMcpRegistry,
  ToolRefusal,
  // the faces
  createMcpServer,
  createApiServer,
  startApiServer,
  serveStatic,
  contentTypeFor,
  resolveInside,
  // the client + the page
  createRmClient,
  RmError,
  mountGui,
  GUI_IDS,
};

/** The pieces, in a host thread — no port, no banner. */
export function createModule(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? './data');
  const sharesFile = options.sharesFile ?? path.join(dataDir, 'shares.json');
  const collect = { shares: loadShareList(sharesFile) };
  const reads = options.reads ?? (() => collectReads(collect));
  const store = createBookingStore({ dataDir, reads });
  return { store, reads, registry: createRmMcpRegistry(store, reads), dataDir, sharesFile };
}

/** This module's own little door on a port (port 0 = OS-assigned). */
export async function startModule(options = {}) {
  const dataDir = path.resolve(options.dataDir ?? './data');
  const sharesFile = options.sharesFile ?? path.join(dataDir, 'shares.json');
  const collect = { shares: loadShareList(sharesFile) };
  const reads = options.reads ?? (() => collectReads(collect));
  const refreshReads = options.reads ?? (() => collectReads({ ...collect, force: true }));
  const store = createBookingStore({ dataDir, reads });
  const api = await startApiServer({
    store,
    reads,
    refreshReads,
    port: options.port ?? 8129,
    host: options.host ?? '127.0.0.1',
    token: options.token ?? null,
    publicDir: options.publicDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'public'),
  });
  return {
    store,
    reads,
    registry: createRmMcpRegistry(store, reads),
    api,
    url: api.url,
    port: api.port,
    dataDir,
    stop: () => api.stop(),
  };
}

// --- Direct-run self-check: node ResourceManager_module.js ---
// Drives the REAL thing — a real store, a real port — and sets process.exitCode
// (never process.exit). Same spirit as every module's runTests, at the entry level.

async function selfCheck() {
  const fs = await import('node:fs');
  const os = await import('node:os');
  let failures = 0;
  const check = (label, cond) => {
    console.log(`${cond ? 'pass' : 'FAIL'} ${label}`);
    if (!cond) failures++;
  };

  const fakeReads = {
    collectedAt: new Date().toISOString(),
    node: 'entry-test',
    platform: 'win32',
    cpu: { model: 'fake', cores: 8, loadPct: 1 },
    ram: { totalMb: 16000, freeMb: 9000 },
    gpus: [{ name: 'RX 6800', vramMb: 16384, vramSource: 'registry', memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [],
    notes: [],
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-entry-'));

  const pieces = createModule({ dataDir: dir, reads: () => fakeReads });
  check('createModule: the registry advertises five tools', pieces.registry.list().length === 5);
  const booked = await pieces.store.book({ service: 'demo', gpu: 'RX 6800', cores: 2 });
  check('createModule: the register books for real', booked.ok === true && booked.booking.id.startsWith('bk-'));
  const refused = await pieces.store.book({ service: 'other', gpu: 'RX 6800' });
  check('createModule: double booking is refused with the holder', refused.ok === false && refused.error.blockers[0].heldBy?.service === 'demo');

  const running = await startModule({ dataDir: dir, reads: () => fakeReads, port: 0 });
  const health = await (await fetch(running.url + '/health')).json();
  check('startModule: health answers', health.ok === true && health.bookings === 1);
  const poll = await (await fetch(running.url + '/api/resources')).json();
  check('startModule: the poll answers', poll.ok === true && poll.resources.cpu.cores === 8 && poll.bookings.length === 1);
  const bookViaHttp = await (
    await fetch(running.url + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'via-http', cores: 1 }) })
  ).json();
  check('startModule: book answers over HTTP', bookViaHttp.ok === true && bookViaHttp.booking.service === 'via-http');
  const init = await (
    await fetch(running.url + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
  ).json();
  check('startModule: the agent door answers', init.result?.serverInfo?.name === 'resource-manager');
  await running.stop();
  let closed = false;
  try {
    await fetch(running.url + '/health');
  } catch {
    closed = true;
  }
  check('stop closes the door', closed);

  console.log(failures === 0 ? '[ResourceManager_module] self-check GREEN' : `[ResourceManager_module] ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void selfCheck();
}
