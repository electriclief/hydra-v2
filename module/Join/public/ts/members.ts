/**
 * @module members
 * @description THE MEMBER STORE — things to be joined that are NOT a folder with a join.json.
 *              A shelf declaration lives in the module's own files; that is right for modules.
 *              It is wrong for everything else: a remote node, an MCP door, a service owned by
 *              the catalog, an app on another machine, a share. Those are JOINED, not installed,
 *              so they are REGISTERED — into one store file, in the same shape the resolver
 *              already reads, so nothing downstream needs a second code path.
 * @intent Foresight: "we will be adding things to be joined." Adding one must be a write, not
 *              a build. So a member is data — name, kind, where it answers (port or url), how
 *              to probe it, what it depends on, what it provides, tags, free metadata — and the
 *              store is a single JSON file under Join/data that survives restarts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Declaration, ProbeSpec } from './declaration.js';
import { kindOf, loadKinds, normalizeKind, type KindSpec } from './kinds.js';

// --- Interface Definitions ---

/** One joined thing. Every field but name+kind is optional; absent stays visibly absent. */
export interface MemberRecord {
  readonly name: string;
  readonly kind: string;
  /** A door-shaped thing answers on a port; a node/mcp/storage may answer on a url. */
  readonly port: number | null;
  readonly url: string | null;
  readonly start: string | null;
  readonly what: string;
  readonly probe: ProbeSpec | null;
  readonly deps: readonly string[];
  readonly provides: readonly string[];
  readonly tags: readonly string[];
  readonly meta: Readonly<Record<string, unknown>>;
  readonly registeredAt: string;
  readonly updatedAt: string;
}

/** What a caller may hand us. Unknown shapes are refused with a reason, never coerced. */
export interface RawMember {
  name?: unknown;
  kind?: unknown;
  port?: unknown;
  url?: unknown;
  start?: unknown;
  what?: unknown;
  probe?: unknown;
  deps?: unknown;
  provides?: unknown;
  tags?: unknown;
  meta?: unknown;
}

/** One member plus the rows the resolver wants. */
export interface MemberRow extends MemberRecord {
  readonly origin: 'registered';
}

// --- Function Definitions ---

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function readPort(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw < 65536) return raw;
  if (typeof raw === 'string' && /^\d{1,5}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (n > 0 && n < 65536) return n;
  }
  return null;
}

function readStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());
}

function readProbe(raw: unknown): ProbeSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { path?: unknown; timeoutMs?: unknown; expect?: unknown };
  const p = typeof r.path === 'string' && r.path.trim() ? r.path.trim() : '/health';
  const out: { path: string; timeoutMs?: number; expect?: number[] } = { path: p };
  if (typeof r.timeoutMs === 'number' && r.timeoutMs > 0) out.timeoutMs = Math.round(r.timeoutMs);
  if (Array.isArray(r.expect)) {
    const ex = r.expect.filter((v): v is number => typeof v === 'number');
    if (ex.length) out.expect = ex;
  }
  return out;
}

/**
 * NORMALISE one member. Throws with a sentence a human can act on — the store never holds a
 * half-valid row, because a row that answers wrongly is worse than a refusal.
 */
export function normalizeMember(raw: RawMember, now = new Date()): MemberRecord {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!NAME_RE.test(name)) throw new Error(`member name must be letters/digits/._- (<=64): ${JSON.stringify(raw.name)}`);

  const kind = normalizeKind(raw.kind);
  if (!kind) throw new Error(`${name}: kind must be a short lowercase word (e.g. "node", "service", "mcp")`);

  const port = readPort(raw.port);
  if (raw.port !== undefined && raw.port !== null && port === null) throw new Error(`${name}: port must be 1-65535`);

  let url: string | null = null;
  if (typeof raw.url === 'string' && raw.url.trim()) {
    const u = raw.url.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error(`${name}: url must start with http:// or https://`);
    url = u;
  }
  if (port === null && url === null && (raw.kind === 'door' || raw.kind === 'service')) {
    // not fatal: a door may be registered before it has an address — but say so in `what`
    // by leaving both null; the resolver will report it as unknown rather than up.
  }

  const ts = now.toISOString();
  return {
    name,
    kind,
    port,
    url,
    start: typeof raw.start === 'string' && raw.start.trim() ? raw.start.trim() : null,
    what: typeof raw.what === 'string' && raw.what.trim() ? raw.what.trim() : '',
    probe: readProbe(raw.probe),
    deps: readStringList(raw.deps),
    provides: readStringList(raw.provides),
    tags: readStringList(raw.tags),
    meta: raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
      ? (raw.meta as Record<string, unknown>)
      : {},
    registeredAt: ts,
    updatedAt: ts,
  };
}

