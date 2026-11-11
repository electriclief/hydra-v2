import { relayPull } from './relay.js';

/**
 * @module stateRegistry
 * @description THE CORE — the generic retainer and retriever. `register(name, object, standing?)`
 *              puts ANY object under a dotted-path name (the tree falls straight out of the
 *              string); `pull(name, {marks})` asks for it back — the whole thing, or the part
 *              past the marks the requester carries, when an element was registered "to be
 *              delta served"; `discover(query?)` walks the active set (shape, never contents);
 *              `drop(name)` is the explicit death hand — and entries whose registrant is gone
 *              pop themselves, because a registration lives exactly as long as its registrant.
 * @intent Operator rulings (2026-09-22): GENERIC — 0 pre-conceived definitions; designed
 *         independent of any use. The registry can just be ANY object; the entry describes
 *         ITSELF (liveness check · pull recipe · serving flags · render map · update contract)
 *         — the module reads only what it must and understands none of it. A pull resolves by
 *         the shortest unique suffix; new / unknown / stale mark → the FULL state; a fresh
 *         mark + an element flagged "to be delta served" → the delta past the mark. Refresh is
 *         two-sided (source speed + requester speed) and State controls NEITHER — it runs no
 *         clocks, remembers nobody, decides nothing; it relays. Vocabulary only:
 *         register · pull · discover · relay. Boots blank; nothing persists.
 */

// --- Interface Definitions ---

/** What a pull recipe sees: the resolved path, the marks the requester carries, the raw ask. */
export interface ResolvedPullRequest {
  /** The full resolved path this pull landed on. */
  name: string;
  /** The requester's marks — element key → what it already holds (e.g. a position count). */
  marks: Record<string, number | string>;
  /** The name the caller actually spelled (a leaf works when it is unique). */
  asked: string;
}

/** A pull recipe — the entry's own hand: hand it the request; it answers. */
export type PullRecipe = (request: ResolvedPullRequest) => unknown | Promise<unknown>;

/** A shaped reply — the explicit form a recipe returns to answer EXACTLY (relay, nesting). */
export interface ShapedReply {
  /** Marker — this return IS the answer (passed through), not content to be served. */
  stateReply: true;
  content: unknown;
  /** Whether this is the whole state (default true). */
  full?: boolean;
  /** The marks the requester now holds. */
  marks?: Record<string, number | string>;
}

/** What a registration may declare — all optional; the entry's own business. */
export interface RegisterOptions {
  /** Lazy liveness: false, or a throw, → the entry is popped at the next walk. */
  alive?: () => boolean;
  /** THE PULL RECIPE — how this entry answers a pull (live sources, relays, computed views). */
  pull?: PullRecipe;
  /**
   * Per-element serving flags, keyed by top-level element of the content.
   * v0.1 carries ONE flag: 'delta' ("to be delta served") — a string serves by lines,
   * an array by items; everything else is always full.
   */
  serving?: Record<string, string>;
  /** Optional render map — relayed to viewers exactly as handed in; understood by none. */
  render?: unknown;
  /** The refresh contract (cadence · trigger · link · whatever) — relayed, never run. */
  update?: unknown;
}

/** What the registry knows about one entry — the SHAPE, never the contents (those are pulled). */
export interface StateEntryInfo {
  path: string;
  registeredAt: string;
  updatedAt: string;
  /** True when the entry answers pulls itself (a recipe, or a `pull` method on the content). */
  hasRecipe: boolean;
  serving: Record<string, string>;
  /** Top-level keys of the content (or its kind when not a plain object). */
  shape: string[];
  hasRender: boolean;
  hasUpdate: boolean;
}

/** How many links one ask may walk, and how long one hop may take. Both are budgets, not promises. */
const MAX_LINK_HOPS = 3;
const RELAY_TIMEOUT_MS = 900;

export interface PullOptions {
  /** The marks the requester carries — element key → what it already holds. */
  marks?: Record<string, number | string>;
  /** Follow links when the name is not here (default true). `false` = answer only from this registry. */
  follow?: boolean;
  /** How many links have already been walked, when the ask arrived through a relay. */
  hops?: number;
  /** The bases already walked, so a link cannot point back at one of them. */
  via?: string[];
}

