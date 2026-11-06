import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShelf } from "./shelf.js";
import { createJoinMcpRegistry } from "./mcpTools.js";
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
      message: `nothing at ${p} \u2014 Join's routes are /health, /api/shelf, /api/resolve/<name>, /api/kinds, /api/members (GET \xB7 POST \xB7 DELETE /:name), /api/plan and the agent door POST /mcp`
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
        if (m === "GET" && p === "/api/plan") {
          return sendJson(res, 200, { ok: true, ...options.shelf.plan() });
        }
        if (m === "GET" && p.startsWith("/api/resolve/")) {
          const name = p.slice("/api/resolve/".length);
          if (!name) return sendJson(res, 400, { error: { code: "no_name", message: "ask for something: /api/resolve/State" } });
          const r = await options.shelf.resolveName(name);
          return sendJson(res, r.found ? 200 : 404, { ok: r.found, ...r });
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
