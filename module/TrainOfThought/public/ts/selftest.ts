/**
 * The gate. No network, no model, no door — it proves the DAG and the store, which is the part
 * every other feature stands on. Run: npm test (build + tsc --noEmit + this).
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { ThoughtStore, ThoughtError } from './store.js';
import { layers, whyStuck } from './dag.js';
import { handoffPacket, recordTick } from './cycle.js';
import { SessionClient } from './sessionClient.js';
import { attachArtifact, listArtifacts, nodeDir } from './artifacts.js';
import type { ThoughtNode } from './types.js';

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function throws(name: string, fn: () => unknown, code: string): void {
  try {
    fn();
    failed += 1;
    console.log(`  FAIL ${name} — expected ${code}, nothing was thrown`);
  } catch (error) {
    const got = error instanceof ThoughtError ? error.code : 'other';
    if (got === code) {
      passed += 1;
      console.log(`  ok  ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${name} — expected ${code}, got ${got} (${(error as Error).message})`);
    }
  }
}

function throwsMessage(name: string, fn: () => unknown, needle: string): void {
  try {
    fn();
    failed += 1;
    console.log(`  FAIL ${name} — expected a throw, nothing was thrown`);
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes(needle)) {
      passed += 1;
      console.log(`  ok  ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${name} — message was "${message}"`);
    }
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tot-selftest-'));
const file = path.join(dir, 'thoughts.json');

let clock = 1_800_000_000_000;
const store = new ThoughtStore({ file, now: () => clock });

console.log('\nstore + dag');

eq('a fresh store is empty', store.nodes.length, 0);

const a = store.add({ title: 'Add nodes and intent to the LAN database', intent: 'one roster the fleet can read', next: ['probe .139 sshd', 'add ReX to roster.json'] }, 'hermes');
clock += 1000;
const b = store.add({ title: 'Build hydra modules', intent: 'doors that hold their own data', next: ['train of thought'] }, 'hermes');
clock += 1000;
const c = store.add({ title: 'Salvage main', intent: 'data to reclaim, reboot headache', next: ['pull dead model kits off .100'] }, 'hermes');

ok('refs are 8 hex', [a, b, c].every((node) => /^[0-9a-f]{8}$/.test(node.ref)));
ok('refs are distinct', new Set([a.ref, b.ref, c.ref]).size === 3);
eq('new nodes start active', [a.state, b.state, c.state], ['active', 'active', 'active']);

store.link(b.ref, a.ref, 'hermes');
store.link(c.ref, b.ref, 'hermes');

eq('frontier holds only the root', store.ready().map((node) => node.ref), [a.ref]);
eq('the middle node knows what it waits on', store.settled(b.ref), { done: 0, total: 1, ok: false });
eq('layers put the chain at 0/1/2', [a, b, c].map((node) => layers(store.nodes).get(node.ref)), [0, 1, 2]);

throws('an edge that would close a loop is refused', () => store.link(a.ref, c.ref, 'hermes'), 'cycle');
throws('a node cannot wait on itself', () => store.link(a.ref, a.ref, 'hermes'), 'cycle');
throws('linking a node that does not exist is refused', () => store.link(a.ref, 'deadbeef'), 'no_such_node');
throws('a second identical edge is refused', () => store.link(b.ref, a.ref, 'hermes'), 'already_linked');

throws('closing without a summary is refused', () => store.close(a.ref, { summary: 'done' }), 'bad_summary');
throws('setting state=done directly is refused', () => store.setState(a.ref, 'done'), 'use_close');

clock += 1000;
store.close(a.ref, { summary: 'roster.json carries every node and its intent', sessionRefs: ['8e3720cf'] }, 'hermes');
eq('closing moves the frontier on', store.ready().map((node) => node.ref), [b.ref]);
eq('the closed node is archived with its summary', [store.find(a.ref)?.state, store.find(a.ref)?.closed?.summary], ['done', 'roster.json carries every node and its intent']);

throws('a live claim refuses a second agent by name', () => {
  store.claim(b.ref, 'agent-one', 30);
  store.claim(b.ref, 'agent-two', 30);
}, 'claimed');
eq('a claimed node leaves the frontier', store.ready().map((node) => node.ref), []);

throws('only the holder can release it', () => store.release(b.ref, 'agent-two'), 'not_holder');
clock += 31 * 60_000;
eq('an expired lease puts the node back on the frontier', store.ready().map((node) => node.ref), [b.ref]);

store.claim(b.ref, 'agent-two', 10);
store.release(b.ref, 'agent-two');
ok('the holder can release it', !store.find(b.ref)?.claimed);

const trailBefore = store.find(c.ref)?.trail.length ?? 0;
const touchedBefore = store.find(c.ref)?.touched ?? 0;
clock += 1000;
store.trail(c.ref, { kind: 'session', text: 'pulled two dead kits off .100', by: 'hermes', sessionRef: '410ac710' });
const linked = store.find(c.ref) as ThoughtNode;
eq('a session line lands in the trail', linked.trail.length, trailBefore + 1);
eq('the session ref is kept', linked.trail[linked.trail.length - 1].sessionRef, '410ac710');
ok('touching a node moves its timestamp forward', linked.touched > touchedBefore, `${linked.touched} vs ${touchedBefore}`);
throws('an empty trail line is refused', () => store.trail(c.ref, { kind: 'note', text: '   ', by: 'hermes' }), 'empty_note');
throws('an unknown trail kind is refused', () => store.trail(c.ref, { kind: 'gossip' as never, text: 'x', by: 'hermes' }), 'bad_kind');

const stuck = whyStuck(store.nodes, clock);
eq('whyStuck names the wall', [stuck.notActive, stuck.waitingOnDeps, stuck.ready, stuck.claimed], [0, 1, 1, 0]);

const reread = new ThoughtStore({ file, now: () => clock });
eq('the file round-trips through disk', reread.nodes.length, 3);
eq('archived state survives a reload', reread.find(a.ref)?.closed?.summary, 'roster.json carries every node and its intent');

store.reopen(a.ref, 'hermes', 'the roster needs .139 re-probed');
eq('reopening clears the archive marker', [store.find(a.ref)?.state, store.find(a.ref)?.closed], ['active', undefined]);
eq('reopening puts the node back before its dependants', store.ready().map((node) => node.ref), [a.ref]);

// ---------------------------------------------------------------- Phoenix Cycle seam

console.log('\nphoenix cycle seam');

const tick7 = recordTick(store, { cycle: 7, at: clock, sessions: [{ ref: '410ac710', fillPct: 74, tokens: 420_000 }] });
eq('a cycle tick writes one line per attached node', tick7.appended, 1);
eq('a 74% tick is below the handoff line', tick7.handoff.length, 0);

const replay = recordTick(store, { cycle: 7, at: clock, sessions: [{ ref: '410ac710', fillPct: 74, tokens: 420_000 }] });
eq('replaying the same cycle appends nothing', replay.appended, 0);

const tick8 = recordTick(store, { cycle: 8, at: clock, sessions: [{ ref: '410ac710', fillPct: 94, tokens: 690_000 }] });
eq('94% raises a handoff candidate', tick8.handoff.length, 1);
ok('the reason names the pressure', (tick8.handoff[0].why[0] ?? '').includes('94%'), JSON.stringify(tick8.handoff[0]?.why));
ok('the candidate carries the frontier', tick8.handoff[0].frontier.length > 0);

const orphan = recordTick(store, { cycle: 9, at: clock, sessions: [{ ref: 'deadbeef', fillPct: 91 }] });
eq('an unattached session is a warning, not silence', orphan.warnings.length, 1);
ok('the warning says the work would be forgotten', orphan.warnings[0].includes('nothing will remember'), orphan.warnings[0]);

const packet = handoffPacket(store, '410ac710');
eq('the packet names the train this session advanced', packet.primary?.ref, c.ref);
eq('the packet carries the next action', packet.primary?.nextAction, 'pull dead model kits off .100');
ok('the packet carries the resume line', packet.resume === 'hermes --resume 410ac710', packet.resume);
ok('the trail includes the cycle lines', packet.trail.some((entry) => entry.text.startsWith('cycle 8')), JSON.stringify(packet.trail.map((e) => e.text)));
ok('the frontier is not empty for a successor', packet.frontier.length > 0, JSON.stringify(packet.frontier.map((row) => row.ref)));

store.close(b.ref, { summary: 'modules ship with their own gate', sessionRefs: ['b4f898de'] }, 'hermes');
const after = handoffPacket(store, '410ac710');
eq('the archive carries the closing sentence', after.archive.map((row) => row.title), ['Build hydra modules']);
eq('a cold session gets no fake primary', handoffPacket(store, '00000000').primary, null);
ok('a cold session is warned about', handoffPacket(store, '00000000').warnings.length === 1);

// ---------------------------------------------------------------- lazy session dependency

console.log('\nsession client (lazy dependency)');

const stub = http.createServer((req, res) => {
  const route = req.url ?? '';
  res.setHeader('content-type', 'application/json');
  if (route === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, door: 'SessionDiary' }));
    return;
  }
  const hit = /^\/api\/sessions\/([^/?]+)/.exec(route);
  if (hit && hit[1] === '410ac710') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, card: { id: '20260820_050510_3c164f', title: 'Salvage main', goal: 'pull the kits', messageCount: 41 } }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: { code: 'no_such_session' } }));
});
await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', () => resolve()));
const bound = stub.address();
const stubPort = typeof bound === 'object' && bound ? bound.port : 0;

const client = new SessionClient({ base: `http://127.0.0.1:${stubPort}`, ttlMs: 60_000 });
ok('the session door probe answers', await client.probe());
const card = await client.card('410ac710');
eq('a ref resolves to a session card', [card.ok, card.title], [true, 'Salvage main']);
eq('the card keeps the message count', card.messages, 41);
const missing = await client.card('deadbeef');
eq('an unknown ref is reported, not thrown', [missing.ok, missing.reason], [false, 'no session with ref deadbeef']);

await new Promise<void>((resolve) => stub.close(() => resolve()));
const dark = new SessionClient({ base: `http://127.0.0.1:${stubPort}`, ttlMs: 0 });
const down = await dark.card('410ac710');
eq('a dead door degrades instead of failing', down.ok, false);
ok('the reason names the absent door', (down.reason ?? '').includes('not answering'), down.reason);

// ---------------------------------------------------------------- a folder per thought

console.log('\nfolder per thought');

const orphanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tot-artifacts-'));
const artifactFolder = path.join(orphanDir, 'outputs');
fs.mkdirSync(artifactFolder);
const artifactFile = path.join(orphanDir, 'one-image.png');
fs.writeFileSync(artifactFile, Buffer.alloc(2048, 7));

const host = store.add({ title: 'Make 40 images and a video', intent: 'a folder to find them in later', next: ['render batch 1'] }, 'hermes');
const folder = nodeDir(store, host);
ok('a thought gets a folder the moment it exists', fs.existsSync(folder), folder);
eq('the node records its folder', host.dir, `thoughts/${host.ref}`);

fs.writeFileSync(path.join(folder, 'note.txt'), 'hello');
const listed = listArtifacts(store, host);
eq('a file dropped in the folder is listed', listed.map((file) => file.name), ['note.txt']);
eq('the size comes from the file', listed[0].bytes, 5);

const fileAttach = attachArtifact(store, host, artifactFile);
ok('a file is attached by link, not copied', fileAttach.mode === 'symlink' || fileAttach.mode === 'hardlink', fileAttach.mode);
ok('the attached content is really there', fs.readFileSync(path.join(folder, fileAttach.name)).length === 2048);

const dirAttach = attachArtifact(store, host, artifactFolder, 'renders');
eq('a folder is attached as a junction', dirAttach.mode, 'junction');
eq('the junction points at the real folder', fs.realpathSync(path.join(folder, 'renders')).toLowerCase(), fs.realpathSync(artifactFolder).toLowerCase());

const withLinks = listArtifacts(store, host);
ok('the junction is listed with its target', withLinks.some((file) => file.name === 'renders' && (file.target ?? '').length > 0), JSON.stringify(withLinks));
// A hard link is not a pointer — it IS a second name for the file, so it lists as a file. Only a
// symlink or a junction can report a target; the selftest records whichever the OS allowed.
ok('the attached file lists as a real entry', withLinks.some((file) => file.name === fileAttach.name), JSON.stringify(withLinks.map((f) => f.name)));
throwsMessage('attaching the same name twice is refused', () => attachArtifact(store, host, artifactFile), 'already attached');

// clean up links explicitly, then the targets — never let a recursive delete walk through a junction
fs.unlinkSync(path.join(folder, fileAttach.name));
fs.unlinkSync(path.join(folder, 'renders'));
fs.rmSync(orphanDir, { recursive: true, force: true });

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
