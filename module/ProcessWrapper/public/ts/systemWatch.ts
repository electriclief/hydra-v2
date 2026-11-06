/**
 * @module systemWatch
 * @description THE DRAIN WATCH: one sampler child launched through the table (visible,
 *              killable, one life file), one small human log of what was UNEXPECTED or
 *              CPU/DISK-heavy, and a note fired for every drain so the console palette
 *              (and the window) hears it the moment it starts.
 * @intent Operator idea (2026-09-29): the wrapper should NOTICE when something unexpected
 *         slows the machine it lives on -- and keep receipts, so next time the answer is a
 *         log line, not an argument. CPU + hard disks only (never GPU). Small by design:
 *         the watch log holds EVENTS, not samples; the samples live in the sampler's own
 *         life file. "Unexpected" is a TOOL, not a rule: the expected list is a text file
 *         the operator edits; absence from it only ever tags a line, it never hides one.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProcessWrapperService } from './processWrapper.js';

// --- Interface Definitions ---

/** One process in a sample's CPU top list. */
export interface SampleTop { name: string; pid: number; cpu: number }
/** One drive in a sample's disk list. */
export interface SampleDisk { id: string; busy: number; readMBs: number; writeMBs: number }
/** One process in a sample's IO top list. */
export interface SampleIO { name: string; pid: number; readMBs: number; writeMBs: number; ioMBs: number }

/** One sampler line, parsed. Every field optional -- the sampler degrades, never dies. */
export interface WatchSample {
  t?: string;
  cores?: number;
  cpuTotal?: number;
  procs?: number;
  /** The busiest drive, as "<id> <busy>%" -- a convenience the sampler includes. */
  busy?: string;
  top?: SampleTop[];
  disk?: SampleDisk[];
  topIO?: SampleIO[];
  /** Process names never seen before this sample (the sampler owns the seen-set). */
  newNames?: string[];
}

/** One watch event, as logged and (for drains) as fired. */
export interface DrainRecord {
  kind: 'new' | 'drain' | 'episode-end' | 'watch-note';
  at: string;
  name: string;
  pid: number | null;
  cpuPeak: number | null;
  diskPeakMBs: number | null;
  samples: number | null;
  /** True when the name is not on the expected list (tag only -- the line is logged either way). */
  unexpected: boolean;
  detail: string;
  /** The human log line, exactly as appended. */
  line: string;
}

export interface SystemWatchOptions {
  wrapper: ProcessWrapperService;
  /** Where the small logs land (default: <cwd>/data/watch). */
  logDir?: string;
  /** The sampler script (default: <module root>/scripts/system-sampler.ps1). */
  samplerPath?: string;
  /** Seconds between samples (default: 20). */
  intervalSec?: number;
  /** The expected list -- one process name per line, `#` lines ignored (default: <logDir>/expected.txt). */
  expectedFile?: string;
  /** Called for every drain record -- main wires this to the console palette. */
  notify?: (record: DrainRecord) => void;
  /** Start the sampler child (default: true; tests pass false and feed samples by hand). */
  autostart?: boolean;
  /** Silence the [system-watch] stdout notes (tests). */
  quiet?: boolean;
  /** A process is "hot" at or above this CPU percent of the whole machine (default 20). */
  procCpuPct?: number;
  /** ...or at or above this much disk IO per second, MB (default 20). */
  procIOMBs?: number;
  /** The machine itself is "hot" at or above this total CPU percent (default 60). */
  totalCpuPct?: number;
  /** Samples a threshold must hold before a drain is declared (default 2). */
  sustain?: number;
}

/** A snapshot of the watch, for status reads and tests. */
export interface SystemWatchStatus {
  running: boolean;
  samplerId: string | null;
  since: number;
  samples: number;
  records: number;
  logPath: string;
  expectedPath: string;
  intervalSec: number;
}

export interface SystemWatch {
  module: 'systemWatch';
  logDir: string;
  /** Today's drain log (daily files; small by construction -- events only). */
  logPath: string;
  expectedPath: string;
  samplerId: string | null;
  startedAt: number;
  /** Feed one sample (the line handler's core; public so tests can drive it). */
  ingest(sample: WatchSample): DrainRecord[];
  status(): SystemWatchStatus;
  stop(): Promise<void>;
}

// --- Function Definitions ---

/** Parse one sampler line. Null when it is not a sample (banner chatter, junk). */
export function parseSampleLine(line: string): WatchSample | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as WatchSample;
    if (!parsed || typeof parsed !== 'object') return null;
    // The sampler is another program: keep only the shapes this core iterates.
    if (!Array.isArray(parsed.top)) parsed.top = undefined;
    if (!Array.isArray(parsed.topIO)) parsed.topIO = undefined;
    if (!Array.isArray(parsed.newNames)) parsed.newNames = undefined;
    return parsed;
  } catch {
    return null;
  }
}

