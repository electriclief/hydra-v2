/**
 * The cycle seam — OPTIONAL, and nothing in TrainOfThought depends on it.
 *
 * The Phoenix Cycle is a SEPARATE V2 module that does not exist yet (on the legacy rig it lived in
 * C:\Users\User\phoenix_cycle.py; that code is not part of V2 and TOT must not reach for it). This
 * file only defines what a future cycle WOULD call: a tick that records what it saw, and a handoff
 * packet a successor session reads. If no cycle ever lands, nothing here runs and the door is
 * unaffected — the frontier alone answers "what is next".
 *
 * Two rules keep it honest:
 *   - a tick is IDEMPOTENT per cycle number, so a re-run appends nothing twice;
 *   - a session that is not attached to any train is reported as a warning, never ignored — that is
 *     the case where a session's work is about to be forgotten.
 */

import type { FrontierRow, ThoughtNode, TrailEntry } from './types.js';
import { claimLive, depsSettled, frontier } from './dag.js';
import type { ThoughtStore } from './store.js';

/** Fill percentage at which the cycle should consider a handoff. Phoenix's own pressure.txt runs to 94%. */
export const HANDOFF_FILL_PCT = 85;

export interface CycleSession {
  /** 8-hex SessionDiary ref. */
  ref: string;
  tokens?: number;
  fillPct?: number;
  idleSec?: number;
  title?: string;
}

export interface CycleTick {
  /** Monotonic cycle number from Phoenix. Used for idempotency and for the trail line. */
  cycle: number;
  at?: number;
  by?: string;
  sessions: CycleSession[];
}

export interface HandoffAdvice {
  sessionRef: string;
  /** Nodes this session has touched, most recently touched first. */
  nodes: string[];
  /** Mechanical reasons this session looks like a handoff candidate. Judgment stays with Echidna. */
  why: string[];
  /** What is ready to pick up right now, so the successor does not start cold. */
  frontier: string[];
}

export interface TickResult {
  cycle: number;
  at: number;
  /** Sessions seen in the tick. */
  sessions: number;
  /** Trail lines actually written (0 on a replayed cycle). */
  appended: number;
  handoff: HandoffAdvice[];
  warnings: string[];
}

/** Every node that has this session in its memory — trail lines and closure refs both count. */
export function nodesForSession(nodes: ThoughtNode[], sessionRef: string): ThoughtNode[] {
  return nodes
    .filter((node) => {
      if (node.trail.some((entry) => entry.sessionRef === sessionRef)) return true;
      return (node.closed?.sessionRefs ?? []).includes(sessionRef);
    })
    .sort((a, b) => b.touched - a.touched);
}

function cycleLine(tick: CycleTick, session: CycleSession): string {
  const bits = [`cycle ${tick.cycle}`];
  if (typeof session.fillPct === 'number') bits.push(`fill ${session.fillPct}%`);
  if (typeof session.tokens === 'number') bits.push(`${session.tokens.toLocaleString('en-US')} tokens`);
  if (typeof session.idleSec === 'number' && session.idleSec > 0) bits.push(`idle ${Math.round(session.idleSec / 60)}m`);
  return bits.join(' · ');
}

/** Has this exact cycle already been stamped onto this node? */
function alreadyStamped(node: ThoughtNode, tick: CycleTick, sessionRef: string): boolean {
  return node.trail.some(
    (entry) => entry.sessionRef === sessionRef && entry.kind === 'event' && entry.text.startsWith(`cycle ${tick.cycle} ·`),
  );
}

/**
 * Record one cycle tick. Returns advice, not a verdict: the cycle (and Echidna) decides whether to
 * hand off; this only says what it saw and whether the pressure is past the threshold.
 */
