#!/usr/bin/env node
/**
 * Phoenix Cycle - the maintenance registry.
 *
 * Phoenix does not know what maintenance is. It runs entries that their owners register, exactly as Event_Handler and
 * the Process Manager do. Two rules make it different from a cron daemon:
 *
 *   1. Every entry declares BOTH surfaces: a port it answers and a tick it exposes. A thread-only entry is an
 *      invisible background process; a port-only entry needs someone to remember it. Neither is allowed.
 *   2. Triggers are declared and validated at registration. An entry with a trigger this build cannot evaluate is
 *      refused at the door, not silently skipped at 3am.
 *
 * The distinction from the Scheduler, deliberately: the Scheduler answers "what should this node be doing with its
 * GPU right now" (work, idle service, leases, AI priority). Phoenix answers "what upkeep is due" (docs drift,
 * receipts, dead leases, session debt). They share a clock and nothing else. Phoenix never starts AI work; at most it
 * asks the Scheduler whether the node is idle before running a heavy entry.
 *
 * Heartbeat is every x minutes (default 10). Each beat re-reads the registry, so a new entry takes effect without a
 * restart, then evaluates each entry's trigger against its last receipt.
 *
 *   node server/main.js --port 8146 --every 10
 */
import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
// a second instance is a different tier, so it must not share this one's registry, clock or receipts
const DATA = process.env.PHOENIX_DATA ? path.resolve(process.env.PHOENIX_DATA) : path.join(MODULE, 'data');
const REGISTRY = path.join(DATA, 'registry.json');
const CLOCK = path.join(DATA, 'clock.json');
const HASHES = path.join(DATA, 'hashes.json');
const RECEIPTS = path.join(DATA, 'receipts');
// WHAT THE CYCLE REMEMBERS ABOUT VERSIONS. The operator's rule: match the number, and if it is out of sync trigger the
// node's own update - but do not ask the same question every ten minutes. A version changes a few times a day at most,
// so a remembered answer is good until the node is asked to update or the memory ages out.
const VERSIONS = path.join(DATA, 'versions.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argOf('port', process.env.PHOENIX_PORT ?? 8146));
const HOST = argOf('host', '127.0.0.1');
const EVERY_MIN = Math.max(1, Number(argOf('every', process.env.PHOENIX_EVERY_MIN ?? 10)) || 10);
// Tell Mom is a CLIENT relationship: Phoenix does not own a transport, it calls the one door that does. A cycle that
// fails an entry is a thing that happened, so it is told once (deduped by TellMom's own window) instead of scrolling
// past in a receipt file nobody opens.
const TELLMOM = (argOf('tellmom', process.env.PHOENIX_TELLMOM ?? 'http://127.0.0.1:8139')).replace(/\/$/, '');
// Where this cycle publishes itself, if anywhere. Empty means a plain node cycle; set it and the same code is the
// LAN-tier cycle: lan.cycle plus one lan.entry.<id> per check, so the fleet's heartbeat is a state path, not a page.
const STATE_URL = (argOf('state', process.env.PHOENIX_STATE ?? '')).replace(/\/$/, '');
// A node cycle has no tier above it, so it publishes nothing - and then the countdown to its next beat exists only in its
// own /health, which a browser on :8133 cannot read (cross-origin). So a node cycle publishes its beat as node.<ref>.upkeep
// into its OWN state: same facts as lan.cycle, one rung down, so the screen can draw both rungs without asking anyone.
// The ordering matters: this is a node fact written to a node state, never a lan.* key.
const NODE_STATE_URL = (argOf('node-state', process.env.PHOENIX_NODE_STATE ?? 'http://127.0.0.1:8127')).replace(/\/$/, '');
// The root governs: each beat it writes every node's beat, so a node never runs a second schedule. Mirror already knows
// where the machines are, so the root asks it instead of carrying a roster of its own.
const MIRROR = (argOf('mirror', process.env.PHOENIX_MIRROR ?? 'http://127.0.0.1:8137')).replace(/\/$/, '');
const NODE_STATE_PORT = Number(argOf('node-state-port', process.env.PHOENIX_NODE_STATE_PORT ?? 8127)) || 8127;
const REF = (argOf('ref', process.env.PHOENIX_REF ?? '')).trim() || readRefFromMenu();
function readRefFromMenu() {
  // same source ResourceManager uses: the node's own identity file. A missing ref is not fatal - the entry is published
  // as node.unknown.upkeep rather than silently skipped, so a nameless box is visible instead of absent.
  try {
    const j = JSON.parse(fs.readFileSync(new URL('../../Menu/data/node.json', import.meta.url), 'utf8'));
    return (j.ref ?? j.name ?? '').toString().trim() || 'unknown';
  } catch { return 'unknown'; }
}

const log = (...parts) => process.stdout.write(`[phoenix] ${parts.join(' ')}\n`);

// WHICH CODE IS THIS? A beat is only worth trusting if you know which build produced it, and the fleet question
// "are the children on the same version as me" needs an answer that does not depend on anybody remembering to ask.

function readVersions() {
  try { return JSON.parse(fs.readFileSync(VERSIONS, 'utf8')); } catch { return { at: null, own: null, nodes: {} }; }
}
function writeVersions(v) {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(VERSIONS, JSON.stringify(v, null, 2)); } catch { /* a cache that cannot be written must not stop a cycle */ }
}

