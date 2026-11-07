#!/usr/bin/env node
/**
 * Mirror - the reader.
 *
 * Pulls every registry it is allowed to see (its own, and each member's), assembles ONE lan object, and serves
 * it. It writes nothing, owns nothing, and holds no truth: kill it and every node keeps publishing and keeps
 * working. That is the test of whether a reader is really a reader.
 *
 * Endpoints:
 *   GET /health            { ok, nodes, peers, at }
 *   GET /api/lan.json      the machine view
 *   GET /api/lan.md        the brief
 *   GET /api/node/<ref>    one node, assembled
 *
 * Env:
 *   MIRROR_PORT=8137  MIRROR_TICK_MS=5000  MIRROR_STATE=http://127.0.0.1:8127
 *   MIRROR_JOIN=http://127.0.0.1:8131     MIRROR_PEERS="jims@http://192.168.1.127:8127"
 *   MIRROR_TIMEOUT_MS=900                  MIRROR_REF=123
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, displayName } from './assemble.js';
import { lanJson, lanMarkdown } from './lan.js';
import { classify } from './verdict.js';

const argPort = (() => {
  const i = process.argv.indexOf('--port');
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();
const PORT = Number(process.env.MIRROR_PORT || argPort || 8137);
const TICK_MS = Number(process.env.MIRROR_TICK_MS || 5000);
const STATE = process.env.MIRROR_STATE || 'http://127.0.0.1:8127';
const JOIN = process.env.MIRROR_JOIN || 'http://127.0.0.1:8131';
const TIMEOUT = Number(process.env.MIRROR_TIMEOUT_MS || 900);
const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MODULE, '..');

/** The instance layer names the box; the hostname is only a last resort. */
function refFromNodeJson() {
  for (const file of [path.join(MODULE, 'data', 'node.json'), path.join(ROOT, 'Menu', 'data', 'node.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.ref) return String(parsed.ref);
    } catch {
      /* next */
    }
  }
  return null;
}

const REF = String(process.env.MIRROR_REF || process.env.HYDRA_REF || refFromNodeJson() || os.hostname()).toLowerCase();

const state = { self: null, peers: [], lan: null, at: null, error: null };

async function getJson(url, timeoutMs = TIMEOUT) {
  const ctl = new AbortController();
  let timer = null;
  // Race a hard timeout against the fetch: aborting is a request, not a guarantee. A socket destroyed mid-flight
  // can leave fetch pending forever, and one dead peer must never freeze the reader's whole refresh loop.
  const hardStop = new Promise((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ ok: false, status: 0, error: 'timeout' });
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, status: res.status, body: text ? JSON.parse(text) : null };
    } catch (error) {
      return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : String(error.message) };
    }
  })();
  try {
    return await Promise.race([work, hardStop]);
  } finally {
    clearTimeout(timer);
  }
}

function parsePeersEnv() {
  return String(process.env.MIRROR_PEERS || '')
    .split(',')
    .map((bit) => bit.trim())
    .filter(Boolean)
    .map((bit) => {
      const [name, url] = bit.includes('@') ? bit.split('@') : [bit, `http://${bit}:8127`];
      return { ref: String(name).toLowerCase(), url: url.replace(/\/+$/, '') };
    });
}

async function members() {
  const res = await getJson(`${JOIN}/api/members`, 700);
  if (!res.ok || !res.body || !Array.isArray(res.body.members)) return [];
  return res.body.members
    .map((m) => {
      const ref = m.ref || m.name || m.id;
      const url = m.stateUrl || m.url || (m.ip ? `http://${m.ip}:8127` : null) || (m.host ? `http://${m.host}:8127` : null);
      return ref && url ? { ref: String(ref).toLowerCase(), url } : null;
    })
    .filter(Boolean);
}

/** The entries a reader needs by name. Discovery is skipped: a reader that knows the grammar is cheaper. */
// 'echidna' is the shared conversation: without it here, a node can host the talk and no other node can see it
const READER_NAMES = ['id', 'doors', 'cycle', 'services', 'scheduler', 'standby', 'echidna'];

