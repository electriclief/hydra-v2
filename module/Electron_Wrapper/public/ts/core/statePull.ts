/**
 * @module statePull
 * @description The optional fancy layer: the wrapper PULLS each tab's state from a
 *              State module door and hands the reading to the caller. Tolerant on
 *              purpose — a missing entry, a refused pull, a door that is down: the tab
 *              simply reads solid. The wrapper runs no clocks of its own beyond this
 *              pull cadence, keeps no memory of who asked, and decides nothing.
 * @intent "Electron_Wrapper must expect to pull from state… to match state logic."
 *         Present when pointed at a state door; absent is fine forever.
 */

import { applySnapshot, type TabVisualEntry } from './visuals.js';
import http from 'node:http';

// --- Interface Definitions ---

export interface StatePullOptions {
  /** The state door, e.g. "http://127.0.0.1:8127". */
  endpoint: string;
  /** Pull cadence; default 1500 ms. */
  intervalMs?: number;
  /** What to ask for — the wrapper asks by each registered tab's name. */
  names: () => string[];
  onSnapshot: (entries: TabVisualEntry[], snapshot: Record<string, unknown>) => void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface StatePuller {
  pullOnce(): Promise<Record<string, unknown>>;
  start(): void;
  stop(): void;
  running(): boolean;
}

// --- Function Definitions ---

/** The value a state entry carries, unwrapped from the shaped reply. */
export function extractVisualValue(content: unknown): unknown {
  if (content === null || typeof content !== 'object') return content;
  const o = content as Record<string, unknown>;
  if (o.value !== undefined) return o.value;
  if (o.visual !== undefined) return o.visual;
  if (o.state !== undefined) return o.state;
  return content;
}

export function createStatePuller(options: StatePullOptions): StatePuller {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const intervalMs = options.intervalMs ?? 1500;
  const fetchImpl = options.fetchImpl ?? fetch;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function pullOnce(): Promise<Record<string, unknown>> {
    const snapshot: Record<string, unknown> = {};
    for (const name of options.names()) {
      try {
        const res = await fetchImpl(`${endpoint}/api/state/pull?name=${encodeURIComponent(name)}`);
        if (!res.ok) continue; // absent reads as absence
        const body = (await res.json()) as { ok?: boolean; content?: unknown };
        if (!body || body.ok !== true || body.content === undefined) continue;
        snapshot[name] = extractVisualValue(body.content);
      } catch {
        // the door is down or the reply was garbled — that name simply reads solid
      }
    }
    options.onSnapshot(applySnapshot(options.names(), snapshot), snapshot);
    return snapshot;
  }

  return {
    pullOnce,
    start(): void {
      if (timer !== null) return;
      void pullOnce();
      timer = setInterval(() => {
        void pullOnce();
      }, intervalMs);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        (timer as { unref?: () => void }).unref?.();
      }
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    running(): boolean {
      return timer !== null;
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL statePull :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  // A REAL little door on a REAL ephemeral port. Never a mock.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://placeholder');
    if (url.pathname !== '/api/state/pull') {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    const name = url.searchParams.get('name') ?? '';
    const table: Record<string, unknown> = {
      alpha: { ok: true, content: { value: 'flashing' } },
      beta: { ok: true, content: { state: 'highlighted' } },
      gamma: { ok: true, content: 'solid' },
    };
    if (!(name in table)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'no such entry' }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(table[name]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${addr.port}`;

  const names = ['alpha', 'beta', 'gamma', 'delta'];
  let lastEntries: TabVisualEntry[] = [];
  let snapshots = 0;
  const puller = createStatePuller({
    endpoint,
    names: () => names,
    onSnapshot: (entries) => {
      lastEntries = entries;
      snapshots += 1;
    },
  });

  const snap = await puller.pullOnce();
  ok('a pull reads the door', snapshots === 1 && Object.keys(snap).length === 3);
  ok('a value field reads flashing', lastEntries.find((e) => e.name === 'alpha')?.visual === 'flashing');
  ok('a state field reads highlighted', lastEntries.find((e) => e.name === 'beta')?.visual === 'highlighted');
  ok('a plain content string reads solid', lastEntries.find((e) => e.name === 'gamma')?.visual === 'solid');
  ok('a missing entry reads solid (absence is absence)', lastEntries.find((e) => e.name === 'delta')?.visual === 'solid');
  ok('the snapshot carries only what the door served', !('delta' in snap));

  await new Promise<void>((resolve) => server.close(() => resolve()));
  const dead = await puller.pullOnce();
  ok('a door that is down is tolerated quietly', Object.keys(dead).length === 0 && snapshots === 2);
  ok('and every tab reads solid', lastEntries.every((e) => e.visual === 'solid'));

  puller.start();
  const wasRunning = puller.running();
  puller.stop();
  ok('start() runs and stop() clears', wasRunning === true && puller.running() === false);
}