function buildInfo() {
  const root = (() => { try { return fileURLToPath(new URL('../../..', import.meta.url)); } catch { return null; } })();
  let rev = process.env.PHOENIX_REV || null, dirty = null;
  if (!rev && root) {
    try { rev = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 4000 }).trim(); } catch { rev = null; }
    try { dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', timeout: 4000 }).trim().length > 0; } catch { dirty = null; }
  }
  return { rev: rev || 'unknown', dirty, root, at: new Date().toISOString(), port: PORT };
}
const BUILD = buildInfo();
const nowIso = () => new Date().toISOString();

fs.mkdirSync(RECEIPTS, { recursive: true });

// ---------------------------------------------------------------- registry

const TRIGGERS = new Set(['every', 'on']);          // v0: implemented
const DECLARED_ONLY = new Set(['cron', 'after']);   // v0: understood, refused at the door

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadRegistry() {
  const raw = readJson(REGISTRY, { version: 1, entries: [] });
  return Array.isArray(raw.entries) ? raw.entries : [];
}

/** Validation is the security boundary of this module: a bad entry must never become a half-run. */
function validate(entry) {
  const bad = (why) => { throw new Error(`${why}`); };
  if (!entry || typeof entry !== 'object') bad('entry must be an object');
  if (!entry.id || !/^[a-z0-9][a-z0-9._-]{2,60}$/.test(entry.id)) bad('id must be a lowercase slug');
  if (!entry.owner) bad('owner is required - Phoenix never guesses who is responsible');
  if (!['code', 'nag'].includes(entry.kind)) bad("kind must be 'code' or 'nag'");
  const trigger = entry.trigger || {};
  const keys = Object.keys(trigger).filter((k) => TRIGGERS.has(k) || DECLARED_ONLY.has(k));
  if (keys.length !== 1) bad('exactly one trigger: every | on | cron | after');
  if (DECLARED_ONLY.has(keys[0])) bad(`trigger '${keys[0]}' is declared but not implemented in this build - refused, not skipped`);
  if (keys[0] === 'every' && !/^\d+[smh]$/.test(String(trigger.every))) bad("every must look like 30m, 6h, 90s");
  if (keys[0] === 'on' && typeof trigger.on !== 'string') bad('on must name an event');
  if (entry.kind === 'code') {
    const action = entry.action || {};
    if (!action.http && !action.func && !action.tell) bad('a code entry needs action.http, action.func or action.tell');
  }
  if (entry.kind === 'nag' && !entry.title) bad('a nag entry needs a title to show a person');
  // a repair is only ever a declared kind: an entry that cannot say HOW is escalated, not improvised at
  if (entry.fix) {
    const fx = entry.fix;
    if (typeof fx !== 'object') bad('fix must be an object');
    if (!fx.http && !fx.pw && !fx.agent && !fx.task) bad('fix must declare http, pw, agent or task');
    if (fx.pw && !fx.pw.processId && !fx.pw.name) bad('fix.pw needs processId or name');
    if (fx.agent && (!fx.agent.node || !fx.agent.cmd)) bad('fix.agent needs node and cmd');
    if (fx.task && !fx.task.name) bad('fix.task needs a task name');
  }
  return { ...entry, lease_s: Math.max(5, Math.min(3600, Number(entry.lease_s) || 120)) };
}

function intervalMs(spec) {
  const m = /^(\d+)([smh])$/.exec(String(spec));
  if (!m) return null;
  const n = Number(m[1]);
  return n * (m[2] === 's' ? 1000 : m[2] === 'm' ? 60000 : 3600000);
}

// ---------------------------------------------------------------- receipts

function receiptPath(id) { return path.join(RECEIPTS, `${id}.jsonl`); }

function appendReceipt(receipt) {
  fs.appendFileSync(receiptPath(receipt.id), JSON.stringify(receipt) + '\n');
}

