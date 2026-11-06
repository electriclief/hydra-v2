/**
 * The store: one JSON file, atomic writes, append-only trails.
 *
 * Chosen over sqlite on purpose — a train of thought is something a human should be able to open,
 * read and hand-edit while the agent is also using it, and a plain object diffs. Every mutation
 * touches one node and saves once; nothing here is clever.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { AddNodeInput, CloseInput, StoreShape, ThoughtNode, ThoughtState, TrailEntry, TrailKind } from './types.js';
import { byRef, claimLive, depsSettled, frontier, wouldCycle } from './dag.js';
import { writeFiles as writeFrontierFiles } from './frontier.js';

export class ThoughtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'ThoughtError';
  }
}

const STATES: ThoughtState[] = ['active', 'parked', 'blocked', 'done'];
const KINDS: TrailKind[] = ['session', 'note', 'decision', 'event', 'claim', 'state'];

export function newRef(): string {
  return randomBytes(4).toString('hex');
}

export interface TrailInput {
  kind: TrailKind;
  text: string;
  by: string;
  sessionRef?: string;
  at?: number;
}

export interface StoreOptions {
  file: string;
  now?: () => number;
}

export class ThoughtStore {
  readonly file: string;
  data: StoreShape;
  private readonly clock: () => number;
  private lastMtime = 0;
  private lastCheck = 0;

  constructor(options: StoreOptions) {
    this.file = options.file;
    this.clock = options.now ?? (() => Date.now());
    this.data = this.read();
    this.lastMtime = this.mtime();
  }

  get now(): number {
    return this.clock();
  }

  private read(): StoreShape {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreShape>;
      if (!raw || !Array.isArray(raw.nodes)) return { version: 1, nodes: [] };
      return { version: 1, nodes: raw.nodes as ThoughtNode[] };
    } catch {
      return { version: 1, nodes: [] };
    }
  }

  /** Reload from disk — the file is hand-editable, so a long-lived door must re-read before writing. */
  reload(): void {
    this.data = this.read();
    this.lastMtime = this.mtime();
  }

  private mtime(): number {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * The file is the source of truth, not this process's copy of it. A door that caches the store until restart
   * makes editing the file — or another tool filing a thought — invisible, and the tree then shows yesterday's asks.
   * Stat at most four times a second, so a busy page cannot turn reads into disk churn.
   */
  private refreshIfChanged(): void {
    const now = Date.now();
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    const m = this.mtime();
    if (m !== this.lastMtime) {
      this.lastMtime = m;
      this.data = this.read();
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    // The brief a new session reads lives beside the store and is rewritten here, on every save, so it can
    // never describe a node that has already moved. Failures are swallowed: a stale brief is bad, a lost
    // write is worse.
    writeFrontierFiles(path.dirname(this.file), this.data.nodes, path.basename(this.file));
  }

  get nodes(): ThoughtNode[] {
    this.refreshIfChanged();
    return this.data.nodes;
  }

  find(ref: string): ThoughtNode | undefined {
    return byRef(this.data.nodes).get(ref);
  }

  require(ref: string): ThoughtNode {
    const node = this.find(ref);
    if (!node) throw new ThoughtError('no_such_node', `no thought with ref ${ref}`);
    return node;
  }

  // ---------------------------------------------------------------- writes

  add(input: AddNodeInput, by = 'agent'): ThoughtNode {
    const title = (input.title ?? '').trim();
    if (title.length < 3) throw new ThoughtError('bad_title', 'title must be at least 3 characters');
    const deps = unique(input.deps ?? []);
    for (const dep of deps) this.require(dep);

    const at = this.now;
    const node: ThoughtNode = {
      ref: this.mintRef(),
      title,
      intent: (input.intent ?? '').trim(),
      state: 'active',
      deps,
      next: (input.next ?? []).map((line) => line.trim()).filter(Boolean),
      tags: unique(input.tags ?? []),
      trail: [{ at, kind: 'state', text: 'created', by }],
      created: at,
      touched: at,
    };
    this.data.nodes.push(node);
    // Every thought owns a folder from the moment it exists — an intention with nowhere to put its
    // output is a note, and the output ends up in the wrong place six weeks later.
    const dir = path.join(path.dirname(this.file), 'thoughts', node.ref);
    fs.mkdirSync(dir, { recursive: true });
    node.dir = path.join('thoughts', node.ref).replace(/\\/g, '/');
    this.save();
    return node;
  }

  /** Patch prose/fields. Never a silent no-op: an unknown field is ignored, a bad state is refused. */
  update(ref: string, patch: { title?: string; intent?: string; next?: string[]; tags?: string[] }, by = 'agent'): ThoughtNode {
    const node = this.require(ref);
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length < 3) throw new ThoughtError('bad_title', 'title must be at least 3 characters');
      node.title = title;
    }
    if (patch.intent !== undefined) node.intent = patch.intent.trim();
    if (patch.next !== undefined) node.next = patch.next.map((line) => line.trim()).filter(Boolean);
    if (patch.tags !== undefined) node.tags = unique(patch.tags);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'note', text: `edited by ${by}`, by });
    this.save();
    return node;
  }

  /** Link dep -> ref. Refuses a missing node and refuses a cycle, by name. */
  link(ref: string, dep: string, by = 'agent'): ThoughtNode {
    const node = this.require(ref);
    const target = this.require(dep);
    if (node.deps.includes(dep)) throw new ThoughtError('already_linked', `${dep} is already a dependency of ${ref}`);
    if (wouldCycle(this.data.nodes, ref, dep)) {
      throw new ThoughtError('cycle', `${dep} already waits on ${ref} (directly or further down) — that edge would close a loop`);
    }
    node.deps.push(dep);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'note', text: `waits on ${target.title} [${dep}]`, by });
    this.save();
    return node;
  }

  unlink(ref: string, dep: string, by = 'agent'): ThoughtNode {
    const node = this.require(ref);
    if (!node.deps.includes(dep)) throw new ThoughtError('not_linked', `${dep} is not a dependency of ${ref}`);
    node.deps = node.deps.filter((item) => item !== dep);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'note', text: `no longer waits on [${dep}]`, by });
    this.save();
    return node;
  }

  /** Append one line of memory. This is how a session gets attached to a train. */
  trail(ref: string, input: TrailInput): ThoughtNode {
    const node = this.require(ref);
    if (!KINDS.includes(input.kind)) throw new ThoughtError('bad_kind', `kind must be one of ${KINDS.join('|')}`);
    const text = input.text.trim();
    if (text.length === 0) throw new ThoughtError('empty_note', 'a trail line needs text');
    const entry: TrailEntry = {
      at: input.at ?? this.now,
      kind: input.kind,
      text,
      by: input.by || 'agent',
      ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
    };
    node.trail.push(entry);
    node.touched = entry.at;
    this.save();
    return node;
  }

  setState(ref: string, state: ThoughtState, by = 'agent', text?: string): ThoughtNode {
    if (!STATES.includes(state)) throw new ThoughtError('bad_state', `state must be one of ${STATES.join('|')}`);
    if (state === 'done') throw new ThoughtError('use_close', 'closing a train needs a summary — POST close instead of setting state=done');
    const node = this.require(ref);
    node.state = state;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'state', text: text?.trim() || `state -> ${state}`, by });
    this.save();
    return node;
  }

  /** Close = archive. The summary is required: it is the only thing the archive is for. */
  close(ref: string, input: CloseInput, by = 'agent'): ThoughtNode {
    const node = this.require(ref);
    const summary = (input.summary ?? '').trim();
    if (summary.length < 8) throw new ThoughtError('bad_summary', 'a closing summary is required (why this train is done)');
    const at = this.now;
    node.state = 'done';
    node.closed = { at, summary, sessionRefs: unique(input.sessionRefs ?? []) };
    node.touched = at;
    node.trail.push({ at, kind: 'state', text: `closed — ${summary}`, by });
    this.save();
    return node;
  }

  reopen(ref: string, by = 'agent', text?: string): ThoughtNode {
    const node = this.require(ref);
    if (node.state !== 'done') throw new ThoughtError('not_closed', `${ref} is not closed (state=${node.state})`);
    node.state = 'active';
    delete node.closed;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'state', text: text?.trim() || 'reopened', by });
    this.save();
    return node;
  }

  /** Take the lease. A live lease is a refusal carrying the holder — never a silent overwrite. */
  claim(ref: string, by: string, minutes = 30): ThoughtNode {
    const node = this.require(ref);
    const holder = by.trim();
    if (!holder) throw new ThoughtError('bad_claim', 'a claim needs a name');
    if (claimLive(node, this.now)) {
      throw new ThoughtError('claimed', `${ref} is held by ${node.claimed?.by} until ${new Date(node.claimed?.expiresAt ?? 0).toISOString()}`);
    }
    const at = this.now;
    node.claimed = { by: holder, at, expiresAt: at + Math.max(1, minutes) * 60_000 };
    node.trail.push({ at, kind: 'claim', text: `claimed for ${minutes} min`, by: holder });
    this.save();
    return node;
  }

  release(ref: string, by = 'agent', force = false): ThoughtNode {
    const node = this.require(ref);
    if (!node.claimed) throw new ThoughtError('not_claimed', `${ref} is not claimed`);
    if (!force && claimLive(node, this.now) && node.claimed.by !== by) {
      throw new ThoughtError('not_holder', `${ref} is held by ${node.claimed.by} — only they (or force) can release it`);
    }
    const held = node.claimed.by;
    delete node.claimed;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: 'claim', text: `released (was ${held})`, by });
    this.save();
    return node;
  }

  // ---------------------------------------------------------------- reads

  ready(now = this.now): ThoughtNode[] {
    return frontier(this.data.nodes, now);
  }

  /**
   * Drop leases whose time ran out and say so in the trail. A crashed agent must not hold a train
   * forever — an expired seat is the honest, implicit logout.
   */
  reapExpired(now = this.now): number {
    let dropped = 0;
    for (const node of this.data.nodes) {
      if (!node.claimed) continue;
      if (node.claimed.expiresAt > now) continue;
      const held = node.claimed.by;
      delete node.claimed;
      node.trail.push({ at: now, kind: 'claim', text: `seat expired (was ${held})`, by: 'system' });
      dropped += 1;
    }
    if (dropped > 0) this.save();
    return dropped;
  }

  /** Find by ref, else by the first title that contains the text (case-insensitive). */
  resolve(needle: string): ThoughtNode | undefined {
    const byRefHit = this.find(needle.trim());
    if (byRefHit) return byRefHit;
    const text = needle.trim().toLowerCase();
    if (text.length < 3) return undefined;
    return this.data.nodes.find((node) => node.title.toLowerCase().includes(text));
  }

  /** Every live seat right now — the straight answer to "who is working on what". */
  seats(now = this.now): { ref: string; title: string; by: string; since: number; expiresAt: number; next: string | null }[] {
    return this.data.nodes
      .filter((node) => node.claimed && node.claimed.expiresAt > now)
      .map((node) => ({
        ref: node.ref,
        title: node.title,
        by: node.claimed?.by ?? '',
        since: node.claimed?.at ?? 0,
        expiresAt: node.claimed?.expiresAt ?? 0,
        next: node.next[0] ?? null,
      }));
  }

  settled(ref: string): { done: number; total: number; ok: boolean } {
    return depsSettled(this.data.nodes, this.require(ref));
  }

  private mintRef(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ref = newRef();
      if (!this.find(ref)) return ref;
    }
    throw new ThoughtError('ref_collision', 'could not mint a unique 8-hex ref after 50 tries');
  }
}

function unique(list: string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    const value = String(item).trim();
    if (value.length > 0 && !out.includes(value)) out.push(value);
  }
  return out;
}
