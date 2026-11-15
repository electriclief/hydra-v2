// access-hub.mjs - the one page that links the rig: the camera's last photo, what the fleet is hashing, the node pages,
// and every file a node needs to pull. This is port 8140's job and always was - it is the file server the bench scripts
// already point at (bench1060.ps1, mine1060.ps1, fixvcredist.ps1 all fetch from http://192.168.1.123:8140/).
//
//   /                      same as /ea
//   /ea                    the hub
//   /camera/last.jpg       newest photo pulled from the camera's own FTP, so a browser can show it (browsers dropped ftp://)
//   /<file>                any file in C:\AI\fleet\serve - zips, exes, gguf, node pages
//   /install/<name>.ps1    a script a node can paste-run
//   /probe/<ref>           watchdog check for one miner: two attempts before it is called down
//   /ea.json               the mining rows as JSON
import http from 'node:http';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const PORT = Number(process.env.PORT || 8140);
const MINERSTATE = process.env.MINERSTATE || 'http://127.0.0.1:8147/state';
const SERVE = 'C:\\AI\\fleet\\serve';
// C:\AI\serve is the original root and must stay first-class: ea.cmd, echidna-access.ps1 (the agent), the installer,
// miner1-bootstrap.ps1 and openssh-win64.zip all live there, and they are what /x and /ea have always pointed at.
const SERVES = ['C:\\AI\\serve', 'C:\\AI\\fleet\\serve'];
// Short routes the nodes already know. /x is the agent installer - ea.cmd does `iex (irm .../x)`.
const ALIASES = {
  '/x': 'echidna-access-install.ps1',
  '/ea.cmd': 'ea.cmd',
  '/bootstrap': 'miner1-bootstrap.ps1',
  '/agent': 'echidna-access.ps1',
};
const ONE_LINER = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm http://192.168.1.123:8140/x)"';
const SCRIPTS = 'C:\\AI\\scripts';
const FTP = 'ftp://192.168.1.138:2121';

const DECLARED = [
  { ref: 'gvtx980', role: 'LLM / inference', note: 'GTX 980 Ti 6 GB - not minable with current miners; llama.cpp node' },
  { ref: 'xpsw', role: 'mining - pending', note: 'GTX 1060 6 GB - sshd not listening; needs the onboard script at /install/xpsw-onboard.ps1' },
];

let cache = { at: 0, data: null };
let camera = { at: 0, name: null, bytes: null };
// The camera is an FTP push target on another box and a LIST there took 20 s once, which made /ea - the page the
// operator opens to paste the installer - take 20 s to answer. So the photo is pulled in the background every minute
// and every request is served from this cache; a request never waits on the camera.
let photo = { buf: null, at: 0, name: null, type: 'image/jpeg' };
const seen = new Map();

async function readState() {
  if (Date.now() - cache.at < 8000 && cache.data) return cache.data;
  cache = { at: Date.now(), data: await fetch(MINERSTATE, { signal: AbortSignal.timeout(6000) }).then(r => r.json()) };
  return cache.data;
}

function rowsFrom(state) {
  const rows = [];
  for (const n of state.nodes || []) {
    const ref = n.node || n.ref || '?';
    const up = !!n.readable;
    if (!up) { if (!seen.has(ref)) seen.set(ref, Date.now()); } else seen.delete(ref);
    rows.push({
      ref, host: n.host || '', up, algo: n.algo || '', rate: n.hashrate || '',
      accepted: n.accepted ?? null, rejected: n.rejected ?? null,
      cards: Array.isArray(n.cards) ? n.cards.map(c => c.name).filter(Boolean) : [],
      detail: up ? [n.pool || '', n.miner || ''].filter(Boolean).join(' · ') : (n.error || n.reason || 'miner API not answering'),
      dark: up ? 0 : Math.round((Date.now() - (seen.get(ref) || Date.now())) / 1000),
      role: 'mining',
    });
  }
  for (const d of DECLARED) {
    if (rows.some(r => r.ref === d.ref)) continue;
    rows.push({ ref: d.ref, host: '', up: false, algo: '', rate: '', accepted: null, rejected: null, cards: [], detail: d.note, dark: 0, role: d.role });
  }
  return rows.sort((a, b) => a.ref.localeCompare(b.ref));
}

