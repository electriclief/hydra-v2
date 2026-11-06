import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ask } from "./agent.js";
import { ThreadStore, turnId } from "./thread.js";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function readEasy(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { easy: raw && typeof raw === "object" ? raw : {}, error: null };
  } catch (error) {
    const message = error.message;
    if (/ENOENT/.test(message)) return { easy: {}, error: null };
    return { easy: {}, error: `easy.json is not readable: ${message}` };
  }
}
function createServer(options) {
  const thread = new ThreadStore(options.dataDir);
  const easyFile = path.join(options.dataDir, "easy.json");
  const sessionFile = path.join(options.dataDir, "agent.json");
  let busy = false;
  const readSession = () => {
    try {
      const j = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      return j.session ?? null;
    } catch {
      return null;
    }
  };
  const writeSession = (id) => {
    if (!id) return;
    try {
      fs.writeFileSync(sessionFile, JSON.stringify({ session: id, at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
    } catch {
    }
  };
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const method = (req.method ?? "GET").toUpperCase();
      const p = url.pathname;
      if (p === "/health") {
        sendJson(res, 200, {
          ok: true,
          door: "echidna",
          agent: options.agent.bin,
          session: readSession(),
          busy
        });
        return;
      }
      if (p === "/api/state" && method === "GET") {
        const { easy, error } = readEasy(easyFile);
        sendJson(res, 200, {
          thread: thread.read(),
          easy,
          easyError: error,
          busy,
          agent: {
            bin: options.agent.bin,
            session: readSession(),
            // honesty over optimism: the pane shows the binary it will run, so a missing one is visible before asking
            present: fs.existsSync(options.agent.bin),
            timeoutMs: options.agent.timeoutMs
          }
        });
        return;
      }
      if (p === "/api/say" && method === "POST") {
        if (busy) {
          sendJson(res, 409, { ok: false, error: "still answering the last one" });
          return;
        }
        let text = "";
        try {
          const body = JSON.parse(await readBody(req) || "{}");
          text = String(body.text ?? "").trim();
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        if (!text) {
          sendJson(res, 400, { ok: false, error: "nothing to ask" });
          return;
        }
        const you = thread.append({ id: turnId("you"), at: (/* @__PURE__ */ new Date()).toISOString(), role: "you", text });
        busy = true;
        try {
          const run = await ask({ ...options.agent, session: readSession() }, text, you.id);
          if (run.sessionId) writeSession(run.sessionId);
          const reply = thread.append({
            id: turnId("e"),
            at: (/* @__PURE__ */ new Date()).toISOString(),
            role: run.ok ? "echidna" : "system",
            text: run.ok ? run.text : `could not answer: ${run.error ?? "unknown"}

${run.text}`.trim(),
            ms: run.ms,
            sessionId: run.sessionId,
            failed: !run.ok
          });
          sendJson(res, run.ok ? 200 : 502, { ok: run.ok, turns: [you, reply] });
        } finally {
          busy = false;
        }
        return;
      }
      if (p === "/api/clear" && method === "POST") {
        thread.clear();
        sendJson(res, 200, { ok: true });
        return;
      }
      if (method === "GET") {
        const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
        const file = path.join(options.publicDir, rel);
        if (!file.startsWith(options.publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          sendJson(res, 404, { ok: false, error: "no such file", path: p });
          return;
        }
        res.writeHead(200, {
          "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-store"
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      sendJson(res, 405, { ok: false, error: `${method} is not allowed on ${p}` });
    })().catch((error) => {
      try {
        sendJson(res, 500, { ok: false, error: error.message });
      } catch {
      }
    });
  });
}
export {
  createServer,
  readEasy
};
//# sourceMappingURL=server.js.map
