import fs from "node:fs";
import path from "node:path";
import { summarizeService } from "./serviceSchema.js";
import { loadServiceFile } from "./serviceFile.js";
function createServiceCatalog(options) {
  const dir = path.resolve(options.dir);
  let entries = [];
  const stem = (file) => path.basename(file).replace(/\.js$/, "");
  function reload() {
    const loadedAt = (/* @__PURE__ */ new Date()).toISOString();
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((name) => name.endsWith(".js")).sort();
    } catch {
    }
    const fresh = files.map((name) => {
      const file = path.join(dir, name);
      const result = loadServiceFile(file);
      return {
        name: result.definition?.name ?? stem(file),
        file,
        ok: result.definition !== null,
        definition: result.definition,
        errors: result.report.errors.slice(),
        warnings: result.report.warnings.slice(),
        loadedAt
      };
    });
    const byName = /* @__PURE__ */ new Map();
    for (const entry of fresh) {
      const list2 = byName.get(entry.name) ?? [];
      list2.push(entry);
      byName.set(entry.name, list2);
    }
    for (const [name, list2] of byName) {
      if (list2.length > 1) {
        const message = `duplicate service name "${name}" \u2014 ${list2.length} files claim it: ${list2.map((e) => path.basename(e.file)).join(", ")}`;
        for (const entry of list2) {
          entry.errors.push({ level: "error", field: "name", message });
          entry.ok = false;
          entry.definition = null;
        }
      }
    }
    entries = fresh;
    return entries;
  }
  function list(query) {
    const needle = (query ?? "").trim().toLowerCase();
    return entries.map(
      (entry) => entry.definition ? summarizeService(entry.definition, entry.file, entry.ok) : { name: entry.name, what: "", provider: "", modes: [], karma: null, output: null, children: 0, ok: false, file: entry.file }
    ).filter((summary) => {
      if (!needle) return true;
      const haystack = [summary.name, summary.what, summary.provider, ...summary.modes].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }
  function get(name) {
    return entries.find((entry) => entry.ok && entry.name === name) ?? null;
  }
  function ad(name) {
    const entry = get(name);
    return entry?.definition ? String(entry.definition.pages?.ad) : null;
  }
  function inputs(name) {
    const entry = get(name);
    return entry?.definition ? String(entry.definition.pages?.inputs) : null;
  }
  const catalog = {
    dir,
    reload,
    list,
    get,
    ad,
    inputs,
    entries: () => entries,
    refusals: () => entries.filter((entry) => !entry.ok)
  };
  catalog.reload();
  return catalog;
}
async function runTests() {
  const os = await import("node:os");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-cat-"));
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const def = (name, what) => `module.exports = { name: "${name}", advert: { what: "${what}" }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>${name}</h1>", inputs: "<h1>in</h1>" } };`;
  write("a.js", def("resize", "resize an image"));
  write("b.js", def("render", "render a video"));
  write("bad.js", 'module.exports = { name: "", page: "" };');
  write("dup.js", def("resize", "the other resize"));
  const catalog = createServiceCatalog({ dir });
  ok("the catalog scans itself on creation", catalog.entries().length === 4, String(catalog.entries().length));
  ok("duplicates are refused on BOTH sides", catalog.entries().filter((e) => e.name === "resize" && !e.ok).length === 2);
  ok("the good one is untouched", catalog.get("render") !== null && catalog.get("render")?.definition?.advert.what === "render a video");
  ok("a refused name does not resolve", catalog.get("resize") === null);
  ok("refusals carry their reason", catalog.refusals().length === 3 && catalog.refusals().some((e) => e.errors.some((x) => x.message.includes("duplicate"))));
  const listed = catalog.list();
  ok("the listing carries shapes", listed.length === 4 && listed.every((s) => !("pages" in s) && !JSON.stringify(s).includes("<h1>")));
  ok("a filter narrows by name/provider/mode/what", catalog.list("video").length === 1 && catalog.list("video")[0].name === "render");
  ok("the ad page answers by name", (catalog.ad("render") ?? "").includes("<h1>render</h1>"));
  ok("the inputs page answers by name", (catalog.inputs("render") ?? "").includes("<h1>in</h1>"));
  ok("the pages refuse for unknown names", catalog.ad("nope") === null && catalog.inputs("nope") === null);
  write("c.js", def("tts", "speak a line"));
  catalog.reload();
  ok("a reload picks up a new file", catalog.entries().length === 5 && catalog.get("tts") !== null);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[serviceCatalog] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createServiceCatalog,
  runTests
};
//# sourceMappingURL=serviceCatalog.js.map
