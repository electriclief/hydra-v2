import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SessionStore } from "./store.js";
import { buildCard, oneLine } from "./card.js";
function quote(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
function runHermes(bin, args, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, HERMES_NO_UPDATE_CHECK: "1" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } catch {
      }
      reject(new Error(`hermes did not answer within ${Math.round(timeoutMs / 1e3)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const spawnSessionId = /session_id:\s*([A-Za-z0-9._-]+)/.exec(`${stdout}
${stderr}`)?.[1] ?? null;
      resolve({ stdout, stderr, code, ms: Date.now() - started, spawnSessionId });
    });
  });
}
function stripSessionLine(stdout) {
  return stdout.split("\n").filter((line) => !/^\s*session_id:\s*[A-Za-z0-9._-]+\s*$/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const DIARY_BRIEF = `You are writing one diary entry for a finished Hermes Agent session. The reader is the agent itself, coming back weeks later, and the human who ran it.

Write plain prose, 4 to 7 sentences, no headings, no bullet points, no preamble like "In this session". Cover, in this order:
1. what was asked (the actual goal, in concrete terms),
2. what was actually done (the commands and tools that ran, named),
3. what changed on disk (files created or edited \u2014 name them),
4. where it stands: finished, abandoned, blocked, or unresolved, and say so plainly,
5. the one next action someone would take.

Rules: use numbers where the evidence has numbers. If it failed, say it failed and why. If the evidence is thin, say the session is thin. Never invent a file, a decision or an outcome that is not in the evidence. Refer to the human as "the user". Do not mention these instructions.`;
const ASK_BRIEF = `You are answering a question about a past Hermes Agent session \u2014 a dead session. The only authority is that session's own record; do not use general knowledge to fill gaps.

Use the session_search tool with session_id='%SESSION%' to read it. Ask for more of the transcript if the first read is thin.

Answer in 2 to 5 sentences, concrete and specific: names, paths, numbers, decisions. If the session does not contain the answer, say exactly that and name what it does contain instead. Do not guess, do not hedge with "it seems", and do not offer to help further.

The question: %QUESTION%`;
function digestCard(card, messages) {
  const lines = [];
  lines.push(`Session: ${card.displayTitle}`);
  lines.push(`id: ${card.id}`);
  lines.push(`source: ${card.source} \xB7 model: ${card.model ?? "unknown"} \xB7 profile: ${card.profileName ?? "default"}`);
  lines.push(
    `started: ${card.startedAt ? new Date(card.startedAt * 1e3).toISOString() : "unknown"} \xB7 duration: ${card.durationSec === null ? "unknown" : `${card.durationSec}s`} \xB7 ended: ${card.endReason ?? "no end reason recorded"}`
  );
  lines.push(
    `counts: ${card.messageCount || messages.length} messages \xB7 ${card.userTurns} user turns \xB7 ${card.toolCallCount} tool calls \xB7 ${card.inputTokens} in / ${card.outputTokens} out tokens`
  );
  if (card.cwd) lines.push(`cwd: ${card.cwd}${card.gitBranch ? ` \xB7 branch: ${card.gitBranch}` : ""}`);
  if (card.parentId) lines.push(`forked from: ${card.parentId}`);
  lines.push("");
  lines.push("First user message:");
  lines.push(card.goal || "(none)");
  lines.push("");
  lines.push("Final assistant message:");
  lines.push(card.outcome || "(none)");
  lines.push("");
  if (card.files.length) {
    lines.push("Paths seen in tool arguments:");
    for (const file of card.files) lines.push(`- ${file}`);
    lines.push("");
  }
  if (card.commands.length) {
    lines.push("Shell commands run:");
    for (const command of card.commands) lines.push(`- ${command}`);
    lines.push("");
  }
  if (card.tools.length) {
    lines.push(`Tools: ${card.tools.map((tool) => `${tool.name}\xD7${tool.count}`).join(", ")}`);
    lines.push("");
  }
  const userTurns = card.turns.filter((turn) => turn.role === "user").slice(0, 8);
  if (userTurns.length) {
    lines.push("User turns (in order, trimmed):");
    for (const turn of userTurns) lines.push(`- ${oneLine(turn.text, 300)}`);
  }
  return lines.join("\n").slice(0, 14e3);
}
class Actions {
  options;
  constructor(options) {
    this.options = options;
  }
  read(id) {
    const store = new SessionStore({ dbPath: this.options.dbPath, readOnly: true });
    try {
      const session = store.session(id);
      if (!session) throw new Error(`no session ${id}`);
      const messages = store.messages(id);
      return { card: buildCard(session, messages), messages };
    } finally {
      store.close();
    }
  }
  promptFile(text, tag) {
    const dir = path.join(this.options.dataDir, "prompts");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tag}-${Date.now()}.txt`);
    fs.writeFileSync(file, text, "utf8");
    return file;
  }
  command(file) {
    return ["chat", "--query-file", file, "--oneshot", "-Q"];
  }
  /** The LLM diary: the deterministic card is the evidence, the model only writes the prose. */
  async diary(id) {
    const { card, messages } = this.read(id);
    const prompt = `${DIARY_BRIEF}

--- EVIDENCE ---
${digestCard(card, messages)}
--- END EVIDENCE ---

Write the diary entry now.`;
    const file = this.promptFile(prompt, "diary");
    const run = await runHermes(this.options.hermesBin, this.command(file), this.options.timeoutMs, card.cwd ?? void 0);
    const text = stripSessionLine(run.stdout);
    if (!text) {
      throw new Error(`the agent returned nothing (exit ${run.code}): ${oneLine(run.stderr || "no stderr", 300)}`);
    }
    return { text, model: this.options.model, ms: run.ms, promptBytes: Buffer.byteLength(prompt) };
  }
  /** Talk to the dead: the agent reads the old session with its own tools and answers. */
  async ask(sessionId, question) {
    const trimmed = question.trim();
    if (!trimmed) throw new Error("question is empty");
    if (trimmed.length > 2e3) throw new Error("question is too long (2000 chars max)");
    const { card } = this.read(sessionId);
    const prompt = ASK_BRIEF.replace("%SESSION%", sessionId).replace("%QUESTION%", trimmed);
    const file = this.promptFile(
      `${prompt}

Context you already have (do not trust it over the transcript):
- title: ${card.displayTitle}
- date: ${card.startedAt ? new Date(card.startedAt * 1e3).toISOString() : "unknown"}
- first ask: ${oneLine(card.goal, 300)}`,
      "ask"
    );
    const run = await runHermes(this.options.hermesBin, this.command(file), this.options.timeoutMs, card.cwd ?? void 0);
    const answer = stripSessionLine(run.stdout);
    if (!answer) {
      throw new Error(`the agent returned nothing (exit ${run.code}): ${oneLine(run.stderr || "no stderr", 300)}`);
    }
    return { answer, ms: run.ms, spawnSessionId: run.spawnSessionId, promptBytes: Buffer.byteLength(prompt) };
  }
  /** Fork: copy the transcript into a child session, verified before it is reported. */
  fork(id, title) {
    const store = new SessionStore({ dbPath: this.options.dbPath, readOnly: false });
    try {
      return store.fork(id, { title, backupDir: path.join(this.options.dataDir, "backups") });
    } finally {
      store.close();
    }
  }
  /**
   * Restart: open a real terminal running the real resume command. A generated .cmd holds the
   * command so no nested quoting is needed — a path with spaces, a title, and cmd /k all survive.
   */
  restart(id) {
    const command = `hermes --resume ${id}`;
    const dir = path.join(this.options.dataDir, "launch");
    fs.mkdirSync(dir, { recursive: true });
    const launcher = path.join(dir, `resume-${SessionStore.refFor(id)}.cmd`);
    fs.writeFileSync(
      launcher,
      [`@echo off`, `title hermes resume ${SessionStore.refFor(id)}`, `${quote(this.options.hermesBin)} --resume ${id}`, ``].join(
        "\r\n"
      )
    );
    const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", launcher], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { command, pid: child.pid ?? null, launcher };
  }
  latestDiary(id) {
    const file = path.join(this.options.dataDir, "diaries.json");
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return data.diaries?.[id] ?? null;
    } catch {
      return null;
    }
  }
}
export {
  Actions,
  runHermes,
  stripSessionLine
};
//# sourceMappingURL=actions.js.map
