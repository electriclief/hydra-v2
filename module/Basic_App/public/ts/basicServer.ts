/**
 * @module basicServer
 * @description THE APP'S OWN DOOR (default :8130): the generic UI + /api/basic/*. It is
 *              the INSTANCE that stands a run up over the whole module shelf, one at a
 *              time, no queue — busy or not:
 *                read the definition at SERVICES · fill values · pick the gpu at RM's poll ·
 *                BOOK at RM · resolve the launch command · LAUNCH at ProcessWrapper ·
 *                keep State as variable storage (run record + the tab's own visual) ·
 *                fire the Event_Handler · watch the life · POP the booking at the end.
 *              When a run ends the booking pops, State is updated, and the app is idle
 *              again. Past a successful launch the app only watches — "This is Basic!"
 * @intent The piece-connections of the shelf, tried for real. Where a seam is clumsy it
 *         shows here first — this file is the wiring map of Basic_App.
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDoors, DoorError, type DoorClients, type DoorsConfig, type ProcessRecord, type ServiceDefinition } from './doors.js';
import { buildBookInput, buildValues, busyFrom, isLive, lazyOutputs, resolveLaunch } from './runLogic.js';

// --- Interface Definitions ---

export interface BasicEventSink {
  trigger?(name: string, payload?: unknown, options?: { source?: string }): unknown;
}

export interface BasicServerOptions {
  doors: DoorClients | DoorsConfig;
  port?: number;
  host?: string;
  /** The Event_Handler instance (in-process, the shell's hand). Optional. */
  eh?: BasicEventSink | null;
  /** The public/ directory; defaults to the repo's own. */
  publicDir?: string;
  /** The life-watch cadence in ms (default 1200; tests dial it down). */
  watchMs?: number;
}

export interface RunView {
  runId: string;
  name: string;
  pid: number | null;
  life: string;
  exitCode: number | null;
  startedAt: string;
  command: string;
  outputPath: string | null;
  gui: { kind?: string; value?: string; note?: string } | null;
  progressHow: string | null;
}

export interface BasicServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

// --- Function Definitions ---

const MAX_BODY = 2_000_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new DoorError('body too large', 'bad_json', 400));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new DoorError('the body must be JSON', 'bad_json', 400));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data ?? null));
}

function fail(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  sendJson(res, status, { error: { code, message, ...extra } });
}

