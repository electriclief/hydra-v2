#!/usr/bin/env node
/**
 * The gate for State to file. A real registry on a real port (fake but speaking the same two routes), a real file on
 * disk, and the writer imported with argv pointing at both.
 *
 *   node selftest.mjs
 *
 * What is being proved: the snapshot contains what the registry held, it is written atomically (no .tmp left behind),
 * a registry that is not answering is a typed failure rather than an empty snapshot, and a second write replaces the
 * file instead of appending to it.
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

function fakeState(entries) {
  const store = new Map(Object.entries(entries));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
    };
    if (url.pathname === '/api/state/pull') {
      const name = url.searchParams.get('name');
      if (store.has(name)) return json(200, { ok: true, name, content: store.get(name), marks: {} });
      return json(404, { ok: false, error: { code: 'no_such_entry' } });
    }
    if (url.pathname === '/api/state') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const rows = [...store.entries()].filter(([n]) => n.toLowerCase().includes(q))
        .map(([n, v]) => ({ path: n, serving: {}, updatedAt: new Date().toISOString(), shape: v && typeof v === 'object' ? Object.keys(v) : [] }));
      return json(200, { ok: true, entries: rows });
    }
    return json(404, { ok: false });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ base: `http://127.0.0.1:${server.address().port}`, set: (n, v) => store.set(n, v), close: () => new Promise((r) => server.close(r)) });
  }));
}

const tmpFile = path.join(os.tmpdir(), `snapshot-test-${process.pid}.json`);

async function main() {
  console.log('state to file — selftest');
  const reg = await fakeState({
    'node.gvtx980': { kind: 'link', to: 'http://192.168.1.134:8127', at: 1 },
    'node.123.id': { ref: '123', name: 'this box' },
    'node.123.cycle': { cycle: 5, at: 1 },
    'unrelated.key': { a: 1 },
  });

  // argv is read at import, so it must be set before the module loads
  process.argv = [process.argv[0], 'main.js', '--state', reg.base, '--file', tmpFile, '--query', 'node', '--node-ref', '123'];
  const mod = await import('./src/main.js');

  const first = await mod.writeSnapshot('test');
  ok('a snapshot is written', first.ok === true && first.count === 3, JSON.stringify(first));
  ok('the file exists and parses', (() => { try { return JSON.parse(fs.readFileSync(tmpFile, 'utf8')).kind === 'state-snapshot'; } catch { return false; } })());
  const doc = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  ok('the snapshot says who wrote it', doc.writtenBy === '123');
  ok('the snapshot carries the link with its content', doc.entries.find((e) => e.name === 'node.gvtx980')?.content?.to === 'http://192.168.1.134:8127');
  ok('the query filtered out what was not asked for', !doc.entries.some((e) => e.name === 'unrelated.key'));
  ok('no .tmp file is left behind', !fs.existsSync(`${tmpFile}.${process.pid}.tmp`));

  reg.set('node.xpsw.cycle', { cycle: 1 });
  const second = await mod.writeSnapshot('again');
  const doc2 = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  ok('a second write replaces the file rather than appending', second.ok === true && doc2.count === 4 && doc2.reason === 'again', JSON.stringify({ n: doc2.count, reason: doc2.reason }));

  await reg.close();
  const dead = await mod.writeSnapshot('dead');
  ok('an unreachable registry is a typed failure, not an empty snapshot', dead.ok === false && dead.why === 'unreachable', JSON.stringify(dead));
  const stillThere = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  ok('  …and the last good snapshot is untouched', stillThere.count === 4, String(stillThere.count));

  try { fs.unlinkSync(tmpFile); } catch { /* gone */ }
  console.log(`\nState to file - the gate: ${pass} passed / ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
