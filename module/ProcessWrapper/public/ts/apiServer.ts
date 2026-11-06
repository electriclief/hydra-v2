/**
 * @module apiServer
 * @description The HTTP face of the wrapper: launch a process, read or follow a copy of
 *              its output stream, write to its stdin, list it, kill it.
 * @intent A wrapper that can only be used from the process that owns it is a library, not
 *         a wrapper. This module puts the process table on a port so any surface — a page,
 *         a script, another Hydra node, curl — can start a command and take its own copy of
 *         the output as a text stream (whole, ranged, or live over SSE), and can kill what
 *         it started. No dependencies: node:http, one file, every route self-checked.
 *
 * Routes (all JSON unless noted):
 *   GET    /health                          → liveness + counters
 *   GET    /api/processes                   → the table (?life=&tag=)
 *   POST   /api/processes                   → launch {command|saved, args, cwd, env, name, tag, shell}
 *   GET    /api/processes/:id               → one record
 *   GET    /api/processes/:id/output        → a COPY of the text (?from=&limit=&channel=) text/plain
 *   GET    /api/processes/:id/stream        → a LIVE copy, SSE (?from=&channel=)
 *   GET    /api/processes/:id/file          → where the ground-truth stream file is
 *   POST   /api/processes/:id/input         → write to stdin {text}
 *   POST   /api/processes/:id/kill          → kill {force, graceMs}
 *   DELETE /api/processes/:id               → kill + drop the record
 *   GET    /api/commands                    → saved commands (data.yaml)
 *   POST   /api/commands                    → save one
 *   DELETE /api/commands/:name              → drop one
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ProcessWrapperService, ProcessLife, ProcessRecord, StreamChannel, KillResult } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import { serveStatic } from './staticFiles.js';
import { createMcpServer, type McpServer, type RegistryBridge } from './mcpServer.js';
import type { ConsoleEvents } from './consoleEvents.js';
import type { RootRecord } from './rootLife.js';
import {
  addCommand,
  defaultRegistry,
  loadRegistry,
  removeCommand,
  saveRegistry,
  toSpec,
  type CommandDefinition,
  type RegistryState,
} from './registryStore.js';

// --- Interface Definitions ---

export interface ApiServerOptions {
  wrapper: ProcessWrapperService;
  hub: StreamHub;
  /** Port to listen on (default 8125; 0 asks the OS for a free one). */
  port?: number;
  /** Interface to bind (default 127.0.0.1 — the wrapper is local unless said otherwise). */
  host?: string;
  /** Shared secret; when set, every /api and /mcp request needs `x-pw-token` or `?token=`. */
  token?: string | null;
  /** data.yaml path holding saved commands (default: ./data.yaml). */
  registryFile?: string;
  /** Read/write the registry from disk (default true; tests keep it in memory). */
  persistRegistry?: boolean;
  /** SSE heartbeat in ms (default 15000). */
  heartbeatMs?: number;
  /** Folder served at the root: the GUI, its CSS and its compiled script (default ./public). */
  publicDir?: string;
  /** Serve the MCP endpoint at /mcp (default true). */
  enableMcp?: boolean;
  /** The console palette (an embedded Event_Handler); when set, /api/events answers. */
  palette?: ConsoleEvents | null;
  /** THE STOP-ALL — fired by POST /api/stop. Closing the window pops everything:
   *  every service, every provider, every thread and the master tic. The host wires
   *  this to its own shutdown; absent, the route refuses rather than pretending. */
  onStop?: () => void;
  /** THE ROOT'S OWN ROW — published beside the children so nothing hidden is total.
   *  Null when the caller did not capture its own life (tests, embedded hosts). */
  rootRecord?: RootRecord | null;
}

export interface ApiServer {
  server: http.Server;
  /** The real bound URL (port resolved when 0 was asked for). */
  url: string;
  port: number;
  /** The MCP endpoint mounted at /mcp (null when disabled). */
  mcp: McpServer | null;
  close(): Promise<void>;
}

/** The error body every failure shares. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

// --- Function Definitions ---

/** Read a request body as text, capped (default 1 MiB). */
async function readBody(req: IncomingMessage, capBytes = 1_048_576): Promise<string> {
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  const body: ApiErrorBody = { error: { code, message } };
  sendJson(res, status, body);
}

