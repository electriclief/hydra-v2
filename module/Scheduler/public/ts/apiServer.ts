/**
 * @module apiServer
 * @description The HTTP face of the book: submit a job, read the queue, read one job, cancel
 *              one that has not started — plus a page a human can read and an MCP door an
 *              agent can call. The runner behind it is not this module's business.
 * @intent One door, one port, three surfaces (page · API · MCP). Nothing here spawns
 *         anything: submit() hands the job to the Scheduler, and the Scheduler decides when.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { Scheduler, type Job, type JobStatus } from './scheduler.js';

// --- Interface Definitions ---

export interface ApiOptions {
  scheduler: Scheduler;
  port: number;
  host: string;
  /** This node's short name, the same one the publisher uses. Defaults to 'scheduler'. */
  ref?: string;
  /** Optional: the standby guard's state file on this node. When present the status line can say what the
   *  Idle Service is doing, not just what the book is doing. A missing file is normal - not every node mines. */
  standbyFile?: string;
  /**
   * This node's State door. The status line reads `node.<ref>.standby` from here FIRST, because State is the
   * surface every screen can reach - a file is private to this box. The file remains a fallback for the case
   * where State is down but the guard is still running, and the line says which source it used.
   */
  stateUrl?: string;
}

/** What a node's standby (Idle Service) reports about itself. Written by the guard, read here - never invented. */
export interface StandbyState {
  ai: string;
  miner: boolean;
  pinned: boolean;
  at: string;
  /**
   * The guard's verdict on whether anything is actually working, and what the word "ai" means. `working` counts
   * the processes that need the card right now; `parked` counts loaded-but-idle servers that must NOT stop the
   * miner. Older guards omit both, which is why they are optional and default to ai-presence.
   */
  working?: number;
  parked?: number;
  mode?: 'ai' | 'mining' | 'idle';
  /** did the last standby start actually produce the standby? 'blocked' is a real, reportable state */
  verify?: 'ok' | 'blocked' | 'failed' | 'pending' | null;
  /** the standby's own name from node.json: "PearlPow mining" */
  standby?: string | null;
  /** what the miner says it is doing, asked of the miner itself (SRBMiner's JSON summary) - algorithm, rate, shares.
   * Absent when the miner publishes nothing; the line then says "mining" without inventing a number.
   */
  minerDetail?: {
    algo?: string;
    label?: string;
    rate?: number;
    unit?: string;
    accepted?: number;
    rejected?: number;
    pool?: string;
    at?: string;
  } | null;
  /** when the current AI work started (null while the card is free) */
  busySince?: string | null;
  /** when the node became free - the moment the guard's grace timer starts */
  idleSince?: string | null;
  /** when the guard will start the miner, by the guard's own clock. The only source of a countdown. */
  resumeAt?: string | null;
  grace?: number;
  poll?: number;
}

export interface StatusParts {
  ref: string;
  runner: string;
  running: { id: string; service: string | null; elapsedS: number } | null;
  queued: number;
  standby: StandbyState | null;
  /** true when the standby report says something is actually working (not merely loaded) */
  aiWork?: boolean;
  /** loaded-but-idle servers the guard is keeping in memory while the miner runs */
  parked?: number;
  /** where the standby report came from: State is the LAN truth, the file is this box's fallback */
  standbySource?: 'state' | 'file' | 'none';
  /** the Scheduler's own idle branch: when the book says the card may go back to the Idle Service */
  idle?: IdleState | null;
  /** who computed the countdown: the book, an older guard's own timer, or nobody */
  idleSource?: 'book' | 'guard' | 'none';
  /** seconds until the Idle Service is expected to take the card, when that is knowable */
  idleInS: number | null;
}

/**
 * `node.<ref>.idle` as the Scheduler publishes it. The Scheduler owns this branch because idle is a statement about
 * its book; the guard only executes the consequence (stop or start the standby).
 */
export interface IdleState {
  idle?: boolean;
  idleSince?: string | null;
  resumeAt?: string | null;
  after?: number;
  queued?: number;
  running?: number;
  lastJobEnd?: string | null;
  label?: string | null;
  pinned?: boolean;
  at?: string;
}

export interface RunningApi {
  server: http.Server;
  url: string;
  port: number;
  stop(): Promise<void>;
}

