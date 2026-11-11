#!/usr/bin/env node
/**
 * State Resolver - this node's own branch, its opinion of its neighbours, and the reader of a root state.
 *
 * The operator renamed this module on 2026-11-10: "Core" is now **State Resolver**. It does five things:
 *   1. registers this node's own subtree in its own State  (node.<ref>.id · .doors · .cycle)
 *   2. ticks a monotonic cycle counter and re-registers it  (the heartbeat, no clock agreement needed)
 *   3. pulls every peer's cycle entry each tick and records what it observed under ITS OWN branch
 *   4. publishes one LINK per attached member (node.<ref> -> its State url), re-asserted once a minute so a State that
 *      restarted is repopulated without restarting this door
 *   5. resolves a path across those links and serves the assembled tree (/api/resolve · /api/links · /api/tree)
 *
 * The walk itself lives in the State registry (:8127) — it follows a link, asks the far side for the REMAINDER of the
 * path, falls back to the same full name, and reports source/hops/via. This door DELEGATES to it rather than
 * re-implementing it: two walkers would be two behaviours, and the one that answered would be a coin toss.
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
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cycleEntry, doorsEntry, entryNames, idEntry, linkEntry, refOf, serviceEntries } from './self.js';
import { classify, observation, standbyOf } from './verdict.js';
import { minimal } from './broadcast.js';
import { decide, claimEntry, isLive } from './claim.js';
import { activeSet, drop, getJson, pull, register } from './stateClient.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const ROOT = path.resolve(MODULE, '..');

/** One flag, read from argv: `--name value`. Absent flag and absent value both fall back. */
const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const argPort = (() => {
  const i = process.argv.indexOf('--port');
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();
const PORT = Number(process.env.CORE_PORT || argPort || 8136);
// the bind address is a flag, not a constant: a test door has no business being reachable from the LAN
const HOST = process.env.CORE_HOST || argOf('host', null) || '0.0.0.0';
const TICK_MS = Number(process.env.CORE_TICK_MS || 5000);
// --state lets one door be pointed at a different registry without a second process tree (and lets a test run against a
// throwaway State instead of the LAN's).
const STATE = (process.env.CORE_STATE || argOf('state', null) || 'http://127.0.0.1:8127').replace(/\/$/, '');
const JOIN = process.env.CORE_JOIN || argOf('join', null) || 'http://127.0.0.1:8131';
const SERVICES = process.env.CORE_SERVICES || argOf('services', null) || 'http://127.0.0.1:8128';
const REF = process.env.HYDRA_REF || argOf('node-ref', null) || null;

// THE ROOT CLAIM — off unless asked for. A role that moves between machines by itself must be switched on
// deliberately on a fleet that is still being trusted node by node; with the flag absent this door behaves exactly as
// it did before the claim existed.
const ROOT_CLAIM = process.argv.includes('--root-claim') || process.env.ROOT_CLAIM === '1';
const CLAIM_LEASE_MS = Number(process.env.CLAIM_LEASE_MS || 15000);
const CLAIM_KEY = process.env.CLAIM_KEY || 'root.claim';

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
// an explicit --node-ref wins over the file: a test (or a second door on one box) has to be able to say who it is
const ref = refOf({ ...node, ref: REF || node.ref }, os.hostname().toLowerCase());
const N = entryNames(ref);
const startedAt = Date.now();

/** The root role's local view of itself. `off` until --root-claim is passed, so nothing moves by surprise. */
const claimState = {
  role: ROOT_CLAIM ? 'member' : 'off',
  claim: null,
  token: randomUUID(),
  note: ROOT_CLAIM ? 'claiming on the first tick' : 'claim disabled (start with --root-claim)',
};

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

  // the root role steps on the same clock as the heartbeat: one pull, and a write only when the answer moves
  await stepClaim();

  // identity and doors change rarely: refresh them every 12th tick (a minute at 5s)
  if (state.cycle === 1 || state.cycle % 12 === 0) {
    await readDoors();
    await readServices();
    await register(STATE, N.id, idEntry(node, { ref, startedAt }), {}, 700);
    await register(STATE, N.doors, doorsEntry(state.doors, state.lastTickAt), {}, 700);
    // State is memory-only, so a registry that restarted lost every link while this map still believes it published
    // them — "write only when it changes" becomes a lie the moment someone else's memory is cleared. Re-assert them
    // once a minute: it costs one POST per peer and it is the difference between a LAN and a set of strangers.
    state.links.clear();
  }

  const list = (await members()) ?? parsePeers();
  await publishLinks(list);
  await Promise.all(list.filter((p) => p.ref !== ref).map((p) => observePeer(p).catch(() => null)));
}

const RESOLVE_TIMEOUT = Number(process.env.CORE_RESOLVE_TIMEOUT_MS || 900);

/** What the registry currently says about the root role. A malformed entry reads as no claim, never as a holder. */
async function readClaim() {
  const got = await pull(STATE, CLAIM_KEY, null, 700);
  const value = got.ok ? (got.body?.content ?? null) : null;
  return value && typeof value === 'object' && value.ref ? value : null;
}

/**
 * One step of the root role. Cheap by design: a pull and, when the answer changes, a write.
 *
 * The rule it implements is the operator's: no live claim -> this node becomes the root; a live claim held by someone
 * else -> yield unless this node wins the tiebreak; a lease that expired -> take it. The root's content is a pointer
 * table, so the "rebuild" a survivor performs is a handful of POSTs, not a restore.
 */
async function stepClaim() {
  if (!ROOT_CLAIM) return;
  const now = Date.now();
  const claim = await readClaim();
  claimState.claim = claim;

  const decision = decide({ claim, me: ref, now, leaseMs: CLAIM_LEASE_MS });
  claimState.note = decision.why;

  if (decision.action === 'yield') {
    claimState.role = 'member';
    return;
  }
  const entry = claimEntry({ me: ref, token: claimState.token, now, leaseMs: CLAIM_LEASE_MS });
  const res = await register(STATE, CLAIM_KEY, entry, {}, 700);
  if (!res.ok) {
    claimState.role = 'member';
    claimState.note = `claim write failed: ${res.error || `status ${res.status}`}`;
    return;
  }
  claimState.role = 'root';
  claimState.claim = entry;
}

/**
 * Resolve a path — by asking the State registry, which owns the walk.
 *
 * State follows a link, asks the far side for the REMAINDER of the path (the operator's rule: a link at node.123 owns
 * everything past it), falls back to the same full name for registries that name their own branch identically, and
 * reports `source`, `hops` and `via`. Doing that walk again here would give the LAN two behaviours that disagree the
 * day one of them changes — so this function is a translator, not a resolver.
 *
 * A hop that cannot be made comes back as a typed absence (`absent`, `unreachable`, `timeout`, `cycle`) — never as a
 * stale value and never as an empty success, because an empty answer reads as "nothing to do" and hides a dead node.
 */
async function resolveName(name) {
  const started = Date.now();
  const res = await pull(STATE, name, null, RESOLVE_TIMEOUT);
  const body = res.body || {};
  const via = Array.isArray(body.via) ? body.via : [STATE];

  if (res.ok && body.ok !== false) {
    return {
      ok: true,
      path: name,
      value: body.content ?? null,
      source: body.source || STATE,
      hops: Number.isFinite(body.hops) ? body.hops : 0,
      via,
      ms: Date.now() - started,
    };
  }
  const why = body.why
    || (body.error && body.error.code === 'no_such_entry' ? 'absent' : null)
    || (res.status === 404 ? 'absent' : (res.error || 'unreachable'));
  return { ok: false, path: name, value: null, why, source: via[via.length - 1] || STATE, hops: Number.isFinite(body.hops) ? body.hops : 0, via, ms: Date.now() - started };
}

/**
 * The pointer table this node is reading right now: every `node.*` entry whose shape says it is a link.
 *
 * Read from the registry on demand, never held here. A copy held in this process is a second truth, and the day the
 * registry restarts the copy keeps insisting on links that no longer exist.
 */
async function linkTable(query = 'node') {
  const set = await getJson(`${STATE}/api/state?q=${encodeURIComponent(query)}`, 700);
  if (!set.ok) {
    return { ok: false, url: STATE, why: set.error === 'timeout' ? 'timeout' : 'unreachable', detail: set.error || `http ${set.status}`, links: [], scanned: 0 };
  }
  const entries = Array.isArray(set.body?.entries) ? set.body.entries : [];
  const candidates = entries.filter((e) => Array.isArray(e?.shape) && e.shape.includes('to') && e.shape.includes('kind'));
  const links = [];
  for (const entry of candidates) {
    const got = await pull(STATE, entry.path, null, 700);
    const value = got.ok ? (got.body?.content ?? null) : null;
    if (value && value.kind === 'link' && typeof value.to === 'string') links.push({ name: entry.path, to: value.to, at: value.at ?? null });
  }
  return { ok: true, url: STATE, scanned: entries.length, candidates: candidates.length, links };
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

  if (url.pathname === '/health') return send(200, { ok: true, door: 'state-resolver', ref, cycle: state.cycle, tickMs: state.tickMs, peers: state.peers.size, links: state.links.size, state: STATE, role: claimState.role, root: claimState.claim, claimNote: claimState.note });
  if (url.pathname === '/api/root') return send(200, { ok: true, ref, role: claimState.role, claim: claimState.claim, note: claimState.note, key: CLAIM_KEY, leaseMs: CLAIM_LEASE_MS, enabled: ROOT_CLAIM });
  if (url.pathname === '/api/tree') return send(200, tree());
  if (url.pathname === '/api/links') return send(200, await linkTable(url.searchParams.get('q') || 'node'));
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

// A door that cannot bind its port must say so and stop — a resolver that cannot be asked a question has no business
// holding the root role, and a silent EADDRINUSE is how two instances end up fighting over one address.
server.on('error', (error) => {
  console.error(`[state-resolver] cannot serve on :${PORT} - ${error.code || error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  console.log(`[state-resolver] ${ref} on ${HOST}:${PORT} - state ${STATE}, join ${JOIN}, tick ${TICK_MS}ms, claim ${ROOT_CLAIM ? `on (lease ${CLAIM_LEASE_MS}ms)` : 'off'}`);
  await tick();
  setInterval(() => {
    tick().catch((error) => console.error('[state-resolver] tick failed:', error.message));
  }, TICK_MS);
});

export { classify, observation };
