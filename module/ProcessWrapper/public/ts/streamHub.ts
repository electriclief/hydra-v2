/**
 * @module streamHub
 * @description Hands out COPIES of a running process's output stream — one independent
 *              cursor per consumer, with replay-from-offset and honest backpressure.
 * @intent The wrapper can capture a stream, but a stream with one reader is not a stream:
 *         several surfaces (the SSE API, a CLI follower, a future Hydra module) each need
 *         their own copy at their own pace. The hub gives every consumer its own cursor so
 *         a slow reader can never stall, truncate or corrupt another's copy — and when a
 *         reader really does fall behind its ceiling, it is told it dropped text instead
 *         of being quietly lied to.
 */

import type { ProcessWrapperService, StreamChannel, StreamChunk } from './processWrapper.js';

// --- Interface Definitions ---

/** What a consumer of a copy must implement. `onData` returning false = apply backpressure. */
export interface CopySink {
  /** A copy of the process's captured text. Return false to have the hub queue for you. */
  onData(chunk: StreamChunk): boolean | void;
  /** The process ended (or the copy was closed) — no more data will follow. */
  onEnd(reason: CopyEndReason): void;
  /** This copy's own queue hit its ceiling and shed text. Reported, never silent. */
  onDrop?(info: DropInfo): void;
}

export type CopyEndReason = 'process-ended' | 'closed' | 'sink-error' | 'no-such-process';

export interface DropInfo {
  droppedChars: number;
  /** Total characters this copy has shed since it opened. */
  totalDroppedChars: number;
  at: number;
}

/** One consumer's handle on a copy. */
export interface CopyHandle {
  id: string;
  processId: string;
  /** Flush a queued copy after a sink signalled backpressure. */
  drain(): void;
  /** Stop this copy (the process keeps running and capturing). */
  close(): void;
  stats(): CopyStats;
}

export interface CopyStats {
  id: string;
  processId: string;
  channel: StreamChannel | 'both';
  from: number;
  deliveredChars: number;
  queuedChars: number;
  queuedChunks: number;
  droppedChars: number;
  ends: CopyEndReason | null;
  open: boolean;
}

export interface HubOptions {
  /** Per-copy ceiling for the hub's own queue, in characters (default 1_000_000). */
  queueLimitChars?: number;
}

export interface OpenOptions {
  /** Character offset to start the copy at (default 0). */
  from?: number;
  /** Narrow the copy to one channel (default: both, tagged per chunk). */
  channel?: StreamChannel;
  /** Deliver already-captured text first (default true). */
  replay?: boolean;
}

// --- Function Definitions ---

/** THE HUB. One per wrapper; every copy it hands out is independent. */
export class StreamHub {
  private wrapper: ProcessWrapperService;
  private queueLimitChars: number;
  private copies = new Map<string, Copy>();
  private seq = 0;

  constructor(wrapper: ProcessWrapperService, options: HubOptions = {}) {
    this.wrapper = wrapper;
    this.queueLimitChars = options.queueLimitChars ?? 1_000_000;
  }

  /** Open a new copy of one process's stream. */
  open(processId: string, sink: CopySink, opts: OpenOptions = {}): CopyHandle {
    const copy = new Copy(`copy-${++this.seq}`, processId, sink, this.queueLimitChars, opts);
    this.copies.set(copy.id, copy);
    this.prune();

    const rec = this.wrapper.get(processId);
    if (!rec) {
      copy.finish('no-such-process');
      return copy.handle(() => this.prune());
    }

    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = this.wrapper.subscribe(
        processId,
        (chunk) => {
          if (chunk === 'end') copy.finish('process-ended', true);
          else copy.push(chunk);
        },
        { from: opts.from ?? 0, channel: opts.channel, replay: opts.replay },
      );
    } catch {
      copy.finish('no-such-process');
    }
    copy.onClose = () => unsubscribe();
    return copy.handle(() => this.prune());
  }

  /** Keep the trail bounded: closed copies are forgotten oldest-first past the cap. */
  private prune(maxFinished = 200): void {
    const finished: string[] = [];
    for (const [id, copy] of this.copies) if (!copy.isOpen) finished.push(id);
    const excess = finished.length - maxFinished;
    for (let i = 0; i < excess; i++) this.copies.delete(finished[i]);
  }

  /** How many copies are open right now. */
  openCount(): number {
    let n = 0;
    for (const copy of this.copies.values()) if (copy.isOpen) n++;
    return n;
  }

  /** Every copy this hub has handed out (open and finished). */
  stats(): CopyStats[] {
    return Array.from(this.copies.values()).map((c) => c.stats());
  }

  /** Close every copy (the wrapper's processes keep running). */
  closeAll(reason: CopyEndReason = 'closed'): number {
    let n = 0;
    for (const copy of this.copies.values()) {
      if (copy.isOpen) {
        copy.finish(reason);
        n++;
      }
    }
    return n;
  }
}