export async function createBasicServer(options: BasicServerOptions): Promise<BasicServer> {
  const doors: DoorClients = 'services' in options.doors && 'pw' in options.doors
    ? (options.doors as DoorClients)
    : createDoors(options.doors as DoorsConfig);
  const host = options.host ?? '127.0.0.1';
  const publicDir = options.publicDir ?? fileURLToPath(new URL('../', import.meta.url));
  const watchMs = options.watchMs ?? 1200;
  const eh = options.eh ?? null;

  let current: CurrentRun | null = null;
  let watchTimer: ReturnType<typeof setInterval> | null = null;

  interface CurrentRun {
    runId: string;
    name: string;
    startedAt: string;
    command: string;
    outputPath: string | null;
    gui: { kind?: string; value?: string; note?: string } | null;
    progressHow: string | null;
    bookingId: string | null;
    pid: number | null;
  }

  function stopWatch(): void {
    if (watchTimer !== null) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  function startWatch(): void {
    if (watchTimer !== null) return;
    watchTimer = setInterval(() => {
      void tick();
    }, watchMs);
    if (typeof watchTimer === 'object' && watchTimer !== null && 'unref' in watchTimer) {
      (watchTimer as { unref?: () => void }).unref?.();
    }
  }

  async function tick(): Promise<void> {
    if (!current) {
      stopWatch();
      return;
    }
    try {
      const rec = await doors.pw.get(current.runId);
      if (!rec) {
        await finalize(null);
        return;
      }
      if (!isLive(rec)) await finalize(rec);
    } catch {
      // the door is down — keep watching; absence reads as absence
    }
  }

  async function finalize(rec: ProcessRecord | null): Promise<void> {
    const run = current;
    if (!run) return;
    current = null;
    stopWatch();
    const exitCode = rec?.exitCode ?? null;
    const okEnd = exitCode === 0;
    if (run.bookingId) {
      try {
        await doors.rm.pop(run.bookingId);
      } catch {
        // the booking may already be gone — the hand is best-effort
      }
    }
    const summary = {
      status: okEnd ? 'ended' : 'failed',
      runId: run.runId,
      service: run.name,
      exitCode,
      endedAt: new Date().toISOString(),
      command: run.command,
      outputPath: run.outputPath,
    };
    try {
      await doors.state.register('Basic.Run.' + run.name, summary);
      await doors.state.register('Basic.Last', summary);
      await doors.state.register('Basic', {
        value: okEnd ? 'solid' : 'flashing',
        note: `${run.name} ${okEnd ? 'done' : 'failed'} (exit ${exitCode ?? '?'})`,
      });
    } catch {
      // State is storage, not a dependency — a down door never stops an ending
    }
    eh?.trigger?.('basic.run-ended', summary, { source: 'process' });
  }

  async function view(): Promise<Record<string, unknown>> {
    if (!current) return { ok: true, busy: false, run: null };
    let rec: ProcessRecord | null = null;
    try {
      rec = await doors.pw.get(current.runId);
    } catch {
      rec = null;
    }
    const run: RunView = {
      runId: current.runId,
      name: current.name,
      pid: rec?.pid ?? current.pid,
      life: rec?.life ?? 'running',
      exitCode: rec?.exitCode ?? null,
      startedAt: current.startedAt,
      command: current.command,
      outputPath: current.outputPath,
      gui: current.gui,
      progressHow: current.progressHow,
    };
    return { ok: true, busy: isLive(rec ?? ({ life: 'running', endedAt: null } as ProcessRecord)), run };
  }

  async function startRun(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const provided = (body.values && typeof body.values === 'object' ? body.values : {}) as Record<string, unknown>;
    if (!name) throw new DoorError('a run names its service', 'bad_request', 400);
    if (current) throw new DoorError(`busy — ${current.name} is running`, 'busy', 409);

    const defAnswer = await doors.services.get(name);
    const def: ServiceDefinition = defAnswer.service;
    if (!def || typeof def.name !== 'string') throw new DoorError(`no definition for ${name}`, 'no_such_service', 404);

    const filled = buildValues(def, provided);
    if (filled.missing.length) {
      throw new DoorError(`missing required input(s): ${filled.missing.join(', ')}`, 'missing_inputs', 400);
    }

    // pick the gpu from the Register's own poll (names exactly as it reads them)
    let gpuName: string | null = null;
    if (def.needs?.gpu === true) {
      const refreshed = await doors.rm.refresh();
      const gpu = (refreshed.resources?.gpus ?? [])[0];
      gpuName = gpu?.name ?? null;
      if (!gpuName) throw new DoorError('this service needs a gpu and the node reports none', 'no_gpu', 409);
    }

    const booked = await doors.rm.book(buildBookInput(def, gpuName));
    if (!booked.ok || !booked.booking) {
      const err = booked.error ?? { code: 'book_refused', message: 'the resources are taken' };
      throw new DoorError(err.message, 'book_refused', 409);
    }
    const bookingId = booked.booking.id;
    const unbook = async (): Promise<void> => {
      try {
        await doors.rm.pop(bookingId);
      } catch {
        /* best-effort */
      }
    };

    const lazy = lazyOutputs(def, filled.values, (p) => existsSync(p));
    const launch = resolveLaunch(def, lazy.values);
    if (!launch.command) {
      await unbook();
      throw new DoorError('the definition offers no launch command', 'no_launch', 500);
    }
    if (launch.missing.length) {
      await unbook();
      throw new DoorError(`unresolved launch token(s): ${launch.missing.join(', ')}`, 'unresolved_tokens', 500);
    }

    const outputV = (def.variables?.input ?? []).find((v) => v?.role === 'output' && typeof v.name === 'string');
    const outputPath = outputV ? (lazy.values[outputV.name as string] as string | undefined) ?? null : null;

    let rec: ProcessRecord;
    try {
      rec = await doors.pw.launch({ command: launch.command, name: def.name, tag: 'basic' });
    } catch (e) {
      await unbook();
      throw e;
    }

    current = {
      runId: rec.id,
      name: def.name,
      startedAt: new Date().toISOString(),
      command: launch.command,
      outputPath,
      gui: def.gui && def.gui.value ? { kind: def.gui.kind, value: def.gui.value, note: def.gui.note } : null,
      progressHow: def.progress?.how ?? null,
      bookingId,
      pid: rec.pid ?? null,
    };
    startWatch();

    try {
      await doors.state.register('Basic.Run.' + def.name, {
        status: 'running',
        runId: rec.id,
        pid: rec.pid ?? null,
        startedAt: current.startedAt,
        command: launch.command,
        outputPath,
        progressHow: current.progressHow,
      });
      await doors.state.register('Basic', { value: 'highlighted', note: `${def.name} running` });
    } catch {
      /* storage is storage */
    }
    eh?.trigger?.('basic.run-started', { name: def.name, runId: rec.id, command: launch.command }, { source: 'user' });

    const started = await view();
    return { ok: true, run: started.run, outputPath, freshOutput: lazy.changed };
  }

  async function openGui(): Promise<Record<string, unknown>> {
    if (!current?.gui?.value) throw new DoorError('this run offers no gui', 'no_gui', 404);
    const kind = String(current.gui.kind ?? 'url');
    const value = current.gui.value;
    const command = kind === 'url' ? `start "" "${value}"` : value;
    const rec = await doors.pw.launch({ command, name: current.name + ':gui', tag: 'basic-gui', shell: true });
    return { ok: true, runId: rec.id };
  }

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      // --- the API face ---
      if (segments[0] === 'api' && segments[1] === 'basic') {
        const rest = segments.slice(2);

        if (method === 'GET' && rest[0] === 'services' && rest.length === 1) {
          return sendJson(res, 200, await doors.services.list());
        }
        if (method === 'GET' && rest[0] === 'services' && rest.length === 2) {
          return sendJson(res, 200, await doors.services.get(rest[1] as string));
        }
        if (method === 'GET' && rest[0] === 'services' && rest.length === 3) {
          const half = rest[2] === 'inputs' ? 'inputs' : rest[2] === 'ad' ? 'ad' : null;
          if (!half) return fail(res, 404, 'no_route', 'pages are ad or inputs');
          const html = await doors.services.page(rest[1] as string, half);
          return send(res, 200, html, 'text/html; charset=utf-8');
        }
        if (method === 'GET' && rest[0] === 'state' && rest.length === 1) {
          return sendJson(res, 200, await view());
        }
        if (method === 'GET' && rest[0] === 'progress' && rest.length === 1) {
          if (!current) return fail(res, 404, 'no_run', 'nothing is running');
          const from = Number(url.searchParams.get('from') ?? '0') || 0;
          const out = await doors.pw.output(current.runId, from);
          return sendJson(res, 200, { ok: true, runId: current.runId, from: out.next, text: out.text });
        }
        if (method === 'POST' && rest[0] === 'run' && rest.length === 1) {
          const body = (await readBody(req)) as Record<string, unknown>;
          return sendJson(res, 200, await startRun(body));
        }
        if (method === 'POST' && rest[0] === 'stop' && rest.length === 1) {
          if (!current) return fail(res, 404, 'no_run', 'nothing is running');
          const body = (await readBody(req)) as Record<string, unknown>;
          const kill = await doors.pw.kill(current.runId, body.force === true);
          return sendJson(res, 200, { ok: true, kill });
        }
        if (method === 'POST' && rest[0] === 'gui' && rest.length === 1) {
          return sendJson(res, 200, await openGui());
        }
        return fail(res, 404, 'no_route', `no basic route at /${segments.join('/')}`);
      }

      // --- the UI face (static) ---
      if (method === 'GET') {
        const rel = segments.length === 0 ? 'index.html' : segments.join('/');
        const target = path.resolve(publicDir, rel);
        if (!target.startsWith(path.resolve(publicDir))) return fail(res, 403, 'forbidden', 'outside the root');
        try {
          const data = await readFile(target);
          const ext = path.extname(target).toLowerCase();
          return send(res, 200, data.toString('utf8'), MIME[ext] ?? 'application/octet-stream');
        } catch {
          return fail(res, 404, 'no_route', 'no such file — the API lives under /api/basic');
        }
      }
      return fail(res, 404, 'no_route', 'no such route');
    } catch (e) {
      if (e instanceof DoorError) return fail(res, e.status || 500, e.code, e.message);
      return fail(res, 500, 'internal', e instanceof Error ? e.message : String(e));
    }
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

  return {
    url: `http://${host}:${port}`,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        stopWatch();
        server.close(() => resolve());
      }),
  };
}

