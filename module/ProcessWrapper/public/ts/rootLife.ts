/**
 * @module rootLife
 * @description THE ROOT'S OWN LIFE FILE — one life = one file, applied to the process that
 *              keeps that law for everyone else. Every child ProcessWrapper starts gets a
 *              name, a pid, a life and an append-only text file. The root itself got none of
 *              those: it was a bare console window with no record, which made the most
 *              important process on the box the only one its own law did not cover.
 * @intent The operator's law: *"there is never a process I can't see."* That has to include
 *              the trunk. Capturing the root's own stdout/stderr into `streams/root.log`
 *              means the console window can go away entirely — one window total — while the
 *              root stays as visible as everything it launches, through the same surface.
 *
 *              It TEEs, never replaces: the operator may still be watching a real console,
 *              and hiding output from a live terminal to satisfy a file would be the same
 *              mistake in the other direction.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Interface Definitions ---

/** The root's own row — the same shape a child reports, so one reader handles both. */
export interface RootRecord {
  id: 'root';
  name: string;
  pid: number;
  life: 'running';
  startedAt: string;
  streamFile: string;
  /** Bytes written to the root's own life so far. */
  bytes: number;
}

export interface RootLifeOptions {
  /** Where life files live — the same directory the children use. */
  streamDir: string;
  /** Shown as the name. Default `process-wrapper (root)`. */
  name?: string;
  /** The pid to report. Default `process.pid` (injectable so tests drive a real value). */
  pid?: number;
  /** The clock, injectable for tests. */
  now?: () => Date;
}

export interface RootLife {
  readonly record: RootRecord;
  /** Stop capturing. The file stays — it is the record. */
  close(): void;
}

// --- Function Definitions ---

/** The root's life file name. Fixed: there is exactly one root per process. */
const ROOT_FILE = 'root.log';

/**
 * Append one chunk to the file. Best-effort by design — a full disk must never take the
 * root down, because the root is the thing that keeps everything else visible.
 */
function append(file: string, chunk: string): number {
  try {
    fs.appendFileSync(file, chunk, 'utf8');
    return Buffer.byteLength(chunk, 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Start capturing the root's own output. Returns the record to serve and a `close()`.
 * TEE semantics: whatever was writing to stdout before still gets the bytes.
 */
export function captureRootLife(options: RootLifeOptions): RootLife {
  const name = options.name ?? 'process-wrapper (root)';
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  fs.mkdirSync(options.streamDir, { recursive: true });
  const streamFile = path.join(options.streamDir, ROOT_FILE);

  // a header naming the life, written once — the file describes itself
  append(streamFile, `--- root life · ${name} · pid ${pid} · ${startedAt} ---\n`);

  const state = { bytes: 0, closed: false };

  const tee = (stream: NodeJS.WriteStream): ((...a: unknown[]) => boolean) => {
    const original = stream.write.bind(stream);
    return (...args: unknown[]): boolean => {
      if (!state.closed) {
        const text = typeof args[0] === 'string' ? args[0] : String(args[0] ?? '');
        state.bytes += append(streamFile, text);
      }
      return (original as (...a: unknown[]) => boolean)(...args);
    };
  };

  process.stdout.write = tee(process.stdout) as typeof process.stdout.write;
  process.stderr.write = tee(process.stderr) as typeof process.stderr.write;

  const record: RootRecord = {
    id: 'root',
    name,
    pid,
    life: 'running',
    startedAt,
    streamFile,
    get bytes() { return state.bytes; },
  };

  return {
    record,
    close(): void {
      state.closed = true;
      append(streamFile, `--- root life closed · ${now().toISOString()} ---\n`);
    },
  };
}

// --- Function Definitions (tests) ---

/** Drive a REAL file on a REAL temp dir — never a mock. */
export async function runTests(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-rootlife-'));
  try {
    const born = new Date('2026-10-05T12:00:00.000Z');
    const life = captureRootLife({ streamDir: dir, pid: 4242, now: () => born });

    console.assert(life.record.id === 'root', 'the root reports itself as the root', life.record.id);
    console.assert(life.record.pid === 4242, 'it reports its own pid', String(life.record.pid));
    console.assert(life.record.life === 'running', 'the root is alive while it answers');
    console.assert(fs.existsSync(life.record.streamFile), 'its life file exists on disk', life.record.streamFile);

    const header = fs.readFileSync(life.record.streamFile, 'utf8');
    console.assert(header.includes('root life'), 'the file describes itself', header.slice(0, 40));
    console.assert(header.includes('4242'), 'the pid is in the record', header.slice(0, 60));

    // the tee must CAPTURE and still deliver — never swallow
    let seen = '';
    const spy = process.stdout.write;
    process.stdout.write('root output line A\n');
    seen = fs.readFileSync(life.record.streamFile, 'utf8');
    console.assert(seen.includes('root output line A'), 'stdout is captured to the life file', seen.slice(-40));
    console.assert(typeof spy === 'function', 'the stream is left callable');

    process.stderr.write('root error line B\n');
    seen = fs.readFileSync(life.record.streamFile, 'utf8');
    console.assert(seen.includes('root error line B'), 'stderr is captured too', seen.slice(-40));

    console.assert(life.record.bytes > 0, 'the byte count moves', String(life.record.bytes));

    life.close();
    const afterClose = fs.readFileSync(life.record.streamFile, 'utf8');
    console.assert(afterClose.includes('closed'), 'closing writes its own closing line', afterClose.slice(-40));

    const before = life.record.bytes;
    process.stdout.write('this must not be captured\n');
    console.assert(life.record.bytes === before, 'a closed root stops capturing (the file is final)');
  } catch (e) {
    console.assert(false, 'the rootLife suite ran without a crash', e instanceof Error ? e.message : String(e));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// runTests();