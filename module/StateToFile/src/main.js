#!/usr/bin/env node
/**
 * State to file — the snapshot writer.
 *
 * State is memory-only on purpose: it boots blank, it holds what it is handed, and a registration dies with its
 * registrant. That property is what makes the house easy to reason about, and it is also why a cold boot with no peers
 * has nothing to point at. This door is the answer to that and nothing more: it subscribes to the registry's change
 * feed and keeps ONE file of what the registry said, so a node that boots into an empty room can be handed the phone
 * book back.
 *
 * What it writes is a SNAPSHOT, not a database:
 *   - the file is never the truth; the registry is. A replay is a seed that any live owner overwrites.
 *   - entries carry `updatedAt` and the writing node's ref, so a reader can refuse something older than its owner.
 *   - the write is atomic (tmp + rename) and the file is namespaced per writer, so a torn write is a fact the reader
 *     can see (parse error + path), never a half-loaded LAN.
 *   - it prefers the change feed and falls back to a poll when the feed is not there; both debounce, because a
 *     registry that ticks every 5 seconds must not mean a disk write every 5 seconds.
 *
 *   node src/main.js --port 8151 --state http://127.0.0.1:8127 --file C:/AI/hydra-local/data/state-snapshot.123.json
 *                   --query node --query root --every 60
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
const argAll = (name) => {
  const out = [];
  process.argv.forEach((a, i) => { if (a === '--' + name && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
};

const PORT = Number(argOf('port', process.env.STF_PORT ?? 8151));
const HOST = argOf('host', process.env.STF_HOST ?? '127.0.0.1');
const STATE = String(argOf('state', process.env.STF_STATE ?? 'http://127.0.0.1:8127')).replace(/\/$/, '');
const EVERY_S = Math.max(5, Number(argOf('every', process.env.STF_EVERY_S ?? 60)) || 60);
const DEBOUNCE_MS = Math.max(250, Number(argOf('debounce-ms', process.env.STF_DEBOUNCE_MS ?? 1500)) || 1500);
const QUERIES = argAll('query').length ? argAll('query') : (process.env.STF_QUERY ? String(process.env.STF_QUERY).split(',') : ['node', 'root']);

function refOf() {
  const given = argOf('node-ref', process.env.HYDRA_REF ?? null);
  if (given) return String(given).toLowerCase();
  for (const f of ['data/node.json', '../Menu/data/node.json', '../StateResolver/data/node.json']) {
    const p = path.resolve(process.cwd(), f);
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); if (j.ref) return String(j.ref).toLowerCase(); } catch { /* no identity */ }
  }
  return os.hostname().toLowerCase();
}
const REF = refOf();

const FILE = String(argOf('file', process.env.STF_FILE ?? path.join(path.resolve(process.cwd(), 'data'), `state-snapshot.${REF}.json`)));

const stats = { writes: 0, lastWrite: null, lastError: null, lastCount: 0, feed: 'not tried', source: STATE, file: FILE };

