/**
 * A thought's own folder — where the things it makes actually live.
 *
 * "Let's make 40 images and a video for X" is a train, and the files belong beside the intention or
 * nobody finds them six weeks later. Each node gets `data/thoughts/<ref>/`; anything already produced
 * elsewhere is ATTACHED, never copied:
 *
 *   1. a symlink (needs Developer Mode or admin on Windows),
 *   2. else a hard link — a real second name for the same bytes, no privilege, same volume only,
 *   3. else a `*.pointer.txt` holding the absolute path, so the pointer survives across volumes and
 *      is still readable by a human and by ls.
 *
 * The mode that was used is returned and shown, because "linked" and "copied" are not the same claim.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ThoughtStore } from './store.js';
import type { ThoughtNode } from './types.js';

export type LinkMode = 'symlink' | 'junction' | 'hardlink' | 'pointer';

export interface ArtifactEntry {
  name: string;
  kind: 'file' | 'dir' | 'link' | 'pointer';
  bytes: number | null;
  mtime: number;
  /** For a link or a pointer: where it points. A hard link has none — it IS the file. */
  target?: string;
}

export function artifactRoot(store: ThoughtStore): string {
  return path.join(path.dirname(store.file), 'thoughts');
}

export function nodeDir(store: ThoughtStore, node: ThoughtNode): string {
  return path.join(artifactRoot(store), node.dir ? path.basename(node.dir) : node.ref);
}

/** Create the folder if it is not there yet (old nodes predate the field). */
export function ensureNodeDir(store: ThoughtStore, node: ThoughtNode): string {
  const dir = nodeDir(store, node);
  fs.mkdirSync(dir, { recursive: true });
  node.dir = path.join('thoughts', path.basename(dir)).replace(/\\/g, '/');
  return dir;
}

const POINTER = '.pointer.txt';

export function listArtifacts(store: ThoughtStore, node: ThoughtNode): ArtifactEntry[] {
  const dir = ensureNodeDir(store, node);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out: ArtifactEntry[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let target: string | undefined;
    try {
      target = fs.readlinkSync(full);
    } catch {
      target = undefined;
    }
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(full); // follows the link, so a link to a folder is a folder
    } catch {
      stat = null;
    }
    const isPointer = name.endsWith(POINTER);
    out.push({
      name,
      kind: isPointer ? 'pointer' : target ? 'link' : stat?.isDirectory() ? 'dir' : 'file',
      bytes: stat && stat.isFile() ? stat.size : null,
      mtime: (stat?.mtimeMs ?? fs.lstatSync(full).mtimeMs) | 0,
      ...(target ? { target: path.resolve(dir, target) } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Attach an existing file or folder to a thought. Returns the mode actually used — never a promise
 * of a link that silently became a copy.
 */
export function attachArtifact(
  store: ThoughtStore,
  node: ThoughtNode,
  source: string,
  asName?: string,
): { name: string; mode: LinkMode; target: string; path: string } {
  const from = path.resolve(source);
  const stat = fs.statSync(from); // throws ENOENT for the caller to report
  const dir = ensureNodeDir(store, node);
  const base = (asName && asName.trim()) || path.basename(from);
  const dest = path.join(dir, base);

  if (fs.existsSync(dest)) throw new Error(`already attached: ${base}`);

  if (stat.isDirectory()) {
    try {
      fs.symlinkSync(from, dest, 'junction'); // junctions need no privilege
      return { name: base, mode: 'junction', target: from, path: dest };
    } catch {
      // fall through to a pointer below
    }
  } else {
    try {
      fs.symlinkSync(from, dest, 'file');
      return { name: base, mode: 'symlink', target: from, path: dest };
    } catch {
      try {
        fs.linkSync(from, dest); // hard link: same bytes, no privilege, same volume
        return { name: base, mode: 'hardlink', target: from, path: dest };
      } catch {
        // fall through to a pointer below
      }
    }
  }

  const pointerName = `${base}${POINTER}`;
  const pointerPath = path.join(dir, pointerName);
  if (fs.existsSync(pointerPath)) throw new Error(`already attached: ${pointerName}`);
  fs.writeFileSync(pointerPath, `${from}\r\n`, 'utf8');
  return { name: pointerName, mode: 'pointer', target: from, path: pointerPath };
}