// The camera writes IMG_YYYYMMDD_HHMMSS.jpg, but the folder also holds a PNG and some MP4s, and "last line of an
// alphabetical listing" picked girlinpoo.png as the newest photo. Read the real modification time out of the FTP listing
// instead, and fall back to the timestamp in the filename.
function parseList(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^[-d][rwxstStT-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3})\s+(\d{1,2})\s+(\d{4}|\d{1,2}:\d{2})\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, size, mon, day, yrOrTime, name] = m;
    let date = null;
    if (yrOrTime.includes(':')) {
      const [hh, mm] = yrOrTime.split(':');
      date = new Date(`${mon} ${day} ${new Date().getFullYear()} ${hh}:${mm}`);
      if (date > new Date()) date.setFullYear(date.getFullYear() - 1); // a future date means it is last year's file
    } else {
      date = new Date(`${mon} ${day} ${yrOrTime}`);
    }
    if (isNaN(date)) {
      const t = /(\d{8})[_-](\d{6})/.exec(name);
      if (t) date = new Date(`${t[1].slice(0, 4)}-${t[1].slice(4, 6)}-${t[1].slice(6, 8)}T${t[2].slice(0, 2)}:${t[2].slice(2, 4)}:${t[2].slice(4, 6)}`);
    }
    out.push({ name: name.trim(), size: Number(size), date });
  }
  return out;
}

async function lastPhoto(force = false) {
  if (!force && Date.now() - camera.at < 60000 && camera.name) return camera;
  try {
    const { stdout } = await run('curl.exe', ['-s', '-m', '20', `${FTP}/DCIM/Camera/`], { timeout: 25000 });
    const all = parseList(stdout).filter(f => f.date && /\.(jpe?g|png|heic)$/i.test(f.name));
    all.sort((a, b) => b.date - a.date);
    const top = all[0];
    camera = { at: Date.now(), name: top?.name || null, atTime: top?.date || null, count: parseList(stdout).length };
  } catch (e) { camera = { at: Date.now(), name: null, error: e.message }; }
  return camera;
}

async function refreshPhoto() {
  try {
    const c = await lastPhoto();
    if (!c.name) return;
    if (photo.name === c.name && photo.buf) return;
    const { stdout } = await run('curl.exe', ['-s', '-m', '40', `${FTP}/DCIM/Camera/${c.name}`],
      { timeout: 45000, maxBuffer: 1 << 26, encoding: 'buffer' });
    if (stdout && stdout.length) photo = { buf: stdout, at: Date.now(), name: c.name, type: 'image/jpeg' };
  } catch (e) { console.error('photo refresh failed:', e.message); }
}

async function serveList() {
  const out = [];
  for (const root of SERVES) {
    for (const name of await readdir(root).catch(() => [])) {
      if (/\.(html|bak|tgz|zip)$/i.test(name) && !/openssh/i.test(name)) continue;
      const s = await stat(path.join(root, name)).catch(() => null);
      if (s?.isFile()) out.push({ name, mb: s.size / 1048576, at: s.mtime });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 24);
}

async function inboxList() {
  const dir = path.join(SERVES[0], 'inbox');
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    const s = await stat(path.join(dir, name)).catch(() => null);
    if (s?.isFile()) out.push({ name, at: s.mtime, kb: s.size / 1024 });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 5);
}

