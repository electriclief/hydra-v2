import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readShelf } from "./declaration.js";
import { createMemberStore } from "./members.js";
import { loadKinds } from "./kinds.js";
import { buildShelf, resolve } from "./resolver.js";
class Shelf {
  options;
  /** The kinds in force — built-ins plus whatever Join/data/kinds.json adds. */
  kinds;
  /** Things joined at runtime (not modules on disk). */
  members;
  constructor(options) {
    this.options = {
      shelfRoot: options.shelfRoot,
      pwUrl: options.pwUrl ?? "http://127.0.0.1:8125",
      servicesUrl: options.servicesUrl ?? "http://127.0.0.1:8128",
      probeTimeoutMs: options.probeTimeoutMs ?? 1500,
      dry: options.dry === true,
      membersFile: options.membersFile ?? path.join(options.shelfRoot, "Join", "data", "members.json"),
      kindsFile: options.kindsFile ?? path.join(options.shelfRoot, "Join", "data", "kinds.json")
    };
    this.kinds = loadKinds(this.options.kindsFile);
    this.members = createMemberStore(this.options.membersFile, this.kinds);
  }
  /**
   * Everything on this node, as declared: modules with a join.json (or inferred), PLUS the
   * registered members. A registered row wins over a file row of the same name — an explicit
   * runtime registration is a later, more deliberate statement than a file on disk.
   */
  declarations() {
    const fromFiles = readShelf(this.options.shelfRoot, { kinds: this.kinds });
    const fromStore = this.members.declarations();
    const registered = new Set(fromStore.map((d) => d.name.toLowerCase()));
    return [...fromFiles.filter((d) => !registered.has(d.name.toLowerCase())), ...fromStore].sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * A probe is an HONEST question with a deadline. A door that hangs must read as "not
   * answering", never as a stall and never as a green tick.
   */
  async probe(port) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(this.options.probeTimeoutMs)
      });
      return res.status === 200 || res.status === 404;
    } catch {
      return false;
    }
  }
  /** Ask ProcessWrapper to start a module — through its own console palette. */
  async startViaWrapper(name, decl) {
    if (this.options.dry) return { ok: false, error: "dry \u2014 Join was told not to start anything" };
    if (!decl.start) return { ok: false, error: "no start command declared" };
    try {
      const res = await fetch(`${this.options.pwUrl}/api/events/trigger`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "add Process Console Display",
          payload: {
            name: `console-${decl.name}`,
            command: decl.start,
            cwd: path.join(this.options.shelfRoot, decl.name)
          }
        }),
        signal: AbortSignal.timeout(this.options.probeTimeoutMs + 2e3)
      });
      if (res.status !== 202) return { ok: false, error: `the wrapper answered ${res.status}, not 202` };
      return { ok: true, id: "asked \u2014 read /api/processes for the truth" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  /** The OFFERED population, straight from the catalog door. Absent door is empty, not broken. */
  async offered() {
    try {
      const res = await fetch(`${this.options.servicesUrl}/api/services`, {
        signal: AbortSignal.timeout(this.options.probeTimeoutMs + 1500)
      });
      if (!res.ok) return [];
      const body = await res.json();
      return (body.services ?? []).filter((s) => typeof s.name === "string").map((s) => ({ name: s.name, provider: s.provider ?? "?", what: s.what ?? "", liveness: "offered" }));
    } catch {
      return [];
    }
  }
  /** Ask a url-shaped member (node · mcp · share) whether it answers. null = could not ask. */
  async probeDecl(decl) {
    if (!decl.url) return null;
    const spec = decl.probe ?? null;
    const p = spec?.path ?? "/health";
    const expect = spec?.expect ?? [200, 404];
    try {
      const res = await fetch(decl.url.replace(/\/+$/, "") + p, {
        signal: AbortSignal.timeout(spec?.timeoutMs ?? this.options.probeTimeoutMs)
      });
      return expect.includes(res.status);
    } catch {
      return false;
    }
  }
  /** The deps a resolver needs, bound to this shelf. */
  deps() {
    return {
      probe: (port) => this.probe(port),
      start: (name, decl) => this.startViaWrapper(name, decl),
      listOffered: () => this.offered(),
      probeDecl: (decl) => this.probeDecl(decl)
    };
  }
  /**
   * THE ORDER THINGS COME UP IN, from what each one declares it depends on. Kahn's algorithm,
   * and it refuses to hide the hard cases: a name that depends on something not on the shelf
   * is `blocked` and says which name; a loop is reported as a `cycle` rather than silently
   * broken. Ordering foresight — so "add a thing that needs three others" stays a data change.
   */
  plan() {
    const decls = this.declarations();
    const byName = new Map(decls.map((d) => [d.name.toLowerCase(), d]));
    const missingEdges = /* @__PURE__ */ new Map();
    const indeg = /* @__PURE__ */ new Map();
    const outgoing = /* @__PURE__ */ new Map();
    for (const d of decls) {
      const key = d.name.toLowerCase();
      indeg.set(key, indeg.get(key) ?? 0);
      for (const dep of d.deps ?? []) {
        const k = dep.toLowerCase();
        if (!byName.has(k)) {
          missingEdges.set(key, [...missingEdges.get(key) ?? [], dep]);
          continue;
        }
        outgoing.set(k, [...outgoing.get(k) ?? [], key]);
        indeg.set(key, (indeg.get(key) ?? 0) + 1);
        indeg.set(k, indeg.get(k) ?? 0);
      }
    }
    const ready = [...indeg.entries()].filter(([, n]) => n === 0).map(([k]) => k).sort();
    const order = [];
    while (ready.length) {
      const k = ready.shift();
      order.push(byName.get(k)?.name ?? k);
      for (const next of outgoing.get(k) ?? []) {
        const n = (indeg.get(next) ?? 1) - 1;
        indeg.set(next, n);
        if (n === 0) ready.push(next);
      }
      ready.sort();
    }
    const left = decls.filter((d) => !order.some((o) => o.toLowerCase() === d.name.toLowerCase()));
    const cycles = left.length ? [left.filter((d) => !missingEdges.has(d.name.toLowerCase())).map((d) => d.name)] : [];
    return {
      order,
      blocked: [...missingEdges.entries()].map(([k, missing]) => ({ name: byName.get(k)?.name ?? k, missing })),
      cycles: cycles.filter((c) => c.length > 0)
    };
  }
  /** Every row: modules AND offered, one lookup surface for a reader with no context. */
  async all() {
    const decls = this.declarations();
    return {
      modules: await buildShelf(decls, this.deps()),
      offered: await this.offered(),
      root: this.options.shelfRoot,
      kinds: this.kinds
    };
  }
  /** The resolution. The one act this module exists for. */
  async resolveName(name) {
    return resolve(name, this.declarations(), this.deps(), await this.offered());
  }
  /** A one-line truth for a reader with nothing else. */
  describe() {
    if (!fs.existsSync(this.options.shelfRoot)) {
      return `Join \u2014 the shelf at ${this.options.shelfRoot} is not there. Nothing to resolve.`;
    }
    return "Join \u2014 the shelf's self-description. NAMES ONLY: it says where a thing is, never carries traffic, never decides. should (files) and is (probed) are kept apart.";
  }
}
function createShelf(options) {
  return new Shelf(options);
}
function runTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "join-shelf-"));
  let server;
  const started = [];
  const listen = (reply) => new Promise((resolveP) => {
    const s = http.createServer((_rq, rs) => {
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(reply);
    });
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      resolveP({ port: typeof a === "object" && a ? a.port : 0, server: s });
    });
  });
  void (async () => {
    try {
      const live = await listen('{"ok":true}');
      server = live.server;
      const door = path.join(root, "State");
      fs.mkdirSync(door, { recursive: true });
      fs.writeFileSync(path.join(door, "package.json"), '{"description":"the generic retainer"}', "utf8");
      fs.writeFileSync(
        path.join(door, "join.json"),
        JSON.stringify({ name: "State", kind: "door", port: live.port, start: "node main.js", wiredAtBoot: true }),
        "utf8"
      );
      const dead = path.join(root, "Ghost");
      fs.mkdirSync(dead, { recursive: true });
      fs.writeFileSync(
        path.join(dead, "join.json"),
        JSON.stringify({ name: "Ghost", kind: "door", port: 9, start: "node ghost.js", wiredAtBoot: false }),
        "utf8"
      );
      const shelf = createShelf({ shelfRoot: root, pwUrl: "http://127.0.0.1:1", servicesUrl: "http://127.0.0.1:1", probeTimeoutMs: 600 });
      console.assert(await shelf.probe(live.port) === true, "a real door on a real port probes UP", String(live.port));
      console.assert(await shelf.probe(9) === false, "a dead port probes DOWN - honestly");
      const all = await shelf.all();
      const st = all.modules.find((m) => m.name === "State");
      const gh = all.modules.find((m) => m.name === "Ghost");
      console.assert(st?.is === "up" && st?.should.port === live.port, "a live door reads up", `${st?.is}`);
      console.assert(
        gh?.is === "down" && gh?.should.port === 9,
        "A DECLARED-BUT-DEAD MODULE STAYS VISIBLE - should and is, never merged",
        `${gh?.is}/${gh?.should.port}`
      );
      console.assert(String(gh?.detail).includes("not answering"), "and the row says why", String(gh?.detail));
      const pw = http.createServer((rq, rs) => {
        const chunks = [];
        rq.on("data", (c) => chunks.push(c));
        rq.on("end", () => {
          const b = JSON.parse(Buffer.concat(chunks).toString());
          if (b.name === "add Process Console Display") started.push(b.payload?.name ?? "?");
          rs.writeHead(202);
          rs.end("");
        });
      });
      await new Promise((r2) => pw.listen(0, "127.0.0.1", () => r2()));
      const pwPort = pw.address().port;
      const shelf2 = createShelf({ shelfRoot: root, pwUrl: `http://127.0.0.1:${pwPort}`, servicesUrl: "http://127.0.0.1:1", probeTimeoutMs: 600 });
      const r = await shelf2.resolveName("Ghost");
      console.assert(r.found === true && r.liveness === "starting", 'here-but-down answers STARTING, not "not found"', r.liveness);
      console.assert(started.includes("console-Ghost"), "and it really asked ProcessWrapper over real HTTP", started.join(","));
      const dryShelf = createShelf({ shelfRoot: root, pwUrl: `http://127.0.0.1:${pwPort}`, dry: true });
      const d = await dryShelf.resolveName("Ghost");
      console.assert(
        d.liveness === "starting" && d.reason.includes("dry"),
        "dry mode refuses LOUDLY - it still answers, and says why it did nothing",
        d.reason.slice(0, 60)
      );
      const relay = shelf2.members.upsert({
        name: "Relay",
        kind: "node",
        url: "http://127.0.0.1:1",
        what: "a node that is not there",
        deps: ["State"],
        tags: ["remote"]
      });
      console.assert(relay.origin === "registered", "a registered member says where it came from");
      const withMember = await shelf2.all();
      const rel = withMember.modules.find((x) => x.name === "Relay");
      console.assert(rel !== void 0, "a registered member appears on the shelf, no folder needed");
      console.assert(
        rel?.kind === "node" && rel?.should.url === "http://127.0.0.1:1",
        "with its own kind and url",
        `${rel?.kind}/${rel?.should.url}`
      );
      console.assert(rel?.is === "down", "and its liveness is probed, not assumed", String(rel?.is));
      console.assert(withMember.modules.some((x) => x.origin === "file"), "file modules still say they are files");
      console.assert(withMember.kinds.some((k) => k.name === "node"), "the shelf carries its kind catalog");
      shelf2.members.upsert({ name: "Board", kind: "board", what: "an unknown kind", deps: ["Nowhere"] });
      const plan = shelf2.plan();
      console.assert(plan.order.includes("State") && plan.order.includes("Relay"), "the order includes both", plan.order.join(","));
      console.assert(
        plan.order.indexOf("State") < plan.order.indexOf("Relay"),
        "a dependency comes BEFORE its dependant",
        plan.order.join(",")
      );
      const blocked = plan.blocked.find((b) => b.name === "Board");
      console.assert(
        blocked?.missing.includes("Nowhere"),
        "a dep on something absent is REPORTED, not hidden",
        JSON.stringify(plan.blocked)
      );
      console.assert(shelf2.describe().includes("NAMES ONLY"), "the module says what it is");
      pw.close();
    } catch (e) {
      console.assert(false, "the shelf suite ran without a crash", e instanceof Error ? e.message : String(e));
    } finally {
      if (server) server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  })();
}
export {
  Shelf,
  createShelf,
  runTests
};
//# sourceMappingURL=shelf.js.map
