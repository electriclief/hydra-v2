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
import { spawn } from 'node:child_process';
import os from 'node:os';

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
    // Some builds (SRBMiner 3.8.0 on richard) publish NO hashrate field at all - the payload is inventory plus
    // shares, and only the HTML page carries rates. That is a readable miner with an unknown rate, NOT a miner at
    // zero and not a dead box: `rate_known:false` is what a screen must show as "no rate published".
    const raw = sb?.hashrate?.['1min'] ?? sb?.hashrate?.['15min'] ?? null;
    const hs = raw == null ? null : Number(raw);
    return {
      readable: true,
      kind: 'miner',
      miner: 'SRBMiner',
      node: node.ref,
      host: node.host,
      algo: sb?.name ?? null,
      hashrate_hs: hs,
      hashrate: hs == null ? null : fmtRate(hs),
      rate_known: hs != null,
      accepted: Number(sb?.shares?.accepted ?? 0),
      rejected: Number(sb?.shares?.rejected ?? 0),
      avg_find_time_s: sb?.shares?.avg_find_time ?? null,
      pool: sb?.pool?.pool ?? null,
      wallet: sb?.pool?.wallet ?? null,
      pool_uptime_s: sb?.pool?.uptime ?? null,
      // time_connected is a wall-clock STRING ('2026-11-15 09:42:02') on a healthy miner and '0' when it has never
      // connected - not a number. Number() on the timestamp is NaN, which made every working miner look unconnected.
      pool_connected: (() => {
        const tc = sb?.pool?.time_connected;
        const hasStamp = typeof tc === 'string' && tc.trim() !== '' && tc.trim() !== '0';
        const hasUptime = Number(sb?.pool?.uptime ?? 0) > 0;
        return hasStamp || hasUptime;
      })(),
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

// --- algorithm switching ---------------------------------------------------------------------------------------
// The node owns its miner, so the switch is a file write on the node, not a command to the pool. The supervisor reads
// C:\AI\miners\desired-algo.txt on every cycle and cycles the miner when it changes, which means one click here lands
// as a new miner within ~20 s and survives a reboot. Only algorithms that BOTH SRBMiner supports on AMD AND a
// unMineable host resolves for are offered - the others cannot pay anything, so offering them would be a lie.
const ALGOS = ['quantus', 'etchash', 'xelishashv3', 'autolykos2', 'ethash', 'pearlhash', 'blake3_decred'];
const SSH_KEY = process.env.REX_SSH_KEY || join(os.homedir(), '.ssh', 'id_ed25519_echidna');

function run(cmd, args, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } resolve({ code: -1, out, err: err + ' (timed out)' }); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b.toString(); });
    child.stderr.on('data', (b) => { err += b.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function switchAlgo(node, algo) {
  if (!ALGOS.includes(algo)) throw new Error(`unknown algorithm '${algo}' - offered: ${ALGOS.join(', ')}`);
  const remote = `powershell -NoProfile -Command "Set-Content -Path 'C:\\AI\\miners\\desired-algo.txt' -Value ${algo} -Encoding ascii"`;
  const args = ['-i', SSH_KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                `${process.env.REX_SSH_USER || 'user'}@${node.host}`, remote];
  const r = await run('ssh', args);
  if (r.code !== 0) throw new Error(`ssh exited ${r.code}: ${(r.err || r.out || '').trim().slice(0, 180)}`);
  await log(`ALGO SWITCH ${node.ref} -> ${algo} (supervisor cycles the miner within one poll)`);
  return { ok: true, ref: node.ref, algo, note: 'desired-algo.txt written on the node; the supervisor re-reads it every cycle' };
}

async function page() {
  const rows = [...state.values()].map(r => r.readable
    ? `<tr><td>${r.node}</td><td>${r.miner}</td><td>${r.algo || ''}</td><td class="n">${r.hashrate}</td><td class="n">${r.accepted}</td><td class="n">${r.rejected}</td><td>${(r.pool || '').split('//').pop()}</td><td>${r.miner_uptime_s ? Math.round(r.miner_uptime_s / 60) + ' min' : ''}</td><td class="via">${r.via || ''}</td></tr>`
    : `<tr class="down"><td>${r.node}</td><td colspan="8">${r.why || 'not readable'}</td></tr>`).join('');
  const nodes = await loadNodes();
  const sw = nodes.map(n => {
    const current = state.get(n.ref)?.algo || '';
    const btns = ALGOS.map(a => `<button class="b${a === current ? ' on' : ''}" onclick="sw('${n.ref}','${a}')">${a}</button>`).join(' ');
    return `<div class="swn"><b>${n.ref}</b> ${btns}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="10">
<title>MinerState</title><style>
 body{margin:0;padding:28px;background:#0f1115;color:#e7e9ee;font:14px/1.6 system-ui,sans-serif}
 h1{font-size:20px;margin:0 0 4px}.k{color:#8b93a7;font-size:13px;margin:0 0 20px}
 table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #2a2f3a}
 th{color:#8b93a7;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
 .n{text-align:right;font-family:ui-monospace,Consolas,monospace}.via{color:#8b93a7;font-size:11px}
 tr.down td{color:#e2705f}
 .sw{margin-top:22px;padding-top:16px;border-top:1px solid #2a2f3a}.sw h2{font-size:13px;margin:0 0 4px;color:#8b93a7;text-transform:uppercase;letter-spacing:.06em}
 .swn{margin:8px 0}.swn b{display:inline-block;width:64px;color:#8b93a7}
 button.b{background:#1b2029;color:#c9d1e0;border:1px solid #333c4d;border-radius:6px;padding:5px 10px;font:12px system-ui;cursor:pointer}
 button.b:hover{border-color:#5b8cff;color:#fff}button.b.on{background:#26364f;border-color:#5b8cff;color:#fff}
 #msg{margin-top:10px;font-size:12px;color:#8b93a7}
</style></head><body><h1>MinerState</h1>
<p class="k">reads each miner's own API and publishes <code>node.&lt;ref&gt;.miner</code> into State · refreshes every 10 s</p>
<table><thead><tr><th>node</th><th>miner</th><th>algo</th><th>rate</th><th>accepted</th><th>rejected</th><th>pool</th><th>uptime</th><th>via</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9">nothing read yet</td></tr>'}</tbody></table>
<div class="sw"><h2>switch algorithm</h2>
<p class="k">writes <code>desired-algo.txt</code> on the node · the supervisor cycles the miner within 20 s · safe to press, nothing is formatted or lost</p>
${sw}<div id="msg"></div></div>
<script>
async function sw(ref, algo) {
  const m = document.getElementById('msg');
  m.textContent = 'switching ' + ref + ' to ' + algo + '…';
  try {
    const r = await fetch('/switch?ref=' + encodeURIComponent(ref) + '&algo=' + encodeURIComponent(algo), { method: 'POST' });
    const j = await r.json();
    m.textContent = j.ok ? ('ok — ' + ref + ' → ' + algo + '. The miner restarts with the new algorithm within about 20 s; the table will follow.') : ('refused: ' + j.error);
    if (j.ok) setTimeout(() => location.reload(), 2500);
  } catch (e) { m.textContent = 'request failed: ' + e.message; }
}
</script></body></html>`;
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
  if (url.pathname === '/switch') {
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only — GET would switch a miner on a page prefetch' });
    const ref = url.searchParams.get('ref');
    const algo = url.searchParams.get('algo');
    const node = (await loadNodes()).find((n) => n.ref === ref);
    if (!node) return send(404, { ok: false, error: `no declared node '${ref}'` });
    try { return send(200, await switchAlgo(node, algo)); }
    catch (e) { return send(400, { ok: false, error: String(e.message || e) }); }
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
