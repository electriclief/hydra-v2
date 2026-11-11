#!/usr/bin/env node
/**
 * State from file — the snapshot reader.
 *
 * The other half of StateToFile. A node that boots into an empty room (no peers answering, a registry that has just
 * started) can be handed the phone book back: one file, replayed into the registry as registrations, so the pointer
 * table exists before the first peer answers.
 *
 * The rules that keep this from becoming a database with extra steps:
 *
 *   1. A REPLAY IS A SEED, NOT A TRUTH. It registers entries; it never deletes, never overwrites a live owner, and the
 *      live registry wins the moment its owner publishes again.
 *   2. A LIVE OWNER IS NOT RESTORED. If `node.<ref>.cycle` is already in the registry, that ref is awake and every
 *      `node.<ref>.*` line from the file is skipped — a replayed heartbeat would be a fabricated "alive".
 *   3. A ROLE IS NOT RESTORED. `root.*` is skipped unless --replay-claims is passed: holding the root is earned by
 *      booting and renewing a lease, never inherited from a file.
 *   4. A TORN FILE IS A FACT. Unreadable or malformed -> `ok:false` with the path and the reason. It is never an empty
 *      LAN, because an empty answer reads as "nothing to do" and hides the problem.
 *
 *   node src/main.js --port 8152 --state http://127.0.0.1:8127 --file C:/AI/hydra-local/data/state-snapshot.123.json
 *                   --auto
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes('--' + name);

const PORT = Number(argOf('port', process.env.SFF_PORT ?? 8152));
const HOST = argOf('host', process.env.SFF_HOST ?? '127.0.0.1');
const STATE = String(argOf('state', process.env.SFF_STATE ?? 'http://127.0.0.1:8127')).replace(/\/$/, '');
const FILE = String(argOf('file', process.env.SFF_FILE ?? path.join(path.resolve(process.cwd(), 'data'), 'state-snapshot.json')));
const AUTO = has('auto') || process.env.SFF_AUTO === '1';
const REPLAY_CLAIMS = has('replay-claims') || process.env.SFF_REPLAY_CLAIMS === '1';
const MAX_AGE_H = Number(argOf('max-age-h', process.env.SFF_MAX_AGE_H ?? 0)) || 0;

const REF = (() => {
  const given = argOf('node-ref', process.env.HYDRA_REF ?? null);
  return given ? String(given).toLowerCase() : os.hostname().toLowerCase();
})();

const stats = { replays: 0, last: null, lastError: null, file: FILE, source: STATE };

async function withTimeout(url, init = {}, timeoutMs = 1500) {
  const ctl = new AbortController();
  let timer = null;
  const stop = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve({ ok: false, status: 0, body: null, error: 'timeout' }); }, timeoutMs); });
  const work = (async () => {
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null, error: e.name === 'AbortError' ? 'timeout' : String(e.message) };
    }
  })();
  try { return await Promise.race([work, stop]); } finally { clearTimeout(timer); }
}

/** Read the file. Every failure is a typed reason with the path, never an empty result. */
export function loadSnapshot(file, { maxAgeH = 0, now = Date.now() } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { ok: false, why: e.code === 'ENOENT' ? 'no_file' : 'unreadable', detail: e.message, file, entries: [] };
  }
  let doc;
  try { doc = JSON.parse(text); } catch (e) {
    return { ok: false, why: 'bad_json', detail: e.message, file, entries: [] };
  }
  if (!doc || doc.kind !== 'state-snapshot' || !Array.isArray(doc.entries)) {
    return { ok: false, why: 'not_a_snapshot', detail: 'expected {kind:"state-snapshot", entries:[]}', file, entries: [] };
  }
  if (maxAgeH > 0 && doc.at) {
    const ageH = (now - Date.parse(doc.at)) / 3_600_000;
    if (Number.isFinite(ageH) && ageH > maxAgeH) {
      return { ok: false, why: 'too_old', detail: `${ageH.toFixed(1)}h old, limit ${maxAgeH}h`, file, entries: [], at: doc.at };
    }
  }
  const entries = doc.entries.filter((e) => e && typeof e.name === 'string' && e.name && e.content !== undefined);
  return { ok: true, file, at: doc.at, writtenBy: doc.writtenBy, source: doc.source, entries, dropped: doc.entries.length - entries.length };
}

/** Which refs are awake in the registry right now — read from their own `<ref>.cycle` entry. */
async function liveRefs() {
  const set = await withTimeout(`${STATE}/api/state?q=node`, {}, 1500);
  const refs = new Set();
  for (const row of set.ok ? set.body?.entries ?? [] : []) {
    const m = /^node\.([^.]+)\.cycle$/.exec(row.path);
    if (m) refs.add(m[1].toLowerCase());
  }
  return refs;
}

