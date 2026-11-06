/**
 * @module eventHandler
 * @description THE CORE — register events, fire them, log everything.
 *              `register(name, handler)` puts an event on the palette; `trigger(name, payload)`
 *              fires it FIRE-AND-FORGET — the caller never waits — and the outcome lands as
 *              its OWN event (`<name>.result` or `<name>.error`) written by this module's wrap.
 * @intent Operator rulings (2026-09-16): the SAME path serves a user click and an agent
 *         (MCP) trigger — one door; only events that DO something exist here (nothing
 *         mousemove-class ever registers); the log is one rolling file at the path the host
 *         passes. Generic for all projects — no project words inside.
 */

import { createLogStore } from './logStore.js';
import type { LogLine, LogReadOptions, LogReadResult, LogSource, LogStore, PurgeResult, LogStats } from './logStore.js';

// --- Interface Definitions ---

export interface EventMeta {
  /** What this event does — shown on the palette the agent reads. */
  description?: string;
}

export type EventHandlerFn = (payload: unknown, info: { name: string; source: LogSource }) => unknown;

export interface RegisteredEvent {
  name: string;
  description: string | null;
  registeredAt: string;
  fired: number;
  results: number;
  errors: number;
  lastAt: string | null;
}

export interface TriggerOptions {
  /** Who fires it: a user action, the agent (MCP), the process itself, or the system. */
  source?: LogSource;
}

export interface TriggerReceipt {
  ok: boolean;
  /** Refused reason when ok is false. */
  code?: 'no_such_event';
  name: string;
  at: string;
  source: LogSource;
}

export interface EventHandlerOptions {
  /** THE path — where events are logged (one rolling JSONL file). Required. */
  logPath: string;
  /** Keep events younger than this many hours (default 24). */
  retentionHours?: number;
  /** Keep the file under this many BYTES (default 8 MiB). */
  maxBytes?: number;
  /** How often the self-trim runs, in ms (default 10 min; 0 disables). */
  purgeIntervalMs?: number;
}

export type EventWatcher = (line: LogLine) => void;

interface EventSlot {
  handler: EventHandlerFn;
  meta: EventMeta;
  registeredAt: string;
  fired: number;
  results: number;
  errors: number;
  lastAt: string | null;
}

/** Letters/digits/._- and spaces (the operator's phrases) — outcome names ('<name>.result'/'.error') are reserved. */
const NAME_RE = /^[a-z0-9][a-z0-9._\- ]{0,63}$/i;

// --- Function Definitions ---

export class EventHandler {
  private store: LogStore;
  private events = new Map<string, EventSlot>();
  private watchers = new Set<EventWatcher>();

  constructor(options: EventHandlerOptions) {
    this.store = createLogStore({
      file: options.logPath,
      retentionHours: options.retentionHours,
      maxBytes: options.maxBytes,
      purgeIntervalMs: options.purgeIntervalMs,
    });
  }

  /** Create the log file, trim it once, arm the periodic self-trim. */
  start(): this {
    this.store.start();
    return this;
  }

  /** Put an event on the palette. The handler IS the action. */
  register(name: string, handler: EventHandlerFn, meta: EventMeta = {}): RegisteredEvent {
    if (!NAME_RE.test(name)) {
      throw new Error(`bad event name: ${name} — letters/digits/._- and spaces only`);
    }
    if (name.endsWith('.result') || name.endsWith('.error')) {
      throw new Error(`name ${name} is reserved for outcome events`);
    }
    if (this.events.has(name)) {
      throw new Error(`event already registered: ${name}`);
    }
    this.events.set(name, {
      handler,
      meta,
      registeredAt: new Date().toISOString(),
      fired: 0,
      results: 0,
      errors: 0,
      lastAt: null,
    });
    return this.describe(name) as RegisteredEvent;
  }

  unregister(name: string): boolean {
    return this.events.delete(name);
  }

  has(name: string): boolean {
    return this.events.has(name);
  }

  /** The palette — what can be fired here. */
  list(): RegisteredEvent[] {
    return Array.from(this.events.keys())
      .sort()
      .map((name) => this.describe(name))
      .filter((row): row is RegisteredEvent => row !== null);
  }

  private describe(name: string): RegisteredEvent | null {
    const slot = this.events.get(name);
    if (!slot) return null;
    return {
      name,
      description: slot.meta.description ?? null,
      registeredAt: slot.registeredAt,
      fired: slot.fired,
      results: slot.results,
      errors: slot.errors,
      lastAt: slot.lastAt,
    };
  }

  /** THE ONE DOOR — a user click and an agent trigger walk the same path. Fire-and-forget. */
  trigger(name: string, payload?: unknown, options: TriggerOptions = {}): TriggerReceipt {
    const slot = this.events.get(name);
    const source = options.source ?? 'process';
    const at = new Date().toISOString();
    if (!slot) {
      return { ok: false, code: 'no_such_event', name, at, source };
    }
    const line: LogLine = { t: at, name, source };
    if (payload !== undefined) line.payload = payload;
    this.write(line);
    slot.fired++;
    slot.lastAt = at;

    // THE WRAP — the caller never waits; the outcome becomes its own event.
    Promise.resolve()
      .then(() => slot.handler(payload, { name, source }))
      .then((result) => {
        slot.results++;
        const done: LogLine = { t: new Date().toISOString(), name: `${name}.result`, of: name, source };
        if (result !== undefined) done.result = result;
        this.write(done);
      })
      .catch((err: unknown) => {
        slot.errors++;
        const message = err instanceof Error ? err.message : String(err);
        this.write({ t: new Date().toISOString(), name: `${name}.error`, of: name, source, error: message });
      });

    return { ok: true, name, at, source };
  }