/** Build the API server around a wrapper + hub. */
export function createApiServer(options: ApiServerOptions): ApiServer {
  const wrapper = options.wrapper;
  const hub = options.hub;
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8125;
  const token = options.token ?? null;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const persist = options.persistRegistry !== false;
  const registryFile = options.registryFile ?? './data.yaml';
  let registry: RegistryState = persist ? loadRegistry(registryFile).state : defaultRegistry();
  const startedAt = Date.now();
  const streams = new Set<ServerResponse>();
  const palette = options.palette ?? null;
  /** THE ROOT'S OWN ROW — captured by the boot, published beside the children. */
  const rootRecord: RootRecord | null = options.rootRecord ?? null;

  const saveRegistryIfNeeded = () => {
    if (persist) saveRegistry(registryFile, registry);
  };

  // The MCP endpoint is built over the same table, hub and registry — one implementation,
  // two faces (this is what the /mcp tools call, never a copy of the logic).
  const registryBridge: RegistryBridge = {
    list: () => registry.commands,
    find: (name) => registry.commands.find((c) => c.name === name) ?? null,
    add: (def) => {
      const saved = addCommand(registry, def);
      saveRegistryIfNeeded();
      return saved;
    },
    remove: (name) => {
      const removed = removeCommand(registry, name);
      if (removed) saveRegistryIfNeeded();
      return removed;
    },
  };
  const enableMcp = options.enableMcp !== false;
  const publicDir = options.publicDir ?? path.join(process.cwd(), 'public');
  const mcp: McpServer | null = enableMcp
    ? createMcpServer({
        wrapper,
        hub,
        registry: registryBridge,
        endpoint: `http://${host}:${port}`,
      })
    : null;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/').filter(Boolean);
    const method = (req.method || 'GET').toUpperCase();

    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, x-pw-token, mcp-session-id');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // The GUI and its files are not actions: they are served without a token, so an operator
    // can load the page and type the token into it. Everything that ACTS needs the token.
    const isApi = parts[0] === 'api';
    const isHealth = parts.length === 1 && parts[0] === 'health';
    const isMcp = parts.length === 1 && parts[0] === 'mcp';
    if (!isApi && !isHealth && !isMcp) {
      serveStatic(req, res, { root: publicDir });
      return;
    }

    if (token) {
      const given = req.headers['x-pw-token'] || url.searchParams.get('token');
      if (given !== token) {
        sendError(res, 401, 'unauthorized', 'a valid x-pw-token (or ?token=) is required');
        return;
      }
    }

    // POST /mcp — the agent face (initialize · tools/list · tools/call · resources/*)
    if (isMcp && mcp) {
      await mcp.handle(req, res);
      return;
    }

    // GET /health
    if (method === 'GET' && isHealth) {
      const all = wrapper.list();
      sendJson(res, 200, {
        ok: true,
        module: 'processWrapper',
        since: new Date(startedAt).toISOString(),
        uptimeMs: Date.now() - startedAt,
        processes: {
          total: all.length,
          live: all.filter((p) => p.life === 'running' || p.life === 'starting').length,
        },
        copies: hub.openCount(),
        savedCommands: registry.commands.length,
        surfaces: { gui: '/', api: '/api/processes', mcp: enableMcp ? '/mcp' : null },
      });
      return;
    }

    // /api/events — the console palette (an embedded Event_Handler): list · trigger · log.
    // Any hand reaches it: this route, the window's footer, a script, a command-line arg.
    if (parts[0] === 'api' && parts[1] === 'events') {
      const what = parts[2] ? decodeURIComponent(parts[2]) : null;
      if (!palette) {
        sendError(res, 404, 'no_palette', 'this wrapper hosts no console palette');
        return;
      }
      if (method === 'GET' && !what) {
        sendJson(res, 200, { palette: palette.list() });
        return;
      }
      if (method === 'GET' && what === 'log') {
        const limit = Number(url.searchParams.get('limit')) || 50;
        sendJson(res, 200, { log: palette.log(limit) });
        return;
      }
      if (method === 'POST' && what === 'trigger') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (err) {
          sendError(res, 400, 'bad_json', `body must be JSON: ${(err as Error).message}`);
          return;
        }
        const receipt = palette.trigger(
          String(body.name ?? ''),
          (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>,
          body.source ? String(body.source) : 'api',
        );
        if (!receipt.ok) {
          sendError(res, 404, 'no_such_event', `no event named ${String(body.name ?? '')} in the console palette`);
          return;
        }
        sendJson(res, 202, { trigger: receipt, note: 'fire-and-forget: the outcome lands in /api/events/log' });
        return;
      }
      sendError(res, 404, 'no_route', `no route for ${method} ${url.pathname}`);
      return;
    }

    // /api/commands ...
    if (parts[0] === 'api' && parts[1] === 'commands') {
      const name = parts[2] ? decodeURIComponent(parts[2]) : null;
      if (method === 'GET' && !name) {
        sendJson(res, 200, { registry });
        return;
      }
      if (method === 'POST' && !name) {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await readBody(req) || '{}');
        } catch (err) {
          sendError(res, 400, 'bad_json', `body must be JSON: ${(err as Error).message}`);
          return;
        }
        try {
          const cmd = addCommand(registry, {
            name: String(body.name ?? ''),
            command: String(body.command ?? ''),
            args: Array.isArray(body.args) ? (body.args as unknown[]).map(String) : [],
            cwd: body.cwd ? String(body.cwd) : '',
            env: body.env && typeof body.env === 'object' ? (body.env as Record<string, string>) : {},
            shell: body.shell === true,
            description: body.description ? String(body.description) : '',
            tag: body.tag ? String(body.tag) : null,
          });
          saveRegistryIfNeeded();
          sendJson(res, 201, { command: cmd, registry });
        } catch (err) {
          sendError(res, 409, 'command_rejected', (err as Error).message);
        }
        return;
      }
      if (method === 'DELETE' && name) {
        const removed = removeCommand(registry, name);
        if (!removed) {
          sendError(res, 404, 'not_found', `no saved command named ${name}`);
          return;
        }
        saveRegistryIfNeeded();
        sendJson(res, 200, { removed: name, registry });
        return;
      }
      sendError(res, 405, 'method_not_allowed', `${method} is not allowed on /api/commands`);
      return;
    }

    // /api/stop - THE STOP-ALL. Closing the window pops everything; this is the wire.
    // Answer first, then die: a caller must never be left hanging on the death it asked for.
    if (parts[0] === 'api' && parts[1] === 'stop') {
      if (method !== 'POST') { sendError(res, 405, 'method_not_allowed', 'the stop-all is POST /api/stop'); return; }
      if (!options.onStop) { sendError(res, 501, 'no_stop_wired', 'this host did not wire a stop-all'); return; }
      const killers = wrapper.list({ life: 'running' }).length;
      sendJson(res, 202, { ok: true, stopping: true, lives: killers, note: 'every child dies with the root - nothing hidden, nothing left alive' });
      setTimeout(() => { try { options.onStop?.(); } catch { /* already going */ } }, 200);
      return;
    }

    // /api/root/output — the trunk's own life. Its own branch: the root is not a
    // child, so it does not live under /api/processes.
    if (parts[0] === 'api' && parts[1] === 'root' && parts[2] === 'output') {
      if (method !== 'GET') { sendError(res, 405, 'method_not_allowed', 'the root life is GET only'); return; }
      if (!rootRecord) { sendError(res, 404, 'no_root_record', 'this host did not capture the root life'); return; }
      try {
        const text = fs.readFileSync(rootRecord.streamFile, 'utf8');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-pw-process': 'root' });
        res.end(text);
      } catch (err) {
        sendError(res, 500, 'root_life_unreadable', (err as Error).message);
      }
      return;
    }

    // /api/processes ...
    if (parts[0] === 'api' && parts[1] === 'processes') {
      const id = parts[2] ? decodeURIComponent(parts[2]) : null;
      const action = parts[3] ? parts[3] : null;

      if (method === 'GET' && !id) {
        const life = url.searchParams.get('life') as ProcessLife | null;
        const tag = url.searchParams.get('tag');
        const list = wrapper.list({ life: life ?? undefined, tag: tag ?? undefined });
        // THE ROOT'S OWN ROW. The table lists the children; the root was the one process
        // its own law did not cover — no name, no pid, no life file. It is published here
        // alongside them so "nothing hidden" is total rather than almost-total: the trunk
        // is the FIRST thing a reader sees, not the one thing missing from the list.
        const root = rootRecord ? { ...rootRecord } : null;
        sendJson(res, 200, { processes: list, count: list.length, root });
        return;
      }

      if (method === 'POST' && !id) {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (err) {
          sendError(res, 400, 'bad_json', `body must be JSON: ${(err as Error).message}`);
          return;
        }
        try {
          let spec;
          if (body.saved) {
            const savedName = String(body.saved);
            const def = registry.commands.find((c) => c.name === savedName);
            if (!def) {
              sendError(res, 404, 'no_such_command', `no saved command named ${savedName}`);
              return;
            }
            spec = toSpec(def, {
              name: body.name ? String(body.name) : undefined,
              tag: body.tag ? String(body.tag) : undefined,
            });
          } else {
            spec = {
              command: String(body.command ?? ''),
              args: Array.isArray(body.args) ? (body.args as unknown[]).map(String) : undefined,
              cwd: body.cwd ? String(body.cwd) : undefined,
              env: body.env && typeof body.env === 'object' ? (body.env as Record<string, string>) : undefined,
              name: body.name ? String(body.name) : undefined,
              tag: body.tag ? String(body.tag) : null,
              shell: body.shell === true,
              bufferLimitChars: typeof body.bufferLimitChars === 'number' ? body.bufferLimitChars : undefined,
            };
          }
          const rec = wrapper.launch(spec);
          sendJson(res, 201, { process: rec });
        } catch (err) {
          sendError(res, 400, 'launch_failed', (err as Error).message);
        }
        return;
      }

      if (!id) {
        sendError(res, 405, 'method_not_allowed', `${method} is not allowed on /api/processes`);
        return;
      }

      const rec = wrapper.get(id);
      if (!rec) {
        sendError(res, 404, 'not_found', `no process with id ${id}`);
        return;
      }

      if (method === 'GET' && !action) {
        sendJson(res, 200, {
          process: rec,
          buffer: wrapper.bufferStatus(id),
          streamFile: rec ? rec.streamFile : null,
        });
        return;
      }

      // A copy of the output, as text: /output?from=&limit=&channel=
      if (method === 'GET' && action === 'output') {
        const from = Number(url.searchParams.get('from') ?? '0');
        const limitRaw = url.searchParams.get('limit');
        const channel = (url.searchParams.get('channel') as StreamChannel | 'both' | null) ?? 'both';
        try {
          const slice = wrapper.output(id, {
            from: Number.isFinite(from) ? from : 0,
            limit: limitRaw === null ? undefined : Number(limitRaw),
            channel,
          });
          res.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'x-pw-process': id,
            'x-pw-channel': String(slice.channel),
            'x-pw-from': String(slice.from),
            'x-pw-to': String(slice.to),
            'x-pw-total': String(slice.total),
            'x-pw-complete': String(slice.complete),
          });
          res.end(slice.text);
        } catch (err) {
          sendError(res, 404, 'not_found', (err as Error).message);
        }
        return;
      }

      // A live copy of the stream, as SSE: /stream?from=&channel=
      if (method === 'GET' && action === 'stream') {
        const from = Number(url.searchParams.get('from') ?? '0');
        const channel = (url.searchParams.get('channel') as StreamChannel | null) ?? undefined;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        const write = (event: string, data: unknown) => {
          if (res.writableEnded) return;
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        write('open', { id, from: Number.isFinite(from) ? from : 0, channel: channel ?? 'both' });
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, heartbeatMs);
        streams.add(res);

        const handle = hub.open(
          id,
          {
            onData: (chunk) => {
              write('chunk', { seq: chunk.seq, channel: chunk.channel, from: chunk.from, fileFrom: chunk.fileFrom, at: chunk.at, text: chunk.text });
              // Backpressure is honest: tell the hub to queue for this slow client.
              return !res.writableEnded && res.writableLength < 1_000_000;
            },
            onDrop: (info) => write('drop', info),
            onEnd: (reason) => {
              write('end', { reason, id });
              clearInterval(heartbeat);
              streams.delete(res);
              if (!res.writableEnded) res.end();
            },
          },
          { from: Number.isFinite(from) ? from : 0, channel },
        );
        req.on('close', () => {
          clearInterval(heartbeat);
          streams.delete(res);
          handle.close();
        });
        return;
      }

      // Where the ground-truth text of this life lives
      if (method === 'GET' && action === 'file') {
        sendJson(res, 200, { id, streamFile: rec ? rec.streamFile : null, note: 'append-only, whole while alive, kept at death' });
        return;
      }

      // stdin
      if (method === 'POST' && action === 'input') {
        let text = '';
        try {
          const raw = await readBody(req);
          if (raw.trim().startsWith('{')) {
            const parsed = JSON.parse(raw || '{}');
            text = String(parsed.text ?? '');
          } else {
            text = raw;
          }
        } catch (err) {
          sendError(res, 400, 'bad_body', `could not read the input body: ${(err as Error).message}`);
          return;
        }
        const wrote = wrapper.write(id, text);
        if (!wrote) {
          sendError(res, 409, 'stdin_closed', `process ${id} has no open stdin`);
          return;
        }
        sendJson(res, 200, { id, wrote: text.length });
        return;
      }

      // kill
      if (method === 'POST' && action === 'kill') {
        let body: Record<string, unknown> = {};
        try {
          const raw = await readBody(req);
          if (raw.trim()) body = JSON.parse(raw);
        } catch (err) {
          sendError(res, 400, 'bad_json', `body must be JSON: ${(err as Error).message}`);
          return;
        }
        try {
          const result = await wrapper.kill(id, {
            force: body.force === true,
            graceMs: typeof body.graceMs === 'number' ? body.graceMs : undefined,
          });
          sendJson(res, 200, { kill: result });
        } catch (err) {
          sendError(res, 404, 'not_found', (err as Error).message);
        }
        return;
      }

      // kill + forget
      if (method === 'DELETE' && !action) {
        const before = wrapper.get(id);
        if (!before) {
          sendError(res, 404, 'not_found', `no process with id ${id}`);
          return;
        }
        let kill = null;
        if (before.life === 'running' || before.life === 'starting') {
          kill = await wrapper.kill(id, { force: true });
        }
        const removed = wrapper.remove(id);
        sendJson(res, 200, { removed, kill, process: before });
        return;
      }

      sendError(res, 404, 'no_route', `no route for ${method} ${url.pathname}`);
      return;
    }

    sendError(res, 404, 'no_route', `no route for ${method} ${url.pathname}`);
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch((err) => {
      if (!res.headersSent) sendError(res, 500, 'internal', (err as Error).message);
      else res.end();
    });
  });

  return {
    server,
    url: `http://${host}:${port}`,
    port,
    mcp,
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of streams) {
          try {
            res.end();
          } catch {
            /* already gone */
          }
        }
        streams.clear();
        hub.closeAll('closed');
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
        // Sockets held open by SSE clients would keep close() waiting.
        server.closeAllConnections?.();
      }),
  };
}

