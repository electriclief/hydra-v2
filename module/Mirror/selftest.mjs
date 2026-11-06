#!/usr/bin/env node
/**
 * The gate for Mirror: assembly, the brief, and the one thing that rots silently - the copied verdict rules.
 */
import { assemble, allNodes, bookedRows, displayName, serviceRows } from './src/assemble.js';
import { lanJson, lanMarkdown, SCHEMA_VERSION } from './src/lan.js';
import { classify } from './src/verdict.js';
import { classify as coreClassify } from '../Core/src/verdict.js';

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
};

const entries = [
  { path: 'node.123.id', content: { ref: '123', name: '123 — this box', gpu: 'RX 6800' } },
  { path: 'node.123.doors', content: { count: 12, up: 9, doors: [] } },
  { path: 'node.123.cycle', content: { cycle: 41, uptimeSec: 205 } },
  { path: 'node.123.services.llama-chat', content: { name: 'llama-chat', provider: 'llama.cpp', karma: 5, ready: true, modes: ['gpu-full'] } },
  { path: 'node.123.services.piper-tts', content: { name: 'piper-tts', provider: 'piper', karma: 1, ready: false } },
  { path: 'node.jims.id', content: { ref: 'jims', name: 'Jims Laptop' } },
  { path: 'node.jims.cycle', content: { cycle: 9 } },
  { path: 'node.jims.services.llama-chat', content: { name: 'llama-chat', ready: true } },
];

console.log('assembly');
const self = assemble(entries, '123');
ok('ref is read from the path', self.ref === '123');
ok('id lands', self.id.gpu === 'RX 6800');
ok('cycle lands', self.cycle.cycle === 41);
ok('services nest by slug', Object.keys(self.services).sort().join(',') === 'llama-chat,piper-tts');
ok('display name prefers what the node calls itself', displayName(self).startsWith('123'));
const nodes = allNodes(entries);
ok('both nodes found', nodes.length === 2);
ok('a ref with no entries still assembles empty', assemble([], 'ghost').services && Object.keys(assemble([], 'ghost').services).length === 0);
ok('non-node paths are ignored', Object.keys(assemble([{ path: 'other.thing.x', content: 1 }], 'x').unknown).length === 0);

console.log('\nrows');
ok(
  'the rollup index expands into services',
  assemble([{ path: 'node.r.services', content: { services: { 'a-b': { name: 'a-b', ready: true } } } }], 'r').services['a-b'].ready === true,
);
const rows = serviceRows(self);
ok('ready services sort first', rows[0].ready === true);
ok('a missing ready flag is not ready', rows.find((r) => r.slug === 'piper-tts').ready === false);
ok('karma survives as a number', rows.find((r) => r.slug === 'llama-chat').karma === 5);
const booked = bookedRows({ scheduler: { booked: { 'j-1': { service: 'llama-chat', at: '2026-11-04T09:00:00Z', state: 'booked' } } } });
ok('booked rows carry the id', booked[0].id === 'j-1');

console.log('\nlan view');
const lan = lanJson({ self, peers: [{ node: assemble(entries, 'jims'), verdict: 'alive', cycle: 9 }], at: 1000 });
ok('schema is versioned', lan.schemaVersion === SCHEMA_VERSION);
ok('self is counted among the nodes', lan.counts.nodes === 2);
ok('ready count adds up', lan.counts.ready === 2);
ok('self is marked as self', lan.nodes[0].role === 'self');
const goneLan = lanJson({ self, peers: [{ node: null, verdict: 'gone', cycle: null, misses: 14, reason: 'no answer', ref: 'jims' }], at: 1000 });
ok('a vanished peer still renders', goneLan.nodes.length === 2 && goneLan.nodes[1].verdict === 'gone');
ok('a vanished peer keeps its ref', goneLan.nodes[1].ref === 'jims');
ok('a vanished peer offers no services', goneLan.nodes[1].services.length === 0);
ok('peer carries its verdict', lan.nodes[1].verdict === 'alive');
const md = lanMarkdown(lan);
ok('brief names the machines', md.includes('Jims Laptop') && md.includes('123 — this box'));
ok('brief states the tally', md.includes('2 nodes') && md.includes('3 services'));
const solo = lanMarkdown(lanJson({ self, peers: [], at: 1000 }));
ok('the N=1 case says so out loud', solo.includes('No peers attached'));

console.log('\nverdict copies agree with Core');
const cases = [
  [{}, { cycle: 5, reachable: true }],
  [{ cycle: 5, misses: 0 }, { cycle: 6, reachable: true }],
  [{ cycle: 5, misses: 2 }, { cycle: 5, reachable: true }],
  [{ cycle: 9, misses: 0 }, { cycle: 2, reachable: true }],
  [{ cycle: 5, misses: 11 }, { cycle: null, reachable: false }],
  [{ cycle: 5, misses: 0 }, { cycle: null, reachable: false }],
  [{ cycle: 5, misses: 11 }, { cycle: 6, reachable: true }],
  [{ cycle: 5, misses: 3 }, { cycle: null, reachable: true }],
];
let agree = true;
for (const [prev, seen] of cases) {
  const a = classify(prev, seen, { stalledAfter: 3, goneAfter: 12 });
  const b = coreClassify(prev, seen, { stalledAfter: 3, goneAfter: 12 });
  if (a.verdict !== b.verdict || a.misses !== b.misses) {
    agree = false;
    console.log(`    disagree on ${JSON.stringify(prev)} / ${JSON.stringify(seen)}: ${a.verdict} vs ${b.verdict}`);
  }
}
ok('every case matches Core', agree);

console.log(`\nMirror - the gate: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