// --- Function Definitions ---

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error('body too large (max 256 KB)');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The standby guard reports itself to a file; this reads it. Anything malformed is treated as "no report",
 * because a status line that guesses is worse than one that admits it does not know.
 */
export function readStandby(file: string | undefined | null): StandbyState | null {
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StandbyState>;
    return normalizeStandby(parsed);
  } catch {
    return null;
  }
}

/** One shape for a standby report, whichever surface it came from. Malformed input is "no report", never a guess. */
export function normalizeStandby(parsed: Partial<StandbyState> | null | undefined): StandbyState | null {
  if (!parsed || typeof parsed.miner !== 'boolean') return null;
  return {
    ai: typeof parsed.ai === 'string' ? parsed.ai : '',
    miner: parsed.miner,
    pinned: parsed.pinned === true,
    at: typeof parsed.at === 'string' ? parsed.at : '',
    working: typeof parsed.working === 'number' ? parsed.working : undefined,
    parked: typeof parsed.parked === 'number' ? parsed.parked : undefined,
    mode: parsed.mode === 'ai' || parsed.mode === 'mining' || parsed.mode === 'idle' ? parsed.mode : undefined,
    minerDetail: parsed.minerDetail && typeof parsed.minerDetail === 'object' ? parsed.minerDetail : null,
    busySince: typeof parsed.busySince === 'string' ? parsed.busySince : null,
    idleSince: typeof parsed.idleSince === 'string' ? parsed.idleSince : null,
    resumeAt: typeof parsed.resumeAt === 'string' ? parsed.resumeAt : null,
    grace: typeof parsed.grace === 'number' ? parsed.grace : undefined,
    poll: typeof parsed.poll === 'number' ? parsed.poll : undefined,
  };
}

/**
 * The standby report as every other screen would see it: pulled from this node's State, following the node link.
 * Falls back to the guard's file only when State cannot answer, so a footer keeps working during a State restart
 * without pretending the file is the LAN truth.
 */
export async function readStandbyLive(
  ref: string,
  stateUrl: string | null | undefined,
  file: string | undefined | null,
): Promise<{ standby: StandbyState | null; source: 'state' | 'file' | 'none' }> {
  if (stateUrl && ref) {
    try {
      const res = await fetch(`${stateUrl}/api/state/pull?name=${encodeURIComponent(`node.${ref}.standby`)}&follow=1`, {
        signal: AbortSignal.timeout(900),
      });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; content?: Partial<StandbyState> };
        const standby = body.ok ? normalizeStandby(body.content) : null;
        if (standby) return { standby, source: 'state' };
      }
    } catch {
      /* State down or slow - fall through to the file the guard also writes */
    }
  }
  const fileStandby = readStandby(file);
  return { standby: fileStandby, source: fileStandby ? 'file' : 'none' };
}

function span(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Pure: the scheduler's own facts plus the standby report -> the parts an agent or a footer wants. */
export async function readIdleLive(
  ref: string,
  stateUrl: string | null | undefined,
): Promise<IdleState | null> {
  if (!stateUrl) return null;
  try {
    const res = await fetch(`${stateUrl}/api/state/pull?name=node.${ref}.idle`, { signal: AbortSignal.timeout(900) });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: IdleState };
    return body.content && typeof body.content === 'object' ? body.content : null;
  } catch {
    return null;
  }
}

