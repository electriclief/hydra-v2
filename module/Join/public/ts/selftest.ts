/**
 * @module selftest
 * @description THE GATE — build + typecheck + this. It monkey-patches console.assert to
 *              count per module, prints one line per module plus n passed / m failed, and
 *              sets process.exitCode (never process.exit) so `npm test` can gate on it.
 * @intent Tests drive the REAL thing: real files written to a real temp shelf, a real
 *              ephemeral port, real HTTP. Never mocks. The whole suite is wrapped so a
 *              crash is a counted FAIL and cleanup always runs in finally — otherwise one
 *              exception leaves a listener open and the gate reads as a hang.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests as declarationTests } from './declaration.js';
import { runTests as resolverTests } from './resolver.js';
import { runTests as shelfTests } from './shelf.js';
import { runTests as mcpTests } from './mcpTools.js';
import { runTests as clientTests } from './client.js';
import { runTests as guiTests } from './browser/gui.js';
import { runTests as kindsTests } from './kinds.js';
import { runTests as membersTests } from './members.js';
import { runTests as rosterTests } from './roster.js';
import { runTests as apiTests } from './apiServer.js';

// --- Interface Definitions ---

type Suite = { name: string; run: () => void };

// --- Function Definitions ---

const HERE = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Count asserts per suite. ASYNC-SAFE: the recorder stays installed until the suite's
 * promises have actually landed — restoring it as soon as runTests() returns is how an
 * async suite reports "0 passed / GREEN", which is a gate that lies.
 */
async function record(suiteName: string, fn: () => void): Promise<{ passed: number; failed: number; crash?: string }> {
  let passed = 0;
  let failed = 0;
  const real = console.assert;
  (console as unknown as { assert: (...a: unknown[]) => void }).assert = (...args: unknown[]) => {
    if (args[0]) passed++;
    else {
      failed++;
      const detail = args.slice(1).map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' | ');
      console.log(`    FAIL  ${suiteName}: ${detail || '(no detail)'}`);
    }
  };
  try {
    fn();
    await settle();
  } catch (e) {
    return { passed, failed: failed + 1, crash: e instanceof Error ? e.message : String(e) };
  } finally {
    console.assert = real;
  }
  // a suite that asserted nothing is a BROKEN gate, not a passing one
  if (passed + failed === 0) {
    failed++;
    console.log(`    FAIL  ${suiteName}: the suite asserted nothing (0 checks) — it is not testing`);
  }
  return { passed, failed };
}

/** Give the async-in-IIFE suites a chance to land before we read the tally. */
async function settle(rounds = 30): Promise<void> {
  // real microtasks AND real macrotask slices: an awaited fetch against a real local
  // server needs both, and a fixed sleep alone is the flake the standard warns about
  for (let i = 0; i < rounds; i++) {
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 1));
  }
}

async function runGate(): Promise<void> {
  const suites: Suite[] = [
    { name: 'kinds', run: kindsTests },
    { name: 'declaration', run: declarationTests },
    { name: 'members', run: membersTests },
    { name: 'roster', run: rosterTests },
    { name: 'resolver', run: resolverTests },
    { name: 'shelf', run: shelfTests },
    { name: 'mcpTools', run: mcpTests },
    { name: 'apiServer', run: apiTests },
    { name: 'client', run: clientTests },
    { name: 'browser/gui', run: guiTests },
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  console.log('Join — the gate\n');

  for (const s of suites) {
    const r = await record(s.name, s.run);
    totalPassed += r.passed;
    totalFailed += r.failed;
    const mark = r.failed === 0 ? 'GREEN' : 'RED';
    console.log(`  ${mark}  ${s.name.padEnd(14)} ${r.passed} passed / ${r.failed} failed${r.crash ? `  CRASH: ${r.crash}` : ''}`);
  }

  console.log(`\n  ${totalPassed} passed / ${totalFailed} failed — ${totalFailed === 0 ? 'GREEN' : 'RED'}`);
  console.log(`  gate: ${HERE}`);
  process.exitCode = totalFailed === 0 ? 0 : 1;
}

void runGate();