export interface PullReply {
  ok: true;
  /** The full resolved path the pull landed on. */
  name: string;
  at: string;
  /** True = everything served whole; false = at least one element came as a delta. */
  full: boolean;
  content: unknown;
  /** The marks the requester now holds (one per flagged element served). */
  marks: Record<string, number | string>;
  /** Present when the answer came through a link: the base that actually answered. */
  source?: string;
  /** Present when the answer came through a link: how many links were walked. */
  hops?: number;
  /** Present when the answer came through a link: every base walked, in order. */
  via?: string[];
}

export interface PullRefusal {
  ok: false;
  code: 'no_such_entry' | 'ambiguous';
  /** When a link could not answer for a name that IS behind one: absent | unreachable | timeout | cycle. */
  why?: string;
  via?: string[];
  /** The name as asked. */
  name: string;
  /** For 'ambiguous': the full paths that matched — extend the suffix until unique. */
  candidates?: string[];
  at: string;
  /** How far the walk got before it gave up, and where it stopped — carried so a caller can see the shape of the failure. */
  hops?: number;
  source?: string | null;
}

export type PullAnswer = PullReply | PullRefusal;

export interface StateDiscovery {
  ok: true;
  query: string | null;
  entries: StateEntryInfo[];
  summary: StateSummary;
}

export interface StateSummary {
  /** Entries currently held (after the walk pruned the dead). */
  entries: number;
  /** Change events since boot (registered · updated · dropped). */
  changes: number;
}

export interface ChangeEvent {
  t: string;
  kind: 'registered' | 'updated' | 'dropped';
  path: string;
  /** For dropped: the explicit hand, or the declared liveness said gone. */
  reason?: 'explicit' | 'gone';
}

export type ChangeWatcher = (event: ChangeEvent) => void;

interface Slot {
  path: string;
  content: unknown;
  options: Required<Pick<RegisterOptions, 'serving'>> & Omit<RegisterOptions, 'serving'>;
  registeredAt: string;
  updatedAt: string;
}

/** A dotted path: segments of letters/digits/_/- (each starting alphanumeric). */
const NAME_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_PATH = 160;

// --- Function Definitions ---

/** Validate a dotted-path name; returns the trimmed path. */
function validateName(name: string): string {
  const path = typeof name === 'string' ? name.trim() : '';
  if (!path || path.length > MAX_PATH) {
    throw new Error(`bad entry name: ${JSON.stringify(String(name))} — a dotted path like "Parent.Name" (max ${MAX_PATH} chars)`);
  }
  for (const segment of path.split('.')) {
    if (!NAME_SEGMENT.test(segment)) {
      throw new Error(`bad entry name: ${JSON.stringify(path)} — segments are letters/digits/_/- (start alphanumeric), dot-separated`);
    }
  }
  return path;
}

/** Tolerant deep clone — data is cloned (v1 law: readers get clones); odd handles ride by hand. */
function softClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

/** Structural equality — functions compare by identity, everything else by shape. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'function' || typeof b === 'function') return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a as Record<string, unknown>).sort();
  const kb = Object.keys(b as Record<string, unknown>).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual((a as Record<string, unknown>)[ka[i]], (b as Record<string, unknown>)[kb[i]])) return false;
  }
  return true;
}

/** Is this return a recipe answering EXACTLY (to be passed through)? */
export function isShapedReply(value: unknown): value is ShapedReply {
  return typeof value === 'object' && value !== null && (value as { stateReply?: unknown }).stateReply === true;
}

/** Shape a reply for the relay path — recipes that answer EXACTLY return shaped(...). */
export function shaped(content: unknown, options: { full?: boolean; marks?: Record<string, number | string> } = {}): ShapedReply {
  const reply: ShapedReply = { stateReply: true, content };
  if (options.full !== undefined) reply.full = options.full;
  if (options.marks !== undefined) reply.marks = options.marks;
  return reply;
}

/**
 * The state registry — the retainer and the retriever. Boots blank; holds what it is
 * handed; decides nothing.
 */
export class State {
  private entries = new Map<string, Slot>();
  private watchers = new Set<ChangeWatcher>();
  private changes = 0;

