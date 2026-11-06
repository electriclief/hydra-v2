import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const INCLUDE = [
  /^scripts\/[^/]+\.(ps1|py|cmd|sh)$/,
  /^module\/[^/]+\/help\.html$/,
  /^module\/[^/]+\/(join|package)\.json$/,
  /^module\/[^/]+\/[A-Za-z][A-Za-z_]*_module\.js$/,
  /^module\/[^/]+\/public\/[^/]+\.(html|css|js)$/,
  /^module\/[^/]+\/public\/(ts|js|css)\/.+\.(ts|js|css|map)$/,
  /^module\/Services\/services\/[^/]+\.js$/
];
const EXCLUDE = [
  /(^|\/)node_modules\//,
  /(^|\/)data\//,
  /(^|\/)\.shelf\//,
  /(^|\/)logs?\//,
  /\.log$/,
  /(^|\/)\.git\//
];
function inScope(relative) {
  const p = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.includes("..")) return false;
  if (EXCLUDE.some((r) => r.test(p))) return false;
  return INCLUDE.some((r) => r.test(p));
}
function walkShelf(root) {
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDE.some((r) => r.test(`${childRel}/`))) continue;
        walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (inScope(childRel)) out.push(childRel);
    }
  };
  walk(root, "");
  return out.sort();
}
function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function sha256File(abs) {
  return sha256Bytes(readFileSync(abs));
}
function revOf(files) {
  const text = [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\0${f.sha256}`).join("\n");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
function buildManifest(root, label = "") {
  const files = [];
  for (const rel of walkShelf(root)) {
    const abs = path.join(root, rel);
    try {
      const size = statSync(abs).size;
      files.push({ path: rel, size, sha256: sha256File(abs) });
    } catch {
    }
  }
  return {
    rev: revOf(files),
    label,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    bytes: files.reduce((n, f) => n + f.size, 0),
    files
  };
}
function diffManifests(mine, theirs) {
  const own = new Map(mine.files.map((f) => [f.path, f.sha256]));
  const peer = new Map(theirs.files.map((f) => [f.path, f.sha256]));
  const behind = theirs.files.filter((f) => own.get(f.path) !== f.sha256);
  const ahead = mine.files.filter((f) => !peer.has(f.path));
  const same = mine.files.filter((f) => peer.get(f.path) === f.sha256).length;
  return { behind, ahead, same, inSync: behind.length === 0 };
}
function resolveInRoot(root, relative) {
  const clean = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!inScope(clean)) return null;
  const abs = path.resolve(root, clean);
  const rootAbs = path.resolve(root);
  return abs.startsWith(rootAbs + path.sep) ? abs : null;
}
function stageWrite(root, rel, bytes, expectSha) {
  const target = resolveInRoot(root, rel);
  if (!target) throw new Error(`refusing a path outside the shelf scope: ${rel}`);
  const actual = sha256Bytes(bytes);
  if (actual !== expectSha) throw new Error(`hash mismatch for ${rel}: expected ${expectSha}, got ${actual}`);
  const staging = path.join(root, ".shelf", "staging", rel);
  mkdirSync(path.dirname(staging), { recursive: true });
  writeFileSync(staging, bytes);
  const onDisk = sha256File(staging);
  if (onDisk !== expectSha) throw new Error(`staged copy of ${rel} does not match (${onDisk})`);
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(staging, target);
}
async function syncFrom(root, peerUrl, options = {}) {
  const base = peerUrl.replace(/\/+$/, "");
  const timeout = options.timeoutMs ?? 3e4;
  const mine = buildManifest(root);
  const res = await fetch(`${base}/api/shelf/manifest`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`peer manifest refused: HTTP ${res.status}`);
  const theirs = await res.json();
  if (!Array.isArray(theirs.files)) throw new Error("peer answered without a file list");
  if (revOf(theirs.files) !== theirs.rev) throw new Error("peer manifest is internally inconsistent (rev does not match its own files)");
  const diff = diffManifests(mine, theirs);
  const wanted = options.only ? diff.behind.filter((f) => options.only.includes(f.path)) : diff.behind;
  const result = {
    peer: base,
    peerRev: theirs.rev,
    mineRev: mine.rev,
    behind: diff.behind.length,
    ahead: diff.ahead.length,
    fetched: [],
    refused: [],
    applied: options.apply === true
  };
  if (!options.apply) return result;
  for (const file of wanted) {
    try {
      const r = await fetch(`${base}/api/shelf/file?path=${encodeURIComponent(file.path)}`, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== file.size) throw new Error(`size mismatch: expected ${file.size}, got ${buf.length}`);
      stageWrite(root, file.path, buf, file.sha256);
      result.fetched.push(file.path);
    } catch (err) {
      result.refused.push({ path: file.path, why: err instanceof Error ? err.message : String(err) });
    }
  }
  try {
    mkdirSync(path.join(root, ".shelf"), { recursive: true });
    writeFileSync(
      path.join(root, ".shelf", "rev.json"),
      JSON.stringify({ rev: buildManifest(root).rev, pulledFrom: base, at: (/* @__PURE__ */ new Date()).toISOString(), fetched: result.fetched.length }, null, 2)
    );
  } catch {
  }
  return result;
}
function lastSyncMark(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, ".shelf", "rev.json"), "utf8"));
  } catch {
    return null;
  }
}
function clearStaging(root) {
  const dir = path.join(root, ".shelf", "staging");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
export {
  buildManifest,
  clearStaging,
  diffManifests,
  inScope,
  lastSyncMark,
  resolveInRoot,
  revOf,
  sha256Bytes,
  stageWrite,
  syncFrom,
  walkShelf
};
//# sourceMappingURL=shelf.js.map