export function recordTick(store: ThoughtStore, tick: CycleTick, handoffFill = HANDOFF_FILL_PCT): TickResult {
  const at = tick.at ?? store.now;
  const by = tick.by ?? 'phoenix';
  const warnings: string[] = [];
  const handoff: HandoffAdvice[] = [];
  let appended = 0;

  const ready = frontier(store.nodes, at).map((node) => `${node.ref} ${node.title}`);

  for (const session of tick.sessions) {
    const touched = nodesForSession(store.nodes, session.ref);
    if (touched.length === 0) {
      warnings.push(`session ${session.ref} is not attached to any train — nothing will remember this work`);
      continue;
    }

    const stamp = cycleLine(tick, session);
    for (const node of touched) {
      if (alreadyStamped(node, tick, session.ref)) continue;
      const entry: TrailEntry = { at, kind: 'event', text: stamp, by, sessionRef: session.ref };
      node.trail.push(entry);
      node.touched = at;
      appended += 1;
    }
    // One save for the whole tick: build in memory, persist once, so a tick is atomic on disk.
    store.save();

    const why: string[] = [];
    if (typeof session.fillPct === 'number' && session.fillPct >= handoffFill) {
      why.push(`pressure ${session.fillPct}% is at or past the ${handoffFill}% handoff line`);
    }
    const primary = touched[0];
    if (primary.state !== 'done' && primary.next.length === 0) {
      why.push(`no next action recorded on ${primary.ref} — a successor would start cold`);
    }
    // A node waiting on unfinished deps is NORMAL, not a handoff reason — the packet carries that
    // detail for the successor. Only pressure and a missing next action raise the candidate.
    if (why.length > 0) {
      handoff.push({ sessionRef: session.ref, nodes: touched.map((node) => node.ref), why, frontier: ready });
    }
  }

  return { cycle: tick.cycle, at, sessions: tick.sessions.length, appended, handoff, warnings };
}

export interface HandoffPacket {
  sessionRef: string;
  /** The line a successor runs to see the transcript, matching the diary's shortcut. */
  resume: string;
  primary: {
    ref: string;
    title: string;
    intent: string;
    state: string;
    nextAction: string | null;
    nextRemaining: number;
    deps: { ref: string; title: string; done: boolean }[];
    claimedBy: string | null;
  } | null;
  /** The last few lines of the train's memory, newest last — what the successor reads first. */
  trail: TrailEntry[];
  /** What is ready to pick up now, so the next session begins on the frontier instead of re-deriving it. */
  frontier: FrontierRow[];
  archive: { ref: string; title: string; summary: string }[];
  warnings: string[];
}

/**
 * The packet a succeeding session (or the cycle, before it writes a handoff brief) is given.
 * Everything here is read-only: building a packet records nothing.
 */
export function handoffPacket(store: ThoughtStore, sessionRef: string, trailLimit = 8): HandoffPacket {
  const at = store.now;
  const nodes = nodesForSession(store.nodes, sessionRef);
  const warnings: string[] = [];
  if (nodes.length === 0) {
    warnings.push(`session ${sessionRef} is attached to no train — a handoff here carries no long-term intent`);
  }

  const primaryNode = nodes[0] ?? null;
  const primary = primaryNode
    ? {
        ref: primaryNode.ref,
        title: primaryNode.title,
        intent: primaryNode.intent,
        state: primaryNode.state,
        nextAction: primaryNode.next[0] ?? null,
        nextRemaining: primaryNode.next.length,
        deps: primaryNode.deps.map((dep) => {
          const target = store.find(dep);
          return { ref: dep, title: target?.title ?? '(missing)', done: target?.state === 'done' };
        }),
        claimedBy: primaryNode.claimed && claimLive(primaryNode, at) ? primaryNode.claimed.by : null,
      }
    : null;

  const trail = primaryNode ? primaryNode.trail.slice(-trailLimit) : [];
  const frontierRows: FrontierRow[] = frontier(store.nodes, at).map((node) => {
    const settled = depsSettled(store.nodes, node);
    return {
      ref: node.ref,
      title: node.title,
      intent: node.intent,
      nextAction: node.next[0] ?? '',
      touched: node.touched,
      depsDone: settled.done,
      depsTotal: settled.total,
      sessions: uniqueSessionRefs(node),
      lastTrail: node.trail.length > 0 ? node.trail[node.trail.length - 1] : null,
    };
  });

  const archive = store.nodes
    .filter((node) => node.state === 'done' && node.closed)
    .map((node) => ({ ref: node.ref, title: node.title, summary: node.closed?.summary ?? '', at: node.closed?.at ?? 0 }))
    .sort((a, b) => b.at - a.at)
    .map(({ ref, title, summary }) => ({ ref, title, summary }));

  return {
    sessionRef,
    resume: `hermes --resume ${sessionRef}`,
    primary,
    trail,
    frontier: frontierRows,
    archive,
    warnings,
  };
}

function uniqueSessionRefs(node: ThoughtNode): string[] {
  const out: string[] = [];
  for (const entry of node.trail) {
    if (entry.sessionRef && !out.includes(entry.sessionRef)) out.push(entry.sessionRef);
  }
  for (const ref of node.closed?.sessionRefs ?? []) if (!out.includes(ref)) out.push(ref);
  return out;
}