/** The member as a Declaration — the ONE shape the resolver already understands. */
export function memberToDeclaration(rec: MemberRecord, kinds: readonly KindSpec[]): Declaration {
  const spec = kindOf(rec.kind, kinds);
  const missing: string[] = [];
  if (!spec) missing.push('kind (not in the catalog — accepted as declared)');
  if (spec?.hasPort && rec.port === null && rec.url === null) missing.push('port');
  if (spec?.hasStart && !rec.start) missing.push('start');
  return {
    name: rec.name,
    kind: rec.kind,
    port: rec.port,
    start: rec.start,
    wiredAtBoot: false,
    what: rec.what,
    sources: { name: 'members.json', kind: 'members.json', port: 'members.json', start: 'members.json' },
    missing,
    url: rec.url,
    probe: rec.probe,
    deps: rec.deps,
    provides: rec.provides,
    tags: rec.tags,
    meta: rec.meta,
    kindKnown: spec !== null,
    origin: 'registered',
  };
}

/** THE STORE — one JSON file, read at boot, written atomically on every change. */
export class MemberStore {
  readonly file: string;
  readonly kinds: readonly KindSpec[];
  private rows: MemberRecord[];

  constructor(file: string, kinds?: readonly KindSpec[]) {
    this.file = file;
    this.kinds = kinds ?? loadKinds();
    this.rows = this.read();
  }

  private read(): MemberRecord[] {
    if (!fs.existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { members?: unknown }).members)
          ? (parsed as { members: unknown[] }).members
          : []);
      const out: MemberRecord[] = [];
      for (const raw of list) {
        try {
          out.push(normalizeMember(raw as RawMember));
        } catch {
          /* one bad row never takes the store down */
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ members: this.rows }, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.file);
  }

  list(): MemberRow[] {
    return this.rows
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => ({ ...r, origin: 'registered' as const }));
  }

  get(name: string): MemberRow | null {
    const n = name.trim().toLowerCase();
    const hit = this.rows.find(r => r.name.toLowerCase() === n);
    return hit ? { ...hit, origin: 'registered' as const } : null;
  }

  /** Add or replace. Re-registering keeps the original registeredAt — history is not rewritten. */
  upsert(raw: RawMember): MemberRow {
    const rec = normalizeMember(raw);
    const i = this.rows.findIndex(r => r.name.toLowerCase() === rec.name.toLowerCase());
    if (i >= 0) {
      const kept = { ...rec, registeredAt: this.rows[i].registeredAt };
      this.rows[i] = kept;
      this.write();
      return { ...kept, origin: 'registered' as const };
    }
    this.rows.push(rec);
    this.write();
    return { ...rec, origin: 'registered' as const };
  }

  remove(name: string): boolean {
    const n = name.trim().toLowerCase();
    const before = this.rows.length;
    this.rows = this.rows.filter(r => r.name.toLowerCase() !== n);
    if (this.rows.length === before) return false;
    this.write();
    return true;
  }

  /** Every member as a declaration, for the shelf to merge with the ones on disk. */
  declarations(): Declaration[] {
    return this.rows.map(r => memberToDeclaration(r, this.kinds));
  }
}

/** Build one from a path — the shape a host embeds. */
export function createMemberStore(file: string, kinds?: readonly KindSpec[]): MemberStore {
  return new MemberStore(file, kinds);
}

// --- Function Definitions (tests) ---

