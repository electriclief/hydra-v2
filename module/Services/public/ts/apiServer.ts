/**
 * @module apiServer
 * @description The HTTP face: /health · /api/services (the listing) · /api/services/:name
 *              (the whole definition) · /api/services/:name/ad and /:name/inputs (the
 *              maker's two pages as text/html) · POST /api/services/reload · /api/services/validate · the static
 *              GUI at /, and the MCP mount at /mcp. Dependency-free (node:http); an optional
 *              shared token guards /api/* and /mcp.
 * @intent One implementation, three faces (page · API · agent). Errors are always
 *         {error:{code,message}} with a real code; static files are not actions and are
 *         served without the token. Reserved words under /api/services/: "reload"
 *         (POST) and "validate" — a service cannot shadow them.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceCatalog } from './serviceCatalog.js';
import { buildManifest, lastSyncMark, resolveInRoot, syncFrom } from './shelf.js';
import { createServiceMcpRegistry } from './mcpTools.js';
import { createMcpServer, type McpServer } from './mcpServer.js';
import { serveStatic } from './staticFiles.js';

// --- Interface Definitions ---

/** The node this shelf belongs to, read the same way every other module reads it. */
function nodeRefOf(root: string): string {
  for (const rel of ['Core/data/node.json', 'Menu/data/node.json']) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, 'module', rel), 'utf8')) as { ref?: unknown };
      if (typeof parsed.ref === 'string' && parsed.ref.trim()) return parsed.ref.trim().toLowerCase();
    } catch {
      /* next */
    }
  }
  return 'node';
}

async function postJson(url: string, body: unknown, timeoutMs = 1200): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The metadata note a pull leaves behind, so every screen can see which revision this node carries. */
async function noteShelf(root: string, note: Record<string, unknown>): Promise<void> {
  const stateUrl = process.env.SERVICES_STATE_URL ?? 'http://127.0.0.1:8127';
  await postJson(`${stateUrl}/api/state/register`, { name: `node.${nodeRefOf(root)}.shelf`, content: note });
}

/** Every happening goes through the Event_Handler; the palette declares what may be fired. */
async function fireEvent(name: string, payload: Record<string, unknown>): Promise<void> {
  const eventUrl = process.env.SERVICES_EVENT_URL ?? 'http://127.0.0.1:8126';
  await postJson(`${eventUrl}/api/events/trigger`, { name, payload, source: 'system' });
}

export interface ApiServerOptions {
  catalog: ServiceCatalog;
  /** Port to listen on (default 8128; 0 asks the OS). */
  port?: number;
  /** Bind interface (default 127.0.0.1 — local unless said otherwise). */
  host?: string;
  /** Shared secret; when set, /api/* and /mcp need `x-services-token` or `?token=`. */
  token?: string | null;
  /** Folder served at the root — the GUI (default: <cwd>/public). */
  publicDir?: string;
  /** Serve the MCP endpoint at /mcp (default true). */
  enableMcp?: boolean;
  /**
   * The shelf root this instance can report and update. Absent means the shelf routes answer 501 rather than
   * pretending - a services instance with no shelf is a legitimate way to run the catalog alone.
   */
  shelfRoot?: string;
  /** A human label carried in the manifest (a date, a name). Never used for comparison. */
  shelfLabel?: string;
}

export interface ApiServer {
  server: http.Server;
  /** The real bound URL (port resolved when 0 was asked for). */
  url: string;
  port: number;
  close(): Promise<void>;
}

// --- Function Definitions ---

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
  res.end(html);
}

