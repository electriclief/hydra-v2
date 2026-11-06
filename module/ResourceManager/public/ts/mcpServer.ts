/**
 * @module mcpServer
 * @description The MCP-over-HTTP face — streamable HTTP, JSON-RPC, sessions. It serves
 *              whatever REGISTRY it is handed (list + call): this module's own registry
 *              today, other registries later (Api_Root mounts them the same way). One
 *              implementation, many faces.
 * @intent House conventions (from ProcessWrapper/Services, kept here): plain JSON or
 *         SSE-framed replies, `initialize` carries instructions that say how to pick a
 *         tool, notifications answer 202 with no body, an unknown method is -32601, an
 *         unknown tool/params is -32602, and a refused tool argument comes back as
 *         `isError: true` with a message that says what to do.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpRegistry, McpToolResult } from './mcpTools.js';
import { ToolRefusal } from './mcpTools.js';

// --- Interface Definitions ---

export interface McpServerOptions {
  registry: McpRegistry;
  /** Sent in the initialize reply — say what this box is and how to pick a tool. */
  instructions?: string;
  /** Protocol revisions spoken, newest first (the first is the default). */
  protocolVersions?: string[];
}

export interface McpServer {
  /** Route POST/GET/DELETE /mcp here from the HTTP layer. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

interface JsonRpcRequest {
  id?: unknown;
  method?: string;
  params?: {
    protocolVersion?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

const DEFAULT_INSTRUCTIONS = [
  'Resource Manager — the register of this node. It READS the machine (cpu cores · gpus · ram · disks · Hydra shared folders) and keeps BOOKINGS: what a run holds. It has no internal logic — poll is a pure read, book is the only write, pop/clear are the exits; the only rule is it won\'t allow double booking (1 app per gpu). Not enforcement — voluntary all the way.',
  'The flow: rm_resources (THE POLL — cpu · gpus + observed gpu-side processes · ram · disks · shared folders · every current booking) → rm_book (the ONE write: pass the CHOSEN resources — amounts for cores/ramMb/diskMb; a gpu by name, whole and pinned; paths[], where a booked folder covers its subtree. It lands whole or is refused whole, and the refusal carries the wait info) → rm_pop when the run ends → rm_clear by hand for a corpse hold. rm_bookings lists the register.',
  'A booking always sources from a request to run a service: the service knows its needs, the scheduler does the thinking (now · later · cannot), this box only refuses double booking. After booking, the expected next step is the launch via ProcessWrapper.',
].join('\n');

// --- Function Definitions ---

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

function wantsSse(req: IncomingMessage): boolean {
  const accept = String(req.headers.accept ?? '');
  return accept.includes('text/event-stream');
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const registry = options.registry;
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  const protocolVersions = options.protocolVersions ?? ['2025-06-18', '2025-03-26', '2024-11-05'];
  const sessions = new Map<string, { createdAt: number }>();

  function sendPayload(req: IncomingMessage, res: ServerResponse, payload: unknown, status = 200, extraHeaders: Record<string, string> = {}): void {
    const headers: Record<string, string> = { ...extraHeaders };
    if (wantsSse(req)) {
      const text = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
      res.writeHead(status, { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end(text);
      return;
    }
    const text = JSON.stringify(payload, null, 2);
    res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  }

  async function handleOne(msg: JsonRpcRequest): Promise<{ reply?: unknown; notification?: boolean; headers?: Record<string, string> }> {
    const id = msg.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

    switch (msg.method) {
      case 'initialize': {
        const requested = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '';
        const version = protocolVersions.includes(requested) ? requested : protocolVersions[0];
        const sessionId = randomUUID();
        sessions.set(sessionId, { createdAt: Date.now() });
        return {
          reply: ok({
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: 'resource-manager', version: '0.1.0' },
            instructions,
          }),
          headers: { 'Mcp-Session-Id': sessionId },
        };
      }
      case 'notifications/initialized':
        return { notification: true };
      case 'ping':
        return { reply: ok({}) };
      case 'tools/list':
        return { reply: ok({ tools: registry.list() }) };
      case 'tools/call': {
        const name = typeof msg.params?.name === 'string' ? msg.params.name : '';
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (!registry.list().some((tool) => tool.name === name)) {
          return { reply: fail(-32602, `unknown tool: ${name} — call tools/list`) };
        }
        try {
          const result: McpToolResult = await registry.call(name, args);
          return { reply: ok(result) };
        } catch (err) {
          const message = err instanceof ToolRefusal ? err.message : `tool failed: ${err instanceof Error ? err.message : String(err)}`;
          return { reply: ok({ content: [{ type: 'text', text: message }], isError: true }) };
        }
      }
      default:
        return { reply: fail(-32601, `unknown method: ${String(msg.method ?? '')}`) };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      const text = JSON.stringify({ error: { code: 'no_route', message: 'GET /mcp is not a stream — POST JSON-RPC; the register answers at /api/resources' } }, null, 2);
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end(text);
      return;
    }
    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'];
      if (sid) sessions.delete(String(sid));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      const text = JSON.stringify({ error: { code: 'no_route', message: 'POST JSON-RPC to /mcp' } }, null, 2);
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end(text);
      return;
    }

    let body = '';
    try {
      body = await readBody(req);
    } catch {
      const text = JSON.stringify({ error: { code: 'bad_json', message: 'body too large' } }, null, 2);
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
      res.end(text);
      return;
    }

    let parsed: unknown = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      sendPayload(req, res, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400);
      return;
    }

    const messages = (Array.isArray(parsed) ? parsed : [parsed]) as JsonRpcRequest[];
    const replies: unknown[] = [];
    let headers: Record<string, string> = {};
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') {
        replies.push({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        continue;
      }
      const outcome = await handleOne(msg);
      if (outcome.notification) continue;
      if (outcome.headers) headers = { ...headers, ...outcome.headers };
      if (outcome.reply !== undefined) replies.push(outcome.reply);
    }
    if (!replies.length) {
      res.writeHead(202, headers);
      res.end();
      return;
    }
    sendPayload(req, res, Array.isArray(parsed) ? replies : replies[0], 200, headers);
  }

  return { handle };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createBookingStore } = await import('./bookingStore.js');
  const { createRmMcpRegistry } = await import('./mcpTools.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mcps-'));
  const fakeReads = {
    collectedAt: new Date().toISOString(),
    node: 'test-node',
    platform: 'win32',
    cpu: { model: 'fake', cores: 8, loadPct: 1 },
    ram: { totalMb: 16000, freeMb: 9000 },
    gpus: [{ name: 'RX 6800', vramMb: 16384, vramSource: 'registry' as const, memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [],
    notes: [],
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const server = createMcpServer({ registry: createRmMcpRegistry(store, () => fakeReads) });

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/mcp')) {
      void server.handle(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = httpServer.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}/mcp`;

  const call = async (payload: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown; headers: Headers }> => {
    const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  };

  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' } } });
  const initBody = init.body as { result?: { serverInfo?: { name?: string }; instructions?: string } };
  ok('initialize answers with the server name', initBody.result?.serverInfo?.name === 'resource-manager', JSON.stringify(init.body).slice(0, 120));
  ok('initialize carries instructions', typeof initBody.result?.instructions === 'string' && initBody.result.instructions.includes('rm_book'));
  const session = init.headers.get('mcp-session-id');
  ok('initialize issues a session id', typeof session === 'string' && session.length > 10);

  const note = await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': String(session) });
  ok('a notification answers 202 with no body', note.status === 202, String(note.status));

  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': String(session) });
  const tools = (list.body as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? [];
  ok('tools/list advertises the registry', tools.length === 5 && tools.some((t) => t.name === 'rm_resources'), tools.map((t) => t.name).join(','));

  const callRes = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rm_book', arguments: { service: 'demo', cores: 2 } } }, { 'mcp-session-id': String(session) });
  const callBody = callRes.body as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
  ok('tools/call books through the register', callBody.result?.content?.[0]?.text?.includes('"ok": true') === true, JSON.stringify(callBody).slice(0, 160));

  const unknownTool = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }, { 'mcp-session-id': String(session) });
  ok('an unknown tool is -32602', (unknownTool.body as { error?: { code?: number } }).error?.code === -32602);

  const unknownMethod = await call({ jsonrpc: '2.0', id: 5, method: 'nope/nope' }, { 'mcp-session-id': String(session) });
  ok('an unknown method is -32601', (unknownMethod.body as { error?: { code?: number } }).error?.code === -32601);

  const sse = await call({ jsonrpc: '2.0', id: 6, method: 'ping' }, { 'mcp-session-id': String(session), accept: 'text/event-stream' });
  ok('SSE framing works', typeof sse.body === 'string' && (sse.body as string).startsWith('event: message\ndata: '), String(sse.body).slice(0, 60));
  const batch = await call([{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', id: 8, method: 'ping' }], { 'mcp-session-id': String(session) });
  ok('batches answer in order', Array.isArray(batch.body) && (batch.body as Array<{ id: number }>).length === 2);

  const getRes = await fetch(base);
  ok('GET /mcp points elsewhere (405)', getRes.status === 405);

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
