/**
 * @module selftest
 * @description THE GATE — runs every module's own runTests in one command: GREEN/RED +
 *              exit code. Every asserted check is real: real servers on real ports, real
 *              HTTP between the app and its stub doors — nothing here is a mock.
 */

import { runTests as doorsTests } from './doors.js';
import { runTests as runLogicTests } from './runLogic.js';
import { runTests as basicServerTests } from './basicServer.js';
import { runTests as guiTests } from './browser/gui.js';

let fails = 0;
const original = console.assert.bind(console);
console.assert = (condition?: boolean, ...rest: unknown[]) => {
  if (!condition) fails += 1;
  original(condition, ...rest);
};

console.log('Basic_App — the gate');
console.log('────────────────────');

await doorsTests();
await runLogicTests();
await guiTests();
await basicServerTests();

console.assert = original;

if (fails > 0) {
  console.log(`\nRED — ${fails} failed assertion(s)`);
  process.exitCode = 1;
} else {
  console.log('\nGREEN — every module passed its own checks');
}
