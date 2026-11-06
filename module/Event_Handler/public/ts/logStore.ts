/**
 * @module logStore
 * @description The event log: ONE rolling JSONL file — append, read, tail, filter, purge.
 *              It keeps itself small: lines older than the retention window are trimmed,
 *              and the file never grows past the byte ceiling (oldest lines go first).
 * @intent Operator ruling (2026-09-16): the log holds only events that DO something and is
 *         not needed beyond ~a day — it is purged periodically and stays bounded. One file,
 *         at the path the host passes; the store owns it and rewrites it atomically.
 */

import fs from 'node:fs';
import path from 'node:path';

// --- Interface Definitions ---

export type LogSource = 'user' | 'agent' | 'process' | 'system';

/** One line of the log — the record. */
export interface LogLine {
  /** ISO time the event was logged. */
  t: string;
  /** The event's name (a trigger) or `<name>.result` / `<name>.error` (its outcome). */
  name: string;
  /** Who caused it. */
  source: LogSource;
  /** Free-form payload — present only when the caller gave one. */
  payload?: unknown;
  /** For outcome lines: the trigger they belong to. */
  of?: string;
  /** For `<name>.result` lines: what the handler returned. */
  result?: unknown;
  /** For `<name>.error` lines: what the handler threw. */
  error?: string;
}

export interface LogStoreOptions {
  /** The one file this store owns (created on start). */
  file: string;
  /** Keep events younger than this many hours (default 24). */
  retentionHours?: number;
  /** Keep the file under this many BYTES — oldest lines go first (default 8 MiB). */
  maxBytes?: number;
  /** How often the self-trim runs, in ms (default 10 min; 0 disables the timer). */
  purgeIntervalMs?: number;
}

export interface LogReadOptions {
  /** Last N matching lines (default 200; capped at 5000). */
  limit?: number;
  /** Only lines with t >= since (epoch ms). */
  since?: number;
  /** Exact name match. */
  name?: string;
  /** Exact source match. */
  source?: string;
}

export interface LogReadResult {
  lines: LogLine[];
  matched: number;
  fileBytes: number;
}

export interface PurgeResult {
  before: number;
  after: number;
  removed: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface LogStats {
  file: string;
  bytes: number;
  lines: number;
  retentionHours: number;
  maxBytes: number;
}

// --- Function Definitions ---

/** Parse one file line tolerantly — bad lines are skipped, never thrown over. */
function parseLine(text: string): LogLine | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as LogLine;
    if (typeof obj === 'object' && obj !== null && typeof obj.t === 'string' && typeof obj.name === 'string' && typeof obj.source === 'string') {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}

export class LogStore {
  private file: string;
  private retentionHours: number;
  private maxBytes: number;
  private purgeIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private appendsSinceSizeCheck = 0;

  constructor(options: LogStoreOptions) {
    this.file = options.file;
    this.retentionHours = options.retentionHours ?? 24;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.purgeIntervalMs = options.purgeIntervalMs ?? 10 * 60_000;
  }

  /** Create the file if missing, trim it once, and arm the periodic self-trim. */
  start(): this {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '');
    this.purge();
    if (this.purgeIntervalMs > 0) {
      this.timer = setInterval(() => this.purge(), this.purgeIntervalMs);
      this.timer.unref?.();
    }
    return this;
  }

  /** Append one line. The size check rides every 64th append (throttled, cheap). */
  append(line: LogLine): void {
    if (this.closed) return;
    try {
      fs.appendFileSync(this.file, JSON.stringify(line) + '\n');
    } catch {
      return; // fail-soft: a broken disk must never break the caller
    }
    this.appendsSinceSizeCheck++;
    if (this.appendsSinceSizeCheck >= 64) {
      this.appendsSinceSizeCheck = 0;
      try {
        if (fs.statSync(this.file).size > this.maxBytes) this.purge();
      } catch {
        /* a racing foreign writer — ignore */
      }
    }
  }

