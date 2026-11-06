import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { claimLive, depsSettled, frontier, isReady, whyStuck } from "./dag.js";
function row(nodes, node) {
  const deps = depsSettled(nodes, node);
  const claim = node.claim;
  const live = claimLive(node, Date.now());
  return {
    ref: node.ref,
    title: node.title,
    intent: node.intent,
    next: Array.isArray(node.next) ? node.next : [],
    depsDone: deps.done,
    depsTotal: deps.total,
    tags: Array.isArray(node.tags) ? node.tags : [],
    ...live && claim?.by ? { claimedBy: claim.by } : {}
  };
}
function snapshot(nodes, storeLabel = "thoughts.json") {
  const now = Date.now();
  const ready = frontier(nodes, now);
  const stuckRows = [];
  for (const node of nodes) {
    if (node.state === "done") continue;
    if (isReady(nodes, node, now)) continue;
    const deps = depsSettled(nodes, node);
    const reason = deps.ok ? claimLive(node, now) ? "claimed by another session" : node.state === "parked" ? "parked on purpose" : node.state === "blocked" ? "marked blocked" : "no next action recorded" : `waiting on ${deps.total - deps.done} of ${deps.total} dependencies`;
    stuckRows.push({ ref: node.ref, title: node.title, state: node.state, reason, missing: deps.total - deps.done });
  }
  const counts = {
    total: nodes.length,
    active: nodes.filter((n) => n.state === "active").length,
    blocked: nodes.filter((n) => n.state === "blocked").length,
    parked: nodes.filter((n) => n.state === "parked").length,
    done: nodes.filter((n) => n.state === "done").length
  };
  return {
    generatedAt: new Date(now).toISOString(),
    store: storeLabel,
    counts,
    takeUp: ready.map((n) => row(nodes, n)),
    alsoReady: ready.slice(1).map((n) => n.ref),
    stuck: stuckRows.sort((a, b) => a.missing - b.missing),
    blockedBy: whyStuck(nodes, now)
  };
}
function markdown(snap) {
  const out = [];
  out.push("# Train of Thought \u2014 frontier");
  out.push("");
  out.push(`generated ${snap.generatedAt} from ${snap.store} \xB7 ${snap.counts.total} nodes (${snap.counts.active} active, ${snap.counts.blocked} blocked, ${snap.counts.parked} parked, ${snap.counts.done} done)`);
  out.push("");
  out.push("This file is generated. Do not edit it by hand; edit the store and it rewrites itself.");
  out.push("");
  if (snap.takeUp.length === 0) {
    out.push("## Nothing is ready");
    out.push("");
    out.push('Every open node is waiting, claimed, or has no next action. Read "Stuck" below before inventing work:');
    out.push("the train of thought deliberately has no next step, and that is a finding, not a gap.");
  } else {
    out.push("## Open and ready");
    out.push("");
    out.push("A session usually serves MORE THAN ONE of these. Say which `ref`s you are serving, and record each");
    out.push('with a `session` trail line (`POST /api/thoughts/<ref>/trail` `{kind:"session", text:"\u2026", sessionRef:"\u2026"}`).');
    out.push("`session-start.mjs --take a,b` writes all of them in one go.");
    out.push("");
    for (const row2 of snap.takeUp) {
      out.push(`### ${row2.ref} \u2014 ${row2.title}`);
      out.push("");
      out.push(`intent: ${row2.intent}`);
      out.push(`deps: ${row2.depsDone}/${row2.depsTotal}${row2.claimedBy ? ` \xB7 claimed by ${row2.claimedBy}` : ""}` + (row2.tags.length ? ` \xB7 tags: ${row2.tags.join(", ")}` : ""));
      if (row2.next.length) {
        out.push("next:");
        for (const step of row2.next) out.push(`  - ${step}`);
      }
      out.push("");
    }
    if (snap.alsoReady.length) out.push(`also ready: ${snap.alsoReady.join(", ")}`);
    out.push("");
  }
  if (snap.stuck.length) {
    out.push("## Stuck, and why");
    out.push("");
    for (const s of snap.stuck) out.push(`- \`${s.ref}\` ${s.title} \u2014 ${s.reason} (${s.state})`);
    out.push("");
  }
  out.push("## Files");
  out.push("");
  out.push("- store: `thoughts.json` (hand editable, atomic writes)");
  out.push("- evidence: `thoughts/<ref>/` \u2014 one folder per node");
  out.push("- this brief: `frontier.md` / `frontier.json` (regenerated on every save)");
  out.push("");
  return out.join("\n");
}
function writeFiles(dataDir, nodes, storeLabel = "thoughts.json") {
  try {
    const snap = snapshot(nodes, storeLabel);
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpMd = path.join(dataDir, "frontier.md.tmp");
    const tmpJson = path.join(dataDir, "frontier.json.tmp");
    fs.writeFileSync(tmpMd, markdown(snap), "utf8");
    fs.writeFileSync(tmpJson, JSON.stringify(snap, null, 2), "utf8");
    fs.renameSync(tmpMd, path.join(dataDir, "frontier.md"));
    fs.renameSync(tmpJson, path.join(dataDir, "frontier.json"));
    return snap;
  } catch {
    return null;
  }
}
const argv = process.argv.slice(1);
const invokedDirectly = (() => {
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  const i = argv.indexOf("--data");
  const dataDir = i >= 0 ? path.resolve(argv[i + 1]) : path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../data");
  const storeFile = path.join(dataDir, "thoughts.json");
  let nodes = [];
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  } catch (e) {
    console.error(`cannot read ${storeFile}: ${e.message}`);
    process.exit(1);
  }
  const snap = snapshot(nodes);
  if (argv.includes("--write")) writeFiles(dataDir, nodes);
  process.stdout.write(markdown(snap));
}
export {
  markdown,
  snapshot,
  writeFiles
};
//# sourceMappingURL=frontier.js.map
