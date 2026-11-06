/**
 * @module resolver
 * @description THE RESOLUTION — the whole point of the module. Asked for a name, it never
 *              reports "not found" when the truth is "not started yet". Four answers, and
 *              only the last is a failure: up · starting · offered · absent. `should` and
 *              `is` are held as two separate columns and NEVER merged — a declared-but-dead
 *              module stays visible, which is *nothing hidden* applied to the shelf itself.
 * @intent The operator's contract: "if wiring looks for something not there, it triggers the
 *              lazy load." So a lookup of something here-but-down ASKS PROCESSWRAPPER TO
 *              START IT and answers `is: starting`. The node advertises honestly and resolves
 *              quietly: "text to speech appears as installed until triggered", "an LLM
 *              conversation can appear active until a request" — the offer is visible, the
 *              running is what happens when it is needed.
 */

import type { Declaration } from './declaration.js';

// --- Interface Definitions ---

/** The `is` column. `starting` and `absent` are why this module exists at all. */
export type Liveness = 'up' | 'down' | 'starting' | 'offered' | 'absent';

/** One row of the shelf: a declaration, a liveness, and never a merged verdict. */
export interface ShelfEntry {
  readonly name: string;
  readonly kind: Declaration['kind'];
  /** COLUMN ONE — what the files say. Always present, even when the door is dead. */
  readonly should: {
    readonly port: number | null;
    readonly start: string | null;
    readonly wiredAtBoot: boolean;
    readonly what: string;
    readonly missing: readonly string[];
    /** Where it answers when that is not a port (node, mcp, share). */
    readonly url?: string | null;
    readonly deps?: readonly string[];
    readonly provides?: readonly string[];
    readonly tags?: readonly string[];
  };
  /** COLUMN TWO — what is answering right now. Probed, never cached as a green tick. */
  readonly is: Liveness;
  readonly detail: string;
  /** true = the kind is in the catalog. false = accepted as declared, never coerced. */
  readonly kindKnown?: boolean;
  /** 'file' = join.json on disk · 'registered' = added to the member store at runtime. */
  readonly origin?: 'file' | 'registered';
}

/** One name, resolved. `reason` is the machine-readable 'why'. */
export interface Resolution {
  readonly name: string;
  readonly found: boolean;
  readonly kind: Declaration['kind'] | 'unknown';
  readonly port: number | null;
  readonly liveness: Liveness;
  readonly what: string;
  readonly wiredAtBoot: boolean;
  /** What happened, for a reader with no context. */
  readonly reason: string;
  /** The honest alternative: when absent, what IS here. Always present on a refusal. */
  readonly alternatives: readonly string[];
  /** Where a url-shaped member answers (node · mcp · share), else null. */
  readonly url?: string | null;
  readonly origin?: 'file' | 'registered';
}

/** The offered population — the catalog. Present ≠ running; that is the point. */
export interface Offered {
  readonly name: string;
  readonly provider: string;
  readonly what: string;
  readonly liveness: 'offered';
}

/** How Join reaches the world: it asks, and something else acts. */
export interface ResolverDeps {
  /** Is a door answering right now? Given a port, answer honestly. */
  probe(port: number): Promise<boolean>;
  /** Ask ProcessWrapper to start a module. Join never spawns anything itself. */
  start?(name: string, decl: Declaration): Promise<{ ok: boolean; error?: string; id?: string }>;
  /** The OFFERED population, fetched from the catalog door (Services :8128). */
  listOffered?(): Promise<Offered[]>;
  /** Ask a url-shaped member (node · mcp · share) whether it answers. null = cannot tell. */
  probeDecl?(decl: Declaration): Promise<boolean | null>;
}

// --- Function Definitions ---

/** Fold a declaration + a probe into a row. The two columns stay two columns. */
export function toEntry(decl: Declaration, liveness: Liveness, detail: string): ShelfEntry {
  return {
    name: decl.name,
    kind: decl.kind,
    should: {
      port: decl.port,
      start: decl.start,
      wiredAtBoot: decl.wiredAtBoot,
      what: decl.what,
      missing: decl.missing,
      url: decl.url ?? null,
      deps: decl.deps ?? [],
      provides: decl.provides ?? [],
      tags: decl.tags ?? [],
    },
    is: liveness,
    detail,
    kindKnown: decl.kindKnown ?? true,
    origin: decl.origin ?? 'file',
  };
}

