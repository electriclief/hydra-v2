import { relayPull } from "./relay.js";
const MAX_LINK_HOPS = 3;
const RELAY_TIMEOUT_MS = 900;
const NAME_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_PATH = 160;
function validateName(name) {
  const path = typeof name === "string" ? name.trim() : "";
  if (!path || path.length > MAX_PATH) {
    throw new Error(`bad entry name: ${JSON.stringify(String(name))} \u2014 a dotted path like "Parent.Name" (max ${MAX_PATH} chars)`);
  }
  for (const segment of path.split(".")) {
    if (!NAME_SEGMENT.test(segment)) {
      throw new Error(`bad entry name: ${JSON.stringify(path)} \u2014 segments are letters/digits/_/- (start alphanumeric), dot-separated`);
    }
  }
  return path;
}
function softClone(value) {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "function" || typeof b === "function") return false;
  if (a === null || b === null || typeof a !== "object") return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
  }
  return true;
}
function isShapedReply(value) {
  return typeof value === "object" && value !== null && value.stateReply === true;
}
function shaped(content, options = {}) {
  const reply = { stateReply: true, content };
  if (options.full !== void 0) reply.full = options.full;
  if (options.marks !== void 0) reply.marks = options.marks;
  return reply;
}
class State {
  entries = /* @__PURE__ */ new Map();
  watchers = /* @__PURE__ */ new Set();
  changes = 0;
  /**
   * Put ANY object under a dotted-path name. The same path re-registered = last hand-in
   * wins (upsert); an identical hand-in is a no-op (v1's spirit kept).
   */
  register(name, content, options = {}) {
    const path = validateName(name);
    const serving = { ...options.serving ?? {} };
    const normalized = { serving, alive: options.alive, pull: options.pull, render: options.render, update: options.update };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const slot = this.entries.get(path);
    if (slot) {
      if (this.sameHand(slot, content, normalized)) return this.infoOf(slot);
      slot.content = content;
      slot.options = normalized;
      slot.updatedAt = now;
      this.emit({ t: now, kind: "updated", path });
    } else {
      this.entries.set(path, { path, content, options: normalized, registeredAt: now, updatedAt: now });
      this.emit({ t: now, kind: "registered", path });
    }
    const live = this.entries.get(path);
    if (!live) throw new Error(`entry vanished during register: ${path}`);
    return this.infoOf(live);
  }
  /** The explicit death hand — remove an entry (unique suffix resolves like a pull). */
  drop(name) {
    this.pruneDead();
    const res = this.resolvePath(typeof name === "string" ? name.trim() : "");
    if (!res.hit) return false;
    const existed = this.entries.delete(res.hit);
    if (existed) this.emit({ t: (/* @__PURE__ */ new Date()).toISOString(), kind: "dropped", path: res.hit, reason: "explicit" });
    return existed;
  }
  /**
   * PULL an entry. Resolves by exact path, else the shortest unique suffix. The requester
   * carries its marks; flagged elements come back as the delta past the mark — or whole,
   * when the mark is new / unknown / stale (the self-healing fallback).
   */
  async pull(name, options = {}) {
    this.pruneDead();
    const at = (/* @__PURE__ */ new Date()).toISOString();
    const query = typeof name === "string" ? name.trim() : "";
    if (!query) return { ok: false, code: "no_such_entry", name: query, at };
    const res = this.resolvePath(query);
    if (res.ambiguous) return { ok: false, code: "ambiguous", name: query, candidates: res.candidates, at };
    if (!res.hit) {
      if (options.follow !== false) {
        const followed = await this.followLinks(query, options);
        if (followed) return followed;
      }
      return { ok: false, code: "no_such_entry", name: query, at };
    }
    const slot = this.entries.get(res.hit);
    if (!slot) return { ok: false, code: "no_such_entry", name: query, at };
    const marksIn = { ...options.marks ?? {} };
    const request = { name: res.hit, marks: marksIn, asked: query };
    const recipe = this.recipeOf(slot);
    let served;
    if (recipe) {
      const raw = await recipe(request);
      if (isShapedReply(raw)) {
        served = { content: softClone(raw.content), full: raw.full ?? true, marks: { ...raw.marks ?? {} } };
      } else {
        served = this.serve(softClone(raw), slot.options.serving, marksIn);
      }
    } else {
      served = this.serve(softClone(slot.content), slot.options.serving, marksIn);
    }
    return { ok: true, name: res.hit, at, full: served.full, content: served.content, marks: served.marks };
  }
  /**
   * DISCOVER — walk the active set (the dead are pruned on the way). No query: everything.
   * A query matches exact paths, endings (the leaf), and things under it. The SHAPE is
   * listed; contents are pulled, never embedded.
   */
  discover(query) {
    this.pruneDead();
    const q = typeof query === "string" ? query.trim() : "";
    let paths;
    if (!q) {
      paths = Array.from(this.entries.keys()).sort();
    } else {
      const suffix = "." + q;
      const set = /* @__PURE__ */ new Set();
      for (const p of this.entries.keys()) {
        if (p === q || p.endsWith(suffix) || p.startsWith(q + ".")) set.add(p);
      }
      paths = Array.from(set).sort();
    }
    return { ok: true, query: q || null, entries: paths.map((p) => this.describe(p)).filter((info) => info !== null), summary: this.summary() };
  }
  /** Watch the active set change (registered · updated · dropped · popped). */
  on(watcher) {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }
  summary() {
    return { entries: this.entries.size, changes: this.changes };
  }
  /** Drop every watcher (the registry itself stays; entries are runtime objects). */
  close() {
    this.watchers.clear();
  }
  // ── internals ──────────────────────────────────────────────────────────
  /**
   * Follow the longest prefix that is a link, and ask the registry it points at for the SAME name — or for the
   * name the link overrides with `as`, which is how one node can publish a subtree whose leaves live in other
   * nodes' branches (a transfer is the obvious case: one id, two participants, each owning its own half).
   *
   * Returns null when no prefix is a link, so the caller can refuse with the honest "not here".
   */
  async followLinks(query, options) {
    const via = options.via ?? [];
    const hops = options.hops ?? 0;
    if (hops >= MAX_LINK_HOPS) {
      return { ok: false, code: "no_such_entry", name: query, at: (/* @__PURE__ */ new Date()).toISOString(), why: "cycle", via };
    }
    const parts = query.split(".");
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const prefix = parts.slice(0, i).join(".");
      const found = this.resolvePath(prefix);
      if (!found.hit) continue;
      const slot = this.entries.get(found.hit);
      const content = slot?.content;
      if (!content || content.kind !== "link" || typeof content.to !== "string") continue;
      const remote = typeof content.as === "string" && content.as ? content.as : query;
      const relayed = await relayPull(content.to, remote, via, RELAY_TIMEOUT_MS, hops);
      if (relayed.ok) {
        return {
          ok: true,
          name: relayed.name || remote,
          at: relayed.at || (/* @__PURE__ */ new Date()).toISOString(),
          full: relayed.full !== false,
          content: relayed.value,
          marks: relayed.marks ?? {},
          source: relayed.source,
          hops: relayed.hops,
          via: relayed.via
        };
      }
      return { ok: false, code: "no_such_entry", name: query, at: (/* @__PURE__ */ new Date()).toISOString(), why: relayed.why, via: relayed.via };
    }
    return null;
  }
  /**
   * The recipe hand: an explicit pull option, else a DOOR — a registered object with its
   * own `pull(name, options)` hand (e.g. another registry) is asked for the entry's own
   * name (the leaf): the parent relays, and every level answers for its own contents.
   */
  recipeOf(slot) {
    if (slot.options.pull) return slot.options.pull;
    const content = slot.content;
    if (content && typeof content === "object" && typeof content.pull === "function") {
      const door = content;
      return (request) => door.pull(request.name.split(".").pop() ?? request.name, { marks: request.marks });
    }
    return null;
  }
  sameHand(slot, content, options) {
    return deepEqual(slot.content, content) && slot.options.alive === options.alive && slot.options.pull === options.pull && deepEqual(slot.options.serving ?? {}, options.serving ?? {}) && deepEqual(slot.options.render, options.render) && deepEqual(slot.options.update, options.update);
  }
  /** The serving pass — flagged elements sliced past the requester's marks; everything else whole. */
  serve(content, serving, marksIn) {
    const outMarks = {};
    if (!content || typeof content !== "object" || Array.isArray(content)) return { content, full: true, marks: outMarks };
    const obj = { ...content };
    let full = true;
    for (const [key, mode] of Object.entries(serving)) {
      if (mode !== "delta") continue;
      const el = obj[key];
      const m = marksIn[key];
      if (typeof el === "string") {
        const lines = el.split("\n");
        if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
        const n = lines.length;
        if (typeof m === "number" && Number.isInteger(m) && m >= 0 && m <= n) {
          obj[key] = lines.slice(m).join("\n");
          outMarks[key] = n;
          full = false;
        } else {
          outMarks[key] = n;
        }
      } else if (Array.isArray(el)) {
        const n = el.length;
        if (typeof m === "number" && Number.isInteger(m) && m >= 0 && m <= n) {
          obj[key] = el.slice(m);
          outMarks[key] = n;
          full = false;
        } else {
          outMarks[key] = n;
        }
      }
    }
    return { content: obj, full, marks: outMarks };
  }
  /** Exact path → the shortest unique suffix (leaf works when unique) → ambiguous. */
  resolvePath(query) {
    if (this.entries.has(query)) return { hit: query };
    const suffix = "." + query;
    const candidates = Array.from(this.entries.keys()).filter((p) => p.endsWith(suffix)).sort();
    if (candidates.length === 1) return { hit: candidates[0] };
    if (candidates.length > 1) return { ambiguous: true, candidates };
    return {};
  }
  /** A registration lives exactly as long as its registrant: a declared liveness that says
   *  gone (false, or a throw) pops the entry here — absence reads as absence. */
  pruneDead() {
    for (const [path, slot] of Array.from(this.entries.entries())) {
      const check = slot.options.alive;
      if (!check) continue;
      let alive = true;
      try {
        alive = check() === true;
      } catch {
        alive = false;
      }
      if (!alive) {
        this.entries.delete(path);
        this.emit({ t: (/* @__PURE__ */ new Date()).toISOString(), kind: "dropped", path, reason: "gone" });
      }
    }
  }
  describe(path) {
    const slot = this.entries.get(path);
    if (!slot) return null;
    return this.infoOf(slot);
  }
  infoOf(slot) {
    const content = slot.content;
    let shape;
    if (Array.isArray(content)) {
      shape = [`[${content.length}]`];
    } else if (content && typeof content === "object") {
      shape = Object.keys(content).sort();
    } else {
      shape = [`[${typeof content}]`];
    }
    return {
      path: slot.path,
      registeredAt: slot.registeredAt,
      updatedAt: slot.updatedAt,
      hasRecipe: this.recipeOf(slot) !== null,
      serving: { ...slot.options.serving },
      shape,
      hasRender: slot.options.render !== void 0,
      hasUpdate: slot.options.update !== void 0
    };
  }
  emit(event) {
    this.changes++;
    for (const watcher of Array.from(this.watchers)) {
      try {
        watcher(event);
      } catch {
      }
    }
  }
}
function createStateRegistry() {
  return new State();
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const st = createStateRegistry();
  ok("blank at boot", st.discover().entries.length === 0 && st.summary().entries === 0);
  ok(
    "a bad name is refused",
    (() => {
      try {
        st.register("bad name!", {});
        return false;
      } catch {
        return true;
      }
    })()
  );
  ok(
    "empty segments are refused",
    ["", "A..B", ".A", "A."].every((bad) => {
      try {
        st.register(bad, {});
        return false;
      } catch {
        return true;
      }
    })
  );
  const info = st.register("Root.Server.ClientName", { ip: "10.0.0.1", cores: 4 });
  ok("register answers the info", info.path === "Root.Server.ClientName" && info.hasRecipe === false);
  ok("the shape lists the keys", info.shape.join(",") === "cores,ip", info.shape.join(","));
  ok("the info carries no contents", !("content" in info));
  ok("a deep path needs no parents", st.discover().entries.length === 1);
  const before = st.summary().changes;
  const again = st.register("Root.Server.ClientName", { ip: "10.0.0.1", cores: 4 });
  ok("an identical hand-in is a no-op", st.summary().changes === before && again.registeredAt === info.registeredAt);
  const changed = st.register("Root.Server.ClientName", { ip: "10.0.0.2", cores: 4 });
  ok("a changed hand-in updates", st.summary().changes === before + 1 && changed.registeredAt === info.registeredAt && changed.updatedAt >= info.updatedAt);
  const exact = await st.pull("Root.Server.ClientName");
  ok("exact pull answers", exact.ok === true && exact.full === true);
  const leaf = await st.pull("ClientName");
  ok("the leaf alone resolves when unique", leaf.ok === true && leaf.name === "Root.Server.ClientName");
  st.register("Other.ClientName", { ip: "10.0.0.9" });
  const amb = await st.pull("ClientName");
  ok("an ambiguous suffix is refused with candidates", amb.ok === false && amb.code === "ambiguous" && (amb.candidates ?? []).length === 2, JSON.stringify(amb));
  const extended = await st.pull("Server.ClientName");
  ok("extending the suffix disambiguates", extended.ok === true && extended.name === "Root.Server.ClientName");
  const missing = await st.pull("Nope");
  ok("a missing entry is refused with a code", missing.ok === false && missing.code === "no_such_entry");
  st.drop("Other.ClientName");
  st.register("Clone.Check", { a: 1 });
  const first = await st.pull("Clone.Check");
  first.content.a = 999;
  const second = await st.pull("Clone.Check");
  ok("replies are clones", second.content.a === 1);
  st.register("Log.Holder", { a: 5, log: "l1\nl2\nl3\nl4\nl5" }, { serving: { log: "delta" } });
  const full = await st.pull("Log.Holder");
  ok("a new request gets the FULL state + the fresh mark", full.ok === true && full.full === true && full.content.log.split("\n").length === 5 && full.marks.log === 5);
  const delta = await st.pull("Log.Holder", { marks: { log: 3 } });
  ok("a fresh mark gets the delta past it", delta.ok === true && delta.full === false && delta.content.log === "l4\nl5" && delta.marks.log === 5);
  const empty = await st.pull("Log.Holder", { marks: { log: 5 } });
  ok("the same mark = an empty delta (nothing new)", empty.ok === true && empty.full === false && empty.content.log === "");
  const stale = await st.pull("Log.Holder", { marks: { log: 99 } });
  ok("a stale mark self-heals to FULL", stale.ok === true && stale.full === true && stale.content.log.includes("l5"));
  const odd = await st.pull("Log.Holder", { marks: { log: "x" } });
  ok("an unintelligible mark is FULL", odd.ok === true && odd.full === true);
  ok("an unflagged element stays whole", delta.content.a === 5 && !("a" in delta.marks));
  st.register("Log.Holder", { a: 5, log: "l1\nl2\nl3\nl4\nl5\nl6" }, { serving: { log: "delta" } });
  const appended = await st.pull("Log.Holder", { marks: { log: 5 } });
  ok("an appended line lands in the delta", appended.content.log === "l6");
  st.register("Queue.Holder", { queue: [1, 2, 3] }, { serving: { queue: "delta" } });
  const qfull = await st.pull("Queue.Holder");
  ok("an array serves whole with its count", qfull.marks.queue === 3);
  const qdelta = await st.pull("Queue.Holder", { marks: { queue: 1 } });
  ok("an array serves past the mark", JSON.stringify(qdelta.content.queue) === "[2,3]" && qdelta.marks.queue === 3);
  const seen = [];
  st.register("Live.One", {}, { pull: (r) => {
    seen.push(r);
    return { echo: true, log: "a\nb\nc" };
  }, serving: { log: "delta" } });
  const liveFull = await st.pull("Live.One");
  ok("a recipe answers, flags still serve", liveFull.ok === true && liveFull.full === true && liveFull.content.log === "a\nb\nc");
  const liveDelta = await st.pull("Live.One", { marks: { log: 1 } });
  ok("a recipe-fed element deltas too", liveDelta.content.log === "b\nc");
  ok("the recipe saw the resolved name + the ask", seen[1].name === "Live.One" && seen[1].asked === "Live.One" && seen[1].marks.log === 1);
  const child = createStateRegistry();
  child.register("A", { v: 7 });
  st.register("Node.A", child);
  const viaDoor = await st.pull("Node.A");
  const doorEnvelope = viaDoor.content;
  ok("a registered door answers pulls itself (the child registry answers under its own name)", viaDoor.ok === true && doorEnvelope.ok === true && doorEnvelope.content.v === 7);
  st.register("Node.B", {}, { pull: async (r) => {
    const inner = await child.pull("A", { marks: r.marks });
    return inner.ok ? shaped(inner.content, { full: inner.full, marks: inner.marks }) : shaped({ missing: true });
  } });
  const viaRelay = await st.pull("Node.B");
  ok("a shaped relay follows the nesting", viaRelay.ok === true && viaRelay.content.v === 7);
  const kinds = [];
  const off = st.on((e) => kinds.push(e));
  const st2 = { alive: true };
  st.register("Ephemeral.Thing", { x: 1 }, { alive: () => st2.alive });
  ok("a live registrant stays", st.discover("Ephemeral").entries.length === 1);
  st2.alive = false;
  ok("a dead registrant is popped on the walk", st.discover("Ephemeral").entries.length === 0);
  ok("the pop is a dropped event (gone)", kinds.some((e) => e.kind === "dropped" && e.path === "Ephemeral.Thing" && e.reason === "gone"));
  st.register("Throwing.Thing", { x: 1 }, { alive: () => {
    throw new Error("gone");
  } });
  ok("a throwing liveness check is gone too", st.discover("Throwing").entries.length === 0);
  off();
  const countAfterOff = kinds.length;
  st.register("Quiet.Thing", {});
  ok("unsubscribe stops the flow", kinds.length === countAfterOff);
  const off2 = st.on((e) => kinds.push(e));
  ok("drop answers true", st.drop("Quiet.Thing") === true);
  ok("a second drop answers false", st.drop("Quiet.Thing") === false);
  ok("the explicit drop carries its reason", kinds.some((e) => e.kind === "dropped" && e.reason === "explicit"));
  st.register("Deep.Leaf.One", {});
  ok("drop resolves by unique leaf", st.drop("Leaf.One") === true);
  off2();
  const withStanding = st.register("Standing.Entry", { n: 1 }, { render: { as: "table" }, update: { every: "10s" } });
  ok("the render map is flagged, not read", withStanding.hasRender === true && withStanding.hasUpdate === true);
  ok("summary counts what is held", st.summary().entries === st.discover().entries.length && st.summary().changes > 0, JSON.stringify(st.summary()));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[stateRegistry] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  State,
  createStateRegistry,
  isShapedReply,
  runTests,
  shaped
};
//# sourceMappingURL=stateRegistry.js.map
