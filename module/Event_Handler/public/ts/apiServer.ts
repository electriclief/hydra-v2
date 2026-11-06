/**
 * @module apiServer
 * @description The HTTP face: /health · /api/events (the palette) · /api/events/trigger ·
 *              /api/events/log · /api/events/purge · /api/events/stream (the live SSE feed),
 *              the static GUI at /, and the MCP mount at /mcp. Dependency-free (node:http);
 *              an optional shared token guards /api/* and /mcp.
 * @intent One implementation, three faces (page · API · agent). Errors are always
 *         {error:{code,message}} with a real code; static files are not actions and are
 *         served without the token.
 */

import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventHandler } from './eventHandler.js';
import type { LogSource } from './logStore.js';
import { createMcpRegistry } from './mcpTools.js';
import { createMcpServer, type McpServer } from './mcpServer.js';
import { serveStatic } from './staticFiles.js';

// --- Interface Definitions ---

export interface ApiServerOptions {
  handler: EventHandler;
  /** Port to listen on (default 8126; 0 asks the OS). */
  port?: number;
  /** Bind interface (default 127.0.0.1 — local unless said otherwise). */
  host?: string;
  /** Shared secret; when set, /api/* and /mcp need `x-eh-token` or `?token=`. */
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

const SOURCES: LogSource[] = ['user', 'agent', 'process', 'system'];

export function createApiServer(options: ApiServerOptions): ApiServer {
  const handler = options.handler;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), 'public');
  const mcp: McpServer | null = options.enableMcp === false ? null : createMcpServer({ registry: createMcpRegistry(handler) });

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    if (!token) return true;
    const header = req.headers['x-eh-token'];
    if (typeof header === 'string' && header === token) return true;
    return url.searchParams.get('token') === token;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? 'GET';

    const guarded = pathName === '/mcp' || pathName.startsWith('/api/');
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, 'unauthorized', 'x-eh-token header or ?token= is required');
      return;
    }

    if (pathName === '/mcp' && mcp) {
      await mcp.handle(req, res);
      return;
    }

    if (pathName === '/health' && method === 'GET') {
      const stats = handler.stats();
      sendJson(res, 200, {
        ok: true,
        module: 'eventHandler',
        events: handler.list().length,
        log: { file: stats.file, bytes: stats.bytes, lines: stats.lines, retentionHours: stats.retentionHours },
      });
      return;
    }

    if (pathName === '/api/events' && method === 'GET') {
      sendJson(res, 200, { ok: true, events: handler.list(), stats: handler.stats() });
      return;
    }

    if (pathName === '/api/events/trigger' && method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendError(res, 400, 'bad_json', 'body must be JSON: {name, payload?, source?}');
        return;
      }
      const input = (body ?? {}) as { name?: unknown; payload?: unknown; source?: unknown };
      const name = typeof input.name === 'string' ? input.name : '';
      if (!name) {
        sendError(res, 400, 'bad_json', 'trigger needs a name: {name, payload?, source?}');
        return;
      }
      const source = SOURCES.includes(input.source as LogSource) ? (input.source as LogSource) : 'user';
      const receipt = handler.trigger(name, input.payload, { source });
      if (!receipt.ok) {
        sendError(res, 404, 'no_such_event', `no such event: ${name} — GET /api/events for the palette`);
        return;
      }
      sendJson(res, 200, { ok: true, receipt });
      return;
    }

    if (pathName === '/api/events/log' && method === 'GET') {
      const limitRaw = Number(url.searchParams.get('limit'));
      const sinceHoursRaw = Number(url.searchParams.get('sinceHours'));
      const read = handler.read({
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200,
        since: Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? Date.now() - sinceHoursRaw * 3_600_000 : undefined,
        name: url.searchParams.get('name') ?? undefined,
        source: url.searchParams.get('source') ?? undefined,
      });
      sendJson(res, 200, { ok: true, matched: read.matched, fileBytes: read.fileBytes, lines: read.lines });
      return;
    }

    if (pathName === '/api/events/purge' && method === 'POST') {
      sendJson(res, 200, { ok: true, ...handler.purge() });
      return;
    }

    if (pathName === '/api/events/stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('event: ready\ndata: {"ok":true}\n\n');
      const off = handler.on((line) => {
        try {
          res.write(`event: event\ndata: ${JSON.stringify(line)}\n\n`);
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
    port: options.port ?? 8126,
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
    api.server.listen(options.port ?? 8126, options.host ?? '127.0.0.1', () => resolve());
  });
  const addr = api.server.address() as AddressInfo | null;
  const boundPort = addr ? addr.port : (options.port ?? 8126);
  return {
    ...api,
    port: boundPort,
    url: `http://${options.host ?? '127.0.0.1'}:${boundPort}`,
    stop: api.close,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const { createEventHandler } = await import('./eventHandler.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-api-'));
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const handler = createEventHandler({ logPath: path.join(dir, 'events.log'), purgeIntervalMs: 0 });
  handler.start();
  handler.register('demo', (payload) => ({ got: payload }), { description: 'demo event' });

  const api = await startApiServer({ handler, port: 0, publicDir: path.join(process.cwd(), 'public') });
  const base = api.url;

  const health = (await (await fetch(base + '/health')).json()) as { ok: boolean; module: string; events: number };
  ok('health answers', health.ok === true && health.module === 'eventHandler' && health.events === 1, JSON.stringify(health));

  const palette = (await (await fetch(base + '/api/events')).json()) as { events: Array<{ name: string }> };
  ok('the palette reads over HTTP', palette.events[0]?.name === 'demo');

  const triggerRes = await fetch(base + '/api/events/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'demo', payload: { x: 1 } }),
  });
  const triggerBody = (await triggerRes.json()) as { ok: boolean; receipt: { source: string } };
  ok('a trigger fires over HTTP as source user', triggerRes.status === 200 && triggerBody.receipt.source === 'user');

  const miss = await fetch(base + '/api/events/trigger', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'nope' }),
  });
  ok('an unknown event answers 404 with a code', miss.status === 404 && ((await miss.json()) as { error: { code: string } }).error.code === 'no_such_event');

  await new Promise((resolve) => setTimeout(resolve, 200));
  const logRes = (await (await fetch(base + '/api/events/log?name=demo.result')).json()) as { matched: number };
  ok('the outcome reads back over HTTP', logRes.matched === 1, JSON.stringify(logRes));

  // the live SSE feed — open a copy, fire an event, see it arrive
  const controller = new AbortController();
  const streamRes = await fetch(base + '/api/events/stream', { signal: controller.signal });
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
        if (feed.includes('"name":"demo"') && feed.includes('event: event')) break;
      }
    } catch {
      /* aborted */
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await fetch(base + '/api/events/trigger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'demo', source: 'agent' }) });
  await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, 2500))]);
  ok('the live feed carried the event', feed.includes('"name":"demo"') && feed.includes('"source":"agent"'), feed.slice(0, 120).replace(/\n/g, '\\n'));
  controller.abort();

  const purge = (await (await fetch(base + '/api/events/purge', { method: 'POST' })).json()) as { ok: boolean; before: number };
  ok('purge answers with counts', purge.ok === true && typeof purge.before === 'number');

  // the token guard
  const guarded = await startApiServer({ handler, port: 0, token: 'secret', publicDir: path.join(process.cwd(), 'public') });
  ok('a guarded api refuses without the token', (await fetch(guarded.url + '/api/events')).status === 401);
  ok('a guarded api accepts the header', (await fetch(guarded.url + '/api/events', { headers: { 'x-eh-token': 'secret' } })).status === 200);
  ok('a guarded api accepts ?token=', (await fetch(guarded.url + '/health?token=secret')).status === 200);
  await guarded.stop();

  // MCP is mounted at /mcp on this same port
  const init = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
  const initBody = (await init.json()) as { result?: { serverInfo?: { name: string } } };
  ok('the MCP door answers on the same port', initBody.result?.serverInfo?.name === 'event-handler');

  await api.stop();
  let closed = false;
  try {
    await fetch(base + '/health');
  } catch {
    closed = true;
  }
  ok('stop closes the door', closed);

  handler.close();
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[apiServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