/** Fold every declaration into rows, probing only what can be probed. */
export async function buildShelf(decls: readonly Declaration[], deps: ResolverDeps): Promise<ShelfEntry[]> {
  const out: ShelfEntry[] = [];
  for (const d of decls) {
    if (d.port !== null) {
      const up = await deps.probe(d.port);
      out.push(toEntry(d, up ? 'up' : 'down', up
        ? `answering on ${d.port}`
        : `declared on ${d.port}, not answering${d.start ? '' : ' · no start command declared'}`));
    } else if (d.url) {
      const up = deps.probeDecl ? await deps.probeDecl(d) : null;
      out.push(toEntry(d, up === true ? 'up' : 'down', up === null
        ? `answers on ${d.url} — not probed here (no port)`
        : up ? `answering on ${d.url}` : `declared at ${d.url}, not answering`));
    } else if (d.kind === 'shell') {
      // A shell has no port. Its liveness is "is it in the window" — which Join does not
      // own, so it reports the honest truth: no port, no probe, not a failure.
      out.push(toEntry(d, 'down', 'a shell — no door to probe; the window decides'));
    } else {
      out.push(toEntry(d, 'down', `${d.kind} — no port and no url declared, so there is nothing to probe`));
    }
  }
  return out;
}

/** Names are matched case-insensitively, because a limited agent will not recall the caps. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * RESOLVE one name. The order matters and is the module's whole behaviour:
 *   1. is it here and UP?      → answer, act on nothing
 *   2. is it here but DOWN?    → ask PW to start it, answer `starting`
 *   3. is it OFFERED (catalog)?→ answer `offered`; it starts on its own run, no port here
 *   4. genuinely ABSENT        → say so, AND carry the list of what is here
 * Only step 4 is a failure, and even it helps.
 */
export async function resolve(
  name: string,
  decls: readonly Declaration[],
  deps: ResolverDeps,
  offered: readonly Offered[] = [],
): Promise<Resolution> {
  const here = decls.filter(d => sameName(d.name, name));

  for (const d of here) {
    if (d.kind === 'door' && d.port !== null) {
      if (await deps.probe(d.port)) {
        return {
          name: d.name, found: true, kind: d.kind, port: d.port, liveness: 'up',
          what: d.what, wiredAtBoot: d.wiredAtBoot,
          reason: `answering on ${d.port}`,
          alternatives: [],
        };
      }
      // HERE BUT DOWN — the lazy load. Never "not found".
      let startNote = 'no start command declared — this one needs a human';
      let id: string | undefined;
      if (deps.start && d.start) {
        const res = await deps.start(d.name, d);
        startNote = res.ok
          ? `asked ProcessWrapper to start it${res.id ? ` (life ${res.id})` : ''}`
          : `ProcessWrapper refused: ${res.error ?? 'unknown reason'}`;
        id = res.id;
        void id;
      }
      return {
        name: d.name, found: true, kind: d.kind, port: d.port, liveness: 'starting',
        what: d.what, wiredAtBoot: d.wiredAtBoot,
        reason: `declared on ${d.port}, not answering — ${startNote}`,
        alternatives: [],
      };
    }
    // A url-shaped thing (node · mcp · share) — here by declaration, answered on its url.
    if (d.url) {
      const up = deps.probeDecl ? await deps.probeDecl(d) : null;
      return {
        name: d.name, found: true, kind: d.kind, port: null,
        liveness: up === true ? 'up' : 'down',
        what: d.what, wiredAtBoot: d.wiredAtBoot,
        reason: up === null
          ? `answers on ${d.url} — not probed here (no port); nothing on this shelf can start it`
          : up ? `answering on ${d.url}` : `declared at ${d.url}, not answering — nothing on this shelf can start it`,
        alternatives: [], url: d.url, origin: d.origin,
      };
    }

    // A shell or the catalog is HERE — never a lazy load, never a port.
    return {
      name: d.name, found: true, kind: d.kind, port: null, liveness: 'down',
      what: d.what, wiredAtBoot: d.wiredAtBoot,
      reason: d.kind === 'shell'
        ? 'a shell — it has no door; the window decides whether it is showing'
        : 'the catalog — it holds definitions and runs nothing',
      alternatives: [],
    };
  }

  const offer = offered.find(o => sameName(o.name, name));
  if (offer) {
    return {
      name: offer.name, found: true, kind: 'catalog', port: null, liveness: 'offered',
      what: offer.what, wiredAtBoot: false,
      reason: `offered by ${offer.provider} — it starts when it is run, not before`,
      alternatives: [],
    };
  }

  // GENUINELY ABSENT — the only failure, and it still helps.
  return {
    name, found: false, kind: 'unknown', port: null, liveness: 'absent',
    what: '', wiredAtBoot: false,
    reason: `no such thing on this shelf — and that is the ONLY answer that means "not here"`,
    alternatives: [...decls.map(d => d.name), ...offered.map(o => o.name)].sort(),
  };
}