/** YYYYMMDD for a date -- daily log names. */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

/** Local time, seconds precision, for log lines. */
export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** One log line, fixed shape so it greps: time | kind | name | facts | tags. */
export function formatRecord(rec: Omit<DrainRecord, 'line'>): string {
  const bits: string[] = [rec.at, rec.kind.padEnd(11), rec.name];
  if (rec.pid != null) bits.push(`pid ${rec.pid}`);
  if (rec.detail) bits.push(rec.detail);
  if (rec.unexpected) bits.push('UNEXPECTED');
  return bits.join(' | ');
}

/**
 * The engine of one watch: everything between a sampler line and a log line lives here,
 * without touching the filesystem or the wrapper -- so the tests can drive it directly.
 */
export function createWatchCore(options: {
  expected?: Set<string>;
  procCpuPct?: number;
  procIOMBs?: number;
  totalCpuPct?: number;
  sustain?: number;
  now?: () => Date;
} = {}) {
  const expected = options.expected ?? new Set<string>();
  const procCpuPct = options.procCpuPct ?? 20;
  const procIOMBs = options.procIOMBs ?? 20;
  const totalCpuPct = options.totalCpuPct ?? 60;
  const sustain = Math.max(1, options.sustain ?? 2);
  const now = options.now ?? (() => new Date());

  /** name -> how many consecutive samples it sat above a threshold, and its peaks. */
  const hot = new Map<string, { above: number; cpuPeak: number | null; diskPeak: number | null; firstAt: Date; lastAt: Date }>();
  let samples = 0;

  const isHot = (name: string): boolean => {
    if (name === '(system)') return false;
    return !expected.has(name.toLowerCase());
  };

  const record = (kind: DrainRecord['kind'], name: string, pid: number | null, detail: string, extras: Partial<DrainRecord> = {}): DrainRecord => {
    const base = {
      kind,
      at: stamp(now()),
      name,
      pid,
      cpuPeak: extras.cpuPeak ?? null,
      diskPeakMBs: extras.diskPeakMBs ?? null,
      samples: extras.samples ?? null,
      unexpected: extras.unexpected ?? isHot(name),
      detail,
    };
    return { ...base, line: formatRecord(base) };
  };

  /** Feed one sample; return every record it produced, in order. */
  function ingest(sample: WatchSample): DrainRecord[] {
    samples += 1;
    const out: DrainRecord[] = [];

    // 1. names never seen before -- quiet lines, one per name.
    for (const name of Array.isArray(sample.newNames) ? sample.newNames : []) {
      if (!name) continue;
      out.push(record('new', name, null, 'first seen on this machine life'));
    }

    // 2. hot checks: per process (CPU or IO) and the machine total.
    const pressure = new Map<string, { pid: number | null; cpu: number; io: number }>();
    for (const row of Array.isArray(sample.top) ? sample.top : []) {
      if (!row || !row.name) continue;
      const cell = pressure.get(row.name) ?? { pid: null, cpu: 0, io: 0 };
      cell.cpu = Math.max(cell.cpu, row.cpu ?? 0);
      if (row.pid) cell.pid = row.pid;
      pressure.set(row.name, cell);
    }
    for (const row of Array.isArray(sample.topIO) ? sample.topIO : []) {
      if (!row || !row.name) continue;
      const cell = pressure.get(row.name) ?? { pid: null, cpu: 0, io: 0 };
      cell.io = Math.max(cell.io, row.ioMBs ?? 0);
      if (row.pid) cell.pid = row.pid;
      pressure.set(row.name, cell);
    }
    if ((sample.cpuTotal ?? 0) >= totalCpuPct) {
      const cell = pressure.get('(system)') ?? { pid: null, cpu: 0, io: 0 };
      cell.cpu = sample.cpuTotal ?? 0;
      pressure.set('(system)', cell);
    }

    const seenThisSample = new Set<string>();
    for (const [name, cell] of pressure) {
      const overCpu = cell.cpu >= procCpuPct;
      const overIo = cell.io >= procIOMBs;
      if (!overCpu && !overIo) continue;
      seenThisSample.add(name);
      const state = hot.get(name) ?? { above: 0, cpuPeak: null, diskPeak: null, firstAt: now(), lastAt: now() };
      state.above += 1;
      state.lastAt = now();
      state.cpuPeak = Math.max(state.cpuPeak ?? 0, cell.cpu) || null;
      state.diskPeak = Math.max(state.diskPeak ?? 0, cell.io) || null;
      hot.set(name, state);
      if (state.above === sustain) {
        const ranges: string[] = [];
        if (state.cpuPeak) ranges.push(`cpu peak ${state.cpuPeak}%`);
        if (state.diskPeak) ranges.push(`disk ${state.diskPeak} MB/s`);
        out.push(record('drain', name, cell.pid, `${ranges.join(', ')} held ${state.above} samples${sample.busy ? ', busiest ' + sample.busy : ''}`, {
          cpuPeak: state.cpuPeak,
          diskPeakMBs: state.diskPeak,
          samples: state.above,
        }));
      }
    }

    // 3. anything that was hot and is not anymore -- close the episode, with peaks.
    for (const [name, state] of Array.from(hot)) {
      if (seenThisSample.has(name)) continue;
      if (state.above >= sustain) {
        const ranges: string[] = [];
        if (state.cpuPeak) ranges.push(`cpu peak ${state.cpuPeak}%`);
        if (state.diskPeak) ranges.push(`disk ${state.diskPeak} MB/s`);
        out.push(record('episode-end', name, null, `${ranges.join(', ')} over ${state.above} samples`, {
          cpuPeak: state.cpuPeak,
          diskPeakMBs: state.diskPeak,
          samples: state.above,
        }));
      }
      hot.delete(name);
    }

    return out;
  }

  function watching(): number {
    return hot.size;
  }

  return { ingest, watching, samples: () => samples };
}

