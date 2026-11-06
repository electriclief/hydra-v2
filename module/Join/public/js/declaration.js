import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kindOf, loadKinds, normalizeKind } from "./kinds.js";
const DECLARATION_FILE = "join.json";
const PACKAGE_FILE = "package.json";
function readKind(raw, kinds) {
  const kind = normalizeKind(raw);
  if (!kind) return { kind: null, known: false };
  return { kind, known: kindOf(kind, kinds) !== null };
}
function readPort(raw) {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw < 65536) return raw;
  if (typeof raw === "string" && /^\d{4}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n > 0 && n < 65536) return n;
  }
  return null;
}
function readDeclaration(moduleDir, options = {}) {
  const kinds = options.kinds ?? loadKinds();
  const sources = {};
  const raw = {};
  const declPath = path.join(moduleDir, DECLARATION_FILE);
  if (fs.existsSync(declPath)) {
    const text = fs.readFileSync(declPath, "utf8");
    try {
      Object.assign(raw, JSON.parse(text));
      for (const k of Object.keys(raw)) sources[k] = DECLARATION_FILE;
    } catch {
      sources.kind = `${DECLARATION_FILE} (unreadable \u2014 refused)`;
    }
  }
  const pkgPath = path.join(moduleDir, PACKAGE_FILE);
  let pkgDescription;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg.description === "string" && pkg.description.trim()) {
        pkgDescription = pkg.description.trim();
        sources.what = PACKAGE_FILE;
      }
    } catch {
    }
  }
  const { kind, known: kindKnown } = readKind(raw.kind, kinds);
  const spec = kind ? kindOf(kind, kinds) : null;
  const port = readPort(raw.port);
  let effectivePort = port;
  if (spec && !spec.hasPort && port !== null) {
    sources.port = `${DECLARATION_FILE} (a ${spec.name} has no port \u2014 refused)`;
    effectivePort = null;
  }
  const missing = [];
  if (kind === null) missing.push("kind");
  if (kind === null || spec?.hasStart) {
    if (raw.start === void 0 || raw.start === null) missing.push("start");
  }
  if (kind === null || kind === "door" || kind === "shell" || kind === "catalog") {
    if (raw.wiredAtBoot === void 0 || raw.wiredAtBoot === null) missing.push("wiredAtBoot");
  }
  if ((spec?.hasPort ?? kind === "door") && effectivePort === null && !raw.url) missing.push("port");
  if (pkgDescription === void 0 && raw.what === void 0) missing.push("what");
  const textList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(moduleDir),
    kind: kind ?? "door",
    // documented fallback — and `missing` still says kind was not declared
    port: effectivePort,
    start: typeof raw.start === "string" && raw.start.trim() ? raw.start.trim() : null,
    wiredAtBoot: raw.wiredAtBoot === true,
    what: typeof raw.what === "string" && raw.what.trim() ? raw.what.trim() : pkgDescription ?? "",
    sources,
    missing,
    url: typeof raw.url === "string" && raw.url.trim() ? raw.url.trim() : null,
    probe: raw.probe && typeof raw.probe === "object" && typeof raw.probe.path === "string" ? raw.probe : null,
    deps: textList(raw.deps),
    provides: textList(raw.provides),
    tags: textList(raw.tags),
    meta: raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? raw.meta : {},
    kindKnown,
    origin: "file"
  };
}
function inferDeclaration(moduleDir) {
  const name = path.basename(moduleDir);
  const pkgPath = path.join(moduleDir, PACKAGE_FILE);
  let what = "";
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg.description === "string") what = pkg.description.trim();
    } catch {
    }
  }
  return {
    name,
    kind: "door",
    port: null,
    start: null,
    wiredAtBoot: false,
    what,
    sources: { name: "folder name (inferred)", kind: "DEFAULT \u2014 undeclared", what: PACKAGE_FILE },
    missing: ["kind", "port", "start", "wiredAtBoot"],
    url: null,
    probe: null,
    deps: [],
    provides: [],
    tags: [],
    meta: {},
    kindKnown: false,
    origin: "file"
  };
}
function readShelf(shelfRoot, options = {}) {
  const kinds = options.kinds ?? loadKinds();
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(shelfRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const dir = path.join(shelfRoot, e.name);
    const hasDecl = fs.existsSync(path.join(dir, DECLARATION_FILE));
    out.push(hasDecl ? readDeclaration(dir, { kinds }) : inferDeclaration(dir));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
function writeDeclaration(moduleDir, decl) {
  fs.writeFileSync(path.join(moduleDir, DECLARATION_FILE), JSON.stringify(decl, null, 2) + "\n", "utf8");
}
function runTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "join-decl-"));
  try {
    const door = path.join(root, "State");
    fs.mkdirSync(door, { recursive: true });
    fs.writeFileSync(path.join(door, "package.json"), JSON.stringify({ description: "state: the generic retainer" }), "utf8");
    writeDeclaration(door, { name: "State", kind: "door", port: 8127, start: "node public/js/main.js", wiredAtBoot: true });
    const shell = path.join(root, "Electron_Wrapper");
    fs.mkdirSync(shell, { recursive: true });
    fs.writeFileSync(path.join(shell, "package.json"), JSON.stringify({ description: "the one window" }), "utf8");
    writeDeclaration(shell, { name: "Electron_Wrapper", kind: "shell", port: 8088, start: "electron window/main.cjs", wiredAtBoot: true });
    const bare = path.join(root, "Mystery");
    fs.mkdirSync(bare, { recursive: true });
    fs.writeFileSync(path.join(bare, "package.json"), JSON.stringify({ description: "never declared" }), "utf8");
    const shelf = readShelf(root);
    console.assert(shelf.length === 3, "every folder appears, declared or not", String(shelf.length));
    const st = shelf.find((d) => d.name === "State");
    console.assert(st?.kind === "door" && st?.port === 8127, "a declared door keeps its port", String(st?.port));
    console.assert(st?.wiredAtBoot === true, "wiredAtBoot is read");
    console.assert(st?.start === "node public/js/main.js", "the start command is read");
    console.assert(st?.missing.length === 0, "a complete declaration declares nothing missing", JSON.stringify(st?.missing));
    console.assert(st?.what.includes("generic retainer"), "the human sentence comes from package.json");
    const ew = shelf.find((d) => d.name === "Electron_Wrapper");
    console.assert(ew?.kind === "shell", "the shell keeps its kind");
    console.assert(ew?.port === null, "A SHELL HAS NO PORT \u2014 a declared one is refused", String(ew?.port));
    console.assert(String(ew?.sources.port ?? "").includes("refused"), "the refusal says itself", ew?.sources.port);
    const my = shelf.find((d) => d.name === "Mystery");
    console.assert(my !== void 0, 'an undeclared module is never "not found"');
    console.assert(my?.port === null, "an undeclared module guesses no port");
    console.assert(
      my?.missing.includes("kind") && my?.missing.includes("port"),
      "what it does not know stays visible",
      JSON.stringify(my?.missing)
    );
    console.assert(
      String(my?.sources.kind ?? "").includes("DEFAULT"),
      "an inferred fact is marked as inferred",
      my?.sources.kind
    );
    const odd = path.join(root, "Odd");
    fs.mkdirSync(odd, { recursive: true });
    writeDeclaration(odd, { kind: "door", port: "eighty" });
    const od = readDeclaration(odd);
    console.assert(od.port === null && od.missing.includes("port"), "a bad port string is refused", String(od.port));
    console.assert(od.port === null && od.missing.includes("port"), "a bad port is refused", String(od.port));
    console.assert(readShelf(path.join(root, "does-not-exist")).length === 0, "an absent shelf is empty, not a crash");
    const board = path.join(root, "Board");
    fs.mkdirSync(board, { recursive: true });
    writeDeclaration(board, { kind: "board", what: "a kanban board that publishes itself", deps: ["State"], tags: ["ui"] });
    const bd = readDeclaration(board);
    console.assert(bd.kind === "board", "an UNKNOWN kind keeps its own name (not coerced to door)", bd.kind);
    console.assert(bd.kindKnown === false, "and is marked as not in the catalog", String(bd.kindKnown));
    console.assert(!bd.missing.includes("kind"), "an unknown kind is not a MISSING kind", JSON.stringify(bd.missing));
    console.assert((bd.deps ?? []).join(",") === "State" && (bd.tags ?? []).join(",") === "ui", "deps and tags are read");
    const relay = path.join(root, "Relay");
    fs.mkdirSync(relay, { recursive: true });
    writeDeclaration(relay, { kind: "node", url: "http://192.168.1.100:8111", what: "the main node" });
    const rl = readDeclaration(relay);
    console.assert(rl.kind === "node" && rl.kindKnown === true, "a catalogued kind is known", `${rl.kind}/${rl.kindKnown}`);
    console.assert(rl.url === "http://192.168.1.100:8111", "a node keeps its url");
    console.assert(rl.missing.length === 0, "a node with a url declares NOTHING missing", JSON.stringify(rl.missing));
    console.assert(rl.port === null, "and holds no port");
    writeDeclaration(relay, { kind: "node", port: 9e3, url: "http://192.168.1.100:8111" });
    const rl2 = readDeclaration(relay);
    console.assert(
      rl2.port === null && String(rl2.sources.port).includes("refused"),
      "a node with a port is refused, and says so",
      String(rl2.sources.port)
    );
    const kindsFile = path.join(root, "kinds.json");
    fs.writeFileSync(kindsFile, JSON.stringify({ kinds: [{ name: "board", hasPort: false, hasStart: false, what: "a board" }] }), "utf8");
    const withFile = readDeclaration(board, { kinds: loadKinds(kindsFile) });
    console.assert(withFile.kindKnown === true, "a kind added by FILE becomes known", String(withFile.kindKnown));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
export {
  inferDeclaration,
  readDeclaration,
  readShelf,
  runTests,
  writeDeclaration
};
//# sourceMappingURL=declaration.js.map
