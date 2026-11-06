/**
 * The frontier brief — the two files a NEW SESSION reads.
 *
 * Why this exists: the store (thoughts.json) is the truth, and the door on 8135 is only a way to look at it.
 * A session that starts on a box where the door is down still needs to know what the train of thought says is
 * next, so the brief is generated as FILES, not as an API response:
 *
 *   data/frontier.md    human + agent readable: what to take up, what is stuck and why
 *   data/frontier.json  the same snapshot for anything that wants to parse it
 *
 * It is regenerated on every store save, so it can never be older than the store it describes — a stale brief
 * is worse than no brief, because it would send a session at work that is already closed.
 *
 * No server is involved in reading it. `node public/js/frontier.js --data <dir>` prints it; `cat` works too.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ThoughtNode } from './types.js';
import { claimLive, depsSettled, frontier, isReady, whyStuck } from './dag.js';

export interface FrontierRowOut {
  ref: string;
  title: string;
  intent: string;
  next: string[];
  depsDone: number;
  depsTotal: number;
  tags: string[];
  claimedBy?: string;
}

export interface FrontierStuckRow {
  ref: string;
  title: string;
  state: string;
  reason: string;
  missing: number;
}

export interface FrontierSnapshot {
  generatedAt: string;
  store: string;
  counts: { total: number; active: number; blocked: number; parked: number; done: number };
  takeUp: FrontierRowOut[];
  alsoReady: string[];
  stuck: FrontierStuckRow[];
  blockedBy: Record<string, number>;
}

function row(nodes: ThoughtNode[], node: ThoughtNode): FrontierRowOut {
  const deps = depsSettled(nodes, node);
  const claim = (node as unknown as { claim?: { by?: string; until?: number } }).claim;
  const live = claimLive(node, Date.now());
  return {
    ref: node.ref,
    title: node.title,
    intent: node.intent,
    next: Array.isArray(node.next) ? node.next : [],
    depsDone: deps.done,
    depsTotal: deps.total,
    tags: Array.isArray(node.tags) ? node.tags : [],
    ...(live && claim?.by ? { claimedBy: claim.by } : {}),
  };
}

/** The snapshot a new session should see: what it can take up now, and what is stuck and why. */
export function snapshot(nodes: ThoughtNode[], storeLabel = 'thoughts.json'): FrontierSnapshot {
  const now = Date.now();
  const ready = frontier(nodes, now);
  const stuckRows: FrontierStuckRow[] = [];
  for (const node of nodes) {
    if (node.state === 'done') continue;
    if (isReady(nodes, node, now)) continue;
    const deps = depsSettled(nodes, node);
    const reason = deps.ok
      ? claimLive(node, now)
        ? 'claimed by another session'
        : node.state === 'parked'
          ? 'parked on purpose'
          : node.state === 'blocked'
            ? 'marked blocked'
            : 'no next action recorded'
      : `waiting on ${deps.total - deps.done} of ${deps.total} dependencies`;
    stuckRows.push({ ref: node.ref, title: node.title, state: node.state, reason, missing: deps.total - deps.done });
  }

  const counts = {
    total: nodes.length,
    active: nodes.filter((n) => n.state === 'active').length,
    blocked: nodes.filter((n) => n.state === 'blocked').length,
    parked: nodes.filter((n) => n.state === 'parked').length,
    done: nodes.filter((n) => n.state === 'done').length,
  };

  return {
    generatedAt: new Date(now).toISOString(),
    store: storeLabel,
    counts,
    takeUp: ready.map((n) => row(nodes, n)),
    alsoReady: ready.slice(1).map((n) => n.ref),
    stuck: stuckRows.sort((a, b) => a.missing - b.missing),
    blockedBy: whyStuck(nodes, now),
  };
}

