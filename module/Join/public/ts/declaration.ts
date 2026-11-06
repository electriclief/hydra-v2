/**
 * @module declaration
 * @description THE DECLARATION — five facts per module, read from the module's OWN files.
 *              Nothing on the shelf declares these today, and the resolver must not guess:
 *              a naive scan of the real shelf reads Basic_App's port as 8128 (which is
 *              Services' port) and gives a shell a port it does not have. Five facts is the
 *              whole contract: name · kind · port · start · wiredAtBoot.
 * @intent The north star: any agent, even a limited one, must be able to find things by NAME.
 *              A fact only one file can answer honestly is written down in that file, so the
 *              resolver relays instead of guessing. "Nothing is declared" is a REFUSAL with
 *              a reason, never a silent default — a wrong default is a lie that outlives the
 *              session that made it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kindOf, loadKinds, normalizeKind, type KindSpec } from './kinds.js';

// --- Interface Definitions ---

/** What a thing IS on the shelf. Open on purpose: the catalog (kinds.ts) owns the list. */
export type ModuleKind = string;

/** How to ask a member whether it is answering — data, so any kind of thing can answer. */
export interface ProbeSpec {
  /** Path to ask. Defaults to /health when a member declares none. */
  readonly path: string;
  readonly timeoutMs?: number;
  /** Status codes that count as answering. Defaults to 200 and 404. */
  readonly expect?: readonly number[];
}

/** The five facts (+ the optional ones a growing shelf needs). A fact left out is `null`. */
export interface Declaration {
  /** Canonical answer to "what are you called" — folder name by default. */
  readonly name: string;
  readonly kind: ModuleKind;
  /** Doors only. A shell or catalog is NOT given one. */
  readonly port: number | null;
  /** The command ProcessWrapper runs — the one thing no file currently says. */
  readonly start: string | null;
  /** true = one of the three wired at boot (ProcessWrapper · Electron_Wrapper · Join). */
  readonly wiredAtBoot: boolean;
  /** What it is, in its own words (package.json description), for a limited reader. */
  readonly what: string;
  /** Which file each fact came from — so a refusal can name itself. */
  readonly sources: Readonly<Record<string, string>>;
  /** Facts the module did not declare. Visible, never invented. */
  readonly missing: readonly string[];
  /** Things that live somewhere other than a port: a node, an mcp door, a share. */
  readonly url?: string | null;
  readonly probe?: ProbeSpec | null;
  /** What must be up before this is, and what it answers for. Ordering foresight. */
  readonly deps?: readonly string[];
  readonly provides?: readonly string[];
  /** Free labels for a reader that filters ("gpu", "remote", "deprecated"). */
  readonly tags?: readonly string[];
  /** Anything else the member wants to say. Never interpreted by Join. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** false = the kind is not in the catalog (accepted as declared, marked, never coerced). */
  readonly kindKnown?: boolean;
  /** 'file' = a join.json on disk; 'registered' = added to the member store at runtime. */
  readonly origin?: 'file' | 'registered';
}

/** The shape a module may hand us. Every field optional except name. */
export interface RawDeclaration {
  name?: string;
  kind?: string;
  port?: number | string;
  start?: string;
  wiredAtBoot?: boolean;
  what?: string;
  url?: string;
  probe?: ProbeSpec;
  deps?: string[];
  provides?: string[];
  tags?: string[];
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

// --- Function Definitions ---

/** The file Join reads per module. Small on purpose — a declaration, not a framework. */
const DECLARATION_FILE = 'join.json';

/** Fall back to package.json for a human sentence, never for identity facts. */
const PACKAGE_FILE = 'package.json';

/** Every fact Join needs. Used to build the `missing` list. */
export interface ReadOptions {
  /** The kind catalog in force. Absent = the built-ins (plus Join/data/kinds.json by caller). */
  readonly kinds?: readonly KindSpec[];
}

/**
 * Normalise whatever was written into a kind. AN UNKNOWN KIND IS NOT A REFUSAL: the shelf
 * grows by adding things, so a kind the catalog has never heard of is accepted as declared
 * and marked (`kindKnown: false`). Only junk (empty, punctuation) is refused.
 */
function readKind(raw: string | undefined, kinds: readonly KindSpec[]): { kind: string | null; known: boolean } {
  const kind = normalizeKind(raw);
  if (!kind) return { kind: null, known: false };
  return { kind, known: kindOf(kind, kinds) !== null };
}

/** A port is a port: a positive integer, or nothing. Never port 0 as an answer. */
function readPort(raw: number | string | undefined): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw < 65536) return raw;
  if (typeof raw === 'string' && /^\d{4}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n > 0 && n < 65536) return n;
  }
  return null;
}

