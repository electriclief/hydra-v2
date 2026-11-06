/**
 * @module shelf
 * @description What an update actually moves, and how a node proves it matches. A shelf is code and declarations -
 *              module sources, built js, help pages, service definitions, scripts - never runtime data. The
 *              revision is not a counter somebody increments; it is a hash of every file's hash, so two nodes
 *              either agree or can name exactly which files they disagree about.
 * @intent A node should be able to answer three questions without help: what am I carrying, am I behind, and
 *         which files would I move. Pulling is the only direction - a node fetches and verifies, it is never
 *         written to from outside, and a hash that does not match is a refusal, not a warning.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';

export interface ShelfFile {
  /** POSIX-style path relative to the shelf root. */
  path: string;
  size: number;
  sha256: string;
}

export interface ShelfManifest {
  /** Short content address over every path+hash pair. Same files, same rev, on any node. */
  rev: string;
  /** A human label for the revision (a date or a name), carried by the peer - never used for comparison. */
  label: string;
  generatedAt: string;
  bytes: number;
  files: ShelfFile[];
}

export interface ShelfDiff {
  /** In the peer, different or absent here: what a pull would fetch. */
  behind: ShelfFile[];
  /** Here but not in the peer. Reported, never deleted automatically - that is how a node loses its own work. */
  ahead: ShelfFile[];
  /** Same path and same hash on both sides. */
  same: number;
  inSync: boolean;
}

/**
 * The scope. Anything not listed is not part of a revision - which is what keeps a diary entry, a job book or a
 * downloaded model from changing "the version of the software".
 */
const INCLUDE: RegExp[] = [
  /^scripts\/[^/]+\.(ps1|py|cmd|sh)$/,
  /^module\/[^/]+\/help\.html$/,
  /^module\/[^/]+\/(join|package)\.json$/,
  /^module\/[^/]+\/[A-Za-z][A-Za-z_]*_module\.js$/,
  /^module\/[^/]+\/public\/[^/]+\.(html|css|js)$/,
  /^module\/[^/]+\/public\/(ts|js|css)\/.+\.(ts|js|css|map)$/,
  /^module\/Services\/services\/[^/]+\.js$/,
];

const EXCLUDE: RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)data\//,
  /(^|\/)\.shelf\//,
  /(^|\/)logs?\//,
  /\.log$/,
  /(^|\/)\.git\//,
];

export function inScope(relative: string): boolean {
  const p = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.includes('..')) return false;
  if (EXCLUDE.some((r) => r.test(p))) return false;
  return INCLUDE.some((r) => r.test(p));
}

/** Every in-scope file under the root, as POSIX-relative paths, sorted so the rev is stable across platforms. */
export function walkShelf(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // prune the excluded trees before descending: node_modules alone would cost minutes
        if (EXCLUDE.some((r) => r.test(`${childRel}/`))) continue;
        walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (inScope(childRel)) out.push(childRel);
    }
  };
  walk(root, '');
  return out.sort();
}

export function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256File(abs: string): string {
  return sha256Bytes(readFileSync(abs));
}