function lastReceipt(id) {
  try {
    const lines = fs.readFileSync(receiptPath(id), 'utf8').trim().split('\n');
    return lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch { return null; }
}

function readClock() { return readJson(CLOCK, {}); }
function writeClock(clock) { fs.writeFileSync(CLOCK, JSON.stringify(clock, null, 2)); }

// ---------------------------------------------------------------- actions

/** An entry runs under a lease. Overrun is cancelled and recorded as a failure, never left hanging. */
async function withLease(entry, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), entry.lease_s * 1000);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function runCode(entry, signal) {
  const action = entry.action || {};
  if (action.tell) {
    // A declared TELL: the entry says what to say, Tell Mom decides whether the operator hears it. Phoenix holds no
    // transport and no token — it sends the sender's name and lets the policy door do the throttling.
    const started = Date.now();
    const payload = {
      severity: action.tell.severity || 'note',
      subject: action.tell.subject || entry.title || entry.id,
      body: action.tell.body || `raised by ${entry.owner} (${entry.id})`,
      wants: action.tell.wants || null,
      dedupeKey: action.tell.dedupeKey || `phoenix:${entry.id}`,
      by: action.tell.by || entry.owner || 'phoenix',
      ...(Array.isArray(action.tell.channels) ? { channels: action.tell.channels } : {}),
    };
    const res = await fetch(`${TELLMOM}/api/tell`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.text();
    const detail = { tell: TELLMOM, status: res.status, ms: Date.now() - started, subject: payload.subject };
    try {
      const parsed = JSON.parse(body);
      detail.deduped = parsed.deduped ?? null;
      if (parsed.record?.delivered) detail.delivered = parsed.record.delivered.map((d) => `${d.channel}:${d.ok ? 'ok' : 'fail'}`);
    } catch { /* a non-JSON answer is still an answer */ }
    // 403 is a policy refusal, which is a SUCCESSFUL cycle outcome: the door did its job. Transport failure is not.
    if (res.status === 403) return { outcome: 'ok', detail: { ...detail, refused: 'sender not permitted' } };
    if (!res.ok) return { outcome: 'failed', detail, error: `tellmom HTTP ${res.status}` };
    return { outcome: 'ok', detail };
  }
  if (action.http) {
    const started = Date.now();
    // The lease is the OUTER bound; a probe needs its own, shorter one. A dead agent that never answers used to eat the
    // whole lease and come back 'cancelled', which reads like a non-event instead of "that door is gone".
    const probeMs = Math.max(1000, Number(action.timeoutMs ?? Math.min(entry.lease_s * 1000, 10000)));
    const probe = new AbortController();
    const onAbort = () => probe.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const probeTimer = setTimeout(() => probe.abort(), probeMs);
    let res;
    try {
      res = await fetch(action.http, { signal: probe.signal, method: action.method || 'GET' });
    } catch (error) {
      const timedOut = probe.signal.aborted && !(signal && signal.aborted);
      return {
        outcome: 'failed',
        detail: { url: action.http, ms: Date.now() - started, timeoutMs: probeMs },
        error: `${timedOut ? 'NO ANSWER' : 'unreachable'} within ${probeMs} ms: ${error.message}`,
      };
    } finally {
      clearTimeout(probeTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    const body = await res.text();
    const detail = { url: action.http, status: res.status, ms: Date.now() - started, bytes: body.length };
    if (!res.ok) return { outcome: 'failed', detail, error: `HTTP ${res.status}` };

    // 'Does the billboard need updating' is the normal case: the cycle looks, compares, and only moves bytes when
    // the answer changed. Hash in, hash out - no diffing HTML, no rewriting State every ten minutes for nothing.
    if (action.ifChanged) {
      const digest = createHash('sha256').update(body).digest('hex');
      const hashes = readJson(HASHES, {});
      const before = hashes[entry.id];
      detail.changed = before !== digest;
      detail.digest = digest.slice(0, 12);
      if (!detail.changed) return { outcome: 'ok', detail: { ...detail, note: 'unchanged - nothing published' } };
      hashes[entry.id] = digest;
      if (action.publish) {
        const target = await fetch(action.publish, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: entry.id, at: nowIso(), source: action.http, payload: JSON.parse(body) }),
        });
        detail.published = target.status;
        if (!target.ok) {
          delete hashes[entry.id];            // do not remember a publish that did not happen
          writeJson(HASHES, hashes);
          return { outcome: 'failed', detail, error: `publish HTTP ${target.status}` };
        }
      }
      writeJson(HASHES, hashes);
      return { outcome: 'ok', detail };
    }

    return { outcome: 'ok', detail };
  }
  // action.func is resolved by the owner's module in a later revision; refusing is better than pretending.
  return { outcome: 'skipped', detail: { reason: 'action.func is not loadable in this build - register action.http' } };
}

async function runNag(entry) {
  // A nag is a ToT node, not a message. If the DAG is unreachable the nag is recorded as failed, never as delivered.
  const tot = (entry.totUrl || process.env.PHOENIX_TOT || 'http://127.0.0.1:8135').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${tot}/api/thoughts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        title: entry.title,
        intent: entry.intent || `Phoenix nag from ${entry.owner}`,
        state: 'open',
        tags: ['nag', entry.owner],
        next: entry.next || [],
      }),
    });
    clearTimeout(timer);
    return { outcome: res.ok ? 'ok' : 'failed', detail: { tot, status: res.status } };
  } catch (error) {
    clearTimeout(timer);
    return { outcome: 'failed', detail: { tot }, error: error.message };
  }
}

// ---------------------------------------------------------------- cycle

let lastBeat = null;
let lastBeatAt = null;
let beatCount = 0;
// A shutdown abort is the ONE cancellation that must not be repaired: the cycle was told to stop, nothing is broken.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => { shuttingDown = true; setTimeout(() => process.exit(0), 300).unref(); });
}

function due(entry, clock, nowMs) {
  const trigger = entry.trigger || {};
  if (trigger.on) return false;                     // events are pushed, not polled
  const every = intervalMs(trigger.every);
  if (!every) return false;
  const last = clock[entry.id] ? Date.parse(clock[entry.id]) : 0;
  return nowMs - last >= every;
}

/**
 * A repair is a DECLARED action, never a guess. An entry that can be fixed says how, and only four kinds are honoured:
 * an HTTP call, a ProcessWrapper restart, a scheduled task, or a command through the Access agent. Anything else is
 * refused - a Phoenix that invents shell commands is a second operator, and that is not what it is for.
 */
