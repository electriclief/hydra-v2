#!/usr/bin/env node
/**
 * The gate for Core. No HTTP, no network: the rules that can be wrong are pure, so they are tested pure.
 *
 * The verdict table is the part most likely to rot quietly - a single missed pull reporting "gone" would turn
 * every closed laptop lid into an outage, and a counter that RESETS would look alive if the test only checked
 * inequality in one direction.
 */
import { cycleEntry, doorsEntry, entryNames, idEntry, linkEntry, linkRefOf, refOf, serviceEntries, slugOf } from './src/self.js';
import { leaks, minimal } from './src/broadcast.js';
import { classify, observation } from './src/verdict.js';

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

console.log('ref naming');
ok('plain hostname', refOf({}, 'desktop-abcd') === 'desktop-abcd');
ok('spaces and case fold to a path-safe ref', refOf({ ref: 'Jims Laptop' }) === 'jims-laptop');
ok('number-ish ref survives', refOf({ ref: '123' }) === '123');
ok('empty falls back', refOf({ ref: '   ' }, 'fallback') === 'fallback' ? true : refOf({}, 'fallback') === 'fallback');

console.log('\nentries');
const id = idEntry({ name: 'test box', gpu: 'none', modelsDir: 'C:/m' }, { ref: 't', startedAt: 1000 });
ok('id carries its ref', id.ref === 't');
ok('id carries the name', id.name === 'test box');
ok('id never invents a field', id.gpu === 'none' && id.modelsDir === 'C:/m');
const cyc = cycleEntry({ cycle: 7, tickMs: 5000, startedAt: 1000 }, 6000);
ok('cycle carries the counter', cyc.cycle === 7);
ok('cycle reports uptime in seconds', cyc.uptimeSec === 5);
const doors = doorsEntry([{ name: 'a', port: 1, up: true }, { name: 'b', port: 2, up: false }], 1000);
ok('doors counts what is up', doors.count === 2 && doors.up === 1);
ok('observation names are under the observer', entryNames('x').observed('y') === 'node.x.observed.y');

console.log('\nverdict hysteresis');
const T = { stalledAfter: 3, goneAfter: 12 };
ok('first sight is alive', classify({}, { cycle: 5, reachable: true }, T).verdict === 'alive');
ok('advanced counter is alive', classify({ cycle: 5, misses: 4 }, { cycle: 6, reachable: true }, T).verdict === 'alive');
ok('advanced counter clears the miss count', classify({ cycle: 5, misses: 4 }, { cycle: 6, reachable: true }, T).misses === 0);
ok('one static read is stalled, not gone', classify({ cycle: 5, misses: 0 }, { cycle: 5, reachable: true }, T).verdict === 'stalled');
ok('a reset counter is not alive', classify({ cycle: 9, misses: 0 }, { cycle: 2, reachable: true }, T).verdict === 'stalled');
ok('unreachable counts up', classify({ cycle: 5, misses: 1 }, { cycle: null, reachable: false }, T).misses === 2);
ok('unreachable long enough is gone', classify({ cycle: 5, misses: 11 }, { cycle: null, reachable: false }, T).verdict === 'gone');
ok('a single miss is never gone', classify({ cycle: 5, misses: 0 }, { cycle: null, reachable: false }, T).verdict === 'stalled');
ok('answering again after misses is alive', classify({ cycle: 5, misses: 11 }, { cycle: 6, reachable: true }, T).verdict === 'alive');

console.log('\nobservation record');
const obs = observation({ verdict: 'alive', cycle: 6, misses: 0, reason: 'first sight' }, 1234);
ok('observation keeps the verdict', obs.verdict === 'alive');
ok('observation is stamped', obs.seenAt === new Date(1234).toISOString());

console.log('\nbroadcast projection');
const svcList = [{ name: 'llama-chat', what: 'chat', provider: 'llama.cpp', modes: ['chat'], karma: 1, ok: true, output: 'text' }];
const svcEntries = serviceEntries(svcList, 1000);
ok('service slug is path-safe', svcEntries[0].name === 'llama-chat');
ok('service keeps its readiness', svcEntries[0].content.ready === true);
const proj = minimal(
  { ref: '123', ready_for: ['chat'], paths: { secret: 1 } },
  { cycle: 9, fillPct: 40 },
  { 'llama-chat': svcEntries[0].content },
  1000,
);
ok('projection carries ref and cycle', proj.ref === '123' && proj.cycle === 9);
ok('projection nests the service', proj.services['llama-chat'].name === 'llama-chat');
ok('projection drops paths', !('paths' in proj));
ok('projection leaks nothing', leaks(proj).length === 0, leaks(proj).join(','));
ok('leaks catches a stray root key', leaks({ ...proj, paths: {} }).includes('paths'));
ok('leaks catches a stray service field', leaks({ ...proj, services: { a: { name: 'a', secret: 'x' } } }).includes('a.secret'));

// ── links: a path that continues somewhere else ──
{
  const link = linkEntry('http://192.168.1.127:8127/');
  ok('a link says it is a link', link.kind === 'link');
  ok('a link normalises its target', link.to === 'http://192.168.1.127:8127', link.to);
  ok('a link carries the time it was written', typeof link.at === 'number');
  ok('a link is registered under node.<ref>', linkRefOf('node.jims') === 'jims');
  ok('a link is not a node path when deeper', linkRefOf('node.jims.cycle') === null);
  ok('a link is not a node path at the root', linkRefOf('node') === null);
}

console.log(`\nCore - the gate: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
