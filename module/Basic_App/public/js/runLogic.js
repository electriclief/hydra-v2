function isLive(record) {
  if (record.endedAt !== null && record.endedAt !== void 0) return false;
  const life = String(record.life ?? "").toLowerCase();
  return life === "starting" || life === "running" || life === "live";
}
function busyFrom(records, tag = "basic") {
  return records.find((r) => r.tag === tag && isLive(r)) ?? null;
}
function buildContext(def, values) {
  const context = {};
  for (const v of def.variables?.init ?? []) {
    if (v && typeof v.name === "string") context[v.name] = v.default ?? "";
  }
  for (const v of def.variables?.input ?? []) {
    if (v && typeof v.name === "string" && v.name in values) context[v.name] = values[v.name];
  }
  return context;
}
function buildValues(def, provided) {
  const values = {};
  const missing = [];
  for (const v of def.variables?.input ?? []) {
    if (!v || typeof v.name !== "string") continue;
    const raw = v.name in provided ? provided[v.name] : v.default;
    const empty = raw === void 0 || raw === null || raw === "";
    if (empty && v.required === true) missing.push(v.name);
    values[v.name] = empty && v.default !== void 0 ? v.default : raw;
  }
  return { values, missing };
}
function resolveTokens(template, context) {
  const unknown = [];
  const text = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => {
    if (name in context) {
      const v = context[name];
      return v === void 0 || v === null ? "" : String(v);
    }
    unknown.push(name);
    return whole;
  });
  return { text, unknown };
}
function resolveLaunch(def, values) {
  const launch = def.provider?.launch;
  if (typeof launch !== "string" || !launch.trim()) return { command: null, missing: ["provider.launch"] };
  const { text, unknown } = resolveTokens(launch, buildContext(def, values));
  return { command: text, missing: unknown };
}
function buildBookInput(def, gpuName, runId) {
  const needs = def.needs ?? {};
  const diskGb = typeof needs.diskGb === "number" ? needs.diskGb : null;
  return {
    service: def.name,
    gpu: needs.gpu === true ? gpuName : null,
    cores: typeof needs.cores === "number" ? needs.cores : null,
    ramMb: typeof needs.ramMb === "number" ? needs.ramMb : null,
    diskMb: diskGb === null ? null : Math.round(diskGb * 1024),
    note: "basic app run",
    run: runId ?? null
  };
}
function freshOutputPath(path, exists) {
  const p = String(path ?? "").trim();
  if (!p) return p;
  if (!exists(p)) return p;
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dot = p.lastIndexOf(".");
  const hasExt = dot > slash + 1;
  const stem = hasExt ? p.slice(0, dot) : p;
  const ext = hasExt ? p.slice(dot) : "";
  for (let n = 2; n < 1e3; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
function lazyOutputs(def, values, exists) {
  const changed = [];
  const out = { ...values };
  for (const v of def.variables?.input ?? []) {
    if (!v || v.role !== "output" || typeof v.name !== "string") continue;
    const current = out[v.name];
    if (typeof current !== "string" || !current.trim()) continue;
    const fresh = freshOutputPath(current, exists);
    if (fresh !== current) {
      out[v.name] = fresh;
      changed.push({ name: v.name, from: current, to: fresh });
    }
  }
  return { values: out, changed };
}
function inputFields(def) {
  return (def.variables?.input ?? []).filter((v) => !!v && typeof v.name === "string");
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL runLogic :: ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const def = {
    name: "demo",
    provider: { name: "app", launch: 'run -m {{model}} -p "{{prompt}}" -o {{out}} -n {{missing_token}}' },
    variables: {
      init: [{ name: "model", default: "C:/models/a.gguf" }],
      input: [
        { name: "prompt", type: "textarea", required: true },
        { name: "out", type: "text", default: "C:/out/img.png", role: "output" },
        { name: "steps", type: "number", default: 20 }
      ]
    },
    needs: { gpu: true, vramGb: 4, ramMb: 4e3, cores: 4, diskGb: 2 }
  };
  const filled = buildValues(def, { prompt: "a cat" });
  ok("defaults fill the values", filled.values.model === void 0 && filled.values.steps === 20 && filled.missing.length === 0);
  const missing = buildValues(def, {});
  ok("a required input left empty is named", missing.missing.includes("prompt"));
  const launch = resolveLaunch(def, { prompt: "a cat", out: "C:/out/img.png" });
  ok("the launch resolves init + inputs", launch.command === 'run -m C:/models/a.gguf -p "a cat" -o C:/out/img.png -n {{missing_token}}');
  ok("an unknown token stays visible and is reported", launch.missing.includes("missing_token"));
  const book = buildBookInput(def, "RX 6800", "r-1");
  ok("the book carries the needs", book.service === "demo" && book.gpu === "RX 6800" && book.ramMb === 4e3 && book.diskMb === 2048 && book.run === "r-1");
  const bookNoGpu = buildBookInput({ name: "x", needs: { gpu: false } }, "RX 6800");
  ok("a gpu-less service books no gpu", bookNoGpu.gpu === null);
  const taken = /* @__PURE__ */ new Set(["C:/out/img.png", "C:/out/img-2.png"]);
  const fresh = freshOutputPath("C:/out/img.png", (p) => taken.has(p));
  ok("the lazy rule steps past taken names", fresh === "C:/out/img-3.png");
  const free = freshOutputPath("C:/out/new.png", (p) => taken.has(p));
  ok("a free name is left alone", free === "C:/out/new.png");
  const takenNoExt = /* @__PURE__ */ new Set(["C:/out/img"]);
  const noExt = freshOutputPath("C:/out/img", (p) => takenNoExt.has(p));
  ok("a no-extension path still gets a suffix", noExt === "C:/out/img-2");
  const lazy = lazyOutputs(def, { prompt: "a cat", out: "C:/out/img.png" }, (p) => taken.has(p));
  ok("lazyOutputs rewrites the output and reports it", lazy.values.out === "C:/out/img-3.png" && lazy.changed.length === 1);
  const live = { id: "a", name: "n", tag: "basic", life: "running", endedAt: null };
  const dead = { id: "b", name: "n", tag: "basic", life: "ended", endedAt: 123 };
  const busy = busyFrom([dead, live]);
  ok("busy picks the live one", busy !== null && busy.id === "a");
  ok("no live = not busy", busyFrom([dead]) === null);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[runLogic] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  buildBookInput,
  buildContext,
  buildValues,
  busyFrom,
  freshOutputPath,
  inputFields,
  isLive,
  lazyOutputs,
  resolveLaunch,
  resolveTokens,
  runTests
};
//# sourceMappingURL=runLogic.js.map
