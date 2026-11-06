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
export {
  ask,
  extractAnswer
};
//# sourceMappingURL=agent.js.map