  /**
   * Put ANY object under a dotted-path name. The same path re-registered = last hand-in
   * wins (upsert); an identical hand-in is a no-op (v1's spirit kept).
   */
  register(name: string, content: unknown, options: RegisterOptions = {}): StateEntryInfo {
    const path = validateName(name);
    const serving: Record<string, string> = { ...(options.serving ?? {}) };
    const normalized: Slot['options'] = { serving, alive: options.alive, pull: options.pull, render: options.render, update: options.update };
    const now = new Date().toISOString();
    const slot = this.entries.get(path);
    if (slot) {
      if (this.sameHand(slot, content, normalized)) return this.infoOf(slot);
      slot.content = content;
      slot.options = normalized;
      slot.updatedAt = now;
      this.emit({ t: now, kind: 'updated', path });
    } else {
      this.entries.set(path, { path, content, options: normalized, registeredAt: now, updatedAt: now });
      this.emit({ t: now, kind: 'registered', path });
    }
    const live = this.entries.get(path);
    if (!live) throw new Error(`entry vanished during register: ${path}`);
    return this.infoOf(live);
  }

  /** The explicit death hand — remove an entry (unique suffix resolves like a pull). */
  drop(name: string): boolean {
    this.pruneDead();
    const res = this.resolvePath(typeof name === 'string' ? name.trim() : '');
    if (!res.hit) return false;
    const existed = this.entries.delete(res.hit);
    if (existed) this.emit({ t: new Date().toISOString(), kind: 'dropped', path: res.hit, reason: 'explicit' });
    return existed;
  }

  /**
   * PULL an entry. Resolves by exact path, else the shortest unique suffix. The requester
   * carries its marks; flagged elements come back as the delta past the mark — or whole,
   * when the mark is new / unknown / stale (the self-healing fallback).
   */
  async pull(name: string, options: PullOptions = {}): Promise<PullAnswer> {
    this.pruneDead();
    const at = new Date().toISOString();
    const query = typeof name === 'string' ? name.trim() : '';
    if (!query) return { ok: false, code: 'no_such_entry', name: query, at };
    const res = this.resolvePath(query);
    if (res.ambiguous) return { ok: false, code: 'ambiguous', name: query, candidates: res.candidates, at };
    if (!res.hit) {
      // NOT here — but a shorter prefix may be a link, and a link is the whole point of asking any State any path
      if (options.follow !== false) {
        const followed = await this.followLinks(query, options);
        if (followed) return followed;
      }
      return { ok: false, code: 'no_such_entry', name: query, at };
    }
    const slot = this.entries.get(res.hit);
    if (!slot) return { ok: false, code: 'no_such_entry', name: query, at };
    const marksIn = { ...(options.marks ?? {}) };
    const request: ResolvedPullRequest = { name: res.hit, marks: marksIn, asked: query };

    const recipe = this.recipeOf(slot);
    let served: { content: unknown; full: boolean; marks: Record<string, number | string> };
    if (recipe) {
      const raw = await recipe(request);
      if (isShapedReply(raw)) {
        served = { content: softClone(raw.content), full: raw.full ?? true, marks: { ...(raw.marks ?? {}) } };
      } else {
        served = this.serve(softClone(raw), slot.options.serving, marksIn);
      }
    } else {
      served = this.serve(softClone(slot.content), slot.options.serving, marksIn);
    }
    return { ok: true, name: res.hit, at, full: served.full, content: served.content, marks: served.marks };
  }

  /**
   * DISCOVER — walk the active set (the dead are pruned on the way). No query: everything.
   * A query matches exact paths, endings (the leaf), and things under it. The SHAPE is
   * listed; contents are pulled, never embedded.
   */
  discover(query?: string): StateDiscovery {
    this.pruneDead();
    const q = typeof query === 'string' ? query.trim() : '';
    let paths: string[];
    if (!q) {
      paths = Array.from(this.entries.keys()).sort();
    } else {
      const suffix = '.' + q;
      const set = new Set<string>();
      for (const p of this.entries.keys()) {
        if (p === q || p.endsWith(suffix) || p.startsWith(q + '.')) set.add(p);
      }
      paths = Array.from(set).sort();
    }
    return { ok: true, query: q || null, entries: paths.map((p) => this.describe(p)).filter((info): info is StateEntryInfo => info !== null), summary: this.summary() };
  }

  /** Watch the active set change (registered · updated · dropped · popped). */
  on(watcher: ChangeWatcher): () => void {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }

  summary(): StateSummary {
    return { entries: this.entries.size, changes: this.changes };
  }

