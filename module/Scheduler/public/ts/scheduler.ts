/**
 * @module scheduler
 * @description The book of jobs: a queue that admits one job at a time, the record of what
 *              each job asked for, and a RUNNER seam. Today the runner is a dummy that
 *              executes nothing and says so; the wiring — submit · queue · run · status —
 *              is the real thing, so a real runner drops in without moving a single route.
 * @intent A service DECLARES how it is driven (Services); a job is a service + its inputs;
 *         this door is the only place that decides WHEN it happens. One at a time is not a
 *         limitation here, it is the rule of the box: one GPU, one job.
 */

// --- Interface Definitions ---

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fromLegacyJob, validateGraph, type StepSpec } from './graph.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** What a caller hands the Scheduler: one service, or a graph of steps that ends in a folder. */
export interface JobRequest {
  /** The flat form: one service, one set of inputs. A graph of one step underneath. */
  service?: string;
  inputs?: Record<string, unknown>;
  note?: string | null;
  /** The graph form. When present, `service` and `inputs` are ignored. */
  title?: string;
  steps?: StepSpec[];
  /** Where the finished folder should be attached, and how (link by default, copy on request). */
  deliver?: { dir: string; mode?: 'auto' | 'link' | 'copy' };
  /** Echidna's session, when she is running. Optional: a job is complete without her. */
  sessionRef?: string | null;
  /** The job's own folder. Defaults to <dataRoot>/<jobId> at run time. */
  dataDir?: string;
}

export interface JobResult {
  /** 'dummy' today, whatever runs it tomorrow. */
  runner: string;
  /** false is the honest answer from the dummy: nothing was executed. */
  executed: boolean;
  note: string;
  ms: number;
  outputs: string[];
}

export interface Job {
  id: string;
  service: string;
  inputs: Record<string, unknown>;
  note: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  runner: string;
  result: JobResult | null;
  error: string | null;
  /** The graph. A flat submit becomes a single step, so every job has one. */
  steps?: StepSpec[];
  title?: string;
  /** Where the product lands: the job's folder, and the delivery that attaches it somewhere the user wants. */
  dataDir?: string;
  deliver?: { dir: string; mode?: 'auto' | 'link' | 'copy' };
  /** Echidna's session label, when there is one. Never a path prefix, never required. */
  sessionRef?: string | null;
}

/** The seam. A real runner is a different implementation of this interface, nothing else. */
export interface Runner {
  readonly kind: string;
  readonly description: string;
  run(job: Job): Promise<Omit<JobResult, 'ms'>>;
}

export interface SchedulerOptions {
  /** Where the book lives. Absent = in memory only (the gate uses that). */
  file?: string | null;
  /** How many jobs may run at once. The box says one; the seam allows more. */
  concurrency?: number;
  runner?: Runner;
  /** Injected clock, so a test can be deterministic. */
  now?: () => Date;
}