/**
 * READ one module's declaration. Returns the fact-shape plus WHERE each fact came from.
 * A missing file is not an error — it is a module that has not declared itself yet, and
 * that reads as missing facts rather than as absence.
 */
export function readDeclaration(moduleDir: string, options: ReadOptions = {}): Declaration {
  const kinds = options.kinds ?? loadKinds();
  const sources: Record<string, string> = {};
  const raw: RawDeclaration = {};

  const declPath = path.join(moduleDir, DECLARATION_FILE);
  if (fs.existsSync(declPath)) {
    const text = fs.readFileSync(declPath, 'utf8');
    try {
      Object.assign(raw, JSON.parse(text) as RawDeclaration);
      for (const k of Object.keys(raw)) sources[k] = DECLARATION_FILE;
    } catch {
      sources.kind = `${DECLARATION_FILE} (unreadable — refused)`;
    }
  }

  // package.json contributes ONLY a human sentence; identity never comes from a guess.
  const pkgPath = path.join(moduleDir, PACKAGE_FILE);
  let pkgDescription: string | undefined;
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { description?: string };
      if (typeof pkg.description === 'string' && pkg.description.trim()) {
        pkgDescription = pkg.description.trim();
        sources.what = PACKAGE_FILE;
      }
    } catch {
      /* a broken package.json says nothing; the fact simply stays missing */
    }
  }

  const { kind, known: kindKnown } = readKind(raw.kind, kinds);
  const spec = kind ? kindOf(kind, kinds) : null;
  const port = readPort(raw.port);

  // A kind that has no port may not declare one — that is a refusal, not a default.
  let effectivePort = port;
  if (spec && !spec.hasPort && port !== null) {
    sources.port = `${DECLARATION_FILE} (a ${spec.name} has no port — refused)`;
    effectivePort = null;
  }

  const missing: string[] = [];
  if (kind === null) missing.push('kind');
  if (kind === null || spec?.hasStart) {
    if (raw.start === undefined || raw.start === null) missing.push('start');
  }
  if (kind === null || kind === 'door' || kind === 'shell' || kind === 'catalog') {
    if (raw.wiredAtBoot === undefined || raw.wiredAtBoot === null) missing.push('wiredAtBoot');
  }
  if ((spec?.hasPort ?? kind === 'door') && effectivePort === null && !raw.url) missing.push('port');
  if (pkgDescription === undefined && raw.what === undefined) missing.push('what');

  const textList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()) : [];

  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : path.basename(moduleDir),
    kind: kind ?? 'door', // documented fallback — and `missing` still says kind was not declared
    port: effectivePort,
    start: typeof raw.start === 'string' && raw.start.trim() ? raw.start.trim() : null,
    wiredAtBoot: raw.wiredAtBoot === true,
    what: typeof raw.what === 'string' && raw.what.trim()
      ? raw.what.trim()
      : (pkgDescription ?? ''),
    sources,
    missing,
    url: typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : null,
    probe: raw.probe && typeof raw.probe === 'object' && typeof (raw.probe as ProbeSpec).path === 'string'
      ? raw.probe
      : null,
    deps: textList(raw.deps),
    provides: textList(raw.provides),
    tags: textList(raw.tags),
    meta: raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
      ? (raw.meta as Record<string, unknown>)
      : {},
    kindKnown,
    origin: 'file',
  };
}