// --- Function Definitions (tests) ---

/** A probe that answers from a set — the REAL seam, driven for real. */
export function runTests(): void {
  const decls: Declaration[] = [
    {
      name: 'State', kind: 'door', port: 8127, start: 'node main.js', wiredAtBoot: false,
      what: 'the generic retainer', sources: { port: 'join.json' }, missing: [],
    },
    {
      name: 'Electron_Wrapper', kind: 'shell', port: null, start: 'electron main.cjs', wiredAtBoot: true,
      what: 'the one window', sources: { kind: 'join.json' }, missing: [],
    },
    {
      name: 'Basic_App', kind: 'door', port: 8130, start: 'node main.js', wiredAtBoot: false,
      what: 'the service shelf instance', sources: { port: 'join.json' }, missing: [],
    },
  ];
  const offered: Offered[] = [
    { name: 'chat', provider: 'llama.cpp', what: 'one chat, several brains', liveness: 'offered' },
  ];
  const calls: string[] = [];
  const upPorts = new Set([8127]);

  const deps: ResolverDeps = {
    probe: async (port) => { calls.push(`probe:${port}`); return upPorts.has(port); },
    start: async (name) => { calls.push(`start:${name}`); upPorts.add(8130); return { ok: true, id: 'life-1' }; },
    listOffered: async () => offered,
  };

  void (async () => {
    // 1. here and UP → answer, act on nothing
    const a = await resolve('State', decls, deps, offered);
    console.assert(a.found === true && a.liveness === 'up' && a.port === 8127, 'an up door answers with its port', JSON.stringify(a.liveness));
    console.assert(!calls.some(c => c.startsWith('start:')), 'an up door is never re-started');

    // 2. HERE BUT DOWN → THE LAZY LOAD. This is the module's whole reason to exist.
    const b = await resolve('Basic_App', decls, deps, offered);
    console.assert(b.found === true, 'something here-but-down is NOT "not found"', String(b.found));
    console.assert(b.liveness === 'starting', 'and it answers `starting`', b.liveness);
    console.assert(calls.includes('start:Basic_App'), 'and it asked ProcessWrapper to start it', calls.join(','));
    console.assert(b.reason.includes('asked ProcessWrapper'), 'the reason says what it did', b.reason);
    const b2 = await resolve('Basic_App', decls, deps, offered);
    console.assert(b2.liveness === 'up', 'the second ask finds it up — it resolved, it never vanished', b2.liveness);

    // 3. a SHELL is here, has no port, and is never a lazy load
    const c = await resolve('Electron_Wrapper', decls, deps, offered);
    console.assert(c.found === true && c.port === null, 'a shell is found with no port', String(c.port));
    console.assert(!calls.includes('start:Electron_Wrapper'), 'a shell is never "started" by Join');

    // 4. OFFERED — the catalog population, answered without a port
    const d = await resolve('chat', decls, deps, offered);
    console.assert(d.found === true && d.liveness === 'offered' && d.port === null,
      'an offered service is found with no port', `${d.liveness}/${d.port}`);
    console.assert(d.reason.includes('starts when it is run'), 'offered explains itself', d.reason);

    // 5. GENUINELY ABSENT — a real refusal, and it carries the alternatives
    const e = await resolve('Nonexistent', decls, deps, offered);
    console.assert(e.found === false && e.liveness === 'absent', 'absent is the only real refusal', e.liveness);
    console.assert(e.alternatives.includes('State') && e.alternatives.includes('chat'),
      'a refusal still hands over what IS here', e.alternatives.join(','));

    // 6. case-insensitive — a limited agent will not recall the caps
    const f = await resolve('sTaTe', decls, deps, offered);
    console.assert(f.found === true && f.port === 8127, 'names match without regard to case', String(f.found));

    // 7. THE TWO COLUMNS NEVER MERGE: a declared-but-dead module is still a row
    const shelf = await buildShelf(decls, deps);
    const basic = shelf.find(x => x.name === 'Basic_App');
    console.assert(!!basic && basic.should.port === 8130, 'the should column is there whatever the is column says', String(basic?.should.port));
    const upState = shelf.find(x => x.name === 'State');
    console.assert(upState?.is === 'up' && upState?.should.port === 8127,
      'up is a probe result held beside the declaration, never instead of it', `${upState?.is}`);
    console.assert(shelf.every(x => x.should !== undefined && x.is !== undefined),
      'every row carries both columns');
  })();
}

// runTests();