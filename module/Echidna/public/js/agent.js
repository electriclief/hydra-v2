import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function extractAnswer(stdout, stderr) {
  const raw = String(stdout || "").replace(/\r\n/g, "\n");
  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const noise = /^(hermes|session_id|model|tokens|elapsed|usage)\b/i;
  const kept = blocks.filter((b) => !noise.test(b));
  const answer = (kept.length ? kept : blocks).slice(-1)[0] || "";
  if (answer) return answer;
  const err = String(stderr || "").trim();
  return err ? `(the agent said nothing on stdout)
${err}` : "(the agent returned no text)";
}
async function ask(config, prompt, askId) {
  const started = Date.now();
  fs.mkdirSync(config.promptDir, { recursive: true });
  const file = path.join(config.promptDir, `${askId}.txt`);
  fs.writeFileSync(file, prompt, "utf8");
  const args = ["chat", "--query-file", file, "--oneshot", "-Q"];
  if (config.session) args.push("--resume", config.session);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    let child;
    try {
      child = spawn(config.bin, args, {
        windowsHide: true,
        env: { ...process.env, HERMES_NO_UPDATE_CHECK: "1" }
      });
    } catch (error) {
      finish({ ok: false, text: "", ms: 0, sessionId: null, error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch {
      }
      finish({
        ok: false,
        text: "",
        ms: Date.now() - started,
        sessionId: null,
        error: `the agent did not answer within ${Math.round(config.timeoutMs / 1e3)}s`
      });
    }, config.timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ ok: false, text: "", ms: Date.now() - started, sessionId: null, error: error.message }));
    child.on("close", (code) => {
      const sessionId = /session_id:\s*([A-Za-z0-9._-]+)/.exec(`${stdout}
${stderr}`)?.[1] ?? null;
      const text = extractAnswer(stdout, stderr);
      finish({
        ok: code === 0,
        text,
        ms: Date.now() - started,
        sessionId,
        error: code === 0 ? null : `hermes exited ${code}`
      });
    });
  });
}
function askStream(config, prompt, askId, onEvent) {
  const started = Date.now();
  fs.mkdirSync(config.promptDir, { recursive: true });
  const file = path.join(config.promptDir, `${askId}.txt`);
  fs.writeFileSync(file, prompt, "utf8");
  const args = ["chat", "--query-file", file, "--oneshot", "-Q", "--format", "stream-json"];
  if (config.session) args.push("--resume", config.session);
  return new Promise((resolve) => {
    let buf = "";
    let deltas = "";
    let sessionId = null;
    let finalText = null;
    let tokens = null;
    let model = null;
    let settled = false;
    const say = (event) => {
      try {
        onEvent?.(event);
      } catch {
      }
    };
    const finish = (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    let child;
    try {
      child = spawn(config.bin, args, { windowsHide: true, env: { ...process.env, HERMES_NO_UPDATE_CHECK: "1" } });
    } catch (error) {
      finish({ ok: false, text: "", ms: 0, sessionId: null, error: error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch {
      }
      finish({
        ok: false,
        text: deltas,
        ms: Date.now() - started,
        sessionId,
        error: `the agent did not answer within ${Math.round(config.timeoutMs / 1e3)}s`
      });
    }, config.timeoutMs);
    const handle = (raw) => {
      const line = raw.trim();
      if (!line) return;
      if (!line.startsWith("{")) {
        const m = /^Session:\s*([A-Za-z0-9._-]+)/.exec(line);
        if (m) sessionId = m[1];
        return;
      }
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      if (evt.type === "system") {
        if (typeof evt.session_id === "string" && evt.session_id) sessionId = evt.session_id;
        if (typeof evt.model === "string" && evt.model) {
          model = evt.model;
          say({ kind: "meta", model });
        }
      } else if (evt.type === "text" && typeof evt.text === "string") {
        deltas += evt.text;
        say({ kind: "delta", text: evt.text });
      } else if (evt.type === "result") {
        if (typeof evt.session_id === "string" && evt.session_id) sessionId = evt.session_id;
        if (typeof evt.text === "string" && evt.text.trim()) finalText = evt.text;
        if (evt.tokens) tokens = evt.tokens;
        if (typeof evt.duration_ms === "number") say({ kind: "meta", tokens: evt.tokens ?? null });
      }
    };
    child.stdout?.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        handle(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        idx = buf.indexOf("\n");
      }
    });
    child.on(
      "error",
      (error) => finish({ ok: false, text: deltas, ms: Date.now() - started, sessionId, error: error.message })
    );
    child.on("close", (code) => {
      if (buf.trim()) handle(buf);
      const text = String(finalText ?? deltas).trim();
      finish({
        ok: code === 0 && Boolean(text),
        text: text || (code === 0 ? "(the agent returned no text)" : ""),
        ms: Date.now() - started,
        sessionId,
        tokens,
        model,
        error: code === 0 ? null : `hermes exited ${code}`
      });
    });
  });
}
export {
  ask,
  askStream,
  extractAnswer
};
//# sourceMappingURL=agent.js.map
