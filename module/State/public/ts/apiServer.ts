/**
 * @module apiServer
 * @description The HTTP face: /health · /api/state (the active set) · /api/state/pull ·
 *              /api/state/register · /api/state/drop · /api/state/stream (the live change
 *              feed), the static GUI at /, and the MCP mount at /mcp. Dependency-free
 *              (node:http); an optional shared token guards /api/* and /mcp.
 * @intent One implementation, three faces (page · API · agent). Errors are always
 *         {error:{code,message}} with a real code; static files are not actions and are
 *         served without the token. Over HTTP the standing is JSON only — liveness checks
 *         and pull recipes ride on in-process registrations, never the wire.
 */

import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { State } from './stateRegistry.js';
import { createMcpRegistry } from './mcpTools.js';
import { createMcpServer, type McpServer } from './mcpServer.js';
import { serveStatic } from './staticFiles.js';

// --- Interface Definitions ---

export interface ApiServerOptions {
  state: State;
  /** Port to listen on (default 8127; 0 asks the OS). */
  port?: number;
  /** Bind interface (default 127.0.0.1 — local unless said otherwise). */
  host?: string;
  /** Shared secret; when set, /api/* and /mcp need `x-state-token` or `?token=`. */
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

/** Marks arrive from the wire as whatever JSON says — keep numbers, pass the rest through. */
function readMarks(raw: string | null): Record<string, number | string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const marks: Record<string, number | string> = {};
    for (const [key, mark] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof mark === 'number' || typeof mark === 'string') marks[key] = mark;
    }
    return marks;
  } catch {
    return {};
  }
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const state = options.state;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), 'public');
  const mcp: McpServer | null = options.enableMcp === false ? null : createMcpServer({ registry: createMcpRegistry(state) });

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    if (!token) return true;
    const header = req.headers['x-state-token'];
    if (typeof header === 'string' && header === token) return true;
    return url.searchParams.get('token') === token;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? 'GET';

    const guarded = pathName === '/mcp' || pathName.startsWith('/api/');
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, 'unauthorized', 'x-state-token header or ?token= is required');
      return;
    }

    if (pathName === '/mcp' && mcp) {
      await mcp.handle(req, res);
      return;
    }

    if (pathName === '/health' && method === 'GET') {
      const summary = state.summary();
      sendJson(res, 200, { ok: true, module: 'state', entries: summary.entries, changes: summary.changes });
      return;
    }

    if (pathName === '/api/state' && method === 'GET') {
      const query = url.searchParams.get('q') ?? undefined;
      sendJson(res, 200, state.discover(query));
      return;
    }

    if (pathName === '/api/state/pull' && method === 'GET') {
      const name = url.searchParams.get('name') ?? '';
      if (!name) {
        sendError(res, 400, 'bad_json', 'pull needs a name: ?name=<entry>&marks=<json, optional>');
        return;
      }
      const answer = await state.pull(name, {
        marks: readMarks(url.searchParams.get('marks')),
        // on by default: asking THIS node's State for any path is the whole promise. ?follow=0 answers only from here.
        follow: url.searchParams.get('follow') !== '0',
        hops: Number(url.searchParams.get('hops') ?? 0) || 0,
        via: (url.searchParams.get('via') ?? '').split(',').map((v) => v.trim()).filter(Boolean),
      });
      if (!answer.ok) {
        if (answer.code === 'ambiguous') {
          sendError(res, 409, 'ambiguous', `ambiguous: ${answer.name} matches ${(answer.candidates ?? []).join(', ')} — extend the suffix until unique`);
        } else {
          // A TYPED ABSENCE CARRIES ITS REASON. Flattening every failure into `no_such_entry` made an app that had
          // exited look like a path nobody had registered — the caller could not tell `gone` from `absent` from
          // `timeout`, and every one of those needs a different response. The code stays 404; the typology rides along.
          sendJson(res, 404, {
            ok: false,
            error: { code: 'no_such_entry', message: `no such entry: ${answer.name} — GET /api/state for the active set` },
            name: answer.name,
            why: answer.why ?? 'absent',
            via: answer.via ?? [],
            hops: answer.hops ?? 0,
            ...(answer.source ? { source: answer.source } : {}),
          });
        }
        return;
      }
      sendJson(res, 200, answer);
      return;
    }

    if (pathName === '/api/state/register' && method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendError(res, 400, 'bad_json', 'body must be JSON: {name, content, serving?, render?, update?}');
        return;
      }
      const input = (body ?? {}) as { name?: unknown; content?: unknown; serving?: unknown; render?: unknown; update?: unknown };
      const name = typeof input.name === 'string' ? input.name : '';
      if (!name) {
        sendError(res, 400, 'bad_json', 'register needs a name: {name, content}');
        return;
      }
      if (input.content === undefined) {
        sendError(res, 400, 'bad_json', 'register needs content: {name, content}');
        return;
      }
      const serving = input.serving && typeof input.serving === 'object' && !Array.isArray(input.serving) ? (input.serving as Record<string, string>) : undefined;
      try {
        const entry = state.register(name, input.content, { serving, render: input.render, update: input.update });
        sendJson(res, 200, { ok: true, entry });
      } catch (err) {
        sendError(res, 400, 'bad_name', err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (pathName === '/api/state/drop' && method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendError(res, 400, 'bad_json', 'body must be JSON: {name}');
        return;
      }
      const name = typeof (body as { name?: unknown } | null)?.name === 'string' ? ((body as { name: string }).name) : '';
      if (!name) {
        sendError(res, 400, 'bad_json', 'drop needs a name: {name}');
        return;
      }
      const dropped = state.drop(name);
      if (!dropped) {
        sendError(res, 404, 'no_such_entry', `nothing to drop: ${name} — GET /api/state for the active set`);
        return;
      }
      sendJson(res, 200, { ok: true, dropped: true, name });
      return;
    }

    if (pathName === '/api/state/stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('event: ready\ndata: {"ok":true}\n\n');
      const off = state.on((event) => {
        try {
          res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
        } catch {
          /* the writer will be cleaned up on close */
        }
      });
      const beat = setInterval(() => {
        try {
          res.write(': beat\n\n');
        } catch {
          /* closed */
        }
      }, 15_000);
      beat.unref?.();
      req.on('close', () => {
        clearInterval(beat);
        off();
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
    port: options.port ?? 8127,
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
    api.server.listen(options.port ?? 8127, options.host ?? '127.0.0.1', () => resolve());
  });
  const addr = api.server.address() as AddressInfo | null;
  const boundPort = addr ? addr.port : (options.port ?? 8127);
  return {
    ...api,
    port: boundPort,
    url: `http://${options.host ?? '127.0.0.1'}:${boundPort}`,
    stop: api.close,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const { createStateRegistry } = await import('./stateRegistry.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const jsonOf = async <T>(res: Response) => (await res.json()) as T;

  const state = createStateRegistry();
  state.register('demo.entry', { a: 1, log: 'p1\np2\np3' }, { serving: { log: 'delta' } });

  const api = await startApiServer({ state, port: 0, publicDir: path.join(process.cwd(), 'public') });
  const base = api.url;

  const health = await jsonOf<{ ok: boolean; module: string; entries: number }>(await fetch(base + '/health'));
  ok('health answers', health.ok === true && health.module === 'state' && health.entries === 1, JSON.stringify(health));

  const listing = await jsonOf<{ entries: Array<{ path: string; shape: string[] }> }>(await fetch(base + '/api/state'));
  ok('the active set reads over HTTP', listing.entries.length === 1 && listing.entries[0].path === 'demo.entry');
  ok('the listing carries the shape, not the contents', listing.entries[0].shape.join(',') === 'a,log');

  const reg = await fetch(base + '/api/state/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'http.obj', content: { n: 5 } }),
  });
  ok('register walks the HTTP door', reg.status === 200 && (await jsonOf<{ ok: boolean }>(reg)).ok === true);

  const badReg = await fetch(base + '/api/state/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'bad name!', content: {} }),
  });
  ok('a bad name answers 400 with a code', badReg.status === 400 && (await jsonOf<{ error: { code: string } }>(badReg)).error.code === 'bad_name');

  const full = await jsonOf<{ full: boolean; content: { log: string }; marks: { log: number } }>(await fetch(base + '/api/state/pull?name=demo.entry'));
  ok('a pull reads the full state + mark', full.full === true && full.marks.log === 3);
  const delta = await jsonOf<{ full: boolean; content: { log: string } }>(await fetch(base + '/api/state/pull?name=demo.entry&marks=' + encodeURIComponent('{"log":1}')));
  ok('a marked pull reads the delta', delta.full === false && delta.content.log === 'p2\np3');

  const miss = await fetch(base + '/api/state/pull?name=nope');
  ok('an unknown entry answers 404 no_such_entry', miss.status === 404 && (await jsonOf<{ error: { code: string } }>(miss)).error.code === 'no_such_entry');

  // a refusal must say WHY it refused: an app that exited (gone) and a path nobody registered (absent) are different
  // facts and callers respond differently, so the typology has to survive the trip over HTTP
  const missBody = await jsonOf<{ ok: boolean; why?: string; name?: string }>(await fetch(base + '/api/state/pull?name=nope'));
  ok('a 404 carries the typed reason, not just a code', missBody.ok === false && typeof missBody.why === 'string', JSON.stringify(missBody));

  state.register('Alt.demo', { x: 1 });
  state.register('Other.demo', { x: 1 });
  const ambiguous = await fetch(base + '/api/state/pull?name=demo');
  const ambBody = await jsonOf<{ error: { message: string } }>(ambiguous);
  ok('an ambiguous name answers 409 with the candidates', ambiguous.status === 409 && ambBody.error.message.includes('Other.demo'), JSON.stringify(ambBody));
  state.drop('Alt.demo');
  state.drop('Other.demo');

  // the live change feed — open a copy, register, see the change arrive
  const controller = new AbortController();
  const streamRes = await fetch(base + '/api/state/stream', { signal: controller.signal });
  ok('the stream opens', streamRes.status === 200 && streamRes.headers.get('content-type')?.includes('text/event-stream') === true);
  const reader = streamRes.body?.getReader();
  let feed = '';
  const pump = (async () => {
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed += decoder.decode(value);
        if (feed.includes('"kind":"registered"') && feed.includes('live.seen')) break;
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await fetch(base + '/api/state/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'live.seen', content: { ok: 1 } }) });
  await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, 2500))]);
  ok('the live feed carried the change', feed.includes('"kind":"registered"') && feed.includes('live.seen'), feed.slice(0, 120).replace(/\n/g, '\\n'));
  controller.abort();

  const dropped = await fetch(base + '/api/state/drop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'live.seen' }) });
  ok('drop walks the HTTP door', dropped.status === 200 && (await jsonOf<{ dropped: boolean }>(dropped)).dropped === true);
  const dropMiss = await fetch(base + '/api/state/drop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'live.seen' }) });
  ok('a second drop answers 404', dropMiss.status === 404);

  // the token guard
  const guarded = await startApiServer({ state, port: 0, token: 'secret', publicDir: path.join(process.cwd(), 'public') });
  ok('a guarded api refuses without the token', (await fetch(guarded.url + '/api/state')).status === 401);
  ok('a guarded api accepts the header', (await fetch(guarded.url + '/api/state', { headers: { 'x-state-token': 'secret' } })).status === 200);
  ok('a guarded api accepts ?token=', (await fetch(guarded.url + '/health?token=secret')).status === 200);
  await guarded.stop();

  // MCP is mounted at /mcp on this same port
  const init = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  const initBody = await jsonOf<{ result?: { serverInfo?: { name: string } } }>(init);
  ok('the MCP door answers on the same port', initBody.result?.serverInfo?.name === 'state');

  // ── a link answers for a name that is not here — the auto-resolver lives in State ──
  {
    const peer = http.createServer((req, res) => {
      const asked = new URL(req.url ?? '/', 'http://peer');
      const name = asked.searchParams.get('name') ?? '';
      const via = (asked.searchParams.get('via') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true, name, at: new Date().toISOString(), full: true, marks: {},
        content: { name: 'remote-service', asked: name, sawVia: via },
        hops: 1, via: [...via, 'http://peer'],
      }));
    });
    await new Promise<void>((ready) => peer.listen(0, '127.0.0.1', () => ready()));
    const port = (peer.address() as { port: number }).port;
    state.register('node.fake', { kind: 'link', to: `http://127.0.0.1:${port}`, at: Date.now() });

    const followed = await jsonOf<any>(await fetch(base + '/api/state/pull?name=node.fake.services.remote'));
    ok('a name behind a link resolves through it', followed.ok === true && followed.content?.name === 'remote-service', JSON.stringify(followed).slice(0, 200));
    ok('the answer says where it came from', typeof followed.source === 'string' && followed.source.includes(String(port)) && followed.hops >= 1, JSON.stringify({ source: followed.source, hops: followed.hops }));
    // the remainder rule: a link at node.fake owns everything past it, so the far side is asked for 'services.remote'
    ok('the far side is asked for the REMAINDER of the path', followed.content?.asked === 'services.remote', String(followed.content?.asked));

    // …and a registry that only knows the SAME full name still answers, on the second attempt (nothing regressed)
    const picky = http.createServer((req, res) => {
      const asked = new URL(req.url ?? '/', 'http://peer');
      const name = asked.searchParams.get('name') ?? '';
      if (name !== 'node.picky.services.remote') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: { code: 'no_such_entry' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name, at: new Date().toISOString(), full: true, marks: {}, content: { name: 'same-name', asked: name }, hops: 1, via: ['http://peer'] }));
    });
    await new Promise<void>((ready) => picky.listen(0, '127.0.0.1', () => ready()));
    const pickyPort = (picky.address() as { port: number }).port;
    state.register('node.picky', { kind: 'link', to: `http://127.0.0.1:${pickyPort}`, at: Date.now() });
    const viaFull = await jsonOf<any>(await fetch(base + '/api/state/pull?name=node.picky.services.remote'));
    ok('a registry holding the SAME full name still resolves (fallback)', viaFull.ok === true && viaFull.content?.asked === 'node.picky.services.remote', JSON.stringify(viaFull).slice(0, 200));
    state.drop('node.picky');
    await new Promise<void>((done) => picky.close(() => done()));

    const hereOnly = await fetch(base + '/api/state/pull?name=node.fake.services.remote&follow=0');
    ok('follow=0 answers only from this registry', hereOnly.status === 404);

    state.register('node.selfish', { kind: 'link', to: base, at: Date.now() });
    const looping = await jsonOf<any>(await fetch(base + '/api/state/pull?name=node.selfish.services.x'));
    ok('a link that points back at a base already walked is refused, not looped', looping.ok !== true, JSON.stringify(looping).slice(0, 160));

    peer.close();
    state.drop('node.fake');
    state.drop('node.selfish');
  }

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