/**
 * INFER, and say so. A module with no declaration file still appears — a limited agent
 * must never get "not found" for something that is sitting right there. Every inferred
 * fact is marked so the reader knows which ones are guesses.
 */
export function inferDeclaration(moduleDir: string): Declaration {
  const name = path.basename(moduleDir);
  const pkgPath = path.join(moduleDir, PACKAGE_FILE);
  let what = '';
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { description?: string };
      if (typeof pkg.description === 'string') what = pkg.description.trim();
    } catch { /* nothing to say */ }
  }
  return {
    name,
    kind: 'door',
    port: null,
    start: null,
    wiredAtBoot: false,
    what,
    sources: { name: 'folder name (inferred)', kind: 'DEFAULT — undeclared', what: PACKAGE_FILE },
    missing: ['kind', 'port', 'start', 'wiredAtBoot'],
    url: null,
    probe: null,
    deps: [],
    provides: [],
    tags: [],
    meta: {},
    kindKnown: false,
    origin: 'file',
  };
}

/** Read every module in a shelf folder. A declared module wins; the rest are inferred. */
export function readShelf(shelfRoot: string, options: ReadOptions = {}): Declaration[] {
  const kinds = options.kinds ?? loadKinds();
  const out: Declaration[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(shelfRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const dir = path.join(shelfRoot, e.name);
    const hasDecl = fs.existsSync(path.join(dir, DECLARATION_FILE));
    out.push(hasDecl ? readDeclaration(dir, { kinds }) : inferDeclaration(dir));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Write a declaration — used by tests and by an authoring tool. Never called on import. */
export function writeDeclaration(moduleDir: string, decl: RawDeclaration): void {
  fs.writeFileSync(path.join(moduleDir, DECLARATION_FILE), JSON.stringify(decl, null, 2) + '\n', 'utf8');
}

// --- Interface Definitions (tests) ---

// --- Function Definitions (tests) ---

/** Drive the REAL files — a temp shelf written and read back. Never mocks. */
export function runTests(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'join-decl-'));
  try {
    // a fully declared door
    const door = path.join(root, 'State');
    fs.mkdirSync(door, { recursive: true });
    fs.writeFileSync(path.join(door, 'package.json'), JSON.stringify({ description: 'state: the generic retainer' }), 'utf8');
    writeDeclaration(door, { name: 'State', kind: 'door', port: 8127, start: 'node public/js/main.js', wiredAtBoot: true });

    // a shell with a port it does not have — the refusal must hold
    const shell = path.join(root, 'Electron_Wrapper');
    fs.mkdirSync(shell, { recursive: true });
    fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ description: 'the one window' }), 'utf8');
    writeDeclaration(shell, { name: 'Electron_Wrapper', kind: 'shell', port: 8088, start: 'electron window/main.cjs', wiredAtBoot: true });

    // an undeclared module — must still APPEAR
    const bare = path.join(root, 'Mystery');
    fs.mkdirSync(bare, { recursive: true });
    fs.writeFileSync(path.join(bare, 'package.json'), JSON.stringify({ description: 'never declared' }), 'utf8');

    const shelf = readShelf(root);
    console.assert(shelf.length === 3, 'every folder appears, declared or not', String(shelf.length));

    const st = shelf.find(d => d.name === 'State');
    console.assert(st?.kind === 'door' && st?.port === 8127, 'a declared door keeps its port', String(st?.port));
    console.assert(st?.wiredAtBoot === true, 'wiredAtBoot is read');
    console.assert(st?.start === 'node public/js/main.js', 'the start command is read');
    console.assert(st?.missing.length === 0, 'a complete declaration declares nothing missing', JSON.stringify(st?.missing));
    console.assert(st?.what.includes('generic retainer'), 'the human sentence comes from package.json');

    const ew = shelf.find(d => d.name === 'Electron_Wrapper');
    console.assert(ew?.kind === 'shell', 'the shell keeps its kind');
    console.assert(ew?.port === null, 'A SHELL HAS NO PORT — a declared one is refused', String(ew?.port));
    console.assert(String(ew?.sources.port ?? '').includes('refused'), 'the refusal says itself', ew?.sources.port);

    const my = shelf.find(d => d.name === 'Mystery');
    console.assert(my !== undefined, 'an undeclared module is never "not found"');
    console.assert(my?.port === null, 'an undeclared module guesses no port');
    console.assert(my?.missing.includes('kind') && my?.missing.includes('port'),
      'what it does not know stays visible', JSON.stringify(my?.missing));
    console.assert(String(my?.sources.kind ?? '').includes('DEFAULT'),
      'an inferred fact is marked as inferred', my?.sources.kind);

    // a bad port string and a bad kind are both refused, not coerced
    const odd = path.join(root, 'Odd');
    fs.mkdirSync(odd, { recursive: true });
    writeDeclaration(odd, { kind: 'door', port: 'eighty' });
    const od = readDeclaration(odd);
    console.assert(od.port === null && od.missing.includes('port'), 'a bad port string is refused', String(od.port));
    console.assert(od.port === null && od.missing.includes('port'), 'a bad port is refused', String(od.port));
    console.assert(readShelf(path.join(root, 'does-not-exist')).length === 0, 'an absent shelf is empty, not a crash');

    // ── the shelf GROWS: a kind nobody coded is accepted, marked, and never coerced ──
    const board = path.join(root, 'Board');
    fs.mkdirSync(board, { recursive: true });
    writeDeclaration(board, { kind: 'board', what: 'a kanban board that publishes itself', deps: ['State'], tags: ['ui'] });
    const bd = readDeclaration(board);
    console.assert(bd.kind === 'board', 'an UNKNOWN kind keeps its own name (not coerced to door)', bd.kind);
    console.assert(bd.kindKnown === false, 'and is marked as not in the catalog', String(bd.kindKnown));
    console.assert(!bd.missing.includes('kind'), 'an unknown kind is not a MISSING kind', JSON.stringify(bd.missing));
    console.assert((bd.deps ?? []).join(',') === 'State' && (bd.tags ?? []).join(',') === 'ui', 'deps and tags are read');

    // a node answers on a url, needs no port, and has nothing to start
    const relay = path.join(root, 'Relay');
    fs.mkdirSync(relay, { recursive: true });
    writeDeclaration(relay, { kind: 'node', url: 'http://192.168.1.100:8111', what: 'the main node' });
    const rl = readDeclaration(relay);
    console.assert(rl.kind === 'node' && rl.kindKnown === true, 'a catalogued kind is known', `${rl.kind}/${rl.kindKnown}`);
    console.assert(rl.url === 'http://192.168.1.100:8111', 'a node keeps its url');
    console.assert(rl.missing.length === 0, 'a node with a url declares NOTHING missing', JSON.stringify(rl.missing));
    console.assert(rl.port === null, 'and holds no port');

    // a node that declares a port is refused that port — kinds own that rule
    writeDeclaration(relay, { kind: 'node', port: 9000, url: 'http://192.168.1.100:8111' });
    const rl2 = readDeclaration(relay);
    console.assert(rl2.port === null && String(rl2.sources.port).includes('refused'),
      'a node with a port is refused, and says so', String(rl2.sources.port));

    // the catalog is data: a file adds a kind, no code change
    const kindsFile = path.join(root, 'kinds.json');
    fs.writeFileSync(kindsFile, JSON.stringify({ kinds: [{ name: 'board', hasPort: false, hasStart: false, what: 'a board' }] }), 'utf8');
    const withFile = readDeclaration(board, { kinds: loadKinds(kindsFile) });
    console.assert(withFile.kindKnown === true, 'a kind added by FILE becomes known', String(withFile.kindKnown));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// runTests();