  /** Drop every watcher (the registry itself stays; entries are runtime objects). */
  close(): void {
    this.watchers.clear();
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * Follow the longest prefix that is a link, and ask the registry it points at for the SAME name — or for the
   * name the link overrides with `as`, which is how one node can publish a subtree whose leaves live in other
   * nodes' branches (a transfer is the obvious case: one id, two participants, each owning its own half).
   *
   * Returns null when no prefix is a link, so the caller can refuse with the honest "not here".
   */
  private async followLinks(query: string, options: PullOptions): Promise<PullAnswer | null> {
    const via = options.via ?? [];
    const hops = options.hops ?? 0;
    if (hops >= MAX_LINK_HOPS) {
      return { ok: false, code: 'no_such_entry', name: query, at: new Date().toISOString(), why: 'cycle', via, hops, source: null };
    }
    const parts = query.split('.');
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const prefix = parts.slice(0, i).join('.');
      const found = this.resolvePath(prefix);
      if (!found.hit) continue;
      const slot = this.entries.get(found.hit);
      const content = slot?.content as { kind?: unknown; to?: unknown; as?: unknown } | null;
      if (!content || content.kind !== 'link' || typeof content.to !== 'string') continue;

      // WHAT THE FAR SIDE IS ASKED FOR (the remainder rule, 2026-11-10). A link at `node.123` owns everything past it,
      // so the target is asked for the REMAINDER ("makesnodifference") first; a registry that instead holds the SAME
      // full name — every node names its own branch identically in its own registry — is still answered by the second
      // attempt, so both spellings resolve and nothing that worked before stops working. An entry that declares `as`
      // overrides both: it is saying, explicitly, which name its target holds.
      const declared = typeof content.as === 'string' && content.as ? content.as : null;
      const remainder = query.slice(prefix.length + 1);
      const attempts = declared ? [declared] : remainder && remainder !== query ? [remainder, query] : [query];

      let relayed: Awaited<ReturnType<typeof relayPull>> | null = null;
      for (const remote of attempts) {
        relayed = await relayPull(content.to, remote, via, RELAY_TIMEOUT_MS, hops);
        if (relayed.ok) break;
        // only a clean absence justifies trying the other spelling; a target that is unreachable or timed out has already
        // answered the question, and asking it a second name would just double the wait
        if (relayed.why !== 'absent') break;
      }
      if (relayed && relayed.ok) {
        return {
          ok: true,
          name: relayed.name || query,
          at: relayed.at || new Date().toISOString(),
          full: relayed.full !== false,
          content: relayed.value,
          marks: relayed.marks ?? {},
          source: relayed.source,
          hops: relayed.hops,
          via: relayed.via,
        };
      }
      return { ok: false, code: 'no_such_entry', name: query, at: new Date().toISOString(), why: relayed ? relayed.why : 'absent', via: relayed ? relayed.via : via, hops: relayed?.hops ?? hops, source: relayed?.source ?? null };
    }
    return null;
  }

  /**
   * The recipe hand: an explicit pull option, else a DOOR — a registered object with its
   * own `pull(name, options)` hand (e.g. another registry) is asked for the entry's own
   * name (the leaf): the parent relays, and every level answers for its own contents.
   */
  private recipeOf(slot: Slot): PullRecipe | null {
    if (slot.options.pull) return slot.options.pull;
    const content = slot.content as { pull?: unknown } | null;
    if (content && typeof content === 'object' && typeof content.pull === 'function') {
      const door = content as { pull: (name: string, options?: PullOptions) => unknown };
      return (request) => door.pull(request.name.split('.').pop() ?? request.name, { marks: request.marks });
    }
    return null;
  }

  private sameHand(slot: Slot, content: unknown, options: Slot['options']): boolean {
    return (
      deepEqual(slot.content, content) &&
      slot.options.alive === options.alive &&
      slot.options.pull === options.pull &&
      deepEqual(slot.options.serving ?? {}, options.serving ?? {}) &&
      deepEqual(slot.options.render, options.render) &&
      deepEqual(slot.options.update, options.update)
    );
  }