function readBody(req: IncomingMessage, capBytes = 1_048_576): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on('data', (buf: Buffer) => {
      size += buf.length;
      if (size > capBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      parts.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const catalog = options.catalog;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), 'public');
  // The shelf is optional on purpose: a catalog can run without one. When present it is what /api/shelf reports
  // and what /api/shelf/sync pulls into - and it is always an absolute path, never a relative one that resolves
  // against whatever cwd the shell happened to have.
  const shelfRoot = options.shelfRoot ? path.resolve(options.shelfRoot) : null;
  const mcp: McpServer | null = options.enableMcp === false ? null : createMcpServer({ registry: createServiceMcpRegistry(catalog, { shelfRoot: options.shelfRoot }) });

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    if (!token) return true;
    const header = req.headers['x-services-token'];
    if (typeof header === 'string' && header === token) return true;
    return url.searchParams.get('token') === token;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? 'GET';

    const guarded = pathName === '/mcp' || pathName.startsWith('/api/');
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, 'unauthorized', 'x-services-token header or ?token= is required');
      return;
    }

    if (pathName === '/mcp' && mcp) {
      await mcp.handle(req, res);
      return;
    }

    if (pathName === '/health' && method === 'GET') {
      const entries = catalog.entries();
      sendJson(res, 200, { ok: true, module: 'services', dir: catalog.dir, services: entries.filter((e) => e.ok).length, refused: entries.filter((e) => !e.ok).length });
      return;
    }

    if (pathName === '/api/services' && method === 'GET') {
      const filter = url.searchParams.get('filter') ?? undefined;
      sendJson(res, 200, { ok: true, dir: catalog.dir, services: catalog.list(filter) });
      return;
    }

    if (pathName === '/api/services/reload' && method === 'POST') {
      await readBody(req).catch(() => '');
      const entries = catalog.reload();
      sendJson(res, 200, {
        ok: true,
        count: entries.length,
        refused: catalog.refusals().map((entry) => ({ name: entry.name, file: entry.file, errors: entry.errors })),
      });
      return;
    }

    if (pathName === '/api/services/validate' && method === 'GET') {
      const reports = catalog.entries().map((entry) => ({ name: entry.name, file: entry.file, ok: entry.ok, errors: entry.errors, warnings: entry.warnings }));
      sendJson(res, 200, { ok: reports.every((r) => r.ok), reports });
      return;
    }

    if ((pathName === '/api/shelf' || pathName === '/api/shelf/manifest' || pathName === '/api/shelf/file') && method === 'GET') {
      if (!shelfRoot) {
        sendError(res, 501, 'no_shelf', 'this instance carries no shelf root - nothing to report');
        return;
      }
      if (pathName === '/api/shelf') {
        const m = buildManifest(shelfRoot, options.shelfLabel ?? '');
        sendJson(res, 200, {
          ok: true,
          rev: m.rev,
          label: m.label,
          generatedAt: m.generatedAt,
          files: m.files.length,
          bytes: m.bytes,
          lastSync: lastSyncMark(shelfRoot),
        });
        return;
      }
      if (pathName === '/api/shelf/manifest') {
        // the whole truth: every in-scope file with its size and hash, so a peer can diff without trusting a count
        sendJson(res, 200, buildManifest(shelfRoot, options.shelfLabel ?? ''));
        return;
      }
      const rel = url.searchParams.get('path') ?? '';
      const abs = resolveInRoot(shelfRoot, rel);
      if (!abs || !fs.existsSync(abs)) {
        sendError(res, 404, 'no_such_file', `not in this shelf: ${rel}`);
        return;
      }
      const buf = fs.readFileSync(abs);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(buf.length), 'cache-control': 'no-store' });
      res.end(buf);
      return;
    }

    if (pathName === '/api/shelf/sync' && method === 'POST') {
      if (!shelfRoot) {
        sendError(res, 501, 'no_shelf', 'this instance carries no shelf root - nothing to update');
        return;
      }
      let body: { url?: unknown; apply?: unknown; only?: unknown };
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch (err) {
        sendError(res, 400, 'bad_json', err instanceof Error ? err.message : String(err));
        return;
      }
      const peer = typeof body.url === 'string' ? body.url.trim() : '';
      if (!peer) {
        sendError(res, 400, 'no_peer', 'POST {url, apply} — the peer whose shelf you want to compare against');
        return;
      }
      try {
        const out = await syncFrom(shelfRoot, peer, {
          apply: body.apply === true,
          only: Array.isArray(body.only) ? body.only.filter((p): p is string => typeof p === 'string') : undefined,
        });
        // What crossed the wire is noted in State as metadata - rev, counts, who pulled what - and the happening
        // goes to the Event_Handler. The files themselves never enter an entry.
        if (out.applied) {
          const manifest = buildManifest(shelfRoot, options.shelfLabel ?? '');
          void noteShelf(shelfRoot, {
            rev: manifest.rev,
            files: manifest.files.length,
            bytes: manifest.bytes,
            pulledFrom: out.peer,
            at: new Date().toISOString(),
            fetched: out.fetched.length,
            refused: out.refused.length,
          });
          void fireEvent('shelf.pulled', { ref: nodeRefOf(shelfRoot), peerRev: out.peerRev, fetched: out.fetched.length, refused: out.refused.length });
        }
        for (const bad of out.refused) {
          void fireEvent('shelf.refused', { ref: nodeRefOf(shelfRoot), path: bad.path, why: bad.why });
        }
        sendJson(res, 200, { ok: true, ...out });
      } catch (err) {
        // the peer was unreachable or inconsistent: say which, never a half-applied yes
        sendError(res, 502, 'sync_failed', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (pathName.startsWith('/api/services/') && method === 'GET') {
      const rest = pathName.slice('/api/services/'.length);
      const half = (['ad', 'inputs'] as const).find((h) => rest.endsWith('/' + h));
      if (half) {
        let name: string;
        try {
          name = decodeURIComponent(rest.slice(0, rest.length - half.length - 1));
        } catch {
          sendError(res, 400, 'bad_name', 'the name is not a valid URI component');
          return;
        }
        const html = half === 'ad' ? catalog.ad(name) : catalog.inputs(name);
        if (html === null) {
          sendError(res, 404, 'no_such_service', `no ${half} page for: ${name} — GET /api/services for the listing`);
          return;
        }
        sendHtml(res, 200, html);
        return;
      }
      let name: string;
      try {
        name = decodeURIComponent(rest);
      } catch {
        sendError(res, 400, 'bad_name', 'the name is not a valid URI component');
        return;
      }
      const entry = catalog.get(name);
      if (!entry) {
        sendError(res, 404, 'no_such_service', `no such service: ${name} — GET /api/services for the listing`);
        return;
      }
      sendJson(res, 200, { ok: true, name: entry.name, file: entry.file, warnings: entry.warnings, service: entry.definition });
      return;
    }

    // POST /api/services/:name/apply — THE ACTION RUNNER, for the one thing a service page must be able to DO rather
    // than describe: enter a choice. A service that declares `apply: { script, flags… }` gets a button on its page that
    // runs that script on this node and returns the script's own words. Everything else stays read-only, which is why
    // this is not a general command endpoint: the script is named by the service file, never by the request, so a
    // caller can pass arguments but cannot choose what runs.
    if (method === 'POST' && pathName.startsWith('/api/services/') && pathName.endsWith('/apply')) {
      const rawName = pathName.slice('/api/services/'.length, -'/apply'.length);
      let applyName: string;
      try {
        applyName = decodeURIComponent(rawName);
      } catch {
        sendError(res, 400, 'bad_name', 'the name is not a valid URI component');
        return;
      }
      const entry = catalog.get(applyName);
      if (!entry) {
        sendError(res, 404, 'no_such_service', `no such service: ${applyName} — GET /api/services for the listing`);
        return;
      }
      const decl = (entry.definition as { apply?: Record<string, string> } | null)?.apply;
      if (!decl || !decl.script) {
        sendError(res, 400, 'no_apply', `${applyName} declares no apply script — it can be read but not switched from here`);
        return;
      }
      let body: { backend?: string; host?: string; model?: string; probe?: boolean } = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body;
      } catch {
        sendError(res, 400, 'bad_json', 'body must be JSON');
        return;
      }
      // The repo root is derived from the service FILE, not from an env-relative guess: entry.file is
      // <root>/module/Services/services/<name>.js on every node, so three levels up is the root wherever it lives.
      const root = entry.file ? path.resolve(path.dirname(entry.file), '..', '..', '..') : process.cwd();
      const script = path.join(root, decl.script);
      if (!fs.existsSync(script)) {
        sendError(res, 500, 'no_script', `the service names an apply script that is not on disk: ${script}`);
        return;
      }
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
      if (body.backend) args.push(decl.backendFlag ?? '-Backend', String(body.backend));
      if (body.host) args.push(decl.hostFlag ?? '-Host', String(body.host));
      if (body.model) args.push(decl.modelFlag ?? '-Model', String(body.model));
      if (body.probe !== false && decl.probeFlag) args.push(decl.probeFlag);

      const shell = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
      const started = Date.now();
      const child = spawn(shell, args, { cwd: root, windowsHide: true });
      let output = '';
      child.stdout?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
      });
      child.stderr?.on('data', (c: Buffer) => {
        output += c.toString('utf8');
      });
      // a switch can wait for a model load and a probe; ten minutes is the ceiling, and the kill is the reason the
      // page never hangs forever behind a brain that will not answer
      const killer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }, 600_000);
      child.on('error', (err: Error) => {
        clearTimeout(killer);
        sendError(res, 502, 'apply_failed', err.message);
      });
      child.on('close', (code: number | null) => {
        clearTimeout(killer);
        void fireEvent('service.applied', { service: applyName, backend: body.backend ?? null, code });
        sendJson(res, code === 0 ? 200 : 502, {
          ok: code === 0,
          service: applyName,
          backend: body.backend ?? null,
          ms: Date.now() - started,
          output: output.trim(),
        });
      });
      return;
    }

    if (method === 'GET') {
      serveStatic(req, res, { root: publicDir });
      return;
    }

    sendError(res, 404, 'no_route', `no route for ${method} ${pathName}`);
  };

  const server = http.createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      try {
        sendError(res, 500, 'internal', err instanceof Error ? err.message : String(err));
      } catch {
        /* already gone */
      }
    });
  });

  return {
    server,
    url: `http://${host}`, // real port comes from startApiServer
    port: options.port ?? 8128,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/** createApiServer + listen, resolving once the port is really bound. */
export async function startApiServer(options: ApiServerOptions): Promise<ApiServer & { stop(): Promise<void> }> {
  const api = createApiServer(options);
  await new Promise<void>((resolve, reject) => {
    api.server.once('error', reject);
    api.server.listen(options.port ?? 8128, options.host ?? '127.0.0.1', () => resolve());
  });
  const addr = api.server.address() as AddressInfo | null;
  const boundPort = addr ? addr.port : (options.port ?? 8128);

  // A fact about this node must survive a restart. State is an in-memory bulletin board - durable by nobody's
  // effort - so a branch published only when something changes (the shelf revision) is gone the moment this door
  // comes back, and readers are told "no shelf" while 448 files sit on disk. Republish at boot, computed from disk.
  if (options.shelfRoot) {
    void (async () => {
      try {
        const manifest = await buildManifest(options.shelfRoot as string);
        const last = lastSyncMark(options.shelfRoot as string) as
          | { pulledFrom?: string; fetched?: number; refused?: unknown[]; at?: string }
          | null;
        await noteShelf(options.shelfRoot as string, {
          rev: manifest.rev,
          files: manifest.files.length,
          bytes: manifest.bytes,
          pulledFrom: last?.pulledFrom ?? null,
          at: new Date().toISOString(),
          fetched: last?.fetched ?? 0,
          refused: Array.isArray(last?.refused) ? last.refused.length : 0,
          source: 'boot',
        });
      } catch {
        // a node that cannot compute its own revision says nothing rather than something wrong
      }
    })();
  }

  return {
    ...api,
    port: boundPort,
    url: `http://${options.host ?? '127.0.0.1'}:${boundPort}`,
    stop: api.close,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { createServiceCatalog } = await import('./serviceCatalog.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const jsonOf = async <T>(res: Response) => (await res.json()) as T;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-api-'));
  fs.writeFileSync(
    path.join(dir, 'demo.js'),
    'module.exports = { name: "demo", advert: { what: "a demo", karma: 3 }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>the demo page</h1>", inputs: "<h1>in</h1>" } };',
  );
  const catalog = createServiceCatalog({ dir });

  const api = await startApiServer({ catalog, port: 0, publicDir: path.join(process.cwd(), 'public') });
  const base = api.url;

  const health = await jsonOf<{ ok: boolean; module: string; services: number }>(await fetch(base + '/health'));
  ok('health answers', health.ok === true && health.module === 'services' && health.services === 1, JSON.stringify(health));

  const listing = await jsonOf<{ count?: never; services: Array<{ name: string; modes: string[] }> }>(await fetch(base + '/api/services'));
  ok('the listing reads over HTTP', listing.services.length === 1 && listing.services[0].name === 'demo' && listing.services[0].modes.join(',') === 'cpu');

  const one = await jsonOf<{ ok: boolean; service: { advert: { karma: number } } }>(await fetch(base + '/api/services/demo'));
  ok('one definition reads over HTTP', one.ok === true && one.service.advert.karma === 3);

  const missing = await fetch(base + '/api/services/nope');
  ok('an unknown service answers 404 no_such_service', missing.status === 404 && (await jsonOf<{ error: { code: string } }>(missing)).error.code === 'no_such_service');

  const ad = await fetch(base + '/api/services/demo/ad');
  const adText = await ad.text();
  ok('the ad page serves as text/html', ad.status === 200 && ad.headers.get('content-type')?.startsWith('text/html') === true && adText.includes('the demo page'));
  const inPage = await fetch(base + '/api/services/demo/inputs');
  ok('the inputs page serves as text/html', inPage.status === 200 && (await inPage.text()).includes('<h1>in</h1>'));

  const pageMiss = await fetch(base + '/api/services/nope/ad');
  ok('an unknown page answers 404', pageMiss.status === 404);

  const validate = await jsonOf<{ ok: boolean; reports: Array<{ name: string }> }>(await fetch(base + '/api/services/validate'));
  ok('validate reports the catalog', validate.ok === true && validate.reports[0].name === 'demo');

  fs.writeFileSync(path.join(dir, 'two.js'), 'module.exports = { name: "two", advert: { what: "second" }, provider: { name: "demo app" }, pages: { ad: "<h1>two</h1>", inputs: "<h1>in</h1>" } };');
  const reloaded = await fetch(base + '/api/services/reload', { method: 'POST' });
  const reloadBody = await jsonOf<{ count: number }>(reloaded);
  ok('reload picks up a new file over HTTP', reloadBody.count === 2);

  // the token guard
  const guarded = await startApiServer({ catalog, port: 0, token: 'secret', publicDir: path.join(process.cwd(), 'public') });
  ok('a guarded api refuses without the token', (await fetch(guarded.url + '/api/services')).status === 401);
  ok('a guarded api accepts the header', (await fetch(guarded.url + '/api/services', { headers: { 'x-services-token': 'secret' } })).status === 200);
  await guarded.stop();

  // MCP is mounted at /mcp on this same port
  const init = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  const initBody = await jsonOf<{ result?: { serverInfo?: { name: string } } }>(init);
  ok('the MCP door answers on the same port', initBody.result?.serverInfo?.name === 'services');

  await api.stop();
  let closed = false;
  try {
    await fetch(base + '/health');
  } catch {
    closed = true;
  }
  ok('stop closes the door', closed);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[apiServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
