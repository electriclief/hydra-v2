// fleet-page.mjs - the one page a node can open in a browser to see what the fleet is hashing.
//
//   http://192.168.1.123:8140/ea        fleet table, refreshes itself
//   http://192.168.1.123:8140/ea.json   raw rows
//
// Reads MinerState (module/MinerState, :8147) which in turn reads each miner's own API. A node that does not answer is
// shown as DOWN with the reason and how long it has been dark - the page never reports an absent miner as "0 H/s",
// because zero and gone are different facts.
//
// Launched through ProcessWrapper so it stays visible and closable in the Hydra app.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8140);
const MINERSTATE = process.env.MINERSTATE || 'http://127.0.0.1:8147/state';
const CACHE_MS = 8000;

// nodes that are declared part of the rig but do not mine at all - they must still appear, with a reason
const DECLARED = [
  { ref: 'gvtx980', role: 'LLM / inference (llama.cpp)', note: 'GTX 980 Ti 6 GB - not minable with current miners (Maxwell kernels gone, etchash DAG outgrew 6 GB)' },
  { ref: 'xpsw', role: 'mining - pending', note: 'GTX 1060 6 GB - host is up, sshd not running; needs Start-Service sshd at the console' },
];

let cache = { at: 0, data: null };
const seen = new Map(); // ref -> first time seen unreadable

async function readState() {
  if (Date.now() - cache.at < CACHE_MS && cache.data) return cache.data;
  const out = await fetch(MINERSTATE, { signal: AbortSignal.timeout(6000) }).then(r => r.json());
  cache = { at: Date.now(), data: out };
  return out;
}