/** Read the expected list: one name per line, `#` comments, case-insensitive. */
export function loadExpected(file: string): Set<string> {
  const set = new Set<string>();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '# expected.txt -- one process name per line; names here are KNOWN and are never tagged UNEXPECTED.\n# this is a tool, not a rule: absence tags a line, it never hides one. Edit freely; the watch reads it once per start.\n', 'utf8');
      return set;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      set.add(line.toLowerCase());
    }
  } catch {
    /* an unreadable list means nothing is blessed -- lines still flow, all tagged */
  }
  return set;
}

/**
 * Build the watch for one wrapper, in this thread. Launches the sampler through the
 * table (NOTHING HIDDEN -- it is a named child with a life file), consumes its lines,
 * appends one tiny log line per event, and fires `notify` for every drain.
 */
export async function createSystemWatch(options: SystemWatchOptions): Promise<SystemWatch> {
  const wrapper = options.wrapper;
  const logDir = options.logDir ?? path.join(process.cwd(), 'data', 'watch');
  fs.mkdirSync(logDir, { recursive: true });
  const expectedPath = options.expectedFile ?? path.join(logDir, 'expected.txt');
  const intervalSec = Math.max(3, options.intervalSec ?? 20);
  const samplerPath = options.samplerPath ?? fileURLToPath(new URL('../../scripts/system-sampler.ps1', import.meta.url));
  const quiet = options.quiet === true;
  const expected = loadExpected(expectedPath);

  const core = createWatchCore({
    expected,
    procCpuPct: options.procCpuPct,
    procIOMBs: options.procIOMBs,
    totalCpuPct: options.totalCpuPct,
    sustain: options.sustain,
  });

  const startedAt = Date.now();
  let records = 0;
  let restarts = 0;
  let stopping = false;
  let samplerId: string | null = null;

  const logPathFor = (d: Date): string => path.join(logDir, `watch-${dayKey(d)}.log`);

  const writeRecord = (rec: DrainRecord): void => {
    const full = rec.line ? rec : { ...rec, line: formatRecord(rec) };
    records += 1;
    try {
      fs.appendFileSync(logPathFor(new Date()), full.line + '\n', 'utf8');
    } catch {
      /* the log is best-effort; the console note below still leaves a trace */
    }
    if (!quiet) console.log('[system-watch] ' + full.line);
    if (full.kind === 'drain' && options.notify) {
      try {
        options.notify(full);
      } catch {
        /* the notifier is a guest -- it can never take the watch down */
      }
    }
  };

  const onLine = (ev: { id: string; channel: string; line: string }): void => {
    if (ev.id !== samplerId || ev.channel !== 'stdout') return;
    const sample = parseSampleLine(ev.line);
    if (!sample) return;
    let produced: DrainRecord[] = [];
    try {
      produced = core.ingest(sample);
    } catch {
      /* a sample shape the core refuses must never take the wrapper's thread down */
      return;
    }
    for (const rec of produced) writeRecord(rec);
  };

  const onExit = (rec: { id: string; life: string; exitCode: number | null; error: string | null }): void => {
    if (rec.id !== samplerId || stopping) return;
    const why = rec.error ?? `exit code ${rec.exitCode}`;
    if (restarts < 3) {
      restarts += 1;
      writeRecord({
        kind: 'watch-note',
        at: stamp(new Date()),
        name: 'system-watch',
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: `sampler ended (${why}) -- restarting (${restarts}/3)`,
        line: '',
      });
      startSampler();
    } else {
      writeRecord({
        kind: 'watch-note',
        at: stamp(new Date()),
        name: 'system-watch',
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: 'sampler ended 3 times -- the watch is BLIND until restart',
        line: '',
      });
    }
  };

  function startSampler(): void {
    try {
      const rec = wrapper.launch({
        name: 'system-watch',
        tag: 'watch',
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', samplerPath, '-IntervalSec', String(intervalSec)],
      });
      samplerId = rec.id;
    } catch (err) {
      samplerId = null;
      writeRecord({
        kind: 'watch-note',
        at: stamp(new Date()),
        name: 'system-watch',
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: `sampler could not launch: ${(err as Error).message}`,
        line: '',
      });
    }
  }

  wrapper.on('line', onLine);
  wrapper.on('exit', onExit);

  if (options.autostart !== false) startSampler();

  return {
    module: 'systemWatch',
    logDir,
    get logPath() {
      return logPathFor(new Date());
    },
    expectedPath,
    get samplerId() {
      return samplerId;
    },
    startedAt,
    ingest: (sample: WatchSample) => {
      const out = core.ingest(sample);
      for (const rec of out) writeRecord(rec);
      return out;
    },
    status: () => ({
      running: !stopping,
      samplerId,
      since: startedAt,
      samples: core.samples(),
      records,
      logPath: logPathFor(new Date()),
      expectedPath,
      intervalSec,
    }),
    stop: async () => {
      stopping = true;
      wrapper.off('line', onLine);
      wrapper.off('exit', onExit);
      if (samplerId) {
        const rec = wrapper.get(samplerId);
        if (rec && (rec.life === 'running' || rec.life === 'starting')) {
          try {
            await wrapper.kill(samplerId, { force: true, graceMs: 1500 });
          } catch {
            /* already gone */
          }
        }
      }
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const { createWrapper } = await import('./processWrapper.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. parseSampleLine: real lines in, junk out
  ok('a real sample line parses', parseSampleLine('{"t":"2026-09-29 10:00:00","cpuTotal":12.5,"top":[{"name":"chrome","pid":1,"cpu":20}]}')?.cpuTotal === 12.5);
  ok('junk is null', parseSampleLine('not json at all') === null && parseSampleLine('') === null && parseSampleLine('{broken') === null);

  // 2. the core, driven by hand -- the exact user story: something NEW arrives and DRAINS
  const core = createWatchCore({ sustain: 2 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-watch-'));
  const fired: DrainRecord[] = [];

  const first = core.ingest({ cpuTotal: 10, top: [{ name: 'chrome', pid: 100, cpu: 4 }], newNames: ['chrome', 'notepad'] });
  ok('first sample: new names are recorded', first.filter((r) => r.kind === 'new').length === 2, JSON.stringify(first.map((r) => r.kind)));
  ok('a quiet new name is not a drain', first.every((r) => r.kind !== 'drain'));
  const second = core.ingest({ cpuTotal: 30, top: [{ name: 'notepad', pid: 101, cpu: 25 }], newNames: [] });
  ok('one hot sample is not yet a drain (sustain 2)', second.every((r) => r.kind !== 'drain'), JSON.stringify(second.map((r) => r.kind)));
  const third = core.ingest({ cpuTotal: 55, top: [{ name: 'notepad', pid: 101, cpu: 27 }], newNames: [] });
  const drains = third.filter((r) => r.kind === 'drain');
  ok('the second hot sample is the drain', drains.length === 1 && drains[0].name === 'notepad', JSON.stringify(third.map((r) => r.kind)));
  ok('the drain carries the cpu peak', drains[0].cpuPeak === 27, String(drains[0].cpuPeak));
  ok('an unblessed name is tagged UNEXPECTED', drains[0].unexpected === true);
  const fourth = core.ingest({ cpuTotal: 12, top: [{ name: 'chrome', pid: 100, cpu: 3 }], newNames: [] });
  const ends = fourth.filter((r) => r.kind === 'episode-end');
  ok('cooling closes the episode, with the peak', ends.length === 1 && ends[0].name === 'notepad' && ends[0].cpuPeak === 27, JSON.stringify(ends));

  // 3. a blessed name is never UNEXPECTED (the tool tags, it never hides)
  const blessed = createWatchCore({ sustain: 1, expected: new Set(['mbamservice']) });
  const blessedOut = blessed.ingest({ cpuTotal: 30, top: [{ name: 'MBAMService', pid: 7, cpu: 22 }], newNames: [] });
  ok('a blessed name still gets its drain line', blessedOut.some((r) => r.kind === 'drain' && r.name === 'MBAMService'));
  ok('...but it is not tagged UNEXPECTED', blessedOut.find((r) => r.kind === 'drain')?.unexpected === false);

  // 4. the machine-total episode is caught too
  const total = createWatchCore({ sustain: 2, totalCpuPct: 60 });
  total.ingest({ cpuTotal: 70, top: [{ name: 'a', pid: 1, cpu: 20 }], newNames: [] });
  const totalOut = total.ingest({ cpuTotal: 75, top: [{ name: 'a', pid: 1, cpu: 25 }], newNames: [] });
  ok('a hot machine total is a drain on its own', totalOut.some((r) => r.kind === 'drain' && r.name === '(system)'), JSON.stringify(totalOut.map((r) => r.name)));

  // 5. the log line shape: greppable, one line per event
  const shape = formatRecord({ kind: 'drain', at: '2026-09-29 10:00:00', name: 'chrome', pid: 42, cpuPeak: 30, diskPeakMBs: null, samples: 2, unexpected: true, detail: 'cpu peak 30%' });
  ok('log lines are pipe-delimited and tagged', shape.includes(' | drain ') && shape.includes('chrome') && shape.endsWith('UNEXPECTED'), shape);

  // 6. expected.txt: created on first run, `#` lines ignored, case-insensitive
  const expFile = path.join(dir, 'expected.txt');
  const emptyExpected = loadExpected(expFile);
  ok('a missing expected list is created, empty', fs.existsSync(expFile) && emptyExpected.size === 0);
  fs.writeFileSync(expFile, '# comment\nBrave\n\nmbamservice\n', 'utf8');
  const loaded = loadExpected(expFile);
  ok('the list reads names, skips comments, lowercases', loaded.has('brave') && loaded.has('mbamservice') && loaded.size === 2, String(loaded.size));

  // 7. a REAL sampler line, from a REAL launch through a REAL wrapper (the honest check)
  const wrapper = createWrapper({ streamDir: path.join(dir, 'streams'), graceMs: 500 });
  const samplerPath = fileURLToPath(new URL('../../scripts/system-sampler.ps1', import.meta.url));
  const once = wrapper.launch({
    name: 'sampler-once',
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', samplerPath, '-Once'],
  });
  await wrapper.awaitExit(once.id, 30000);
  const text = wrapper.output(once.id).text.trim();
  const line = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop() ?? '';
  const sample = parseSampleLine(line);
  ok('the real sampler emits a parseable line', sample !== null, JSON.stringify(text.slice(0, 160)));
  ok('the sample carries cpu + top + disk + io', Boolean(sample && typeof sample.cpuTotal === 'number' && Array.isArray(sample.top) && Array.isArray(sample.disk) && Array.isArray(sample.topIO)), JSON.stringify(sample)?.slice(0, 200));
  ok('the sample names this machine\'s drives', Boolean(sample && sample.disk && sample.disk.some((d) => /C:/.test(d.id))), JSON.stringify(sample?.disk));

  // 8. the watch end-to-end over a real wrapper: sampler child in the TABLE, line -> log
  const watch = await createSystemWatch({
    wrapper,
    logDir: path.join(dir, 'watch'),
    expectedFile: path.join(dir, 'watch', 'expected.txt'),
    intervalSec: 3,
    quiet: true,
    notify: (r) => fired.push(r),
  });
  ok('the sampler is a child IN the table (nothing hidden)', Boolean(watch.samplerId && wrapper.get(watch.samplerId)), String(watch.samplerId));
  const gotSample = await new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (watch.status().samples >= 1) return resolve(true);
      if (Date.now() - t0 > 15000) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
  ok('a sample really arrived and was ingested (line -> watch)', gotSample, `samples=${watch.status().samples}`);
  const st = watch.status();
  ok('status counts samples as they arrive', st.samples >= 0 && st.intervalSec === 3, JSON.stringify(st));
  ok('the notifier only ever hears drains', fired.every((r) => r.kind === 'drain'));
  await watch.stop();
  const stopped = wrapper.get(watch.samplerId ?? '');
  ok('stop leaves no sampler running', !stopped || (stopped.life !== 'running' && stopped.life !== 'starting'), stopped ? stopped.life : 'gone');
  await wrapper.shutdown(true);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[systemWatch] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
