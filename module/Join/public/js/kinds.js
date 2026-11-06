import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const KINDS_FILE = "kinds.json";
function builtinKinds() {
  const b = (name, hasPort, hasStart, what) => ({ name, hasPort, hasStart, what, source: "built-in" });
  return [
    b("door", true, true, "a module with its own little api on its own port"),
    b("shell", false, true, "the one window \u2014 no port of its own"),
    b("catalog", false, true, "a list of what this node can do"),
    b("service", false, true, "a capability that runs on demand \u2014 offered, not always up"),
    b("agent", false, true, "a code thread you can talk to"),
    b("app", false, true, "a program with a page or a window"),
    b("tool", false, true, "a one-shot command with an answer"),
    b("plugin", false, true, "code that attaches to a door it does not own"),
    b("mcp", false, false, "an agent door (MCP endpoint) that lives somewhere else"),
    b("node", false, false, "another machine on the network"),
    b("storage", false, false, "a place data lives \u2014 a share, a folder, a bucket")
  ];
}
function normalizeKind(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(s)) return null;
  return s;
}
function readBool(raw, fallback) {
  return typeof raw === "boolean" ? raw : fallback;
}
function readKindFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.kinds) ? parsed.kinds : [];
    return list.filter((k) => !!k && typeof k === "object");
  } catch {
    return [];
  }
}
function loadKinds(kindsFile) {
  const byName = /* @__PURE__ */ new Map();
  for (const k of builtinKinds()) byName.set(k.name, k);
  if (kindsFile) {
    for (const raw of readKindFile(kindsFile)) {
      const name = normalizeKind(raw.name);
      if (!name) continue;
      const existing = byName.get(name);
      byName.set(name, {
        name,
        hasPort: readBool(raw.hasPort, existing?.hasPort ?? true),
        hasStart: readBool(raw.hasStart, existing?.hasStart ?? true),
        what: typeof raw.what === "string" && raw.what.trim() ? raw.what.trim() : existing?.what ?? `${name} \u2014 declared by ${KINDS_FILE}`,
        source: "file"
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
function kindOf(name, kinds) {
  const n = normalizeKind(name);
  if (!n) return null;
  return kinds.find((k) => k.name === n) ?? null;
}
function writeKinds(kindsFile, kinds) {
  fs.mkdirSync(path.dirname(kindsFile), { recursive: true });
  fs.writeFileSync(kindsFile, JSON.stringify({ kinds }, null, 2) + "\n", "utf8");
}
function runTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "join-kinds-"));
  try {
    console.assert(builtinKinds().some((k) => k.name === "door" && k.hasPort), "a door has a port");
    console.assert(builtinKinds().some((k) => k.name === "shell" && !k.hasPort), "a shell does not");
    console.assert(builtinKinds().every((k) => k.what.length > 10), "every kind explains itself");
    console.assert(normalizeKind("Board") === "board", "a kind is normalised to lowercase");
    console.assert(normalizeKind("  node  ") === "node", "whitespace is not a kind");
    console.assert(normalizeKind("weird thing") === "weird-thing", "spaces become dashes");
    console.assert(normalizeKind("") === null && normalizeKind(7) === null, "junk is refused, not coerced");
    console.assert(normalizeKind("-bad") === null, "a leading dash is not a name");
    const file = path.join(root, KINDS_FILE);
    const before = loadKinds(file).length;
    console.assert(before === builtinKinds().length, "no file = exactly the built-ins", String(before));
    writeKinds(file, [
      { name: "board", hasPort: false, hasStart: false, what: "a kanban board that publishes itself" },
      { name: "door", hasPort: true, hasStart: false, what: "a door that never needs starting (file override)" },
      { name: "bogus name!", what: "must be skipped" }
    ]);
    const after = loadKinds(file);
    console.assert(
      after.length === before + 1,
      "a NEW kind is added by file alone \u2014 no code change",
      String(after.length)
    );
    console.assert(kindOf("board", after)?.hasPort === false, "the new kind declares no port");
    console.assert(kindOf("board", after)?.source === "file", "and says a file gave it");
    console.assert(kindOf("door", after)?.hasStart === false, "a file may override a built-in");
    console.assert(kindOf("bogus name!", after) === null, "an invalid name never enters the catalog");
    console.assert(kindOf("nothing-here", after) === null, "an unknown kind is null, not invented");
    console.assert(loadKinds(path.join(root, "nope.json")).length === before, "a missing file is not a crash");
    fs.writeFileSync(file, "{ not json", "utf8");
    console.assert(loadKinds(file).length === before, "a broken file falls back to built-ins");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export {
  KINDS_FILE,
  builtinKinds,
  kindOf,
  loadKinds,
  normalizeKind,
  runTests,
  writeKinds
};
//# sourceMappingURL=kinds.js.map
