import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { byRef, claimLive, depsSettled, frontier, wouldCycle } from "./dag.js";
import { writeFiles as writeFrontierFiles } from "./frontier.js";
class ThoughtError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "ThoughtError";
  }
}
const STATES = ["active", "parked", "blocked", "done"];
const KINDS = ["session", "note", "decision", "event", "claim", "state"];
function newRef() {
  return randomBytes(4).toString("hex");
}
class ThoughtStore {
  file;
  data;
  clock;
  constructor(options) {
    this.file = options.file;
    this.clock = options.now ?? (() => Date.now());
    this.data = this.read();
  }
  get now() {
    return this.clock();
  }
  read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!raw || !Array.isArray(raw.nodes)) return { version: 1, nodes: [] };
      return { version: 1, nodes: raw.nodes };
    } catch {
      return { version: 1, nodes: [] };
    }
  }
  /** Reload from disk — the file is hand-editable, so a long-lived door must re-read before writing. */
  reload() {
    this.data = this.read();
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    writeFrontierFiles(path.dirname(this.file), this.data.nodes, path.basename(this.file));
  }
  get nodes() {
    return this.data.nodes;
  }
  find(ref) {
    return byRef(this.data.nodes).get(ref);
  }
  require(ref) {
    const node = this.find(ref);
    if (!node) throw new ThoughtError("no_such_node", `no thought with ref ${ref}`);
    return node;
  }
  // ---------------------------------------------------------------- writes
  add(input, by = "agent") {
    const title = (input.title ?? "").trim();
    if (title.length < 3) throw new ThoughtError("bad_title", "title must be at least 3 characters");
    const deps = unique(input.deps ?? []);
    for (const dep of deps) this.require(dep);
    const at = this.now;
    const node = {
      ref: this.mintRef(),
      title,
      intent: (input.intent ?? "").trim(),
      state: "active",
      deps,
      next: (input.next ?? []).map((line) => line.trim()).filter(Boolean),
      tags: unique(input.tags ?? []),
      trail: [{ at, kind: "state", text: "created", by }],
      created: at,
      touched: at
    };
    this.data.nodes.push(node);
    const dir = path.join(path.dirname(this.file), "thoughts", node.ref);
    fs.mkdirSync(dir, { recursive: true });
    node.dir = path.join("thoughts", node.ref).replace(/\\/g, "/");
    this.save();
    return node;
  }
  /** Patch prose/fields. Never a silent no-op: an unknown field is ignored, a bad state is refused. */
  update(ref, patch, by = "agent") {
    const node = this.require(ref);
    if (patch.title !== void 0) {
      const title = patch.title.trim();
      if (title.length < 3) throw new ThoughtError("bad_title", "title must be at least 3 characters");
      node.title = title;
    }
    if (patch.intent !== void 0) node.intent = patch.intent.trim();
    if (patch.next !== void 0) node.next = patch.next.map((line) => line.trim()).filter(Boolean);
    if (patch.tags !== void 0) node.tags = unique(patch.tags);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "note", text: `edited by ${by}`, by });
    this.save();
    return node;
  }
  /** Link dep -> ref. Refuses a missing node and refuses a cycle, by name. */
  link(ref, dep, by = "agent") {
    const node = this.require(ref);
    const target = this.require(dep);
    if (node.deps.includes(dep)) throw new ThoughtError("already_linked", `${dep} is already a dependency of ${ref}`);
    if (wouldCycle(this.data.nodes, ref, dep)) {
      throw new ThoughtError("cycle", `${dep} already waits on ${ref} (directly or further down) \u2014 that edge would close a loop`);
    }
    node.deps.push(dep);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "note", text: `waits on ${target.title} [${dep}]`, by });
    this.save();
    return node;
  }
  unlink(ref, dep, by = "agent") {
    const node = this.require(ref);
    if (!node.deps.includes(dep)) throw new ThoughtError("not_linked", `${dep} is not a dependency of ${ref}`);
    node.deps = node.deps.filter((item) => item !== dep);
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "note", text: `no longer waits on [${dep}]`, by });
    this.save();
    return node;
  }
  /** Append one line of memory. This is how a session gets attached to a train. */
  trail(ref, input) {
    const node = this.require(ref);
    if (!KINDS.includes(input.kind)) throw new ThoughtError("bad_kind", `kind must be one of ${KINDS.join("|")}`);
    const text = input.text.trim();
    if (text.length === 0) throw new ThoughtError("empty_note", "a trail line needs text");
    const entry = {
      at: input.at ?? this.now,
      kind: input.kind,
      text,
      by: input.by || "agent",
      ...input.sessionRef ? { sessionRef: input.sessionRef } : {}
    };
    node.trail.push(entry);
    node.touched = entry.at;
    this.save();
    return node;
  }
  setState(ref, state, by = "agent", text) {
    if (!STATES.includes(state)) throw new ThoughtError("bad_state", `state must be one of ${STATES.join("|")}`);
    if (state === "done") throw new ThoughtError("use_close", "closing a train needs a summary \u2014 POST close instead of setting state=done");
    const node = this.require(ref);
    node.state = state;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "state", text: text?.trim() || `state -> ${state}`, by });
    this.save();
    return node;
  }
  /** Close = archive. The summary is required: it is the only thing the archive is for. */
  close(ref, input, by = "agent") {
    const node = this.require(ref);
    const summary = (input.summary ?? "").trim();
    if (summary.length < 8) throw new ThoughtError("bad_summary", "a closing summary is required (why this train is done)");
    const at = this.now;
    node.state = "done";
    node.closed = { at, summary, sessionRefs: unique(input.sessionRefs ?? []) };
    node.touched = at;
    node.trail.push({ at, kind: "state", text: `closed \u2014 ${summary}`, by });
    this.save();
    return node;
  }
  reopen(ref, by = "agent", text) {
    const node = this.require(ref);
    if (node.state !== "done") throw new ThoughtError("not_closed", `${ref} is not closed (state=${node.state})`);
    node.state = "active";
    delete node.closed;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "state", text: text?.trim() || "reopened", by });
    this.save();
    return node;
  }
  /** Take the lease. A live lease is a refusal carrying the holder — never a silent overwrite. */
  claim(ref, by, minutes = 30) {
    const node = this.require(ref);
    const holder = by.trim();
    if (!holder) throw new ThoughtError("bad_claim", "a claim needs a name");
    if (claimLive(node, this.now)) {
      throw new ThoughtError("claimed", `${ref} is held by ${node.claimed?.by} until ${new Date(node.claimed?.expiresAt ?? 0).toISOString()}`);
    }
    const at = this.now;
    node.claimed = { by: holder, at, expiresAt: at + Math.max(1, minutes) * 6e4 };
    node.trail.push({ at, kind: "claim", text: `claimed for ${minutes} min`, by: holder });
    this.save();
    return node;
  }
  release(ref, by = "agent", force = false) {
    const node = this.require(ref);
    if (!node.claimed) throw new ThoughtError("not_claimed", `${ref} is not claimed`);
    if (!force && claimLive(node, this.now) && node.claimed.by !== by) {
      throw new ThoughtError("not_holder", `${ref} is held by ${node.claimed.by} \u2014 only they (or force) can release it`);
    }
    const held = node.claimed.by;
    delete node.claimed;
    node.touched = this.now;
    node.trail.push({ at: node.touched, kind: "claim", text: `released (was ${held})`, by });
    this.save();
    return node;
  }
  // ---------------------------------------------------------------- reads
  ready(now = this.now) {
    return frontier(this.data.nodes, now);
  }
  /**
   * Drop leases whose time ran out and say so in the trail. A crashed agent must not hold a train
   * forever — an expired seat is the honest, implicit logout.
   */
  reapExpired(now = this.now) {
    let dropped = 0;
    for (const node of this.data.nodes) {
      if (!node.claimed) continue;
      if (node.claimed.expiresAt > now) continue;
      const held = node.claimed.by;
      delete node.claimed;
      node.trail.push({ at: now, kind: "claim", text: `seat expired (was ${held})`, by: "system" });
      dropped += 1;
    }
    if (dropped > 0) this.save();
    return dropped;
  }
  /** Find by ref, else by the first title that contains the text (case-insensitive). */
  resolve(needle) {
    const byRefHit = this.find(needle.trim());
    if (byRefHit) return byRefHit;
    const text = needle.trim().toLowerCase();
    if (text.length < 3) return void 0;
    return this.data.nodes.find((node) => node.title.toLowerCase().includes(text));
  }
  /** Every live seat right now — the straight answer to "who is working on what". */
  seats(now = this.now) {
    return this.data.nodes.filter((node) => node.claimed && node.claimed.expiresAt > now).map((node) => ({
      ref: node.ref,
      title: node.title,
      by: node.claimed?.by ?? "",
      since: node.claimed?.at ?? 0,
      expiresAt: node.claimed?.expiresAt ?? 0,
      next: node.next[0] ?? null
    }));
  }
  settled(ref) {
    return depsSettled(this.data.nodes, this.require(ref));
  }
  mintRef() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const ref = newRef();
      if (!this.find(ref)) return ref;
    }
    throw new ThoughtError("ref_collision", "could not mint a unique 8-hex ref after 50 tries");
  }
}
function unique(list) {
  const out = [];
  for (const item of list) {
    const value = String(item).trim();
    if (value.length > 0 && !out.includes(value)) out.push(value);
  }
  return out;
}
export {
  ThoughtError,
  ThoughtStore,
  newRef
};
//# sourceMappingURL=store.js.map