async function findFile(name) {
  for (const root of SERVES) {
    try { return await readFile(path.join(root, name)); } catch { /* next root */ }
  }
  return null;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(rows, cameraInfo, files, inbox) {
  const up = rows.filter(r => r.role === 'mining' && r.up).length;
  const total = rows.filter(r => r.role === 'mining').length;
  const nodes = ['rex', 'jims', 'xps', 'xpsw', 'richard', 'deadalus', 'mint'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30">
<title>rig</title>
<style>
 :root{--bg:#0e1116;--fg:#e6e9ef;--dim:#8b95a5;--ok:#3ddc97;--bad:#ff5d5d;--warn:#ffb547;--line:#1e2530;--panel:#141922}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
 main{max-width:1080px;margin:0 auto;padding:40px 24px 80px}
 h1{font-size:22px;font-weight:600;margin:0 0 2px;letter-spacing:-.01em}
 .kick{color:var(--dim);font-size:12.5px;margin:0 0 34px}
 h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600;margin:34px 0 12px}
 a{color:var(--fg);text-decoration:none;border-bottom:1px solid var(--line)}
 a:hover{border-color:var(--dim)}
 table{border-collapse:collapse;width:100%}
 th{text-align:left;font-weight:500;color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;padding:0 12px 8px 0;border-bottom:1px solid var(--line)}
 td{padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:13.5px}
 .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px}
 .ok{background:var(--ok)}.bad{background:var(--bad)}.warn{background:var(--warn)}
 .num{font-variant-numeric:tabular-nums;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
 .sub{color:var(--dim);font-size:11.5px}
 .photo{display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap}
 .photo img{max-width:520px;width:100%;border:1px solid var(--line);border-radius:4px;display:block}
 .two{display:grid;grid-template-columns:1fr 1fr;gap:26px}
 @media(max-width:760px){.two{grid-template-columns:1fr}}
 ul{list-style:none;margin:0;padding:0}
 li{padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;display:flex;justify-content:space-between;gap:14px}
 .foot{margin-top:40px;color:var(--dim);font-size:11.5px}
 .hero{border:1px solid var(--line);border-radius:6px;padding:18px 20px;background:var(--panel);margin:0 0 8px}
 .herot{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--warn);font-weight:600;margin:0 0 10px}
 pre#oneliner{margin:0 0 10px;padding:12px 14px;background:#0b0d11;border:1px solid var(--line);border-radius:5px;
   font:12.5px/1.6 ui-monospace,Consolas,monospace;color:#dfe4ee;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
</style></head><body><main>
<h1>rig</h1>
<p class="kick">${up} of ${total} mining nodes answering · ${new Date().toLocaleTimeString()}<\/p>
<p class="sub" style="margin-top:6px">The whole build, measured: <a href="/hydra-overview.html">hydra-overview.html</a> — what is done, what is thin, what needs a decision.<\/p>

<div class="hero">
  <div class="herot">Add a node — one paste, elevated PowerShell, no ssh setup, no typing again</div>
  <pre id="oneliner">${esc(ONE_LINER)}</pre>
  <div class="sub">installs EchidnaAccess (agent on :8142) and OpenSSH, opens the door, posts its transcript back here.
    Same line on every machine — <a href="/x">/x</a> is the installer, <a href="/ea.cmd">ea.cmd</a> is a click-to-run wrapper.
    <a href="#" onclick="navigator.clipboard.writeText(document.getElementById('oneliner').textContent);this.textContent='copied';return false">copy</a></div>
</div>

<h2>camera</h2>
<div class="photo">
  <a href="${FTP}/DCIM/Camera/"><img src="/camera/last.jpg?t=${Date.now()}" alt="last photo"></a>
  <div>
    <div style="font-size:13.5px">${cameraInfo.name ? esc(cameraInfo.name) : 'no photo could be read'}</div>
    <div class="sub" style="margin-top:6px">${cameraInfo.atTime ? esc(cameraInfo.atTime.toLocaleString()) : ''}${cameraInfo.count ? ' · ' + cameraInfo.count + ' items in DCIM/Camera' : ''}</div>
    <div class="sub" style="margin-top:14px">
      <a href="${FTP}/DCIM/Camera/">ftp://192.168.1.138:2121/DCIM/Camera/</a><br>
      <span class="sub">browsers no longer open ftp:// links - that is why the photo is on this page</span>
    </div>
  </div>
</div>

<h2>mining</h2>
<table>
<tr><th></th><th>node</th><th>algo</th><th>rate</th><th>accepted</th><th>rejected</th><th>note</th></tr>
${rows.map(r => `<tr>
 <td><span class="dot ${r.up ? 'ok' : (r.role === 'mining' ? 'bad' : 'warn')}"></span></td>
 <td><strong>${esc(r.ref)}</strong>${r.host ? `<div class="sub">${esc(r.host)}</div>` : ''}</td>
 <td>${esc(r.algo) || '—'}</td>
 <td class="num">${esc(r.rate) || '—'}</td>
 <td class="num">${r.accepted ?? '—'}</td>
 <td class="num">${r.rejected ?? '—'}</td>
 <td class="sub">${esc(r.detail)}${r.dark ? ` · dark ${r.dark}s` : ''}</td></tr>`).join('')}
</table>

<div class="two" style="margin-top:8px">
<div>
<h2>node pages</h2>
<ul>${nodes.map(n => `<li><a href="/${n}.html">${n}.html</a><span class="sub">self-serve</span></li>`).join('')}</ul>
</div>
<div>
<h2>files a node can pull</h2>
<ul>${files.map(f => `<li><a href="/${encodeURIComponent(f.name)}">${esc(f.name)}</a><span class="sub">${f.mb >= 1 ? f.mb.toFixed(0) + ' MB' : ''}</span></li>`).join('')}</ul>
</div>
</div>

<h2>transcripts posted back by nodes</h2>
<ul>${inbox.length ? inbox.map(f => `<li><a href="/inbox/${encodeURIComponent(f.name)}">${esc(f.name)}</a><span class="sub">${f.at.toLocaleString()}</span></li>`).join('') : '<li class="sub">nothing posted yet - an installer writes here when it finishes</li>'}</ul>

<div class="foot">
  scripts: <a href="/install/xpsw-onboard.ps1">xpsw-onboard.ps1</a> ·
  <a href="/install/node-algo-trial.ps1">node-algo-trial.ps1</a> ·
  <a href="/install/node-deploy.ps1">node-deploy.ps1</a> ·
  <a href="/install/node-status.ps1">node-status.ps1</a> ·
  <a href="/install/icd-register.ps1">icd-register.ps1</a><br>
  checks: <a href="/health/fleet">/health/fleet</a> · <a href="/ea.json">/ea.json</a> · source MinerState :8147<br>
  doors: <a href="http://192.168.1.123:8133/">menu 8133</a> ·
  <a href="http://192.168.1.123:8143/">access 8143</a> ·
  <a href="http://192.168.1.123:8147/">minerstate 8147</a> ·
  <a href="http://192.168.1.123:8146/api/entries">phoenix 8146</a> ·
  <a href="http://192.168.1.123:8127/api/state">state 8127</a>
</div>
</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // The installer every node runs ends with a POST of its whole transcript here, so nobody has to copy a console back.
    // Losing this route is what made the one-paste flow feel broken: the install worked and the report vanished.
    if (p === '/post' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const host = (url.searchParams.get('host') || 'node').replace(/[^a-z0-9._-]/gi, '');
      const inbox = path.join(SERVES[0], 'inbox');
      await mkdir(inbox, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${host}.txt`;
      await writeFile(path.join(inbox, name), body);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, file: 'inbox/' + name, bytes: body.length }));
    }

    const inboxFile = /^\/inbox\/([A-Za-z0-9._-]+)$/.exec(p);
    if (inboxFile) {
      try {
        const body = await readFile(path.join(SERVES[0], 'inbox', inboxFile[1]));
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(body);
      } catch { res.writeHead(404); return res.end('no such transcript'); }
    }

    if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, port: PORT })); }

    if (p === '/camera/last.jpg') {
      if (photo.buf) {
        res.writeHead(200, { 'content-type': photo.type, 'cache-control': 'max-age=60' });
        return res.end(photo.buf);
      }
      refreshPhoto();
      res.writeHead(404); return res.end('photo not loaded yet');
    }

    const inst = /^\/install\/([a-z0-9._-]+\.(?:ps1|cmd|bat))$/.exec(p);
    if (inst) {
      const body = await readFile(path.join(SCRIPTS, inst[1]));
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(body);
    }

    const probe = /^\/probe\/([a-z0-9._-]+)$/.exec(p);
    if (probe) {
      const ref = probe[1];
      const row = ((await readState()).nodes || []).find(n => (n.node || n.ref) === ref);
      if (!row) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, ref, error: 'not declared' })); }
      let last = '';
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetch(row.source || `http://${row.host}:${row.minerApiPort}/`, { signal: AbortSignal.timeout(5000) });
          if (r.ok) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, ref, attempt: i + 1 })); }
          last = `HTTP ${r.status}`;
        } catch (e) { last = e.message; }
        await new Promise(r => setTimeout(r, 1200));
      }
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, ref, attempts: 2, error: last }));
    }

    if (p === '/health/fleet') {
      const rows = rowsFrom(await readState());
      const down = rows.filter(r => r.role === 'mining' && !r.up).map(r => r.ref);
      res.writeHead(down.length ? 503 : 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: !down.length, down }));
    }

    if (p === '/ea.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ at: new Date().toISOString(), rows: rowsFrom(await readState()) }, null, 1));
    }

    if (p === '/' || p === '/ea' || p === '/ea/' || p === '/index.html') {
      const [state, files, inbox] = await Promise.all([readState(), serveList(), inboxList()]);
      // the camera's listing is whatever the background refresher last read; a slow FTP must not hold the page
      const cam = (Date.now() - camera.at < 300000 && camera.name) ? camera : { at: camera.at, name: camera.name, atTime: camera.atTime, count: camera.count };
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page(rowsFrom(state), cam, files, inbox));
    }

    // short routes the nodes already know (/x is the agent installer that ea.cmd calls)
    if (ALIASES[p]) {
      const body = await findFile(ALIASES[p]);
      if (body) {
        const isPs = /\.ps1$/i.test(ALIASES[p]);
        res.writeHead(200, { 'content-type': isPs ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'cache-control': 'no-store' });
        return res.end(body);
      }
      res.writeHead(501, { 'content-type': 'text/plain' });
      return res.end('alias ' + p + ' points at ' + ALIASES[p] + ' which is not in ' + SERVES.join(' or '));
    }

    // everything else is a file in the serve directories - this is what the bench scripts download from
    const name = path.basename(decodeURIComponent(p.slice(1)));
    if (name && !name.includes('..')) {
      const body = await findFile(name);
      if (body) {
        const type = /\.html?$/i.test(name) ? 'text/html; charset=utf-8'
          : /\.json$/i.test(name) ? 'application/json'
          : /\.(jpg|jpeg)$/i.test(name) ? 'image/jpeg'
          : /\.(ps1|cmd|txt)$/i.test(name) ? 'text/plain; charset=utf-8'
          : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'content-length': body.length });
        return res.end(body);
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + p);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('hub error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`access hub on http://0.0.0.0:${PORT}/ea  (files: ${SERVE}, camera: ${FTP})`);
  refreshPhoto();
  setInterval(refreshPhoto, 60000).unref();
});
