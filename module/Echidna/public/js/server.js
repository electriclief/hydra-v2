import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ask } from "./agent.js";
import { loadRig } from "./rig.js";
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
  const ttsFile = path.join(options.dataDir, "tts.json");
  const readTts = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(ttsFile, "utf8"));
      return { enabled: raw.enabled !== false, url: raw.url || options.ttsUrl };
    } catch {
      fs.writeFileSync(ttsFile, JSON.stringify({ enabled: true, url: options.ttsUrl }, null, 2));
      return { enabled: true, url: options.ttsUrl };
    }
  };
  const monitorFile = path.join(options.dataDir, "monitor.json");
  let monitor = { stack: [], index: -1 };
  try {
    const raw = JSON.parse(fs.readFileSync(monitorFile, "utf8"));
    if (Array.isArray(raw.stack) && raw.stack.length) {
      monitor = { stack: raw.stack, index: Math.min(Math.max(0, raw.index ?? raw.stack.length - 1), raw.stack.length - 1) };
    }
  } catch {
  }
  const saveMonitor = () => {
    try {
      fs.writeFileSync(monitorFile, JSON.stringify(monitor, null, 2));
    } catch {
    }
  };
  const monitorCard = () => monitor.index >= 0 && monitor.stack[monitor.index] || monitor.stack[monitor.stack.length - 1] || null;
  const pushCard = (card) => {
    monitor.stack = monitor.stack.slice(0, monitor.index + 1);
    monitor.stack.push(card);
    if (monitor.stack.length > 40) monitor.stack.shift();
    monitor.index = monitor.stack.length - 1;
    saveMonitor();
  };
  const publish = async () => {
    if (options.readOnly) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      await fetch(`${options.stateUrl.replace(/\/$/, "")}/api/state/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `node.${options.nodeRef}.echidna`,
          content: {
            at: (/* @__PURE__ */ new Date()).toISOString(),
            host: options.nodeRef,
            owner: "echidna",
            monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
            thread: thread.read(60)
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
    } catch {
    }
  };
  void publish();
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
        const rig = loadRig(options.rigDir);
        const characters = Object.keys(rig.characters).length ? { source: options.rigDir, error: rig.error, characters: rig.characters } : null;
        sendJson(res, 200, {
          tts: readTts(),
          characters,
          monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
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
      if (p === "/api/conversation" && method === "GET") {
        const host = (url.searchParams.get("host") || options.nodeRef).toLowerCase();
        if (host === String(options.nodeRef).toLowerCase()) {
          sendJson(res, 200, {
            ok: true,
            host,
            viewer: false,
            monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
            thread: thread.read(120),
            agent: { present: fs.existsSync(options.agent.bin), busy }
          });
          return;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4e3);
          const remote = await fetch(`${options.mirrorUrl.replace(/\/$/, "")}/api/node/${encodeURIComponent(host)}`, {
            signal: controller.signal
          });
          clearTimeout(timer);
          const body = await remote.json().catch(() => ({}));
          const conv = body.node?.conversation ?? body.conversation;
          if (!conv) {
            sendJson(res, 404, { ok: false, error: `node ${host} is not publishing a conversation`, host });
            return;
          }
          const mon = conv.monitor ?? {};
          sendJson(res, 200, {
            ok: true,
            host,
            viewer: true,
            monitor: mon,
            thread: Array.isArray(conv.thread) ? conv.thread : [],
            agent: { present: false, busy: false },
            publishedAt: conv.at ?? null
          });
          return;
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `could not read ${host}'s conversation: ${error.message}`, host });
          return;
        }
      }
      if (p === "/api/tts" && method === "GET") {
        const cfg = readTts();
        let reachable = false;
        let providers = null;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1500);
          const res2 = await fetch(`${cfg.url.replace(/\/$/, "")}/health`, { signal: controller.signal });
          clearTimeout(timer);
          const body = await res2.json();
          reachable = res2.ok;
          providers = body.providers ?? null;
        } catch {
          reachable = false;
        }
        sendJson(res, 200, { tts: { ...cfg, reachable, providers } });
        return;
      }
      if (p === "/api/tts" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const cfg = readTts();
        if (typeof body.enabled === "boolean") cfg.enabled = body.enabled;
        if (typeof body.url === "string" && body.url.trim()) cfg.url = body.url.trim();
        fs.writeFileSync(ttsFile, JSON.stringify(cfg, null, 2));
        sendJson(res, 200, { ok: true, tts: cfg });
        return;
      }
      if (p === "/api/speak" && method === "POST") {
        const cfg = readTts();
        if (!cfg.enabled) {
          sendJson(res, 409, { ok: false, error: "the voice is switched off" });
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const text = String(body.text ?? "").trim();
        if (!text) {
          sendJson(res, 400, { ok: false, error: "nothing to say" });
          return;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 6e4);
          const upstream = await fetch(`${cfg.url.replace(/\/$/, "")}/say`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, character: body.character ? String(body.character) : void 0, voice: body.voice }),
            signal: controller.signal
          });
          clearTimeout(timer);
          if (!upstream.ok) {
            const why = await upstream.json().catch(() => ({ error: `speech door answered ${upstream.status}` }));
            sendJson(res, 502, { ok: false, error: why.error ?? `speech door answered ${upstream.status}` });
            return;
          }
          const wav = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(200, {
            "content-type": "audio/wav",
            "x-tts-provider": upstream.headers.get("x-tts-provider") ?? "unknown",
            "x-tts-voice": upstream.headers.get("x-tts-voice") ?? "",
            "cache-control": "no-store"
          });
          res.end(wav);
          return;
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `no speech door reachable: ${error.message}` });
          return;
        }
      }
      if (p === "/api/monitor" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const title = String(body.title ?? "").trim();
        const text = String(body.text ?? "").trim();
        if (!title && !text) {
          sendJson(res, 400, { ok: false, error: "a card needs a title or a text" });
          return;
        }
        const kind = ["question", "output", "goal", "note", "speaker"].includes(String(body.kind)) ? String(body.kind) : "note";
        pushCard({
          kind,
          title,
          text,
          at: (/* @__PURE__ */ new Date()).toISOString(),
          ...body.character ? { character: String(body.character) } : {},
          ...body.audio ? { audio: String(body.audio) } : {},
          ...Array.isArray(body.options) ? { options: body.options.map(String) } : {}
        });
        await publish();
        sendJson(res, 201, { ok: true, monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length } });
        return;
      }
      if (p === "/api/monitor/back" && method === "POST") {
        if (monitor.index > 0) monitor.index -= 1;
        saveMonitor();
        await publish();
        sendJson(res, 200, { ok: true, monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length } });
        return;
      }
      if (p === "/api/note" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const from = String(body.from ?? "a door").slice(0, 40);
        const subject = String(body.subject ?? "").trim();
        const text = String(body.text ?? "").trim();
        const severity = String(body.severity ?? "note");
        if (!text && !subject) {
          sendJson(res, 400, { ok: false, error: "a note needs text" });
          return;
        }
        const mark = severity === "alert" ? "ALERT " : severity === "warn" ? "warn  " : "";
        const line = [mark + from, subject, text].filter(Boolean).join(" \xB7 ");
        const turn = thread.append({ id: turnId("n"), at: (/* @__PURE__ */ new Date()).toISOString(), role: "note", text: line });
        sendJson(res, 201, { ok: true, turn });
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
        pushCard({ kind: "question", title: text.length > 180 ? text.slice(0, 177) + "\u2026" : text, text: "", at: (/* @__PURE__ */ new Date()).toISOString() });
        await publish();
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
          if (run.ok) {
            pushCard({ kind: "output", title: "Echidna", text: run.text.slice(0, 900), at: (/* @__PURE__ */ new Date()).toISOString() });
          }
          await publish();
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
