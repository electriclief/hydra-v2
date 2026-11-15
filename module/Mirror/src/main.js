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
import { candidatesFor, fleetSummary, ipOf, loadRoster, matchRow } from './roster.js';
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

const state = { self: null, peers: [], lan: null, at: null, error: null, roster: null };

/** This box's own LAN address, so its roster row can be joined on ip like every peer's. */
function selfIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

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
// 'unusual' and 'personality' are asked for like everything else: a name that is never requested is a fact that can
// never reach the Menu (the same omission that once hid every node's miner).
const READER_NAMES = ['id', 'doors', 'cycle', 'upkeep', 'services', 'scheduler', 'standby', 'echidna', 'miner', 'unusual', 'personality'];

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
    return { ref: peer.ref, url: peer.url, ip: ipOf(peer.url), node, cycle: verdict.cycle, misses: verdict.misses, verdict: verdict.verdict, reason: verdict.reason };
  });

  // ── miner-only peers: a box with no State door is not automatically an absent box ──────────────────────
  // ReX answers only through its miner (89 MH/s, 618 shares, 36 h uptime) yet it sat in declaredAbsent, drawn as a
  // machine that is switched off. A roster row with a `minerApi` that answers is a MEASUREMENT of a box that is here,
  // so it joins the peer list with `minerOnly` set and its rate labelled `miner-api` all the way to the screen.
  {
    const roster = loadRoster();
    const seenRefs = new Set(state.peers.map((x) => String(x.ref)));
    const seenRows = new Set();
    for (const x of state.peers) {
      const row = matchRow(roster, { ref: x.ref, ip: x.ip });
      if (row) seenRows.add(row.name || row.ip);
    }
    const candidates = (roster?.rows || []).filter((r) => r.enabled && r.minerApi && !seenRows.has(r.name || r.ip));
    await Promise.all(candidates.map(async (row) => {
      const ref = String(row.ref || row.name || row.ip || '').trim();
      if (!ref || seenRefs.has(ref)) return;
      const res = await getJson(row.minerApi, 4000);
      const j = res.ok ? res.body : null;
      const a = Array.isArray(j?.algorithms) ? j.algorithms[0] : null;
      if (!a) return;
      seenRefs.add(ref);
      state.peers.push({
        ref, url: null, ip: row.ip || null, node: null, cycle: null, misses: 0,
        verdict: 'alive', reason: 'no state door - measured on its miner api', minerOnly: true,
        minerProbe: {
          at: new Date().toISOString(),
          algo: a.name ?? null,
          rate: a.hashrate?.['1min'] ?? null,
          accepted: a.shares?.accepted ?? null,
          rejected: a.shares?.rejected ?? null,
          pool: a.pool?.pool ?? null,
          uptime: a.pool?.time_connected ?? null,
          declared: row.minerApi,
        },
      });
      log('miner-only peer', ref, a.name);
    }));
  }

  log('peers done');
  // declared intent is read fresh every refresh: the roster is the operator's file, and a role edited at 3pm
  // must not wait for a restart. Unreadable is a fact in the payload, never a silent empty list.
  state.roster = loadRoster();

  // A box with no State door can still be working, and its miner is the witness: if the miner's OWN API answers,
  // that is a measurement, not a guess. Only rows that declare `minerApi` are probed, so nothing is dialled that
  // the operator did not put in the roster, and the result is labelled `miner-api` all the way to the screen.
  await Promise.all(
    state.peers.map(async (p) => {
      p.minerProbe = null;
      if (p.node?.standby) return;                 // a real standby report always wins
      const row = matchRow(state.roster, { ref: p.ref, name: p.node?.id?.name, ip: p.ip });
      if (!row?.minerApi) return;
      const res = await getJson(row.minerApi, 1500);
      const j = res.ok ? res.body : null;          // getJson answers { ok, status, body }, not a bare object
      const a = Array.isArray(j?.algorithms) ? j.algorithms[0] : null;
      if (!a) return;
      p.minerProbe = {
        at: new Date().toISOString(),
        algo: a.name ?? null,
        rate: a.hashrate?.['1min'] ?? null,
        accepted: a.shares?.accepted ?? null,
        rejected: a.shares?.rejected ?? null,
        pool: a.pool?.pool ?? null,
        uptime: a.pool?.time_connected ?? null,
        declared: row.minerApi,
      };
    }),
  );

  // the SERVER cycle publishes lan.cycle into the LAN state; read it so the screen can count down to the next beat.
  // A missing LAN state or a cycle that never published is null, never a guessed timestamp.
  let serverCycle = null;
  try {
    const c = await getJson(`${LAN_STATE}/api/state/pull?name=lan.cycle`, 1500);
    serverCycle = c.ok ? (c.body?.content ?? null) : null;
  } catch { serverCycle = null; }
  // SSH-ONLY BOXES THAT SPEAK. Richard, miner1 and Daedalus run no Hydra modules, so they can never publish a state
  // branch of their own - but node-shim.ps1 on the box writes node.<ref>.shim into THIS controller's state. Reading it
  // here is the whole point of the shim: the screen must not care whether a fact travelled through a module or through
  // a wrapped process, only that something measured it.
  {
    const roster = loadRoster();
    const shimRows = (roster?.rows || []).filter((r) => r.enabled && r.hydra === false && (r.name || r.ref));
    await Promise.all(shimRows.map(async (row) => {
      const ref = String(row.name || row.ref || '').trim();
      if (!ref) return;
      const res = await getJson(`${STATE}/api/state/pull?name=node.${ref.toLowerCase()}.shim`, 2500);
      const shim = res.ok ? (res.body?.content || null) : null;
      if (!shim) return;
      const probe = shim.miner && shim.miner.algo
        ? { at: shim.at, algo: shim.miner.algo, rate: shim.miner.rate, accepted: shim.miner.accepted, rejected: shim.miner.rejected,
            pool: shim.miner.pool, uptime: shim.miner.since, declared: 'node-shim' }
        : null;
      const existing = state.peers.find((x) => String(x.ref).toLowerCase() === ref.toLowerCase());
      if (existing) { existing.shim = shim; if (!existing.minerProbe) existing.minerProbe = probe; return; }
      state.peers.push({
        ref, url: null, ip: row.ip || null, node: null, cycle: null, misses: 0,
        verdict: 'alive', reason: 'ssh-monitored - measured by a shim, it has no state door',
        shim, minerProbe: probe,
      });
    }));
  }

  state.lan = lanJson({ self: state.self, peers: state.peers, at, roster: state.roster, selfIp: selfIp(), serverCycle });
  state.at = at;
  state.error = null;

  // publish into the LAN tier; a missing LAN State must never stop the local view from working
  // MinerState (:8147) is the box that reads every miner's own API and knows a box with no State door. It is read
  // here rather than from State because it publishes node.<REMOTE>.miner into this box's registry, which a pull of
  // node.123.* never enumerates. Keys are matched punctuation-blind: lan.json says `1660`, MinerState says `gtx1660`.
  const minerByRef = new Map();
  try {
    const mres = await getJson(MINERSTATE, 2500);
    for (const row of (mres.ok ? mres.body?.nodes : null) || []) {
      const ref = row?.node || row?.ref;
      if (!ref) continue;
      const k = String(ref).toLowerCase().replace(/[^a-z0-9]/g, '');
      minerByRef.set(k, row);
    }
  } catch { /* MinerState down: the node's own standby report is still used */ }
  const minerFor = (ref) => {
    const k = String(ref || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k) return null;
    if (minerByRef.has(k)) return minerByRef.get(k);
    for (const [mk, row] of minerByRef) {
      if (Math.min(mk.length, k.length) >= 3 && (mk.includes(k) || k.includes(mk))) return row;
    }
    return null;
  };
  publishLanState(state.lan, minerFor).then(() => { lanStateOk = true; }).catch((e) => {
    if (lanStateOk !== false) log(`lan state publish failed: ${e.message}`);
    lanStateOk = false;
  });
  log('end');
}