/**
 * Decide, per entry, whether the file may speak for it. Pure enough to test: the caller supplies the live set and the
 * replay options, and gets back what would be registered and why the rest would not.
 */
export function plan(entries, { live = new Set(), replayClaims = false } = {}) {
  const keep = [];
  const skipped = [];
  for (const entry of entries) {
    const name = String(entry.name ?? '');
    // `node.<ref>` with nothing after it is the ADDRESS of that node; `node.<ref>.<anything>` is a value it owns.
    const owner = /^node\.([^.]+)(?:\.|$)/.exec(name)?.[1]?.toLowerCase() ?? null;
    const isLink = entry.content && entry.content.kind === 'link';
    if (name.startsWith('root.')) {
      skipped.push({ name, why: replayClaims ? null : 'a role is earned, not restored' });
      if (replayClaims) keep.push(entry);
      continue;
    }
    if (owner && live.has(owner) && !isLink) { skipped.push({ name, why: `owner ${owner} is awake` }); continue; }
    if (entry.content === null) { skipped.push({ name, why: 'no content to replay' }); continue; }
    keep.push(entry);
  }
  return { keep, skipped: skipped.filter((s) => s.why) };
}

export async function replay({ dryRun = false } = {}) {
  const snap = loadSnapshot(FILE, { maxAgeH: MAX_AGE_H });
  if (!snap.ok) {
    stats.lastError = `${snap.why} ${snap.file}`;
    return { ok: false, ...snap, dryRun };
  }
  const live = await liveRefs();
  const { keep, skipped } = plan(snap.entries, { live, replayClaims: REPLAY_CLAIMS });

  if (dryRun) return { ok: true, dryRun: true, file: snap.file, at: snap.at, wouldRegister: keep.length, skipped, entries: keep.map((e) => e.name) };

  let registered = 0;
  const failed = [];
  for (const entry of keep) {
    const res = await withTimeout(`${STATE}/api/state/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: entry.name, content: entry.content, ...(entry.serving && Object.keys(entry.serving).length ? { serving: entry.serving } : {}) }),
    }, 1500);
    if (res.ok) registered += 1;
    else failed.push({ name: entry.name, why: res.error || `status ${res.status}` });
  }
  stats.replays += 1;
  stats.last = { at: new Date().toISOString(), registered, skipped: skipped.length, failed: failed.length };
  stats.lastError = failed.length ? `${failed.length} failed` : null;
  return { ok: failed.length === 0, file: snap.file, snapshotAt: snap.at, registered, skipped, failed };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  if (url.pathname === '/health') {
    let present = false;
    try { present = fs.statSync(FILE).size > 0; } catch { /* absent is a fact, reported below */ }
    return send(200, { ok: true, door: 'state-from-file', ref: REF, ...stats, filePresent: present, auto: AUTO, replayClaims: REPLAY_CLAIMS, maxAgeH: MAX_AGE_H });
  }
  if (url.pathname === '/api/preview') return send(200, await replay({ dryRun: true }));
  if (url.pathname === '/api/replay' && (req.method === 'POST' || req.method === 'GET')) {
    let dryRun = url.searchParams.get('dryRun') === '1';
    if (req.method === 'POST') {
      const body = await new Promise((resolve) => { let t = ''; req.on('data', (c) => { t += c; }); req.on('end', () => { try { resolve(t ? JSON.parse(t) : {}); } catch { resolve({}); } }); });
      if (body && body.dryRun) dryRun = true;
    }
    return send(200, await replay({ dryRun }));
  }
  return send(404, { ok: false, why: 'no_route', detail: `${url.pathname} - this door serves /health, GET /api/preview, POST /api/replay` });
});

export function start() {
  server.on('error', (e) => { console.error(`[state-from-file] cannot serve on :${PORT} - ${e.code || e.message}`); process.exit(1); });
  server.listen(PORT, HOST, async () => {
    console.log(`[state-from-file] ${REF} on ${HOST}:${PORT} - ${FILE} -> ${STATE}`);
    if (!AUTO) { console.log('[state-from-file] idle: no --auto, replay on request only'); return; }
    const first = await replay();
    console.log(`[state-from-file] boot replay: ${first.ok ? `${first.registered} registered, ${first.skipped?.length ?? 0} skipped` : `FAILED ${first.why}`}`);
  });
}

// start only when this file IS the program: path equality, not a filename tail match - a test that sets argv
// to 'main.js' used to trip a suffix check and bind the real port during a unit test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
