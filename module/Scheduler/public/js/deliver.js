import fs from "node:fs";
import path from "node:path";
function deliver(src, destDir, mode = "auto") {
  const abs = path.resolve(src);
  const st = fs.statSync(abs);
  const isDir = st.isDirectory();
  const base = path.basename(abs);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, base);
  if (fs.existsSync(dest) || isLink(dest)) {
    throw new Error(`refusing to overwrite an existing name: ${dest}`);
  }
  if (mode === "copy") return copy(abs, dest, isDir);
  if (isDir) {
    try {
      fs.symlinkSync(abs, dest, "junction");
      return { src: abs, dest, isDir, mode: "junction", note: "junction \u2014 the bytes are still in the session folder" };
    } catch (e) {
      if (mode === "link") return pointer(abs, destDir, isDir, `junction failed: ${msg(e)}`);
      return copy(abs, dest, isDir);
    }
  }
  try {
    fs.linkSync(abs, dest);
    return { src: abs, dest, isDir, mode: "hardlink", note: "hard link \u2014 one inode under two names, no second copy" };
  } catch (e1) {
    try {
      fs.symlinkSync(abs, dest, "file");
      return { src: abs, dest, isDir, mode: "symlink", note: "file symlink \u2014 needs Developer Mode or admin to create" };
    } catch (e2) {
      if (mode === "link") return pointer(abs, destDir, isDir, `hard link failed (${msg(e1)}); symlink failed (${msg(e2)})`);
      return copy(abs, dest, isDir);
    }
  }
}
function copy(abs, dest, isDir) {
  fs.cpSync(abs, dest, { recursive: isDir });
  return {
    src: abs,
    dest,
    isDir,
    mode: "copy",
    note: "copy \u2014 an independent result, and it survives the session folder being moved or archived"
  };
}
function pointer(abs, destDir, isDir, why) {
  const dest = path.join(destDir, `${path.basename(abs)}.pointer.txt`);
  fs.writeFileSync(dest, `${abs}
`);
  return { src: abs, dest, isDir, mode: "pointer", note: `pointer file \u2014 NOT a link. ${why}` };
}
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
function msg(e) {
  return e instanceof Error ? e.message : String(e);
}
function verify(d) {
  try {
    if (d.mode === "junction" || d.mode === "symlink") {
      const target = path.resolve(fs.readlinkSync(d.dest));
      const same = fs.existsSync(target);
      return { ok: same, detail: `reads back as ${target}${same ? "" : " (DANGLING)"}` };
    }
    if (d.mode === "hardlink") {
      const a = fs.statSync(d.src);
      const b = fs.statSync(d.dest);
      const ok = a.ino === b.ino && a.dev === b.dev;
      return { ok, detail: `ino ${a.ino} vs ${b.ino}, nlink ${b.nlink}` };
    }
    if (d.mode === "copy") {
      const a = fs.statSync(d.src);
      const b = fs.statSync(d.dest);
      const ok = d.isDir ? true : a.size === b.size;
      return { ok, detail: d.isDir ? "directory copied" : `${a.size} vs ${b.size} bytes` };
    }
    const txt = fs.readFileSync(d.dest, "utf8").trim();
    return { ok: fs.existsSync(txt), detail: `points at ${txt}` };
  } catch (e) {
    return { ok: false, detail: msg(e) };
  }
}
function removeDelivered(dest) {
  const st = fs.lstatSync(dest);
  if (st.isSymbolicLink()) {
    fs.unlinkSync(dest);
    return { removed: true, how: "unlinked the link (the target is untouched)" };
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return { removed: true, how: "deleted a real path" };
}
export {
  deliver,
  removeDelivered,
  verify
};
//# sourceMappingURL=deliver.js.map
