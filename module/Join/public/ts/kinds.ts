/**
 * @module kinds
 * @description THE KIND CATALOG — what KINDS of thing can be joined, held as DATA.
 *              The old contract knew exactly three kinds (door · shell · catalog) in code, so
 *              every new thing to be joined meant editing the resolver. That is backwards: a
 *              shelf grows by ADDING THINGS, and the vocabulary should grow with them.
 *              Built-ins below; any extra kind lives in Join/data/kinds.json and is merged on
 *              load. A kind decides two things only: may it have a port, and does it have a
 *              start command. Everything else about a member is its own declaration.
 * @intent Foresight, stated plainly: the shelf will keep growing (services, agents, nodes,
 *              MCP doors, apps, plugins, storage). None of those may require a code change to
 *              appear — only a declaration, or a line in kinds.json. An unknown kind is never
 *              refused: it is accepted, marked `kindKnown: false`, and treated permissively.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --- Interface Definitions ---

/** One kind of thing the shelf can hold. `source` says whether code or a file gave it. */
export interface KindSpec {
  readonly name: string;
  /** May it have its own port? A shell/node/storage has none — saying so is the point. */
  readonly hasPort: boolean;
  /** Does it have a command ProcessWrapper can start? */
  readonly hasStart: boolean;
  /** One human sentence, for a reader with no context. */
  readonly what: string;
  readonly source: 'built-in' | 'file';
}

/** A kind as a file may write it — every field but name optional. */
export interface RawKind {
  name?: unknown;
  hasPort?: unknown;
  hasStart?: unknown;
  what?: unknown;
}

// --- Function Definitions ---

/** The file a shelf may use to add kinds without touching this module. */
export const KINDS_FILE = 'kinds.json';

/** The built-in vocabulary. Deliberately roomy: the shelf's future is additive. */
export function builtinKinds(): KindSpec[] {
  const b = (name: string, hasPort: boolean, hasStart: boolean, what: string): KindSpec =>
    ({ name, hasPort, hasStart, what, source: 'built-in' });
  return [
    b('door', true, true, 'a module with its own little api on its own port'),
    b('shell', false, true, 'the one window — no port of its own'),
    b('catalog', false, true, 'a list of what this node can do'),
    b('service', false, true, 'a capability that runs on demand — offered, not always up'),
    b('agent', false, true, 'a code thread you can talk to'),
    b('app', false, true, 'a program with a page or a window'),
    b('tool', false, true, 'a one-shot command with an answer'),
    b('plugin', false, true, 'code that attaches to a door it does not own'),
    b('mcp', false, false, "an agent door (MCP endpoint) that lives somewhere else"),
    b('node', false, false, 'another machine on the network'),
    b('storage', false, false, 'a place data lives — a share, a folder, a bucket'),
  ];
}

/**
 * A kind name: lowercase, no spaces, short. Anything else is refused by name rather than
 * silently coerced — a kind that quietly becomes 'door' is a lie with a long life.
 */
export function normalizeKind(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(s)) return null;
  return s;
}

function readBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function readKindFile(file: string): RawKind[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { kinds?: unknown }).kinds)
        ? (parsed as { kinds: unknown[] }).kinds
        : []);
    return list.filter((k): k is RawKind => !!k && typeof k === 'object');
  } catch {
    return [];
  }
}

/**
 * The catalog in force: built-ins, then the file's additions/overrides (file wins for the
 * same name). A broken or absent file simply means the built-ins, never a crash.
 */
export function loadKinds(kindsFile?: string): KindSpec[] {
  const byName = new Map<string, KindSpec>();
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
        what: typeof raw.what === 'string' && raw.what.trim()
          ? raw.what.trim()
          : (existing?.what ?? `${name} — declared by ${KINDS_FILE}`),
        source: 'file',
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One kind, or null when the catalog has never heard of it. */
export function kindOf(name: string, kinds: readonly KindSpec[]): KindSpec | null {
  const n = normalizeKind(name);
  if (!n) return null;
  return kinds.find(k => k.name === n) ?? null;
}

/** Write the overlay file — authoring and tests only; never called on import. */
export function writeKinds(kindsFile: string, kinds: RawKind[]): void {
  fs.mkdirSync(path.dirname(kindsFile), { recursive: true });
  fs.writeFileSync(kindsFile, JSON.stringify({ kinds }, null, 2) + '\n', 'utf8');
}

// --- Function Definitions (tests) ---

/** Real files in a real temp dir: the catalog is data, so the test is writing data. */
export function runTests(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'join-kinds-'));
  try {
    console.assert(builtinKinds().some(k => k.name === 'door' && k.hasPort), 'a door has a port');
    console.assert(builtinKinds().some(k => k.name === 'shell' && !k.hasPort), 'a shell does not');
    console.assert(builtinKinds().every(k => k.what.length > 10), 'every kind explains itself');

    console.assert(normalizeKind('Board') === 'board', 'a kind is normalised to lowercase');
    console.assert(normalizeKind('  node  ') === 'node', 'whitespace is not a kind');
    console.assert(normalizeKind('weird thing') === 'weird-thing', 'spaces become dashes');
    console.assert(normalizeKind('') === null && normalizeKind(7) === null, 'junk is refused, not coerced');
    console.assert(normalizeKind('-bad') === null, 'a leading dash is not a name');

    const file = path.join(root, KINDS_FILE);
    const before = loadKinds(file).length;
    console.assert(before === builtinKinds().length, 'no file = exactly the built-ins', String(before));

    writeKinds(file, [
      { name: 'board', hasPort: false, hasStart: false, what: 'a kanban board that publishes itself' },
      { name: 'door', hasPort: true, hasStart: false, what: 'a door that never needs starting (file override)' },
      { name: 'bogus name!', what: 'must be skipped' },
    ]);
    const after = loadKinds(file);
    console.assert(after.length === before + 1, 'a NEW kind is added by file alone — no code change',
      String(after.length));
    console.assert(kindOf('board', after)?.hasPort === false, 'the new kind declares no port');
    console.assert(kindOf('board', after)?.source === 'file', 'and says a file gave it');
    console.assert(kindOf('door', after)?.hasStart === false, 'a file may override a built-in');
    console.assert(kindOf('bogus name!', after) === null, 'an invalid name never enters the catalog');
    console.assert(kindOf('nothing-here', after) === null, 'an unknown kind is null, not invented');
    console.assert(loadKinds(path.join(root, 'nope.json')).length === before, 'a missing file is not a crash');

    fs.writeFileSync(file, '{ not json', 'utf8');
    console.assert(loadKinds(file).length === before, 'a broken file falls back to built-ins');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// runTests();
