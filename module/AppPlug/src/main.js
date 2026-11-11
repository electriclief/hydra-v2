#!/usr/bin/env node
/**
 * AppPlug — the plug for apps that only know how to print.
 *
 * The operator's shape: "foo_bar.exe has console out, and a wrapper just pulls the relevant data — this wrapper
 * registers as a resolver for state — when foobar progress is requested, this state resolver answers".
 *
 * So this door is an ADAPTER, not a database:
 *
 *   1. it runs the app (one child, stdout+stderr captured),
 *   2. it parses the lines the manifest names into paths (`progress`, `phase`, `errors`…),
 *   3. it publishes ONE link into State — `foo_bar -> http://127.0.0.1:<port>` — so the LAN's resolver can find it,
 *   4. it answers `/api/resolve?name=<remainder>` from what it parsed, and re-asserts the link once a minute.
 *
 * The three rules that make it honest:
 *
 *   FRESHNESS TRAVELS. Every value carries `at`. Ask after `staleMs` without a new line and the answer is
 *   `{ok:false, why:'stale'}` — never the last number pretending to be live. A dead app answers `gone`, never 0 %.
 *
 *   THE NAMESPACE IS LOCKED. If another live adapter already holds `foo_bar`, this one refuses to start rather than
 *   answering for an app it is not running. Same spirit as a duplicate ref: a boot refusal, not a coin flip.
 *
 *   A CHILD IS NOT A DAEMON. The adapter owns the app: kill the adapter and the child goes with it, so nothing is
 *   ever left running that the ProcessWrapper table cannot see.
 *
 *   node src/main.js --port 8156 --state http://127.0.0.1:8127 --app apps/foo_bar.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(argOf('port', process.env.APPPLUG_PORT ?? 8156));
const HOST = argOf('host', process.env.APPPLUG_HOST ?? '127.0.0.1');
const STATE = String(argOf('state', process.env.APPPLUG_STATE ?? 'http://127.0.0.1:8127')).replace(/\/$/, '');
const MANIFEST = path.resolve(argOf('app', process.env.APPPLUG_APP ?? ''));
const REALERT_MS = Number(argOf('realert-ms', process.env.APPPLUG_REALERT_MS ?? 60000));

function fail(message) {
  console.error(`[appplug] ${message}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    fail(`cannot read manifest ${file}: ${e.message}`);
  }
}

const manifest = readJson(MANIFEST);
const APP = String(manifest.app || '').toLowerCase();
const NAMESPACE = String(manifest.namespace || APP).toLowerCase();
if (!APP || !NAMESPACE) fail('the manifest needs "app" and/or "namespace"');
if (!manifest.command) fail('the manifest needs "command"');

const adapter = manifest.adapter || {};
const KIND = String(adapter.kind || 'console').toLowerCase();
if (KIND !== 'console') fail(`adapter kind "${KIND}" is not built yet (only console)`);
const STALE_MS = Number(adapter.staleMs ?? manifest.staleMs ?? 15000);
const PATTERNS = (adapter.patterns || []).map((p) => ({
  re: new RegExp(p.match, p.flags || ''),
  paths: p.paths || {},
  drop: Boolean(p.drop),
}));

const values = new Map(); // path -> { value, at }
const log = []; // the last lines, for the human looking at /health
const stats = {
  app: APP, namespace: NAMESPACE, manifest: MANIFEST, state: STATE,
  startedAt: new Date().toISOString(), state_phase: 'starting',
  pid: null, exitCode: null, lines: 0, matched: 0, children: 0,
  link: null, linkAt: null, linkError: null, lastLineAt: null, spawnError: null,
};

const now = () => Date.now();
const setValue = (name, value) => values.set(name, { value, at: now() });

let child = null;
let restarting = false;

/** Parse one line into paths. A pattern may name groups (`paths: {pct: 'pct'}`) or the whole match (`paths: {x: 0}`). */
function ingest(line) {
  stats.lines += 1;
  stats.lastLineAt = now();
  setValue('line', line);
  setValue('lines', stats.lines);
  log.push(line);
  if (log.length > 40) log.shift();

  for (const pattern of PATTERNS) {
    const m = pattern.re.exec(line);
    if (!m) continue;
    stats.matched += 1;
    for (const [name, where] of Object.entries(pattern.paths)) {
      let value;
      if (Array.isArray(where)) {
        // pull many groups at once: { "shares": ["accepted", "rejected"] }
        const out = {};
        for (const group of where) out[group] = m.groups?.[group] ?? (typeof group === 'number' ? m[group] : undefined);
        value = out;
      } else if (typeof where === 'number') {
        value = m[where];
      } else if (typeof where === 'string' && m.groups && where in m.groups) {
        value = m.groups[where];
      } else {
        value = typeof where === 'string' ? where : m[0];
      }
      if (value !== undefined && value !== null && value !== '') {
        const numeric = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
        setValue(name, numeric);
      }
    }
    if (pattern.drop) { log.pop(); stats.lastLineAt = stats.lastLineAt; }
  }
}

