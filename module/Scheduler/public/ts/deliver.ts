/**
 * @module deliver
 * @description Attaching a produced artifact to a results folder WITHOUT claiming a copy happened.
 *              The ladder is Windows-specific and preference-ordered: junction for a directory, hard link for a
 *              file on the same volume, file symlink when Developer Mode allows it, and a pointer text file as
 *              the last resort. The mode that actually worked is RETURNED and must be printed, because
 *              "linked" and "copied" are different claims and a pointer is neither.
 * @intent The operator's preference is a link; copy stays available for the user who wants a result that
 *         survives the session folder being archived. Never silently choose one for them.
 */

import fs from 'node:fs';
import path from 'node:path';

// --- Interface Definitions ---

export type DeliverMode = 'auto' | 'link' | 'copy';
export type DeliveredMode = 'junction' | 'symlink' | 'hardlink' | 'copy' | 'pointer';

export interface Delivered {
  src: string;
  dest: string;
  isDir: boolean;
  mode: DeliveredMode;
  note: string;
}

// --- Function Definitions ---

/**
 * Attach `src` into `destDir` under its own name.
 *   auto — link if the platform allows it, otherwise copy (never a silent pointer)
 *   link — link or pointer only; if neither is possible it throws rather than copying behind your back
 *   copy — always a real copy
 */
export function deliver(src: string, destDir: string, mode: DeliverMode = 'auto'): Delivered {
  const abs = path.resolve(src);
  const st = fs.statSync(abs);
  const isDir = st.isDirectory();
  const base = path.basename(abs);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, base);

  if (fs.existsSync(dest) || isLink(dest)) {
    throw new Error(`refusing to overwrite an existing name: ${dest}`);
  }

  if (mode === 'copy') return copy(abs, dest, isDir);

  if (isDir) {
    // a junction needs no privilege and Explorer shows it as a folder — the operator's preference
    try {
      fs.symlinkSync(abs, dest, 'junction');
      return { src: abs, dest, isDir, mode: 'junction', note: 'junction — the bytes are still in the session folder' };
    } catch (e) {
      if (mode === 'link') return pointer(abs, destDir, isDir, `junction failed: ${msg(e)}`);
      return copy(abs, dest, isDir);
    }
  }

  // a FILE: hard link first (same volume, no privilege), then a file symlink, then a pointer
  try {
    fs.linkSync(abs, dest);
    return { src: abs, dest, isDir, mode: 'hardlink', note: 'hard link — one inode under two names, no second copy' };
  } catch (e1) {
    try {
      fs.symlinkSync(abs, dest, 'file');
      return { src: abs, dest, isDir, mode: 'symlink', note: 'file symlink — needs Developer Mode or admin to create' };
    } catch (e2) {
      if (mode === 'link') return pointer(abs, destDir, isDir, `hard link failed (${msg(e1)}); symlink failed (${msg(e2)})`);
      return copy(abs, dest, isDir);
    }
  }
}

function copy(abs: string, dest: string, isDir: boolean): Delivered {
  fs.cpSync(abs, dest, { recursive: isDir });
  return {
    src: abs, dest, isDir, mode: 'copy',
    note: 'copy — an independent result, and it survives the session folder being moved or archived',
  };
}

/** Last resort and it SAYS so: a text file holding the absolute path, next to nothing else. */
function pointer(abs: string, destDir: string, isDir: boolean, why: string): Delivered {
  const dest = path.join(destDir, `${path.basename(abs)}.pointer.txt`);
  fs.writeFileSync(dest, `${abs}\n`);
  return { src: abs, dest, isDir, mode: 'pointer', note: `pointer file — NOT a link. ${why}` };
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Prove the claim: a link must resolve, a hard link must be the same inode, a copy must be the same bytes. */
export function verify(d: Delivered): { ok: boolean; detail: string } {
  try {
    if (d.mode === 'junction' || d.mode === 'symlink') {
      const target = path.resolve(fs.readlinkSync(d.dest));
      const same = fs.existsSync(target);
      return { ok: same, detail: `reads back as ${target}${same ? '' : ' (DANGLING)'}` };
    }
    if (d.mode === 'hardlink') {
      const a = fs.statSync(d.src);
      const b = fs.statSync(d.dest);
      const ok = a.ino === b.ino && a.dev === b.dev;
      return { ok, detail: `ino ${a.ino} vs ${b.ino}, nlink ${b.nlink}` };
    }
    if (d.mode === 'copy') {
      const a = fs.statSync(d.src);
      const b = fs.statSync(d.dest);
      const ok = d.isDir ? true : a.size === b.size;
      return { ok, detail: d.isDir ? 'directory copied' : `${a.size} vs ${b.size} bytes` };
    }
    const txt = fs.readFileSync(d.dest, 'utf8').trim();
    return { ok: fs.existsSync(txt), detail: `points at ${txt}` };
  } catch (e) {
    return { ok: false, detail: msg(e) };
  }
}

/**
 * Remove a delivered name. A junction or symlink must be UNLINKED, never recursed through: walking into it
 * would delete the session's own files while reporting that the delivery folder was cleaned.
 */
export function removeDelivered(dest: string): { removed: boolean; how: string } {
  const st = fs.lstatSync(dest);
  if (st.isSymbolicLink()) {
    fs.unlinkSync(dest);
    return { removed: true, how: 'unlinked the link (the target is untouched)' };
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return { removed: true, how: 'deleted a real path' };
}