export function statusParts(
  scheduler: Scheduler,
  ref: string,
  standby: StandbyState | null,
  standbySource: 'state' | 'file' | 'none' = 'none',
  idle: IdleState | null = null,
): StatusParts {
  const running = scheduler.current();
  const started = running?.startedAt ? Date.parse(running.startedAt) : NaN;
  const elapsedS = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0;
  const runnerOpt = (scheduler.options as { runner?: unknown }).runner;
  const runner = typeof runnerOpt === 'string'
    ? runnerOpt
    : String((runnerOpt as { kind?: unknown } | null)?.kind ?? 'unknown');
  // The countdown exists only when someone said when the card becomes free AND the card is genuinely free. A timer
  // shown during AI work would be a guess about how long the operator's job runs.
  // WORK, NOT PRESENCE: an idle server holding a model is parked, not busy. `working` is the guard's count of
  // processes that need the card; a guard too old to send it is read the old way, ai-string presence.
  const aiWork = standby ? (standby.mode ? standby.mode === 'ai' : (typeof standby.working === 'number' ? standby.working > 0 : Boolean(standby.ai))) : false;
  const parked = standby?.parked ?? 0;
  // The book's answer wins over the guard's own timer: idle is the Scheduler's statement, and an older guard that
  // still computes `resumeAt` itself is a fallback, not an equal.
  const idleResumeMs = idle?.resumeAt ? Date.parse(idle.resumeAt) : NaN;
  const guardResumeMs = standby?.resumeAt ? Date.parse(standby.resumeAt) : NaN;
  const resumeAtMs = Number.isFinite(idleResumeMs) ? idleResumeMs : guardResumeMs;
  const idleSource: 'book' | 'guard' | 'none' = Number.isFinite(idleResumeMs) ? 'book' : (Number.isFinite(guardResumeMs) ? 'guard' : 'none');
  const cardFree = !running && !standby?.miner && !aiWork;
  const idleInS = cardFree && Number.isFinite(resumeAtMs)
    ? Math.max(0, Math.round((resumeAtMs - Date.now()) / 1000))
    : null;
  return {
    ref,
    runner,
    running: running ? { id: running.id, service: running.service ?? null, elapsedS } : null,
    queued: scheduler.stats().queued,
    standby,
    standbySource,
    aiWork,
    parked,
    idle,
    idleSource,
    idleInS,
  };
}

/**
 * The one line the shell's footer shows. Ordered by what the card is actually doing: a job first, then work
 * waiting, then the Idle Service, then honestly nothing.
 */
export function statusLineOf(parts: StatusParts): string {
  const node = parts.ref ? `${parts.ref} · ` : '';
  if (parts.running) {
    const what = parts.running.service || parts.running.id;
    const tail = parts.queued > 0 ? ` · ${parts.queued} waiting` : '';
    return `${node}GPU · ${what} · running ${span(parts.running.elapsedS)}${tail}`;
  }
  if (parts.queued > 0) return `${node}GPU · idle · ${parts.queued} booked, next starts on release`;
  if (parts.aiWork) return `${node}GPU · ${parts.standby?.ai || 'AI work'} · AI work`;
  // A standby that was told to start and never appeared is the most important thing this line can say: the card is
  // idle, the node believes it is earning, and it is not. Say it before "mining" gets a chance to lie.
  if ((parts.standby?.verify === 'blocked' || parts.standby?.verify === 'failed') && !parts.standby?.miner) {
    const what = parts.standby.standby ? ` (${parts.standby.standby})` : '';
    return `${node}GPU · idle · Idle Service BLOCKED${what} - standby did not start`;
  }
  if (parts.standby?.miner) {
    // What the miner reports beats the word "mining": the algorithm and rate come from SRBMiner's own summary.
    // No detail means no number is invented - the line stays at "mining".
    const md = parts.standby.minerDetail;
    const doing = md && (md.label || md.algo)
      ? `${md.label || md.algo}${typeof md.rate === 'number' ? ` ${md.rate} ${md.unit ?? ''}`.trimEnd() : ''}`
      : 'mining';
    // models that are loaded but idle are named here, because "mining while a model sits in memory" is a real
    // state the operator must be able to see rather than guess at
    const held = parts.parked ? ` · ${parts.parked} parked` : '';
    return `${node}GPU · Idle Service · ${doing}${held} (AI preempts)`;
  }
  if (parts.idleInS != null) {
    // a deadline that has passed is not "0 seconds" forever: the guard is in the middle of starting the standby,
    // and the line should say so rather than freeze at zero
    if (parts.idleInS <= 0) return `${node}GPU · idle · Idle Service starting`;
    return `${node}GPU · idle · Idle Service resumes in ${span(parts.idleInS)}`;
  }
  if (parts.standby) return `${node}GPU · idle · Idle Service standing by, no job booked`;
  return `${node}GPU · idle · nothing booked, no standby report`;
}