// --- Built-in Test Suite ---

interface StubDoor {
  url: string;
  close(): Promise<void>;
  calls: Array<{ method: string; path: string; body: unknown }>;
}

async function stubDoor(
  answer: (method: string, pathname: string, body: unknown) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | null,
): Promise<StubDoor> {
  const calls: StubDoor['calls'] = [];
  const server = http.createServer((req, res) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 1_000_000) chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const url = new URL(req.url ?? '/', 'http://x');
      calls.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body });
      const hit = answer(req.method ?? 'GET', url.pathname, body);
      if (!hit) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'no_route', message: 'stub' } }));
        return;
      }
      res.writeHead(hit.status ?? 200, { 'content-type': 'application/json; charset=utf-8', ...(hit.headers ?? {}) });
      res.end(hit.text ?? JSON.stringify(hit.json ?? null));
    });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL basicServer :: ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const demoDef = {
    name: 'demo',
    provider: { launch: 'echo {{prompt}}' },
    variables: { input: [{ name: 'prompt', required: true }, { name: 'out', role: 'output', default: 'C:/tmp/out.txt' }] },
    needs: { gpu: true, ramMb: 1000 },
    progress: { how: 'stdout', source: 'stdout' },
    gui: { kind: 'url', value: 'http://127.0.0.1:8080' },
  };

  let pwEnded = false;
  let pwKilled = false;
  const pwRec = () => ({
    id: 'p1',
    name: 'demo',
    tag: 'basic',
    pid: 111,
    life: pwEnded ? 'ended' : 'running',
    spawnedAt: Date.now(),
    endedAt: pwEnded ? Date.now() : null,
    exitCode: pwEnded ? 0 : null,
    signal: null,
    error: null,
  });

  const services = await stubDoor((m, p) => {
    if (p === '/api/services') return { json: { ok: true, services: [{ name: 'demo', ok: true, what: 'does a thing', provider: 'app', modes: [], karma: 1 }] } };
    if (p === '/api/services/demo') return { json: { ok: true, service: demoDef } };
    if (p === '/api/services/demo/ad') return { text: '<h1>the demo ad</h1>' };
    if (p === '/api/services/demo/inputs') return { text: '<h1>the demo inputs</h1>' };
    return null;
  });
  const pw = await stubDoor((m, p, b) => {
    if (m === 'POST' && p === '/api/processes') return { json: { ok: true, process: pwRec() } };
    if (m === 'GET' && p === '/api/processes/p1') return { json: { ok: true, process: pwRec() } };
    if (m === 'GET' && p.startsWith('/api/processes/p1/output')) return { text: 'tick 1', headers: { 'x-pw-to': '6' } };
    if (m === 'POST' && p === '/api/processes/p1/kill') {
      pwKilled = true;
      pwEnded = true;
      return { json: { ok: true } };
    }
    return null;
  });
  const rm = await stubDoor((m, p) => {
    if (p === '/api/resources/refresh') return { json: { ok: true, resources: { gpus: [{ name: 'Demo GPU', vramMb: 4096 }] } } };
    if (m === 'POST' && p === '/api/book') return { json: { ok: true, booking: { id: 'b1', service: 'demo' } } };
    if (p === '/api/bookings/b1/pop') return { json: { ok: true } };
    return null;
  });
  const state = await stubDoor((m, p, b) => {
    if (p === '/api/state/register') return { json: { ok: true, name: (b as Record<string, unknown>)?.name } };
    return null;
  });

  const server = await createBasicServer({
    doors: { servicesUrl: services.url, pwUrl: pw.url, rmUrl: rm.url, stateUrl: state.url },
    port: 0,
    watchMs: 60,
  });

  const get = async (p: string) => {
    const r = await fetch(server.url + p);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const post = async (p: string, body: unknown) => {
    const r = await fetch(server.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  const listed = await get('/api/basic/services');
  ok('the listing rides from the services door', listed.body.ok === true);
  const ad = await fetch(server.url + '/api/basic/services/demo/ad');
  ok('an ad page rides through as html', ad.headers.get('content-type')?.includes('text/html') === true && (await ad.text()).includes('demo ad'));

  const idle = await get('/api/basic/state');
  ok('idle reads busy:false', idle.body.busy === false);

  const run = await post('/api/basic/run', { name: 'demo', values: { prompt: 'hello' } });
  ok('a run books, launches and answers ok', run.status === 200 && run.body.ok === true && (run.body.run as Record<string, unknown>).runId === 'p1', JSON.stringify({ status: run.status, body: run.body }));
  ok('the launch carried resolved tokens', (pw.calls.find((c) => c.method === 'POST' && c.path === '/api/processes')?.body as Record<string, unknown>)?.command === 'echo hello');
  ok('the booking was the register\'s own poll and book', rm.calls.some((c) => c.path === '/api/resources/refresh') && rm.calls.some((c) => c.path === '/api/book'));

  const busyState = await get('/api/basic/state');
  ok('a run is busy right away', busyState.body.busy === true);

  const second = await post('/api/basic/run', { name: 'demo', values: { prompt: 'again' } });
  ok('one at a time — a second run is refused busy', second.status === 409 && (second.body.error as Record<string, unknown>)?.code === 'busy');

  const progress = await get('/api/basic/progress?from=0');
  ok('progress copies the live output', progress.body.text === 'tick 1' && progress.body.from === 6);

  const stop = await post('/api/basic/stop', {});
  ok('the stop reaches the wrapper', stop.body.ok === true && Boolean(pwKilled));

  await wait(240);
  const after = await get('/api/basic/state');
  ok('the ending clears busy on its own', after.body.busy === false);
  ok('the booking popped at the end', rm.calls.some((c) => c.path === '/api/bookings/b1/pop'));
  const registered = state.calls.filter((c) => c.path === '/api/state/register').map((c) => (c.body as Record<string, unknown>)?.name);
  ok('state held the run record', registered.includes('Basic.Run.demo'));
  ok('state held the tab visual', registered.includes('Basic'));

  const step = await fetch(server.url + '/');
  ok('the UI page is served', step.status === 200 && (await step.text()).includes('<html'));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[basicServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));

  await server.stop();
  await Promise.all([services.close(), pw.close(), rm.close(), state.close()]);
}
