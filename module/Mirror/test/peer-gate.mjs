#!/usr/bin/env node
/**
 * The peer gate: does Mirror actually distinguish alive / stalled / gone?
 *
 * Runs a fake peer (advances, freezes, dies) and a Mirror pointed at it, then samples the LAN view and asserts
 * the sequence. This is the test that a real laptop could not give: a controlled death.
 *
 *   node test/peer-gate.mjs        ~40s
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const PORT = 8138;
const PEER_PORT = 8199;

const fake = spawn(process.execPath, [path.join(HERE, 'fake-peer.mjs')], {
  env: { ...process.env, FAKE_PORT: String(PEER_PORT), FAKE_ALIVE_S: '8', FAKE_STALL_S: '20' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
fake.stdout.on('data', (d) => process.stdout.write('  ' + d.toString()));

const mirror = spawn(process.execPath, [path.join(MODULE, 'src', 'main.js')], {
  env: {
    ...process.env,
    MIRROR_PORT: String(PORT),
    MIRROR_TICK_MS: '1500',
    MIRROR_TIMEOUT_MS: '600',
    MIRROR_REF: '123',
    MIRROR_PEERS: `jims@http://127.0.0.1:${PEER_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
mirror.stderr.on('data', (d) => process.stderr.write('  mirror: ' + d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = [];

async function sample(label) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/lan.json`, { signal: AbortSignal.timeout(1500) });
    const lan = await res.json();
    const peer = (lan.nodes || []).find((n) => n.ref === 'jims');
    const verdict = peer ? peer.verdict : 'missing';
    seen.push(verdict);
    console.log(`  ${label.padEnd(14)} verdict=${verdict} cycle=${peer ? peer.cycle : '-'} misses=${peer ? peer.misses : '-'}`);
    return verdict;
  } catch (error) {
    console.log(`  ${label.padEnd(14)} (mirror not answering: ${error.message})`);
    return null;
  }
}

await sleep(3000);
await sample('alive-window');
await sleep(3000);
await sample('alive-window');
await sleep(6000);
await sample('stall-window');
await sleep(4000);
await sample('stall-window');
await sleep(14000);
await sample('dead-window');
await sleep(5000);
await sample('dead-window');

fake.kill();
mirror.kill();
await sleep(300);

// assertions: saw alive, then later stalled, then later gone - in that order
const firstAlive = seen.indexOf('alive');
const firstStalled = seen.indexOf('stalled');
const firstGone = seen.indexOf('gone');
const ordered = firstAlive >= 0 && firstStalled > firstAlive && firstGone > firstStalled;

console.log('');
console.log(`  sequence: ${seen.join(' -> ')}`);
console.log(ordered ? '  PASS  alive -> stalled -> gone' : '  FAIL  the three states were not observed in order');
process.exit(ordered ? 0 : 1);
