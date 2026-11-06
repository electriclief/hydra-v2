import { runTests as registry } from "./core/registry.js";
import { runTests as template } from "./core/template.js";
import { runTests as windowMap } from "./core/windowMap.js";
import { runTests as visuals } from "./core/visuals.js";
import { runTests as menuTree } from "./core/menuTree.js";
import { runTests as trayModel } from "./core/trayModel.js";
import { runTests as events } from "./core/events.js";
import { runTests as statePull } from "./core/statePull.js";
import { runTests as wrapperMain } from "./main/wrapperMain.js";
const modules = [
  ["registry", registry],
  ["template", template],
  ["windowMap", windowMap],
  ["visuals", visuals],
  ["menuTree", menuTree],
  ["trayModel", trayModel],
  ["events", events],
  ["statePull", statePull],
  ["wrapperMain", wrapperMain]
];
let counted = 0;
let failed = 0;
console.assert = ((condition, ...data) => {
  counted += 1;
  if (!condition) {
    failed += 1;
    console.error(...data);
  }
});
for (const [name, fn] of modules) {
  const before = failed;
  await fn();
  const own = failed - before;
  console.log(`[${name}] ${own === 0 ? "ok" : `${own} FAIL`}`);
}
console.log(`${counted - failed}/${counted} passed, ${failed} failed \u2014 ${failed === 0 ? "GREEN" : "RED"}`);
if (failed > 0) process.exitCode = 1;
setTimeout(() => process.exit(process.exitCode ?? 0), 2e3).unref();
//# sourceMappingURL=selftest.js.map
