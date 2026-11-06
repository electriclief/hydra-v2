/**
 * @module apiServer
 * @description The HTTP face: /health · GET /api/resources (THE POLL — pure read: the
 *              machine + every current booking) · POST /api/resources/refresh · GET
 *              /api/bookings[/:id] · POST /api/book (the ONE write — lands whole or is
 *              refused whole) · POST /api/bookings/:id/pop · /clear · the static GUI at /,
 *              and the MCP mount at /mcp. Dependency-free (node:http); an optional shared
 *              token guards /api/* and /mcp.
 * @intent One implementation, three faces (page · API · agent). Errors are always
 *         {error:{code,message}} with a real code; a book REFUSAL is not an error — it
 *         answers 200 with ok:false (the wait info). Static files are not actions and are
 *         served without the token.
 */

import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BookingStore, ReadsFn } from './bookingStore.js';
import { createRmMcpRegistry } from './mcpTools.js';
import { createMcpServer, type McpServer } from './mcpServer.js';
import { serveStatic } from './staticFiles.js';

// --- Interface Definitions ---

export interface ApiServerOptions {
  store: BookingStore;
  /** The poll this API serves (default: whatever the store reads with). */
  reads: ReadsFn;
  /** A forced re-read for POST /api/resources/refresh (default: reads). */
  refreshReads?: ReadsFn;
  /** Port to listen on (default 8129; 0 asks the OS). */
  port?: number;
  /** Bind interface (default 127.0.0.1 — local unless said otherwise). */
  host?: string;
  /** Shared secret; when set, /api/* and /mcp need `x-rm-token` or `?token=`. */
  token?: string | null;
  /** Folder served at the root — the GUI (default: <cwd>/public). */
  publicDir?: string;
  /** Serve the MCP endpoint at /mcp (default true). */
  enableMcp?: boolean;
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
  const store = options.store;
  const reads = options.reads;
  const refreshReads = options.refreshReads ?? options.reads;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), 'public');
  const mcp: McpServer | null = options.enableMcp === false ? null : createMcpServer({ registry: createRmMcpRegistry(store, reads) });

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    if (!token) return true;
    const header = req.headers['x-rm-token'];
    if (typeof header === 'string' && header === token) return true;
    return url.searchParams.get('token') === token;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? 'GET';

    const guarded = pathName === '/mcp' || pathName.startsWith('/api/');
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, 'unauthorized', 'x-rm-token header or ?token= is required');
      return;
    }

    if (pathName === '/mcp' && mcp) {
      await mcp.handle(req, res);
      return;
    }

    if (pathName === '/health' && method === 'GET') {
      sendJson(res, 200, { ok: true, module: 'resource-manager', bookings: store.active().length, dataFile: store.dataFile });
      return;
    }

    if (pathName === '/api/resources' && method === 'GET') {
      const current = await reads();
      sendJson(res, 200, { ok: true, resources: current, bookings: store.active() });
      return;
    }

    if (pathName === '/api/resources/refresh' && method === 'POST') {
      await readBody(req).catch(() => '');
      const current = await refreshReads();
      sendJson(res, 200, { ok: true, resources: current, bookings: store.active() });
      return;
    }

    if (pathName === '/api/bookings' && method === 'GET') {
      const includeEnded = ['ended', 'true', '1'].includes(url.searchParams.get('include') ?? '') || url.searchParams.get('include_ended') === 'true';
      sendJson(res, 200, { ok: true, active: store.active(), ...(includeEnded ? { ended: store.ended() } : {}) });
      return;
    }

    if (pathName.startsWith('/api/bookings/') && method === 'POST') {
      const rest = pathName.slice('/api/bookings/'.length);
      if (rest.endsWith('/pop') || rest.endsWith('/clear')) {
        const action = rest.endsWith('/pop') ? 'pop' : 'clear';
        let id: string;
        try {
          id = decodeURIComponent(rest.slice(0, rest.length - (action.length + 1)));
        } catch {
          sendError(res, 400, 'bad_id', 'the booking id is not a valid URI component');
          return;
        }
        await readBody(req).catch(() => '');
        const ended = action === 'pop' ? store.pop(id) : store.clear(id);
        if (!ended) {
          sendError(res, 404, 'no_such_booking', `no such booking: ${id} — GET /api/bookings for the register`);
          return;
        }
        sendJson(res, 200, { ok: true, booking: ended });
        return;
      }
      sendError(res, 404, 'no_route', `no route for ${method} ${pathName}`);
      return;
    }

    if (pathName.startsWith('/api/bookings/') && method === 'GET') {
      let id: string;
      try {
        id = decodeURIComponent(pathName.slice('/api/bookings/'.length));
      } catch {
        sendError(res, 400, 'bad_id', 'the booking id is not a valid URI component');
        return;
      }
      const booking = store.get(id);
      if (!booking) {
        sendError(res, 404, 'no_such_booking', `no such booking: ${id} — GET /api/bookings for the register`);
        return;
      }
      sendJson(res, 200, { ok: true, booking });
      return;
    }

    if (pathName === '/api/book' && method === 'POST') {
      let body = '';
      try {
        body = await readBody(req);
      } catch {
        sendError(res, 413, 'bad_json', 'body too large');
        return;
      }
      let parsed: unknown = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        sendError(res, 400, 'bad_json', 'the body must be JSON');
        return;
      }
      const outcome = await store.book(parsed);
      sendJson(res, 200, outcome);
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
    port: options.port ?? 8129,
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
    api.server.listen(options.port ?? 8129, options.host ?? '127.0.0.1', () => resolve());
  });
  const addr = api.server.address() as AddressInfo | null;
  const boundPort = addr ? addr.port : (options.port ?? 8129);
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
  const { createBookingStore } = await import('./bookingStore.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const jsonOf = async <T>(res: Response) => (await res.json()) as T;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-api-'));
  const fakeReads = {
    collectedAt: 'first',
    node: 'test-node',
    platform: 'win32',
    cpu: { model: 'fake', cores: 8, loadPct: 2 },
    ram: { totalMb: 16000, freeMb: 9000 },
    gpus: [{ name: 'RX 6800', vramMb: 16384, vramSource: 'registry' as const, memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [],
    notes: [],
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const api = await startApiServer({
    store,
    reads: () => fakeReads,
    refreshReads: () => ({ ...fakeReads, collectedAt: 'second' }),
    port: 0,
    publicDir: path.join(process.cwd(), 'public'),
  });
  const base = api.url;

  const health = await jsonOf<{ ok: boolean; module: string; bookings: number }>(await fetch(base + '/health'));
  ok('health answers', health.ok === true && health.module === 'resource-manager' && health.bookings === 0, JSON.stringify(health));

  const poll = await jsonOf<{ ok: boolean; resources: { cpu: { cores: number }; node: string }; bookings: unknown[] }>(await fetch(base + '/api/resources'));
  ok('the poll reads the machine + the register', poll.ok === true && poll.resources.cpu.cores === 8 && payloadEqual(poll.bookings, []));

  const bookRes = await fetch(base + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'image-gen', gpu: 'RX 6800', cores: 4, paths: ['C:/work/a'] }) });
  const bookBody = await jsonOf<{ ok: boolean; booking: { id: string } }>(bookRes);
  ok('book lands over HTTP', bookRes.status === 200 && bookBody.ok === true && bookBody.booking.id.startsWith('bk-'));

  const poll2 = await jsonOf<{ bookings: unknown[] }>(await fetch(base + '/api/resources'));
  ok('the poll shows the booking', poll2.bookings.length === 1);

  const refusedRes = await fetch(base + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'other', gpu: 'RX 6800' }) });
  const refusedBody = await jsonOf<{ ok: boolean; error: { code: string } }>(refusedRes);
  ok('a refusal answers 200 with ok:false (not an HTTP error)', refusedRes.status === 200 && refusedBody.ok === false && refusedBody.error.code === 'double_booked');

  const childRes = await fetch(base + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'agent-b', paths: ['C:/work/a/src'] }) });
  ok('a child path is refused over HTTP too', (await jsonOf<{ ok: boolean }>(childRes)).ok === false);

  const badJson = await fetch(base + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  ok('a broken body answers 400 bad_json', badJson.status === 400 && (await jsonOf<{ error: { code: string } }>(badJson)).error.code === 'bad_json');

  const list = await jsonOf<{ active: Array<{ id: string }> }>(await fetch(base + '/api/bookings'));
  ok('the register lists over HTTP', list.active.length === 1);

  const one = await jsonOf<{ ok: boolean; booking: { service: string } }>(await fetch(base + '/api/bookings/' + bookBody.booking.id));
  ok('one booking reads by id', one.ok === true && one.booking.service === 'image-gen');

  const refresh = await jsonOf<{ resources: { collectedAt: string } }>(await fetch(base + '/api/resources/refresh', { method: 'POST' }));
  ok('refresh forces a fresh read', refresh.resources.collectedAt === 'second');

  const pop = await jsonOf<{ ok: boolean; booking: { endReason: string } }>(await fetch(base + '/api/bookings/' + bookBody.booking.id + '/pop', { method: 'POST' }));
  ok('pop lifts the booking over HTTP', pop.ok === true && pop.booking.endReason === 'popped');

  const popAgain = await fetch(base + '/api/bookings/' + bookBody.booking.id + '/pop', { method: 'POST' });
  ok('popping twice answers 404 no_such_booking', popAgain.status === 404 && (await jsonOf<{ error: { code: string } }>(popAgain)).error.code === 'no_such_booking');

  const unknown = await fetch(base + '/api/nope');
  ok('an unknown api route answers 404 no_route', unknown.status === 404 && (await jsonOf<{ error: { code: string } }>(unknown)).error.code === 'no_route');

  const guarded = await startApiServer({ store, reads: () => fakeReads, port: 0, token: 'sek', publicDir: path.join(process.cwd(), 'public') });
  ok('a guarded register refuses without the token', (await fetch(guarded.url + '/api/resources')).status === 401);
  ok('a guarded register accepts the header', (await fetch(guarded.url + '/api/resources', { headers: { 'x-rm-token': 'sek' } })).status === 200);
  await guarded.stop();

  const init = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  const initBody = await jsonOf<{ result?: { serverInfo?: { name: string } } }>(init);
  ok('the MCP door answers on the same port', initBody.result?.serverInfo?.name === 'resource-manager');

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

function payloadEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// runTests();
