/**
 * Integration proof for Core's standby observation (no live peer publishes one on this LAN yet).
 *
 * A stub State plays a peer that answers node.fake.cycle (advancing) AND node.fake.standby (mining), plus it
 * records every register Core POSTs. Core is then started against it on a spare port and asked for /api/tree.
 * If the observation carries the standby, both the tree and the entry Core wrote under its own branch prove it.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';

const STUB = 0; // ephemeral: a test must not fight a door for a number
const CORE = 8192;
const NODE = process.execPath;
const registered = [];
let cycleN = 0;
const standby = {
  mode: 'mining',
  miner: true,
  ai: '',
  at: new Date().toISOString(),
  poll: 15,
  minerDetail: { label: 'PearlPow', algo: 'pearlhash', rate: 24.2, unit: 'TH/s', accepted: 25 },
};

const stub = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${stubPort}`);
  const send = (status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  if (url.pathname === '/api/state/pull') {
    const name = url.searchParams.get('name');
    if (name === 'node.fake.cycle') return send(200, { ok: true, name, content: { cycle: ++cycleN, tickMs: 500, uptimeSec: 5 } });
    if (name === 'node.fake.standby') return send(200, { ok: true, name, content: standby });
    return send(404, { ok: false, error: 'absent' });
  }
  if (url.pathname === '/api/state') {
    return send(200, { entries: [{ name: 'node.fake.cycle', content: { cycle: cycleN } }, { name: 'node.fake.standby', content: standby }] });
  }
  if (url.pathname === '/api/state/register' && req.method === 'POST') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        registered.push(body);
      } catch { /* ignore */ }
      send(200, { ok: true });
    });
    return;
  }
  return send(404, { ok: false });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return { status: r.status, body: await r.json() };
  } catch (error) {
    return { status: 0, error: error.message };
  } finally {
    clearTimeout(t);
  }
};

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ' - ' + detail}`);
};

await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));
const stubPort = stub.address().port;
const url = (p) => `http://127.0.0.1:${stubPort}${p}`;
const core = spawn(NODE, ['src/main.js', '--port', String(CORE), '--host', '127.0.0.1'], {
  cwd: 'C:/AI/hydra-local/module/Core',
  env: {
    ...process.env,
    HYDRA_REF: 'probe',
    CORE_PORT: String(CORE),
    CORE_STATE: `http://127.0.0.1:${stubPort}`,
    CORE_JOIN: 'http://127.0.0.1:1',
    CORE_PEERS: `fake@http://127.0.0.1:${stubPort}`,
    CORE_TICK_MS: '700',
    CORE_SERVICES: 'http://127.0.0.1:1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let coreOut = '';
core.stdout.on('data', (d) => { coreOut += d; });
core.stderr.on('data', (d) => { coreOut += d; });

try {
  for (let i = 0; i < 40; i += 1) {
    const h = await getJson(`http://127.0.0.1:${CORE}/health`);
    if (h.status === 200) break;
    await sleep(250);
  }
  await sleep(1800);

  const tree = await getJson(`http://127.0.0.1:${CORE}/api/tree`);
  const peer = (tree.body?.peers || []).find((p) => p.ref === 'fake');
  check('the peer is seen', !!peer, JSON.stringify(tree.body?.peers));
  check('the peer verdict comes from its advancing cycle', peer?.verdict === 'alive', JSON.stringify(peer));
  check('the tree carries what the peer is doing', peer?.standby?.mode === 'mining', JSON.stringify(peer?.standby));
  check('the standby keeps its detail-free facts', peer?.standby?.ageS !== undefined && peer?.standby?.stale === false);

  // the ref comes from the instance layer (node.json), so match the branch, not a hard-coded name
  const obs = registered.filter((r) => String(r.name || '').endsWith('.observed.fake'));
  check('Core writes the observation under its own branch', obs.length > 0, `${registered.length} registers`);
  check('the written observation carries the standby', obs.at(-1)?.content?.standby?.mode === 'mining', JSON.stringify(obs.at(-1)?.content));
  check('the observation never claims a cycle it did not see', typeof obs.at(-1)?.content?.cycle === 'number');
} finally {
  core.kill();
  stub.close();
  await sleep(300);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) console.log('\nCORE OUTPUT:\n' + coreOut.slice(-1200));
console.log(`\nCore standby integration: ${results.length - failed.length} passed / ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