// ── the LAN tier ────────────────────────────────────────────────────────────
// One State instance per LAN, above the per-node ones. This module is what collects the fleet, so this is where the
// collection gets published: `lan.node.<ref>` for every machine and `lan.fleet` for the totals. It is written every
// refresh, so the entry dies the moment Mirror stops - an absent fleet means the collector is gone, which is a fact
// worth being able to see rather than a blank screen.
const LAN_STATE = process.env.MIRROR_LAN_STATE || 'http://127.0.0.1:8148';
const MINERSTATE = process.env.MIRROR_MINERSTATE || 'http://127.0.0.1:8147/state';
let lanStateOk = null;

async function publishLanState(lan, minerFor = () => null) {
  const put = async (name, content) => {
    const r = await fetch(`${LAN_STATE}/api/state/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, content }),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) throw new Error(`${name} -> HTTP ${r.status}`);
  };
  const rows = lan.nodes || [];
  const up = rows.filter((n) => n.verdict === 'alive').length;
  const jobs = [
    put('lan.fleet', {
      at: lan.at, schemaVersion: lan.schemaVersion ?? null,
      nodes: rows.length, up, down: rows.length - up,
      absent: (lan.declaredAbsent || []).length,
      source: 'Mirror',
    }),
  ];
  for (const n of rows) {
    const md = n.minerProbe || n.standby?.minerDetail || null;
    // MinerState is the third witness: it reads every miner's own API and republishes into this box's State as
    // node.<ref>.miner. It outranks a node's self-report, because a box can report "idle" while its card hashes
    // (gtx-1660 did exactly that for a day), and it is the only witness for boxes with no State door at all.
    const ms = minerFor(n.ref) || null;
    const miner = ms ? {
      algo: ms.algo ?? null, rate: ms.hashrate ?? null, unit: null,
      accepted: ms.accepted ?? null, rejected: ms.rejected ?? null,
      uptime_s: ms.miner_uptime_s ?? null, avg_find_time_s: ms.avg_find_time_s ?? null,
      rate_known: ms.rate_known !== false, pool_connected: ms.pool_connected ?? null, pool: ms.pool ?? null,
      readable: ms.readable !== false, why: ms.why ?? null, source: 'minerstate',
    } : md ? {
      algo: md.algo ?? md.label ?? null,
      rate: md.rate ?? null, unit: md.unit ?? null,
      accepted: md.accepted ?? null, rejected: md.rejected ?? null,
      source: n.minerProbe ? 'miner-api' : 'standby',
    } : null;
    jobs.push(put(`lan.node.${n.ref}`, {
      at: lan.at, ref: n.ref, name: n.name, ip: n.ip, role: n.role, verdict: n.verdict,
      services: (n.services || []).length,
      miner,
    }));
  }
  // ── the two entries every tier publishes, whatever its size ─────────────
  // scope.self says who I am; scope.children says who is below me and where their state lives. A node tier answers with
  // its services; this LAN tier answers with its nodes. A future global tier reads THIS entry to learn the LAN exists
  // and what is under it - the ladder is the same code at every rung, not a special case for the top.
  const children = rows.map((n) => ({
    ref: n.ref,
    tier: 'node',
    url: n.standby?.doors?.find?.((d) => d.name === 'State')?.url
      || (n.ip ? `http://${n.ip}:8127` : null),
    verdict: n.verdict,
    at: lan.at,
  }));
  // one entry a screen can read in a single call: every miner on the LAN, newest reading first, keyed by ref
  const byRef = {};
  for (const n of rows) {
    const md = n.minerProbe || n.standby?.minerDetail || null;
    const ms = minerFor(n.ref) || null;
    byRef[n.ref] = ms ? {
      algo: ms.algo ?? null, rate: ms.hashrate ?? null, unit: null,
      accepted: ms.accepted ?? null, rejected: ms.rejected ?? null,
      avg_find_time_s: ms.avg_find_time_s ?? null, uptime_s: ms.miner_uptime_s ?? null,
      rate_known: ms.rate_known !== false, pool_connected: ms.pool_connected ?? null,
      pool: ms.pool ?? null, readable: ms.readable !== false, why: ms.why ?? null, source: 'minerstate', at: lan.at,
    } : md ? {
      algo: md.algo ?? md.label ?? null, rate: md.rate ?? null, unit: md.unit ?? null,
      accepted: md.accepted ?? null, rejected: md.rejected ?? null,
      readable: true, why: null, source: n.minerProbe ? 'miner-api' : 'standby', at: lan.at,
    } : { algo: null, rate: null, accepted: null, rejected: null, readable: false, why: 'no miner reported', source: null, at: lan.at };
  }
  jobs.push(put('lan.miners', { at: lan.at, count: Object.keys(byRef).length, byRef, source: 'Mirror' }));

  jobs.push(put('scope.self', {
    tier: 'lan', ref: 'lan-1', url: `http://${selfIp() || '192.168.1.123'}:8148`,
    parent: null, at: lan.at, source: 'Mirror', note: 'one per LAN; the node tier is below it',
  }));
  jobs.push(put('scope.children', children));

  await Promise.all(jobs);
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
    return send(200, { ok: true, nodes: state.lan?.counts?.nodes ?? 0, peers: state.peers.length, at: state.lan?.at ?? null, refreshError: state.error, refreshes: refreshN, roster: state.roster ? { ok: state.roster.ok, file: state.roster.file, rows: state.roster.rows.length } : null });
  }
  if (url.pathname === '/api/lan.json') return send(200, state.lan || { ok: false, error: 'no snapshot yet' });
  if (url.pathname === '/api/lan.md') return send(200, state.lan ? lanMarkdown(state.lan) : '# LAN\n\nno snapshot yet\n', 'text/markdown; charset=utf-8');
  /**
   * GET /api/fleet?for=tts - who can do X, from the declared roster joined to the live LAN.
   * A reader that cannot read its input REFUSES: a 200 with an empty list would say "nobody can do TTS",
   * which is a much worse lie than "the roster is at C:/AI/fleet/roster.json and I cannot open it".
   */
  if (url.pathname === '/api/fleet') {
    const roster = state.roster || loadRoster();
    if (!roster.ok) {
      return send(503, {
        ok: false,
        error: { code: 'roster_unreadable', message: `cannot read the roster at ${roster.file}`, detail: roster.error },
      });
    }
    const nodes = state.lan?.nodes || [];
    const want = url.searchParams.get('for');
    return send(200, {
      ok: true,
      at: state.lan?.at ?? null,
      for: want || null,
      candidates: candidatesFor(roster, nodes, want),
      fleet: fleetSummary(roster, nodes),
    });
  }
  if (url.pathname.startsWith('/api/node/')) {
    const ref = url.pathname.slice('/api/node/'.length).toLowerCase();
    if (state.self && state.self.ref === ref) return send(200, { ok: true, role: 'self', node: state.self });
    const peer = state.peers.find((p) => p.ref === ref);
    if (peer) return send(200, { ok: true, role: 'peer', verdict: peer.verdict, node: peer.node });
    return send(404, { ok: false, error: 'no such node', ref });
  }
  return send(404, { ok: false, error: 'nothing here', paths: ['/health', '/api/lan.json', '/api/lan.md', '/api/fleet?for=<capability>', '/api/node/<ref>'] });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[mirror] :${PORT} - state ${STATE}, join ${JOIN}, tick ${TICK_MS}ms, ref ${REF}`);
  await refresh().catch((error) => console.error('[mirror] first refresh failed:', error.message));
  setInterval(() => refresh().catch((error) => { state.error = error.message; }), TICK_MS);
});