/** The revision of a manifest: a hash over `path\0hash` lines. Order-independent because the list is sorted. */
export function revOf(files: ShelfFile[]): string {
  const text = [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\0${f.sha256}`).join('\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function buildManifest(root: string, label = ''): ShelfManifest {
  const files: ShelfFile[] = [];
  for (const rel of walkShelf(root)) {
    const abs = path.join(root, rel);
    try {
      const size = statSync(abs).size;
      files.push({ path: rel, size, sha256: sha256File(abs) });
    } catch {
      /* a file that vanished mid-walk is simply not in this revision */
    }
  }
  return {
    rev: revOf(files),
    label,
    generatedAt: new Date().toISOString(),
    bytes: files.reduce((n, f) => n + f.size, 0),
    files,
  };
}

/** What this node would need to pull to look like the peer. Pure: two manifests in, one diff out. */
export function diffManifests(mine: ShelfManifest, theirs: ShelfManifest): ShelfDiff {
  const own = new Map(mine.files.map((f) => [f.path, f.sha256]));
  const peer = new Map(theirs.files.map((f) => [f.path, f.sha256]));
  const behind = theirs.files.filter((f) => own.get(f.path) !== f.sha256);
  const ahead = mine.files.filter((f) => !peer.has(f.path));
  const same = mine.files.filter((f) => peer.get(f.path) === f.sha256).length;
  return { behind, ahead, same, inSync: behind.length === 0 };
}

/** A path from a request, resolved inside the root, or null. The only defence that matters against `../`. */
export function resolveInRoot(root: string, relative: string): string | null {
  const clean = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!inScope(clean)) return null;
  const abs = path.resolve(root, clean);
  const rootAbs = path.resolve(root);
  return abs.startsWith(rootAbs + path.sep) ? abs : null;
}

/**
 * Write one file into `.shelf/staging` and only then move it into place. A pull that dies halfway leaves the node
 * running exactly what it ran before - which is the whole point of staging.
 */
export function stageWrite(root: string, rel: string, bytes: Buffer, expectSha: string): void {
  const target = resolveInRoot(root, rel);
  if (!target) throw new Error(`refusing a path outside the shelf scope: ${rel}`);
  const actual = sha256Bytes(bytes);
  if (actual !== expectSha) throw new Error(`hash mismatch for ${rel}: expected ${expectSha}, got ${actual}`);
  const staging = path.join(root, '.shelf', 'staging', rel);
  mkdirSync(path.dirname(staging), { recursive: true });
  writeFileSync(staging, bytes);
  // verify what actually landed on disk before it replaces anything
  const onDisk = sha256File(staging);
  if (onDisk !== expectSha) throw new Error(`staged copy of ${rel} does not match (${onDisk})`);
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(staging, target);
}

export interface SyncResult {
  peer: string;
  peerRev: string;
  mineRev: string;
  behind: number;
  ahead: number;
  fetched: string[];
  refused: Array<{ path: string; why: string }>;
  applied: boolean;
}

/**
 * Pull the files this node is behind on, from a peer that serves /api/shelf/manifest and /api/shelf/file.
 * Every file is verified against the peer's own manifest before it lands; one refusal does not corrupt the rest.
 */
export async function syncFrom(
  root: string,
  peerUrl: string,
  options: { apply?: boolean; only?: string[]; timeoutMs?: number } = {},
): Promise<SyncResult> {
  const base = peerUrl.replace(/\/+$/, '');
  const timeout = options.timeoutMs ?? 30000;
  const mine = buildManifest(root);
  const res = await fetch(`${base}/api/shelf/manifest`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`peer manifest refused: HTTP ${res.status}`);
  const theirs = (await res.json()) as ShelfManifest;
  if (!Array.isArray(theirs.files)) throw new Error('peer answered without a file list');
  if (revOf(theirs.files) !== theirs.rev) throw new Error('peer manifest is internally inconsistent (rev does not match its own files)');

  const diff = diffManifests(mine, theirs);
  const wanted = options.only ? diff.behind.filter((f) => options.only!.includes(f.path)) : diff.behind;
  const result: SyncResult = {
    peer: base,
    peerRev: theirs.rev,
    mineRev: mine.rev,
    behind: diff.behind.length,
    ahead: diff.ahead.length,
    fetched: [],
    refused: [],
    applied: options.apply === true,
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

  // The marker says what this node now believes it is, and on whose word. Not proof - the manifest still is.
  try {
    mkdirSync(path.join(root, '.shelf'), { recursive: true });
    writeFileSync(
      path.join(root, '.shelf', 'rev.json'),
      JSON.stringify({ rev: buildManifest(root).rev, pulledFrom: base, at: new Date().toISOString(), fetched: result.fetched.length }, null, 2),
    );
  } catch {
    /* a marker that cannot be written does not undo files that verified */
  }
  return result;
}

export function lastSyncMark(root: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(root, '.shelf', 'rev.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function clearStaging(root: string): void {
  const dir = path.join(root, '.shelf', 'staging');
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