function rowsFrom(state) {
  const rows = [];
  for (const n of state.nodes || []) {
    const ref = n.node || n.ref || '?';
    const readable = !!n.readable;
    if (!readable) {
      if (!seen.has(ref)) seen.set(ref, Date.now());
    } else seen.delete(ref);
    const dark = readable ? 0 : Math.round((Date.now() - (seen.get(ref) || Date.now())) / 1000);
    rows.push({
      ref,
      host: n.host || '',
      up: readable,
      algo: n.algo || '',
      rate: n.hashrate || '',
      accepted: n.accepted ?? null,
      rejected: n.rejected ?? null,
      cards: Array.isArray(n.cards) ? n.cards.map(c => c.name).filter(Boolean) : [],
      detail: readable ? [n.pool || '', n.miner || ''].filter(Boolean).join(' · ') : (n.error || n.reason || 'miner API not answering'),
      dark_seconds: dark,
      role: 'mining',
    });
  }
  for (const d of DECLARED) {
    if (rows.some(r => r.ref === d.ref)) continue;
    rows.push({ ref: d.ref, host: '', up: false, algo: '', rate: '', accepted: null, rejected: null, detail: d.note, dark_seconds: 0, role: d.role });
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
}

const html = (rows, meta) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<title>rig - mining</title>
<style>
 :root{--bg:#0e1116;--fg:#e6e9ef;--dim:#8b95a5;--ok:#3ddc97;--bad:#ff5d5d;--warn:#ffb547;--line:#1e2530}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px}
 h1{font:600 18px/1.2 ui-sans-serif,system-ui;letter-spacing:.02em;margin:0 0 4px}
 .sub{color:var(--dim);font-size:12px;margin-bottom:24px}
 table{border-collapse:collapse;width:100%;max-width:1100px}
 th{text-align:left;font-weight:500;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em;
    padding:0 14px 8px 0;border-bottom:1px solid var(--line)}
 td{padding:11px 14px 11px 0;border-bottom:1px solid var(--line);vertical-align:top}
 tr.down td{color:var(--dim)}
 .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px}
 .ok{background:var(--ok)}.bad{background:var(--bad)}.warn{background:var(--warn)}
 .num{font-variant-numeric:tabular-nums}
 .ref{font-weight:600}
 .reason{color:var(--dim);font-size:12px;max-width:430px}
 .foot{margin-top:26px;color:var(--dim);font-size:11px}
</style></head><body>
<h1>rig</h1>
<div class="sub">${rows.filter(r => r.up).length} of ${rows.filter(r => r.role === 'mining').length} mining nodes answering &middot; ${meta.t}</div>
<table>
<tr><th></th><th>node</th><th>algo</th><th>rate</th><th>accepted</th><th>rejected</th><th>note</th></tr>
${rows.map(r => {
  const cls = r.up ? 'ok' : (r.role === 'mining' ? 'bad' : 'warn');
  const dark = (!r.up && r.dark_seconds > 0) ? ` &middot; dark ${r.dark_seconds}s` : '';
  return `<tr class="${r.up ? '' : 'down'}">
  <td><span class="dot ${cls}"></span></td>
  <td class="ref">${r.ref}${r.host ? `<div class="reason">${r.host}${r.cards && r.cards.length ? ' · ' + r.cards.join(', ') : ''}</div>` : ''}</td>
  <td>${r.algo || '&mdash;'}</td>
  <td class="num">${r.rate || '&mdash;'}</td>
  <td class="num">${r.accepted ?? '&mdash;'}</td>
  <td class="num">${r.rejected ?? '&mdash;'}</td>
  <td class="reason">${r.detail || ''}${dark}</td></tr>`;
}).join('\n')}
</table>
<div class="foot">source: MinerState :8147 &rarr; each miner's own API &middot; page refreshes every 15 s &middot; ${meta.user}</div>
</body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // /install/<name>.ps1 - hand a node a script it can paste-run. Same directory as the rest of the fleet scripts, and
    // only .ps1/.cmd/.bat, because "serve the whole scripts dir" is how a box ends up downloading a miner binary that a
    // virus scanner then deletes mid-transfer (that happened; the transfer looked like a bug, it was a quarantine).
    const inst = /^\/install\/([a-z0-9._-]+\.(?:ps1|cmd|bat))$/.exec(url.pathname);
    if (inst) {
      const file = fileURLToPath(new URL('../../scripts/' + inst[1], import.meta.url));
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(body);
    }
    // /probe/<ref> - a check a person can point a watchdog at. Two attempts, because one silent answer from a busy
    // miner is not a down node; a nag nobody believes is worse than no nag.
    const probe = /^\/probe\/([a-z0-9._-]+)$/.exec(url.pathname);
    if (probe) {
      const ref = probe[1];
      const state = await readState();
      const row = (state.nodes || []).find(n => (n.node || n.ref) === ref);
      if (!row) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, ref, error: 'not a declared node' })); }
      const target = `http://${row.host}:${row.minerApiPort || row.port || ''}/`;
      let last = '';
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetch(row.source || target, { signal: AbortSignal.timeout(5000) });
          if (r.ok) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, ref, attempt: i + 1 })); }
          last = `HTTP ${r.status}`;
        } catch (e) { last = e.message; }
        await new Promise(r => setTimeout(r, 1200));
      }
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, ref, attempts: 2, error: last }));
    }
    if (url.pathname === '/health/fleet') {
      const rows = rowsFrom(await readState());
      const down = rows.filter(r => r.role === 'mining' && !r.up).map(r => r.ref);
      res.writeHead(down.length ? 503 : 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: down.length === 0, down, rows: rows.map(r => ({ ref: r.ref, up: r.up, rate: r.rate })) }));
    }
    if (url.pathname === '/ea.json') {
      const rows = rowsFrom(await readState());
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
    }
    if (url.pathname === '/' || url.pathname === '/ea' || url.pathname === '/ea/') {
      const state = await readState();
      const rows = rowsFrom(state);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html(rows, { t: new Date().toLocaleTimeString(), user: `last miner cycle ${state.lastCycleAt || '?'}` }));
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, port: PORT }));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('fleet-page error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`fleet page on http://0.0.0.0:${PORT}/ea -> MinerState ${MINERSTATE}`));
