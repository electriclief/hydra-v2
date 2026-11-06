import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { fromLegacyJob, readySteps, resolveValues, validateGraph } from "./graph.js";
import { deliver } from "./deliver.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, init, timeoutMs = 15e3) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${url} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}
async function textOf(url, timeoutMs = 15e3) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}
async function answers(url, timeoutMs = 2e3) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch {
    return false;
  }
}
function createLocalRunner(options = {}) {
  const servicesUrl = options.servicesUrl ?? "http://127.0.0.1:8128";
  const basicUrl = options.basicUrl ?? "http://127.0.0.1:8130";
  const pwUrl = options.pwUrl ?? "http://127.0.0.1:8125";
  const dataRoot = options.dataRoot ?? "C:/AI/hydra-local/data/jobs";
  const nodeAlias = options.nodeAlias ?? process.env.HYDRA_NODE_ALIAS ?? "127";
  const log = options.log ?? (() => {
  });
  const healthTimeoutMs = options.healthTimeoutMs ?? 18e4;
  const stepTimeoutMs = options.stepTimeoutMs ?? 6e5;
  let residency = null;
  async function definition(name) {
    try {
      const j = await json(`${servicesUrl}/api/services/${encodeURIComponent(name)}`);
      return j.definition ?? j.service ?? j;
    } catch {
      return null;
    }
  }
  function portOf(def) {
    const init = Array.isArray(def?.variables?.init) ? def.variables.init : [];
    const row = init.find((v) => v?.name === "port");
    const n = Number(row?.default);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function isServerShaped(def) {
    return String(def?.gui?.kind ?? "") === "command" && String(def?.gui?.value ?? "") !== "";
  }
  function freeVramMb() {
    try {
      const out = execFileSync("C:/Windows/System32/nvidia-smi.exe", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 5e3 });
      const n = Number.parseInt(String(out).trim().split(/\r?\n/)[0].trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  function listenerPid(port) {
    try {
      const out = execFileSync("C:/Windows/System32/netstat.exe", ["-ano"], { encoding: "utf8", timeout: 8e3 });
      for (const line of String(out).split(/\r?\n/)) {
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) return Number(m[2]);
      }
    } catch {
    }
    return null;
  }
  async function serverPorts(exclude) {
    const out = [];
    try {
      const cat = await json(`${servicesUrl}/api/services`);
      for (const e of cat?.services ?? []) {
        const nm = String(e?.name ?? "");
        if (!nm || nm === exclude) continue;
        const d = await definition(nm);
        if (!isServerShaped(d)) continue;
        const p = portOf(d);
        if (p) out.push({ name: nm, port: p });
      }
    } catch {
    }
    return out;
  }
  async function processes() {
    try {
      const j = await json(`${pwUrl}/api/processes`);
      return Array.isArray(j.processes) ? j.processes : [];
    } catch {
      return [];
    }
  }
  async function ensureResident(name) {
    const def = await definition(name);
    if (!def) throw new Error(`no service definition for "${name}"`);
    if (!isServerShaped(def)) return null;
    const port = portOf(def);
    const launcher = String(def.gui.value);
    const tabName = `${name}:gui`;
    const list = await processes();
    const mine = list.find((p) => p.name === tabName);
    if (mine && port && await answers(`http://127.0.0.1:${port}/health`)) {
      residency = { service: name, port, pid: mine.pid ?? null, since: residency?.since ?? (/* @__PURE__ */ new Date()).toISOString(), model: modelFileOf(def) };
      log(`[local] ${name} already resident on :${port}`);
      return residency;
    }
    const needMb = Math.round(Number(def?.needs?.vramGb ?? 0) * 1024);
    const wantsGpu = Boolean(def?.needs?.gpu) && needMb > 0;
    const free = freeVramMb();
    const room = free === null ? true : free >= needMb + 256;
    const others = list.filter((p) => p.tag === "basic-gui" && p.name !== tabName);
    const incumbents = wantsGpu && !room ? others : [];
    log(`[local] ${name}: needsGpu=${wantsGpu} need=${needMb}MB free=${free === null ? "unknown" : free + "MB"} room=${room} others=[${others.map((p) => p.name).join(",")}] evict=${incumbents.length}`);
    if (others.length > 0 && incumbents.length === 0) {
      log(`[local] leaving ${others.map((p) => p.name).join(", ")} running: ${wantsGpu ? `the card has room (${free} MB free, needs ${needMb})` : "this step does not need the card"}`);
    }
    if (wantsGpu && !room) {
      for (const p of incumbents) {
        log(`[local] evicting ${p.name} (record ${p.id}, pid ${p.pid}) to make room for ${name}`);
        try {
          await json(`${pwUrl}/api/processes/${encodeURIComponent(p.id)}/kill`, { method: "POST" });
        } catch {
        }
      }
      const swept = await serverPorts(name);
      for (const other of swept) {
        const pid = listenerPid(other.port);
        if (!pid) continue;
        log(`[local] :${other.port} is still held by pid ${pid} (${other.name}) - stopping it by port`);
        try {
          execFileSync("C:/Windows/System32/taskkill.exe", ["/F", "/PID", String(pid)], { timeout: 8e3 });
        } catch {
        }
      }
      for (const other of swept) {
        const deadline2 = Date.now() + 3e4;
        while (Date.now() < deadline2 && await answers(`http://127.0.0.1:${other.port}/health`)) await sleep(500);
      }
      log(`[local] after eviction: ${freeVramMb()} MB free`);
      residency = null;
    }
    if (port && await answers(`http://127.0.0.1:${port}/health`)) {
      residency = { service: name, port, pid: null, since: (/* @__PURE__ */ new Date()).toISOString(), model: modelFileOf(def) };
      return residency;
    }
    const rec = await json(`${pwUrl}/api/processes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tabName, command: "cmd.exe", args: ["/c", launcher], cwd: path.dirname(launcher), tag: "basic-gui" })
    });
    log(`[local] started ${tabName} (pid ${rec?.process?.pid})`);
    if (!port) throw new Error(`${name} declares no port; cannot prove it came up`);
    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await answers(`http://127.0.0.1:${port}/health`)) {
        residency = { service: name, port, pid: rec?.process?.pid ?? null, since: (/* @__PURE__ */ new Date()).toISOString(), model: modelFileOf(def) };
        log(`[local] ${name} resident on :${port}`);
        return residency;
      }
      await sleep(1e3);
    }
    throw new Error(`${name} never answered /health on :${port} within ${Math.round(healthTimeoutMs / 1e3)}s`);
  }
  function modelFileOf(def) {
    const first = Array.isArray(def?.models) ? def.models[0] : null;
    return first?.file ?? null;
  }
  async function invokeServer(name, values) {
    const def = await definition(name);
    const port = portOf(def);
    if (!port) throw new Error(`${name} declares no port`);
    const prompt = String(values.prompt ?? values.text ?? values.question ?? values.input ?? "").trim();
    if (!prompt) throw new Error(`${name} needs a prompt/text value to answer`);
    const body = {
      messages: [{ role: "user", content: prompt }],
      max_tokens: Number(values.max_tokens ?? 256),
      temperature: Number(values.temperature ?? 0.3)
    };
    if (values.model) body.model = values.model;
    const r = await json(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }, 18e4);
    const text = r?.choices?.[0]?.message?.content ?? "";
    return { output: String(text), note: `${name} on :${port} answered ${r?.usage?.completion_tokens ?? "?"} tokens` };
  }
  async function runProcess(name, values) {
    const started = await json(`${basicUrl}/api/basic/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, values })
    });
    const runId = started?.run?.runId ?? started?.runId ?? null;
    const deadline = Date.now() + stepTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(1e3);
      const st = await json(`${basicUrl}/api/basic/state`);
      if (!st?.busy) break;
    }
    let text = "";
    if (runId) {
      try {
        text = await textOf(`${pwUrl}/api/processes/${encodeURIComponent(runId)}/output`, 2e4);
        if (text.trim().startsWith("{")) {
          try {
            const j = JSON.parse(text);
            text = String(j.text ?? text);
          } catch {
          }
        }
      } catch {
      }
    }
    const m = text.match(/WROTE\s+(.+?)(?:\s+\(|\r?\n|$)/);
    const wrote = m ? m[1].trim() : "";
    return { output: wrote, note: wrote ? `wrote ${wrote}` : "ran, but its output did not name a file", runId };
  }
  function attach(src, dataDir, stepId) {
    const dest = path.join(dataDir, `${stepId}-${path.basename(src)}`);
    try {
      linkSync(src, dest);
      return dest;
    } catch {
      try {
        copyFileSync(src, dest);
        return dest;
      } catch {
        return src;
      }
    }
  }
  async function run(job) {
    const steps = Array.isArray(job.steps) && job.steps.length ? job.steps : fromLegacyJob(job);
    const check = validateGraph(steps);
    if (!check.ok) {
      const first = check.errors[0];
      throw new Error(`${first.code}: ${first.message}`);
    }
    const dataDir = String(job.dataDir ?? path.join(dataRoot, job.id));
    mkdirSync(dataDir, { recursive: true });
    const outputs = {};
    const done = /* @__PURE__ */ new Set();
    const artifacts = [];
    const notes = [];
    let guard = 0;
    while (done.size < steps.length) {
      if (guard++ > steps.length * 4) throw new Error("deadlock: no ready step and none finishing");
      const ready = readySteps(steps, done);
      if (ready.length === 0) {
        const stuck = steps.filter((s) => !done.has(String(s.id))).map((s) => s.id);
        throw new Error(`deadlock: nothing ready, ${stuck.join(", ")} waiting`);
      }
      for (const step of ready) {
        const id = String(step.id);
        if (step.node && step.node !== nodeAlias && step.node !== os.hostname()) {
          throw new Error(`remote_node_not_wired: step "${id}" wants node "${step.node}", and this runner only runs local steps`);
        }
        const resolved = resolveValues(step.values ?? {}, outputs);
        if (resolved.unresolved.length) {
          throw new Error(`unresolved_token: step "${id}" needs ${resolved.unresolved.join(", ")} and no step produced it`);
        }
        step.state = "running";
        step.startedAt = (/* @__PURE__ */ new Date()).toISOString();
        const t0 = Date.now();
        log(`[local] ${job.id}/${id} -> ${step.service}`);
        const def = await definition(String(step.service));
        if (!def) throw new Error(`no_such_service: "${step.service}" is not in the catalog`);
        let value;
        let note;
        try {
          if (isServerShaped(def)) {
            await ensureResident(String(step.service));
            const r = await invokeServer(String(step.service), resolved.values);
            value = r.output;
            note = r.note;
            try {
              const answerPath = path.join(dataDir, `${id}-answer.txt`);
              writeFileSync(answerPath, r.output, "utf8");
              artifacts.push(answerPath);
            } catch {
            }
          } else {
            const r = await runProcess(String(step.service), resolved.values);
            if (!r.output) {
              throw new Error(`no_artifact: ${step.service} ran but named no file (expected a "WROTE <path>" line)`);
            }
            const placed = attach(r.output, dataDir, id);
            value = placed;
            note = `${r.note} -> ${placed}`;
            artifacts.push(placed);
          }
        } catch (e) {
          step.state = "failed";
          step.error = e instanceof Error ? e.message : String(e);
          step.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
          step.ms = Date.now() - t0;
          log(`[local] ${job.id}/${id} FAILED: ${step.error}`);
          throw e;
        }
        const keys = Array.isArray(step.produces) && step.produces.length ? step.produces : ["out"];
        step.output = {};
        for (const k of keys) step.output[k] = value;
        outputs[id] = { ...step.output };
        step.state = "done";
        step.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
        step.ms = Date.now() - t0;
        done.add(id);
        notes.push(`${id} ${step.service}: ${note}`);
      }
    }
    let delivered = null;
    const want = job.deliver;
    if (want && want.dir) {
      try {
        delivered = deliver(dataDir, String(want.dir), want.mode ?? "auto");
        notes.push(`delivered ${delivered.mode} -> ${delivered.dest}`);
        log(`[local] delivered (${delivered.mode}) ${delivered.dest}`);
      } catch (e) {
        notes.push(`delivery refused: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return {
      runner: "local",
      executed: true,
      note: notes.join(" | "),
      outputs: artifacts,
      ...delivered ? { delivered } : {}
    };
  }
  return {
    kind: "local",
    description: "Runs the graph on this node: one model resident at a time (evict, wait for the port, start, wait /health), server steps invoked on their own API, run-per-job steps driven through Basic_App, artifacts in the job folder, delivery by link (junction / hard link) unless a copy is asked for.",
    resident: () => residency,
    run
  };
}
export {
  createLocalRunner
};
//# sourceMappingURL=runner-local.js.map
