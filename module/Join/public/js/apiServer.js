import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createShelf } from "./shelf.js";
import { createJoinMcpRegistry } from "./mcpTools.js";
import { loadRoster, resolveDeclared } from "./roster.js";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};
function sendJson(res, code, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
function sendNoRoute(res, p) {
  sendJson(res, 404, {
    error: {
      code: "no_route",
      message: `nothing at ${p} \u2014 Join's routes are /health, /api/shelf, /api/resolve/<name>, /api/kinds, /api/members (GET \xB7 POST \xB7 DELETE /:name), /api/roster (GET \xB7 /:name), /api/plan and the agent door POST /mcp`
    }
  });
}
async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    const buf = c;
    size += buf.length;
    if (size > limit) throw new Error("body too large (max 64 KB)");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}
async function startApi(options) {
  const host = options.host ?? "127.0.0.1";
  const publicRoot = options.publicRoot ?? path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * WHAT VERSION IS THIS, AND IS THERE A NEWER ONE ON GITHUB?
 *
 * The node answers this itself. Pushing to five machines over ssh is not a version check, it is a chore with a receipt:
 * each box can ask origin what the latest is, say how far behind it is, and pull when told. Join owns the shelf, so it
 * owns the question "is my shelf current".
 */
function gitRun(root, args, timeout = 20000) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout, windowsHide: true }).trim();
}

function versionOf(root) {
  const out = { local: null, remote: null, behind: null, dirty: null, error: null, repo: root, checkedAt: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    out.local = gitRun(root, ["rev-parse", "--short", "HEAD"]);
    out.dirty = gitRun(root, ["status", "--porcelain", "--untracked-files=no"]).length > 0;
  } catch (e) {
    out.error = "not a git checkout: " + (e instanceof Error ? e.message : String(e)).split("\n")[0];
    return out;
  }
  try { gitRun(root, ["fetch", "--quiet", "origin"]); } catch (e) {
    // a box with no network is not a box with no version: local is known, remote is not, and that is said out loud
    out.error = "fetch failed: " + (e instanceof Error ? e.message : String(e)).split("\n")[0];
  }
  try { out.remote = gitRun(root, ["rev-parse", "--short", "origin/main"]); } catch { }
  try { out.behind = Number(gitRun(root, ["rev-list", "--count", "HEAD..origin/main"])); } catch { }
  return out;
}

async function publishVersion(stateUrl, ref, body) {
  if (!stateUrl || !ref) return null;
  try {
    const r = await fetch(stateUrl + "/api/state/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `node.${ref}.version`, content: body }),
      signal: AbortSignal.timeout(2000)
    });
    return r.status;
  } catch { return null; }
}

/**
 * IS ANYTHING WORKING RIGHT NOW?
 *
 * An update may not stop a job. A render, a transcription or a mining run in progress is work someone waited for; a
 * pull that restarts the door underneath it turns finished work into lost work. So the node is asked two questions
 * before it is allowed to move: has a job declared itself busy, and does the Scheduler have anything running.
 * Both are ordinary state, so anything at all - a script, a service, Echidna - can raise or lower the flag.
 */
