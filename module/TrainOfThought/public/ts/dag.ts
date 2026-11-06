/**
 * The DAG itself: readiness, cycles, frontier, layers.
 *
 * Pure functions over nodes — no disk, no clock except the one passed in, so the selftest can
 * reason about leases without waiting. Edge direction is `dep -> node`; `deps[]` on a node are
 * its INCOMING edges (what it waits for).
 */

import type { ThoughtNode } from './types.js';

export const REF_RE = /^[0-9a-f]{8}$/;

export function byRef(nodes: ThoughtNode[]): Map<string, ThoughtNode> {
  const map = new Map<string, ThoughtNode>();
  for (const node of nodes) map.set(node.ref, node);
  return map;
}

/** Every ref reachable by walking deps upward from `ref` (the node itself included). */
export function ancestorsOf(nodes: ThoughtNode[], ref: string): Set<string> {
  const map = byRef(nodes);
  const seen = new Set<string>();
  const stack = [ref];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const node = map.get(current);
    if (!node) continue;
    for (const dep of node.deps) stack.push(dep);
  }
  return seen;
}

/**
 * Would adding `depRef` as a dependency of `nodeRef` close a loop?
 * Yes when `nodeRef` is already upstream of `depRef` — i.e. `nodeRef` is among depRef's ancestors.
 */
export function wouldCycle(nodes: ThoughtNode[], nodeRef: string, depRef: string): boolean {
  if (nodeRef === depRef) return true;
  return ancestorsOf(nodes, depRef).has(nodeRef);
}

export function claimLive(node: ThoughtNode, now: number): boolean {
  return Boolean(node.claimed && node.claimed.expiresAt > now);
}

/** Deps resolved: every dep exists and is `done`. */
export function depsSettled(nodes: ThoughtNode[], node: ThoughtNode): { done: number; total: number; ok: boolean } {
  const map = byRef(nodes);
  let done = 0;
  for (const dep of node.deps) {
    const target = map.get(dep);
    if (target && target.state === 'done') done += 1;
  }
  return { done, total: node.deps.length, ok: done === node.deps.length };
}

/** Ready = active, unclaimed, has an action, and every dep is done. */
export function isReady(nodes: ThoughtNode[], node: ThoughtNode, now: number): boolean {
  if (node.state !== 'active') return false;
  if (claimLive(node, now)) return false;
  if (node.next.length === 0) return false;
  return depsSettled(nodes, node).ok;
}

/** The frontier, oldest-touched first. This is what /api/next hands out. */
export function frontier(nodes: ThoughtNode[], now: number): ThoughtNode[] {
  return nodes
    .filter((node) => isReady(nodes, node, now))
    .sort((a, b) => a.touched - b.touched);
}

/**
 * Why the frontier is empty — never answer a bare "nothing", name the wall.
 * Counts are disjoint by construction: a node is claimed OR blocked OR unfinished OR empty.
 */
export function whyStuck(nodes: ThoughtNode[], now: number): Record<string, number> {
  const out: Record<string, number> = { claimed: 0, notActive: 0, noAction: 0, waitingOnDeps: 0, ready: 0 };
  for (const node of nodes) {
    if (node.state === 'done') continue;
    if (node.state !== 'active') {
      out.notActive += 1;
      continue;
    }
    if (claimLive(node, now)) {
      out.claimed += 1;
      continue;
    }
    if (node.next.length === 0) {
      out.noAction += 1;
      continue;
    }
    if (!depsSettled(nodes, node).ok) {
      out.waitingOnDeps += 1;
      continue;
    }
    out.ready += 1;
  }
  return out;
}

/**
 * Topological depth per ref, for the layered "train line" view. Cycles cannot exist (writes
 * refuse them) but a hand-edited file could, so a loop is broken at depth 0 instead of hanging.
 */
export function layers(nodes: ThoughtNode[]): Map<string, number> {
  const map = byRef(nodes);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const walk = (ref: string): number => {
    const known = depth.get(ref);
    if (known !== undefined) return known;
    if (visiting.has(ref)) return 0;
    const node = map.get(ref);
    if (!node) return 0;
    visiting.add(ref);
    let max = 0;
    for (const dep of node.deps) max = Math.max(max, walk(dep) + 1);
    visiting.delete(ref);
    depth.set(ref, max);
    return max;
  };

  for (const node of nodes) walk(node.ref);
  return depth;
}
