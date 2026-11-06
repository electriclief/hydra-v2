import { runTests as doorsTests } from "./doors.js";
import { runTests as runLogicTests } from "./runLogic.js";
import { runTests as basicServerTests } from "./basicServer.js";
import { runTests as guiTests } from "./browser/gui.js";
let fails = 0;
const original = console.assert.bind(console);
console.assert = (condition, ...rest) => {
  if (!condition) fails += 1;
  original(condition, ...rest);
};
console.log("Basic_App \u2014 the gate");
console.log("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
await doorsTests();
await runLogicTests();
await guiTests();
await basicServerTests();
console.assert = original;
if (fails > 0) {
  console.log(`
RED \u2014 ${fails} failed assertion(s)`);
  process.exitCode = 1;
} else {
  console.log("\nGREEN \u2014 every module passed its own checks");
}
//# sourceMappingURL=selftest.js.map