async function pullNode(url, ref) {
  const names = READER_NAMES.map((suffix) => `node.${ref}.${suffix}`);
  const answers = await Promise.all(names.map((name) => getJson(`${url}/api/state/pull?name=${encodeURIComponent(name)}`)));
  const entries = [];
  let reachable = false;
  answers.forEach((answer, i) => {
    // 404 means the node answered and does not publish that name: reachable, just empty
    if (answer.status === 404) { reachable = true; return; }
    if (!answer.ok) return;
    reachable = true;
    const content = answer.body?.content;
    if (content !== undefined && content !== null) entries.push({ path: names[i], content });
  });
  return { reachable, entries };
}

let refreshN = 0;
async function refresh() {
  const n = ++refreshN;
  const t0 = Date.now();
  const log = (...a) => { if (process.env.MIRROR_DEBUG) console.log('[mirror] r' + n, Date.now() - t0 + 'ms', ...a); };
  log('start');
  const at = Date.now();
  const local = await pullNode(STATE, REF);
  state.self = local.reachable ? assemble(local.entries, REF) : null;

  log('local done');
  const list = [...(await members()), ...parsePeersEnv()].filter((p) => p.ref !== REF);
  log('members done', list.length);
  const prevByRef = new Map(state.peers.map((p) => [p.ref, p]));

  const peers = await Promise.all(
    list.map(async (peer) => {
      const got = await pullNode(peer.url, peer.ref);
      const node = got.reachable ? assemble(got.entries, peer.ref) : null;
      return { peer, got, node, prev: prevByRef.get(peer.ref) };
    }),
  );

  state.peers = peers.map(({ peer, got, node, prev }) => {
    const cycle = typeof node?.cycle?.cycle === 'number' ? node.cycle.cycle : null;
    const verdict = classify(
      { cycle: prev?.cycle ?? null, misses: prev?.misses ?? 0 },
      { cycle, reachable: got.reachable },
      { stalledAfter: 3, goneAfter: 12 },
    );
    return { ref: peer.ref, url: peer.url, node, cycle: verdict.cycle, misses: verdict.misses, verdict: verdict.verdict, reason: verdict.reason };
  });

  log('peers done');
  state.lan = lanJson({ self: state.self, peers: state.peers, at });
  state.at = at;
  state.error = null;
  log('end');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  };

  if (url.pathname === '/health') {
    return send(200, { ok: true, nodes: state.lan?.counts?.nodes ?? 0, peers: state.peers.length, at: state.lan?.at ?? null, refreshError: state.error, refreshes: refreshN });
  }
  if (url.pathname === '/api/lan.json') return send(200, state.lan || { ok: false, error: 'no snapshot yet' });
  if (url.pathname === '/api/lan.md') return send(200, state.lan ? lanMarkdown(state.lan) : '# LAN\n\nno snapshot yet\n', 'text/markdown; charset=utf-8');
  if (url.pathname.startsWith('/api/node/')) {
    const ref = url.pathname.slice('/api/node/'.length).toLowerCase();
    if (state.self && state.self.ref === ref) return send(200, { ok: true, role: 'self', node: state.self });
    const peer = state.peers.find((p) => p.ref === ref);
    if (peer) return send(200, { ok: true, role: 'peer', verdict: peer.verdict, node: peer.node });
    return send(404, { ok: false, error: 'no such node', ref });
  }
  return send(404, { ok: false, error: 'nothing here', paths: ['/health', '/api/lan.json', '/api/lan.md', '/api/node/<ref>'] });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[mirror] :${PORT} - state ${STATE}, join ${JOIN}, tick ${TICK_MS}ms, ref ${REF}`);
  await refresh().catch((error) => console.error('[mirror] first refresh failed:', error.message));
  setInterval(() => refresh().catch((error) => { state.error = error.message; }), TICK_MS);
});
