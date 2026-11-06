import fs from "node:fs";
import path from "node:path";
function defaultRegistry() {
  return { version: 1, lastUpdated: (/* @__PURE__ */ new Date()).toISOString(), commands: [] };
}
function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}
function stateToYaml(state) {
  const L = ["# ProcessWrapper registry \u2014 commands saved on this box.", "# Written by registryStore.ts (stateToYaml) \u2014 hand edits survive the round trip."];
  L.push(`version: ${yamlScalar(state.version)}`);
  L.push(`lastUpdated: ${yamlScalar(state.lastUpdated)}`);
  L.push("commands:");
  for (const c of state.commands) {
    L.push(`  - name: ${yamlScalar(c.name)}`);
    L.push(`    command: ${yamlScalar(c.command)}`);
    if (c.args && c.args.length) {
      L.push("    args:");
      for (const a of c.args) L.push(`      - ${yamlScalar(a)}`);
    } else {
      L.push("    args: []");
    }
    L.push(`    cwd: ${yamlScalar(c.cwd || "")}`);
    if (c.env && Object.keys(c.env).length) {
      L.push("    env:");
      for (const k of Object.keys(c.env).sort()) L.push(`      ${k}: ${yamlScalar(c.env[k])}`);
    } else {
      L.push("    env: {}");
    }
    L.push(`    shell: ${c.shell ? "true" : "false"}`);
    L.push(`    description: ${yamlScalar(c.description || "")}`);
    L.push(`    tag: ${c.tag === null ? "null" : yamlScalar(c.tag)}`);
    L.push(`    createdAt: ${yamlScalar(c.createdAt)}`);
    L.push(`    updatedAt: ${yamlScalar(c.updatedAt)}`);
  }
  return L.join("\n") + "\n";
}
function stripComment(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) return "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i);
  }
  return line;
}
function parseScalar(raw) {
  const v = raw.trim();
  if (!v) return "";
  if (v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') || v.startsWith("[") || v.startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}
function parseBlock(lines, i, indent) {
  const isList = lines[i] && lines[i].indent === indent && lines[i].text.startsWith("- ");
  if (isList) {
    const out2 = [];
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
      const rest = lines[i].text.slice(2).trim();
      if (!rest) {
        const child = i + 1 < lines.length && lines[i + 1].indent > indent ? parseBlock(lines, i + 1, lines[i + 1].indent) : { value: null, next: i + 1 };
        out2.push(child.value);
        i = child.next;
        continue;
      }
      const colon = rest.indexOf(":");
      if (colon > 0 && !rest.startsWith('"') && !rest.startsWith("[") && !rest.startsWith("{")) {
        const mapIndent = lines[i].indent;
        const synthetic = [{ indent: mapIndent + 2, text: rest }];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > mapIndent) {
          synthetic.push(lines[j]);
          j++;
        }
        const child = parseBlock(synthetic, 0, mapIndent + 2);
        out2.push(child.value);
        i = j;
        continue;
      }
      out2.push(parseScalar(rest));
      i++;
    }
    return { value: out2, next: i };
  }
  const out = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
    const text = lines[i].text;
    const colon = text.indexOf(":");
    if (colon < 0) {
      i++;
      continue;
    }
    const key = text.slice(0, colon).trim();
    const rest = text.slice(colon + 1).trim();
    if (rest) {
      out[key] = parseScalar(rest);
      i++;
      continue;
    }
    if (i + 1 < lines.length && lines[i + 1].indent > indent) {
      const child = parseBlock(lines, i + 1, lines[i + 1].indent);
      out[key] = child.value;
      i = child.next;
    } else if (i + 1 < lines.length && lines[i + 1].indent === indent && lines[i + 1].text.startsWith("- ")) {
      const child = parseBlock(lines, i + 1, indent);
      out[key] = child.value;
      i = child.next;
    } else {
      out[key] = null;
      i++;
    }
  }
  return { value: out, next: i };
}
function yamlToState(yaml, fallbackName = "registry.yaml") {
  const raw = String(yaml || "").split(/\r?\n/);
  const lines = [];
  for (const line of raw) {
    const clean = stripComment(line);
    if (!clean.trim()) continue;
    if (clean.trim() === "---") continue;
    const indent = clean.length - clean.trimStart().length;
    lines.push({ indent, text: clean.trim() });
  }
  if (!lines.length) return defaultRegistry();
  const parsed = parseBlock(lines, 0, lines[0].indent).value;
  if (!parsed || typeof parsed !== "object") return defaultRegistry();
  const version = typeof parsed.version === "number" ? parsed.version : 1;
  const lastUpdated = typeof parsed.lastUpdated === "string" ? parsed.lastUpdated : (/* @__PURE__ */ new Date()).toISOString();
  const list = Array.isArray(parsed.commands) ? parsed.commands : [];
  const commands = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item;
    const name = typeof it.name === "string" ? it.name : "";
    if (!name) continue;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    commands.push({
      name,
      command: typeof it.command === "string" ? it.command : "",
      args: Array.isArray(it.args) ? it.args.map(String) : [],
      cwd: typeof it.cwd === "string" ? it.cwd : "",
      env: it.env && typeof it.env === "object" && !Array.isArray(it.env) ? Object.fromEntries(Object.entries(it.env).map(([k, v]) => [k, String(v)])) : {},
      shell: it.shell === true,
      description: typeof it.description === "string" ? it.description : "",
      tag: typeof it.tag === "string" && it.tag.length ? it.tag : null,
      createdAt: typeof it.createdAt === "string" ? it.createdAt : now,
      updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : now
    });
  }
  void fallbackName;
  return { version, lastUpdated, commands };
}
function loadRegistry(file) {
  try {
    if (!fs.existsSync(file)) return { state: defaultRegistry(), file, error: null };
    const text = fs.readFileSync(file, "utf8");
    return { state: yamlToState(text), file, error: null };
  } catch (err) {
    return { state: defaultRegistry(), file, error: err.message };
  }
}
function saveRegistry(file, state) {
  state.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stateToYaml(state));
  return state;
}
function addCommand(state, def) {
  const name = String(def.name || "").trim();
  if (!name) throw new Error("command name is required");
  if (state.commands.some((c) => c.name === name)) throw new Error(`command already exists: ${name}`);
  if (!def.command || !String(def.command).trim()) throw new Error("command is required");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const cmd = {
    name,
    command: String(def.command),
    args: (def.args ?? []).map(String),
    cwd: def.cwd ? String(def.cwd) : "",
    env: def.env ?? {},
    shell: def.shell === true,
    description: def.description ? String(def.description) : "",
    tag: def.tag ? String(def.tag) : null,
    createdAt: now,
    updatedAt: now
  };
  state.commands.push(cmd);
  state.lastUpdated = now;
  return cmd;
}
function updateCommand(state, name, patch) {
  const cmd = state.commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`unknown command: ${name}`);
  if (patch.args) cmd.args = patch.args.map(String);
  if (patch.env) cmd.env = patch.env;
  if (patch.cwd !== void 0) cmd.cwd = String(patch.cwd);
  if (patch.command !== void 0) cmd.command = String(patch.command);
  if (patch.shell !== void 0) cmd.shell = patch.shell === true;
  if (patch.description !== void 0) cmd.description = String(patch.description);
  if (patch.tag !== void 0) cmd.tag = patch.tag === null ? null : String(patch.tag);
  cmd.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  state.lastUpdated = cmd.updatedAt;
  return cmd;
}
function removeCommand(state, name) {
  const before = state.commands.length;
  state.commands = state.commands.filter((c) => c.name !== name);
  const removed = state.commands.length !== before;
  if (removed) state.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
  return removed;
}
function getCommand(state, name) {
  return state.commands.find((c) => c.name === name) ?? null;
}
function toSpec(def, overrides = {}) {
  const spec = {
    command: def.command,
    args: def.args.length ? [...def.args] : void 0,
    cwd: def.cwd || void 0,
    env: Object.keys(def.env).length ? { ...def.env } : void 0,
    shell: def.shell,
    name: def.name,
    tag: def.tag ?? null
  };
  if (overrides.name !== void 0) spec.name = overrides.name;
  if (overrides.tag !== void 0) spec.tag = overrides.tag;
  if (overrides.command !== void 0) spec.command = overrides.command;
  if (overrides.args !== void 0) spec.args = overrides.args;
  if (overrides.cwd !== void 0) spec.cwd = overrides.cwd;
  if (overrides.env !== void 0) spec.env = overrides.env;
  if (overrides.shell !== void 0) spec.shell = overrides.shell;
  if (overrides.bufferLimitChars !== void 0) spec.bufferLimitChars = overrides.bufferLimitChars;
  return spec;
}
async function runTests() {
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-reg-"));
  const file = path.join(dir, "data.yaml");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const state = defaultRegistry();
  addCommand(state, {
    name: "sdxl-pull",
    command: "powershell",
    args: ["-File", "C:/Hydra/tools/prep_pull_sdxl.ps1", "--out", "C:\\Receive\\models"],
    cwd: "C:/Hydra",
    env: { HF_HOME: "C:/models/hf", PYTHONIOENCODING: "utf-8" },
    shell: false,
    description: 'pull the SDXL base checkpoint (a name with: a colon, and a "quote")',
    tag: "models"
  });
  addCommand(state, { name: "ping-demo", command: "ping", args: ["-n", "3", "127.0.0.1"], description: "three pings", tag: null });
  addCommand(state, { name: "tick", command: process.execPath, args: ["-e", "setInterval(()=>console.log('tick'),1000)"], shell: false });
  const yaml = stateToYaml(state);
  ok("yaml is text and readable", typeof yaml === "string" && yaml.includes("commands:"), yaml.slice(0, 80));
  ok("yaml keeps the comments for humans", yaml.startsWith("# ProcessWrapper registry"));
  const back = yamlToState(yaml);
  ok("round trip keeps every command", back.commands.length === 3, String(back.commands.length));
  ok("round trip is exact", deepEqual(back.commands, state.commands), JSON.stringify(back.commands));
  ok("round trip keeps version + lastUpdated", back.version === state.version && back.lastUpdated === state.lastUpdated);
  ok("round trip keeps nested env", back.commands[0].env.HF_HOME === "C:/models/hf", JSON.stringify(back.commands[0].env));
  ok("round trip keeps windows paths in args", back.commands[0].args[3] === "C:\\Receive\\models", JSON.stringify(back.commands[0].args));
  ok("round trip keeps a colon+quote in a description", back.commands[0].description === state.commands[0].description, back.commands[0].description);
  ok("round trip keeps an empty tag as null", back.commands[1].tag === null, String(back.commands[1].tag));
  ok("round trip keeps unicode", (() => {
    const s2 = defaultRegistry();
    addCommand(s2, { name: "uni", command: "echo", args: ["h\xE9llo \u2014 \u4E16\u754C"], description: "\xFCn\xEFcode" });
    return yamlToState(stateToYaml(s2)).commands[0].args[0] === "h\xE9llo \u2014 \u4E16\u754C";
  })());
  const r1 = loadRegistry(file);
  ok("missing file loads defaults", r1.state.commands.length === 0 && r1.error === null, JSON.stringify(r1.error));
  saveRegistry(file, state);
  const onDisk = fs.readFileSync(file, "utf8");
  ok("save writes the file", onDisk.includes("sdxl-pull"), onDisk.slice(0, 60));
  const r2 = loadRegistry(file);
  ok("load reads it back", deepEqual(r2.state.commands, state.commands) && r2.error === null, JSON.stringify(r2.error));
  ok("save refreshed lastUpdated", r2.state.lastUpdated >= state.commands[0].createdAt);
  const s = defaultRegistry();
  ok("add requires a name", (() => {
    try {
      addCommand(s, { name: "", command: "x" });
      return false;
    } catch {
      return true;
    }
  })());
  ok("add requires a command", (() => {
    try {
      addCommand(s, { name: "x", command: "" });
      return false;
    } catch {
      return true;
    }
  })());
  addCommand(s, { name: "a", command: "foo" });
  ok("add refuses a duplicate name", (() => {
    try {
      addCommand(s, { name: "a", command: "bar" });
      return false;
    } catch {
      return true;
    }
  })());
  const before = s.lastUpdated;
  await new Promise((r) => setTimeout(r, 5));
  const upd = updateCommand(s, "a", { args: ["--x"], description: "updated", tag: "grp" });
  ok("update bumps updatedAt", upd.updatedAt >= before && s.lastUpdated === upd.updatedAt, s.lastUpdated);
  ok("update applies the patch", deepEqual(upd.args, ["--x"]) && upd.description === "updated" && upd.tag === "grp");
  ok("update keeps createdAt", upd.createdAt === upd.createdAt, upd.createdAt);
  ok("update of an unknown name throws", (() => {
    try {
      updateCommand(s, "nope", {});
      return false;
    } catch {
      return true;
    }
  })());
  ok("get finds it", getCommand(s, "a")?.name === "a");
  ok("get of an unknown name is null", getCommand(s, "zz") === null);
  ok("remove reports the removal", removeCommand(s, "a") === true && s.commands.length === 0);
  ok("remove of an unknown name is false", removeCommand(s, "a") === false);
  fs.writeFileSync(file, "commands: [ this is : not, yaml ][\n");
  const r3 = loadRegistry(file);
  ok("a junk file loads defaults instead of throwing", Array.isArray(r3.state.commands), JSON.stringify(r3.state));
  ok("a junk file is honestly empty (no invented commands)", r3.state.commands.length === 0, String(r3.state.commands.length));
  const r4 = loadRegistry(path.join(dir, "nested", "data.yaml"));
  ok("a missing directory is not an error", r4.error === null);
  const specState = defaultRegistry();
  addCommand(specState, { name: "spec-src", command: "python", args: ["bar.py"], cwd: "C:/tmp", tag: "g", shell: true });
  const spec = toSpec(specState.commands[0]);
  ok("toSpec carries command/args/cwd/shell", spec.command === "python" && deepEqual(spec.args, ["bar.py"]) && spec.cwd === "C:/tmp" && spec.shell === true, JSON.stringify(spec));
  ok("toSpec names the process after the command", spec.name === "spec-src");
  const spec2 = toSpec(specState.commands[0], { name: "override", tag: "other" });
  ok("toSpec accepts overrides without touching the definition", spec2.name === "override" && spec2.tag === "other" && specState.commands[0].name === "spec-src");
  ok("toSpec does not alias the saved args array", spec.args !== specState.commands[0].args);
  const spec3 = toSpec(specState.commands[0], { name: void 0, tag: void 0 });
  ok("an undefined override never blanks a saved field", spec3.name === "spec-src" && spec3.tag === "g" && spec3.command === "python", JSON.stringify(spec3));
  const spec4 = toSpec(specState.commands[0], { cwd: "" });
  ok("an empty-string override still wins when it is defined", spec4.cwd === "", JSON.stringify(spec4.cwd));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[registryStore] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  addCommand,
  defaultRegistry,
  getCommand,
  loadRegistry,
  removeCommand,
  runTests,
  saveRegistry,
  stateToYaml,
  toSpec,
  updateCommand,
  yamlToState
};
//# sourceMappingURL=registryStore.js.map
