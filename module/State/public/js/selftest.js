function recordAsserts(consoleLike = console) {
  const original = consoleLike.assert;
  let asserts = 0;
  let failed = 0;
  const failures = [];
  consoleLike.assert = ((cond, ...args) => {
    asserts++;
    if (!cond) {
      failed++;
      failures.push(args.map((a) => String(a)).join(" "));
    }
  });
  return {
    stop: () => {
      consoleLike.assert = original;
    },
    get asserts() {
      return asserts;
    },
    get failed() {
      return failed;
    },
    get failures() {
      return failures;
    }
  };
}
async function defaultModules() {
  return [
    { name: "stateRegistry", load: () => import("./stateRegistry.js") },
    { name: "mcpTools", load: () => import("./mcpTools.js") },
    { name: "mcpServer", load: () => import("./mcpServer.js") },
    { name: "staticFiles", load: () => import("./staticFiles.js") },
    { name: "apiServer", load: () => import("./apiServer.js") },
    { name: "client", load: () => import("./client.js") },
    { name: "browser/gui", load: () => import("./browser/gui.js") },
    { name: "main", load: () => import("./main.js") }
    // NOTE: never add 'selftest' itself here — importing the entry file while it is
    // still evaluating deadlocks (module-namespace promise waits on its own TLA).
  ];
}
async function runAll(modules) {
  const results = [];
  for (const mod of modules) {
    const recorder = recordAsserts();
    let error = null;
    try {
      const loaded = await mod.load();
      if (typeof loaded.runTests === "function") {
        await loaded.runTests();
      } else {
        error = "no runTests() exported";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    recorder.stop();
    results.push({ name: mod.name, asserts: recorder.asserts, failed: recorder.failed, error });
  }
  const asserts = results.reduce((n, r) => n + r.asserts, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const errors = results.filter((r) => r.error !== null).length;
  return { modules: results, asserts, failed, errors, green: failed === 0 && errors === 0 };
}
function formatGate(result) {
  const lines = [];
  for (const mod of result.modules) {
    const status = mod.error ? `ERROR: ${mod.error}` : mod.failed ? `RED \u2014 ${mod.failed} failed` : "ok";
    lines.push(`  ${mod.name.padEnd(14)} ${String(mod.asserts).padStart(4)} asserts \xB7 ${status}`);
  }
  lines.push("");
  lines.push(`  ${result.asserts} asserts, ${result.failed} failed, ${result.errors} module errors \u2014 ${result.green ? "GREEN" : "RED"}`);
  return lines.join("\n");
}
async function gate(modules) {
  const list = modules ?? await defaultModules();
  return runAll(list);
}
async function runTests() {
  const recorder = recordAsserts();
  console.assert(true, "counted pass");
  console.assert(false, "counted fail");
  recorder.stop();
  console.assert(recorder.asserts === 2, "recorder counts asserts");
  console.assert(recorder.failed === 1, "recorder counts failures");
  console.assert(recorder.failures[0].includes("counted fail"), "recorder keeps the messages");
  const toy = await runAll([
    {
      name: "toy-green",
      load: async () => ({ runTests: async () => {
        console.assert(true, "fine");
      } })
    },
    {
      name: "toy-red",
      load: async () => ({ runTests: async () => {
        console.assert(false, "expected red");
      } })
    }
  ]);
  console.assert(toy.green === false && toy.failed === 1, "the mini-gate reads RED with one failure");
  console.log("[selftest] gate mechanics verified");
}
async function main() {
  console.log("[state gate] every module's own self-check, one command\n");
  const result = await gate();
  console.log(formatGate(result));
  if (!result.green) {
    for (const mod of result.modules) {
      if (mod.error) console.log(`
${mod.name}: ${mod.error}`);
    }
    process.exitCode = 1;
  }
}
const direct = process.argv[1] && /selftest\.(js|ts)$/.test(process.argv[1]);
if (direct) {
  await main();
}
export {
  defaultModules,
  formatGate,
  gate,
  main,
  recordAsserts,
  runAll,
  runTests
};
//# sourceMappingURL=selftest.js.map
