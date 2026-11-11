#!/usr/bin/env node
/**
 * The gate for State from file.
 *
 *   node selftest.mjs
 *
 * Two halves. The first is pure: what the reader does with a file it cannot trust (missing, torn, wrong shape, too
 * old) and which lines it refuses to speak for (a role, a live owner). The second is real: a fake registry on a port,
 * a snapshot on disk, and the replay landing entries through the actual route.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sff-'));
const fileOf = (name) => path.join(dir, name);
const write = (name, body) => { fs.writeFileSync(fileOf(name), typeof body === 'string' ? body : JSON.stringify(body, null, 1)); return fileOf(name); };

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
      if (url.pathname === '/api/state/register' && req.method === 'POST') {
        const doc = JSON.parse(body || '{}');
        store.set(doc.name, doc.content);
        return json(200, { ok: true, name: doc.name });
      }
      if (url.pathname === '/api/state') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const rows = [...store.keys()].filter((n) => n.toLowerCase().includes(q)).map((n) => ({ path: n, shape: [] }));
        return json(200, { ok: true, entries: rows });
      }
      return json(404, { ok: false });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}`, store, close: () => new Promise((r) => server.close(r)) });
  }));
}

async function main() {
  console.log('state from file — selftest');
  const { loadSnapshot, plan } = await import('./src/main.js');

  // ---- the file it cannot trust
  const missing = loadSnapshot(fileOf('nope.json'));
  ok('a missing file is "no_file", never an empty state', missing.ok === false && missing.why === 'no_file', JSON.stringify(missing));
  const torn = loadSnapshot(write('torn.json', '{"kind":"state-snapshot","entries":[{"name":'));
  ok('a torn file is bad_json with the path', torn.ok === false && torn.why === 'bad_json' && torn.file === fileOf('torn.json'), JSON.stringify(torn.why));
  const wrong = loadSnapshot(write('wrong.json', { hello: 'world' }));
  ok('a file that is not a snapshot is refused, not guessed', wrong.ok === false && wrong.why === 'not_a_snapshot');
  const old = loadSnapshot(write('old.json', { kind: 'state-snapshot', at: '2020-01-01T00:00:00Z', entries: [{ name: 'node.a', content: { x: 1 } }] }), { maxAgeH: 1 });
  ok('a snapshot past its age limit is refused with the age', old.ok === false && old.why === 'too_old' && /h old/.test(old.detail), old.detail);
  const good = loadSnapshot(write('good.json', { kind: 'state-snapshot', at: new Date().toISOString(), writtenBy: '123', entries: [{ name: 'node.a', content: { x: 1 } }, { name: '', content: {} }, { name: 'node.b' }] }));
  ok('a good file loads, and nameless/contentless lines are dropped', good.ok === true && good.entries.length === 1 && good.dropped === 2, JSON.stringify({ n: good.entries.length, dropped: good.dropped }));

  // ---- what it refuses to speak for
  const entries = [
    { name: 'node.gvtx980', content: { kind: 'link', to: 'http://192.168.1.134:8127' } },
    { name: 'node.gvtx980.cycle', content: { cycle: 99 } },
    { name: 'node.robert.cycle', content: { cycle: 4 } },
    { name: 'root.claim', content: { ref: 'robert', leaseUntil: Date.now() + 9999 } },
    { name: 'node.123.id', content: { ref: '123' } },
  ];
  const p1 = plan(entries, { live: new Set(['gvtx980']) });
  ok("a live owner's VALUES are not overwritten by a file", !p1.keep.some((e) => e.name === 'node.gvtx980.cycle'), JSON.stringify(p1.keep.map((e) => e.name)));
  ok('  …but its LINK is replayed: that is the address, not a value', p1.keep.some((e) => e.name === 'node.gvtx980'));
  ok('  …and the file still speaks for a node that is asleep', p1.keep.some((e) => e.name === 'node.robert.cycle'));
  ok('a role is not restored from a file', !p1.keep.some((e) => e.name === 'root.claim'));
  ok('  …and it says why', p1.skipped.some((s) => s.name === 'root.claim' && /earned/.test(s.why)), JSON.stringify(p1.skipped));
  const p2 = plan(entries, { live: new Set(), replayClaims: true });
  ok('a claim CAN be replayed when the operator asks for it', p2.keep.some((e) => e.name === 'root.claim'));

  // ---- the replay, through the real route
  const reg = await fakeState();
  process.argv = [process.argv[0], 'main.js', '--state', reg.base, '--file', fileOf('replay.json'), '--node-ref', '123'];
  const replayMod = await import('./src/main.js?replay=1');
  const snap = write('replay2.json', { kind: 'state-snapshot', at: new Date().toISOString(), writtenBy: '123', entries: [
    { name: 'node.gvtx980', content: { kind: 'link', to: 'http://192.168.1.134:8127' } },
    { name: 'node.robert.cycle', content: { cycle: 4 } },
    { name: 'root.claim', content: { ref: 'robert', leaseUntil: Date.now() + 9999 } },
  ] });
  fs.copyFileSync(snap, fileOf('replay.json'));
  const dry = await replayMod.replay({ dryRun: true });
  ok('a dry run registers nothing', dry.ok === true && dry.wouldRegister === 2 && reg.store.size === 0, JSON.stringify({ n: dry.wouldRegister, stored: reg.store.size }));
  const real = await replayMod.replay();
  ok('a replay registers the links and the asleep values', real.ok === true && real.registered === 2 && reg.store.has('node.gvtx980') && reg.store.has('node.robert.cycle'), JSON.stringify(real));
  ok('  …and leaves the role alone', !reg.store.has('root.claim') && real.skipped.some((s) => s.name === 'root.claim'));

  await reg.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nState from file - the gate: ${pass} passed / ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