/** createApiServer + listen, resolving once the port is really bound. */
export async function startApiServer(options: ApiServerOptions): Promise<ApiServer & { stop(): Promise<void> }> {
  const api = createApiServer(options);
  await new Promise<void>((resolve, reject) => {
    api.server.once('error', reject);
    api.server.listen(options.port ?? 8125, options.host ?? '127.0.0.1', () => resolve());
  });
  const addr = api.server.address() as AddressInfo | null;
  const bound = {
    ...api,
    port: addr ? addr.port : api.port,
    url: `http://${options.host ?? '127.0.0.1'}:${addr ? addr.port : api.port}`,
    stop: api.close,
  };
  return bound;
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createWrapper } = await import('./processWrapper.js');
  const { createStreamHub } = await import('./streamHub.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-api-'));
  const wrapper = createWrapper({ streamDir: path.join(dir, 'streams'), graceMs: 400 });
  const hub = createStreamHub(wrapper);
  const registryFile = path.join(dir, 'data.yaml');
  const api = await startApiServer({ wrapper, hub, port: 0, registryFile, token: 'sekret' });
  const base = api.url;
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const call = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', 'x-pw-token': 'sekret', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** A JSON body with a declared shape (the API is ours; the test states what it expects). */
  const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T;

  try {
    // 1. health + auth
    const noToken = await fetch(base + '/health');
    ok('a missing token is refused', noToken.status === 401, String(noToken.status));
    const health = await call('GET', '/health');
    const healthBody = await jsonOf<{ ok: boolean; module: string }>(health);
    ok('health answers', health.status === 200 && healthBody.ok === true, JSON.stringify(healthBody));
    ok('health reports the module', healthBody.module === 'processWrapper', JSON.stringify(healthBody));

    // 2. launch over the API
    const launched = await call('POST', '/api/processes', {
      name: 'api-echo',
      command: process.execPath,
      args: ['-e', "console.log('api-line-1');setTimeout(()=>console.error('api-err'),80);setTimeout(()=>console.log('api-line-2'),160)"],
    });
    const launchedBody = await jsonOf<{ process: ProcessRecord }>(launched);
    ok('launch returns 201 + a record', launched.status === 201 && !!launchedBody.process?.id, JSON.stringify(launchedBody).slice(0, 200));
    const id: string = launchedBody.process.id;
    ok('launch is already captured in the table', wrapper.get(id) !== null);

    // 3. listing + one record
    const list = await jsonOf<{ processes: ProcessRecord[]; count: number }>(await call('GET', '/api/processes'));
    ok('listing holds the process', list.processes.some((p) => p.id === id), JSON.stringify(list.count));
    const one = await jsonOf<{ process: ProcessRecord; streamFile: string }>(await call('GET', `/api/processes/${id}`));
    ok('one record carries the pid', typeof one.process.pid === 'number', JSON.stringify(one.process.pid));
    ok('one record carries the stream file', String(one.streamFile).endsWith('.log'), String(one.streamFile));

    // 4. a copy of the output as text
    await wrapper.awaitExit(id, 15000);
    const outRes = await call('GET', `/api/processes/${id}/output`);
    const outText = await outRes.text();
    ok('output is served as text/plain', (outRes.headers.get('content-type') || '').startsWith('text/plain'), String(outRes.headers.get('content-type')));
    ok('output carries the whole life', outText.includes('api-line-1') && outText.includes('api-line-2') && outText.includes('api-err'), outText);
    ok('output reports its offsets', outRes.headers.get('x-pw-total') === String(outText.length) && outRes.headers.get('x-pw-complete') === 'true', String(outRes.headers.get('x-pw-total')));
    const ranged = await (await call('GET', `/api/processes/${id}/output?from=11&limit=6`)).text();
    ok('a ranged copy honours from+limit', ranged === outText.slice(11, 17), JSON.stringify(ranged));
    const errOnly = await (await call('GET', `/api/processes/${id}/output?channel=stderr`)).text();
    ok('a channel copy is separated', errOnly.includes('api-err') && !errOnly.includes('api-line-1'), errOnly);

    // 5. a live copy over SSE
    const live = await call('POST', '/api/processes', {
      name: 'api-live',
      command: process.execPath,
      args: ['-e', "console.log('live-1');setTimeout(()=>console.log('live-2'),120);setTimeout(()=>console.log('live-3'),240)"],
    });
    const liveId: string = (await jsonOf<{ process: ProcessRecord }>(live)).process.id;
    const sse = await call('GET', `/api/processes/${liveId}/stream?from=0`);
    ok('stream opens as SSE', (sse.headers.get('content-type') || '').startsWith('text/event-stream'), String(sse.headers.get('content-type')));
    let events = '';
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !events.includes('event: end')) {
      const { value, done } = await reader.read();
      if (done) break;
      events += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    ok('the live copy saw every line', events.includes('live-1') && events.includes('live-2') && events.includes('live-3'), events.slice(0, 300));
    ok('the live copy was told the process ended', events.includes('event: end'), events.slice(-200));
    ok('the live copy opened with a header event', events.includes('event: open'), events.slice(0, 200));

    // 6. stdin + a graceful kill
    const stdinProc = await call('POST', '/api/processes', {
      name: 'api-stdin',
      command: process.execPath,
      args: ['-e', "process.stdin.on('data',d=>console.log('got:'+d.toString().trim()));setInterval(()=>{},50)"],
    });
    const stdinId: string = (await jsonOf<{ process: ProcessRecord }>(stdinProc)).process.id;
    await sleep(400);
    const wrote = await call('POST', `/api/processes/${stdinId}/input`, { text: 'from-the-api\n' });
    ok('input is accepted', wrote.status === 200, String(wrote.status));
    let stdinOut = '';
    const stdinDeadline = Date.now() + 5000;
    while (Date.now() < stdinDeadline) {
      stdinOut = await (await call('GET', `/api/processes/${stdinId}/output`)).text();
      if (stdinOut.includes('got:from-the-api')) break;
      await sleep(80);
    }
    ok('the child really received the stdin', stdinOut.includes('got:from-the-api'), stdinOut);
    const killed = await call('POST', `/api/processes/${stdinId}/kill`, { force: true });
    const killedBody = await jsonOf<{ kill: KillResult }>(killed);
    ok('kill answers with the outcome', killed.status === 200 && killedBody.kill.outcome === 'killed', JSON.stringify(killedBody));
    ok('kill left the record in the table, ended', wrapper.get(stdinId)?.life === 'killed', String(wrapper.get(stdinId)?.life));

    // 7. delete = kill + forget
    const del = await call('DELETE', `/api/processes/${stdinId}`);
    const delBody = await jsonOf<{ removed: boolean; process: ProcessRecord }>(del);
    ok('delete removes the record', del.status === 200 && delBody.removed === true, JSON.stringify(delBody).slice(0, 120));
    ok('the life file outlives the record', fs.existsSync(delBody.process.streamFile), String(delBody.process.streamFile));

    // 8. saved commands over the API (data.yaml)
    const saved = await call('POST', '/api/commands', {
      name: 'api-saved',
      command: process.execPath,
      args: ['-e', "console.log('saved-ran')"],
      description: 'saved through the API',
      tag: 'tests',
    });
    ok('a command can be saved', saved.status === 201, String(saved.status));
    ok('data.yaml was really written', fs.readFileSync(registryFile, 'utf8').includes('api-saved'));
    const cmdList = await jsonOf<{ registry: { commands: CommandDefinition[] } }>(await call('GET', '/api/commands'));
    ok('saved commands are listed', cmdList.registry.commands.some((c) => c.name === 'api-saved'));
    const runSaved = await call('POST', '/api/processes', { saved: 'api-saved' });
    const runSavedBody = await jsonOf<{ process: ProcessRecord }>(runSaved);
    ok('a saved command can be launched by name', runSaved.status === 201 && runSavedBody.process.name === 'api-saved', JSON.stringify(runSavedBody).slice(0, 160));
    await wrapper.awaitExit(runSavedBody.process.id, 15000);
    const savedOut = await (await call('GET', `/api/processes/${runSavedBody.process.id}/output`)).text();
    ok('the saved command really ran', savedOut.includes('saved-ran'), savedOut);
    const dupSave = await call('POST', '/api/commands', { name: 'api-saved', command: 'x' });
    ok('a duplicate saved name is refused', dupSave.status === 409, String(dupSave.status));
    const delCmd = await call('DELETE', '/api/commands/api-saved');
    ok('a saved command can be dropped', delCmd.status === 200, String(delCmd.status));

    // 9. the error paths, each with a real code
    const unknown = await call('GET', '/api/processes/does-not-exist');
    const unknownBody = await jsonOf<{ error: { code: string; message: string } }>(unknown);
    ok('unknown id is a 404 with a code', unknown.status === 404 && unknownBody.error.code === 'not_found', JSON.stringify(unknownBody));
    const noCommand = await call('POST', '/api/processes', {});
    ok('a launch with no command is a 400', noCommand.status === 400, String(noCommand.status));
    const badJson = await call('POST', '/api/processes', '{ not json');
    ok('a broken body is a 400 with a code', badJson.status === 400 && (await jsonOf<{ error: { code: string } }>(badJson)).error.code === 'bad_json', String(badJson.status));
    const noSaved = await call('POST', '/api/processes', { saved: 'nope' });
    ok('an unknown saved name is a 404', noSaved.status === 404, String(noSaved.status));
    const noRoute = await call('GET', '/api/nothing-here');
    ok('an unknown route is a 404 with a code', noRoute.status === 404 && (await jsonOf<{ error: { code: string } }>(noRoute)).error.code === 'no_route', String(noRoute.status));
    const wrongMethod = await call('PUT', '/api/processes');
    ok('a wrong method is refused', wrongMethod.status === 405 || wrongMethod.status === 404, String(wrongMethod.status));
    const badKill = await call('POST', '/api/processes/ghost/kill', {});
    ok('killing a ghost is a 404', badKill.status === 404, String(badKill.status));
    const killedTwice = await call('POST', `/api/processes/${id}/kill`, {});
    const twiceBody = await jsonOf<{ kill: KillResult }>(killedTwice);
    ok('killing a finished process is honest, not an error', killedTwice.status === 200 && twiceBody.kill.forced === false, JSON.stringify(twiceBody));

    // 10. the GUI and the MCP endpoint, through the API server itself
    const gui = await call('GET', '/');
    const guiText = await gui.text();
    ok('the API root serves the GUI page', gui.status === 200 && guiText.includes('<title>ProcessWrapper</title>'), String(gui.status));
    ok('the GUI page loads its own module', guiText.includes('/js/browser/gui.js'), guiText.slice(0, 200));
    ok('the GUI page carries the element ids the module wires', ['procs-body', 'stream', 'command', 'saved-select', 'follow', 'channel', 'stdin', 'health'].every((id) => guiText.includes(`id="${id}"`)), 'missing ids');
    ok('the GUI page explains the laws', guiText.includes('one life = one file'));
    const guiCss = await call('GET', '/css/gui.css');
    ok('the stylesheet is served', guiCss.status === 200 && (guiCss.headers.get('content-type') || '').startsWith('text/css'), String(guiCss.headers.get('content-type')));
    const guiJs = await call('GET', '/js/browser/gui.js');
    ok('the GUI module is served as an ES module', guiJs.status === 200 && (await guiJs.text()).includes('export'), String(guiJs.status));
    const mcpInit = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'api-selftest' } } });
    const mcpBody = await jsonOf<{ result?: { serverInfo?: { name?: string }; instructions?: string; tools?: unknown } }>(mcpInit);
    ok('the MCP endpoint answers initialize through the API server', mcpInit.status === 200 && mcpBody.result?.serverInfo?.name === 'process-wrapper', JSON.stringify(mcpBody).slice(0, 120));
    ok('the MCP endpoint issues a session', String(mcpInit.headers.get('mcp-session-id') ?? '').startsWith('mcp-'), String(mcpInit.headers.get('mcp-session-id')));
    ok('the MCP instructions are self-explanatory', (mcpBody.result?.instructions ?? '').includes('pw_launch'), (mcpBody.result?.instructions ?? '').slice(0, 60));
    const mcpTools = await call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': String(mcpInit.headers.get('mcp-session-id')) });
    const mcpToolsBody = await jsonOf<{ result?: { tools?: { name: string }[] } }>(mcpTools);
    ok('the MCP tool table is reachable', (mcpToolsBody.result?.tools ?? []).length >= 13, String((mcpToolsBody.result?.tools ?? []).length));
    const mcpCall = await call('POST', '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pw_health', arguments: {} } });
    ok('an MCP tool call runs against the real table', (await jsonOf<{ result?: { content?: { text?: string }[] } }>(mcpCall)).result?.content?.[0]?.text?.includes('processWrapper') === true);
    ok('the MCP endpoint is listed in /health', String((healthBody as { surfaces?: { mcp?: string } }).surfaces?.mcp) === '/mcp');
    const mcpGet = await call('GET', '/mcp');
    ok('GET /mcp is refused with an explanation', mcpGet.status === 405 && (await jsonOf<{ error?: { message?: string } }>(mcpGet)).error?.message?.includes('POST') === true, String(mcpGet.status));
    const mcpGetNoToken = await fetch(base + '/mcp');
    ok('an unauthenticated /mcp is refused before anything else', mcpGetNoToken.status === 401, String(mcpGetNoToken.status));
    ok('the API does not leak the GUI for an unknown api path', (await call('GET', '/api/nope')).status === 404);

    // 11. nothing is left running and the server closes cleanly
    ok('the table agrees nothing is running', wrapper.list({ life: 'running' }).length === 0, JSON.stringify(wrapper.list({ life: 'running' }).length));
    await api.stop();
    const after = await fetch(base + '/health').catch(() => null);
    ok('the server really closed', after === null, after ? String(after.status) : 'closed');
  } finally {
    await wrapper.shutdown().catch(() => {});
    await api.stop().catch(() => {});
  }

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[apiServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
