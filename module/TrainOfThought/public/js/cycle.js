import { claimLive, depsSettled, frontier } from "./dag.js";
const HANDOFF_FILL_PCT = 85;
function nodesForSession(nodes, sessionRef) {
  return nodes.filter((node) => {
    if (node.trail.some((entry) => entry.sessionRef === sessionRef)) return true;
    return (node.closed?.sessionRefs ?? []).includes(sessionRef);
  }).sort((a, b) => b.touched - a.touched);
}
function cycleLine(tick, session) {
  const bits = [`cycle ${tick.cycle}`];
  if (typeof session.fillPct === "number") bits.push(`fill ${session.fillPct}%`);
  if (typeof session.tokens === "number") bits.push(`${session.tokens.toLocaleString("en-US")} tokens`);
  if (typeof session.idleSec === "number" && session.idleSec > 0) bits.push(`idle ${Math.round(session.idleSec / 60)}m`);
  return bits.join(" \xB7 ");
}
function alreadyStamped(node, tick, sessionRef) {
  return node.trail.some(
    (entry) => entry.sessionRef === sessionRef && entry.kind === "event" && entry.text.startsWith(`cycle ${tick.cycle} \xB7`)
  );
}
function recordTick(store, tick, handoffFill = HANDOFF_FILL_PCT) {
  const at = tick.at ?? store.now;
  const by = tick.by ?? "phoenix";
  const warnings = [];
  const handoff = [];
  let appended = 0;
  const ready = frontier(store.nodes, at).map((node) => `${node.ref} ${node.title}`);
  for (const session of tick.sessions) {
    const touched = nodesForSession(store.nodes, session.ref);
    if (touched.length === 0) {
      warnings.push(`session ${session.ref} is not attached to any train \u2014 nothing will remember this work`);
      continue;
    }
    const stamp = cycleLine(tick, session);
    for (const node of touched) {
      if (alreadyStamped(node, tick, session.ref)) continue;
      const entry = { at, kind: "event", text: stamp, by, sessionRef: session.ref };
      node.trail.push(entry);
      node.touched = at;
      appended += 1;
    }
    store.save();
    const why = [];
    if (typeof session.fillPct === "number" && session.fillPct >= handoffFill) {
      why.push(`pressure ${session.fillPct}% is at or past the ${handoffFill}% handoff line`);
    }
    const primary = touched[0];
    if (primary.state !== "done" && primary.next.length === 0) {
      why.push(`no next action recorded on ${primary.ref} \u2014 a successor would start cold`);
    }
    if (why.length > 0) {
      handoff.push({ sessionRef: session.ref, nodes: touched.map((node) => node.ref), why, frontier: ready });
    }
  }
  return { cycle: tick.cycle, at, sessions: tick.sessions.length, appended, handoff, warnings };
}
function handoffPacket(store, sessionRef, trailLimit = 8) {
  const at = store.now;
  const nodes = nodesForSession(store.nodes, sessionRef);
  const warnings = [];
  if (nodes.length === 0) {
    warnings.push(`session ${sessionRef} is attached to no train \u2014 a handoff here carries no long-term intent`);
  }
  const primaryNode = nodes[0] ?? null;
  const primary = primaryNode ? {
    ref: primaryNode.ref,
    title: primaryNode.title,
    intent: primaryNode.intent,
    state: primaryNode.state,
    nextAction: primaryNode.next[0] ?? null,
    nextRemaining: primaryNode.next.length,
    deps: primaryNode.deps.map((dep) => {
      const target = store.find(dep);
      return { ref: dep, title: target?.title ?? "(missing)", done: target?.state === "done" };
    }),
    claimedBy: primaryNode.claimed && claimLive(primaryNode, at) ? primaryNode.claimed.by : null
  } : null;
  const trail = primaryNode ? primaryNode.trail.slice(-trailLimit) : [];
  const frontierRows = frontier(store.nodes, at).map((node) => {
    const settled = depsSettled(store.nodes, node);
    return {
      ref: node.ref,
      title: node.title,
      intent: node.intent,
      nextAction: node.next[0] ?? "",
      touched: node.touched,
      depsDone: settled.done,
      depsTotal: settled.total,
      sessions: uniqueSessionRefs(node),
      lastTrail: node.trail.length > 0 ? node.trail[node.trail.length - 1] : null
    };
  });
  const archive = store.nodes.filter((node) => node.state === "done" && node.closed).map((node) => ({ ref: node.ref, title: node.title, summary: node.closed?.summary ?? "", at: node.closed?.at ?? 0 })).sort((a, b) => b.at - a.at).map(({ ref, title, summary }) => ({ ref, title, summary }));
  return {
    sessionRef,
    resume: `hermes --resume ${sessionRef}`,
    primary,
    trail,
    frontier: frontierRows,
    archive,
    warnings
  };
}
function uniqueSessionRefs(node) {
  const out = [];
  for (const entry of node.trail) {
    if (entry.sessionRef && !out.includes(entry.sessionRef)) out.push(entry.sessionRef);
  }
  for (const ref of node.closed?.sessionRefs ?? []) if (!out.includes(ref)) out.push(ref);
  return out;
}
export {
  HANDOFF_FILL_PCT,
  handoffPacket,
  nodesForSession,
  recordTick
};
//# sourceMappingURL=cycle.js.map
