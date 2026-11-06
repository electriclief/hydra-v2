import { readFileSync } from "node:fs";
import path from "node:path";
const PUBLISHED = /* @__PURE__ */ new Set(["queued", "running"]);
function refFromNodeJson(root) {
  if (!root) return null;
  for (const rel of [path.join("Core", "data", "node.json"), path.join("Menu", "data", "node.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
      if (parsed && typeof parsed.ref === "string" && parsed.ref.trim()) return parsed.ref.trim().toLowerCase();
    } catch {
    }
  }
  return null;
}
function schedulerPublish(jobs, stats, ref, previously = []) {
  const entries = {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const active = jobs.filter((job) => PUBLISHED.has(job.status));
  const seen = /* @__PURE__ */ new Set();
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
      graph: Array.isArray(job.steps)
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
    nextAt: active.length ? active[0].startedAt ?? active[0].createdAt : null
  };
  const stale = previously.filter((name) => name.startsWith(`node.${ref}.scheduler.booked.`) && !seen.has(name));
  return { entries, stale };
}
async function withTimeout(url, init, timeoutMs = 700) {
  const ctl = new AbortController();
  let timer = null;
  const hardStop = new Promise((resolve) => {
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
async function register(stateUrl, name, content) {
  const res = await withTimeout(`${stateUrl}/api/state/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, content })
  });
  return Boolean(res && res.ok);
}
async function drop(stateUrl, name) {
  const res = await withTimeout(`${stateUrl}/api/state/drop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  return Boolean(res && res.ok);
}
async function fire(eventUrl, name, payload) {
  if (!eventUrl) return;
  try {
    await withTimeout(`${eventUrl}/api/events/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, payload, source: "system" })
    });
  } catch {
  }
}
function readStandbyPolicy(root) {
  if (!root) return {};
  for (const rel of [path.join("Core", "data", "node.json"), path.join("Menu", "data", "node.json")]) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
      if (parsed && parsed.standby && typeof parsed.standby === "object") return parsed.standby;
    } catch {
    }
  }
  return {};
}
function idlePublish(jobs, ref, policy, now = /* @__PURE__ */ new Date(), bootAt = null) {
  const after = typeof policy.after === "number" && policy.after >= 0 ? policy.after : 45;
  const active = jobs.filter((job) => PUBLISHED.has(job.status));
  const ends = jobs.map((job) => job.finishedAt).filter((v) => typeof v === "string" && v.length > 0).sort();
  const lastEnd = ends.length ? ends[ends.length - 1] : null;
  const busy = active.length > 0;
  const quietFrom = lastEnd ? new Date(lastEnd) : bootAt ?? now;
  const base = quietFrom.getTime() > now.getTime() ? now : quietFrom;
  const idleSince = busy ? null : base.toISOString();
  const resumeAt = busy || !idleSince ? null : new Date(base.getTime() + after * 1e3).toISOString();
  return {
    name: `node.${ref}.idle`,
    content: {
      owner: "scheduler",
      ref,
      at: now.toISOString(),
      idle: !busy,
      idleSince,
      resumeAt,
      after,
      queued: active.filter((job) => job.status === "queued").length,
      running: active.filter((job) => job.status === "running").length,
      lastJobEnd: lastEnd,
      label: policy.label ?? null,
      pinned: policy.pinned === true
    }
  };
}
function startPublisher(options, getJobs, getStats, log = () => {
}) {
  const interval = options.intervalMs ?? 5e3;
  const eventUrl = process.env.SCHEDULER_EVENT_URL ?? "http://127.0.0.1:8126";
  const bootAt = /* @__PURE__ */ new Date();
  const announced = /* @__PURE__ */ new Map();
  let published = [];
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const jobs = getJobs();
    const { entries, stale } = schedulerPublish(jobs, getStats(), options.ref, published);
    const byId = new Map(jobs.map((job) => [job.id, job]));
    for (const job of jobs) {
      if (!PUBLISHED.has(job.status)) continue;
      announced.set(job.id, job.status);
      if (!announced.has(job.id + ":sent")) {
        announced.set(job.id + ":sent", "1");
        void fire(eventUrl, "job.submitted", { ref: options.ref, jobId: job.id, service: job.service ?? null });
      }
    }
    for (const key of [...announced.keys()]) {
      if (!key.endsWith(":sent")) continue;
      const id = key.slice(0, -":sent".length);
      const job = byId.get(id);
      if (job && PUBLISHED.has(job.status)) continue;
      void fire(eventUrl, "job.done", { ref: options.ref, jobId: id, status: job?.status ?? "left-book" });
      announced.delete(key);
      announced.delete(id);
    }
    let written = 0;
    for (const [name, content] of Object.entries(entries)) {
      if (name.includes(".booked.")) {
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
    const idle = idlePublish(jobs, options.ref, readStandbyPolicy(options.root ?? null), /* @__PURE__ */ new Date(), bootAt);
    await register(options.stateUrl, idle.name, idle.content);
    if (written || stale.length) log(`[publish] ${written} booked entries, ${stale.length} dropped`);
  };
  void tick();
  const handle = setInterval(() => void tick(), interval);
  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
    tick
  };
}
export {
  drop,
  idlePublish,
  readStandbyPolicy,
  refFromNodeJson,
  register,
  schedulerPublish,
  startPublisher
};
//# sourceMappingURL=publish.js.map