async function withTimeout(url, init = {}, timeoutMs = 1200) {
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

/** One pull per name, because the active set lists SHAPE and never contents. */
export async function collect() {
  const entries = [];
  for (const q of QUERIES) {
    const set = await withTimeout(`${STATE}/api/state?q=${encodeURIComponent(q)}`, {}, 1500);
    if (!set.ok) return { ok: false, why: set.error === 'timeout' ? 'timeout' : 'unreachable', detail: `${STATE} ${q}` };
    for (const row of set.body?.entries ?? []) {
      const got = await withTimeout(`${STATE}/api/state/pull?name=${encodeURIComponent(row.path)}`, {}, 1200);
      if (!got.ok) continue; // an entry that vanished between list and pull is not an error, it is a race
      entries.push({
        name: row.path,
        content: got.body?.content ?? null,
        serving: row.serving ?? {},
        updatedAt: row.updatedAt ?? null,
      });
    }
  }
  return { ok: true, entries };
}

export async function writeSnapshot(reason = 'timer') {
  const got = await collect();
  if (!got.ok) {
    stats.lastError = `${got.why} ${got.detail}`;
    return { ok: false, ...got };
  }
  const doc = {
    version: 1,
    kind: 'state-snapshot',
    writtenBy: REF,
    at: new Date().toISOString(),
    reason,
    source: STATE,
    queries: QUERIES,
    count: got.entries.length,
    entries: got.entries,
  };
  const text = JSON.stringify(doc, null, 1);
  const tmp = `${FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, FILE); // atomic: a reader either sees the old file or the new one, never half of either
  } catch (e) {
    stats.lastError = `write failed: ${e.message}`;
    try { fs.unlinkSync(tmp); } catch { /* it may not exist */ }
    return { ok: false, why: 'write_failed', detail: e.message };
  }
  stats.writes += 1;
  stats.lastWrite = doc.at;
  stats.lastCount = doc.count;
  stats.lastError = null;
  return { ok: true, at: doc.at, count: doc.count, bytes: Buffer.byteLength(text) };
}

// ---- the change feed: subscribe when it exists, poll when it does not -------------------------------------------------
let debounce = null;
const scheduleWrite = (reason) => {
  if (debounce) return;
  debounce = setTimeout(() => { debounce = null; writeSnapshot(reason).catch(() => null); }, DEBOUNCE_MS);
};

async function followFeed() {
  try {
    const res = await fetch(`${STATE}/api/state/stream`);
    if (!res.ok || !res.body) throw new Error(`feed ${res.status}`);
    stats.feed = 'subscribed';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      const text = decoder.decode(chunk, { stream: true });
      if (text.includes('event:') || text.includes('data:')) scheduleWrite('change');
    }
    stats.feed = 'feed closed';
  } catch (e) {
    stats.feed = `unavailable (${e.message}) - polling`;
  }
  // the poll fallback is also the safety net when a feed silently stops
  setInterval(() => scheduleWrite('timer'), EVERY_S * 1000);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    const text = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  if (url.pathname === '/health') return send(200, { ok: true, door: 'state-to-file', ref: REF, ...stats, everyS: EVERY_S, debounceMs: DEBOUNCE_MS, queries: QUERIES });
  if (url.pathname === '/api/snapshot' && req.method === 'POST') return send(200, await writeSnapshot('asked'));
  if (url.pathname === '/api/file') {
    try {
      const text = fs.readFileSync(FILE, 'utf8');
      return send(200, { ok: true, file: FILE, bytes: Buffer.byteLength(text), head: text.slice(0, 400) });
    } catch (e) {
      return send(200, { ok: false, file: FILE, why: e.code === 'ENOENT' ? 'no snapshot yet' : e.message });
    }
  }
  return send(404, { ok: false, why: 'no_route', detail: `${url.pathname} - this door serves /health, POST /api/snapshot, GET /api/file` });
});

export function start() {
  server.on('error', (e) => { console.error(`[state-to-file] cannot serve on :${PORT} - ${e.code || e.message}`); process.exit(1); });
  server.listen(PORT, HOST, async () => {
    console.log(`[state-to-file] ${REF} on ${HOST}:${PORT} - state ${STATE} -> ${FILE}`);
    console.log(`[state-to-file] queries ${QUERIES.join(',')} · every ${EVERY_S}s · debounce ${DEBOUNCE_MS}ms`);
    const first = await writeSnapshot('boot');
    console.log(`[state-to-file] first snapshot: ${first.ok ? `${first.count} entries, ${first.bytes} bytes` : `FAILED ${first.why}`}`);
    void followFeed();
  });
}

// start only when run as a program: a test imports collect/writeSnapshot without binding a port
// start only when this file IS the program: path equality, not a filename tail match - a test that sets argv
// to 'main.js' used to trip a suffix check and bind the real port during a unit test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