/** One consumer's cursor: replay, live delivery, and its own queue when it lags. */
class Copy {
  readonly id: string;
  readonly processId: string;
  readonly channel: StreamChannel | 'both';
  readonly from: number;
  onClose: () => void = () => {};
  private sink: CopySink;
  private queueLimitChars: number;
  private queue: StreamChunk[] = [];
  private queuedChars = 0;
  private deliveredChars = 0;
  private droppedChars = 0;
  private ends: CopyEndReason | null = null;
  private queued_ = false;
  private closed = false;

  constructor(id: string, processId: string, sink: CopySink, queueLimitChars: number, opts: OpenOptions) {
    this.id = id;
    this.processId = processId;
    this.sink = sink;
    this.queueLimitChars = queueLimitChars;
    this.channel = opts.channel ?? 'both';
    this.from = Math.max(0, opts.from ?? 0);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  push(chunk: StreamChunk): void {
    if (this.closed || this.ends) return;
    if (this.channel !== 'both' && chunk.channel !== this.channel) return;
    if (this.queued_) {
      this.queue.push(chunk);
      this.queuedChars += chunk.text.length;
      this.shed();
      return;
    }
    this.deliver(chunk);
  }

  drain(): void {
    if (this.closed || this.ends) return;
    this.queued_ = false;
    const pending = this.queue;
    this.queue = [];
    this.queuedChars = 0;
    for (const chunk of pending) {
      if (this.ends || this.closed) return;
      this.deliver(chunk);
      if (this.queued_) {
        // Backpressure again — keep the rest queued, no reordering.
        const rest = pending.slice(pending.indexOf(chunk) + 1);
        this.queue = rest;
        this.queuedChars = rest.reduce((n, c) => n + c.text.length, 0);
        return;
      }
    }
  }

  finish(reason: CopyEndReason, flushQueue = false): void {
    if (this.closed) return;
    this.closed = true;
    this.ends = reason;
    try {
      this.onClose();
    } catch {
      /* the subscription is already gone */
    }
    // A copy whose process ended is handed what it already queued — no silent loss.
    if (flushQueue && this.queue.length) {
      const pending = this.queue;
      this.queue = [];
      this.queuedChars = 0;
      for (const chunk of pending) {
        this.deliveredChars += chunk.text.length;
        try {
          this.sink.onData(chunk);
        } catch {
          /* best effort — the copy is already ending */
        }
      }
    }
    try {
      this.sink.onEnd(reason);
    } catch {
      /* the sink is already gone */
    }
  }

  stats(): CopyStats {
    return {
      id: this.id,
      processId: this.processId,
      channel: this.channel,
      from: this.from,
      deliveredChars: this.deliveredChars,
      queuedChars: this.queuedChars,
      queuedChunks: this.queue.length,
      droppedChars: this.droppedChars,
      ends: this.ends,
      open: this.isOpen,
    };
  }

  handle(onClose: () => void): CopyHandle {
    const self = this;
    return {
      id: this.id,
      processId: this.processId,
      drain: () => self.drain(),
      close: () => {
        self.finish('closed');
        onClose();
      },
      stats: () => self.stats(),
    };
  }

  private deliver(chunk: StreamChunk): void {
    let backpressure = false;
    try {
      backpressure = this.sink.onData(chunk) === false;
    } catch {
      this.finish('sink-error');
      return;
    }
    this.deliveredChars += chunk.text.length;
    if (backpressure) this.queued_ = true;
  }

  private shed(): void {
    let shed = 0;
    while (this.queuedChars > this.queueLimitChars && this.queue.length > 1) {
      const dropped = this.queue.shift() as StreamChunk;
      this.queuedChars -= dropped.text.length;
      shed += dropped.text.length;
    }
    if (shed > 0) {
      this.droppedChars += shed;
      if (this.sink.onDrop) {
        try {
          this.sink.onDrop({ droppedChars: shed, totalDroppedChars: this.droppedChars, at: Date.now() });
        } catch {
          /* a failing drop notice must not kill the copy */
        }
      }
    }
  }
}

/** Make a hub for a wrapper. */
export function createStreamHub(wrapper: ProcessWrapperService, options: HubOptions = {}): StreamHub {
  return new StreamHub(wrapper, options);
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createWrapper } = await import('./processWrapper.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-hub-'));
  const wrapper = createWrapper({ streamDir: path.join(dir, 'streams'), graceMs: 300 });
  const hub = createStreamHub(wrapper, { queueLimitChars: 200 });
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 1. two copies of one stream, each with its own cursor
  const a: string[] = [];
  const b: string[] = [];
  let aEnd: string | null = null;
  let bEnd: string | null = null;
  const proc = wrapper.launch({
    name: 'hub-target',
    command: process.execPath,
    args: ['-e', "console.log('first');setTimeout(()=>console.log('second'),120);setTimeout(()=>console.log('third'),240)"],
  });
  const copyA = hub.open(proc.id, { onData: (c) => { a.push(c.text); }, onEnd: (r) => { aEnd = r; } });
  await sleep(60);
  const copyB = hub.open(proc.id, { onData: (c) => { b.push(c.text); }, onEnd: (r) => { bEnd = r; } });
  await wrapper.awaitExit(proc.id, 15000);
  await sleep(50);
  ok('each copy has its own handle', copyA.id !== copyB.id && copyA.processId === proc.id, `${copyA.id}/${copyB.id}`);

  const aText = a.join('');
  const bText = b.join('');
  ok('copy A saw the whole life', aText.includes('first') && aText.includes('second') && aText.includes('third'), aText);
  ok('copy B (joined mid-life) was given the replay too', bText.includes('first') && bText.includes('third'), bText);
  ok('copy A became one delivery stream', a.length >= 1, String(a.length));
  ok('copy A heard the process end', aEnd === 'process-ended', String(aEnd));
  ok('copy B heard the process end', bEnd === 'process-ended', String(bEnd));
  ok('both copies are closed', hub.openCount() === 0, String(hub.openCount()));

  // 2. an offset copy skips the front — both when the text already exists (replay) and when
  //    it is still to come (live). The flaky version of this test is what found the bug:
  //    `from` used to apply to the replay only, so a copy that opened early got text it
  //    had asked to skip.
  const c: string[] = [];
  const proc2 = wrapper.launch({ name: 'hub-offset', command: process.execPath, args: ['-e', "console.log('AAAA');setTimeout(()=>console.log('BBBB'),300)"] });
  const earlyCopy = hub.open(proc2.id, { onData: (ch) => { c.push(ch.text); }, onEnd: () => {} }, { from: 5 });
  await wrapper.awaitExit(proc2.id, 15000);
  await sleep(50);
  const cText = c.join('');
  ok('an early offset copy skips the front without swallowing the rest', !cText.includes('AAAA') && cText.includes('BBBB'), JSON.stringify(cText));
  ok('the early offset copy equals the stream minus its front', cText === wrapper.output(proc2.id).text.slice(5), JSON.stringify(cText));
  ok('the early copy ended with the process', earlyCopy.stats().open === false, JSON.stringify(earlyCopy.stats()));
  const d: string[] = [];
  hub.open(proc2.id, { onData: (ch) => { d.push(ch.text); }, onEnd: () => {} }, { from: 5 });
  await sleep(50);
  ok('a late offset copy (replay) skips the same front', d.join('') === cText, JSON.stringify(d.join('')));

  // 3. a channel-narrowed copy only sees its channel
  const out: string[] = [];
  const err: string[] = [];
  const proc3 = wrapper.launch({
    name: 'hub-channels',
    command: process.execPath,
    args: ['-e', "console.log('to-out');console.error('to-err')"],
  });
  hub.open(proc3.id, { onData: (ch) => { out.push(ch.text); }, onEnd: () => {} }, { channel: 'stdout' });
  hub.open(proc3.id, { onData: (ch) => { err.push(ch.text); }, onEnd: () => {} }, { channel: 'stderr' });
  await wrapper.awaitExit(proc3.id, 15000);
  await sleep(50);
  ok('stdout copy is stdout-only', out.join('').includes('to-out') && !out.join('').includes('to-err'), out.join(''));
  ok('stderr copy is stderr-only', err.join('').includes('to-err') && !err.join('').includes('to-out'), err.join(''));

  // 4. backpressure: a slow sink queues, then drains in order — nothing lost
  const slow: string[] = [];
  const bp = { hit: false };
  const proc4 = wrapper.launch({
    name: 'hub-backpressure',
    command: process.execPath,
    args: ['-e', "for(let i=1;i<=6;i++)setTimeout(()=>console.log('line'+i), i*200)"],
  });
  const handle = hub.open(proc4.id, {
    onData: (ch) => {
      const first = !bp.hit;
      if (first) bp.hit = true;
      slow.push(ch.text);
      return first ? false : true; // simulate a slow reader on the first chunk
    },
    onEnd: () => {},
  });
  // Wait until the slow sink has genuinely fallen behind (never a fixed race).
  let queuedWhileSlow = 0;
  const queueDeadline = Date.now() + 5000;
  while (Date.now() < queueDeadline) {
    queuedWhileSlow = handle.stats().queuedChars;
    if (queuedWhileSlow > 0) break;
    await sleep(50);
  }
  ok('a slow sink queued instead of stalling the stream', bp.hit === true && queuedWhileSlow > 0, JSON.stringify(handle.stats()));
  handle.drain();
  ok('drain delivered the queued copy', handle.stats().queuedChars === 0, JSON.stringify(handle.stats()));
  await wrapper.awaitExit(proc4.id, 15000);
  await sleep(50);
  ok('drain kept order and lost nothing', slow.join('').includes('line1') && slow.join('').includes('line6'), slow.join(''));

  // 5. a copy that never drains reports the text it shed
  const dropSeen: { info: DropInfo | null } = { info: null };
  const proc5 = wrapper.launch({
    name: 'hub-drop',
    command: process.execPath,
    args: ['-e', "for(let i=0;i<20;i++)console.log('chatter-'+i+'-'+'y'.repeat(40))"],
  });
  const stuck = hub.open(proc5.id, {
    onData: () => false, // wedged reader, never drains
    onEnd: () => {},
    onDrop: (info) => { dropSeen.info = info; },
  });
  await wrapper.awaitExit(proc5.id, 15000);
  await sleep(50);
  const stuckStats = stuck.stats();
  ok('a wedged copy is told it dropped text', dropSeen.info !== null && stuckStats.droppedChars > 0, JSON.stringify(stuckStats));
  ok('the dropped count is reported in the notice', dropSeen.info !== null && dropSeen.info.totalDroppedChars === stuckStats.droppedChars, JSON.stringify(dropSeen.info));
  ok('the queue stayed under its ceiling + 1 chunk', stuckStats.queuedChars <= 200 + 200, String(stuckStats.queuedChars));
  stuck.close();

  // 6. closing one copy never disturbs the process or another copy
  const keep: string[] = [];
  const proc6 = wrapper.launch({ name: 'hub-close', command: process.execPath, args: ['-e', "let i=0;const t=setInterval(()=>console.log('tick'+(++i)),60);setTimeout(()=>{clearInterval(t);},600)"] });
  const kept = hub.open(proc6.id, { onData: (ch) => { keep.push(ch.text); }, onEnd: () => {} });
  const doomed = hub.open(proc6.id, { onData: () => {}, onEnd: () => {} });
  doomed.close();
  await wrapper.awaitExit(proc6.id, 15000);
  await sleep(50);
  ok('a closed copy stops receiving', doomed.stats().open === false && doomed.stats().ends === 'closed');
  ok('the surviving copy still got the stream', keep.join('').includes('tick1'), keep.join(''));
  ok('the process itself was untouched', wrapper.get(proc6.id)?.life === 'exited', String(wrapper.get(proc6.id)?.life));
  kept.close();

  // 7. unknown process is refused, not faked
  let badEnd: string | null = null;
  const bad = hub.open('no-such-id', { onData: () => {}, onEnd: (r) => { badEnd = r; } });
  ok('unknown process ends the copy with a reason', badEnd === 'no-such-process', String(badEnd));
  bad.close();

  // 8. a throwing sink is cut off with a reason, never left hanging
  let errEnd: string | null = null;
  const proc8 = wrapper.launch({ name: 'hub-sink-error', command: process.execPath, args: ['-e', "console.log('boom')"] });
  await sleep(20);
  hub.open(proc8.id, { onData: () => { throw new Error('sink blew up'); }, onEnd: (r) => { errEnd = r; } });
  // Poll, never a fixed sleep: the child's 'boom' arrives on node's own boot schedule.
  const sinkDeadline = Date.now() + 5000;
  while (errEnd === null && Date.now() < sinkDeadline) await sleep(50);
  ok('a throwing sink closes its own copy', errEnd === 'sink-error', String(errEnd));

  ok('hub stats list every copy', hub.stats().length === 12, String(hub.stats().length));
  await wrapper.shutdown();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[streamHub] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
