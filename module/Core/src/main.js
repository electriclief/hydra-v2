#!/usr/bin/env node
/**
 * Core - the basic server.
 *
 * It does four things and nothing else:
 *   1. registers this node's own subtree in its own State  (node.<ref>.id · .doors · .cycle)
 *   2. ticks a monotonic cycle counter and re-registers it  (the heartbeat, no clock agreement needed)
 *   3. pulls every peer's cycle entry each tick and records what it observed under ITS OWN branch
 *   4. serves one assembled tree at /api/tree so a display never has to know about peers
 *
 * It is not a broker and holds no truth about anyone: a peer's entry is that peer's, and an observation is this
 * node's opinion. If this process dies, nothing else loses data - which is the point.
 *
 * Env:
 *   CORE_PORT=8136  CORE_TICK_MS=5000  CORE_STATE=http://127.0.0.1:8127
 *   CORE_JOIN=http://127.0.0.1:8131   CORE_PEERS="127@http://192.168.1.127:8127,..."
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cycleEntry, doorsEntry, entryNames, idEntry, linkEntry, refOf, serviceEntries } from './self.js';
import { classify, observation, standbyOf } from './verdict.js';
import { minimal } from './broadcast.js';
import { activeSet, drop, getJson, pull, register } from './stateClient.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const ROOT = path.resolve(MODULE, '..');
const argPort = (() => {
  const i = process.argv.indexOf('--port');
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();
const PORT = Number(process.env.CORE_PORT || argPort || 8136);
const TICK_MS = Number(process.env.CORE_TICK_MS || 5000);
const STATE = process.env.CORE_STATE || 'http://127.0.0.1:8127';
const JOIN = process.env.CORE_JOIN || 'http://127.0.0.1:8131';
const SERVICES = process.env.CORE_SERVICES || 'http://127.0.0.1:8128';
const REF = process.env.HYDRA_REF || null;

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function nodeJson() {
  return readJson(path.join(MODULE, 'data', 'node.json'), null) || readJson(path.join(ROOT, 'Menu', 'data', 'node.json'), {});
}

const node = nodeJson();
const ref = refOf({ ...node, ref: node.ref || REF }, os.hostname().toLowerCase());
const N = entryNames(ref);
const startedAt = Date.now();

const state = {
  cycle: 0,
  tickMs: TICK_MS,
  startedAt,
  fillPct: null,
  sessions: null,
  doors: [],
  services: new Map(), // slug -> content, the broker's payload
  peers: new Map(), // ref -> { cycle, misses, verdict, reason, seenAt, id }
  links: new Map(), // ref -> the State url its node.<ref> link points at (so a link is written once, not every tick)
  lastRegisterError: null,
  lastTickAt: null,
};

/** Every sibling module folder that declares a port, probed in parallel with a short budget. */
async function readDoors() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return state.doors;
  }
  const found = [];
  for (const dir of dirs) {
    const join = readJson(path.join(ROOT, dir, 'join.json'), null);
    if (!join || !Number.isFinite(Number(join.port)) || Number(join.port) <= 0) continue;
    found.push({ name: join.name || dir, port: Number(join.port), up: false });
  }
  await Promise.all(
    found.map(async (door) => {
      const probe = await getJson(`http://127.0.0.1:${door.port}/health`, 400);
      door.up = probe.ok;
    }),
  );
  state.doors = found.sort((a, b) => a.port - b.port);
  return state.doors;
}

/**
 * The catalog, nested under the node: node.<ref>.services.<slug>.
 *
 * A service that disappears from the catalog must also disappear here, or the node keeps advertising something
 * it can no longer make. So the diff is two-sided: register what is there, drop what is not.
 */
async function readServices() {
  const res = await getJson(`${SERVICES}/api/services`, 900);
  if (!res.ok || !res.body || !Array.isArray(res.body.services)) return;
  const entries = serviceEntries(res.body.services, Date.now());
  const seen = new Set(entries.map((e) => e.name));

  for (const entry of entries) {
    state.services.set(entry.name, entry.content);
    await register(STATE, N.service(entry.name), entry.content, {}, 600);
  }
  for (const slug of [...state.services.keys()]) {
    if (seen.has(slug)) continue;
    state.services.delete(slug);
    await drop(STATE, N.service(slug), 600);
  }

  // entries left over from an earlier run (or an earlier slug) are still advertised until they are dropped
  const discovered = await getJson(`${STATE}/api/state`, 700);
  if (discovered.ok && Array.isArray(discovered.body?.entries)) {
    for (const entry of discovered.body.entries) {
      const name = String(entry.path || '');
      if (!name.startsWith(`${N.services}.`)) continue;
      const slug = name.slice(N.services.length + 1);
      if (!seen.has(slug) || slug.includes('.')) await drop(STATE, name, 600);
    }
  }

  // the rollup: readers get every advertised service in ONE pull instead of discovering slugs first
  await register(
    STATE,
    N.services,
    { at: new Date().toISOString(), count: state.services.size, names: [...state.services.keys()].sort(), services: Object.fromEntries(state.services) },
    {},
    600,
  );
}

