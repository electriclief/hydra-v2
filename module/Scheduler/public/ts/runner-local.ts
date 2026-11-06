/**
 * @module runner-local
 * @description The runner that actually runs something, on this node, with one GPU.
 *
 *              Three jobs, in this order, for every step of a job graph:
 *                1. RESIDENCY — if the step drives a server-shaped service (llama-chat, llama-vision), make sure
 *                   THAT model is the one loaded. Stopping the incumbent is not enough: the kill call returns long
 *                   before the port is free, so we wait for the port itself to stop answering, then start the new
 *                   server through ProcessWrapper (tag basic-gui, so it never takes the single run slot).
 *                2. INVOKE — a server-shaped service is called on its own API; a run-per-job service (piper,
 *                   whisper) is driven through Basic_App's /api/basic/run and its artifact is read back from the
 *                   process output ("WROTE <path>"), never guessed from a filename convention.
 *                3. RECORD — the artifact goes into the job's own folder, and later steps reach it through a
 *                   `{{step.key}}` token that resolves from what the predecessor ACTUALLY wrote.
 *
 * @intent The card is held by one MODEL at a time; any number of non-GPU services run beside it. That is the
 *         whole scheduling law on this box, and this file is where it is enforced rather than described.
 */

import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Job, Runner, JobResult } from './scheduler.js';
import { fromLegacyJob, readySteps, resolveValues, validateGraph, type StepSpec } from './graph.js';
import { deliver, type DeliverMode, type Delivered } from './deliver.js';

// --- Interface Definitions ---

export interface Residency {
  service: string;
  port: number | null;
  pid: number | null;
  since: string;
  model: string | null;
}

export interface LocalRunnerOptions {
  /** Services door — the catalog of definitions. */
  servicesUrl?: string;
  /** Basic_App — /api/basic/run for run-per-job services. */
  basicUrl?: string;
  /** ProcessWrapper — starts servers, kills them, and keeps their output. */
  pwUrl?: string;
  /** Where a job's own folder lives. */
  dataRoot?: string;
  /** This node's alias in a job record, e.g. "127". A step naming another node is refused by name. */
  nodeAlias?: string;
  log?: (line: string) => void;
  /** How long to wait for a server to answer /health after it is started. */
  healthTimeoutMs?: number;
  /** How long a run-per-job step may take. */
  stepTimeoutMs?: number;
}

export interface LocalRunner extends Runner {
  /** The model that holds the card right now, or null when nothing is resident. */
  resident(): Residency | null;
}

// --- Function Definitions ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T = any>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${url} -> ${r.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(t);
  }
}

