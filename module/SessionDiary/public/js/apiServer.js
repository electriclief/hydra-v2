import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { SessionStore } from "./store.js";
import { buildCard } from "./card.js";
import { readLinks, servingFor, servingMap, linksFile } from "./links.js";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};
function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "600");
}
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}
function sendFile(res, file) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(res);
}
async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk;
    size += buf.length;
    if (size > limit) throw new Error("body too large (max 256 KB)");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function parseJson(raw) {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("body must be a JSON object");
  return parsed;
}
function createContext(options) {
  const indexFile = path.join(options.site.options.siteDir, "data", "index.json");
  function indexRows() {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      return parsed.rows ?? [];
    } catch {
      return [];
    }
  }
  function resolveId(candidate) {
    const cleaned = candidate.trim();
    if (!cleaned) return null;
    const rows = indexRows();
    const exact = rows.find((row) => row.id === cleaned);
    if (exact) return exact.id;
    const byRef = rows.find((row) => row.ref === cleaned);
    if (byRef) return byRef.id;
    if (/^[0-9a-f]{6,64}$/i.test(cleaned)) {
      const prefixed = rows.find((row) => row.ref.startsWith(cleaned) || row.id.includes(cleaned));
      if (prefixed) return prefixed.id;
    }
    const store = new SessionStore({ dbPath: options.dbPath, readOnly: true });
    try {
      const found = store.findIds(cleaned, 1);
      return found[0] ?? null;
    } finally {
      store.close();
    }
  }
  return { options, resolveId, indexRows };
}
function startApiServer(options) {
  const ctx = createContext(options);
  const server = http.createServer((req, res) => {
    cors(res);
    void handle(req, res, ctx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: message });
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        server,
        port,
        url: `http://${options.host}:${port}`,
        stop: () => new Promise((done) => {
          server.close(() => done());
        })
      });
    });
  });
}
async function handle(req, res, ctx) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";
  const parts = url.pathname.split("/").filter(Boolean);
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      door: "SessionDiary",
      db: ctx.options.dbPath,
      site: ctx.options.site.options.siteDir,
      index: ctx.options.site.indexFile(),
      sessions: ctx.indexRows().length
    });
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(302, { location: "/site/read_dir_indexer.html" });
    res.end();
    return;
  }
  if (parts[0] === "site") {
    const relative = parts.slice(1).join("/");
    const target = path.resolve(ctx.options.site.options.siteDir, relative || "read_dir_indexer.html");
    const root = path.resolve(ctx.options.site.options.siteDir);
    if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      sendJson(res, 404, { ok: false, error: `no file ${relative}` });
      return;
    }
    sendFile(res, target);
    return;
  }
  if (parts[0] !== "api") {
    sendJson(res, 404, { ok: false, error: "no route", routes: routesList() });
    return;
  }
  if (method === "GET") {
    if (parts[1] === "links" && parts.length === 2) {
      const links = readLinks(ctx.options.site.options.dataDir);
      sendJson(res, 200, { ok: true, file: linksFile(ctx.options.site.options.dataDir), count: links.length, links });
      return;
    }
    if (parts[1] === "sessions" && parts.length === 2) {
      const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
      const source = url.searchParams.get("source") ?? "";
      const includeQuiet = url.searchParams.get("quiet") === "1";
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 1e3);
      const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
      let rows = ctx.indexRows();
      if (!includeQuiet) rows = rows.filter((row) => row.source !== "cron" && row.source !== "oneshot");
      if (source) rows = rows.filter((row) => row.source === source);
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        rows = rows.filter((row) => {
          const hay = `${row.title} ${row.goal} ${row.ref} ${row.id} ${row.tools.join(" ")} ${row.source}`.toLowerCase();
          return terms.every((term) => hay.includes(term));
        });
      }
      const smap = servingMap(readLinks(ctx.options.site.options.dataDir));
      const withServing = rows.map((row) => smap.has(row.id) ? { ...row, serving: smap.get(row.id) } : row);
      sendJson(res, 200, { ok: true, total: withServing.length, offset, limit, rows: withServing.slice(offset, offset + limit) });
      return;
    }
    if (parts[1] === "sessions" && parts[2]) {
      const id = ctx.resolveId(decodeURIComponent(parts[2]));
      if (!id) {
        sendJson(res, 404, { ok: false, error: `no session matching ${parts[2]}` });
        return;
      }
      const store = new SessionStore({ dbPath: ctx.options.dbPath, readOnly: true });
      try {
        const session = store.session(id);
        if (!session) {
          sendJson(res, 404, { ok: false, error: `no session ${id}` });
          return;
        }
        const card = buildCard(session, store.messages(id));
        sendJson(res, 200, {
          ok: true,
          session: { ...card, serving: servingFor(readLinks(ctx.options.site.options.dataDir), id), turns: card.turns.slice(-40) },
          diary: ctx.options.site.data.diary(id) ?? null,
          seances: ctx.options.site.data.seancesFor(id),
          page: `/site/session_${card.ref}.html`
        });
      } finally {
        store.close();
      }
      return;
    }
    if (parts[1] === "index") {
      sendJson(res, 200, { ok: true, rows: ctx.indexRows() });
      return;
    }
    if (parts[1] === "seances") {
      const id = parts[2] ? ctx.resolveId(decodeURIComponent(parts[2])) : null;
      const all = ctx.options.site.data.data.seances;
      sendJson(res, 200, { ok: true, seances: id ? all.filter((seance) => seance.sessionId === id) : all });
      return;
    }
    if (parts[1] === "routes") {
      sendJson(res, 200, { ok: true, routes: routesList() });
      return;
    }
  }
  if (method === "POST") {
    if (parts[1] === "scan") {
      const body = parseJson(await readBody(req));
      const report = ctx.options.site.build();
      let diaries = [];
      if (body.diary === true) {
        const wanted = Number(body.max ?? 3) || 3;
        const rows = ctx.indexRows().filter((row) => !ctx.options.site.data.diary(row.id) && row.source !== "oneshot").sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, wanted);
        for (const row of rows) {
          try {
            const result = await ctx.options.actions.diary(row.id);
            ctx.options.site.data.setDiary(row.id, {
              text: result.text,
              model: result.model,
              at: Date.now(),
              ms: result.ms
            });
            diaries.push(row.id);
          } catch (error) {
            diaries.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (diaries.length) ctx.options.site.rebuildOne(diaries[0]);
      }
      sendJson(res, 200, { ok: true, report, diaries });
      return;
    }
    if (parts[1] === "diary" && parts[2]) {
      const id = ctx.resolveId(decodeURIComponent(parts[2]));
      if (!id) {
        sendJson(res, 404, { ok: false, error: `no session matching ${parts[2]}` });
        return;
      }
      const body = parseJson(await readBody(req));
      const existing = ctx.options.site.data.diary(id);
      if (existing && body.force !== true) {
        sendJson(res, 200, { ok: true, cached: true, diary: existing, page: `/site/session_${SessionStore.refFor(id)}.html` });
        return;
      }
      const result = await ctx.options.actions.diary(id);
      const diary = { text: result.text, model: result.model, at: Date.now(), ms: result.ms };
      ctx.options.site.data.setDiary(id, diary);
      ctx.options.site.rebuildOne(id);
      sendJson(res, 200, { ok: true, diary, page: `/site/session_${SessionStore.refFor(id)}.html` });
      return;
    }
    if (parts[1] === "ask") {
      const body = parseJson(await readBody(req));
      const rawId = String(body.session_id ?? body.sessionId ?? "").trim();
      const question = String(body.question ?? "").trim();
      if (!rawId) {
        sendJson(res, 400, { ok: false, error: "session_id is required" });
        return;
      }
      if (!question) {
        sendJson(res, 400, { ok: false, error: "question is required" });
        return;
      }
      const id = ctx.resolveId(rawId);
      if (!id) {
        sendJson(res, 404, { ok: false, error: `no session matching ${rawId}` });
        return;
      }
      const result = await ctx.options.actions.ask(id, question);
      const seance = {
        sessionId: id,
        question,
        answer: result.answer,
        at: Date.now(),
        ms: result.ms,
        spawnSessionId: result.spawnSessionId
      };
      ctx.options.site.data.addSeance(seance);
      ctx.options.site.rebuildOne(id);
      sendJson(res, 200, { ok: true, ...result, seance, page: `/site/session_${SessionStore.refFor(id)}.html` });
      return;
    }
    if (parts[1] === "fork" && parts[2]) {
      const id = ctx.resolveId(decodeURIComponent(parts[2]));
      if (!id) {
        sendJson(res, 404, { ok: false, error: `no session matching ${parts[2]}` });
        return;
      }
      const body = parseJson(await readBody(req));
      const title = typeof body.title === "string" ? body.title : void 0;
      const result = ctx.options.actions.fork(id, title);
      const report = ctx.options.site.build();
      sendJson(res, 200, { ok: true, ...result, page: `/site/session_${SessionStore.refFor(result.newId)}.html`, report });
      return;
    }
    if (parts[1] === "restart" && parts[2]) {
      const id = ctx.resolveId(decodeURIComponent(parts[2]));
      if (!id) {
        sendJson(res, 404, { ok: false, error: `no session matching ${parts[2]}` });
        return;
      }
      const result = ctx.options.actions.restart(id);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    if (parts[1] === "rebuild") {
      sendJson(res, 200, { ok: true, report: ctx.options.site.build() });
      return;
    }
  }
  sendJson(res, 404, { ok: false, error: "no route", routes: routesList() });
}
function routesList() {
  return [
    "GET /health",
    "GET /site/<file>",
    "GET /api/sessions?q=&source=&quiet=1&limit=&offset=",
    "GET /api/sessions/<id|ref>",
    "GET /api/index",
    "GET /api/links",
    "GET /api/seances[/<id>]",
    'POST /api/scan {"diary":true,"max":3}',
    'POST /api/diary/<id|ref> {"force":true}',
    'POST /api/ask {"session_id":"\u2026","question":"\u2026"}',
    'POST /api/fork/<id|ref> {"title":"\u2026"}',
    "POST /api/restart/<id|ref>",
    "POST /api/rebuild"
  ];
}
export {
  createContext,
  startApiServer
};
//# sourceMappingURL=apiServer.js.map
