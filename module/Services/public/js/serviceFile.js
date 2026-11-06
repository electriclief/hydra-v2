import fs from "node:fs";
import vm from "node:vm";
import { validateService } from "./serviceSchema.js";
const CODE_TOKENS = ["${", "require(", "import(", "globalThis", "eval(", "Function(", "process.env", "child_process"];
const FILE_PATTERN = /^(?:\s|(?:\/\/[^\n]*\n)|\/\*[\s\S]*?\*\/)*module\.exports\s*=\s*[\s\S]*$/;
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}
function refused(file, reason) {
  return {
    file,
    definition: null,
    report: { ok: false, errors: [{ level: "error", field: "$file", message: reason }], warnings: [] },
    error: reason
  };
}
function findRefusedValue(value, pathStr = "$", seen = /* @__PURE__ */ new Set(), depth = 0) {
  if (depth > 32) return `${pathStr}: nesting too deep`;
  const kind = typeof value;
  if (kind === "function") return `${pathStr}: a function value \u2014 a service file is data, never code`;
  if (kind === "symbol" || kind === "bigint") return `${pathStr}: a ${kind} value \u2014 not data`;
  if (value && kind === "object") {
    if (seen.has(value)) return `${pathStr}: a circular reference`;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = findRefusedValue(value[i], `${pathStr}[${i}]`, seen, depth + 1);
        if (hit) return hit;
      }
    } else {
      for (const [key, inner] of Object.entries(value)) {
        const hit = findRefusedValue(inner, `${pathStr}.${key}`, seen, depth + 1);
        if (hit) return hit;
      }
    }
  }
  return null;
}
function loadServiceText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { value: null, error: "the file is empty" };
  }
  if (!FILE_PATTERN.test(text)) {
    return { value: null, error: "not a service file: comments may lead, but the file must then assign ONE literal \u2014 `module.exports = <literal>;`" };
  }
  const assignments = stripComments(text).split("module.exports").length - 1;
  if (assignments !== 1) {
    return { value: null, error: `refused: exactly one module.exports assignment, found ${assignments} \u2014 comments may mention the phrase, the code may not repeat it` };
  }
  const hit = CODE_TOKENS.find((token) => text.includes(token));
  if (hit) {
    return { value: null, error: `refused: the text contains "${hit}" \u2014 a service file is DATA; page scripts use concatenation, heavy items use links` };
  }
  try {
    const sandbox = { module: { exports: {} } };
    const context = vm.createContext(sandbox, { name: "service-file", codeGeneration: { strings: false, wasm: false } });
    const value = vm.runInContext(text, context, { timeout: 2e3 });
    const asValue = value === void 0 ? sandbox.module.exports : value;
    const refusedPath = findRefusedValue(asValue);
    if (refusedPath) return { value: null, error: `refused: ${refusedPath}` };
    return { value: asValue, error: null };
  } catch (err) {
    return { value: null, error: `the literal did not load: ${err instanceof Error ? err.message : String(err)}` };
  }
}
function loadServiceFile(filePath) {
  let text;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2e6) return refused(filePath, "the file is over 2 MB \u2014 the definition is meant to be tiny; heavy items go by link");
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return refused(filePath, `cannot read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const loaded = loadServiceText(text);
  if (loaded.error) return refused(filePath, loaded.error);
  const report = validateService(loaded.value);
  return {
    file: filePath,
    definition: report.ok ? loaded.value : null,
    report,
    error: report.ok ? null : `the definition did not validate: ${report.errors.map((e) => e.field + ": " + e.message).join(" \xB7 ")}`
  };
}
async function runTests() {
  const os = await import("node:os");
  const path = await import("node:path");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-file-"));
  const good = [
    "// demo \u2014 a starter service file: comments may lead, then ONE data assignment",
    "module.exports = {",
    '  name: "demo",',
    '  advert: { what: "a demo", karma: 2 },',
    '  provider: { name: "python demo" },',
    '  pages: { ad: `<h1>demo</h1><img src="data:image/png;base64,iVBORw0KGgo=">`, inputs: `<h1>in</h1>` },',
    "};"
  ].join("\n");
  const goodPath = path.join(dir, "demo.js");
  fs.writeFileSync(goodPath, good);
  const loadGood = loadServiceFile(goodPath);
  ok("a real good file loads as data", loadGood.definition !== null && loadGood.error === null, String(loadGood.error));
  ok("the pages ride out as strings", typeof loadGood.definition?.pages?.ad === "string" && loadGood.definition.pages.ad.includes("<h1>demo</h1>") && loadGood.definition.pages.inputs.includes("<h1>in</h1>"));
  const requires = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, evil: require("fs") };';
  ok("a require() is refused as code", (loadServiceText(requires).error ?? "").includes("require("));
  const interpolates = 'module.exports = { name: "x", page: `<p>${process.env.SECRET}</p>`, advert: { what: "x" }, provider: { name: "x" } };';
  ok("a ${ interpolation is refused", (loadServiceText(interpolates).error ?? "").includes("${"));
  const fnValue = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, hand: (function(){ return 1; }) };';
  ok("a function value is refused with its path", (loadServiceText(fnValue).error ?? "").includes("$.hand"));
  const notAFile = 'export default { name: "x" };';
  ok("a foreign shape is refused", (loadServiceText(notAFile).error ?? "").includes("module.exports"));
  ok("empty text is refused", (loadServiceText("   ").error ?? "").includes("empty"));
  const brokenLiteral = 'module.exports = { name: "x", page: "<p>x</p>", ;';
  ok("a broken literal is refused with the load error", (loadServiceText(brokenLiteral).error ?? "").includes("did not load"));
  const double = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" } };\nmodule.exports = { name: "y" };';
  ok("a second assignment is refused", (loadServiceText(double).error ?? "").includes("exactly one"));
  const mentionsInComment = '// this file assigns module.exports once \u2014 that sentence must not break the count\nmodule.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" } };';
  ok("a comment may mention the phrase", loadServiceText(mentionsInComment).error === null, String(loadServiceText(mentionsInComment).error));
  const invalid = 'module.exports = { name: "", page: "" };';
  const invalidPath = path.join(dir, "invalid.js");
  fs.writeFileSync(invalidPath, invalid);
  const loadInvalid = loadServiceFile(invalidPath);
  ok("an invalid definition is refused with its fields", loadInvalid.definition === null && (loadInvalid.error ?? "").includes("name"));
  const missing = loadServiceFile(path.join(dir, "nowhere.js"));
  ok("a missing file is refused, not thrown", missing.definition === null && (missing.error ?? "").includes("cannot read"));
  const sneak = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, probe: (typeof process === "undefined" ? 1 : 2) };';
  const sneakLoad = loadServiceText(sneak);
  ok("the sandbox has no process (age 1, not 2)", sneakLoad.error === null && sneakLoad.value.probe === 1, String(sneakLoad.error));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[serviceFile] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  CODE_TOKENS,
  findRefusedValue,
  loadServiceFile,
  loadServiceText,
  runTests
};
//# sourceMappingURL=serviceFile.js.map
