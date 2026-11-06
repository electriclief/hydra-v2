import http from "node:http";
import { readFileSync } from "node:fs";
import { Scheduler } from "./scheduler.js";
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
function sendHtml(res, status, body) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}
async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk;
    size += buf.length;
    if (size > limit) throw new Error("body too large (max 256 KB)");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function readStandby(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return normalizeStandby(parsed);
  } catch {
    return null;
  }
}
function normalizeStandby(parsed) {
  if (!parsed || typeof parsed.miner !== "boolean") return null;
  return {
    ai: typeof parsed.ai === "string" ? parsed.ai : "",
    miner: parsed.miner,
    pinned: parsed.pinned === true,
    at: typeof parsed.at === "string" ? parsed.at : "",
    working: typeof parsed.working === "number" ? parsed.working : void 0,
    parked: typeof parsed.parked === "number" ? parsed.parked : void 0,
    mode: parsed.mode === "ai" || parsed.mode === "mining" || parsed.mode === "idle" ? parsed.mode : void 0,
    minerDetail: parsed.minerDetail && typeof parsed.minerDetail === "object" ? parsed.minerDetail : null,
    busySince: typeof parsed.busySince === "string" ? parsed.busySince : null,
    idleSince: typeof parsed.idleSince === "string" ? parsed.idleSince : null,
    resumeAt: typeof parsed.resumeAt === "string" ? parsed.resumeAt : null,
    grace: typeof parsed.grace === "number" ? parsed.grace : void 0,
    poll: typeof parsed.poll === "number" ? parsed.poll : void 0
  };
}
async function readStandbyLive(ref, stateUrl, file) {
  if (stateUrl && ref) {
    try {
      const res = await fetch(`${stateUrl}/api/state/pull?name=${encodeURIComponent(`node.${ref}.standby`)}&follow=1`, {
        signal: AbortSignal.timeout(900)
      });
      if (res.ok) {
        const body = await res.json();
        const standby = body.ok ? normalizeStandby(body.content) : null;
        if (standby) return { standby, source: "state" };
      }
    } catch {
    }
  }
  const fileStandby = readStandby(file);
  return { standby: fileStandby, source: fileStandby ? "file" : "none" };
}
function span(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function statusParts(scheduler, ref, standby, standbySource = "none") {
  const running = scheduler.current();
  const started = running?.startedAt ? Date.parse(running.startedAt) : NaN;
  const elapsedS = Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1e3)) : 0;
  const runnerOpt = scheduler.options.runner;
  const runner = typeof runnerOpt === "string" ? runnerOpt : String(runnerOpt?.kind ?? "unknown");
  const aiWork = standby ? standby.mode ? standby.mode === "ai" : typeof standby.working === "number" ? standby.working > 0 : Boolean(standby.ai) : false;
  const parked = standby?.parked ?? 0;
  const resumeAtMs = standby?.resumeAt ? Date.parse(standby.resumeAt) : NaN;
  const cardFree = !running && !standby?.miner && !aiWork;
  const idleInS = cardFree && Number.isFinite(resumeAtMs) ? Math.max(0, Math.round((resumeAtMs - Date.now()) / 1e3)) : null;
  return {
    ref,
    runner,
    running: running ? { id: running.id, service: running.service ?? null, elapsedS } : null,
    queued: scheduler.stats().queued,
    standby,
    standbySource,
    aiWork,
    parked,
    idleInS
  };
}
function statusLineOf(parts) {
  const node = parts.ref ? `${parts.ref} \xB7 ` : "";
  if (parts.running) {
    const what = parts.running.service || parts.running.id;
    const tail = parts.queued > 0 ? ` \xB7 ${parts.queued} waiting` : "";
    return `${node}GPU \xB7 ${what} \xB7 running ${span(parts.running.elapsedS)}${tail}`;
  }
  if (parts.queued > 0) return `${node}GPU \xB7 idle \xB7 ${parts.queued} booked, next starts on release`;
  if (parts.aiWork) return `${node}GPU \xB7 ${parts.standby?.ai || "AI work"} \xB7 AI work`;
  if (parts.standby?.miner) {
    const md = parts.standby.minerDetail;
    const doing = md && (md.label || md.algo) ? `${md.label || md.algo}${typeof md.rate === "number" ? ` ${md.rate} ${md.unit ?? ""}`.trimEnd() : ""}` : "mining";
    const held = parts.parked ? ` \xB7 ${parts.parked} parked` : "";
    return `${node}GPU \xB7 Idle Service \xB7 ${doing}${held} (AI preempts)`;
  }
  if (parts.idleInS != null) return `${node}GPU \xB7 idle \xB7 Idle Service resumes in ${span(parts.idleInS)}`;
  if (parts.standby) return `${node}GPU \xB7 idle \xB7 Idle Service standing by, no job booked`;
  return `${node}GPU \xB7 idle \xB7 nothing booked, no standby report`;
}
function renderPage(scheduler, apiBase = "") {
  const stats = scheduler.stats();
  const jobs = scheduler.list({ limit: 50 });
  const rows = jobs.length ? jobs.map((j) => [
    "<tr>",
    `<td><code>${escapeHtml(j.id)}</code></td>`,
    `<td>${escapeHtml(j.service)}</td>`,
    `<td><span class="st ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></td>`,
    `<td>${escapeHtml(j.createdAt.replace("T", " ").slice(0, 19))}</td>`,
    `<td>${escapeHtml(j.result?.note ?? j.error ?? (j.status === "queued" ? "waiting for the one slot" : "\u2014"))}</td>`,
    "</tr>"
  ].join("")).join("") : '<tr><td colspan="5" class="dim">the book is empty \u2014 POST /api/jobs {service, inputs}</td></tr>';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Scheduler \u2014 the book</title>
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
<h1>Scheduler \u2014 one job at a time</h1>
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
The dummy runner executes nothing \u2014 it exists so the wiring (submit \xB7 queue \xB7 run \xB7 status) is real
and a real runner changes one file, not one route.</footer>
<script>
(function () {
  var body = document.getElementById('book');
  var stats = { running: document.getElementById('st-running'), queued: document.getElementById('st-queued'), done: document.getElementById('st-done'), total: document.getElementById('st-total') };
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function row(j) {
    var note = j.result && j.result.note ? j.result.note : (j.error || (j.status === 'queued' ? 'waiting for the one slot' : '\u2014'));
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
        : '<tr><td colspan="5" class="dim">the book is empty \u2014 POST /api/jobs {service, inputs}</td></tr>';
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
function createSchedulerTools(scheduler, extras = {}) {
  return [
    {
      name: "scheduler_submit",
      description: "Book a job: {service, inputs}. It is QUEUED and runs when the one slot is free \u2014 use scheduler_status or scheduler_jobs to see what happened. The runner is a dummy today: the job is recorded and nothing is executed.",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "The service name from the catalog, e.g. llama-chat." },
          inputs: { type: "object", description: "The declared input values for that service." },
          note: { type: "string", description: "A line for the book." }
        },
        required: ["service"]
      },
      async run(args) {
        try {
          const job = scheduler.submit({
            service: String(args.service ?? ""),
            inputs: args.inputs && typeof args.inputs === "object" ? args.inputs : {},
            note: typeof args.note === "string" ? args.note : null
          });
          return { text: JSON.stringify({ ok: true, job, note: "queued \u2014 poll scheduler_jobs for the outcome" }, null, 2) };
        } catch (e) {
          return { text: `scheduler_submit refused it: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
      }
    },
    {
      name: "scheduler_jobs",
      description: "The book, newest first. Optional status filter (queued|running|done|failed|cancelled) and limit.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "queued \xB7 running \xB7 done \xB7 failed \xB7 cancelled" },
          limit: { type: "number", description: "How many to return (default 20)." }
        }
      },
      async run(args) {
        const status = typeof args.status === "string" ? args.status : void 0;
        const limit = Number.parseInt(String(args.limit ?? "20"), 10) || 20;
        return { text: JSON.stringify({ stats: scheduler.stats(), jobs: scheduler.list({ status, limit }) }, null, 2) };
      }
    },
    {
      name: "scheduler_status",
      description: `What is running now, what is waiting, and the count per state. Use before booking more. Also carries statusline: the one-line answer to "what is this box's GPU doing right now".`,
      inputSchema: { type: "object", properties: {} },
      async run() {
        const live = await readStandbyLive(extras.ref ?? "scheduler", extras.stateUrl, extras.standbyFile);
        const parts = statusParts(scheduler, extras.ref ?? "scheduler", live.standby, live.source);
        return {
          text: JSON.stringify(
            {
              runner: scheduler.options.runner,
              stats: scheduler.stats(),
              running: scheduler.current(),
              queued: scheduler.queued(),
              statusline: statusLineOf(parts),
              parts
            },
            null,
            2
          )
        };
      }
    }
  ];
}
async function startApiServer(options) {
  const tools = createSchedulerTools(options.scheduler, { ref: options.ref, standbyFile: options.standbyFile, stateUrl: options.stateUrl });
  const handleRpc = (body) => {
    const msg = body;
    const id = msg?.id ?? null;
    const method = msg?.method ?? "";
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "scheduler", version: "0.1.0" }
        }
      };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        }
      };
    }
    if (method === "tools/call") {
      const name = String(msg.params?.name ?? "");
      const args = msg.params?.arguments ?? {};
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { jsonrpc: "2.0", id, error: { code: -32601, message: `no such tool: ${name}` } };
      return tool.run(args).then((out) => ({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: out.text }], isError: out.isError === true }
      }));
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `no such method: ${method}` } };
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${options.host}`);
      const p = url.pathname;
      const method = req.method ?? "GET";
      if (method === "GET" && (p === "/" || p === "/index.html")) {
        sendHtml(res, 200, renderPage(options.scheduler, ""));
        return;
      }
      if (method === "GET" && p === "/health") {
        sendJson(res, 200, {
          ok: true,
          module: "scheduler",
          runner: options.scheduler.options.runner.kind,
          concurrency: options.scheduler.options.concurrency,
          file: options.scheduler.options.file,
          stats: options.scheduler.stats()
        });
        return;
      }
      if (method === "GET" && p === "/api/queue") {
        sendJson(res, 200, { ok: true, running: options.scheduler.current(), queued: options.scheduler.queued() });
        return;
      }
      if (method === "GET" && p === "/api/stats") {
        sendJson(res, 200, { ok: true, ...options.scheduler.stats() });
        return;
      }
      if (method === "GET" && p === "/api/jobs") {
        const status = (url.searchParams.get("status") ?? "").trim();
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
        sendJson(res, 200, {
          ok: true,
          stats: options.scheduler.stats(),
          jobs: options.scheduler.list({ status: status || void 0, limit })
        });
        return;
      }
      if (method === "POST" && p === "/api/jobs") {
        let body = {};
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch (e) {
          sendJson(res, 400, { error: { code: "bad_json", message: e instanceof Error ? e.message : String(e) } });
          return;
        }
        try {
          const job = options.scheduler.submit({
            service: body.service === void 0 ? void 0 : String(body.service),
            inputs: body.inputs && typeof body.inputs === "object" ? body.inputs : {},
            note: typeof body.note === "string" ? body.note : null,
            // the graph form: a job that is a DAG, not a service call
            title: typeof body.title === "string" ? body.title : void 0,
            steps: Array.isArray(body.steps) ? body.steps : void 0,
            deliver: body.deliver && typeof body.deliver === "object" ? body.deliver : void 0,
            sessionRef: typeof body.sessionRef === "string" ? body.sessionRef : null,
            dataDir: typeof body.dataDir === "string" ? body.dataDir : void 0
          });
          sendJson(res, 201, { ok: true, job, queue: { running: options.scheduler.current()?.id ?? null, waiting: options.scheduler.stats().queued } });
        } catch (e) {
          const err = e;
          sendJson(res, 400, { error: { code: err.code ?? "invalid_job", message: err.message ?? String(e) } });
        }
        return;
      }
      if (method === "GET" && p === "/api/statusline") {
        const live = await readStandbyLive(options.ref ?? "scheduler", options.stateUrl, options.standbyFile);
        const parts = statusParts(options.scheduler, options.ref ?? "scheduler", live.standby, live.source);
        sendJson(res, 200, { ok: true, line: statusLineOf(parts), parts });
        return;
      }
      if (method === "GET" && p === "/api/resident") {
        const runner = options.scheduler.options.runner;
        const resident = typeof runner.resident === "function" ? runner.resident() : null;
        sendJson(res, 200, { ok: true, runner: runner.kind, resident });
        return;
      }
      if (p.startsWith("/api/jobs/")) {
        const rest = p.slice("/api/jobs/".length);
        const cancel = method === "POST" && rest.endsWith("/cancel");
        const id = cancel ? rest.slice(0, rest.length - "/cancel".length) : rest;
        if (method === "GET" && !cancel) {
          const job = options.scheduler.get(id);
          if (!job) {
            sendJson(res, 404, { error: { code: "no_such_job", message: `no job ${id} \u2014 GET /api/jobs for the book` } });
            return;
          }
          sendJson(res, 200, { ok: true, job });
          return;
        }
        if (cancel) {
          const out = options.scheduler.cancel(id);
          sendJson(res, out.ok ? 200 : out.job ? 409 : 404, { ok: out.ok, reason: out.reason, job: out.job });
          return;
        }
        sendJson(res, 405, { error: { code: "method_not_allowed", message: "a job answers GET, or POST /cancel" } });
        return;
      }
      if (p === "/mcp" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch (e) {
          sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: e instanceof Error ? e.message : String(e) } });
          return;
        }
        const out = await handleRpc(body);
        sendJson(res, 200, out);
        return;
      }
      sendJson(res, 404, {
        error: {
          code: "no_route",
          message: `nothing at ${method} ${p} \u2014 the routes are / (the book), /health, /api/jobs, /api/jobs/:id, POST /api/jobs, POST /api/jobs/:id/cancel, /api/queue, /api/stats and POST /mcp`
        }
      });
    })().catch((err) => {
      try {
        sendJson(res, 500, { error: { code: "internal", message: err instanceof Error ? err.message : String(err) } });
      } catch {
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : options.port;
  return {
    server,
    port,
    url: `http://${options.host}:${port}`,
    stop: () => new Promise((resolve) => {
      server.close(() => resolve());
    })
  };
}
export {
  createSchedulerTools,
  normalizeStandby,
  readStandby,
  readStandbyLive,
  renderPage,
  startApiServer,
  statusLineOf,
  statusParts
};
//# sourceMappingURL=apiServer.js.map