/**
 * Answer for a path. Absence is typed and named: `gone` (the app exited), `stale` (no line for staleMs), `absent`
 * (the manifest never mapped it), `booting` (spawned, nothing printed yet).
 */
function answer(rawName) {
  const name = String(rawName || '')
    .trim()
    .replace(new RegExp(`^${NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?`), '');
  const at = new Date().toISOString();

  if (stats.state_phase === 'exited') {
    return { ok: false, name: name || NAMESPACE, why: 'gone', detail: `app exited (code ${stats.exitCode})`, at };
  }
  if (name === '' || name === 'status') {
    const progress = values.get('progress');
    return {
      ok: true, name: NAMESPACE, at,
      content: {
        app: APP, phase: stats.state_phase, pid: stats.pid, progress: progress?.value ?? null,
        lines: stats.lines, since: stats.startedAt, exitCode: stats.exitCode,
      },
    };
  }
  const held = values.get(name);
  if (!held) {
    return {
      ok: false, name, why: stats.lines === 0 ? 'booting' : 'absent', at,
      detail: stats.lines === 0 ? 'the app has printed nothing yet' : `no pattern maps "${name}"`,
      known: [...values.keys()].sort(),
    };
  }
  const ageMs = now() - held.at;
  if (ageMs > STALE_MS) {
    return { ok: false, name, why: 'stale', at, ageMs, content: { value: held.value, at: new Date(held.at).toISOString() }, detail: `no new value for ${Math.round(ageMs / 1000)}s (limit ${Math.round(STALE_MS / 1000)}s)` };
  }
  return { ok: true, name, at, content: { value: held.value, at: new Date(held.at).toISOString() } };
}

async function withTimeout(url, init = {}, timeoutMs = 1200) {
  const ctl = new AbortController();
  let timer = null;
  const stop = new Promise((r) => { timer = setTimeout(() => { ctl.abort(); r({ ok: false, status: 0, body: null, error: 'timeout' }); }, timeoutMs); });
  const work = (async () => {
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null, error: e.name === 'AbortError' ? 'timeout' : String(e.message) };
    }
  })();
  try { return await Promise.race([work, stop]); } finally { clearTimeout(timer); }
}

