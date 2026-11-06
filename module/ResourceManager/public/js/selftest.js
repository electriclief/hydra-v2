import { pathToFileURL } from "node:url";
const DEFAULT_MODULES = ["resourceSchema", "resourceRead", "bookingStore", "mcpTools", "mcpServer", "staticFiles", "apiServer", "client", "browser/gui", "main"];
async function runGate(modules = DEFAULT_MODULES, log = console.log) {
  const results = [];
  const originalAssert = console.assert.bind(console);
  let assertionFailures = 0;
  console.assert = ((condition, ...rest) => {
    if (!condition) assertionFailures++;
    originalAssert(condition, ...rest);
  });
  try {
    for (const name of modules) {
      assertionFailures = 0;
      const url = new URL(name.endsWith(".js") ? "./" + name : "./" + name + ".js", import.meta.url);
      try {
        const mod = await import(url.href);
        if (typeof mod.runTests !== "function") {
          results.push({ module: name, status: "skip", detail: "no runTests exported" });
          log(`SKIP ${name} \u2014 no runTests exported`);
          continue;
        }
        await mod.runTests();
        const failed = assertionFailures;
        if (failed > 0) {
          results.push({ module: name, status: "fail", detail: `${failed} assertion(s) failed` });
          log(`FAIL ${name} \u2014 ${failed} assertion(s) failed`);
        } else {
          results.push({ module: name, status: "pass", detail: "" });
          log(`PASS ${name}`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({ module: name, status: "fail", detail });
        log(`FAIL ${name} \u2014 ${detail}`);
      }
    }
  } finally {
    console.assert = originalAssert;
  }
  const ok = results.every((result) => result.status !== "fail");
  return { ok, results };
}
async function main() {
  console.log("[resource-manager gate] every module's own self-check, one command");
  const { ok, results } = await runGate();
  const failed = results.filter((result) => result.status === "fail");
  console.log(`[resource-manager gate] ${results.length - failed.length}/${results.length} modules green`);
  if (!ok) process.exitCode = 1;
}
const isDirect = (() => {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();
if (isDirect) void main();
export {
  DEFAULT_MODULES,
  main,
  runGate
};
//# sourceMappingURL=selftest.js.map
