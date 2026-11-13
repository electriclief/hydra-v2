/**
 * Access — the door that runs a command line on a node and returns console out.
 *
 * The agent (EchidnaAccess, :8142 per node) does the executing and the elevating. This door is the surface: one page,
 * one box, one Run button, and an API an agent can call. It owns no privileges of its own — a door that could elevate
 * by itself would be a second, silent way into the machine.
 *
 *   GET  /                  the page
 *   GET  /health            {ok, nodes, up}
 *   GET  /api/nodes         every node in the ledger + this box, probed live
 *   POST /api/run           {node, cmd, cwd?, timeoutSec?} -> the agent's verbatim result
 *   GET  /api/runs?limit=   what this door has run, newest first
 *   GET  /api/audit?node=&limit=   the node's own audit trail, proxied
 *   GET  /help.html         the module docs (the docs gate reads module/Access/help.html)
 *
 * A node that cannot be reached answers with the reason and its address, never with an empty list: a 200 carrying []
 * reads as "nothing to do", which is the one lie this door must not tell.
 */
import { createServer } from 'node:http';
import { readFile, readdir, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT || 8143);
const LEDGER = 'C:/AI/fleet/access.json';
const RUNS = join(ROOT, 'data', 'runs.jsonl');
// The controller's own agent is reached by its LAN address, not 127.0.0.1: an installed agent's allow.json names
// 192.168.1.123, and going out and back in through the same NIC is what keeps one code path for every node.
const SELF = { ref: 'self', ip: '192.168.1.123', port: 8142, host: '(this box)' };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

async function ledger() {
  try {
    const raw = JSON.parse(await readFile(LEDGER, 'utf8'));
    const out = [];
    for (const [ip, v] of Object.entries(raw)) {
      if (ip.startsWith('_') || !v || typeof v !== 'object') continue;
      out.push({ ref: v.ref || ip, ip, port: Number(v.port || 8142), host: v.host || '', token: v.token || '' });
    }
    return out;
  } catch { return []; }
}

/**
 * Nodes that installed themselves. The installer posts its transcript to the controller's /post, so a box that was
 * handed the one-line bootstrap shows up here without anybody editing the ledger: read the install reports in the
 * inbox, take "host: NAME (IP)" from the header and "VERDICT: WORKING", and add any ip the ledger does not already
 * have. Discovery is additive only - a hand-written ledger entry (with a token) always wins.
 */
async function discover() {
  const out = [];
  try {
    const dir = 'C:/AI/serve/inbox';
    const names = (await readdir(dir)).filter(n => n.endsWith('.txt')).sort().slice(-80);
    const seen = new Set();
    for (const name of names) {
      let text = '';
      try { text = await readFile(join(dir, name), 'utf8'); } catch { continue; }
      if (!text.includes('=== echidna-access install ===')) continue;
      // Any install report counts, whatever its verdict: a box that failed its own health wait (a slow machine can
      // miss a 30 s window and come up a minute later) still belongs in the list. The live probe - not the report -
      // decides whether it is up, so the page never claims a node works because a file said so.
      const m = text.match(/host:\s*(\S+)\s*\((\d+\.\d+\.\d+\.\d+)\)/);
      if (!m) continue;
      const [, host, ip] = m;
      if (seen.has(ip)) continue;
      seen.add(ip);
      out.push({ ref: host, ip, port: 8142, host, token: '', discovered: true });
    }
  } catch { }
  return out;
}

/** The ledger plus whatever installed itself, with the ledger winning on the same ip. */
async function allNodes() {
  const known = await ledger();
  const byIp = new Map(known.map(n => [n.ip, n]));
  for (const d of await discover()) { if (!byIp.has(d.ip) && d.ip !== SELF.ip) byIp.set(d.ip, d); }
  return [...byIp.values()];
}

async function probe(node, ms = 1400) {
  const t0 = Date.now();
  try {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), ms);
    const r = await fetch(`http://${node.ip}:${node.port}/health`, { signal: c.signal });
    clearTimeout(timer);
    const j = await r.json();
    return { ...node, token: undefined, up: Boolean(j && j.ok), health: j, error: null, ms: Date.now() - t0 };
  } catch (err) {
    return { ...node, token: undefined, up: false, health: null, error: err.name === 'AbortError' ? `no answer in ${ms} ms` : String(err.message || err), ms: Date.now() - t0 };
  }
}