async function runFix(entry, failed) {
  const fix = entry.fix || {};
  const why = failed?.error || failed?.outcome || 'unknown';
  if (fix.http) {
    const r = await fetch(fix.http, {
      method: fix.method || 'POST',
      headers: { 'content-type': 'application/json' },
      body: fix.body ? JSON.stringify(fix.body) : undefined,
      signal: AbortSignal.timeout(Math.max(1000, Number(fix.timeoutMs ?? 8000))),
    });
    const text = await r.text().catch(() => '');
    return { kind: 'http', ok: r.ok, status: r.status, body: text.slice(0, 300), because: why };
  }
  if (fix.pw) {
    const base = fix.pw.url || 'http://127.0.0.1:8125';
    let id = fix.pw.processId;
    if (!id && fix.pw.name) {
      const listRes = await fetch(`${base}/api/processes`, { signal: AbortSignal.timeout(4000) });
      const body = await listRes.json().catch(() => ({}));
      const rows = Array.isArray(body) ? body : body.processes || [];
      const row = rows.find((x) => x.name === fix.pw.name && ['running', 'failed'].includes(x.life));
      if (!row) return { kind: 'pw', ok: false, error: `no row named ${fix.pw.name}`, because: why };
      id = row.id;
    }
    if (!id) throw new Error('fix.pw needs processId or name');
    const r = await fetch(`${base}/api/processes/${id}/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
      signal: AbortSignal.timeout(Math.max(2000, Number(fix.timeoutMs ?? 15000))),
    });
    return { kind: 'pw', ok: r.ok, status: r.status, processId: id, because: why };
  }
  if (fix.agent) {
    const { node, cmd } = fix.agent;
    if (!node || !cmd) throw new Error('fix.agent needs node and cmd');
    const r = await fetch('http://127.0.0.1:8143/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node, cmd, timeoutSec: Number(fix.timeoutSec ?? 60) }),
      signal: AbortSignal.timeout(Math.max(5000, Number(fix.timeoutMs ?? 90000))),
    });
    const body = await r.json().catch(() => ({}));
    return { kind: 'agent', ok: r.ok && body.ok !== false, node, exitCode: body.exitCode ?? null, because: why };
  }
  if (fix.task) {
    const { name, node } = fix.task;
    if (!name) throw new Error('fix.task needs name');
    if (!node) return { kind: 'task', ok: false, error: 'a task fix must name the node it runs on', because: why };
    const r = await fetch('http://127.0.0.1:8143/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node, cmd: `schtasks /run /tn "${name}"`, timeoutSec: 60 }),
      signal: AbortSignal.timeout(90000),
    });
    const body = await r.json().catch(() => ({}));
    return { kind: 'task', ok: r.ok && body.ok !== false, node, name, because: why };
  }
  return { kind: 'none', ok: false, error: 'fix declared with no known kind (http|pw|agent|task)', because: why };
}

async function runEntry(entry) {
  const started = nowIso();
  const t0 = Date.now();
  let result;
  try {
    result = entry.kind === 'nag'
      ? await runNag(entry)
      : await withLease(entry, (signal) => runCode(entry, signal));
  } catch (error) {
    result = { outcome: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message };
  }

  // --- the standard repair rung -------------------------------------------------------------------------------
  // A wrapper that fails publishes WHY (a fixed error code) and WHAT WOULD FIX IT (`fix`). Phoenix may only do what
  // the entry declares: no guessing, no invented commands. One repair attempt per beat, then re-check. A check that
  // comes back healthy after the repair is `repaired` - it happened, it is not a page. A check that fails again keeps
  // its `failed` outcome, and the repair trail travels with it so the alert says what was already tried.
  // 'cancelled' means the check overran its lease - the thing it watches did not answer in time. That is exactly the
  // case a repair is for, so it is repairable like any failure; only a shutdown abort is left alone.
  if (result.outcome !== 'ok' && entry.fix && !shuttingDown) {
    const fixStarted = nowIso();
    let fixResult;
    try {
      fixResult = await runFix(entry, result);
    } catch (error) {
      fixResult = { ok: false, error: error.message };
    }
    const before = result.outcome;
    await new Promise((r) => setTimeout(r, Math.max(0, Number(entry.fix.waitMs ?? 4000))));
    let after;
    try {
      after = entry.kind === 'nag'
        ? await runNag(entry)
        : await withLease(entry, (signal) => runCode(entry, signal));
    } catch (error) {
      after = { outcome: 'failed', error: error.message };
    }
    result = {
      ...(after.outcome === 'ok' ? after : result),
      outcome: after.outcome === 'ok' ? 'repaired' : result.outcome,
      detail: {
        ...(after.detail || result.detail || {}),
        repair: { before, fix: fixResult, after: after.outcome, fixedAt: fixStarted, error: after.error ?? null },
      },
    };
  }

  const receipt = {
    id: entry.id,
    owner: entry.owner,
    kind: entry.kind,
    started,
    ended: nowIso(),
    ms: Date.now() - t0,
    outcome: result.outcome,
    detail: result.detail,
    error: result.error,
  };
  appendReceipt(receipt);
  return receipt;
}

/**
 * A cycle that fails an entry is a thing that happened, so it is TOLD once — through Tell Mom, with Phoenix as the
 * declared sender. Dedupe lives at the door (`phoenix.upkeep.failed`), so a beat that fails every ten minutes cannot
 * page every ten minutes. Nothing here is allowed to throw: a Tell Mom outage must not turn into a failed beat.
 */
async function tellOnFailure(receipts) {
  const bad = receipts.filter((r) => ['failed', 'refused', 'cancelled'].includes(r.outcome));
  // 'repaired' is deliberately absent: an entry Phoenix fixed this beat already told the story in its receipt.
  if (!bad.length) return null;
  const lines = bad.map((r) => `${r.id}=${r.outcome}${r.error ? ` (${r.error})` : ''}`);
  const payload = {
    severity: 'warn',
    subject: `Phoenix upkeep failed: ${bad.length} ${bad.length === 1 ? 'entry' : 'entries'}`,
    body: lines.join('\n'),
    wants: 'a look at the receipts on :8146',
    dedupeKey: 'phoenix.upkeep.failed',
    by: 'phoenix',
  };
  try {
    const res = await fetch(`${TELLMOM}/api/tell`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.status < 400, status: res.status, deduped: body?.deduped ?? null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ---------------------------------------------------------------- publish to the tier above

async function publishState(beat) {
  // ONE CLOCK. A child does not publish a beat of its own: the parent's cycle is the schedule, and a node that also
  // ticks would give Echidna two timelines to reconcile. The child's receipts stay local; its clock comes from above.
  if (!STATE_URL) return;
  const target = STATE_URL;
  const put = async (name, content) => {
    const r = await fetch(`${target}/api/state/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, content }),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) throw new Error(`${name} -> HTTP ${r.status}`);
  };
  const entries = loadRegistry();
  const isRoot = Boolean(STATE_URL);
  const cycleName = isRoot ? 'lan.cycle' : `node.${REF}.upkeep`;
  const facts = {
    tier: isRoot ? 'lan' : 'node', role: isRoot ? 'root' : 'child', ref: isRoot ? 'lan-1' : REF,
    at: beat.at, port: PORT, everyMin: EVERY_MIN, beat: beatCount,
    entries: entries.length, ran: beat.ran, reason: beat.reason,
    // repaired is its own outcome: something broke and Phoenix fixed it - that is not a failure, and it is not silence
    failed: (beat.receipts || []).filter((r) => !['ok', 'repaired'].includes(r.outcome)).length,
    repaired: (beat.receipts || []).filter((r) => r.outcome === 'repaired').length,
    nextAt: new Date(Date.now() + Math.max(0, EVERY_MIN * 60000 - (Date.now() - lastBeatAt))).toISOString(),
    source: 'Phoenix',
  };
  const jobs = [put(cycleName, facts)];
  for (const r of beat.receipts || []) {
    jobs.push(put(isRoot ? `lan.entry.${r.id}` : `node.${REF}.entry.${r.id}`, {
      at: r.ended || r.started || beat.at, outcome: r.outcome,
      ms: r.ms ?? null, error: r.error ?? null, http: r.http ?? null,
    }));
  }
  try { await Promise.all(jobs); } catch (e) { log(`state publish failed: ${e.message}`); }
  await publishReflection(facts);
}