function parsePeers() {
  const raw = String(process.env.CORE_PEERS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((bit) => bit.trim())
    .filter(Boolean)
    .map((bit) => {
      const [name, url] = bit.includes('@') ? bit.split('@') : [bit, `http://${bit}:8127`];
      return { ref: name, url: url.replace(/\/+$/, '') };
    });
}

/** Ask Join who is attached. An empty LAN is a normal answer, not a failure. */
async function members() {
  const res = await getJson(`${JOIN}/api/members`, 600);
  if (!res.ok || !res.body || !Array.isArray(res.body.members)) return null;
  return res.body.members
    .map((m) => {
      const peerRef = m.ref || m.name || m.id;
      const url = m.stateUrl || m.url || (m.ip ? `http://${m.ip}:8127` : null) || (m.host ? `http://${m.host}:8127` : null);
      return peerRef && url ? { ref: String(peerRef).toLowerCase(), url } : null;
    })
    .filter(Boolean);
}

/**
 * One peer, one pull of its cycle entry, one opinion. The pull asks for the peer's own name inside the peer's
 * own registry; if that misses (older node, different ref), fall back to its active set and take the first
 * `node.*.cycle` it holds.
 */
async function observePeer(peer) {
  const prev = state.peers.get(peer.ref) || { cycle: null, misses: 0, verdict: 'stalled', seenAt: 0 };
  let cycle = null;
  let reachable = false;
  // what the peer is DOING is a separate, cheap entry: the cycle answers "are you alive", the standby answers
  // "and what are you busy with". A row that only knows the first reads "no report" for a box that is mining.
  let standby = null;
  let activeEntries = null;

  const direct = await pull(peer.url, `node.${peer.ref}.cycle`, null, 500);
  if (direct.ok && direct.body) {
    const content = direct.body.content ?? direct.body.entry?.content ?? null;
    if (content && typeof content.cycle === 'number') {
      cycle = content.cycle;
      reachable = true;
    }
  }

  if (!reachable) {
    const set = await activeSet(peer.url, 500);
    if (set.ok && set.body && Array.isArray(set.body.entries)) {
      reachable = true; // it answered, even if it has no cycle entry yet
      activeEntries = set.body.entries;
      const entry = set.body.entries.find((e) => String(e.name || '').endsWith('.cycle'));
      if (entry && entry.content && typeof entry.content.cycle === 'number') cycle = entry.content.cycle;
    }
  }

  // one more pull, same budget: a peer that does not publish it costs a 404 and nothing else
  const sb = await pull(peer.url, `node.${peer.ref}.standby`, null, 500);
  if (sb.ok && sb.body) {
    standby = standbyOf(sb.body.content ?? sb.body.entry?.content ?? null, Date.now());
  } else if (activeEntries) {
    // an older node may name its branch differently; its active set already told us what it publishes
    const entry = activeEntries.find((e) => String(e.name || '').endsWith('.standby'));
    if (entry) standby = standbyOf(entry.content, Date.now());
  }

  const verdict = classify(prev, { cycle, reachable }, { stalledAfter: 3, goneAfter: 12 });
  const record = { ...verdict, seenAt: Date.now(), standby };
  state.peers.set(peer.ref, { ...record, url: peer.url });

  // the observation lives under THIS node's branch - never inside the peer's
  await register(STATE, N.observed(peer.ref), observation(verdict, record.seenAt, standby), {}, 600);
  return record;
}

async function tick() {
  state.cycle += 1;
  state.lastTickAt = Date.now();

  const reg = await register(STATE, N.cycle, cycleEntry(state, state.lastTickAt), { serving: { cycle: 'delta' } }, 700);
  state.lastRegisterError = reg.ok ? null : reg.error || `status ${reg.status}`;

  // identity and doors change rarely: refresh them every 12th tick (a minute at 5s)
  if (state.cycle === 1 || state.cycle % 12 === 0) {
    await readDoors();
    await readServices();
    await register(STATE, N.id, idEntry(node, { ref, startedAt }), {}, 700);
    await register(STATE, N.doors, doorsEntry(state.doors, state.lastTickAt), {}, 700);
  }

  const list = (await members()) ?? parsePeers();
    await publishLinks(list);
  await Promise.all(list.filter((p) => p.ref !== ref).map((p) => observePeer(p).catch(() => null)));
}

const RESOLVE_TIMEOUT = Number(process.env.CORE_RESOLVE_TIMEOUT_MS || 900);
const RESOLVE_DEPTH = Number(process.env.CORE_RESOLVE_DEPTH || 3);

/**
 * Resolve a path by following links, lazily, at read time.
 *
 * The rule: ask this registry for the exact name. If it is not here, walk the name shorter until something IS
 * here — and if that something is a link, ask the registry it points at for the SAME name (every node names its
 * own branch identically in its own registry) and return whatever that says, now. No copy is stored at any hop,
 * so a progress value read through this is the value at the moment of the read, not at the last tick.
 *
 * If a hop cannot be made the answer is a typed absence, never a stale value: `absent`, `unreachable`,
 * `timeout`, or `cycle` (a link that points back at a link).
 */
async function resolveName(name, depth = 0, seen = new Set()) {
  const started = Date.now();
  let candidate = name;

  for (;;) {
    const key = candidate;
    const res = await pull(STATE, candidate, null, RESOLVE_TIMEOUT);

    if (res.ok && res.body) {
      const value = res.body.content ?? null;
      const isLink = value && value.kind === 'link' && value.to;
      if (isLink && candidate !== name) {
        if (seen.has(candidate) || depth >= RESOLVE_DEPTH) {
          return { ok: false, path: name, value: null, why: 'cycle', via: [...seen, candidate], hops: depth, ms: Date.now() - started };
        }
        const next = new Set(seen).add(candidate);
        const onward = await resolveNameFrom(value.to, name, depth + 1, next);
        return { ...onward, hops: depth + 1, ms: Date.now() - started, via: [STATE, ...(onward.via || [])] };
      }
      return { ok: true, path: name, value, source: STATE, hops: depth, ms: Date.now() - started, via: [STATE] };
    }

    const parts = candidate.split('.').filter(Boolean);
    if (parts.length <= 1) {
      return { ok: false, path: name, value: null, why: res.status === 404 ? 'absent' : (res.error || 'unreachable'), source: STATE, hops: depth, ms: Date.now() - started };
    }
    candidate = parts.slice(0, -1).join('.');
  }
}

/** The same walk, but a registry that is not this one. A peer is asked for the full path, not a fragment. */
async function resolveNameFrom(base, name, depth, seen) {
  const res = await pull(base, name, null, RESOLVE_TIMEOUT);
  if (res.ok && res.body) {
    const value = res.body.content ?? null;
    if (value && value.kind === 'link' && value.to && depth < RESOLVE_DEPTH) {
      return resolveNameFrom(value.to, name, depth + 1, seen);
    }
    return { ok: true, path: name, value, source: base, hops: depth, via: [base] };
  }
  return {
    ok: false,
    path: name,
    value: null,
    why: res.status === 404 ? 'absent' : (res.error || 'unreachable'),
    source: base,
    hops: depth,
    via: [base],
  };
}

/** Write one link per attached member, and only when it changes. */
async function publishLinks(list) {
  for (const peer of list || []) {
    if (!peer.url || peer.url === STATE) continue;
    if (state.links.get(peer.ref) === peer.url) continue;
    const res = await register(STATE, `node.${peer.ref}`, linkEntry(peer.url), {}, 600);
    if (res.ok) state.links.set(peer.ref, peer.url);
  }
}

function tree() {
  return {
    ok: true,
    ref,
    cycle: state.cycle,
    tickMs: state.tickMs,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    registerError: state.lastRegisterError,
    self: {
      id: idEntry(node, { ref, startedAt }),
      doors: doorsEntry(state.doors, Date.now()),
    },
    peers: [...state.peers.entries()].map(([peerRef, v]) => ({
      ref: peerRef,
      url: v.url,
      verdict: v.verdict,
      cycle: v.cycle,
      misses: v.misses,
      reason: v.reason,
      // what it said it was doing when we last looked - null is "no report", not "idle"
      standby: v.standby || null,
      seenAt: v.seenAt ? new Date(v.seenAt).toISOString() : null,
    })),
    services: [...state.services.entries()].map(([slug, svc]) => ({ slug, ...svc })),
    names: N,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  };

  if (url.pathname === '/health') return send(200, { ok: true, ref, cycle: state.cycle, tickMs: state.tickMs, peers: state.peers.size });
  if (url.pathname === '/api/tree') return send(200, tree());
  if (url.pathname === '/api/resolve') {
    const name = url.searchParams.get('name');
    if (!name) return send(400, { ok: false, error: { code: 'name_required', message: 'name is required, e.g. node.jims.cycle' } });
    return send(200, await resolveName(name));
  }
  if (url.pathname === '/api/broadcast') {
    const proj = minimal(idEntry(node, { ref, startedAt }), cycleEntry(state, Date.now()), Object.fromEntries(state.services));
    return send(200, { ok: true, schemaVersion: 1, ...proj });
  }
  if (url.pathname === '/api/self') return send(200, { ok: true, ref, names: N, id: idEntry(node, { ref, startedAt }), doors: doorsEntry(state.doors, Date.now()), cycle: cycleEntry(state, Date.now()) });
  return send(404, { ok: false, error: 'nothing here', paths: ['/health', '/api/tree', '/api/self'] });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[core] ${ref} on :${PORT} - state ${STATE}, join ${JOIN}, tick ${TICK_MS}ms`);
  await tick();
  setInterval(() => {
    tick().catch((error) => console.error('[core] tick failed:', error.message));
  }, TICK_MS);
});

export { classify, observation };
