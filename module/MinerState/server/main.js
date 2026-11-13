/**
 * MinerState — the wrapper that talks to Hydra State about miners.
 *
 * A mining node has no Hydra shelf and no reason to get one: it runs a miner, and the miner publishes its own JSON on
 * an API port. This door is the adapter between the two. It reads each declared node's miner API, normalises the two
 * shapes that actually appear in this fleet (SRBMiner and lolMiner), and publishes `node.<ref>.miner` into State — the
 * same place every other node publishes `node.<ref>.*`. Mirror already reads State and the Menu already reads Mirror,
 * so "how many shares has ReX taken?" becomes a fleet question instead of a terminal command.
 *
 *   GET /                      a small live table (rate, shares, uptime, per-card)
 *   GET /health                {ok, nodes, readable, lastCycleAgoMs}
 *   GET /state                 every node's last reading
 *   GET /state?ref=rex         one node's last reading
 *
 * Two rules it exists to keep:
 *
 *   1. A miner API that is not readable is NOT a miner at zero. When nothing answers, State gets
 *      {readable:false, why:"no miner answering on 192.168.1.147:60130"} — a zero would read as "mining fine, earning
 *      nothing", which is the lie a share counter must never tell.
 *   2. Never assume the API shape. SRBMiner answers algorithms[0].hashrate.'1min' with shares.accepted; lolMiner
 *      answers Algorithms[0].Total_Performance * Performance_Factor with Total_Accepted and per-card Workers[]. A
 *      parser written for one reports zeros for the other while the card hashes at full rate.
 *
 * The miner's API is often bound to loopback on the node (unMiner's bundled SRBMiner is), so a direct fetch is tried
 * first and an EchidnaAccess agent call on the node second: POST /exec reading 127.0.0.1:<apiPort> from the box itself.
 */
import http from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NODES_FILE = join(ROOT, 'data', 'nodes.json');
const LOG = join(ROOT, 'data', 'miner-state.log');
const LEDGER = 'C:/AI/fleet/access.json';

const PORT = Number(argOf('--port', process.env.PORT || 8145));
const HOST = argOf('--host', process.env.HOST || '0.0.0.0');
const STATE = process.env.HYDRA_STATE_URL || 'http://127.0.0.1:8127';
const EVERY = Number(argOf('--every', process.env.EVERY_MS || 15000));
const ONCE = process.argv.includes('--once');

function argOf(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  const eq = process.argv.find(a => a.startsWith(name + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  return fallback;
}

const state = new Map(); // ref -> last reading
const lastError = new Map();
const lastShares = new Map();
let lastCycleAt = null;

async function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { await mkdir(dirname(LOG), { recursive: true }); await appendFile(LOG, line + '\n', 'utf8'); } catch { }
}

function fmtRate(h) {
  if (!Number.isFinite(h) || h <= 0) return '0 H/s';
  if (h >= 1e9) return `${(h / 1e9).toFixed(2)} GH/s`;
  if (h >= 1e6) return `${(h / 1e6).toFixed(2)} MH/s`;
  if (h >= 1e5) return `${(h / 1e3).toFixed(0)} kH/s`;
  return `${Math.round(h)} H/s`;
}

async function agentToken(host) {
  try {
    const led = JSON.parse(await readFile(LEDGER, 'utf8'));
    const entry = led[host];
    return (entry && entry.token) ? entry.token : '';
  } catch { return ''; }
}

/** Ask the node's own agent to read its loopback miner API. Used when the direct fetch fails. */
async function fetchViaAgent(node) {
  const token = await agentToken(node.host);
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-access-token'] = token;
  const cmd = `(Invoke-WebRequest -Uri 'http://127.0.0.1:${node.minerApiPort}/' -UseBasicParsing -TimeoutSec 8).Content`;
  const res = await fetch(`http://${node.host}:${node.agentPort}/exec`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cmd, timeoutSec: 25 }),
    signal: AbortSignal.timeout(35000)
  });
  if (!res.ok) throw new Error(`agent answered HTTP ${res.status}`);
  const j = await res.json();
  if (!j.ok) throw new Error(`agent refused: ${j.error || 'no detail'}`);
  const text = (j.stdout || '').trim();
  if (!text.startsWith('{')) throw new Error(`agent returned no JSON (${text.slice(0, 120)})`);
  return { json: JSON.parse(text), via: 'agent' };
}