/** Real file, real write, real reload — the store's whole value is surviving a restart. */
export function runTests(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'join-members-'));
  try {
    const file = path.join(root, 'data', 'members.json');
    const kinds = loadKinds();

    const a = normalizeMember({ name: 'Pi-Node', kind: 'Node', url: 'http://192.168.1.140:8111', deps: ['State'] });
    console.assert(a.name === 'Pi-Node' && a.kind === 'node', 'a member keeps its name, normalises its kind');
    console.assert(a.url === 'http://192.168.1.140:8111', 'a remote thing is allowed to answer on a url');
    console.assert(a.probe === null, 'an undeclared probe is stored as ABSENT, not invented');
    const withProbe = normalizeMember({ name: 'P2', kind: 'node', url: 'http://h:1', probe: { path: '/api/health', expect: [200] } });
    console.assert(withProbe.probe?.path === '/api/health' && withProbe.probe?.expect?.[0] === 200,
      'a declared probe is kept exactly');

    let threw = '';
    try { normalizeMember({ name: 'bad name!', kind: 'node' }); } catch (e) { threw = String(e); }
    console.assert(threw.includes('name must be'), 'a bad name is refused with a reason', threw.slice(0, 40));
    threw = '';
    try { normalizeMember({ name: 'x', kind: '!!!' }); } catch (e) { threw = String(e); }
    console.assert(threw.includes('kind must be'), 'a junk kind is refused with a reason', threw.slice(0, 40));
    console.assert(normalizeMember({ name: 'y', kind: 'Not A Kind' }).kind === 'not-a-kind',
      'words with spaces become a real kind, they are not refused');

    const unknown = normalizeMember({ name: 'Board', kind: 'board', what: 'a kanban board' });
    console.assert(unknown.kind === 'board', 'an unknown kind is stored, not refused — it is data');

    const store = createMemberStore(file, kinds);
    console.assert(store.list().length === 0, 'a fresh store is empty, not an error');

    const saved = store.upsert({ name: 'Pi-Node', kind: 'node', url: 'http://192.168.1.140:8111', tags: ['remote', 'arm'] });
    console.assert(saved.origin === 'registered', 'a saved row says where it came from');
    console.assert(fs.existsSync(file), 'the store writes its file immediately');

    const again = createMemberStore(file, kinds);
    console.assert(again.list().length === 1, 'a NEW store instance reads the same row — it survives a restart',
      String(again.list().length));
    console.assert(again.get('pi-node')?.kind === 'node', 'lookup is case-insensitive');

    const first = again.list()[0].registeredAt;
    const updated = again.upsert({ name: 'Pi-Node', kind: 'node', url: 'http://192.168.1.140:9000' });
    console.assert(updated.registeredAt === first, 're-registering does not rewrite the history');
    console.assert(updated.url?.endsWith(':9000'), 'but the new address wins');

    const decls = again.declarations();
    console.assert(decls.length === 1 && decls[0].origin === 'registered', 'members become declarations');
    console.assert(decls[0].sources.name === 'members.json', 'and the source says so');

    const nodeDecl = memberToDeclaration(normalizeMember({ name: 'N2', kind: 'node', url: 'http://h:1' }), kinds);
    console.assert(nodeDecl.missing.length === 0, 'a node with a url declares nothing missing', JSON.stringify(nodeDecl.missing));
    const doorDecl = memberToDeclaration(normalizeMember({ name: 'D2', kind: 'door' }), kinds);
    console.assert(doorDecl.missing.includes('port') && doorDecl.missing.includes('start'),
      'a door without port/start shows BOTH as missing', JSON.stringify(doorDecl.missing));

    console.assert(again.remove('pi-node') === true, 'remove reports it removed something');
    console.assert(again.remove('pi-node') === false, 'removing twice is honestly false');
    console.assert(createMemberStore(file, kinds).list().length === 0, 'the removal is persisted');

    fs.writeFileSync(file, '{ broken', 'utf8');
    console.assert(createMemberStore(file, kinds).list().length === 0, 'a corrupt store reads empty, never crashes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// runTests();
