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
import { classify, observation, standbyOf } from './src/verdict.js';
import { claimEntry, decide, isLive, lowerRef } from './src/claim.js';

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

// ── what a peer is doing: the standby snapshot inside our own observation ──
{
  const mining = standbyOf({ miner: true, at: new Date(1000).toISOString(), poll: 15 }, 31000);
  ok('a mining report keeps its mode', mining.mode === 'mining');
  ok('age is measured against the report, not guessed', mining.ageS === 30);
  ok('a report inside three of its own polls is not stale', mining.stale === false);
  ok('a report past three polls is stale', standbyOf({ miner: true, at: new Date(1000).toISOString(), poll: 15 }, 61000).stale === true);
  const ai = standbyOf({ ai: 'llama-server(:8080)', at: new Date(31000).toISOString(), poll: 15 }, 31000);
  ok('an ai report names the process', ai.mode === 'ai' && ai.ai.includes('llama-server'));
  ok('a fresh report is not stale', ai.stale === false && ai.ageS === 0);
  ok('nothing published is null, never "idle"', standbyOf(null) === null);
  const obs = observation({ verdict: 'alive', cycle: 4, misses: 0, reason: 'advanced' }, 5000, mining);
  ok('the observation carries what the peer was doing', obs.standby.mode === 'mining');
  ok('an observation without a report still says null', observation({ verdict: 'alive', cycle: 4, misses: 0 }, 5000).standby === null);
}

// ── the root role: who holds the pointer table ──
{
  const now = 1_000_000;
  const live = (ref, extra = {}) => ({ ref, token: 't', since: new Date(now - 1000).toISOString(), leaseUntil: now + 10000, ...extra });

  ok('no claim at all -> this node takes the role', decide({ claim: null, me: '123', now, leaseMs: 15000 }).action === 'claim');
  ok('a claim with no ref is not a holder', decide({ claim: { leaseUntil: now + 1000 }, me: '123', now, leaseMs: 15000 }).action === 'claim');
  ok('a claim with no lease cannot be trusted as live', decide({ claim: { ref: 'robert' }, me: '123', now, leaseMs: 15000 }).action === 'claim');
  const expired = decide({ claim: { ref: 'robert', leaseUntil: now - 1 }, me: '123', now, leaseMs: 15000 });
  ok('an expired lease is taken back', expired.action === 'claim' && /expired/.test(expired.why), expired.why);
  ok('holding it means renewing it', decide({ claim: live('123'), me: '123', now, leaseMs: 15000 }).action === 'renew');
  const lower = decide({ claim: live('123'), me: 'robert', now, leaseMs: 15000 });
  ok('someone lower holds it -> yield', lower.action === 'yield' && lower.holder === '123', lower.why);
  const higher = decide({ claim: live('xpsw'), me: '123', now, leaseMs: 15000 });
  ok('someone higher holds it -> takeover by tiebreak', higher.action === 'takeover' && higher.holder === 'xpsw', higher.why);
  ok('a node with no ref never takes the role', decide({ claim: null, me: '', now, leaseMs: 15000 }).action === 'yield');

  ok('the tiebreak is lexicographic, not numeric', lowerRef('10', '9') === '10', 'numeric order would pick 9');
  ok('the tiebreak is case-insensitive', lowerRef('ROBERT', 'gvtx980') === 'gvtx980');

  const entry = claimEntry({ me: '123', token: 'abc', now, leaseMs: 15000 });
  ok('the claim carries a lease into the future', entry.leaseUntil === now + 15000 && entry.ref === '123');
  ok('the claim carries a token so a stale hold is visible', entry.token === 'abc');
  ok('a live claim reads as live, an expired one does not', isLive(entry, now) === true && isLive(entry, now + 15001) === false);
}

console.log('\nState Resolver - the gate: ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