async function fetchDirect(node) {
  for (const path of ['/', '/summary']) {
    try {
      const res = await fetch(`http://${node.host}:${node.minerApiPort}${path}`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim().startsWith('{')) continue;
      return { json: JSON.parse(text), via: 'direct' };
    } catch { }
  }
  throw new Error('no answer on the miner API');
}

/** SRBMiner, with lolMiner as the second shape. Returns {reading} or throws with a reason. */
function normalise(node, json) {
  const now = new Date().toISOString();

  // SRBMiner
  const sb = json?.algorithms?.[0];
  if (sb) {
    const hs = Number(sb?.hashrate?.['1min'] ?? sb?.hashrate?.['15min'] ?? 0);
    return {
      readable: true,
      kind: 'miner',
      miner: 'SRBMiner',
      node: node.ref,
      host: node.host,
      algo: sb?.name ?? null,
      hashrate_hs: hs,
      hashrate: fmtRate(hs),
      accepted: Number(sb?.shares?.accepted ?? 0),
      rejected: Number(sb?.shares?.rejected ?? 0),
      avg_find_time_s: sb?.shares?.avg_find_time ?? null,
      pool: sb?.pool?.pool ?? null,
      wallet: sb?.pool?.wallet ?? null,
      pool_uptime_s: sb?.pool?.uptime ?? null,
      miner_uptime_s: json?.mining_time ?? null,
      version: json?.miner_version ?? null,
      cards: (json?.gpu_devices ?? []).map(d => ({
        name: d?.model ?? d?.name ?? null,
        bus: d?.bus_id ?? null,
        rate: d?.hashrate ?? null
      })),
      at: now
    };
  }

  // lolMiner
  const lm = json?.Algorithms?.[0];
  if (lm || json?.Session) {
    const a = lm || {};
    const hs = Number(a?.Total_Performance ?? 0) * Number(a?.Performance_Factor ?? 1);
    const workers = Array.isArray(json?.Workers) ? json.Workers : [];
    return {
      readable: true,
      kind: 'miner',
      miner: 'lolMiner',
      node: node.ref,
      host: node.host,
      algo: a?.Algorithm ?? null,
      hashrate_hs: hs,
      hashrate: fmtRate(hs),
      accepted: Number(a?.Total_Accepted ?? 0),
      rejected: Number(a?.Total_Rejected ?? 0),
      avg_find_time_s: null,
      pool: json?.Pool?.Host ?? json?.Connection?.Pool ?? null,
      wallet: json?.Connection?.Wallet ?? null,
      pool_uptime_s: null,
      miner_uptime_s: json?.Session?.Uptime ?? null,
      version: json?.Software ?? null,
      cards: workers.map(w => ({
        name: w?.Name ?? null,
        bus: w?.PCIE_Address ?? null,
        temp_c: w?.Core_Temp ?? null,
        fan_pct: w?.Fan_Speed ?? null,
        power_w: w?.Power ?? null,
        cclk: w?.CCLK ?? null,
        mclk: w?.MCLK ?? null
      })),
      at: now
    };
  }

  throw new Error(`unrecognised miner API (keys: ${Object.keys(json || {}).slice(0, 8).join(', ') || 'none'})`);
}

async function publish(ref, content) {
  const res = await fetch(`${STATE}/api/state/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `node.${ref}.miner`, content }),
    signal: AbortSignal.timeout(4000)
  });
  if (!res.ok) throw new Error(`state answered HTTP ${res.status}`);
}

async function loadNodes() {
  const raw = JSON.parse(await readFile(NODES_FILE, 'utf8'));
  return (raw.nodes || []).filter(n => n && n.ref && n.host);
}

async function cycle() {
  const nodes = await loadNodes();
  let readable = 0;
  for (const node of nodes) {
    let reading;
    try {
      let got;
      try { got = await fetchDirect(node); }
      catch { got = await fetchViaAgent(node); }
      reading = { ...normalise(node, got.json), via: got.via, source: `http://${node.host}:${node.minerApiPort}/` };
      readable++;
      lastError.delete(node.ref);
    } catch (err) {
      reading = {
        readable: false,
        kind: 'miner',
        node: node.ref,
        host: node.host,
        why: `no miner answering on ${node.host}:${node.minerApiPort} — ${String(err.message || err)}`,
        hashrate: null,
        accepted: null,
        rejected: null,
        at: new Date().toISOString()
      };
      lastError.set(node.ref, reading.why);
    }
    state.set(node.ref, reading);

    // share deltas are the only evidence that a miner is still earning; a rate alone hides a pool refusing everything
    const prev = lastShares.get(node.ref);
    if (reading.readable && prev) {
      const da = reading.accepted - prev.accepted;
      const dr = reading.rejected - prev.rejected;
      if (da > 0) await log(`share accepted ${reading.node} (+${da}) ${reading.algo} ${reading.hashrate} ${reading.pool || ''}`.trim());
      if (dr > 0) await log(`SHARE REJECTED ${reading.node} (+${dr}) ${reading.algo} ${reading.pool || ''}`.trim());
      if (da === 0 && dr === 0 && prev) { /* quiet minute, nothing to say */ }
    }
    if (reading.readable) lastShares.set(node.ref, { accepted: reading.accepted, rejected: reading.rejected });

    try { await publish(node.ref, reading); }
    catch (err) { await log(`READ ok for ${node.ref} but NOT published — ${err.message}`); }
  }
  lastCycleAt = new Date().toISOString();
  return { nodes: nodes.length, readable };
}

