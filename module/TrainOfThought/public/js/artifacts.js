import fs from "node:fs";
import path from "node:path";
function artifactRoot(store) {
  return path.join(path.dirname(store.file), "thoughts");
}
function nodeDir(store, node) {
  return path.join(artifactRoot(store), node.dir ? path.basename(node.dir) : node.ref);
}
function ensureNodeDir(store, node) {
  const dir = nodeDir(store, node);
  fs.mkdirSync(dir, { recursive: true });
  node.dir = path.join("thoughts", path.basename(dir)).replace(/\\/g, "/");
  return dir;
}
const POINTER = ".pointer.txt";
function listArtifacts(store, node) {
  const dir = ensureNodeDir(store, node);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let target;
    try {
      target = fs.readlinkSync(full);
    } catch {
      target = void 0;
    }
    let stat = null;
    try {
      stat = fs.statSync(full);
    } catch {
      stat = null;
    }
    const isPointer = name.endsWith(POINTER);
    out.push({
      name,
      kind: isPointer ? "pointer" : target ? "link" : stat?.isDirectory() ? "dir" : "file",
      bytes: stat && stat.isFile() ? stat.size : null,
      mtime: (stat?.mtimeMs ?? fs.lstatSync(full).mtimeMs) | 0,
      ...target ? { target: path.resolve(dir, target) } : {}
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function attachArtifact(store, node, source, asName) {
  const from = path.resolve(source);
  const stat = fs.statSync(from);
  const dir = ensureNodeDir(store, node);
  const base = asName && asName.trim() || path.basename(from);
  const dest = path.join(dir, base);
  if (fs.existsSync(dest)) throw new Error(`already attached: ${base}`);
  if (stat.isDirectory()) {
    try {
      fs.symlinkSync(from, dest, "junction");
      return { name: base, mode: "junction", target: from, path: dest };
    } catch {
    }
  } else {
    try {
      fs.symlinkSync(from, dest, "file");
      return { name: base, mode: "symlink", target: from, path: dest };
    } catch {
      try {
        fs.linkSync(from, dest);
        return { name: base, mode: "hardlink", target: from, path: dest };
      } catch {
      }
    }
  }
  const pointerName = `${base}${POINTER}`;
  const pointerPath = path.join(dir, pointerName);
  if (fs.existsSync(pointerPath)) throw new Error(`already attached: ${pointerName}`);
  fs.writeFileSync(pointerPath, `${from}\r
`, "utf8");
  return { name: pointerName, mode: "pointer", target: from, path: pointerPath };
}
export {
  artifactRoot,
  attachArtifact,
  ensureNodeDir,
  listArtifacts,
  nodeDir
};
//# sourceMappingURL=artifacts.js.map
