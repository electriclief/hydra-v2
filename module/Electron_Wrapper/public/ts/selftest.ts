/**
 * @module selftest
 * @description The gate. Runs every module's own runTests() against the REAL thing, counts
 *              console.assert failures per module, prints one line per module plus the
 *              tally, and sets process.exitCode (never process.exit) so `npm test` can
 *              gate on it. GREEN means every assert held.
 * @intent "every module carries its own self-check" — this file is only the counter and
 *         the red/green light.
 */

import { runTests as registry } from './core/registry.js';
import { runTests as template } from './core/template.js';
import { runTests as windowMap } from './core/windowMap.js';
import { runTests as visuals } from './core/visuals.js';
import { runTests as menuTree } from './core/menuTree.js';
import { runTests as trayModel } from './core/trayModel.js';
import { runTests as events } from './core/events.js';
import { runTests as statePull } from './core/statePull.js';
import { runTests as wrapperMain } from './main/wrapperMain.js';

// --- Function Definitions ---

const modules: Array<[string, () => Promise<void>]> = [
  ['registry', registry],
  ['template', template],
  ['windowMap', windowMap],
  ['visuals', visuals],
  ['menuTree', menuTree],
  ['trayModel', trayModel],
  ['events', events],
  ['statePull', statePull],
  ['wrapperMain', wrapperMain],
];

let counted = 0;
let failed = 0;
console.assert = ((condition?: unknown, ...data: unknown[]) => {
  counted += 1;
  if (!condition) {
    failed += 1;
    console.error(...data);
  }
}) as unknown as typeof console.assert;

for (const [name, fn] of modules) {
  const before = failed;
  await fn();
  const own = failed - before;
  console.log(`[${name}] ${own === 0 ? 'ok' : `${own} FAIL`}`);
}

console.log(`${counted - failed}/${counted} passed, ${failed} failed — ${failed === 0 ? 'GREEN' : 'RED'}`);
if (failed > 0) process.exitCode = 1;
// Windows/undici: let sockets drain; force the exit only if something lingers.
setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