/**
 * The root's reflection, written into every node's OWN state: same beat, same nextAt, the parent named.
 * A node that is off the wire is skipped in silence - the point of the write is the beat, not a page about a write.
 */
async function publishReflection(facts) {
  let peers = [];
  try {
    const r = await fetch(`${MIRROR}/api/lan.json`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    peers = (j.nodes || []).filter((n) => n && n.ref && n.ip).map((n) => ({ ref: n.ref, ip: n.ip }));
  } catch (e) {
    return log(`reflection: no peer list (${e.message}) - nodes keep the last beat they were given`);
  }
  const results = await Promise.all(peers.map(async (p) => {
    try {
      const r = await fetch(`http://${p.ip}:${NODE_STATE_PORT}/api/state/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `node.${p.ref}.upkeep`, content: {
          tier: 'node', role: 'child', ref: p.ref, governed: true, parent: STATE_URL, source: 'Phoenix(lan)',
          beat: facts.beat, everyMin: facts.everyMin, nextAt: facts.nextAt, at: facts.at,
          ran: facts.ran, failed: facts.failed, repaired: facts.repaired,
        } }),
        signal: AbortSignal.timeout(1500),
      });
      return { ref: p.ref, ok: r.ok, status: r.status };
    } catch (e) { return { ref: p.ref, ok: false, error: e.message }; }
  }));
  const bad = results.filter((x) => !x.ok);
  if (bad.length) log(`reflection: ${results.length - bad.length}/${results.length} written, missed ${bad.map((b) => b.ref).join(',')}`);
}

async function beat(reason = 'timer') {
  const entries = loadRegistry().filter((e) => e.enabled !== false);
  const clock = readClock();
  const now = Date.now();
  const ran = [];
  for (const entry of entries) {
    let clean;
    try { clean = validate(entry); } catch (error) {
      const receipt = { id: entry && entry.id ? entry.id : 'unknown', outcome: 'refused', error: error.message, started: nowIso(), ended: nowIso() };
      if (entry && entry.id) appendReceipt(receipt);
      ran.push(receipt);
      continue;
    }
    if (!due(clean, clock, now)) continue;
    const receipt = await runEntry(clean);
    clock[clean.id] = receipt.ended;
    writeClock(clock);
    ran.push(receipt);
  }
  lastBeat = { at: nowIso(), reason, entries: entries.length, ran: ran.length, receipts: ran };
  lastBeatAt = Date.now();
  beatCount += 1;
  if (ran.length) log(`beat ${beatCount}: ${ran.map((r) => `${r.id}=${r.outcome}`).join(' ')}`);
  // Only a beat that actually ran something can have something to say; an idle beat stays silent.
  if (ran.some((r) => ['failed', 'refused', 'cancelled'].includes(r.outcome))) {
    lastBeat.told = await tellOnFailure(ran);
    if (lastBeat.told) log(`beat ${beatCount}: told the operator (${lastBeat.told.ok ? 'sent' : 'not sent'}${lastBeat.told.deduped ? `, ${lastBeat.told.deduped}` : ''})`);
  }
  await publishState(lastBeat);
  return lastBeat;
}

// ---------------------------------------------------------------- door

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => resolve(raw));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const p = url.pathname;
  const method = req.method || 'GET';
  try {
    if (p === '/health') {
      const entries = loadRegistry();
      const nextIn = lastBeatAt ? Math.max(0, EVERY_MIN * 60000 - (Date.now() - lastBeatAt)) : 0;
      sendJson(res, 200, {
        ok: true,
        everyMin: EVERY_MIN,
        entries: entries.length,
        enabled: entries.filter((e) => e.enabled !== false).length,
        beats: beatCount,
        nextBeatInMs: nextIn,
        lastBeat,
      });
      return;
    }

    if (p === '/api/entries' && method === 'GET') {
      const rows = loadRegistry().map((entry) => ({
        id: entry.id,
        owner: entry.owner,
        kind: entry.kind,
        trigger: entry.trigger,
        enabled: entry.enabled !== false,
        last: lastReceipt(entry.id),
      }));
      sendJson(res, 200, { ok: true, count: rows.length, rows });
      return;
    }

    if (p === '/api/register' && method === 'POST') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      const entry = validate(payload);
      const raw = readJson(REGISTRY, { version: 1, entries: [] });
      raw.entries = Array.isArray(raw.entries) ? raw.entries : [];
      const at = raw.entries.findIndex((e) => e.id === entry.id);
      if (at >= 0) raw.entries[at] = entry; else raw.entries.push(entry);
      fs.writeFileSync(REGISTRY, JSON.stringify(raw, null, 2));
      sendJson(res, 200, { ok: true, entry, replaced: at >= 0 });
      return;
    }
    // AN ENTRY YOU CANNOT REMOVE IS A DECISION YOU CANNOT REVERSE. Registering was the only verb, so a superseded check
    // lived in the cycle for ever and its failing receipt had to be explained by hand each time it came round.
    if (p === '/api/unregister' && method === 'POST') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      const id = String(payload.id || '').trim();
      const raw = readJson(REGISTRY, { version: 1, entries: [] });
      const before = Array.isArray(raw.entries) ? raw.entries.length : 0;
      raw.entries = (raw.entries || []).filter((e) => e.id !== id);
      if (raw.entries.length === before) { sendJson(res, 404, { ok: false, error: `no such entry: ${id}` }); return; }
      fs.writeFileSync(REGISTRY, JSON.stringify(raw, null, 2));
      try { const clock = readJson(CLOCK, {}); delete clock[id]; fs.writeFileSync(CLOCK, JSON.stringify(clock, null, 2)); } catch { /* the clock line dies with the entry or not at all */ }
      sendJson(res, 200, { ok: true, removed: id, entries: raw.entries.length });
      return;
    }
    // TURNING ONE OFF IS NOT DELETING IT: `enabled:false` keeps the entry and its history, and the beat skips it.
    if (p === '/api/enable' && method === 'POST') {
      const payload = JSON.parse((await readBody(req)) || '{}');
      const id = String(payload.id || '').trim();
      const raw = readJson(REGISTRY, { version: 1, entries: [] });
      const entry = (raw.entries || []).find((e) => e.id === id);
      if (!entry) { sendJson(res, 404, { ok: false, error: `no such entry: ${id}` }); return; }
      entry.enabled = payload.enabled !== false;
      fs.writeFileSync(REGISTRY, JSON.stringify(raw, null, 2));
      sendJson(res, 200, { ok: true, entry });
      return;
    }

    // ARE THE CHILDREN ON MY VERSION? One answer for the whole fleet, because the honest alternative is asking eight
    // boxes by hand and comparing strings. Missing build = not on this version (a node that never reported cannot
    // match), and a dirty tree is called out: "same commit" is not the same code if the files on disk differ.
    // ── VERSION SYNC: match the number, act on the difference, remember the answer ───────────────────────────────────
    // One entry in the cycle calls this. It is NOT a fetch loop: it compares this instance's build against what each
    // managed node last said, remembers that in data/versions.json, and only asks a node again when the memory has aged
    // out or when it has just told that node to update (because then the answer is known to be stale).
    if ((p === '/api/version/sync' && (method === 'GET' || method === 'POST')) || (p === '/api/version/memory' && method === 'GET')) {
      const ttlMin = Number(argOf('version-ttl-min', process.env.PHOENIX_VERSION_TTL_MIN ?? 720)) || 720;
      const retriggerMin = Number(process.env.PHOENIX_VERSION_RETRIGGER_MIN ?? 30) || 30;
      const mem = readVersions();
      const own = BUILD.rev;
      if (p === '/api/version/memory') { sendJson(res, 200, { ok: true, own, ...mem }); return; }

      let peers = [];
      try {
        const j = await (await fetch(`${MIRROR}/api/lan.json`, { signal: AbortSignal.timeout(6000) })).json();
        peers = (j.nodes || []).filter((n) => n && n.ref && n.ip && n.hydra !== false).map((n) => ({ ref: n.ref, ip: n.ip }));
      } catch (e) { sendJson(res, 503, { ok: false, error: `mirror unreachable: ${e.message}`, own }); return; }

      const noAnswerMin = Number(process.env.PHOENIX_VERSION_NOANSWER_MIN ?? 30) || 30;
      const now = Date.now();
      // "nobody answered" is itself an answer worth remembering - otherwise five machines with no door are re-asked every
      // ten minutes for the rest of the year, and a cycle that talks to the void is a cycle nobody trusts.
      const fresh = (row) => {
        if (!row) return false;
        if (row.rev) return row.at && now - Date.parse(row.at) < ttlMin * 60000;
        return row.askedAt && now - Date.parse(row.askedAt) < noAnswerMin * 60000;
      };
      const asked = [], remembered = [], triggered = [], still = [], notes = [];
      mem.nodes = mem.nodes || {};

      for (const peer of peers) {
        const row = mem.nodes[peer.ref];
        if (fresh(row)) { remembered.push({ ref: peer.ref, rev: row.rev, ageMin: Math.round((now - Date.parse(row.at)) / 60000) }); }
        else {
          // ask the node: its own version fact, then its build stamp - two names because they arrive at different times
          let rev = null, err = null;
          for (const name of [`node.${peer.ref}.version`, `node.${peer.ref}.build`]) {
            try {
              const r = await fetch(`http://${peer.ip}:${NODE_STATE_PORT}/api/state/pull?name=${name}`, { signal: AbortSignal.timeout(2000) });
              const j = await r.json().catch(() => null);
              const c = j?.content ?? null;
              if (c && (c.remote || c.local || c.rev)) { rev = c.remote || c.local || c.rev; break; }
            } catch (e) { err = e.message; }
          }
          mem.nodes[peer.ref] = { rev, at: new Date().toISOString(), askedAt: new Date().toISOString(), error: err };
          asked.push({ ref: peer.ref, rev, error: err });
        }
        const rev = mem.nodes[peer.ref]?.rev ?? null;
        if (!rev) { still.push({ ref: peer.ref, why: 'no version reported' }); continue; }
        if (rev === own) continue;

        // out of sync: trigger THAT NODE's own update, which is a logged event on its own door, not a push from here
        const last = mem.nodes[peer.ref]?.triggeredAt ? Date.parse(mem.nodes[peer.ref].triggeredAt) : 0;
        if (now - last < retriggerMin * 60000) { still.push({ ref: peer.ref, rev, why: 'triggered recently, waiting' }); continue; }
        try {
          const r = await fetch(`http://${peer.ip}:8126/api/events/trigger`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'version.pull', source: 'process', payload: { asked_by: `phoenix:${own}`, from: rev, to: own } }),
            signal: AbortSignal.timeout(5000),
          });
          const j = await r.json().catch(() => ({}));
          mem.nodes[peer.ref].triggeredAt = new Date().toISOString();
          mem.nodes[peer.ref].triggerOutcome = r.ok ? 'asked' : `refused ${r.status}${j?.error?.code ? ' ' + j.error.code : ''}`;
          if (r.ok) {
            triggered.push({ ref: peer.ref, from: rev, to: own });
            // the node is about to change, so what we remember is now a lie: force a re-read next cycle
            delete mem.nodes[peer.ref].at;
            if (mem.nodes[peer.ref].rev) mem.nodes[peer.ref].rev = rev;
          } else {
            still.push({ ref: peer.ref, rev, why: mem.nodes[peer.ref].triggerOutcome });
          }
        } catch (e) {
          mem.nodes[peer.ref].triggeredAt = new Date().toISOString();
          mem.nodes[peer.ref].triggerOutcome = `no door: ${e.message}`;
          still.push({ ref: peer.ref, rev, why: mem.nodes[peer.ref].triggerOutcome });
        }
      }

      mem.at = new Date().toISOString();
      mem.own = { rev: own, dirty: BUILD.dirty, at: mem.at };
      writeVersions(mem);
      const verdict = triggered.length
        ? `${triggered.length} node(s) told to update: ${triggered.map((t) => `${t.ref} ${t.from}->${t.to}`).join(', ')}`
        : `in sync with ${own}` + (still.length ? `; ${still.length} unresolved (${still.map((x) => x.ref).join(', ')})` : '');
      sendJson(res, 200, { ok: true, own, asked: asked.length, remembered: remembered.length, triggered, still, notes, verdict });
      return;
    }
    if (p === '/api/versions' && method === 'GET') {
      let peers = [];
      let sshOnly = [];
      try {
        const r = await fetch(`${MIRROR}/api/lan.json`, { signal: AbortSignal.timeout(2500) });
        const j = await r.json();
        // Three kinds of box, and the check has to tell them apart or it becomes noise:
        //   hydra:false   ssh-monitored, no modules at all (Richard, miner1, Daedalus) - never versioned
        //   hydra:true    must report a build; silence while it is on the wire is a real gap
        //   hydra:null    nobody declared it, so nothing is expected of it either way
        peers = (j.nodes || [])
          .filter((n) => n && n.ref && n.ip && n.hydra !== false)
          .map((n) => ({ ref: n.ref, ip: n.ip, onWire: n.verdict !== 'gone' && n.verdict !== 'unknown', hydra: n.hydra }));
        sshOnly = (j.nodes || []).filter((n) => n && n.ref && n.hydra === false).map((n) => n.ref);
      } catch { peers = []; }
      const rows = await Promise.all(peers.map(async (peer) => {
        try {
          const r = await fetch(`http://${peer.ip}:${NODE_STATE_PORT}/api/state/pull?name=node.${peer.ref}.build`, { signal: AbortSignal.timeout(1500) });
          const j = await r.json();
          const b = j?.content || null;
          return { ref: peer.ref, rev: b?.rev ?? null, at: b?.at ?? null, dirty: b?.dirty ?? null,
                   hydra: peer.hydra, onWire: peer.onWire, match: !!b && b.rev === BUILD.rev };
        } catch (e) { return { ref: peer.ref, rev: null, error: e.message, hydra: peer.hydra, onWire: peer.onWire, match: false }; }
      }));
      // TWO DIFFERENT FACTS, and conflating them makes a check nobody can leave switched on:
      //   SKEW    a node published a build and it is not mine  -> a real fault, this is what the entry fails on
      //   ABSENT  a node never published a build               -> it is not running this line of code at all, which the
      //           Menu already shows as "no state door". Paging every ten minutes about it would be noise, not news.
      // SKEW     reported a build and it is not mine                      -> failure
      // SILENT   declared (or visibly) a Hydra node, reports no build     -> failure: it is not running this code
      // QUIET    nobody declared it and it is not on the wire              -> reported, not a failure
      // SSH-ONLY hydra:false from the roster (Richard, miner1, Daedalus)   -> never versioned, listed for the record
      const skew = rows.filter((x) => x.rev && !x.match);
      const silent = rows.filter((x) => !x.rev && (x.hydra === true || x.onWire === true));
      const quiet = rows.filter((x) => !x.rev && !(x.hydra === true || x.onWire === true));
      const bad = skew.length + silent.length;
      const parts = [];
      if (skew.length) parts.push(`skew: ${skew.map((b) => `${b.ref}@${b.rev}`).join(', ')}`);
      if (silent.length) parts.push(`not reporting: ${silent.map((b) => b.ref).join(', ')}`);
      const verdict = (bad ? `${bad} node(s) off build ${BUILD.rev}` : `no skew - ${rows.length - skew.length - silent.length - quiet.length} of ${rows.length} on ${BUILD.rev}`)
        + (parts.length ? ' · ' + parts.join(' · ') : '')
        + (quiet.length ? ` · undeclared and silent: ${quiet.map((b) => b.ref).join(', ')}` : '')
        + (sshOnly.length ? ` · ssh-only, not versioned: ${sshOnly.join(', ')}` : '');
      sendJson(res, bad ? 503 : 200, {
        ok: bad === 0, own: BUILD, nodes: rows, mismatch: skew.length, silent: silent.length, silentRefs: silent.map((b) => b.ref),
        sshOnly, verdict,
      });
      return;
    }

    if (p === '/api/tick' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const result = await beat(body.reason || 'manual');
      sendJson(res, 200, { ok: true, result });
      return;
    }

    if (p === '/api/receipts' && method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const limit = Math.min(100, Number(url.searchParams.get('limit') || 20) || 20);
        let lines = [];
        try { lines = fs.readFileSync(receiptPath(id), 'utf8').trim().split('\n').slice(-limit); } catch {}
        sendJson(res, 200, { ok: true, id, receipts: lines.map((l) => JSON.parse(l)) });
        return;
      }
      const ids = loadRegistry().map((e) => e.id);
      sendJson(res, 200, { ok: true, entries: ids, last: Object.fromEntries(ids.map((i) => [i, lastReceipt(i)])) });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'no such path', paths: ['/health', '/api/entries', '/api/register', '/api/unregister', '/api/enable', '/api/tick', '/api/receipts', '/api/version/sync', '/api/version/memory'] });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
});

async function publishBuild() {
  try {
    await fetch(`${NODE_STATE_URL}/api/state/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `node.${REF}.build`, content: { ...BUILD, role: STATE_URL ? 'root' : 'child', everyMin: EVERY_MIN } }),
      signal: AbortSignal.timeout(1500),
    });
  } catch (e) { log(`build publish failed: ${e.message}`); }
}

server.listen(PORT, HOST, () => {
  const entries = loadRegistry();
  log(`door up: http://${HOST}:${PORT}`);
  log(`registry: ${REGISTRY} (${entries.length} entries)`);
  log(`heartbeat: every ${EVERY_MIN}m`);
  publishBuild();
  setTimeout(() => { beat('startup').catch((e) => log('startup beat failed:', e.message)); }, 2000);
  setInterval(() => { beat('timer').catch((e) => log('beat failed:', e.message)); }, EVERY_MIN * 60000);
});