async function textOf(url: string, timeoutMs = 15000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

async function answers(url: string, timeoutMs = 2000): Promise<boolean> {
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

export function createLocalRunner(options: LocalRunnerOptions = {}): LocalRunner {
  const servicesUrl = options.servicesUrl ?? 'http://127.0.0.1:8128';
  const basicUrl = options.basicUrl ?? 'http://127.0.0.1:8130';
  const pwUrl = options.pwUrl ?? 'http://127.0.0.1:8125';
  const dataRoot = options.dataRoot ?? 'C:/AI/hydra-local/data/jobs';
  const nodeAlias = options.nodeAlias ?? process.env.HYDRA_NODE_ALIAS ?? '127';
  const log = options.log ?? (() => {});
  const healthTimeoutMs = options.healthTimeoutMs ?? 180000;
  const stepTimeoutMs = options.stepTimeoutMs ?? 600000;

  let residency: Residency | null = null;

  /** The service definition, straight from the catalog door. */
  async function definition(name: string): Promise<any | null> {
    try {
      const j = await json(`${servicesUrl}/api/services/${encodeURIComponent(name)}`);
      return (j as any).definition ?? (j as any).service ?? j;
    } catch {
      return null;
    }
  }

  function portOf(def: any): number | null {
    const init = Array.isArray(def?.variables?.init) ? def.variables.init : [];
    const row = init.find((v: any) => v?.name === 'port');
    const n = Number(row?.default);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function isServerShaped(def: any): boolean {
    return String(def?.gui?.kind ?? '') === 'command' && String(def?.gui?.value ?? '') !== '';
  }

  /** Free VRAM, or null when this box has no nvidia-smi to ask. */
  function freeVramMb(): number | null {
    try {
      const out = execFileSync('C:/Windows/System32/nvidia-smi.exe', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 });
      const n = Number.parseInt(String(out).trim().split(/\r?\n/)[0].trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Who is listening on a port. A server that survived a ProcessWrapper restart is an ORPHAN: the port is held,
   * the wrapper has no record of it, and killing by record is impossible. The port itself is the truth.
   */
  function listenerPid(port: number): number | null {
    try {
      const out = execFileSync('C:/Windows/System32/netstat.exe', ['-ano'], { encoding: 'utf8', timeout: 8000 });
      for (const line of String(out).split(/\r?\n/)) {
        const m = line.trim().match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
        if (m && Number(m[1]) === port) return Number(m[2]);
      }
    } catch { /* netstat unavailable */ }
    return null;
  }

  /** Every server-shaped service in the catalog and the port it would hold. */
  async function serverPorts(exclude: string): Promise<{ name: string; port: number }[]> {
    const out: { name: string; port: number }[] = [];
    try {
      const cat = await json<any>(`${servicesUrl}/api/services`);
      for (const e of (cat?.services ?? [])) {
        const nm = String(e?.name ?? '');
        if (!nm || nm === exclude) continue;
        const d = await definition(nm);
        if (!isServerShaped(d)) continue;
        const p = portOf(d);
        if (p) out.push({ name: nm, port: p });
      }
    } catch { /* catalog down: nothing to sweep */ }
    return out;
  }

  async function processes(): Promise<any[]> {
    try {
      const j = await json(`${pwUrl}/api/processes`);
      return Array.isArray((j as any).processes) ? (j as any).processes : [];
    } catch {
      return [];
    }
  }

  /**
   * Make `name` the model that holds the card.
   * Order matters: kill the incumbent, wait for the PORT to stop answering, only then start the successor.
   */
  async function ensureResident(name: string): Promise<Residency | null> {
    const def = await definition(name);
    if (!def) throw new Error(`no service definition for "${name}"`);
    if (!isServerShaped(def)) return null;

    const port = portOf(def);
    const launcher = String(def.gui.value);
    const tabName = `${name}:gui`;
    const list = await processes();

    const mine = list.find((p) => p.name === tabName);
    if (mine && port && (await answers(`http://127.0.0.1:${port}/health`))) {
      residency = { service: name, port, pid: mine.pid ?? null, since: residency?.since ?? new Date().toISOString(), model: modelFileOf(def) };
      log(`[local] ${name} already resident on :${port}`);
      return residency;
    }

    // ---- the law: share the box unless the card is actually tight ----
    const needMb = Math.round(Number(def?.needs?.vramGb ?? 0) * 1024);
    const wantsGpu = Boolean(def?.needs?.gpu) && needMb > 0;
    const free = freeVramMb();
    // unknown memory is NOT permission to kill someone else's model: share, and let a failed start be honest
    const room = free === null ? true : free >= needMb + 256;
    const others = list.filter((p) => p.tag === 'basic-gui' && p.name !== tabName);
    const incumbents = wantsGpu && !room ? others : [];
    log(`[local] ${name}: needsGpu=${wantsGpu} need=${needMb}MB free=${free === null ? 'unknown' : free + 'MB'} room=${room} others=[${others.map((p) => p.name).join(',')}] evict=${incumbents.length}`);
    if (others.length > 0 && incumbents.length === 0) {
      log(`[local] leaving ${others.map((p) => p.name).join(', ')} running: ${wantsGpu ? `the card has room (${free} MB free, needs ${needMb})` : 'this step does not need the card'}`);
    }

    // evict the incumbent only when the incoming step truly needs the memory it is holding
    if (wantsGpu && !room) {
      // 1) everything ProcessWrapper still has a record for
      for (const p of incumbents) {
        log(`[local] evicting ${p.name} (record ${p.id}, pid ${p.pid}) to make room for ${name}`);
        try { await json(`${pwUrl}/api/processes/${encodeURIComponent(p.id)}/kill`, { method: 'POST' }); } catch { /* already gone */ }
      }
      // 2) anything holding a model port WITHOUT a record - an orphan outlives the wrapper's memory
      const swept = await serverPorts(name);
      for (const other of swept) {
        const pid = listenerPid(other.port);
        if (!pid) continue;
        log(`[local] :${other.port} is still held by pid ${pid} (${other.name}) - stopping it by port`);
        try { execFileSync('C:/Windows/System32/taskkill.exe', ['/F', '/PID', String(pid)], { timeout: 8000 }); } catch { /* already gone */ }
      }
      // 3) wait for those ports to stop answering, then report the memory situation honestly
      for (const other of swept) {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline && (await answers(`http://127.0.0.1:${other.port}/health`))) await sleep(500);
      }
      log(`[local] after eviction: ${freeVramMb()} MB free`);
      residency = null;
    }

    if (port && (await answers(`http://127.0.0.1:${port}/health`))) {
      // the port is already serving OUR service (started by hand, or a crash-less restart)
      residency = { service: name, port, pid: null, since: new Date().toISOString(), model: modelFileOf(def) };
      return residency;
    }

    const rec = await json<any>(`${pwUrl}/api/processes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tabName, command: 'cmd.exe', args: ['/c', launcher], cwd: path.dirname(launcher), tag: 'basic-gui' }),
    });
    log(`[local] started ${tabName} (pid ${rec?.process?.pid})`);

    if (!port) throw new Error(`${name} declares no port; cannot prove it came up`);
    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await answers(`http://127.0.0.1:${port}/health`)) {
        residency = { service: name, port, pid: rec?.process?.pid ?? null, since: new Date().toISOString(), model: modelFileOf(def) };
        log(`[local] ${name} resident on :${port}`);
        return residency;
      }
      await sleep(1000);
    }
    throw new Error(`${name} never answered /health on :${port} within ${Math.round(healthTimeoutMs / 1000)}s`);
  }

  function modelFileOf(def: any): string | null {
    const first = Array.isArray(def?.models) ? def.models[0] : null;
    return first?.file ?? null;
  }

  /** A server-shaped service: call the service's own API with the step's values. */
  async function invokeServer(name: string, values: Record<string, unknown>): Promise<{ output: string; note: string }> {
    const def = await definition(name);
    const port = portOf(def);
    if (!port) throw new Error(`${name} declares no port`);
    const prompt = String(values.prompt ?? values.text ?? values.question ?? values.input ?? '').trim();
    if (!prompt) throw new Error(`${name} needs a prompt/text value to answer`);

    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: Number(values.max_tokens ?? 256),
      temperature: Number(values.temperature ?? 0.3),
    };
    if (values.model) body.model = values.model;

    const r = await json<any>(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, 180000);
    const text = r?.choices?.[0]?.message?.content ?? '';
    return { output: String(text), note: `${name} on :${port} answered ${r?.usage?.completion_tokens ?? '?'} tokens` };
  }

  /** A run-per-job service: drive it through Basic_App and read the artifact off ITS output. */
  async function runProcess(name: string, values: Record<string, unknown>): Promise<{ output: string; note: string; runId: string | null }> {
    const started = await json<any>(`${basicUrl}/api/basic/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, values }),
    });
    // the door names the record `runId`; `id` lives on the process record, not here
    const runId: string | null = started?.run?.runId ?? started?.runId ?? null;

    const deadline = Date.now() + stepTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(1000);
      const st = await json<any>(`${basicUrl}/api/basic/state`);
      if (!st?.busy) break;
    }

    // the door stops serving progress once the run settles, so the process record is the only door left
    let text = '';
    if (runId) {
      try {
        // this door answers plain text, not JSON - parsing it as JSON is what made the artifact invisible
        text = await textOf(`${pwUrl}/api/processes/${encodeURIComponent(runId)}/output`, 20000);
        if (text.trim().startsWith('{')) {
          try { const j = JSON.parse(text); text = String((j as any).text ?? text); } catch { /* it really was text */ }
        }
      } catch { /* no output door for this record */ }
    }
    const m = text.match(/WROTE\s+(.+?)(?:\s+\(|\r?\n|$)/);
    const wrote = m ? m[1].trim() : '';
    return { output: wrote, note: wrote ? `wrote ${wrote}` : 'ran, but its output did not name a file', runId };
  }

  /**
   * Attach a produced file into the job's own folder. Link first (one inode, no second copy), copy only when the
   * link cannot be made. The name carries the step id so two steps can never fight over one filename.
   */
  function attach(src: string, dataDir: string, stepId: string): string {
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

  async function run(job: Job): Promise<Omit<JobResult, 'ms'>> {
    const steps: StepSpec[] = Array.isArray((job as any).steps) && (job as any).steps.length
      ? (job as any).steps
      : fromLegacyJob(job as any);

    const check = validateGraph(steps);
    if (!check.ok) {
      const first = check.errors[0];
      throw new Error(`${first.code}: ${first.message}`);
    }

    const dataDir = String((job as any).dataDir ?? path.join(dataRoot, job.id));
    mkdirSync(dataDir, { recursive: true });

    const outputs: Record<string, Record<string, string>> = {};
    const done = new Set<string>();
    const artifacts: string[] = [];
    const notes: string[] = [];
    let guard = 0;

    while (done.size < steps.length) {
      if (guard++ > steps.length * 4) throw new Error('deadlock: no ready step and none finishing');

      const ready = readySteps(steps, done);
      if (ready.length === 0) {
        const stuck = steps.filter((s) => !done.has(String(s.id))).map((s) => s.id);
        throw new Error(`deadlock: nothing ready, ${stuck.join(', ')} waiting`);
      }

      for (const step of ready) {
        const id = String(step.id);
        if (step.node && step.node !== nodeAlias && step.node !== os.hostname()) {
          throw new Error(`remote_node_not_wired: step "${id}" wants node "${step.node}", and this runner only runs local steps`);
        }

        const resolved = resolveValues(step.values ?? {}, outputs);
        if (resolved.unresolved.length) {
          throw new Error(`unresolved_token: step "${id}" needs ${resolved.unresolved.join(', ')} and no step produced it`);
        }

        step.state = 'running';
        step.startedAt = new Date().toISOString();
        const t0 = Date.now();
        log(`[local] ${job.id}/${id} -> ${step.service}`);

        const def = await definition(String(step.service));
        if (!def) throw new Error(`no_such_service: "${step.service}" is not in the catalog`);

        let value: string;
        let note: string;
        try {
          if (isServerShaped(def)) {
            await ensureResident(String(step.service));
            const r = await invokeServer(String(step.service), resolved.values);
            value = r.output;
            note = r.note;
            // an answer is still a product: keep it in the job's folder so the folder is always the result
            try {
              const answerPath = path.join(dataDir, `${id}-answer.txt`);
              writeFileSync(answerPath, r.output, 'utf8');
              artifacts.push(answerPath);
            } catch { /* the answer still reached the caller */ }
          } else {
            const r = await runProcess(String(step.service), resolved.values);
            // A run that names no file produced nothing. Saying "done" would be the lie this runner exists to avoid.
            if (!r.output) {
              throw new Error(`no_artifact: ${step.service} ran but named no file (expected a "WROTE <path>" line)`);
            }
            const placed = attach(r.output, dataDir, id);
            value = placed;
            note = `${r.note} -> ${placed}`;
            artifacts.push(placed);
          }
        } catch (e) {
          step.state = 'failed';
          step.error = e instanceof Error ? e.message : String(e);
          step.finishedAt = new Date().toISOString();
          step.ms = Date.now() - t0;
          log(`[local] ${job.id}/${id} FAILED: ${step.error}`);
          throw e;
        }

        const keys = Array.isArray(step.produces) && step.produces.length ? step.produces : ['out'];
        step.output = {};
        for (const k of keys) step.output[k] = value;
        outputs[id] = { ...step.output };

        step.state = 'done';
        step.finishedAt = new Date().toISOString();
        step.ms = Date.now() - t0;
        done.add(id);
        notes.push(`${id} ${step.service}: ${note}`);
      }
    }

    // delivery: the folder is the product, and the mode that actually worked is reported
    let delivered: Delivered | null = null;
    const want = (job as any).deliver;
    if (want && want.dir) {
      try {
        delivered = deliver(dataDir, String(want.dir), (want.mode ?? 'auto') as DeliverMode);
        notes.push(`delivered ${delivered.mode} -> ${delivered.dest}`);
        log(`[local] delivered (${delivered.mode}) ${delivered.dest}`);
      } catch (e) {
        notes.push(`delivery refused: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      runner: 'local',
      executed: true,
      note: notes.join(' | '),
      outputs: artifacts,
      ...(delivered ? { delivered } : {}),
    } as unknown as Omit<JobResult, 'ms'>;
  }

  return {
    kind: 'local',
    description:
      'Runs the graph on this node: one model resident at a time (evict, wait for the port, start, wait /health), '
      + 'server steps invoked on their own API, run-per-job steps driven through Basic_App, artifacts in the job folder, '
      + 'delivery by link (junction / hard link) unless a copy is asked for.',
    resident: () => residency,
    run,
  };
}