  private write(line: LogLine): void {
    this.store.append(line);
    for (const watcher of Array.from(this.watchers)) {
      try {
        watcher(line);
      } catch {
        /* a bad watcher never breaks the record */
      }
    }
  }

  /** Watch the log live. Returns the unsubscribe. */
  on(watcher: EventWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  read(options: LogReadOptions = {}): LogReadResult {
    return this.store.read(options);
  }

  purge(): PurgeResult {
    return this.store.purge();
  }

  stats(): LogStats {
    return this.store.stats();
  }

  close(): void {
    this.store.stop();
  }
}

export function createEventHandler(options: EventHandlerOptions): EventHandler {
  return new EventHandler(options);
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = (await import('node:fs')).mkdtempSync(path.join(os.tmpdir(), 'eh-core-'));
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const waitFor = async (cond: () => boolean, ms = 5000): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return cond();
  };

  const handler = createEventHandler({ logPath: path.join(dir, 'events.log'), purgeIntervalMs: 0 });
  handler.start();

  // 1. the palette
  ok('empty palette at start', handler.list().length === 0);
  handler.register('tick', (payload) => ({ echo: payload, ok: true }), { description: 'a demo tick' });
  const pal = handler.list();
  ok('register lands on the palette', pal.length === 1 && pal[0].name === 'tick' && pal[0].description === 'a demo tick');
  ok(
    'a duplicate is refused',
    (() => {
      try {
        handler.register('tick', () => 0);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok(
    'a bad name is refused',
    (() => {
      try {
        handler.register('bad name!', () => 0);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok(
    'a phrase name carries spaces (the operator says it that way)',
    (() => {
      try {
        handler.register('add Process Console Display', () => 0);
        return handler.list().some((e) => e.name === 'add Process Console Display');
      } catch {
        return false;
      }
    })(),
  );
  ok(
    'a reserved outcome suffix is refused',
    (() => {
      try {
        handler.register('x.result', () => 0);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // 2. trigger — the fire-and-forget receipt
  const rec = handler.trigger('tick', { n: 7 }, { source: 'user' });
  ok('the receipt answers immediately', rec.ok === true && rec.source === 'user' && rec.name === 'tick' && typeof rec.at === 'string');
  const unknown = handler.trigger('nope');
  ok('an unknown event is refused with a code', unknown.ok === false && unknown.code === 'no_such_event');

  // 3. the outcome is its OWN event
  ok('the outcome event lands', await waitFor(() => handler.read({ name: 'tick.result', limit: 5 }).matched === 1));
  const outcome = handler.read({ name: 'tick.result', limit: 1 }).lines[0];
  ok('the outcome carries of + result', outcome.of === 'tick' && JSON.stringify(outcome.result) === JSON.stringify({ echo: { n: 7 }, ok: true }));
  const triggerLine = handler.read({ name: 'tick', limit: 1 }).lines[0];
  ok('the trigger line kept payload + source', JSON.stringify(triggerLine.payload) === JSON.stringify({ n: 7 }) && triggerLine.source === 'user');

  // 4. the error path is its own event too
  handler.register('boom', () => {
    throw new Error('on purpose');
  });
  handler.trigger('boom', undefined, { source: 'agent' });
  ok('the error event lands', await waitFor(() => handler.read({ name: 'boom.error', limit: 5 }).matched === 1));
  const errLine = handler.read({ name: 'boom.error', limit: 1 }).lines[0];
  ok('the error carries the message + source', errLine.error === 'on purpose' && errLine.source === 'agent');

  // 5. a slow handler never blocks the caller
  let finished = false;
  handler.register('slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    finished = true;
    return 'late';
  });
  const t0 = Date.now();
  const slowRec = handler.trigger('slow');
  const elapsed = Date.now() - t0;
  ok('the caller is not made to wait', slowRec.ok === true && elapsed < 100, String(elapsed));
  ok('the slow outcome still lands later', await waitFor(() => finished && handler.read({ name: 'slow.result', limit: 5 }).matched === 1));

  // 6. watchers see lines live; counters tell the truth
  const seen: string[] = [];
  const off = handler.on((line) => seen.push(line.name));
  handler.trigger('tick', { n: 8 });
  ok('a watcher sees the trigger immediately', seen.includes('tick'));
  ok('a watcher sees the outcome too', await waitFor(() => seen.includes('tick.result')));
  off();
  handler.trigger('tick');
  const sawAfterOff = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  ok('unsubscribe stops the flow', seen.length === sawAfterOff);
  ok(
    'counters: fired / results / errors',
    await waitFor(() => {
      const row = handler.list().find((e) => e.name === 'tick');
      return row !== undefined && row.fired === 3 && row.results === 3;
    }),
  );
  const boomRow = handler.list().find((e) => e.name === 'boom');
  ok('the error counter caught the throw', boomRow !== undefined && boomRow.errors === 1 && boomRow.results === 0);

  handler.close();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[eventHandler] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