  /** The file, parsed; or the last N matching lines. */
  read(options: LogReadOptions = {}): LogReadResult {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 5000));
    let raw = '';
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      raw = '';
    }
    const all: LogLine[] = [];
    for (const text of raw.split('\n')) {
      const parsed = parseLine(text);
      if (parsed) all.push(parsed);
    }
    const matched = all.filter((line) => {
      if (options.name && line.name !== options.name) return false;
      if (options.source && line.source !== options.source) return false;
      if (options.since && Date.parse(line.t) < options.since) return false;
      return true;
    });
    return {
      lines: matched.slice(-limit),
      matched: matched.length,
      fileBytes: Buffer.byteLength(raw),
    };
  }

  /** Trim to the retention window AND under the byte ceiling. Atomic rewrite (tmp + rename). */
  purge(): PurgeResult {
    let raw = '';
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      raw = '';
    }
    const bytesBefore = Buffer.byteLength(raw);
    const lines = raw.split('\n').filter(Boolean);
    const before = lines.length;

    const cutoff = Date.now() - this.retentionHours * 3_600_000;
    let keep = lines.filter((text) => {
      const parsed = parseLine(text);
      if (!parsed) return false; // corrupt lines do not survive a purge
      return Date.parse(parsed.t) >= cutoff;
    });

    // Byte ceiling: drop from the front until the kept text fits.
    const sizes = keep.map((line) => Buffer.byteLength(line) + 1);
    let bytes = sizes.reduce((sum, n) => sum + n, 0);
    let drop = 0;
    while (keep.length - drop > 1 && bytes > this.maxBytes) {
      bytes -= sizes[drop];
      drop++;
    }
    keep = keep.slice(drop);
    const out = keep.length ? keep.join('\n') + '\n' : '';

    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, this.file);
    } catch {
      /* fail-soft — the old file stays */
    }

    return {
      before,
      after: keep.length,
      removed: before - keep.length,
      bytesBefore,
      bytesAfter: Buffer.byteLength(out),
    };
  }

  stats(): LogStats {
    let raw = '';
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      raw = '';
    }
    const lines = raw.split('\n').filter((line) => parseLine(line) !== null).length;
    return {
      file: this.file,
      bytes: Buffer.byteLength(raw),
      lines,
      retentionHours: this.retentionHours,
      maxBytes: this.maxBytes,
    };
  }

  stop(): void {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function createLogStore(options: LogStoreOptions): LogStore {
  return new LogStore(options);
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-log-'));
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. append + read round trip (a real file)
  const store = createLogStore({ file: path.join(dir, 'events.log'), purgeIntervalMs: 0 });
  store.start();
  const t0 = new Date().toISOString();
  store.append({ t: t0, name: 'tick', source: 'user', payload: { n: 1 } });
  store.append({ t: t0, name: 'tick.result', source: 'user', of: 'tick', result: 42 });
  store.append({ t: t0, name: 'boom', source: 'agent' });
  const all = store.read({ limit: 50 });
  ok('three lines round-trip', all.matched === 3 && all.lines.length === 3, String(all.matched));
  ok('payload survives', (all.lines[0].payload as { n: number }).n === 1);
  ok('result survives', all.lines[1].result === 42 && all.lines[1].of === 'tick');

  // 2. filters
  ok('name filter', store.read({ name: 'boom' }).matched === 1);
  ok('source filter', store.read({ source: 'agent' }).matched === 1);
  ok(
    'limit takes the tail',
    (() => {
      const r = store.read({ limit: 1 });
      return r.lines.length === 1 && r.lines[0].name === 'boom';
    })(),
  );

  // 3. retention purge (a crafted 30-hour-old line)
  const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
  store.append({ t: old, name: 'ancient', source: 'process' });
  const purged = store.purge();
  ok('purge removed the 30 h old line', purged.removed === 1, JSON.stringify(purged));
  ok('purge kept the fresh ones', store.read({ limit: 50 }).matched === 3);

  // 4. byte ceiling
  const small = createLogStore({ file: path.join(dir, 'small.log'), maxBytes: 400, purgeIntervalMs: 0 });
  small.start();
  for (let i = 0; i < 40; i++) small.append({ t: t0, name: 'spam-' + i, source: 'process' });
  small.purge();
  const stats = small.stats();
  ok('byte ceiling holds', stats.bytes <= 400, String(stats.bytes));
  ok(
    'newest survive the trim',
    small.read({ limit: 5 }).lines.some((l) => l.name === 'spam-39'),
    small.read({ limit: 5 }).lines.map((l) => l.name).join(','),
  );

  // 5. corrupt lines never crash the read
  const corrupt = path.join(dir, 'corrupt.log');
  fs.writeFileSync(corrupt, '{nope\n' + JSON.stringify({ t: t0, name: 'fine', source: 'user' }) + '\n');
  const cstore = createLogStore({ file: corrupt, purgeIntervalMs: 0 });
  ok('corrupt line skipped, good line kept', cstore.read({ limit: 10 }).matched === 1);

  store.stop();
  small.stop();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[logStore] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
