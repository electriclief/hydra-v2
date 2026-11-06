/**
 * The Scheduler's public face on the LAN.
 *
 * A booking is private until it is an entry: `node.<ref>.scheduler.booked.<jobId>` is what makes "123 is booked
 * at 14:00" visible on every screen without anyone asking this node anything.
 *
 * What is published, and what is not:
 *   - queued and running jobs     -> one entry each (the book, which is what a peer needs to route around)
 *   - finished jobs               -> NOT published individually; a summary count only. The book of history stays
 *                                    local, so a long-lived node does not grow the LAN's state without bound.
 *   - inputs                      -> summarised as their KEYS, never their values: a stranger needs to know a
 *                                    job exists, not what you asked for.
 *
 * Nothing here throws into the scheduler: a publisher that cannot reach State must not stop the book from
 * turning. It says so in the log and tries again on the next tick.
 */
import type { Job, Stats } from './scheduler.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface PublisherOptions {
  stateUrl: string;
  ref: string;
  intervalMs?: number;
  /** the module root, used only to find the instance layer's node.json */
  root?: string;
}

const PUBLISHED: ReadonlySet<string> = new Set(['queued', 'running']);

export function refFromNodeJson(root: string | null): string | null {
  if (!root) return null;
  for (const rel of [path.join('Core', 'data', 'node.json'), path.join('Menu', 'data', 'node.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as { ref?: unknown };
      if (parsed && typeof parsed.ref === 'string' && parsed.ref.trim()) return parsed.ref.trim().toLowerCase();
    } catch {
      /* next */
    }
  }
  return null;
}

export interface SchedulerPublish {
  /** entries to register, by full name */
  entries: Record<string, unknown>;
  /** full names to drop (a job that has left the book) */
  stale: string[];
}

/**
 * Pure: jobs + stats + the names already published -> the entries to write and the names to drop.
 * Keeping this pure is what lets the gate prove the drop path without a State process.
 *
 * OWNERSHIP: this function writes `node.<ref>.scheduler*` and nothing else. Standby/Idle Service is published by
 * the guard that owns it, doors by the shell, services by the catalog, the heartbeat by Core. A module that
 * republishes another's facts becomes a single point of failure for a truth it does not own.
 */
export function schedulerPublish(jobs: Job[], stats: Stats, ref: string, previously: string[] = []): SchedulerPublish {
  const entries: Record<string, unknown> = {};
  const now = new Date().toISOString();
  const active = jobs.filter((job) => PUBLISHED.has(job.status));
  const seen = new Set<string>();

  for (const job of active) {
    const name = `node.${ref}.scheduler.booked.${job.id}`;
    seen.add(name);
    entries[name] = {
      id: job.id,
      service: job.service,
      state: job.status,
      at: job.startedAt ?? job.createdAt,
      created: job.createdAt,
      keys: Object.keys(job.inputs ?? {}),
      graph: Array.isArray((job as unknown as { steps?: unknown[] }).steps),
    };
  }

  entries[`node.${ref}.scheduler`] = {
    at: now,
    queued: stats.queued,
    running: stats.running,
    done: stats.done,
    failed: stats.failed,
    cancelled: stats.cancelled,
    total: stats.total,
    booked: active.length,
    nextAt: active.length ? (active[0].startedAt ?? active[0].createdAt) : null,
  };

  const stale = previously.filter((name) => name.startsWith(`node.${ref}.scheduler.booked.`) && !seen.has(name));
  return { entries, stale };
}

async function withTimeout(url: string, init: RequestInit, timeoutMs = 700): Promise<Response | null> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hardStop = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(null);
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      return await fetch(url, { ...init, signal: ctl.signal });
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([work, hardStop]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Register one entry. Returns false instead of throwing, always. */
export async function register(stateUrl: string, name: string, content: unknown): Promise<boolean> {
  const res = await withTimeout(`${stateUrl}/api/state/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, content }),
  });
  return Boolean(res && res.ok);
}

export async function drop(stateUrl: string, name: string): Promise<boolean> {
  const res = await withTimeout(`${stateUrl}/api/state/drop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return Boolean(res && res.ok);
}

/** Every happening goes through the Event_Handler; a missing event door must never stop the book turning. */
async function fire(eventUrl: string | null, name: string, payload: Record<string, unknown>): Promise<void> {
  if (!eventUrl) return;
  try {
    await withTimeout(`${eventUrl}/api/events/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, payload, source: 'system' }),
    });
  } catch {
    /* an event log that is down is a gap in the record, not a reason to stop running jobs */
  }
}

/**
 * Start the loop. Returns a stop function; the caller (startScheduler) wires it into shutdown.
 * `getJobs` and `getStats` are passed in, so this file never imports the scheduler's instance.
 */
export function startPublisher(
  options: PublisherOptions,
  getJobs: () => Job[],
  getStats: () => Stats,
  log: (line: string) => void = () => {},
): { stop: () => void; tick: () => Promise<void> } {
  const interval = options.intervalMs ?? 5000;
  const eventUrl = process.env.SCHEDULER_EVENT_URL ?? 'http://127.0.0.1:8126';
  // which jobs have been announced, and the last status seen: the pair is enough to tell a new job from a
  // finished one without a second clock or a second store
  const announced = new Map<string, string>();
  let published: string[] = [];
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const jobs = getJobs();
    const { entries, stale } = schedulerPublish(jobs, getStats(), options.ref, published);

    // job.submitted on first sight; job.done when it leaves the book or reaches a terminal state
    const byId = new Map(jobs.map((job) => [job.id, job]));
    for (const job of jobs) {
      if (!PUBLISHED.has(job.status)) continue;
      announced.set(job.id, job.status);
      if (!announced.has(job.id + ':sent')) {
        announced.set(job.id + ':sent', '1');
        void fire(eventUrl, 'job.submitted', { ref: options.ref, jobId: job.id, service: job.service ?? null });
      }
    }
    for (const key of [...announced.keys()]) {
      if (!key.endsWith(':sent')) continue;
      const id = key.slice(0, -':sent'.length);
      const job = byId.get(id);
      if (job && PUBLISHED.has(job.status)) continue;
      void fire(eventUrl, 'job.done', { ref: options.ref, jobId: id, status: job?.status ?? 'left-book' });
      announced.delete(key);
      announced.delete(id);
    }
    let written = 0;
    for (const [name, content] of Object.entries(entries)) {
      if (name.includes('.booked.')) {
        if (await register(options.stateUrl, name, content)) {
          written += 1;
          if (!published.includes(name)) published.push(name);
        }
      } else {
        await register(options.stateUrl, name, content);
      }
    }
    for (const name of stale) {
      if (await drop(options.stateUrl, name)) published = published.filter((n) => n !== name);
    }
    if (written || stale.length) log(`[publish] ${written} booked entries, ${stale.length} dropped`);
  };

  void tick();
  const handle = setInterval(() => void tick(), interval);
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
    tick,
  };
}