/** Publish the link, and refuse to answer for a namespace someone else is really holding. */
async function publishLink({ check = false } = {}) {
  const target = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  const existing = await withTimeout(`${STATE}/api/state/pull?name=${encodeURIComponent(NAMESPACE)}`, {}, 1200);
  const held = existing.ok ? existing.body?.content : null;

  if (check && held && held.kind === 'link' && typeof held.to === 'string' && held.to !== target) {
    const live = await withTimeout(`${held.to}/health`, {}, 900);
    if (live.ok) fail(`namespace "${NAMESPACE}" is held by a live adapter at ${held.to} - refusing to answer for an app this node is not running`);
  }
  const entry = { kind: 'link', to: target, at: new Date().toISOString(), app: APP, door: 'appplug' };
  const res = await withTimeout(`${STATE}/api/state/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: NAMESPACE, content: entry }),
  }, 1500);
  stats.link = entry;
  stats.linkAt = res.ok ? new Date().toISOString() : stats.linkAt;
  stats.linkError = res.ok ? null : res.error || `status ${res.status}`;
  return res.ok;
}

function startApp() {
  stats.state_phase = 'starting';
  stats.exitCode = null;
  const args = Array.isArray(manifest.args) ? manifest.args : [];
  child = spawn(manifest.command, args, {
    cwd: manifest.cwd || process.cwd(),
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...(manifest.env || {}) },
  });
  stats.pid = child.pid ?? null;
  stats.children += 1;
  stats.state_phase = 'running';

  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) ingest(line.trim());
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (e) => {
    stats.spawnError = e.message;
    stats.state_phase = 'exited';
    stats.exitCode = -1;
  });
  child.on('exit', (code) => {
    stats.state_phase = 'exited';
    stats.exitCode = code;
    child = null;
    if (restarting) { restarting = false; startApp(); }
  });
  return stats.pid;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  if (url.pathname === '/health') {
    return send(200, {
      ok: true, door: 'appplug', ref: NAMESPACE, phase: stats.state_phase, pid: stats.pid,
      lines: stats.lines, matched: stats.matched, staleMs: STALE_MS, link: stats.link, linkAt: stats.linkAt,
      linkError: stats.linkError, lastLineAt: stats.lastLineAt ? new Date(stats.lastLineAt).toISOString() : null,
      spawnError: stats.spawnError, manifest: MANIFEST,
    });
  }
  if (url.pathname === '/api/resolve') return send(200, answer(url.searchParams.get('name') || ''));
  if (url.pathname === '/api/values') {
    const out = {};
    for (const [k, v] of values) out[k] = { value: v.value, at: new Date(v.at).toISOString(), ageMs: now() - v.at };
    return send(200, { ok: true, namespace: NAMESPACE, staleMs: STALE_MS, values: out });
  }
  if (url.pathname === '/api/log') return send(200, { ok: true, lines: log });
  if (url.pathname === '/api/restart' && req.method === 'POST') {
    if (!child) { startApp(); return send(200, { ok: true, restarted: true, pid: stats.pid }); }
    restarting = true;
    child.kill();
    return send(200, { ok: true, restarting: true, was: stats.pid });
  }
  if (url.pathname === '/api/stop' && req.method === 'POST') {
    if (child) child.kill();
    return send(200, { ok: true, stopping: true });
  }
  return send(404, { ok: false, why: 'no_route', detail: `${url.pathname} - this door serves /health, /api/resolve, /api/values, /api/log, POST /api/restart, POST /api/stop` });
});

server.on('error', (e) => fail(`cannot serve on :${PORT} - ${e.code || e.message}`));

(async () => {
  const ok = await publishLink({ check: true });
  console.log(`[appplug] ${APP} -> ${NAMESPACE}.* on ${HOST}:${PORT} (manifest ${path.basename(MANIFEST)})`);
  console.log(`[appplug] link ${ok ? 'published' : `NOT published (${stats.linkError})`} · staleMs ${STALE_MS}`);
  server.listen(PORT, HOST, () => {
    const pid = startApp();
    console.log(`[appplug] app started, pid ${pid}`);
  });
  setInterval(() => { publishLink().catch(() => null); }, REALERT_MS);
})();

// the adapter owns the app: no orphan ever outlives the row that ProcessWrapper can see
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(signal, () => {
    try { child?.kill(); } catch { /* already gone */ }
    process.exit(0);
  });
}
process.on('exit', () => { try { child?.kill(); } catch { /* already gone */ } });
