import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests as declarationTests } from "./declaration.js";
import { runTests as resolverTests } from "./resolver.js";
import { runTests as shelfTests } from "./shelf.js";
import { runTests as mcpTests } from "./mcpTools.js";
import { runTests as clientTests } from "./client.js";
import { runTests as guiTests } from "./browser/gui.js";
import { runTests as kindsTests } from "./kinds.js";
import { runTests as membersTests } from "./members.js";
import { runTests as apiTests } from "./apiServer.js";
const HERE = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
async function record(suiteName, fn) {
  let passed = 0;
  let failed = 0;
  const real = console.assert;
  console.assert = (...args) => {
    if (args[0]) passed++;
    else {
      failed++;
      const detail = args.slice(1).map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" | ");
      console.log(`    FAIL  ${suiteName}: ${detail || "(no detail)"}`);
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
  if (passed + failed === 0) {
    failed++;
    console.log(`    FAIL  ${suiteName}: the suite asserted nothing (0 checks) \u2014 it is not testing`);
  }
  return { passed, failed };
}
async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 1));
  }
}
async function runGate() {
  const suites = [
    { name: "kinds", run: kindsTests },
    { name: "declaration", run: declarationTests },
    { name: "members", run: membersTests },
    { name: "resolver", run: resolverTests },
    { name: "shelf", run: shelfTests },
    { name: "mcpTools", run: mcpTests },
    { name: "apiServer", run: apiTests },
    { name: "client", run: clientTests },
    { name: "browser/gui", run: guiTests }
  ];
  let totalPassed = 0;
  let totalFailed = 0;
  console.log("Join \u2014 the gate\n");
  for (const s of suites) {
    const r = await record(s.name, s.run);
    totalPassed += r.passed;
    totalFailed += r.failed;
    const mark = r.failed === 0 ? "GREEN" : "RED";
    console.log(`  ${mark}  ${s.name.padEnd(14)} ${r.passed} passed / ${r.failed} failed${r.crash ? `  CRASH: ${r.crash}` : ""}`);
  }
  console.log(`
  ${totalPassed} passed / ${totalFailed} failed \u2014 ${totalFailed === 0 ? "GREEN" : "RED"}`);
  console.log(`  gate: ${HERE}`);
  process.exitCode = totalFailed === 0 ? 0 : 1;
}
void runGate();
//# sourceMappingURL=selftest.js.map
