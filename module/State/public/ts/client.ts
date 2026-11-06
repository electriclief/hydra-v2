/**
 * @module client
 * @description The ES-module client for the API — fetch in Node or the browser, one SSE
 *              reader, API errors thrown as StateError carrying the server's own code.
 * @intent The page imports the SAME client the tests use — one implementation, no drift.
 */

import type { PullAnswer, RegisterOptions, StateEntryInfo, StateSummary } from './stateRegistry.js';

// --- Interface Definitions ---

export interface StateClientOptions {
  baseUrl?: string;
  token?: string | null;
}

export interface StateListing {
  ok: boolean;
  query: string | null;
  entries: StateEntryInfo[];
  summary: StateSummary;
}

export interface ChangeFrame {
  t: string;
  kind: 'registered' | 'updated' | 'dropped';
  path: string;
  reason?: string;
}

export interface StreamHandlers {
  onReady?: () => void;
  onChange?: (frame: ChangeFrame) => void;
}

export interface StateClient {
  health(): Promise<Record<string, unknown>>;
  discover(query?: string): Promise<StateListing>;
  pull(name: string, marks?: Record<string, number | string>): Promise<PullAnswer>;
  /** Register JSON standing only (functions cannot ride the wire). */
  register(name: string, content: unknown, standing?: Pick<RegisterOptions, 'serving' | 'render' | 'update'>): Promise<{ ok: boolean; entry: StateEntryInfo }>;
  drop(name: string): Promise<{ ok: boolean; dropped: boolean; name: string }>;
  /** Consume the live change feed until the signal aborts. Resolves when the stream ends. */
  stream(handlers: StreamHandlers, signal?: AbortSignal): Promise<void>;
}

export class StateError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'StateError';
    this.code = code;
    this.status = status;
  }
}

// --- Function Definitions ---

/** Split an SSE body into {event, data} frames as they arrive. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (dataLines.length || event !== 'message') yield { event, data: dataLines.join('\n') };
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createStateClient(options: StateClientOptions = {}): StateClient {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8127').replace(/\/+$/, '');
  const token = options.token ?? null;

  async function api<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(baseUrl + pathName);
    if (token) url.searchParams.set('token', token);
    const res = await fetch(url, init);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new StateError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'http_error', res.status);
    }
    return data as T;
  }

  return {
    health: () => api<Record<string, unknown>>('/health'),

    discover: (query) => api<StateListing>('/api/state' + (query ? '?q=' + encodeURIComponent(query) : '')),

    pull: (name, marks) => {
      const params = new URLSearchParams({ name });
      if (marks && Object.keys(marks).length) params.set('marks', JSON.stringify(marks));
      return api<PullAnswer>('/api/state/pull?' + params.toString());
    },

    register: (name, content, standing = {}) =>
      api<{ ok: boolean; entry: StateEntryInfo }>('/api/state/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, content, serving: standing.serving, render: standing.render, update: standing.update }),
      }),

    drop: (name) =>
      api<{ ok: boolean; dropped: boolean; name: string }>('/api/state/drop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),

    stream: async (handlers, signal) => {
      const suffix = token ? '?token=' + encodeURIComponent(token) : '';
      const res = await fetch(baseUrl + '/api/state/stream' + suffix, { signal });
      if (!res.ok || !res.body) throw new StateError(`stream refused (HTTP ${res.status})`, 'stream_failed', res.status);
      for await (const frame of parseSse(res.body)) {
        if (frame.event === 'ready') {
          handlers.onReady?.();
          continue;
        }
        if (frame.event === 'change') {
          try {
            handlers.onChange?.(JSON.parse(frame.data) as ChangeFrame);
          } catch {
            /* a frame we cannot parse is skipped, never fatal */
          }
        }
      }
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const { createStateRegistry } = await import('./stateRegistry.js');
  const { startApiServer } = await import('./apiServer.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const state = createStateRegistry();
  state.register('demo.entry', { a: 1, log: 'p1\np2\np3' }, { serving: { log: 'delta' } });
  const api = await startApiServer({ state, port: 0 });
  const client = createStateClient({ baseUrl: api.url });

  const health = (await client.health()) as { ok?: boolean };
  ok('health through the client', health.ok === true);

  const listing = await client.discover();
  ok('discover through the client', listing.entries.length === 1 && listing.entries[0].path === 'demo.entry');

  const full = await client.pull('demo.entry');
  ok('pull through the client answers full + mark', full.ok === true && (full as unknown as { marks: { log: number } }).marks.log === 3);
  const delta = await client.pull('demo.entry', { log: 1 });
  ok('a marked pull answers the delta', delta.ok === true && delta.full === false && (delta as { content: { log: string } }).content.log === 'p2\np3');

  const registered = await client.register('client.obj', { n: 9 }, { serving: { n: 'delta' } });
  ok('register through the client', registered.ok === true && registered.entry.serving.n === 'delta');

  let refused: StateError | null = null;
  try {
    await client.pull('nope');
  } catch (err) {
    refused = err instanceof StateError ? err : null;
  }
  ok('an unknown entry throws with the server code', refused !== null && refused.code === 'no_such_entry', refused ? refused.code : 'no throw');

  // the live feed — one registration, seen through the client
  const controller = new AbortController();
  const seen: string[] = [];
  let ready = false;
  const pump = client
    .stream({ onReady: () => { ready = true; }, onChange: (frame) => seen.push(frame.kind + ':' + frame.path) }, controller.signal)
    .catch(() => { /* aborted at the end */ });
  for (let i = 0; i < 40 && !ready; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  await client.register('live.one', { x: 1 });
  for (let i = 0; i < 40 && seen.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  ok('the stream said ready', ready);
  ok('the stream carried the change', seen.includes('registered:live.one'), seen.join(','));
  controller.abort();
  await pump;

  const dropped = await client.drop('live.one');
  ok('drop through the client', dropped.dropped === true);

  await api.stop();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