async function call(node, path, init = {}, ms = 12000) {
  const headers = { 'content-type': 'application/json' };
  if (node.token) headers['x-access-token'] = node.token;
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(`http://${node.ip}:${node.port}${path}`, { ...init, headers, signal: c.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { }
    return { status: r.status, json, text };
  } finally { clearTimeout(timer); }
}

async function resolveNode(name) {
  const all = await allNodes();
  const key = String(name || 'self').toLowerCase();
  if (key === 'self' || key === 'local' || key === '127.0.0.1') return SELF;
  const hit = all.find(n => n.ip === name) || all.find(n => String(n.ref).toLowerCase() === key) || all.find(n => String(n.host).toLowerCase() === key);
  return hit || null;
}

async function record(entry) {
  try {
    await mkdir(dirname(RUNS), { recursive: true });
    await appendFile(RUNS, JSON.stringify(entry) + '\n', 'utf8');
  } catch { }
}

function send(res, code, obj, type = 'application/json; charset=utf-8') {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 2 * 1024 * 1024) break; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return null; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path === '/health') {
    const nodes = await Promise.all((await allNodes()).map(n => probe(n, 1800)));
    return send(res, 200, { ok: true, door: 'access', nodes: nodes.length + 1, up: nodes.filter(n => n.up).length });
  }

  if (path === '/api/nodes') {
    const nodes = await Promise.all([SELF, ...(await allNodes())].map(n => probe(n)));
    return send(res, 200, { ok: true, nodes });
  }

  if (path === '/api/run' && req.method === 'POST') {
    const b = await bodyJson(req);
    if (!b || !b.cmd) return send(res, 400, { ok: false, error: 'body must be {node, cmd, cwd?, timeoutSec?}' });
    const node = await resolveNode(b.node);
    if (!node) return send(res, 404, { ok: false, error: `no node named ${b.node} in ${LEDGER}` });
    const timeoutSec = Math.min(Math.max(Number(b.timeoutSec) || 120, 1), 1800);
    const t0 = Date.now();
    try {
      const r = await call(node, '/exec', { method: 'POST', body: JSON.stringify({ cmd: b.cmd, cwd: b.cwd, timeoutSec }) }, timeoutSec * 1000 + 8000);
      const out = r.json || { ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 300)}` };
      await record({ at: new Date().toISOString(), node: node.ref, ip: node.ip, cmd: String(b.cmd).slice(0, 2000), exitCode: out.exitCode ?? null, ms: out.ms ?? null, roundTrip: Date.now() - t0, ok: Boolean(out.ok) });
      return send(res, 200, { ok: Boolean(out.ok), node: node.ref, ip: node.ip, ...out, roundTrip: Date.now() - t0 });
    } catch (err) {
      const error = err.name === 'AbortError' ? `the node did not answer within ${timeoutSec}s` : String(err.message || err);
      await record({ at: new Date().toISOString(), node: node.ref, ip: node.ip, cmd: String(b.cmd).slice(0, 2000), error, ok: false });
      return send(res, 502, { ok: false, node: node.ref, ip: node.ip, error });
    }
  }

  if (path === '/api/runs') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 200);
    let rows = [];
    try {
      const text = await readFile(RUNS, 'utf8');
      rows = text.trim().split('\n').filter(Boolean).slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { }
    return send(res, 200, { ok: true, count: rows.length, rows });
  }

  if (path === '/api/audit') {
    const node = await resolveNode(url.searchParams.get('node'));
    if (!node) return send(res, 404, { ok: false, error: 'no such node' });
    const limit = url.searchParams.get('limit') || '20';
    try {
      const r = await call(node, `/audit?limit=${encodeURIComponent(limit)}`, {}, 8000);
      return send(res, r.status, r.json || { ok: false, error: `HTTP ${r.status}` });
    } catch (err) {
      return send(res, 502, { ok: false, error: String(err.message || err) });
    }
  }

  let file = path;
  if (file === '/' || file === '') file = '/public/index.html';
  if (file === '/help.html') file = '/help.html';
  const abs = file.startsWith('/public/') ? join(ROOT, file) : join(ROOT, file.replace(/^\/+/, ''));
  if (!existsSync(abs)) return send(res, 404, `no such file: ${file}`, 'text/plain; charset=utf-8');
  const buf = await readFile(abs);
  res.writeHead(200, { 'content-type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(buf);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Access door on http://0.0.0.0:${PORT}  (page, /api/nodes, /api/run, /api/runs, /api/audit)`);
});
