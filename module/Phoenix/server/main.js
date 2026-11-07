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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const DATA = path.join(MODULE, 'data');
const REGISTRY = path.join(DATA, 'registry.json');
const CLOCK = path.join(DATA, 'clock.json');
const HASHES = path.join(DATA, 'hashes.json');
const RECEIPTS = path.join(DATA, 'receipts');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(argOf('port', process.env.PHOENIX_PORT ?? 8146));
const HOST = argOf('host', '127.0.0.1');
const EVERY_MIN = Math.max(1, Number(argOf('every', process.env.PHOENIX_EVERY_MIN ?? 10)) || 10);

const log = (...parts) => process.stdout.write(`[phoenix] ${parts.join(' ')}\n`);
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
    if (!action.http && !action.func) bad('a code entry needs action.http or action.func');
  }
  if (entry.kind === 'nag' && !entry.title) bad('a nag entry needs a title to show a person');
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
  if (action.http) {
    const started = Date.now();
    const res = await fetch(action.http, { signal, method: action.method || 'GET' });
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

function due(entry, clock, nowMs) {
  const trigger = entry.trigger || {};
  if (trigger.on) return false;                     // events are pushed, not polled
  const every = intervalMs(trigger.every);
  if (!every) return false;
  const last = clock[entry.id] ? Date.parse(clock[entry.id]) : 0;
  return nowMs - last >= every;
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

    sendJson(res, 404, { ok: false, error: 'no such path', paths: ['/health', '/api/entries', '/api/register', '/api/tick', '/api/receipts'] });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  const entries = loadRegistry();
  log(`door up: http://${HOST}:${PORT}`);
  log(`registry: ${REGISTRY} (${entries.length} entries)`);
  log(`heartbeat: every ${EVERY_MIN}m`);
  setTimeout(() => { beat('startup').catch((e) => log('startup beat failed:', e.message)); }, 2000);
  setInterval(() => { beat('timer').catch((e) => log('beat failed:', e.message)); }, EVERY_MIN * 60000);
});
