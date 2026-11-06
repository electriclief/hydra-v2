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
export interface PullOptions {
    /** The marks the requester carries — element key → what it already holds. */
    marks?: Record<string, number | string>;
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
}
export interface PullRefusal {
    ok: false;
    code: 'no_such_entry' | 'ambiguous';
    /** The name as asked. */
    name: string;
    /** For 'ambiguous': the full paths that matched — extend the suffix until unique. */
    candidates?: string[];
    at: string;
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
/** Is this return a recipe answering EXACTLY (to be passed through)? */
export declare function isShapedReply(value: unknown): value is ShapedReply;
/** Shape a reply for the relay path — recipes that answer EXACTLY return shaped(...). */
export declare function shaped(content: unknown, options?: {
    full?: boolean;
    marks?: Record<string, number | string>;
}): ShapedReply;
/**
 * The state registry — the retainer and the retriever. Boots blank; holds what it is
 * handed; decides nothing.
 */
export declare class State {
    private entries;
    private watchers;
    private changes;
    /**
     * Put ANY object under a dotted-path name. The same path re-registered = last hand-in
     * wins (upsert); an identical hand-in is a no-op (v1's spirit kept).
     */
    register(name: string, content: unknown, options?: RegisterOptions): StateEntryInfo;
    /** The explicit death hand — remove an entry (unique suffix resolves like a pull). */
    drop(name: string): boolean;
    /**
     * PULL an entry. Resolves by exact path, else the shortest unique suffix. The requester
     * carries its marks; flagged elements come back as the delta past the mark — or whole,
     * when the mark is new / unknown / stale (the self-healing fallback).
     */
    pull(name: string, options?: PullOptions): Promise<PullAnswer>;
    /**
     * DISCOVER — walk the active set (the dead are pruned on the way). No query: everything.
     * A query matches exact paths, endings (the leaf), and things under it. The SHAPE is
     * listed; contents are pulled, never embedded.
     */
    discover(query?: string): StateDiscovery;
    /** Watch the active set change (registered · updated · dropped · popped). */
    on(watcher: ChangeWatcher): () => void;
    summary(): StateSummary;
    /** Drop every watcher (the registry itself stays; entries are runtime objects). */
    close(): void;
    /**
     * The recipe hand: an explicit pull option, else a DOOR — a registered object with its
     * own `pull(name, options)` hand (e.g. another registry) is asked for the entry's own
     * name (the leaf): the parent relays, and every level answers for its own contents.
     */
    private recipeOf;
    private sameHand;
    /** The serving pass — flagged elements sliced past the requester's marks; everything else whole. */
    private serve;
    /** Exact path → the shortest unique suffix (leaf works when unique) → ambiguous. */
    private resolvePath;
    /** A registration lives exactly as long as its registrant: a declared liveness that says
     *  gone (false, or a throw) pops the entry here — absence reads as absence. */
    private pruneDead;
    private describe;
    private infoOf;
    private emit;
}
export declare function createStateRegistry(): State;
export declare function runTests(): Promise<void>;
