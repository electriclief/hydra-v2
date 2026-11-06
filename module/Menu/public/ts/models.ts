/**
 * @module models
 * @description The weights a service declares, checked against this node's disk.
 *
 *              Two phases, on purpose: the cache written last time answers instantly, and then
 *              the files are stat'ed and the answer corrected. A stale size shown for 30 ms is
 *              better than an empty pane for 300, and a name that no longer exists on disk has
 *              to say so rather than look launchable.
 * @intent "remember last time — display — then check the path for changes and update."
 */

import fs from 'node:fs';
import path from 'node:path';

// --- Interface Definitions ---

/** The instance layer: where THIS node keeps its weights. Never part of a service file. */
export interface NodeConfig {
  name: string;
  modelsDir: string | null;
  /** per-service folders, when a service keeps its weights somewhere else entirely */
  modelsDirs: Record<string, string>;
  gpu: string | null;
  note: string | null;
}

/** One weight, as declared by the service and as found on disk. */
export interface ModelRow {
  file: string | null;
  family: string;
  quant: string | null;
  /** what the service declares, bytes */
  bytes: number;
  sha256: string | null;
  vramGb: number | null;
  role: string | null;
  note: string | null;
  /** disk truth — null until a verify pass has looked */
  path: string | null;
  exists: boolean | null;
  actualBytes: number | null;
  mtime: string | null;
  /** on disk, but not the size the service declares */
  changed: boolean;
  checkedAt: string | null;
}

export interface ModelsAnswer {
  ok: boolean;
  service: string;
  modelsDir: string | null;
  verified: boolean;
  models: ModelRow[];
  note: string | null;
  error: string | null;
}

interface Seen {
  bytes: number;
  mtime: string;
  at: string;
}

type Cache = Record<string, Record<string, Seen>>;

// --- Function Definitions ---

export function readNodeConfig(file: string): NodeConfig {
  const fallback: NodeConfig = { name: 'this node', modelsDir: null, modelsDirs: {}, gpu: null, note: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const dirs: Record<string, string> = {};
    if (raw.modelsDirs && typeof raw.modelsDirs === 'object') {
      for (const [k, v] of Object.entries(raw.modelsDirs as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) dirs[k] = v.trim();
      }
    }
    return {
      name: typeof raw.name === 'string' ? raw.name : fallback.name,
      modelsDir: typeof raw.modelsDir === 'string' && raw.modelsDir.trim() ? raw.modelsDir.trim() : null,
      modelsDirs: dirs,
      gpu: typeof raw.gpu === 'string' ? raw.gpu : null,
      note: typeof raw.note === 'string' ? raw.note : null,
    };
  } catch {
    return fallback;
  }
}

export function readCache(file: string): Cache {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(file: string, cache: Cache): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // a cache that cannot be written is a cache that will be cold next time; not an error
  }
}

function declaredModels(raw: unknown[]): Record<string, unknown>[] {
  return raw.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object');
}

/**
 * Answer for one service's models. `verify: false` is cache-only and cannot fail or wait;
 * `verify: true` stats each file, corrects the row, and writes the cache back.
 */
export function readModels(options: {
  service: string;
  /** the service's `models[]`, as the catalog carries it */
  declared: unknown[];
  node: NodeConfig;
  cacheFile: string;
  verify: boolean;
}): ModelsAnswer {
  const declared = declaredModels(options.declared ?? []);
  const dir = options.node.modelsDirs[options.service] ?? options.node.modelsDir;
  const cache = readCache(options.cacheFile);
  const mine = cache[options.service] ?? {};
  const now = new Date().toISOString();
  const rows: ModelRow[] = [];
  let touched = false;

  for (const m of declared) {
    const family = String(m.family ?? m.id ?? 'unnamed');
    const file = typeof m.file === 'string' && m.file.trim() ? m.file.trim() : null;
    const bytes = Number(m.bytes ?? 0) || 0;
    const row: ModelRow = {
      file,
      family,
      quant: typeof m.quant === 'string' ? m.quant : null,
      bytes,
      sha256: typeof m.sha256 === 'string' ? m.sha256 : null,
      vramGb: typeof m.vramGb === 'number' ? m.vramGb : null,
      role: typeof m.role === 'string' ? m.role : null,
      note: typeof m.note === 'string' ? m.note : null,
      path: file && dir ? path.join(dir, file) : null,
      exists: null,
      actualBytes: null,
      mtime: null,
      changed: false,
      checkedAt: null,
    };

    if (options.verify) {
      if (row.path) {
        try {
          const st = fs.statSync(row.path);
          row.exists = st.isFile();
          row.actualBytes = st.size;
          row.mtime = st.mtime.toISOString();
          row.changed = st.size !== row.bytes;
          row.checkedAt = now;
          mine[row.file as string] = { bytes: st.size, mtime: row.mtime, at: now };
          touched = true;
        } catch {
          row.exists = false;
          row.checkedAt = now;
          if (row.file && mine[row.file]) {
            delete mine[row.file];
            touched = true;
          }
        }
      }
    } else if (row.file && mine[row.file]) {
      // remembered: enough to draw the row, and labelled as remembered
      row.exists = true;
      row.actualBytes = mine[row.file].bytes;
      row.mtime = mine[row.file].mtime;
      row.changed = mine[row.file].bytes !== row.bytes;
      row.checkedAt = mine[row.file].at;
    }

    rows.push(row);
  }

  if (touched) {
    cache[options.service] = mine;
    writeCache(options.cacheFile, cache);
  }

  const note = !declared.length
    ? 'this service declares no weights — it is not a model holder'
    : !dir
      ? 'no modelsDir in the node file: sizes are as declared, nothing was checked on disk'
      : null;

  return {
    ok: true,
    service: options.service,
    modelsDir: dir,
    verified: options.verify,
    models: rows,
    note,
    error: null,
  };
}
