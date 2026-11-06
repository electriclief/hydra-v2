/**
 * @module Services_module
 * @description THE ONE FILE another code thread loads — the embed entry. It re-exports the
 *              whole public surface and adds the two host hands: createModule() (the
 *              pieces, in the host thread, no port) and startModule() (this module's own
 *              little door on a port; port 0 = OS-assigned). Keep it thin — never a
 *              second implementation.
 * @intent House standard (2026-09-16, folder dialect): folder `Services` →
 *         `Services_module.js`. A host (Api_Root, later) loads THIS file; `npm start`
 *         (main.js) stands the module up as its own local thread instead. NOT re-exported:
 *         main() — it attaches signal handlers to whoever calls it.
 */

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServiceCatalog } from './public/js/serviceCatalog.js';
import { loadServiceFile, loadServiceText, findRefusedValue, CODE_TOKENS } from './public/js/serviceFile.js';
import { validateService, summarizeService } from './public/js/serviceSchema.js';
import { buildTools, createServiceMcpRegistry, ToolRefusal } from './public/js/mcpTools.js';
import { createMcpServer } from './public/js/mcpServer.js';
import { createApiServer, startApiServer } from './public/js/apiServer.js';
import { serveStatic, contentTypeFor, resolveInside } from './public/js/staticFiles.js';
import { createServicesClient, ServicesError } from './public/js/client.js';
import { mount as mountGui, GUI_IDS } from './public/js/browser/gui.js';

export {
  // the object itself
  validateService,
  summarizeService,
  // reading one service file — as DATA, never executed
  loadServiceFile,
  loadServiceText,
  findRefusedValue,
  CODE_TOKENS,
  // the catalog — the folder IS the catalog
  createServiceCatalog,
  // the agent face as a registry (Api_Root will mount the SAME object)
  buildTools,
  createServiceMcpRegistry,
  ToolRefusal,
  // the faces
  createMcpServer,
  createApiServer,
  startApiServer,
  serveStatic,
  contentTypeFor,
  resolveInside,
  // the client + the page
  createServicesClient,
  ServicesError,
  mountGui,
  GUI_IDS,
};

/** The pieces, in a host thread — no port, no banner. */
export function createModule(options = {}) {
  const dir = path.resolve(options.dir ?? './services');
  const catalog = createServiceCatalog({ dir });
  return { catalog, registry: createServiceMcpRegistry(catalog), dir };
}

/** This module's own little door on a port (port 0 = OS-assigned). */
export async function startModule(options = {}) {
  const dir = path.resolve(options.dir ?? './services');
  const catalog = createServiceCatalog({ dir });
  const api = await startApiServer({
    catalog,
    port: options.port ?? 8128,
    host: options.host ?? '127.0.0.1',
    token: options.token ?? null,
    publicDir: options.publicDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'public'),
  });
  return {
    catalog,
    registry: createServiceMcpRegistry(catalog),
    api,
    url: api.url,
    port: api.port,
    dir,
    stop: () => api.stop(),
  };
}

// --- Direct-run self-check: node Services_module.js ---
// Drives the REAL thing — a real service file, a real port — and sets process.exitCode
// (never process.exit). Same spirit as every module's runTests, at the entry level.

async function selfCheck() {
  const fs = await import('node:fs');
  const os = await import('node:os');
  let failures = 0;
  const check = (label, cond) => {
    console.log(`${cond ? 'pass' : 'FAIL'} ${label}`);
    if (!cond) failures++;
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-entry-'));
  fs.writeFileSync(
    path.join(dir, 'demo.js'),
    'module.exports = { name: "demo", advert: { what: "a demo", karma: 1 }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>the demo page</h1>", inputs: "<h1>in</h1>" } };'
  );

  const pieces = createModule({ dir });
  check('createModule: the catalog lists the file', pieces.catalog.list().length === 1 && pieces.catalog.get('demo') !== null);
  check('createModule: the registry advertises six tools', pieces.registry.list().length === 6);

  const running = await startModule({ dir, port: 0 });
  const health = await (await fetch(running.url + '/health')).json();
  check('startModule: health answers', health.ok === true && health.services === 1);
  const listing = await (await fetch(running.url + '/api/services')).json();
  check('startModule: the listing answers', Array.isArray(listing.services) && listing.services[0].name === 'demo');
  const ad = await (await fetch(running.url + '/api/services/demo/ad')).text();
  check('startModule: the ad page answers', ad.includes('the demo page'));
  const inPage = await (await fetch(running.url + '/api/services/demo/inputs')).text();
  check('startModule: the inputs page answers', inPage.includes('<h1>in</h1>'));
  const init = await (
    await fetch(running.url + '/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
  ).json();
  check('startModule: the agent door answers', init.result?.serverInfo?.name === 'services');
  await running.stop();
  let closed = false;
  try {
    await fetch(running.url + '/health');
  } catch {
    closed = true;
  }
  check('stop closes the door', closed);

  console.log(failures === 0 ? '[Services_module] self-check GREEN' : `[Services_module] ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void selfCheck();
}