/** The brief, written for a reader that has one minute and no context. */
export function markdown(snap: FrontierSnapshot): string {
  const out: string[] = [];
  out.push('# Train of Thought — frontier');
  out.push('');
  out.push(`generated ${snap.generatedAt} from ${snap.store} · ${snap.counts.total} nodes ` +
    `(${snap.counts.active} active, ${snap.counts.blocked} blocked, ${snap.counts.parked} parked, ${snap.counts.done} done)`);
  out.push('');
  out.push('This file is generated. Do not edit it by hand; edit the store and it rewrites itself.');
  out.push('');

  if (snap.takeUp.length === 0) {
    out.push('## Nothing is ready');
    out.push('');
    out.push('Every open node is waiting, claimed, or has no next action. Read "Stuck" below before inventing work:');
    out.push('the train of thought deliberately has no next step, and that is a finding, not a gap.');
  } else {
    out.push('## Open and ready');
    out.push('');
    out.push('A session usually serves MORE THAN ONE of these. Say which `ref`s you are serving, and record each');
    out.push('with a `session` trail line (`POST /api/thoughts/<ref>/trail` `{kind:"session", text:"…", sessionRef:"…"}`).');
    out.push('`session-start.mjs --take a,b` writes all of them in one go.');
    out.push('');
    for (const row of snap.takeUp) {
      out.push(`### ${row.ref} — ${row.title}`);
      out.push('');
      out.push(`intent: ${row.intent}`);
      out.push(`deps: ${row.depsDone}/${row.depsTotal}${row.claimedBy ? ` · claimed by ${row.claimedBy}` : ''}` +
        (row.tags.length ? ` · tags: ${row.tags.join(', ')}` : ''));
      if (row.next.length) {
        out.push('next:');
        for (const step of row.next) out.push(`  - ${step}`);
      }
      out.push('');
    }
    if (snap.alsoReady.length) out.push(`also ready: ${snap.alsoReady.join(', ')}`);
    out.push('');
  }

  if (snap.stuck.length) {
    out.push('## Stuck, and why');
    out.push('');
    for (const s of snap.stuck) out.push(`- \`${s.ref}\` ${s.title} — ${s.reason} (${s.state})`);
    out.push('');
  }

  out.push('## Files');
  out.push('');
  out.push('- store: `thoughts.json` (hand editable, atomic writes)');
  out.push('- evidence: `thoughts/<ref>/` — one folder per node');
  out.push('- this brief: `frontier.md` / `frontier.json` (regenerated on every save)');
  out.push('');
  return out.join('\n');
}

/** Write both briefs next to the store. Never throws: a broken brief must not cost a store write. */
export function writeFiles(dataDir: string, nodes: ThoughtNode[], storeLabel = 'thoughts.json'): FrontierSnapshot | null {
  try {
    const snap = snapshot(nodes, storeLabel);
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpMd = path.join(dataDir, 'frontier.md.tmp');
    const tmpJson = path.join(dataDir, 'frontier.json.tmp');
    fs.writeFileSync(tmpMd, markdown(snap), 'utf8');
    fs.writeFileSync(tmpJson, JSON.stringify(snap, null, 2), 'utf8');
    fs.renameSync(tmpMd, path.join(dataDir, 'frontier.md'));
    fs.renameSync(tmpJson, path.join(dataDir, 'frontier.json'));
    return snap;
  } catch {
    return null;
  }
}

/** `node public/js/frontier.js [--data DIR] [--write]` — the no-service way to read or refresh the brief. */
const argv = process.argv.slice(1);
const invokedDirectly = (() => {
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  const i = argv.indexOf('--data');
  const dataDir = i >= 0 ? path.resolve(argv[i + 1]) : path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../data');
  const storeFile = path.join(dataDir, 'thoughts.json');
  let nodes: ThoughtNode[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as { nodes?: ThoughtNode[] };
    nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  } catch (e) {
    console.error(`cannot read ${storeFile}: ${(e as Error).message}`);
    process.exit(1);
  }
  const snap = snapshot(nodes);
  if (argv.includes('--write')) writeFiles(dataDir, nodes);
  process.stdout.write(markdown(snap));
}
