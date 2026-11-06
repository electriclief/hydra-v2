import { randomUUID } from "node:crypto";
import { ToolRefusal } from "./mcpTools.js";
const DEFAULT_INSTRUCTIONS = [
  "Services \u2014 the definitions of a run. This box serves the SERVICE OBJECTS this node carries: one tiny .js data file per service, loaded as data and never executed. It RUNS nothing \u2014 scheduling and running are the Scheduler module's business.",
  "The flow: services_list (the catalog as shapes \u2014 name \xB7 what \xB7 provider \xB7 modes \xB7 karma \xB7 sound or refused) \u2192 services_get (ONE whole definition: advert \xB7 provider \xB7 variables (init \xB7 input \xB7 file slots) \xB7 modes (each with its models, needs, karma weight and INSTALL \u2014 the version dance: pinned python\xB7cuda\xB7torch combos and per-sm_XX build notes for older cards) \xB7 needs \xB7 output \xB7 children \xB7 update \xB7 pages (ad \u2014 the sell sheet; inputs \u2014 the way in) \xB7 progress \xB7 gui) \u2192 services_ad + services_inputs (the two pages the maker writes: the sell sheet, and the way in \u2014 the advert, how to install provider and service, the update method) \u2192 services_reload after a file changes \u2192 services_validate for the report.",
  "A service DECLARES: what it does, what it needs, how it installs, what it costs in karma weight, what comes back. Nothing here starts, books, or measures \u2014 read the definitions and act through the modules that do."
].join("\n");
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
function wantsSse(req) {
  const accept = String(req.headers.accept ?? "");
  return accept.includes("text/event-stream");
}
function createMcpServer(options) {
  const registry = options.registry;
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  const protocolVersions = options.protocolVersions ?? ["2025-06-18", "2025-03-26", "2024-11-05"];
  const sessions = /* @__PURE__ */ new Map();
  function sendPayload(req, res, payload, status = 200, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (wantsSse(req)) {
      const text2 = `event: message
data: ${JSON.stringify(payload)}

`;
      res.writeHead(status, { ...headers, "content-type": "text/event-stream; charset=utf-8", "content-length": Buffer.byteLength(text2) });
      res.end(text2);
      return;
    }
    const text = JSON.stringify(payload, null, 2);
    res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
    res.end(text);
  }
  async function handleOne(msg) {
    const id = msg.id ?? null;
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    switch (msg.method) {
      case "initialize": {
        const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
        const version = protocolVersions.includes(requested) ? requested : protocolVersions[0];
        const sessionId = randomUUID();
        sessions.set(sessionId, { createdAt: Date.now() });
        return {
          reply: ok({
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: "services", version: "0.1.0" },
            instructions
          }),
          headers: { "Mcp-Session-Id": sessionId }
        };
      }
      case "notifications/initialized":
        return { notification: true };
      case "ping":
        return { reply: ok({}) };
      case "tools/list":
        return { reply: ok({ tools: registry.list() }) };
      case "tools/call": {
        const name = typeof msg.params?.name === "string" ? msg.params.name : "";
        const args = msg.params?.arguments ?? {};
        if (!registry.list().some((tool) => tool.name === name)) {
          return { reply: fail(-32602, `unknown tool: ${name} \u2014 call tools/list`) };
        }
        try {
          const result = await registry.call(name, args);
          return { reply: ok(result) };
        } catch (err) {
          const message = err instanceof ToolRefusal ? err.message : `tool failed: ${err instanceof Error ? err.message : String(err)}`;
          return { reply: ok({ content: [{ type: "text", text: message }], isError: true }) };
        }
      }
      default:
        return { reply: fail(-32601, `unknown method: ${String(msg.method ?? "")}`) };
    }
  }
  async function handle(req, res) {
    if (req.method === "GET") {
      const text = JSON.stringify({ error: { code: "no_route", message: "GET /mcp is not a stream \u2014 POST JSON-RPC; the catalog answers at /api/services" } }, null, 2);
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
      res.end(text);
      return;
    }
    if (req.method === "DELETE") {
      const sid = req.headers["mcp-session-id"];
      if (sid) sessions.delete(String(sid));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      const text = JSON.stringify({ error: { code: "no_route", message: "POST JSON-RPC to /mcp" } }, null, 2);
      res.writeHead(405, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
      res.end(text);
      return;
    }
    let body = "";
    try {
      body = await readBody(req);
    } catch {
      const text = JSON.stringify({ error: { code: "bad_json", message: "body too large" } }, null, 2);
      res.writeHead(413, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
      res.end(text);
      return;
    }
    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      sendPayload(req, res, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
      return;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const replies = [];
    let headers = {};
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") {
        replies.push({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        continue;
      }
      const outcome = await handleOne(msg);
      if (outcome.notification) continue;
      if (outcome.headers) headers = { ...headers, ...outcome.headers };
      if (outcome.reply !== void 0) replies.push(outcome.reply);
    }
    if (!replies.length) {
      res.writeHead(202, headers);
      res.end();
      return;
    }
    sendPayload(req, res, Array.isArray(parsed) ? replies : replies[0], 200, headers);
  }
  return { handle };
}
async function runTests() {
  const http = await import("node:http");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createServiceCatalog } = await import("./serviceCatalog.js");
  const { createServiceMcpRegistry } = await import("./mcpTools.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-mcps-"));
  fs.writeFileSync(path.join(dir, "demo.js"), 'module.exports = { name: "demo", advert: { what: "a demo" }, provider: { name: "demo app" }, pages: { ad: "<h1>demo</h1>", inputs: "<h1>in</h1>" } };');
  const catalog = createServiceCatalog({ dir });
  const server = createMcpServer({ registry: createServiceMcpRegistry(catalog) });
  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith("/mcp")) {
      void server.handle(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const addr = httpServer.address();
  const base = `http://127.0.0.1:${addr.port}/mcp`;
  const call = async (payload, headers = {}) => {
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  };
  const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" } } });
  const initBody = init.body;
  ok("initialize answers with the server name", initBody.result?.serverInfo?.name === "services", JSON.stringify(init.body).slice(0, 120));
  ok("initialize carries instructions", typeof initBody.result?.instructions === "string" && initBody.result.instructions.includes("services_get"));
  const session = init.headers.get("mcp-session-id");
  ok("initialize issues a session id", typeof session === "string" && session.length > 10);
  const note = await call({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": String(session) });
  ok("a notification answers 202 with no body", note.status === 202, String(note.status));
  const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": String(session) });
  const tools = list.body.result?.tools ?? [];
  ok("tools/list advertises the registry", tools.length === 8 && tools.some((t) => t.name === "services_list"), tools.map((t) => t.name).join(","));
  const callRes = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "services_get", arguments: { name: "demo" } } }, { "mcp-session-id": String(session) });
  const callBody = callRes.body;
  ok("tools/call reads a definition", callBody.result?.content?.[0]?.text?.includes('"what": "a demo"') === true, JSON.stringify(callBody).slice(0, 160));
  const unknownTool = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } }, { "mcp-session-id": String(session) });
  ok("an unknown tool is -32602", unknownTool.body.error?.code === -32602);
  const unknownMethod = await call({ jsonrpc: "2.0", id: 5, method: "nope/nope" }, { "mcp-session-id": String(session) });
  ok("an unknown method is -32601", unknownMethod.body.error?.code === -32601);
  const sse = await call({ jsonrpc: "2.0", id: 6, method: "ping" }, { "mcp-session-id": String(session), accept: "text/event-stream" });
  ok("SSE framing works", typeof sse.body === "string" && sse.body.startsWith("event: message\ndata: "), String(sse.body).slice(0, 60));
  const batch = await call([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", id: 8, method: "ping" }], { "mcp-session-id": String(session) });
  ok("batches answer in order", Array.isArray(batch.body) && batch.body.length === 2);
  const getRes = await fetch(base);
  ok("GET /mcp points elsewhere (405)", getRes.status === 405);
  await new Promise((resolve) => httpServer.close(() => resolve()));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[mcpServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createMcpServer,
  runTests
};
//# sourceMappingURL=mcpServer.js.map