  /** The serving pass — flagged elements sliced past the requester's marks; everything else whole. */
  private serve(content: unknown, serving: Record<string, string>, marksIn: Record<string, number | string>): { content: unknown; full: boolean; marks: Record<string, number | string> } {
    const outMarks: Record<string, number | string> = {};
    if (!content || typeof content !== 'object' || Array.isArray(content)) return { content, full: true, marks: outMarks };
    const obj: Record<string, unknown> = { ...(content as Record<string, unknown>) };
    let full = true;
    for (const [key, mode] of Object.entries(serving)) {
      if (mode !== 'delta') continue;
      const el = obj[key];
      const m = marksIn[key];
      if (typeof el === 'string') {
        const lines = el.split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        const n = lines.length;
        if (typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= n) {
          obj[key] = lines.slice(m).join('\n');
          outMarks[key] = n;
          full = false;
        } else {
          outMarks[key] = n; // new / unknown / stale / unintelligible mark → the whole thing, fresh mark
        }
      } else if (Array.isArray(el)) {
        const n = el.length;
        if (typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= n) {
          obj[key] = el.slice(m);
          outMarks[key] = n;
          full = false;
        } else {
          outMarks[key] = n;
        }
      }
      // any other kind: served whole; no mark to carry
    }
    return { content: obj, full, marks: outMarks };
  }

  /** Exact path → the shortest unique suffix (leaf works when unique) → ambiguous. */
  private resolvePath(query: string): { hit?: string; candidates?: string[]; ambiguous?: boolean } {
    if (this.entries.has(query)) return { hit: query };
    const suffix = '.' + query;
    const candidates = Array.from(this.entries.keys()).filter((p) => p.endsWith(suffix)).sort();
    if (candidates.length === 1) return { hit: candidates[0] };
    if (candidates.length > 1) return { ambiguous: true, candidates };
    return {};
  }

  /** A registration lives exactly as long as its registrant: a declared liveness that says
   *  gone (false, or a throw) pops the entry here — absence reads as absence. */
  private pruneDead(): void {
    for (const [path, slot] of Array.from(this.entries.entries())) {
      const check = slot.options.alive;
      if (!check) continue;
      let alive = true;
      try {
        alive = check() === true;
      } catch {
        alive = false;
      }
      if (!alive) {
        this.entries.delete(path);
        this.emit({ t: new Date().toISOString(), kind: 'dropped', path, reason: 'gone' });
      }
    }
  }

  private describe(path: string): StateEntryInfo | null {
    const slot = this.entries.get(path);
    if (!slot) return null;
    return this.infoOf(slot);
  }

  private infoOf(slot: Slot): StateEntryInfo {
    const content = slot.content;
    let shape: string[];
    if (Array.isArray(content)) {
      shape = [`[${content.length}]`];
    } else if (content && typeof content === 'object') {
      shape = Object.keys(content as Record<string, unknown>).sort();
    } else {
      shape = [`[${typeof content}]`];
    }
    return {
      path: slot.path,
      registeredAt: slot.registeredAt,
      updatedAt: slot.updatedAt,
      hasRecipe: this.recipeOf(slot) !== null,
      serving: { ...slot.options.serving },
      shape,
      hasRender: slot.options.render !== undefined,
      hasUpdate: slot.options.update !== undefined,
    };
  }

  private emit(event: ChangeEvent): void {
    this.changes++;
    for (const watcher of Array.from(this.watchers)) {
      try {
        watcher(event);
      } catch {
        /* a bad watcher never breaks the registry */
      }
    }
  }
}

