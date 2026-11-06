import http from "node:http";
import path from "node:path";
import { createMcpRegistry } from "./mcpTools.js";
import { createMcpServer } from "./mcpServer.js";
import { serveStatic } from "./staticFiles.js";
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}
function readBody(req, capBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (buf) => {
      size += buf.length;
      if (size > capBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      parts.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}
const SOURCES = ["user", "agent", "process", "system"];
function createApiServer(options) {
  const handler = options.handler;
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), "public");
  const mcp = options.enableMcp === false ? null : createMcpServer({ registry: createMcpRegistry(handler) });
  const authorized = (req, url) => {
    if (!token) return true;
    const header = req.headers["x-eh-token"];
    if (typeof header === "string" && header === token) return true;
    return url.searchParams.get("token") === token;
  };
  const route = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? "GET";
    const guarded = pathName === "/mcp" || pathName.startsWith("/api/");
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, "unauthorized", "x-eh-token header or ?token= is required");
      return;
    }
    if (pathName === "/mcp" && mcp) {
      await mcp.handle(req, res);
      return;
    }
    if (pathName === "/health" && method === "GET") {
      const stats = handler.stats();
      sendJson(res, 200, {
        ok: true,
        module: "eventHandler",
        events: handler.list().length,
        log: { file: stats.file, bytes: stats.bytes, lines: stats.lines, retentionHours: stats.retentionHours }
      });
      return;
    }
    if (pathName === "/api/events" && method === "GET") {
      sendJson(res, 200, { ok: true, events: handler.list(), stats: handler.stats() });
      return;
    }
    if (pathName === "/api/events/trigger" && method === "POST") {
      let body;
      try {
        body = JSON.parse(await readBody(req) || "{}");
      } catch {
        sendError(res, 400, "bad_json", "body must be JSON: {name, payload?, source?}");
        return;
      }
      const input = body ?? {};
      const name = typeof input.name === "string" ? input.name : "";
      if (!name) {
        sendError(res, 400, "bad_json", "trigger needs a name: {name, payload?, source?}");
        return;
      }
      const source = SOURCES.includes(input.source) ? input.source : "user";
      const receipt = handler.trigger(name, input.payload, { source });
      if (!receipt.ok) {
        sendError(res, 404, "no_such_event", `no such event: ${name} \u2014 GET /api/events for the palette`);
        return;
      }
      sendJson(res, 200, { ok: true, receipt });
      return;
    }
    if (pathName === "/api/events/log" && method === "GET") {
      const limitRaw = Number(url.searchParams.get("limit"));
      const sinceHoursRaw = Number(url.searchParams.get("sinceHours"));
      const read = handler.read({
        limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200,
        since: Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0 ? Date.now() - sinceHoursRaw * 36e5 : void 0,
        name: url.searchParams.get("name") ?? void 0,
        source: url.searchParams.get("source") ?? void 0
      });
      sendJson(res, 200, { ok: true, matched: read.matched, fileBytes: read.fileBytes, lines: read.lines });
      return;
    }
    if (pathName === "/api/events/purge" && method === "POST") {
      sendJson(res, 200, { ok: true, ...handler.purge() });
      return;
    }
    if (pathName === "/api/events/stream" && method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write('event: ready\ndata: {"ok":true}\n\n');
      const off = handler.on((line) => {
        try {
          res.write(`event: event
data: ${JSON.stringify(line)}

`);
        } catch {
        }
      });
      const beat = setInterval(() => {
        try {
          res.write(": beat\n\n");
        } catch {
        }
      }, 15e3);
      beat.unref?.();
      req.on("close", () => {
        clearInterval(beat);
        off();
      });
      return;
    }
    if (method === "GET") {
      serveStatic(req, res, { root: publicDir });
      return;
    }
    sendError(res, 404, "no_route", `no route for ${method} ${pathName}`);
  };
  const server = http.createServer((req, res) => {
    void route(req, res).catch((err) => {
      try {
        sendError(res, 500, "internal", err instanceof Error ? err.message : String(err));
      } catch {
      }
    });
  });
  return {
    server,
    url: `http://${host}`,
    // real port comes from startApiServer
    port: options.port ?? 8126,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    })
  };
}
async function startApiServer(options) {
  const api = createApiServer(options);
  await new Promise((resolve, reject) => {
    api.server.once("error", reject);
    api.server.listen(options.port ?? 8126, options.host ?? "127.0.0.1", () => resolve());
  });
  const addr = api.server.address();
  const boundPort = addr ? addr.port : options.port ?? 8126;
  return {
    ...api,
    port: boundPort,
    url: `http://${options.host ?? "127.0.0.1"}:${boundPort}`,
    stop: api.close
  };
}
async function runTests() {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const { createEventHandler } = await import("./eventHandler.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-api-"));
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const handler = createEventHandler({ logPath: path.join(dir, "events.log"), purgeIntervalMs: 0 });
  handler.start();
  handler.register("demo", (payload) => ({ got: payload }), { description: "demo event" });
  const api = await startApiServer({ handler, port: 0, publicDir: path.join(process.cwd(), "public") });
  const base = api.url;
  const health = await (await fetch(base + "/health")).json();
  ok("health answers", health.ok === true && health.module === "eventHandler" && health.events === 1, JSON.stringify(health));
  const palette = await (await fetch(base + "/api/events")).json();
  ok("the palette reads over HTTP", palette.events[0]?.name === "demo");
  const triggerRes = await fetch(base + "/api/events/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "demo", payload: { x: 1 } })
  });
  const triggerBody = await triggerRes.json();
  ok("a trigger fires over HTTP as source user", triggerRes.status === 200 && triggerBody.receipt.source === "user");
  const miss = await fetch(base + "/api/events/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "nope" })
  });
  ok("an unknown event answers 404 with a code", miss.status === 404 && (await miss.json()).error.code === "no_such_event");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logRes = await (await fetch(base + "/api/events/log?name=demo.result")).json();
  ok("the outcome reads back over HTTP", logRes.matched === 1, JSON.stringify(logRes));
  const controller = new AbortController();
  const streamRes = await fetch(base + "/api/events/stream", { signal: controller.signal });
  ok("the stream opens", streamRes.status === 200 && streamRes.headers.get("content-type")?.includes("text/event-stream") === true);
  const reader = streamRes.body?.getReader();
  let feed = "";
  const pump = (async () => {
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        feed += decoder.decode(value);
        if (feed.includes('"name":"demo"') && feed.includes("event: event")) break;
      }
    } catch {
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 150));
  await fetch(base + "/api/events/trigger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "demo", source: "agent" }) });
  await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, 2500))]);
  ok("the live feed carried the event", feed.includes('"name":"demo"') && feed.includes('"source":"agent"'), feed.slice(0, 120).replace(/\n/g, "\\n"));
  controller.abort();
  const purge = await (await fetch(base + "/api/events/purge", { method: "POST" })).json();
  ok("purge answers with counts", purge.ok === true && typeof purge.before === "number");
  const guarded = await startApiServer({ handler, port: 0, token: "secret", publicDir: path.join(process.cwd(), "public") });
  ok("a guarded api refuses without the token", (await fetch(guarded.url + "/api/events")).status === 401);
  ok("a guarded api accepts the header", (await fetch(guarded.url + "/api/events", { headers: { "x-eh-token": "secret" } })).status === 200);
  ok("a guarded api accepts ?token=", (await fetch(guarded.url + "/health?token=secret")).status === 200);
  await guarded.stop();
  const init = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  const initBody = await init.json();
  ok("the MCP door answers on the same port", initBody.result?.serverInfo?.name === "event-handler");
  await api.stop();
  let closed = false;
  try {
    await fetch(base + "/health");
  } catch {
    closed = true;
  }
  ok("stop closes the door", closed);
  handler.close();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[apiServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createApiServer,
  runTests,
  startApiServer
};
//# sourceMappingURL=apiServer.js.map