/** The page: the book as a table, newest first. Read-only — submitting is the API's job. */
export function renderPage(scheduler: Scheduler, apiBase = ''): string {
  const stats = scheduler.stats();
  const jobs = scheduler.list({ limit: 50 });
  const rows = jobs.length
    ? jobs.map((j) => [
      '<tr>',
      `<td><code>${escapeHtml(j.id)}</code></td>`,
      `<td>${escapeHtml(j.service)}</td>`,
      `<td><span class="st ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></td>`,
      `<td>${escapeHtml(j.createdAt.replace('T', ' ').slice(0, 19))}</td>`,
      `<td>${escapeHtml(j.result?.note ?? j.error ?? (j.status === 'queued' ? 'waiting for the one slot' : '—'))}</td>`,
      '</tr>',
    ].join('')).join('')
    : '<tr><td colspan="5" class="dim">the book is empty — POST /api/jobs {service, inputs}</td></tr>';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Scheduler — the book</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #111318; color: #e5e7eb; font: 14px/1.6 system-ui, sans-serif; }
  h1 { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; color: #a1a8b7; margin: 0 0 14px; }
  .bar { display: flex; gap: 14px; flex-wrap: wrap; color: #a1a8b7; font-size: 12px; margin-bottom: 16px; }
  .bar b { color: #e5e7eb; font-weight: 600; }
  table { width: 100%; max-width: 1000px; border-collapse: collapse; background: #191c23; border: 1px solid #303541; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #242a34; vertical-align: top; }
  th { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #a1a8b7; font-weight: 600; }
  code { font: 12px ui-monospace, Consolas, monospace; color: #8ab4f8; }
  .dim { color: #7d8998; }
  .st { font-size: 11px; padding: 1px 7px; border-radius: 5px; border: 1px solid #3a4b65; color: #8ab4f8; }
  .st.done { border-color: #2f5a3f; color: #86d29b; }
  .st.failed, .st.cancelled { border-color: #5a3030; color: #e0a0a0; }
  .st.running { border-color: #5a4a2f; color: #e0c98a; }
  footer { margin-top: 16px; color: #7d8998; font-size: 12px; max-width: 1000px; }
</style></head>
<body>
<h1>Scheduler — one job at a time</h1>
<div class="bar">
  <span>runner <b>${escapeHtml(scheduler.options.runner.kind)}</b></span>
  <span>running <b id="st-running">${stats.running}</b></span>
  <span>queued <b id="st-queued">${stats.queued}</b></span>
  <span>done <b id="st-done">${stats.done}</b></span>
  <span>book <b id="st-total">${stats.total}</b></span>
</div>
<table>
  <thead><tr><th>id</th><th>service</th><th>status</th><th>created</th><th>result</th></tr></thead>
  <tbody id="book">${rows}</tbody>
</table>
<footer>POST ${escapeHtml(apiBase)}/api/jobs with {service, inputs, note} to book one.
The dummy runner executes nothing — it exists so the wiring (submit · queue · run · status) is real
and a real runner changes one file, not one route.</footer>
<script>
(function () {
  var body = document.getElementById('book');
  var stats = { running: document.getElementById('st-running'), queued: document.getElementById('st-queued'), done: document.getElementById('st-done'), total: document.getElementById('st-total') };
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function row(j) {
    var note = j.result && j.result.note ? j.result.note : (j.error || (j.status === 'queued' ? 'waiting for the one slot' : '—'));
    return '<tr><td><code>' + esc(j.id) + '</code></td><td>' + esc(j.service) + '</td>'
      + '<td><span class="st ' + esc(j.status) + '">' + esc(j.status) + '</span></td>'
      + '<td>' + esc(String(j.createdAt).replace('T', ' ').slice(0, 19)) + '</td><td>' + esc(note) + '</td></tr>';
  }
  async function tick() {
    try {
      var res = await fetch('/api/jobs?limit=50');
      var data = await res.json();
      body.innerHTML = data.jobs.length
        ? data.jobs.map(row).join('')
        : '<tr><td colspan="5" class="dim">the book is empty — POST /api/jobs {service, inputs}</td></tr>';
      stats.running.textContent = data.stats.running;
      stats.queued.textContent = data.stats.queued;
      stats.done.textContent = data.stats.done;
      stats.total.textContent = data.stats.total;
    } catch (e) { /* the door is down; the page keeps what it had */ }
    setTimeout(tick, 2500);
  }
  setTimeout(tick, 2500);
})();
</script>
</body></html>`;
}

/** The MCP tools: three, and each one is the same call the HTTP API makes. */
export function createSchedulerTools(
  scheduler: Scheduler,
  extras: { ref?: string; standbyFile?: string; stateUrl?: string } = {},
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }>;
}> {
  return [
    {
      name: 'scheduler_submit',
      description:
        'Book a job: {service, inputs}. It is QUEUED and runs when the one slot is free — use '
        + 'scheduler_status or scheduler_jobs to see what happened. The runner is a dummy today: '
        + 'the job is recorded and nothing is executed.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'The service name from the catalog, e.g. llama-chat.' },
          inputs: { type: 'object', description: 'The declared input values for that service.' },
          note: { type: 'string', description: 'A line for the book.' },
        },
        required: ['service'],
      },
      async run(args) {
        try {
          const job = scheduler.submit({
            service: String(args.service ?? ''),
            inputs: (args.inputs && typeof args.inputs === 'object' ? args.inputs : {}) as Record<string, unknown>,
            note: typeof args.note === 'string' ? args.note : null,
          });
          return { text: JSON.stringify({ ok: true, job, note: 'queued — poll scheduler_jobs for the outcome' }, null, 2) };
        } catch (e) {
          return { text: `scheduler_submit refused it: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
      },
    },
    {
      name: 'scheduler_jobs',
      description: 'The book, newest first. Optional status filter (queued|running|done|failed|cancelled) and limit.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'queued · running · done · failed · cancelled' },
          limit: { type: 'number', description: 'How many to return (default 20).' },
        },
      },
      async run(args) {
        const status = typeof args.status === 'string' ? (args.status as JobStatus) : undefined;
        const limit = Number.parseInt(String(args.limit ?? '20'), 10) || 20;
        return { text: JSON.stringify({ stats: scheduler.stats(), jobs: scheduler.list({ status, limit }) }, null, 2) };
      },
    },
    {
      name: 'scheduler_status',
      description: 'What is running now, what is waiting, and the count per state. Use before booking more. '
        + 'Also carries statusline: the one-line answer to "what is this box\'s GPU doing right now".',
      inputSchema: { type: 'object', properties: {} },
      async run() {
        const live = await readStandbyLive(extras.ref ?? 'scheduler', extras.stateUrl, extras.standbyFile);
        const idle = await readIdleLive(extras.ref ?? 'scheduler', extras.stateUrl);
        const parts = statusParts(scheduler, extras.ref ?? 'scheduler', live.standby, live.source, idle);
        return {
          text: JSON.stringify(
            {
              runner: scheduler.options.runner,
              stats: scheduler.stats(),
              running: scheduler.current(),
              queued: scheduler.queued(),
              statusline: statusLineOf(parts),
              parts,
            },
            null,
            2,
          ),
        };
      },
    },
  ];
}

export async function startApiServer(options: ApiOptions): Promise<RunningApi> {
  const tools = createSchedulerTools(options.scheduler, { ref: options.ref, standbyFile: options.standbyFile, stateUrl: options.stateUrl });

  const handleRpc = (body: unknown): unknown => {
    const msg = body as { id?: unknown; method?: string; params?: Record<string, unknown> };
    const id = msg?.id ?? null;
    const method = msg?.method ?? '';
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'scheduler', version: '0.1.0' },
        },
      };
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        },
      };
    }
    if (method === 'tools/call') {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { jsonrpc: '2.0', id, error: { code: -32601, message: `no such tool: ${name}` } };
      return tool.run(args).then((out) => ({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: out.text }], isError: out.isError === true },
      }));
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `no such method: ${method}` } };
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${options.host}`);
      const p = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && (p === '/' || p === '/index.html')) {
        sendHtml(res, 200, renderPage(options.scheduler, ''));
        return;
      }
      if (method === 'GET' && p === '/health') {
        sendJson(res, 200, {
          ok: true,
          module: 'scheduler',
          runner: options.scheduler.options.runner.kind,
          concurrency: options.scheduler.options.concurrency,
          file: options.scheduler.options.file,
          stats: options.scheduler.stats(),
        });
        return;
      }
      if (method === 'GET' && p === '/api/queue') {
        sendJson(res, 200, { ok: true, running: options.scheduler.current(), queued: options.scheduler.queued() });
        return;
      }
      if (method === 'GET' && p === '/api/stats') {
        sendJson(res, 200, { ok: true, ...options.scheduler.stats() });
        return;
      }
      if (method === 'GET' && p === '/api/jobs') {
        const status = (url.searchParams.get('status') ?? '').trim() as JobStatus | '';
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20;
        sendJson(res, 200, {
          ok: true,
          stats: options.scheduler.stats(),
          jobs: options.scheduler.list({ status: status || undefined, limit }),
        });
        return;
      }
      if (method === 'POST' && p === '/api/jobs') {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch (e) {
          sendJson(res, 400, { error: { code: 'bad_json', message: e instanceof Error ? e.message : String(e) } });
          return;
        }
        try {
          const job = options.scheduler.submit({
            service: body.service === undefined ? undefined : String(body.service),
            inputs: (body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) as Record<string, unknown>,
            note: typeof body.note === 'string' ? body.note : null,
            // the graph form: a job that is a DAG, not a service call
            title: typeof body.title === 'string' ? body.title : undefined,
            steps: Array.isArray(body.steps) ? (body.steps as never) : undefined,
            deliver: body.deliver && typeof body.deliver === 'object' ? (body.deliver as never) : undefined,
            sessionRef: typeof body.sessionRef === 'string' ? body.sessionRef : null,
            dataDir: typeof body.dataDir === 'string' ? body.dataDir : undefined,
          });
          sendJson(res, 201, { ok: true, job, queue: { running: options.scheduler.current()?.id ?? null, waiting: options.scheduler.stats().queued } });
        } catch (e) {
          // a refused graph says WHY in a code a caller can branch on, not just a sentence
          const err = e as { code?: string; message?: string };
          sendJson(res, 400, { error: { code: err.code ?? 'invalid_job', message: err.message ?? String(e) } });
        }
        return;
      }
      if (method === 'GET' && p === '/api/statusline') {
        // One line, one call: what this node's card is doing right now. The shell's footer reads this, and so
        // can a parent scheduler asking its children the same question - which is what makes it nest.
        const live = await readStandbyLive(options.ref ?? 'scheduler', options.stateUrl, options.standbyFile);
        const idle = await readIdleLive(options.ref ?? 'scheduler', options.stateUrl);
        const parts = statusParts(options.scheduler, options.ref ?? 'scheduler', live.standby, live.source, idle);
        sendJson(res, 200, { ok: true, line: statusLineOf(parts), parts });
        return;
      }
      if (method === 'GET' && p === '/api/resident') {
        // derived from the runner, never stored: whatever holds the card right now
        const runner = options.scheduler.options.runner as { kind: string; resident?: () => unknown };
        const resident = typeof runner.resident === 'function' ? runner.resident() : null;
        sendJson(res, 200, { ok: true, runner: runner.kind, resident });
        return;
      }
      if (p.startsWith('/api/jobs/')) {
        const rest = p.slice('/api/jobs/'.length);
        const cancel = method === 'POST' && rest.endsWith('/cancel');
        const id = cancel ? rest.slice(0, rest.length - '/cancel'.length) : rest;
        if (method === 'GET' && !cancel) {
          const job: Job | null = options.scheduler.get(id);
          if (!job) {
            sendJson(res, 404, { error: { code: 'no_such_job', message: `no job ${id} — GET /api/jobs for the book` } });
            return;
          }
          sendJson(res, 200, { ok: true, job });
          return;
        }
        if (cancel) {
          const out = options.scheduler.cancel(id);
          sendJson(res, out.ok ? 200 : (out.job ? 409 : 404), { ok: out.ok, reason: out.reason, job: out.job });
          return;
        }
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'a job answers GET, or POST /cancel' } });
        return;
      }
      if (p === '/mcp' && method === 'POST') {
        let body: unknown;
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch (e) {
          sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e instanceof Error ? e.message : String(e) } });
          return;
        }
        const out = await handleRpc(body);
        sendJson(res, 200, out);
        return;
      }

      sendJson(res, 404, {
        error: {
          code: 'no_route',
          message: `nothing at ${method} ${p} — the routes are / (the book), /health, /api/jobs, `
            + '/api/jobs/:id, POST /api/jobs, POST /api/jobs/:id/cancel, /api/queue, /api/stats and POST /mcp',
        },
      });
    })().catch((err: unknown) => {
      try {
        sendJson(res, 500, { error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } });
      } catch {
        /* already gone */
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : options.port;
  return {
    server,
    port,
    url: `http://${options.host}:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