export interface Stats {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

// --- Function Definitions ---

/** The runner that exists so the wiring is real: it records the job and runs nothing. */
export function createDummyRunner(options: { ms?: number } = {}): Runner {
  const ms = options.ms ?? 1200;
  return {
    kind: 'dummy',
    description:
      'Executes nothing. It sleeps, writes the job as done, and says plainly that no model was invoked — '
      + 'the queue, the record and the routes around it are real, so a real runner changes this file only.',
    async run(job: Job): Promise<Omit<JobResult, 'ms'>> {
      await new Promise((resolve) => setTimeout(resolve, ms));
      const asked = Object.keys(job.inputs).length;
      return {
        runner: 'dummy',
        executed: false,
        note:
          `dummy runner — nothing was executed. In a real run this is where "${job.service}" would start `
          + `with ${asked} declared input${asked === 1 ? '' : 's'} (${job.inputs && Object.keys(job.inputs).join(', ') || 'none'}).`,
        outputs: [],
      };
    },
  };
}

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class Scheduler {
  readonly options: Required<Omit<SchedulerOptions, 'file'>> & { file: string | null };
  private readonly jobs: Job[] = [];
  private running: string | null = null;
  private seq = 0;
  private pumping = false;

  constructor(options: SchedulerOptions = {}) {
    this.options = {
      file: options.file ?? null,
      concurrency: Math.max(1, Math.floor(options.concurrency ?? 1)),
      runner: options.runner ?? createDummyRunner(),
      now: options.now ?? (() => new Date()),
    };
    if (this.options.file) this.load();
  }

  /** Read the book back. A job that was RUNNING when the door died is not still running. */
  private load(): void {
    const file = this.options.file;
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readText(file));
    } catch {
      return;
    }
    const list = Array.isArray(raw) ? raw : (raw as { jobs?: unknown }).jobs;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const job = item as Partial<Job>;
      if (!job || typeof job.id !== 'string' || typeof job.service !== 'string') continue;
      const status: JobStatus = job.status === 'running' ? 'failed' : (job.status ?? 'failed');
      const legacySteps = fromLegacyJob({ id: job.id, service: job.service, inputs: (job.inputs ?? {}) as Record<string, unknown> });
      const loadedSteps: StepSpec[] = Array.isArray(job.steps) && job.steps.length ? (job.steps as StepSpec[]) : legacySteps;
      if (job.status === 'running') {
        // a step caught mid-flight is not still running just because the file says so
        for (const s of loadedSteps) if (s.state === 'running') s.state = 'failed';
      }
      this.jobs.push({
        id: job.id,
        service: job.service,
        inputs: (job.inputs ?? {}) as Record<string, unknown>,
        note: job.note ?? null,
        status,
        createdAt: job.createdAt ?? this.options.now().toISOString(),
        startedAt: job.startedAt ?? null,
        finishedAt: job.finishedAt ?? this.options.now().toISOString(),
        runner: job.runner ?? this.options.runner.kind,
        result: job.result ?? null,
        error: job.status === 'running'
          ? 'the door restarted while this job was running — it did not finish'
          : (job.error ?? null),
        steps: loadedSteps,
        title: job.title,
        dataDir: job.dataDir,
        deliver: job.deliver,
        sessionRef: job.sessionRef ?? null,
      });
      const n = Number.parseInt(job.id.replace(/^j-/, ''), 10);
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }

  private persist(): void {
    const file = this.options.file;
    if (!file) return;
    writeText(file, JSON.stringify({ jobs: this.jobs }, null, 2));
  }

  /** A copy, so a caller never watches a job change status under its own hands. */
  private snap(job: Job): Job {
    return {
      ...job,
      inputs: { ...job.inputs },
      steps: job.steps
        ? job.steps.map((s) => ({ ...s, values: { ...(s.values ?? {}) }, needs: [...(s.needs ?? [])], output: s.output ? { ...s.output } : undefined }))
        : undefined,
      result: job.result ? { ...job.result, outputs: [...job.result.outputs] } : null,
    };
  }

  /** Admit a job. It is QUEUED, never started inline — the caller hears back before work begins. */
  submit(request: JobRequest): Job {
    const flat = String(request.service ?? '').trim();
    const graph = Array.isArray(request.steps) && request.steps.length > 0 ? request.steps : null;
    if (!graph && !NAME_OK.test(flat)) {
      throw new Error(`service must be a name like llama-chat (letters/digits/._-): "${flat}"`);
    }
    this.seq += 1;
    const id = `j-${String(this.seq).padStart(4, '0')}`;

    // A flat submit is the degenerate one-step graph: every job has steps, so nothing downstream forks.
    const steps: StepSpec[] = graph
      ? graph.map((s) => ({
          ...s,
          id: String(s.id),
          service: String(s.service),
          values: { ...(s.values ?? {}) },
          needs: Array.isArray(s.needs) ? s.needs.map(String) : [],
          state: s.state ?? 'pending',
        }))
      : fromLegacyJob({ id, service: flat, inputs: (request.inputs ?? {}) as Record<string, unknown> });

    // Refused before it is booked: a cycle would deadlock the single slot and LOOK like nothing happening.
    const check = validateGraph(steps);
    if (!check.ok) {
      const first = check.errors[0];
      throw Object.assign(new Error(`${first.code}: ${first.message}`), { code: first.code, refs: first.refs });
    }

    const inputs = request.inputs && typeof request.inputs === 'object' && !graph
      ? request.inputs
      : (steps[0].values ?? {});
    const job: Job = {
      id,
      service: String(steps[0].service),
      inputs: { ...(inputs as Record<string, unknown>) },
      note: typeof request.note === 'string' && request.note.trim() ? request.note.trim() : null,
      status: 'queued',
      createdAt: this.options.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      runner: this.options.runner.kind,
      result: null,
      error: null,
      steps,
      title: typeof request.title === 'string' && request.title.trim() ? request.title.trim() : undefined,
      dataDir: typeof request.dataDir === 'string' && request.dataDir.trim() ? request.dataDir.trim() : undefined,
      deliver: request.deliver && request.deliver.dir
        ? { dir: String(request.deliver.dir), mode: request.deliver.mode ?? 'auto' }
        : undefined,
      sessionRef: typeof request.sessionRef === 'string' && request.sessionRef.trim() ? request.sessionRef.trim() : null,
    };
    this.jobs.push(job);
    this.persist();
    queueMicrotask(() => void this.pump());
    return this.snap(job);
  }

  /** Honest order: the old jobs stay, newest last, so the book reads like a log. */
  list(filter: { status?: JobStatus; limit?: number } = {}): Job[] {
    let out = filter.status ? this.jobs.filter((j) => j.status === filter.status) : [...this.jobs];
    out = out.reverse();
    if (filter.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out.map((j) => this.snap(j));
  }

  /** The stored job itself — for this module's own mutations, never handed out. */
  private find(id: string): Job | null {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  /** A copy for a caller. */
  get(id: string): Job | null {
    const job = this.find(id);
    return job ? this.snap(job) : null;
  }

  current(): Job | null {
    return this.running ? this.get(this.running) : null;
  }

  queued(): Job[] {
    return this.jobs.filter((j) => j.status === 'queued').map((j) => this.snap(j));
  }

  stats(): Stats {
    const s: Stats = { total: this.jobs.length, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
    for (const j of this.jobs) s[j.status] += 1;
    return s;
  }

  /** Cancel means cancel: a QUEUED job leaves the queue. A RUNNING one is refused, not lied about. */
  cancel(id: string): { ok: boolean; job: Job | null; reason: string } {
    const job = this.find(id);
    if (!job) return { ok: false, job: null, reason: `no such job: ${id}` };
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = this.options.now().toISOString();
      this.persist();
      return { ok: true, job: this.snap(job), reason: 'removed from the queue before it started' };
    }
    if (job.status === 'running') {
      return { ok: false, job: this.snap(job), reason: 'it is already running — a running job is not killed from here' };
    }
    return { ok: false, job: this.snap(job), reason: `it is already ${job.status}` };
  }

  /** The worker: admit nothing while one is running, then take the oldest queued job. */
  private async pump(): Promise<void> {
    if (this.pumping || this.running) return;
    this.pumping = true;
    try {
      while (!this.running) {
        const next = this.jobs.find((j) => j.status === 'queued');
        if (!next) return;
        this.running = next.id;
        next.status = 'running';
        next.startedAt = this.options.now().toISOString();
        this.persist();
        const started = Date.now();
        try {
          const outcome = await this.options.runner.run(next);
          next.result = { ...outcome, ms: Date.now() - started };
          next.status = 'done';
        } catch (e) {
          next.status = 'failed';
          next.error = e instanceof Error ? e.message : String(e);
        }
        next.finishedAt = this.options.now().toISOString();
        this.persist();
        this.running = null;
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Wait until nothing is queued or running. Tests use it; nothing in the door does. */
  async idle(): Promise<void> {
    for (;;) {
      if (!this.running && !this.jobs.some((j) => j.status === 'queued')) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  describe(): string {
    return `scheduler — one at a time · runner "${this.options.runner.kind}" · ${this.jobs.length} job(s) in the book`;
  }
}

// --- small file helpers (kept here so the module has no dependency but node:fs) ---

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function writeText(file: string, text: string): void {
  const dir = file.replace(/[\\/][^\\/]+$/, '');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
}