export function createStateRegistry(): State {
  return new State();
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const st = createStateRegistry();

  // 1. blank at boot
  ok('blank at boot', st.discover().entries.length === 0 && st.summary().entries === 0);

  // 2. names — dotted paths in, junk refused
  ok(
    'a bad name is refused',
    (() => {
      try {
        st.register('bad name!', {});
        return false;
      } catch {
        return true;
      }
    })(),
  );
  ok(
    'empty segments are refused',
    ['', 'A..B', '.A', 'A.'].every((bad) => {
      try {
        st.register(bad, {});
        return false;
      } catch {
        return true;
      }
    }),
  );

  // 3. register — an entry lands with its shape (never its contents)
  const info = st.register('Root.Server.ClientName', { ip: '10.0.0.1', cores: 4 });
  ok('register answers the info', info.path === 'Root.Server.ClientName' && info.hasRecipe === false);
  ok('the shape lists the keys', info.shape.join(',') === 'cores,ip', info.shape.join(','));
  ok('the info carries no contents', !('content' in (info as unknown as Record<string, unknown>)));
  ok('a deep path needs no parents', st.discover().entries.length === 1);

  // 4. identical hand-in = no-op; a changed hand-in = updated (registeredAt kept)
  const before = st.summary().changes;
  const again = st.register('Root.Server.ClientName', { ip: '10.0.0.1', cores: 4 });
  ok('an identical hand-in is a no-op', st.summary().changes === before && again.registeredAt === info.registeredAt);
  const changed = st.register('Root.Server.ClientName', { ip: '10.0.0.2', cores: 4 });
  ok('a changed hand-in updates', st.summary().changes === before + 1 && changed.registeredAt === info.registeredAt && changed.updatedAt >= info.updatedAt);

  // 5. pull — exact, leaf, ambiguous, missing
  const exact = await st.pull('Root.Server.ClientName');
  ok('exact pull answers', exact.ok === true && exact.full === true);
  const leaf = await st.pull('ClientName');
  ok('the leaf alone resolves when unique', leaf.ok === true && (leaf as { name: string }).name === 'Root.Server.ClientName');
  st.register('Other.ClientName', { ip: '10.0.0.9' });
  const amb = await st.pull('ClientName');
  ok('an ambiguous suffix is refused with candidates', amb.ok === false && amb.code === 'ambiguous' && (amb.candidates ?? []).length === 2, JSON.stringify(amb));
  const extended = await st.pull('Server.ClientName');
  ok('extending the suffix disambiguates', extended.ok === true && (extended as { name: string }).name === 'Root.Server.ClientName');
  const missing = await st.pull('Nope');
  ok('a missing entry is refused with a code', missing.ok === false && missing.code === 'no_such_entry');
  st.drop('Other.ClientName');

  // 6. readers get clones — mutating a reply never touches the registry
  st.register('Clone.Check', { a: 1 });
  const first = await st.pull('Clone.Check');
  (first as { content: { a: number } }).content.a = 999;
  const second = await st.pull('Clone.Check');
  ok('replies are clones', (second as { content: { a: number } }).content.a === 1);

  // 7. delta serving — a string serves by lines, past the mark the requester carries
  st.register('Log.Holder', { a: 5, log: 'l1\nl2\nl3\nl4\nl5' }, { serving: { log: 'delta' } });
  const full = await st.pull('Log.Holder');
  ok('a new request gets the FULL state + the fresh mark', full.ok === true && full.full === true && (full as { content: { log: string } }).content.log.split('\n').length === 5 && (full as unknown as { marks: { log: number } }).marks.log === 5);
  const delta = await st.pull('Log.Holder', { marks: { log: 3 } });
  ok('a fresh mark gets the delta past it', delta.ok === true && delta.full === false && (delta as { content: { log: string } }).content.log === 'l4\nl5' && (delta as unknown as { marks: { log: number } }).marks.log === 5);
  const empty = await st.pull('Log.Holder', { marks: { log: 5 } });
  ok('the same mark = an empty delta (nothing new)', empty.ok === true && empty.full === false && (empty as { content: { log: string } }).content.log === '');
  const stale = await st.pull('Log.Holder', { marks: { log: 99 } });
  ok('a stale mark self-heals to FULL', stale.ok === true && stale.full === true && (stale as { content: { log: string } }).content.log.includes('l5'));
  const odd = await st.pull('Log.Holder', { marks: { log: 'x' } });
  ok('an unintelligible mark is FULL', odd.ok === true && odd.full === true);
  ok('an unflagged element stays whole', (delta as { content: { a: number } }).content.a === 5 && !('a' in (delta as { marks: Record<string, unknown> }).marks));
  // trailing-newline boundary: append a line; the delta picks it up exactly
  st.register('Log.Holder', { a: 5, log: 'l1\nl2\nl3\nl4\nl5\nl6' }, { serving: { log: 'delta' } });
  const appended = await st.pull('Log.Holder', { marks: { log: 5 } });
  ok('an appended line lands in the delta', (appended as { content: { log: string } }).content.log === 'l6');

  // 8. delta serving — an array serves by items
  st.register('Queue.Holder', { queue: [1, 2, 3] }, { serving: { queue: 'delta' } });
  const qfull = await st.pull('Queue.Holder');
  ok('an array serves whole with its count', (qfull as unknown as { marks: { queue: number } }).marks.queue === 3);
  const qdelta = await st.pull('Queue.Holder', { marks: { queue: 1 } });
  ok('an array serves past the mark', JSON.stringify((qdelta as { content: { queue: number[] } }).content.queue) === '[2,3]' && (qdelta as unknown as { marks: { queue: number } }).marks.queue === 3);

  // 9. a pull recipe — the entry's own hand answers (plain return = content, served by the flags)
  const seen: ResolvedPullRequest[] = [];
  st.register('Live.One', {}, { pull: (r) => { seen.push(r); return { echo: true, log: 'a\nb\nc' }; }, serving: { log: 'delta' } });
  const liveFull = await st.pull('Live.One');
  ok('a recipe answers, flags still serve', liveFull.ok === true && liveFull.full === true && (liveFull as { content: { log: string } }).content.log === 'a\nb\nc');
  const liveDelta = await st.pull('Live.One', { marks: { log: 1 } });
  ok('a recipe-fed element deltas too', (liveDelta as { content: { log: string } }).content.log === 'b\nc');
  ok('the recipe saw the resolved name + the ask', seen[1].name === 'Live.One' && seen[1].asked === 'Live.One' && seen[1].marks.log === 1);

  // 10. relay + nesting — by registration, never by module knowledge
  const child = createStateRegistry();
  child.register('A', { v: 7 });
  st.register('Node.A', child); // the registered object IS a door — the parent asks it for the leaf ('A'); the child answers for its own contents
  const viaDoor = await st.pull('Node.A');
  const doorEnvelope = (viaDoor as { content: { ok: boolean; content: { v: number } } }).content;
  ok('a registered door answers pulls itself (the child registry answers under its own name)', viaDoor.ok === true && doorEnvelope.ok === true && doorEnvelope.content.v === 7);
  st.register('Node.B', {}, { pull: async (r) => {
    const inner = await child.pull('A', { marks: r.marks });
    return inner.ok ? shaped(inner.content, { full: inner.full, marks: inner.marks }) : shaped({ missing: true });
  } });
  const viaRelay = await st.pull('Node.B');
  ok('a shaped relay follows the nesting', viaRelay.ok === true && (viaRelay as { content: { v: number } }).content.v === 7);

  // 11. pop — a registration lives as long as its registrant
  const kinds: ChangeEvent[] = [];
  const off = st.on((e) => kinds.push(e));
  const st2 = { alive: true };
  st.register('Ephemeral.Thing', { x: 1 }, { alive: () => st2.alive });
  ok('a live registrant stays', st.discover('Ephemeral').entries.length === 1);
  st2.alive = false;
  ok('a dead registrant is popped on the walk', st.discover('Ephemeral').entries.length === 0);
  ok('the pop is a dropped event (gone)', kinds.some((e) => e.kind === 'dropped' && e.path === 'Ephemeral.Thing' && e.reason === 'gone'));
  st.register('Throwing.Thing', { x: 1 }, { alive: () => { throw new Error('gone'); } });
  ok('a throwing liveness check is gone too', st.discover('Throwing').entries.length === 0);
  off();
  const countAfterOff = kinds.length;
  st.register('Quiet.Thing', {});
  ok('unsubscribe stops the flow', kinds.length === countAfterOff);

  // 12. drop — the explicit hand
  const off2 = st.on((e) => kinds.push(e));
  ok('drop answers true', st.drop('Quiet.Thing') === true);
  ok('a second drop answers false', st.drop('Quiet.Thing') === false);
  ok('the explicit drop carries its reason', kinds.some((e) => e.kind === 'dropped' && e.reason === 'explicit'));
  st.register('Deep.Leaf.One', {});
  ok('drop resolves by unique leaf', st.drop('Leaf.One') === true);
  off2();

  // 13. render map + update contract ride along, unread
  const withStanding = st.register('Standing.Entry', { n: 1 }, { render: { as: 'table' }, update: { every: '10s' } });
  ok('the render map is flagged, not read', withStanding.hasRender === true && withStanding.hasUpdate === true);

  // 14. summary tells the truth
  ok('summary counts what is held', st.summary().entries === st.discover().entries.length && st.summary().changes > 0, JSON.stringify(st.summary()));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[stateRegistry] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