async function busyNow(stateUrl, ref, schedulerUrl) {
  const reasons = [];
  if (stateUrl && ref) {
    try {
      const r = await fetch(`${stateUrl}/api/state/pull?name=node.${ref}.busy`, { signal: AbortSignal.timeout(1500) });
      const j = await r.json().catch(() => null);
      const c = j?.content ?? null;
      if (c && c.busy === true) reasons.push(String(c.what || c.reason || 'a job declared itself busy'));
    } catch { /* a state door that cannot be asked is not evidence of work */ }
  }
  try {
    const r = await fetch(`${schedulerUrl}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json().catch(() => null);
    const running = Number(j?.stats?.running ?? 0);
    if (running > 0) reasons.push(`${running} scheduler job(s) running`);
  } catch { /* no scheduler here: nothing to wait for */ }
  return reasons;
}

async function publishUpdate(stateUrl, ref, body) {
  if (!stateUrl || !ref) return null;
  try {
    const r = await fetch(stateUrl + "/api/state/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `node.${ref}.update`, content: body }), signal: AbortSignal.timeout(2000)
    });
    return r.status;
  } catch { return null; }
}

function repoOf(root) {
  return path.resolve(root, "..");
}

function refOf(options) {
  if (options.ref) return String(options.ref);
  if (process.env.JOIN_REF) return String(process.env.JOIN_REF);
  // node.json lives in the Shelf's own tree (module/Menu/data), not at the repo root: getting this wrong made the
  // version fact unpublishable while the check itself looked healthy.
  try {
    const j = JSON.parse(fs.readFileSync(path.join(options.shelf.options.shelfRoot, "Menu", "data", "node.json"), "utf8"));
    return String(j.ref || j.name || "").trim() || null;
  } catch { return null; }
}
function root2() {
  return path.resolve(options.shelf.options.shelfRoot, "..");
}
  const registry = createJoinMcpRegistry(options.shelf);
  const server = http.createServer((req, res) => {
    void (async () => {
      const m = req.method ?? "GET";
      const u = new URL(req.url ?? "/", `http://${host}`);
      const p = decodeURIComponent(u.pathname);
      if ((p.startsWith("/api/") || p === "/mcp") && options.token) {
        const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (given !== options.token) return sendJson(res, 401, { error: { code: "no_token", message: "this door needs its token" } });
      }
      try {
        if (m === "GET" && p === "/health") {
          return sendJson(res, 200, {
            ok: true,
            module: "join",
            since: (/* @__PURE__ */ new Date()).toISOString(),
            shelfRoot: options.shelf.options.shelfRoot,
            dry: options.shelf.options.dry,
            what: "the shelf's self-description \u2014 should (files) and is (probed), kept apart",
            surfaces: { gui: "/", api: "/api/shelf", mcp: "/mcp" }
          });
        }
        if (m === "GET" && p === "/api/shelf") {
          return sendJson(res, 200, { ok: true, ...await options.shelf.all() });
        }
        if (m === "GET" && p === "/api/version") {
          const repo = repoOf(options.shelf.options.shelfRoot);
          const v = versionOf(repo);
          const ref = refOf(options);
          // publish every check: a version nobody asked about is still the answer to "is this box current"
          const status = await publishVersion(options.stateUrl ?? process.env.JOIN_STATE_URL ?? "http://127.0.0.1:8127", ref, v);
          return sendJson(res, 200, { ok: !v.error, ref, published: status, ...v });
        }
        if (m === "POST" && p === "/api/version/pull") {
          const repo = repoOf(options.shelf.options.shelfRoot);
          const ref = refOf(options);
          const stateUrl = options.stateUrl ?? process.env.JOIN_STATE_URL ?? "http://127.0.0.1:8127";
          let body0 = {};
          try { body0 = await readJsonBody(req); } catch { body0 = {}; }
          const busy = await busyNow(stateUrl, ref, options.schedulerUrl ?? process.env.JOIN_SCHEDULER_URL ?? "http://127.0.0.1:8132");
          if (busy.length && body0.force !== true) {
            // NOT A FAILURE: a job is running and the update waits its turn. It says so out loud, with the reason, so the
            // cycle can leave it alone instead of retrying into a render every ten minutes.
            const deferred = { state: 'deferred', rev: null, busy, at: (/* @__PURE__ */ new Date()).toISOString(),
              why: 'work in progress - the update waits for the gap between jobs' };
            const published = await publishUpdate(stateUrl, ref, deferred);
            return sendJson(res, 409, { ok: false, deferred: true, ref, published, ...deferred });
          }
          const before = versionOf(repo);
          let pulled = null, error = null;
          try {
            pulled = gitRun(repo, ["pull", "--ff-only"], 120000);
          } catch (e) {
            error = "pull refused: " + (e instanceof Error ? e.message : String(e)).split("\n")[0];
          }
          const after = versionOf(repo);
          const body = { ...after, before: before.local, pulled: pulled ? true : false, error: error ?? after.error,
            pulledAt: error ? null : (/* @__PURE__ */ new Date()).toISOString() };
          const status = await publishVersion(stateUrl, ref, body);
          const out = await publishUpdate(stateUrl, ref, { state: error ? 'failed' : 'pulled', from: before.local, to: after.local,
            rev: after.local, pulled: !error, error: error ?? null, at: (/* @__PURE__ */ new Date()).toISOString(),
            restart: error ? null : 'pending - the running doors are still the old code until they restart in a gap or at boot' });
          return sendJson(res, error ? 409 : 200, { ok: !error, ref, published: status, update: out, from: before.local, to: after.local, output: pulled, ...body });
        }
        if (m === "GET" && p === "/api/kinds") {
          return sendJson(res, 200, {
            ok: true,
            kinds: options.shelf.kinds,
            note: "add a kind by writing Join/data/kinds.json \u2014 no code change, no restart of the shelf"
          });
        }
        if (p === "/api/members") {
          if (m === "GET") {
            return sendJson(res, 200, {
              ok: true,
              file: options.shelf.options.membersFile,
              members: options.shelf.members.list()
            });
          }
          if (m === "POST") {
            let body;
            try {
              body = await readJsonBody(req);
            } catch (e) {
              return sendJson(res, 400, { error: { code: "bad_json", message: e instanceof Error ? e.message : String(e) } });
            }
            try {
              const saved = options.shelf.members.upsert(body);
              return sendJson(res, 201, { ok: true, member: saved });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              return sendJson(res, 400, { error: { code: "invalid_member", message: msg } });
            }
          }
          return sendJson(res, 405, { error: { code: "method_not_allowed", message: "members: GET (list) or POST (register)" } });
        }
        if (m === "DELETE" && p.startsWith("/api/members/")) {
          const name = p.slice("/api/members/".length);
          if (!name) return sendJson(res, 400, { error: { code: "no_name", message: "which member? /api/members/<name>" } });
          const gone = options.shelf.members.remove(name);
          return sendJson(res, gone ? 200 : 404, gone ? { ok: true, removed: name } : { error: { code: "no_such_member", message: `nothing registered as ${name}` } });
        }
        if (m === "GET" && (p === "/api/roster" || p.startsWith("/api/roster/"))) {
          const roster = loadRoster();
          if (!roster.ok) {
            return sendJson(res, 503, {
              error: { code: "roster_unreadable", message: `cannot read the roster at ${roster.file}`, detail: roster.error }
            });
          }
          if (p === "/api/roster") {
            const members = options.shelf.members.list();
            const attached = new Set(members.map((mm) => mm.name.toLowerCase()));
            return sendJson(res, 200, {
              ok: true,
              file: roster.file,
              declared: roster.rows.length,
              attached: roster.rows.filter((row2) => attached.has(row2.name.toLowerCase())).length,
              rows: roster.rows.map((row2) => ({ ...row2, attached: attached.has(row2.name.toLowerCase()) }))
            });
          }
          const name = p.slice("/api/roster/".length);
          if (!name) return sendJson(res, 400, { error: { code: "no_name", message: "which machine? /api/roster/<name>" } });
          const row = resolveDeclared(roster, name);
          if (!row) {
            return sendJson(res, 404, {
              ok: false,
              error: { code: "not_declared", message: `${name} is not in the roster at ${roster.file} - that is a fact about the roster, not about the machine` }
            });
          }
          const member = options.shelf.members.get(row.name);
          return sendJson(res, 200, {
            ok: true,
            name: row.name,
            declared: row,
            attached: member !== null,
            member,
            reason: member ? "declared and also joined to this shelf" : "declared in the roster, not joined here (asleep or never joined)"
          });
        }
        if (m === "GET" && p === "/api/plan") {
          return sendJson(res, 200, { ok: true, ...options.shelf.plan() });
        }
        if (m === "GET" && p.startsWith("/api/resolve/")) {
          const name = p.slice("/api/resolve/".length);
          if (!name) return sendJson(res, 400, { error: { code: "no_name", message: "ask for something: /api/resolve/State" } });
          const r = await options.shelf.resolveName(name);
          if (r.found) return sendJson(res, 200, { ok: true, ...r });
          const roster = loadRoster();
          const row = roster.ok ? resolveDeclared(roster, name) : null;
          if (row) {
            return sendJson(res, 200, {
              ok: true,
              found: true,
              name: row.name,
              kind: "node",
              liveness: "declared",
              attached: false,
              declared: { role: row.role, ready_for: row.ready_for, ip: row.ip, hostname: row.hostname, kind: row.kind, notes: row.notes },
              reason: `declared in ${roster.file} - not attached to this shelf, so nothing here can probe it`,
              alternatives: []
            });
          }
          return sendJson(res, 404, { ok: false, ...r });
        }
        if (p === "/mcp") {
          if (m !== "POST") {
            return sendJson(res, 405, { error: { code: "use_post", message: "the agent door is POST /mcp" } });
          }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          let body;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return sendJson(res, 400, { error: { code: "bad_json", message: "body must be JSON" } });
          }
          const wantsSse = String(req.headers.accept ?? "").includes("text/event-stream");
          const frame = (payload) => wantsSse ? `event: message
data: ${JSON.stringify(payload)}

` : JSON.stringify(payload);
          if (body.method === "notifications/initialized") {
            res.writeHead(202);
            return res.end();
          }
          if (body.method === "initialize") {
            res.writeHead(200, { "content-type": wantsSse ? "text/event-stream" : "application/json" });
            return res.end(frame({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "join", version: "0.1.0" },
                instructions: "Join \u2014 resolve \xB7 shelf \xB7 reports. This is the node's SELF-DESCRIPTION: it knows every module by name and never guesses. Asking for something that is declared but not answering makes Join ask ProcessWrapper to start it (answer: 'starting'), so a lookup never reports 'not found' for something merely not running. It NAMES only: it never carries traffic and never decides."
              }
            }));
          }
          if (body.method === "tools/list") {
            res.writeHead(200, { "content-type": wantsSse ? "text/event-stream" : "application/json" });
            const strip = (t) => {
              const { run: _run, ...rest } = t;
              return rest;
            };
            return res.end(frame({ jsonrpc: "2.0", id: body.id, result: { tools: registry.list().map((t) => strip(t)) } }));
          }
          if (body.method === "tools/call") {
            const name = String(body.params?.name ?? "");
            const args = body.params?.arguments ?? {};
            const out = await registry.call(name, args);
            res.writeHead(200, { "content-type": wantsSse ? "text/event-stream" : "application/json" });
            return res.end(frame({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: out.text }], isError: out.isError === true } }));
          }
          res.writeHead(200, { "content-type": wantsSse ? "text/event-stream" : "application/json" });
          return res.end(frame({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `no such method: ${body.method}` } }));
        }
        if (m === "GET") {
          const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
          const target = path.resolve(publicRoot, rel);
          const inside = target === publicRoot || target.startsWith(publicRoot + path.sep);
          if (inside && fs.existsSync(target) && fs.statSync(target).isFile()) {
            const body2 = fs.readFileSync(target);
            res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream", "content-length": body2.length });
            return res.end(body2);
          }
        }
        return sendNoRoute(res, p);
      } catch (e) {
        return sendJson(res, 500, { error: { code: "join_failed", message: e instanceof Error ? e.message : String(e) } });
      }
    })();
  });
  await new Promise((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(options.port ?? 8131, host, () => resolveP());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : options.port ?? 8131;
  return { server, port };
}
function runTests() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "join-api-"));
  let server;
  void (async () => {
    try {
      const state = path.join(root, "State");
      fs.mkdirSync(state, { recursive: true });
      fs.writeFileSync(path.join(state, "package.json"), '{"description":"the generic retainer"}', "utf8");
      fs.writeFileSync(
        path.join(state, "join.json"),
        JSON.stringify({ name: "State", kind: "door", port: 9, start: "node main.js", wiredAtBoot: true }),
        "utf8"
      );
      const shelf = createShelf({ shelfRoot: root, probeTimeoutMs: 300, pwUrl: "http://127.0.0.1:1", servicesUrl: "http://127.0.0.1:1" });
      const started = await startApi({ shelf, port: 0, host: "127.0.0.1" });
      server = started.server;
      const base = `http://127.0.0.1:${started.port}`;
      const get = async (p) => (await fetch(base + p)).json();
      const health = await get("/health");
      console.assert(health.ok === true && health.module === "join", "the door says what it is");
      const kinds = await get("/api/kinds");
      const kindNames = kinds.kinds.map((k) => k.name);
      console.assert(
        kindNames.includes("node") && kindNames.includes("door"),
        "the kind catalog is served \u2014 a reader never guesses the vocabulary",
        kindNames.join(",")
      );
      const post = await fetch(base + "/api/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Pi-Node", kind: "node", url: "http://127.0.0.1:1", deps: ["State"], tags: ["remote"] })
      });
      const created = await post.json();
      console.assert(post.status === 201 && created.member?.name === "Pi-Node", "POST registers a member", String(post.status));
      const bad = await fetch(base + "/api/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "no spaces allowed!", kind: "node" })
      });
      console.assert(bad.status === 400, "a bad member is refused with 400", String(bad.status));
      const list = await get("/api/members");
      console.assert(
        list.members.length === 1,
        "GET lists the registered member",
        String(list.members.length)
      );
      const shelfBody = await get("/api/shelf");
      const names = shelfBody.modules.map((m) => m.name);
      console.assert(
        names.includes("Pi-Node") && names.includes("State"),
        "the shelf merges registered AND on-disk members",
        names.join(",")
      );
      const res = await get("/api/resolve/Pi-Node");
      console.assert(
        res.found === true && res.kind === "node" && res.url === "http://127.0.0.1:1",
        "a registered member resolves by name, with its url",
        JSON.stringify(res.kind)
      );
      const plan = await get("/api/plan");
      const order = plan.order;
      console.assert(
        order.indexOf("State") >= 0 && order.indexOf("State") < order.indexOf("Pi-Node"),
        "the plan puts a dependency first",
        order.join(",")
      );
      const del = await fetch(base + "/api/members/Pi-Node", { method: "DELETE" });
      console.assert(del.status === 200, "DELETE removes it", String(del.status));
      const gone = await get("/api/resolve/Pi-Node");
      console.assert(gone.found === false, "and it is honestly absent afterwards", String(gone.found));
      const noRoute = await fetch(base + "/api/nothing-here");
      const nr = await noRoute.json();
      console.assert(
        noRoute.status === 404 && String(nr.error?.message).includes("/api/members"),
        "a dead end names the real routes",
        String(nr.error?.message).slice(0, 50)
      );
    } catch (e) {
      console.assert(false, "the api suite ran without a crash", e instanceof Error ? e.message : String(e));
    } finally {
      if (server) server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  })();
}
export {
  runTests,
  startApi
};
//# sourceMappingURL=apiServer.js.map
