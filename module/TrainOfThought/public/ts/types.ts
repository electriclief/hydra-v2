/**
 * Train Of Thought — record types.
 *
 * A thought is a NODE in a DAG, not a row in a list. V1 was a DAG and this keeps that: the
 * edges are what make "what is next" answerable without a schedule. `deps[]` holds the refs a
 * node WAITS ON (edge dep -> this). A node is ready when every dep is `done`, nobody holds a
 * live claim, and it still has an action in `next[]`.
 *
 * Refs are 8 hex — the same shape a SessionDiary ref uses, so a ref can be pasted into either
 * door without translation.
 */

export type ThoughtState = 'active' | 'parked' | 'blocked' | 'done';

export type TrailKind = 'session' | 'note' | 'decision' | 'event' | 'claim' | 'state';

/** One line of a node's memory. Append-only: nothing is ever rewritten in a trail. */
export interface TrailEntry {
  at: number;
  kind: TrailKind;
  text: string;
  /** Who did it: an agent name, `user`, or `process`. Never empty — provenance is the point. */
  by: string;
  /** SessionDiary ref (8 hex) when this line came out of a session. */
  sessionRef?: string;
}

export interface Closure {
  at: number;
  /** One line: what closed this train. The whole value of the archive is this sentence. */
  summary: string;
  sessionRefs: string[];
}

/** A lease. Parallel agents claim a node so two of them cannot advance one train. */
export interface Claim {
  by: string;
  at: number;
  expiresAt: number;
}

export interface ThoughtNode {
  ref: string;
  title: string;
  /** Why this exists and what "done" looks like — prose, not an enum. */
  intent: string;
  state: ThoughtState;
  /** Refs this node waits on. Edge direction: dep -> this. */
  deps: string[];
  /** The ordered next actions. `next[0]` is what /api/next reports. */
  next: string[];
  tags: string[];
  trail: TrailEntry[];
  /** Repo-relative folder for this thought's artifacts: `thoughts/<ref>` under the data dir. */
  dir?: string;
  created: number;
  touched: number;
  closed?: Closure;
  claimed?: Claim;
}

export interface StoreShape {
  version: 1;
  nodes: ThoughtNode[];
}

/** One row of the frontier — what an agent gets handed when it asks what is next. */
export interface FrontierRow {
  ref: string;
  title: string;
  intent: string;
  nextAction: string;
  touched: number;
  depsDone: number;
  depsTotal: number;
  sessions: string[];
  lastTrail: TrailEntry | null;
}

export interface AddNodeInput {
  title: string;
  intent: string;
  deps?: string[];
  next?: string[];
  tags?: string[];
}

export interface CloseInput {
  summary: string;
  sessionRefs?: string[];
}
