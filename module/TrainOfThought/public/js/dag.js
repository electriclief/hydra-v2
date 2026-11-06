const REF_RE = /^[0-9a-f]{8}$/;
function byRef(nodes) {
  const map = /* @__PURE__ */ new Map();
  for (const node of nodes) map.set(node.ref, node);
  return map;
}
function ancestorsOf(nodes, ref) {
  const map = byRef(nodes);
  const seen = /* @__PURE__ */ new Set();
  const stack = [ref];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === void 0 || seen.has(current)) continue;
    seen.add(current);
    const node = map.get(current);
    if (!node) continue;
    for (const dep of node.deps) stack.push(dep);
  }
  return seen;
}
function wouldCycle(nodes, nodeRef, depRef) {
  if (nodeRef === depRef) return true;
  return ancestorsOf(nodes, depRef).has(nodeRef);
}
function claimLive(node, now) {
  return Boolean(node.claimed && node.claimed.expiresAt > now);
}
function depsSettled(nodes, node) {
  const map = byRef(nodes);
  let done = 0;
  for (const dep of node.deps) {
    const target = map.get(dep);
    if (target && target.state === "done") done += 1;
  }
  return { done, total: node.deps.length, ok: done === node.deps.length };
}
function isReady(nodes, node, now) {
  if (node.state !== "active") return false;
  if (claimLive(node, now)) return false;
  if (node.next.length === 0) return false;
  return depsSettled(nodes, node).ok;
}
function frontier(nodes, now) {
  return nodes.filter((node) => isReady(nodes, node, now)).sort((a, b) => a.touched - b.touched);
}
function whyStuck(nodes, now) {
  const out = { claimed: 0, notActive: 0, noAction: 0, waitingOnDeps: 0, ready: 0 };
  for (const node of nodes) {
    if (node.state === "done") continue;
    if (node.state !== "active") {
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
function layers(nodes) {
  const map = byRef(nodes);
  const depth = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const walk = (ref) => {
    const known = depth.get(ref);
    if (known !== void 0) return known;
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
export {
  REF_RE,
  ancestorsOf,
  byRef,
  claimLive,
  depsSettled,
  frontier,
  isReady,
  layers,
  whyStuck,
  wouldCycle
};
//# sourceMappingURL=dag.js.map
