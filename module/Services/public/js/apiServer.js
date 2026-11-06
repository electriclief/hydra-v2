import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { buildManifest, lastSyncMark, resolveInRoot, syncFrom } from "./shelf.js";
import { createServiceMcpRegistry } from "./mcpTools.js";
import { createMcpServer } from "./mcpServer.js";
import { serveStatic } from "./staticFiles.js";
function nodeRefOf(root) {
  for (const rel of ["Core/data/node.json", "Menu/data/node.json"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, "module", rel), "utf8"));
      if (typeof parsed.ref === "string" && parsed.ref.trim()) return parsed.ref.trim().toLowerCase();
    } catch {
    }
  }
  return "node";
}
async function postJson(url, body, timeoutMs = 1200) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function noteShelf(root, note) {
  const stateUrl = process.env.SERVICES_STATE_URL ?? "http://127.0.0.1:8127";
  await postJson(`${stateUrl}/api/state/register`, { name: `node.${nodeRefOf(root)}.shelf`, content: note });
}
async function fireEvent(name, payload) {
  const eventUrl = process.env.SERVICES_EVENT_URL ?? "http://127.0.0.1:8126";
  await postJson(`${eventUrl}/api/events/trigger`, { name, payload, source: "system" });
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}
function sendHtml(res, status, html) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
  res.end(html);
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
function createApiServer(options) {
  const catalog = options.catalog;
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? null;
  const publicDir = options.publicDir ?? path.join(process.cwd(), "public");
  const shelfRoot = options.shelfRoot ? path.resolve(options.shelfRoot) : null;
  const mcp = options.enableMcp === false ? null : createMcpServer({ registry: createServiceMcpRegistry(catalog, { shelfRoot: options.shelfRoot }) });
  const authorized = (req, url) => {
    if (!token) return true;
    const header = req.headers["x-services-token"];
    if (typeof header === "string" && header === token) return true;
    return url.searchParams.get("token") === token;
  };
  const route = async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathName = url.pathname;
    const method = req.method ?? "GET";
    const guarded = pathName === "/mcp" || pathName.startsWith("/api/");
    if (guarded && !authorized(req, url)) {
      sendError(res, 401, "unauthorized", "x-services-token header or ?token= is required");
      return;
    }
    if (pathName === "/mcp" && mcp) {
      await mcp.handle(req, res);
      return;
    }
    if (pathName === "/health" && method === "GET") {
      const entries = catalog.entries();
      sendJson(res, 200, { ok: true, module: "services", dir: catalog.dir, services: entries.filter((e) => e.ok).length, refused: entries.filter((e) => !e.ok).length });
      return;
    }
    if (pathName === "/api/services" && method === "GET") {
      const filter = url.searchParams.get("filter") ?? void 0;
      sendJson(res, 200, { ok: true, dir: catalog.dir, services: catalog.list(filter) });
      return;
    }
    if (pathName === "/api/services/reload" && method === "POST") {
      await readBody(req).catch(() => "");
      const entries = catalog.reload();
      sendJson(res, 200, {
        ok: true,
        count: entries.length,
        refused: catalog.refusals().map((entry) => ({ name: entry.name, file: entry.file, errors: entry.errors }))
      });
      return;
    }
    if (pathName === "/api/services/validate" && method === "GET") {
      const reports = catalog.entries().map((entry) => ({ name: entry.name, file: entry.file, ok: entry.ok, errors: entry.errors, warnings: entry.warnings }));
      sendJson(res, 200, { ok: reports.every((r) => r.ok), reports });
      return;
    }
    if ((pathName === "/api/shelf" || pathName === "/api/shelf/manifest" || pathName === "/api/shelf/file") && method === "GET") {
      if (!shelfRoot) {
        sendError(res, 501, "no_shelf", "this instance carries no shelf root - nothing to report");
        return;
      }
      if (pathName === "/api/shelf") {
        const m = buildManifest(shelfRoot, options.shelfLabel ?? "");
        sendJson(res, 200, {
          ok: true,
          rev: m.rev,
          label: m.label,
          generatedAt: m.generatedAt,
          files: m.files.length,
          bytes: m.bytes,
          lastSync: lastSyncMark(shelfRoot)
        });
        return;
      }
      if (pathName === "/api/shelf/manifest") {
        sendJson(res, 200, buildManifest(shelfRoot, options.shelfLabel ?? ""));
        return;
      }
      const rel = url.searchParams.get("path") ?? "";
      const abs = resolveInRoot(shelfRoot, rel);
      if (!abs || !fs.existsSync(abs)) {
        sendError(res, 404, "no_such_file", `not in this shelf: ${rel}`);
        return;
      }
      const buf = fs.readFileSync(abs);
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(buf.length), "cache-control": "no-store" });
      res.end(buf);
      return;
    }
    if (pathName === "/api/shelf/sync" && method === "POST") {
      if (!shelfRoot) {
        sendError(res, 501, "no_shelf", "this instance carries no shelf root - nothing to update");
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req) || "{}");
      } catch (err) {
        sendError(res, 400, "bad_json", err instanceof Error ? err.message : String(err));
        return;
      }
      const peer = typeof body.url === "string" ? body.url.trim() : "";
      if (!peer) {
        sendError(res, 400, "no_peer", "POST {url, apply} \u2014 the peer whose shelf you want to compare against");
        return;
      }
      try {
        const out = await syncFrom(shelfRoot, peer, {
          apply: body.apply === true,
          only: Array.isArray(body.only) ? body.only.filter((p) => typeof p === "string") : void 0
        });
        if (out.applied) {
          const manifest = buildManifest(shelfRoot, options.shelfLabel ?? "");
          void noteShelf(shelfRoot, {
            rev: manifest.rev,
            files: manifest.files.length,
            bytes: manifest.bytes,
            pulledFrom: out.peer,
            at: (/* @__PURE__ */ new Date()).toISOString(),
            fetched: out.fetched.length,
            refused: out.refused.length
          });
          void fireEvent("shelf.pulled", { ref: nodeRefOf(shelfRoot), peerRev: out.peerRev, fetched: out.fetched.length, refused: out.refused.length });
        }
        for (const bad of out.refused) {
          void fireEvent("shelf.refused", { ref: nodeRefOf(shelfRoot), path: bad.path, why: bad.why });
        }
        sendJson(res, 200, { ok: true, ...out });
      } catch (err) {
        sendError(res, 502, "sync_failed", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (pathName.startsWith("/api/services/") && method === "GET") {
      const rest = pathName.slice("/api/services/".length);
      const half = ["ad", "inputs"].find((h) => rest.endsWith("/" + h));
      if (half) {
        let name2;
        try {
          name2 = decodeURIComponent(rest.slice(0, rest.length - half.length - 1));
        } catch {
          sendError(res, 400, "bad_name", "the name is not a valid URI component");
          return;
        }
        const html = half === "ad" ? catalog.ad(name2) : catalog.inputs(name2);
        if (html === null) {
          sendError(res, 404, "no_such_service", `no ${half} page for: ${name2} \u2014 GET /api/services for the listing`);
          return;
        }
        sendHtml(res, 200, html);
        return;
      }
      let name;
      try {
        name = decodeURIComponent(rest);
      } catch {
        sendError(res, 400, "bad_name", "the name is not a valid URI component");
        return;
      }
      const entry = catalog.get(name);
      if (!entry) {
        sendError(res, 404, "no_such_service", `no such service: ${name} \u2014 GET /api/services for the listing`);
        return;
      }
      sendJson(res, 200, { ok: true, name: entry.name, file: entry.file, warnings: entry.warnings, service: entry.definition });
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
    port: options.port ?? 8128,
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
    api.server.listen(options.port ?? 8128, options.host ?? "127.0.0.1", () => resolve());
  });
  const addr = api.server.address();
  const boundPort = addr ? addr.port : options.port ?? 8128;
  return {
    ...api,
    port: boundPort,
    url: `http://${options.host ?? "127.0.0.1"}:${boundPort}`,
    stop: api.close
  };
}
async function runTests() {
  const fs2 = await import("node:fs");
  const os = await import("node:os");
  const { createServiceCatalog } = await import("./serviceCatalog.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const jsonOf = async (res) => await res.json();
  const dir = fs2.mkdtempSync(path.join(os.tmpdir(), "svc-api-"));
  fs2.writeFileSync(
    path.join(dir, "demo.js"),
    'module.exports = { name: "demo", advert: { what: "a demo", karma: 3 }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>the demo page</h1>", inputs: "<h1>in</h1>" } };'
  );
  const catalog = createServiceCatalog({ dir });
  const api = await startApiServer({ catalog, port: 0, publicDir: path.join(process.cwd(), "public") });
  const base = api.url;
  const health = await jsonOf(await fetch(base + "/health"));
  ok("health answers", health.ok === true && health.module === "services" && health.services === 1, JSON.stringify(health));
  const listing = await jsonOf(await fetch(base + "/api/services"));
  ok("the listing reads over HTTP", listing.services.length === 1 && listing.services[0].name === "demo" && listing.services[0].modes.join(",") === "cpu");
  const one = await jsonOf(await fetch(base + "/api/services/demo"));
  ok("one definition reads over HTTP", one.ok === true && one.service.advert.karma === 3);
  const missing = await fetch(base + "/api/services/nope");
  ok("an unknown service answers 404 no_such_service", missing.status === 404 && (await jsonOf(missing)).error.code === "no_such_service");
  const ad = await fetch(base + "/api/services/demo/ad");
  const adText = await ad.text();
  ok("the ad page serves as text/html", ad.status === 200 && ad.headers.get("content-type")?.startsWith("text/html") === true && adText.includes("the demo page"));
  const inPage = await fetch(base + "/api/services/demo/inputs");
  ok("the inputs page serves as text/html", inPage.status === 200 && (await inPage.text()).includes("<h1>in</h1>"));
  const pageMiss = await fetch(base + "/api/services/nope/ad");
  ok("an unknown page answers 404", pageMiss.status === 404);
  const validate = await jsonOf(await fetch(base + "/api/services/validate"));
  ok("validate reports the catalog", validate.ok === true && validate.reports[0].name === "demo");
  fs2.writeFileSync(path.join(dir, "two.js"), 'module.exports = { name: "two", advert: { what: "second" }, provider: { name: "demo app" }, pages: { ad: "<h1>two</h1>", inputs: "<h1>in</h1>" } };');
  const reloaded = await fetch(base + "/api/services/reload", { method: "POST" });
  const reloadBody = await jsonOf(reloaded);
  ok("reload picks up a new file over HTTP", reloadBody.count === 2);
  const guarded = await startApiServer({ catalog, port: 0, token: "secret", publicDir: path.join(process.cwd(), "public") });
  ok("a guarded api refuses without the token", (await fetch(guarded.url + "/api/services")).status === 401);
  ok("a guarded api accepts the header", (await fetch(guarded.url + "/api/services", { headers: { "x-services-token": "secret" } })).status === 200);
  await guarded.stop();
  const init = await fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  const initBody = await jsonOf(init);
  ok("the MCP door answers on the same port", initBody.result?.serverInfo?.name === "services");
  await api.stop();
  let closed = false;
  try {
    await fetch(base + "/health");
  } catch {
    closed = true;
  }
  ok("stop closes the door", closed);
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