async function page() {
  const rows = [...state.values()].map(r => r.readable
    ? `<tr><td>${r.node}</td><td>${r.miner}</td><td>${r.algo || ''}</td><td class="n">${r.hashrate}</td><td class="n">${r.accepted}</td><td class="n">${r.rejected}</td><td>${(r.pool || '').split('//').pop()}</td><td>${r.miner_uptime_s ? Math.round(r.miner_uptime_s / 60) + ' min' : ''}</td><td class="via">${r.via || ''}</td></tr>`
    : `<tr class="down"><td>${r.node}</td><td colspan="8">${r.why || 'not readable'}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="10">
<title>MinerState</title><style>
 body{margin:0;padding:28px;background:#0f1115;color:#e7e9ee;font:14px/1.6 system-ui,sans-serif}
 h1{font-size:20px;margin:0 0 4px}.k{color:#8b93a7;font-size:13px;margin:0 0 20px}
 table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2a2f3a}
 th{color:#8b93a7;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
 .n{text-align:right;font-family:ui-monospace,Consolas,monospace}.via{color:#8b93a7;font-size:11px}
 tr.down td{color:#e2705f}
</style></head><body><h1>MinerState</h1>
<p class="k">reads each miner's own API and publishes <code>node.&lt;ref&gt;.miner</code> into State · refreshes every 10 s</p>
<table><thead><tr><th>node</th><th>miner</th><th>algo</th><th>rate</th><th>accepted</th><th>rejected</th><th>pool</th><th>uptime</th><th>via</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9">nothing read yet</td></tr>'}</tbody></table></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (url.pathname === '/health') {
    const all = [...state.values()];
    // nodes/no-answer/text-to-speech distinction: a door that reports nodes:0 before its first read looks empty rather
    // than unread, so the declared count comes from the file and every node starts as "not read yet".
    return send(200, { ok: true, door: 'minerstate', nodes: all.length, readable: all.filter(r => r.readable).length, lastCycleAt });
  }
  if (url.pathname === '/state') {
    const ref = url.searchParams.get('ref');
    if (ref) {
      const r = state.get(ref);
      return send(r ? 200 : 404, r || { ok: false, error: `no reading for ${ref}` });
    }
    return send(200, { ok: true, count: state.size, nodes: [...state.values()] });
  }
  if (url.pathname === '/' || url.pathname === '/index.html') return send(200, await page(), 'text/html; charset=utf-8');
  return send(404, { ok: false, error: `no route ${url.pathname}` });
});

if (ONCE) {
  const r = await cycle();
  console.log(JSON.stringify({ ...r, nodes: [...state.values()] }, null, 2));
  process.exit(r.readable > 0 ? 0 : 1);
}

server.listen(PORT, HOST, async () => {
  console.log(`MinerState door on http://${HOST}:${PORT} — state ${STATE}, every ${EVERY / 1000}s`);
  // Every declared node exists in the table from the first second, marked unread, so the page never shows an empty
  // fleet while the first (slow, agent-mediated) read is still in flight.
  for (const n of await loadNodes()) {
    if (!state.has(n.ref)) state.set(n.ref, { readable: false, node: n.ref, host: n.host, why: 'not read yet — first cycle is running', at: new Date().toISOString() });
  }
  await cycle();
  setInterval(() => { cycle().catch(e => log(`cycle failed: ${e.message}`)); }, EVERY).unref?.();
});
