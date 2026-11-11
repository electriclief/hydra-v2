#!/usr/bin/env node
/**
 * The gate for AppPlug.
 *
 *   node selftest.mjs
 *
 * A console program that knows nothing about Hydra is started by the adapter, its lines become paths, the adapter
 * publishes ONE link into a registry, and the answers are asked the way the LAN asks them. Then the two behaviours
 * that matter are proved: silence becomes `stale` (never the last number), death becomes `gone` (never 0 %), and a
 * second adapter cannot answer for a namespace a live one already holds.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

const NODE = process.execPath;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appplug-'));

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const get = (url, timeout = 4000) => new Promise((resolve) => {
  const req = http.get(url, (res) => {
    let t = '';
    res.on('data', (c) => { t += c; });
    res.on('end', () => { try { resolve(JSON.parse(t)); } catch { resolve({ raw: t }); } });
  });
  req.on('error', (e) => resolve({ ok: false, error: e.message }));
  req.setTimeout(timeout, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
});

const waitFor = async (fn, ms = 6000, step = 150) => {
  const until = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, step));
  }
};

function fakeState() {
  const store = new Map();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (status, b) => {
        const text = JSON.stringify(b);
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
        res.end(text);
      };
      if (url.pathname === '/api/state/register') {
        const doc = JSON.parse(body || '{}');
        store.set(doc.name, doc.content);
        return json(200, { ok: true, name: doc.name });
      }
      if (url.pathname === '/api/state/pull') {
        const name = url.searchParams.get('name');
        if (store.has(name)) return json(200, { ok: true, name, content: store.get(name) });
        return json(404, { ok: false, error: { code: 'no_such_entry' } });
      }
      if (url.pathname === '/api/state') {
        return json(200, { ok: true, entries: [...store.keys()].map((n) => ({ path: n, shape: [] })) });
      }
      return json(404, { ok: false, error: { code: 'no_route' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}`, store, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

/** A fixture app and manifest, written fresh per case so each behaviour is isolated. */
function fixture(name, { args = [], staleMs = 1500 } = {}) {
  const appFile = path.join(dir, `${name}.js`);
  fs.writeFileSync(appFile, `
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? Number(process.argv[i + 1]) : d; };
const stallAt = arg('stall-at', 0), exitAfter = arg('exit-after', 0), steps = arg('steps', 100), delay = arg('delay-ms', 100);
console.log('boot');
let i = 0;
const tick = setInterval(() => {
  i += 1;
  if (stallAt && i > stallAt) return;
  console.log('phase: working');
  console.log('work: ' + Math.round((i / steps) * 100) + '%');
}, delay);
if (exitAfter) setTimeout(() => { clearInterval(tick); process.exit(0); }, exitAfter);
`, 'utf8');

  const manifestFile = path.join(dir, `${name}.json`);
  fs.writeFileSync(manifestFile, JSON.stringify({
    app: name,
    namespace: name,
    command: NODE,
    args: [appFile, ...args],
    cwd: dir,
    adapter: {
      kind: 'console',
      staleMs,
      patterns: [
        { match: '^phase:\\s*(?<phase>.+)$', paths: { phase: 'phase' } },
        { match: '^work:\\s*(?<pct>\\d+)%', paths: { progress: 'pct' } },
      ],
    },
  }), 'utf8');
  return manifestFile;
}

function startAdapter({ manifest, port, state, label }) {
  const child = spawn(NODE, [path.resolve('src/main.js'), '--port', String(port), '--state', state, '--app', manifest], {
    cwd: process.cwd(), shell: false, windowsHide: true,
  });
  const out = [];
  child.stdout.on('data', (c) => out.push(String(c)));
  child.stderr.on('data', (c) => out.push(String(c)));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, out, exited, label, base: `http://127.0.0.1:${port}` };
}

async function main() {
  console.log('appplug — selftest');
  const reg = await fakeState();

  // ── 1. a console app becomes a namespace
  const portA = await freePort();
  const A = startAdapter({ manifest: fixture('foo_bar'), port: portA, state: reg.base, label: 'A' });
  const alive = await waitFor(async () => (await get(`${A.base}/health`)).ok === true);
  ok('the adapter answers /health', Boolean(alive));

  const linked = await waitFor(() => reg.store.get('foo_bar'));
  ok('the adapter published ONE link into the registry', linked?.kind === 'link' && linked?.to === `http://127.0.0.1:${portA}`, JSON.stringify(linked));

  const progress = await waitFor(async () => { const r = await get(`${A.base}/api/resolve?name=foo_bar.progress`); return r.ok ? r : null; });
  ok('a printed line becomes a resolvable path', typeof progress?.content?.value === 'number', JSON.stringify(progress));
  ok('  …and the value carries the moment it was seen', Boolean(progress?.content?.at));
  ok('the status path summarises the app', (await get(`${A.base}/api/resolve?name=foo_bar`)).content?.app === 'foo_bar');
  const missing = await get(`${A.base}/api/resolve?name=foo_bar.nope`);
  ok('an unmapped path is a typed absence that names what exists', missing.ok === false && missing.why === 'absent' && Array.isArray(missing.known), JSON.stringify(missing.why));

  // ── 2. a second adapter cannot answer for a namespace a live one holds
  const portB = await freePort();
  const B = startAdapter({ manifest: fixture('foo_bar'), port: portB, state: reg.base, label: 'B' });
  const codeB = await B.exited;
  ok('a second adapter for a held namespace refuses to start', codeB !== 0, `exit ${codeB}`);
  ok('  …and says who holds it', /is held by a live adapter/.test(B.out.join('')), B.out.join('').slice(0, 160));

  // ── 3. silence is stale, not last week's number
  const portC = await freePort();
  const C = startAdapter({ manifest: fixture('staller', { args: ['--stall-at', '2'], staleMs: 900 }), port: portC, state: reg.base, label: 'C' });
  await waitFor(async () => (await get(`${C.base}/api/resolve?name=staller.progress`)).ok === true);
  const stale = await waitFor(async () => { const r = await get(`${C.base}/api/resolve?name=staller.progress`); return r.why === 'stale' ? r : null; }, 5000);
  ok('a quiet app answers "stale" and still says when the value was seen', stale?.why === 'stale' && Boolean(stale?.content?.at), JSON.stringify(stale?.why));
  ok('  …and the age is in the answer', typeof stale?.ageMs === 'number');

  // ── 4. death is gone, not zero
  const portD = await freePort();
  const D = startAdapter({ manifest: fixture('quitter', { args: ['--exit-after', '400'] }), port: portD, state: reg.base, label: 'D' });
  await waitFor(async () => (await get(`${D.base}/health`)).phase === 'exited', 6000);
  const gone = await get(`${D.base}/api/resolve?name=quitter.progress`);
  ok('an exited app answers "gone", never 0 %', gone.ok === false && gone.why === 'gone', JSON.stringify(gone.why));
  ok('  …and names the exit code', /code 0/.test(gone.detail || ''), gone.detail);

  // ── 5. the adapter owns its child
  const appPid = (await get(`${A.base}/health`)).pid;
  A.child.kill();
  await A.exited;
  const childGone = await waitFor(() => { try { process.kill(appPid, 0); return false; } catch { return true; } }, 5000);
  ok('killing the adapter takes the app with it', Boolean(childGone), `pid ${appPid}`);

  for (const victim of [B, C, D]) { try { victim.child.kill(); } catch { /* gone */ } }
  await reg.close();
  // Windows keeps a killed child's cwd locked for a moment; cleanup is best-effort, never a reason to fail the gate
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); break; }
    catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  console.log(`\nAppPlug - the gate: ${pass} passed / ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
