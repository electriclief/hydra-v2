import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fromLegacyJob, validateGraph } from "./graph.js";
function createDummyRunner(options = {}) {
  const ms = options.ms ?? 1200;
  return {
    kind: "dummy",
    description: "Executes nothing. It sleeps, writes the job as done, and says plainly that no model was invoked \u2014 the queue, the record and the routes around it are real, so a real runner changes this file only.",
    async run(job) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      const asked = Object.keys(job.inputs).length;
      return {
        runner: "dummy",
        executed: false,
        note: `dummy runner \u2014 nothing was executed. In a real run this is where "${job.service}" would start with ${asked} declared input${asked === 1 ? "" : "s"} (${job.inputs && Object.keys(job.inputs).join(", ") || "none"}).`,
        outputs: []
      };
    }
  };
}
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
class Scheduler {
  options;
  jobs = [];
  running = null;
  seq = 0;
  pumping = false;
  constructor(options = {}) {
    this.options = {
      file: options.file ?? null,
      concurrency: Math.max(1, Math.floor(options.concurrency ?? 1)),
      runner: options.runner ?? createDummyRunner(),
      now: options.now ?? (() => /* @__PURE__ */ new Date())
    };
    if (this.options.file) this.load();
  }
  /** Read the book back. A job that was RUNNING when the door died is not still running. */
  load() {
    const file = this.options.file;
    if (!file) return;
    let raw;
    try {
      raw = JSON.parse(readText(file));
    } catch {
      return;
    }
    const list = Array.isArray(raw) ? raw : raw.jobs;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const job = item;
      if (!job || typeof job.id !== "string" || typeof job.service !== "string") continue;
      const status = job.status === "running" ? "failed" : job.status ?? "failed";
      const legacySteps = fromLegacyJob({ id: job.id, service: job.service, inputs: job.inputs ?? {} });
      const loadedSteps = Array.isArray(job.steps) && job.steps.length ? job.steps : legacySteps;
      if (job.status === "running") {
        for (const s of loadedSteps) if (s.state === "running") s.state = "failed";
      }
      this.jobs.push({
        id: job.id,
        service: job.service,
        inputs: job.inputs ?? {},
        note: job.note ?? null,
        status,
        createdAt: job.createdAt ?? this.options.now().toISOString(),
        startedAt: job.startedAt ?? null,
        finishedAt: job.finishedAt ?? this.options.now().toISOString(),
        runner: job.runner ?? this.options.runner.kind,
        result: job.result ?? null,
        error: job.status === "running" ? "the door restarted while this job was running \u2014 it did not finish" : job.error ?? null,
        steps: loadedSteps,
        title: job.title,
        dataDir: job.dataDir,
        deliver: job.deliver,
        sessionRef: job.sessionRef ?? null
      });
      const n = Number.parseInt(job.id.replace(/^j-/, ""), 10);
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }
  persist() {
    const file = this.options.file;
    if (!file) return;
    writeText(file, JSON.stringify({ jobs: this.jobs }, null, 2));
  }
  /** A copy, so a caller never watches a job change status under its own hands. */
  snap(job) {
    return {
      ...job,
      inputs: { ...job.inputs },
      steps: job.steps ? job.steps.map((s) => ({ ...s, values: { ...s.values ?? {} }, needs: [...s.needs ?? []], output: s.output ? { ...s.output } : void 0 })) : void 0,
      result: job.result ? { ...job.result, outputs: [...job.result.outputs] } : null
    };
  }
  /** Admit a job. It is QUEUED, never started inline — the caller hears back before work begins. */
  submit(request) {
    const flat = String(request.service ?? "").trim();
    const graph = Array.isArray(request.steps) && request.steps.length > 0 ? request.steps : null;
    if (!graph && !NAME_OK.test(flat)) {
      throw new Error(`service must be a name like llama-chat (letters/digits/._-): "${flat}"`);
    }
    this.seq += 1;
    const id = `j-${String(this.seq).padStart(4, "0")}`;
    const steps = graph ? graph.map((s) => ({
      ...s,
      id: String(s.id),
      service: String(s.service),
      values: { ...s.values ?? {} },
      needs: Array.isArray(s.needs) ? s.needs.map(String) : [],
      state: s.state ?? "pending"
    })) : fromLegacyJob({ id, service: flat, inputs: request.inputs ?? {} });
    const check = validateGraph(steps);
    if (!check.ok) {
      const first = check.errors[0];
      throw Object.assign(new Error(`${first.code}: ${first.message}`), { code: first.code, refs: first.refs });
    }
    const inputs = request.inputs && typeof request.inputs === "object" && !graph ? request.inputs : steps[0].values ?? {};
    const job = {
      id,
      service: String(steps[0].service),
      inputs: { ...inputs },
      note: typeof request.note === "string" && request.note.trim() ? request.note.trim() : null,
      status: "queued",
      createdAt: this.options.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      runner: this.options.runner.kind,
      result: null,
      error: null,
      steps,
      title: typeof request.title === "string" && request.title.trim() ? request.title.trim() : void 0,
      dataDir: typeof request.dataDir === "string" && request.dataDir.trim() ? request.dataDir.trim() : void 0,
      deliver: request.deliver && request.deliver.dir ? { dir: String(request.deliver.dir), mode: request.deliver.mode ?? "auto" } : void 0,
      sessionRef: typeof request.sessionRef === "string" && request.sessionRef.trim() ? request.sessionRef.trim() : null
    };
    this.jobs.push(job);
    this.persist();
    queueMicrotask(() => void this.pump());
    return this.snap(job);
  }
  /** Honest order: the old jobs stay, newest last, so the book reads like a log. */
  list(filter = {}) {
    let out = filter.status ? this.jobs.filter((j) => j.status === filter.status) : [...this.jobs];
    out = out.reverse();
    if (filter.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out.map((j) => this.snap(j));
  }
  /** The stored job itself — for this module's own mutations, never handed out. */
  find(id) {
    return this.jobs.find((j) => j.id === id) ?? null;
  }
  /** A copy for a caller. */
  get(id) {
    const job = this.find(id);
    return job ? this.snap(job) : null;
  }
  current() {
    return this.running ? this.get(this.running) : null;
  }
  queued() {
    return this.jobs.filter((j) => j.status === "queued").map((j) => this.snap(j));
  }
  stats() {
    const s = { total: this.jobs.length, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
    for (const j of this.jobs) s[j.status] += 1;
    return s;
  }
  /** Cancel means cancel: a QUEUED job leaves the queue. A RUNNING one is refused, not lied about. */
  cancel(id) {
    const job = this.find(id);
    if (!job) return { ok: false, job: null, reason: `no such job: ${id}` };
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finishedAt = this.options.now().toISOString();
      this.persist();
      return { ok: true, job: this.snap(job), reason: "removed from the queue before it started" };
    }
    if (job.status === "running") {
      return { ok: false, job: this.snap(job), reason: "it is already running \u2014 a running job is not killed from here" };
    }
    return { ok: false, job: this.snap(job), reason: `it is already ${job.status}` };
  }
  /** The worker: admit nothing while one is running, then take the oldest queued job. */
  async pump() {
    if (this.pumping || this.running) return;
    this.pumping = true;
    try {
      while (!this.running) {
        const next = this.jobs.find((j) => j.status === "queued");
        if (!next) return;
        this.running = next.id;
        next.status = "running";
        next.startedAt = this.options.now().toISOString();
        this.persist();
        const started = Date.now();
        try {
          const outcome = await this.options.runner.run(next);
          next.result = { ...outcome, ms: Date.now() - started };
          next.status = "done";
        } catch (e) {
          next.status = "failed";
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
  async idle() {
    for (; ; ) {
      if (!this.running && !this.jobs.some((j) => j.status === "queued")) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  describe() {
    return `scheduler \u2014 one at a time \xB7 runner "${this.options.runner.kind}" \xB7 ${this.jobs.length} job(s) in the book`;
  }
}
function readText(file) {
  return readFileSync(file, "utf8");
}
function writeText(file, text) {
  const dir = file.replace(/[\\/][^\\/]+$/, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
}
export {
  Scheduler,
  createDummyRunner
};
//# sourceMappingURL=scheduler.js.map
