import crypto from "node:crypto";
import { toSpec } from "./registryStore.js";
class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}
const DEFAULT_PROTOCOL = "2025-06-18";
const KNOWN_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
async function readBody(req, capBytes = 4194304) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (buf) => {
      size += buf.length;
      if (size > capBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      parts.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}
function json(res, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    ...extraHeaders
  });
  res.end(text);
}
function sse(res, message) {
  res.write(`event: message
data: ${JSON.stringify(message)}

`);
}
function str(args, key) {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError(`"${key}" is required and must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}
function optStr(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string") throw new ToolError(`"${key}" must be a string when given (got ${JSON.stringify(value)})`);
  return value;
}
function optNum(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolError(`"${key}" must be a finite number when given (got ${JSON.stringify(value)})`);
  }
  return value;
}
function optBool(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "boolean") throw new ToolError(`"${key}" must be a boolean when given (got ${JSON.stringify(value)})`);
  return value;
}
function optObj(args, key) {
  const value = args[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(`"${key}" must be an object when given (got ${JSON.stringify(value)})`);
  }
  return value;
}
function optionalChannel(args) {
  const channel = optStr(args, "channel");
  if (channel === void 0) return void 0;
  if (channel !== "stdout" && channel !== "stderr" && channel !== "both") {
    throw new ToolError(`"channel" must be one of "stdout", "stderr", "both" (got ${JSON.stringify(channel)})`);
  }
  return channel;
}
function recordLine(rec) {
  const up = rec.endedAt ? `${Math.round((rec.endedAt - rec.spawnedAt) / 100) / 10}s` : `${Math.round((Date.now() - rec.spawnedAt) / 100) / 10}s and counting`;
  return `${rec.id} \xB7 ${rec.life} \xB7 pid ${rec.pid ?? "-"} \xB7 ${rec.name} \xB7 ${rec.chars.stdout + rec.chars.stderr} chars \xB7 up ${up}`;
}
function createMcpServer(options) {
  const { wrapper, hub, registry } = options;
  const serverName = options.name ?? "process-wrapper";
  const version = options.version ?? "0.2.0";
  const protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL;
  const configuredEndpoint = (typeof options.endpoint === "string" ? options.endpoint : "http://127.0.0.1:8125").replace(/\/+$/, "");
  const sessions = /* @__PURE__ */ new Map();
  const instructions = (ep) => [
    `ProcessWrapper \u2014 it launches processes on this machine and hands out their output as text.`,
    ``,
    `WHAT IT IS FOR: give it any command ("foo.exe", "python bar.py"), and it starts it as a`,
    `child process, captures stdout+stderr as ONE text stream, and lets you read a copy of that`,
    `stream whole, by range, or live while it still runs. You can also write to the child's`,
    `stdin and kill it. Typical use: run a build/probe/server, watch its output, stop it.`,
    ``,
    `LAWS IT KEEPS (they matter when you interpret what you read):`,
    `  \xB7 ONE LIFE = ONE FILE \u2014 every process life has its own append-only text file under`,
    `    data/streams/<id>.log: never rotated, whole while alive, kept at death. A tool that`,
    `    returns text with "truncatedInMemory": true means the RAM buffer shed the front and the`,
    `    FILE still has everything \u2014 read it by range with a bigger offset.`,
    `  \xB7 NOTHING HIDDEN \u2014 every child is in the table with its id, pid, life and stream file.`,
    `  \xB7 A copy is a copy \u2014 reading or following never consumes the stream or disturbs another`,
    `    reader.`,
    ``,
    `HOW TO CHOOSE A TOOL:`,
    `  \xB7 pw_health first if you are not sure the box is up.`,
    `  \xB7 pw_launch to start something; it answers immediately (life "running", or "starting" for`,
    `    the instant before the spawn result lands \u2014 poll pw_get to get the verdict on a command`,
    `    that may not exist).`,
    `  \xB7 pw_output for text captured SO FAR (fast, bounded); pw_follow to sit on a live stream`,
    `    until the process ends, you have enough, or it times out; pw_wait to just await the end`,
    `    and get the exit code.`,
    `  \xB7 pw_kill when you are done with a long-running process; pw_remove to also forget it from`,
    `    the table (the life file stays).`,
    `  \xB7 pw_commands / pw_save / pw_unsave for the saved commands in data.yaml, and pw_launch`,
    `    {saved:"<name>"} to start one by name instead of retyping its command line.`,
    ``,
    `QUOTING: a command string is split on spaces honouring quotes, so quote any path with a`,
    `space in it \u2014 "\\"C:\\Program Files\\nodejs\\node.exe\\" -e 1" \u2014 or pass the executable as`,
    `"command" and the rest as "args". shell:false is the default, so pipes and redirection need`,
    `shell:true.`,
    ``,
    `RAW SURFACES (same box, same port), if you would rather use HTTP directly:`,
    `  ${ep}/health \xB7 ${ep}/api/processes \xB7 ${ep}/api/processes/<id>/output`,
    `  ${ep}/api/processes/<id>/stream (server-sent events) \xB7 ${ep}/api/commands`,
    `  the human GUI is at ${ep}/`
  ].join("\n");
  const tools = [
    {
      name: "pw_health",
      title: "Health and counters",
      description: "Is this ProcessWrapper alive, and what is it holding? Returns ok, uptime, how many processes it has launched, how many are still live, how many stream copies are open, and how many commands are saved. Call it once at the start of a session, or when any other tool fails to connect.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Health and counters", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(_args, ctx) {
        const all = wrapper.list();
        const health = {
          ok: true,
          module: "processWrapper",
          endpoint: ctx.endpoint,
          processes: { total: all.length, live: all.filter((p) => p.life === "running" || p.life === "starting").length },
          copies: hub.openCount(),
          savedCommands: registry.list().length,
          laws: ["one life = one file", "nothing hidden", "a copy is a copy"]
        };
        return {
          content: [{ type: "text", text: `${serverName} is up at ${ctx.endpoint}.
${JSON.stringify(health, null, 2)}` }],
          structuredContent: health
        };
      }
    },
    {
      name: "pw_launch",
      title: "Launch a process",
      description: 'Start a command as a child process and begin capturing its stdout+stderr as a text stream. Give either a raw "command" string (split on spaces, quotes honoured) or "saved" naming a command from data.yaml (use pw_commands to see them). Optional: args, cwd, env, name, tag, shell, bufferLimitChars. Answers immediately with the new record: life "running" and a pid when the spawn landed, or life "starting" when the result has not arrived yet \u2014 in that case read the record again with pw_get{id} to find out whether it became "running", "exited", "failed" (with the reason in "error") or "killed". shell defaults to false, so a pipe ("a | b") or redirection needs shell:true. Quote any path containing spaces, or pass it as "command" with the rest in "args".',
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: 'The command line to run, e.g. "python bar.py" or "foo.exe --flag". Split on spaces with quotes honoured. Omit when using "saved".' },
          saved: { type: "string", description: "Name of a command saved in data.yaml to launch instead of a raw command. See pw_commands." },
          args: { type: "array", items: { type: "string" }, description: 'Explicit argv appended to "command" (when given, "command" is NOT split on spaces).' },
          cwd: { type: "string", description: "Working directory for the child (default: the wrapper's own cwd)." },
          env: { type: "object", description: `Extra environment variables merged over the wrapper's own environment, e.g. {"HF_HOME":"C:/models"}.` },
          name: { type: "string", description: "Friendly label shown in listings and used to build the process id (default: the command)." },
          tag: { type: "string", description: "Free grouping label (a project, a box, a purpose) \u2014 filter with pw_list{tag}." },
          shell: { type: "boolean", description: 'Run through a shell. Needed for pipes, "&&", and redirection. Default false.' },
          bufferLimitChars: { type: "number", description: "RAM ceiling for the live copy of this process, in characters (default 4000000). The life FILE is never capped \u2014 only the in-memory copy." }
        },
        required: [],
        additionalProperties: false
      },
      annotations: { title: "Launch a process", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      async run(args, ctx) {
        const savedName = optStr(args, "saved");
        let spec;
        if (savedName) {
          const def = registry.find(savedName);
          if (!def) {
            const names = registry.list().map((c) => c.name).join(", ") || "(none saved)";
            throw new ToolError(`no saved command named "${savedName}". Saved: ${names}`);
          }
          spec = toSpec(def, {
            name: optStr(args, "name"),
            tag: optStr(args, "tag") ?? null,
            cwd: optStr(args, "cwd"),
            args: Array.isArray(args.args) ? args.args.map(String) : void 0,
            env: optObj(args, "env"),
            shell: optBool(args, "shell")
          });
        } else {
          spec = {
            command: str(args, "command"),
            args: Array.isArray(args.args) ? args.args.map(String) : void 0,
            cwd: optStr(args, "cwd"),
            env: optObj(args, "env"),
            name: optStr(args, "name"),
            tag: optStr(args, "tag") ?? null,
            shell: optBool(args, "shell"),
            bufferLimitChars: optNum(args, "bufferLimitChars")
          };
        }
        const rec = wrapper.launch(spec);
        const text = [
          `Launched: ${recordLine(rec)}`,
          `stream file: ${rec.streamFile}`,
          `read it with pw_output{id:"${rec.id}"} \xB7 follow it live with pw_follow{id:"${rec.id}"}`,
          rec.life === "starting" ? `This record is still "starting" \u2014 the spawn result had not landed yet. Re-read with pw_get{id:"${rec.id}"} to see running/exited/failed.` : ""
        ].filter(Boolean).join("\n");
        return { content: [{ type: "text", text }], structuredContent: { process: rec, outputUrl: `${ctx.endpoint}/api/processes/${rec.id}/output`, streamUrl: `${ctx.endpoint}/api/processes/${rec.id}/stream` } };
      }
    },
    {
      name: "pw_list",
      title: "List processes",
      description: "Every process this wrapper knows about, newest first, with id, name, tag, pid, life (starting|running|exited|killed|failed), exit code, captured characters, the stream file, and how long it ran. Optional filters: life and tag. Use it to find the id to read or kill \u2014 ids are what every other tool takes.",
      inputSchema: {
        type: "object",
        properties: {
          life: { type: "string", enum: ["starting", "running", "exited", "killed", "failed"], description: "Only processes in this state." },
          tag: { type: "string", description: "Only processes carrying this tag (as given at launch)." }
        },
        additionalProperties: false
      },
      annotations: { title: "List processes", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        const life = optStr(args, "life");
        const tag = optStr(args, "tag");
        if (life && !["starting", "running", "exited", "killed", "failed"].includes(life)) {
          throw new ToolError(`"life" must be one of starting, running, exited, killed, failed (got ${JSON.stringify(life)})`);
        }
        const list = wrapper.list({ life, tag });
        const text = list.length === 0 ? "No processes. Launch one with pw_launch." : list.map((p) => `${recordLine(p)}${p.exitCode !== null ? ` \xB7 exit ${p.exitCode}` : ""}${p.error ? ` \xB7 ${p.error}` : ""}`).join("\n");
        return { content: [{ type: "text", text }], structuredContent: { count: list.length, processes: list } };
      }
    },
    {
      name: "pw_get",
      title: "One process, in full",
      description: 'The full record of one process, plus its in-memory buffer status (chunks, characters per channel, and "truncated": true when the RAM buffer has shed the front of the stream \u2014 the FILE still holds everything). This is the tool to poll after pw_launch when you need the verdict on a command that might not exist.',
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: 'The process id from pw_launch or pw_list, e.g. "tick-001-0ca7".' } },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "One process, in full", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args, ctx) {
        const id = str(args, "id");
        const rec = wrapper.get(id);
        if (!rec) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const buffer = wrapper.bufferStatus(id);
        const detail = {
          process: rec,
          buffer,
          streamFile: rec.streamFile,
          outputUrl: `${ctx.endpoint}/api/processes/${id}/output`,
          streamUrl: `${ctx.endpoint}/api/processes/${id}/stream`
        };
        return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }], structuredContent: detail };
      }
    },
    {
      name: "pw_output",
      title: "A copy of the captured output",
      description: 'A copy of everything captured from one process so far, as text \u2014 the fast, bounded read. By default you get the whole life in arrival order (both channels interleaved); "from" and "limit" take a range in characters for walking a big stream in slices, and "channel" narrows it to stdout or stderr only (offsets are then counted per channel). The answer states the total characters, whether the range was complete, and whether the in-memory copy had shed its front (the file always has it all). This is a COPY: it never consumes the stream.',
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The process id to read." },
          from: { type: "number", description: 'Character offset to start the copy at (default 0). Use the "to" of a previous read to continue without repeating text.' },
          limit: { type: "number", description: "Maximum characters to return (default: everything to the end)." },
          channel: { type: "string", enum: ["both", "stdout", "stderr"], description: 'Which channel to copy (default "both", interleaved in arrival order).' }
        },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "A copy of the captured output", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        if (!wrapper.get(id)) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const channel = optionalChannel(args);
        const slice = wrapper.output(id, { from: optNum(args, "from"), limit: optNum(args, "limit"), channel: channel ?? "both" });
        const header = `copy of ${id} \xB7 channel ${slice.channel} \xB7 chars ${slice.from}..${slice.to} of ${slice.total}${slice.complete ? "" : ' \xB7 NOTE: the in-memory copy had shed the front of this channel \u2014 use a larger "from" or read the stream file'}`;
        return {
          content: [{ type: "text", text: `${header}
---
${slice.text}` }],
          structuredContent: { id, channel: slice.channel, from: slice.from, to: slice.to, total: slice.total, complete: slice.complete, text: slice.text }
        };
      }
    },
    {
      name: "pw_follow",
      title: "Follow a live stream",
      description: `Sit on a process's output and collect the new text as it arrives \u2014 for watching something that is still running. Returns as soon as ANY of these happen: the process ends, timeoutMs elapses (default 15000), or maxChars have been collected (default 100000). The answer says which of those stopped it, and gives the text you had not read yet (pass "from" = the "to" of your previous read to continue where you left off). Note this is request/response shaped: each call costs one timeoutMs window, so call it again to keep following. For an endless stream, prefer reading the raw SSE endpoint in "streamUrl".`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The process id to follow." },
          from: { type: "number", description: 'Character offset to start collecting at (default 0). Use the "to" value from your previous read/follow.' },
          channel: { type: "string", enum: ["stdout", "stderr"], description: "Collect only this channel (default: both, tagged per chunk in the text)." },
          timeoutMs: { type: "number", description: "How long to wait for new text before answering (default 15000; the call never blocks longer than this)." },
          maxChars: { type: "number", description: "Stop early once this many characters have been collected (default 100000)." }
        },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "Follow a live stream", readOnlyHint: true, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        const rec = wrapper.get(id);
        if (!rec) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const from = optNum(args, "from") ?? 0;
        const wanted = optionalChannel(args);
        const wantChannel = wanted === "both" ? void 0 : wanted;
        const timeoutMs = optNum(args, "timeoutMs") ?? 15e3;
        const maxChars = optNum(args, "maxChars") ?? 1e5;
        const startedAt = Date.now();
        let text = "";
        const outcome = { reason: "timeout" };
        let droppedChars = 0;
        await new Promise((resolve) => {
          let done = false;
          let timer = null;
          let handleRef = null;
          const finish = (why) => {
            if (done) return;
            done = true;
            outcome.reason = why;
            if (timer) clearTimeout(timer);
            if (handleRef) handleRef.close();
            resolve();
          };
          const handle = hub.open(
            id,
            {
              onData: (chunk) => {
                if (wantChannel && chunk.channel !== wantChannel) return true;
                text += chunk.text;
                if (text.length >= maxChars) finish("max-chars");
                return true;
              },
              onDrop: (info) => {
                droppedChars += info.droppedChars;
              },
              onEnd: () => finish("process-ended")
            },
            { from, channel: wantChannel }
          );
          handleRef = handle;
          if (done) handle.close();
          timer = setTimeout(() => finish("timeout"), Math.max(0, timeoutMs));
        });
        const answered = Date.now() - startedAt;
        const last = wrapper.get(id);
        const reason = outcome.reason;
        const header = [
          `${reason === "process-ended" ? "The process ended." : reason === "max-chars" ? `Collected the maxChars ceiling (${maxChars}).` : reason === "copy-closed" ? "The copy closed." : `Waited ${answered} ms with no further output.`}`,
          `${text.length} new chars from ${from}${droppedChars ? ` \xB7 NOTE: this copy shed ${droppedChars} chars under load \u2014 read the range again with pw_output` : ""}`,
          last ? `life now: ${last.life}${last.exitCode !== null ? ` \xB7 exit ${last.exitCode}` : ""}${last.error ? ` \xB7 ${last.error}` : ""}` : "",
          `continue with from=${from + text.length}`
        ].filter(Boolean).join("\n");
        return {
          content: [{ type: "text", text: `${header}
---
${text}` }],
          structuredContent: { id, reason, from, to: from + text.length, chars: text.length, droppedChars, life: last?.life ?? null, text }
        };
      }
    },
    {
      name: "pw_wait",
      title: "Wait for a process to end",
      description: 'Block until the process reaches a terminal life (exited, killed or failed) and return its final record with the exit code and duration \u2014 the tool for "run this and tell me how it went". Answers early if it has already ended. If the timeout (default 60000 ms) runs out first, the answer says so and the process keeps running; call pw_wait again to keep waiting.',
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The process id to wait for." },
          timeoutMs: { type: "number", description: "Give up waiting after this long and report the current life (default 60000)." }
        },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "Wait for a process to end", readOnlyHint: true, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        const rec = wrapper.get(id);
        if (!rec) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const timeoutMs = optNum(args, "timeoutMs") ?? 6e4;
        const startedAt = Date.now();
        const final = await wrapper.awaitExit(id, timeoutMs);
        const waited = Date.now() - startedAt;
        const terminal = final ? ["exited", "killed", "failed"].includes(final.life) : false;
        const text = final ? terminal ? `${recordLine(final)} \xB7 exit ${final.exitCode ?? "-"}${final.error ? ` \xB7 ${final.error}` : ""} \xB7 waited ${waited} ms
Read its output with pw_output{id:"${id}"}.` : `Still ${final.life} after ${waited} ms (timeoutMs was ${timeoutMs}). The process is untouched \u2014 call pw_wait again to keep waiting.` : `No process with id "${id}" any more (removed?).`;
        return { content: [{ type: "text", text }], structuredContent: { process: final, terminal, waitedMs: waited } };
      }
    },
    {
      name: "pw_input",
      title: "Write to a process stdin",
      description: `Send text to a running process's standard input \u2014 the "reply to the prompt" step after you see a question in pw_output. A trailing newline is added for you when the text does not already end with one. Fails if the child has no open stdin (it exited, or it never read stdin).`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The process id to write to." },
          text: { type: "string", description: "The text to send. A newline is appended if missing." }
        },
        required: ["id", "text"],
        additionalProperties: false
      },
      annotations: { title: "Write to a process stdin", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        const raw = str(args, "text");
        if (!wrapper.get(id)) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const payload = raw.endsWith("\n") ? raw : raw + "\n";
        const wrote = wrapper.write(id, payload);
        if (!wrote) throw new ToolError(`process "${id}" has no open stdin (it has ended, or it never read stdin)`);
        return {
          content: [{ type: "text", text: `Sent ${payload.length} chars to ${id}. Read the reply with pw_output{id:"${id}"} (or pw_follow).` }],
          structuredContent: { id, wrote: payload.length }
        };
      }
    },
    {
      name: "pw_kill",
      title: "Kill a process",
      description: 'Stop a process. Without "force" it tries the graceful signal first and waits graceMs (default 3000) before forcing a tree kill; with "force": true it goes straight to the tree kill. On Windows the tree kill is taskkill /T /F, so grandchildren die with the child. The record stays in the table (life "killed") so you can still read the output that was captured \u2014 use pw_remove to forget it entirely. Killing an already-finished process is not an error: the answer reports what it found.',
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The process id to kill." },
          force: { type: "boolean", description: "Skip the graceful wait and kill the whole tree immediately (default false)." },
          graceMs: { type: "number", description: "How long to give a graceful exit before forcing, in ms (default 3000)." }
        },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "Kill a process", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        if (!wrapper.get(id)) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const result = await wrapper.kill(id, { force: optBool(args, "force"), graceMs: optNum(args, "graceMs") });
        const text = `${id} \u2014 ${result.outcome} (pid ${result.pid ?? "-"}, requested ${result.requested}${result.forced ? ", forced" : ""})
The record and its captured text stay until you pw_remove it.`;
        return { content: [{ type: "text", text }], structuredContent: { kill: result } };
      }
    },
    {
      name: "pw_remove",
      title: "Forget a finished process",
      description: "Drop a process from the table (killing it first if it is still alive). The life FILE is kept \u2014 that is the record of what it said \u2014 so removing only forgets the id, it does not delete evidence. Fails only if the id is unknown.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The process id to forget." } },
        required: ["id"],
        additionalProperties: false
      },
      annotations: { title: "Forget a finished process", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        const id = str(args, "id");
        const before = wrapper.get(id);
        if (!before) throw new ToolError(`no process with id "${id}" \u2014 see pw_list for the ids that exist`);
        const kill = before.life === "running" || before.life === "starting" ? await wrapper.kill(id, { force: true }) : null;
        const removed = wrapper.remove(id);
        return {
          content: [{ type: "text", text: `Removed ${id}${kill ? ` (killed first: ${kill.outcome})` : ""}. Its life file stays at ${before.streamFile}.` }],
          structuredContent: { id, removed, kill, streamFile: before.streamFile }
        };
      }
    },
    {
      name: "pw_commands",
      title: "Saved commands",
      description: 'The named commands saved in data.yaml on this box \u2014 what this machine can start without retyping a command line. Launch one with pw_launch{saved:"<name>"}.',
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Saved commands", readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run() {
        const list = registry.list();
        const text = list.length === 0 ? "No saved commands yet. Save one with pw_save{name,command} \u2014 it lands in data.yaml." : list.map((c) => `${c.name}	${c.command} ${c.args.join(" ")}${c.description ? `	\u2014 ${c.description}` : ""}${c.tag ? ` [${c.tag}]` : ""}`).join("\n");
        return { content: [{ type: "text", text }], structuredContent: { count: list.length, commands: list } };
      }
    },
    {
      name: "pw_save",
      title: "Save a command",
      description: "Save a named command into data.yaml so it can be launched by name later (pw_launch{saved}). All launch options can be stored: command, args, cwd, env, shell, description and tag. Fails if the name is already taken (pw_unsave first if you mean to replace it).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: 'The name to save under, e.g. "sdxl-pull". Must be unique.' },
          command: { type: "string", description: "The executable or command line to store." },
          args: { type: "array", items: { type: "string" }, description: "Explicit argv stored with the command." },
          cwd: { type: "string", description: "Working directory to store." },
          env: { type: "object", description: "Environment variables to store." },
          shell: { type: "boolean", description: "Whether it needs a shell (default false)." },
          description: { type: "string", description: "One line saying what it is for \u2014 this is what a later agent reads." },
          tag: { type: "string", description: "Grouping label." }
        },
        required: ["name", "command"],
        additionalProperties: false
      },
      annotations: { title: "Save a command", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      async run(args) {
        const saved = registry.add({
          name: str(args, "name"),
          command: str(args, "command"),
          args: Array.isArray(args.args) ? args.args.map(String) : [],
          cwd: optStr(args, "cwd") ?? "",
          env: optObj(args, "env") ?? {},
          shell: optBool(args, "shell") ?? false,
          description: optStr(args, "description") ?? "",
          tag: optStr(args, "tag") ?? null
        });
        return {
          content: [{ type: "text", text: `Saved "${saved.name}" to data.yaml. Launch it with pw_launch{saved:"${saved.name}"}.` }],
          structuredContent: { command: saved }
        };
      }
    },
    {
      name: "pw_unsave",
      title: "Drop a saved command",
      description: "Remove a named command from data.yaml. Only the saved definition goes \u2014 anything it launched keeps running, and its life files stay. Fails if nothing is saved under that name.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "The saved command name to remove." } },
        required: ["name"],
        additionalProperties: false
      },
      annotations: { title: "Drop a saved command", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      async run(args) {
        const name = str(args, "name");
        const removed = registry.remove(name);
        if (!removed) throw new ToolError(`no saved command named "${name}" \u2014 see pw_commands for the names that exist`);
        return { content: [{ type: "text", text: `Dropped "${name}" from data.yaml.` }], structuredContent: { name, removed } };
      }
    }
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const advertise = () => tools.map(({ run, ...rest }) => {
    void run;
    return rest;
  });
  function resourceList() {
    return wrapper.list().map((p) => ({
      uri: `process-wrapper://processes/${p.id}/output`,
      name: `${p.name} (${p.id})`,
      description: `The captured text of process ${p.id} \u2014 life ${p.life}, ${p.chars.stdout + p.chars.stderr} chars, stream file ${p.streamFile}`,
      mimeType: "text/plain"
    }));
  }
  function resourceRead(uri) {
    const match = /^process-wrapper:\/\/processes\/([^/]+)\/output$/.exec(uri);
    if (!match) return null;
    const id = decodeURIComponent(match[1]);
    if (!wrapper.get(id)) return null;
    return { uri, mimeType: "text/plain", text: wrapper.output(id).text };
  }
  async function dispatch(message, ctx) {
    const id = message.id ?? null;
    const method = typeof message.method === "string" ? message.method : "";
    const params = message.params && typeof message.params === "object" ? message.params : {};
    const isNotification = message.id === void 0;
    const result = (payload) => ({ jsonrpc: "2.0", id, result: payload });
    const failure = (code, msg, data) => ({ jsonrpc: "2.0", id, error: { code, message: msg, ...data === void 0 ? {} : { data } } });
    if (isNotification) {
      if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
      return null;
    }
    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL;
        const clientInfo = params.clientInfo ?? {};
        return result({
          protocolVersion: KNOWN_PROTOCOLS.includes(asked) ? asked : protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: { name: serverName, version },
          instructions: instructions(ctx.endpoint),
          ...clientInfo.name ? { _client: clientInfo } : {}
        });
      }
      case "ping":
        return result({});
      case "tools/list":
        return result({ tools: advertise() });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const tool = byName.get(name);
        if (!tool) {
          return failure(-32602, `unknown tool "${name}"`, { available: tools.map((t) => t.name) });
        }
        const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        try {
          return result(await tool.run(args, ctx));
        } catch (err) {
          if (err instanceof ToolError) {
            return result({ content: [{ type: "text", text: `Refused: ${err.message}` }], isError: true });
          }
          return result({ content: [{ type: "text", text: `The tool failed: ${err.message}` }], isError: true });
        }
      }
      case "resources/list":
        return result({ resources: resourceList() });
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        const found = resourceRead(uri);
        if (!found) {
          return failure(-32602, `unknown resource uri "${uri}"`, { hint: "list them with resources/list" });
        }
        return result({ contents: [found] });
      }
      case "resources/templates/list":
        return result({ resourceTemplates: [{ uriTemplate: "process-wrapper://processes/{id}/output", name: "process output", description: "The captured text of one process life", mimeType: "text/plain" }] });
      case "prompts/list":
        return result({ prompts: [] });
      default:
        return failure(-32601, `method not found: ${method}`);
    }
  }
  async function handlePost(req, res) {
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      json(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32700, message: `could not read the request body: ${err.message}` } });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch (err) {
      json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: `parse error: ${err.message}` } });
      return;
    }
    const sessionId = req.headers["mcp-session-id"] ?? null;
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId);
      s.lastSeen = Date.now();
      s.calls++;
    }
    const hostHeader = typeof req.headers.host === "string" && req.headers.host ? `http://${req.headers.host}` : configuredEndpoint;
    const ctx = { sessionId, endpoint: hostHeader };
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const answers = [];
    for (const message of messages) {
      if (!message || typeof message !== "object") {
        answers.push({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request: expected a JSON-RPC object" } });
        continue;
      }
      const method = typeof message.method === "string" ? message.method : "";
      if (!method) {
        answers.push({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32600, message: 'invalid request: no "method"' } });
        continue;
      }
      const answer = await dispatch(message, ctx);
      if (answer) answers.push(answer);
      if (method === "initialize") {
        const newId = sessionId ?? `mcp-${crypto.randomBytes(8).toString("hex")}`;
        const clientInfo = message.params?.clientInfo;
        if (!sessions.has(newId)) {
          sessions.set(newId, {
            id: newId,
            client: clientInfo?.name ? `${clientInfo.name}${clientInfo.version ? " " + clientInfo.version : ""}` : null,
            protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : null,
            startedAt: Date.now(),
            lastSeen: Date.now(),
            calls: 1
          });
        }
        res.setHeader("mcp-session-id", newId);
      }
    }
    if (answers.length === 0) {
      res.writeHead(202, { "content-length": 0 });
      res.end();
      return;
    }
    const wantsFrames = String(req.headers.accept ?? "").includes("text/event-stream") && !String(req.headers.accept ?? "").includes("application/json");
    if (wantsFrames) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" });
      for (const answer of answers) sse(res, answer);
      res.end();
      return;
    }
    const payload = Array.isArray(parsed) ? answers : answers[0];
    json(res, 200, payload);
  }
  const handler = async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type, mcp-session-id, x-pw-token");
    res.setHeader("access-control-allow-methods", "POST, GET, DELETE, OPTIONS");
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (method === "POST") return handlePost(req, res);
    if (method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] ?? null;
      const closed = sessionId ? sessions.delete(sessionId) : false;
      json(res, 200, { closed, sessionId });
      return;
    }
    if (method === "GET") {
      const ep = typeof req.headers.host === "string" && req.headers.host ? `http://${req.headers.host}` : configuredEndpoint;
      json(res, 405, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: `this MCP endpoint answers POST only \u2014 send JSON-RPC to it (initialize, then tools/list, then tools/call). For a live process stream use the SSE endpoint in the API instead: ${ep}/api/processes/<id>/stream`
        }
      }, { allow: "POST, DELETE, OPTIONS" });
      return;
    }
    json(res, 405, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `${method} is not supported by this MCP endpoint (use POST)` } }, { allow: "POST, DELETE, OPTIONS" });
  };
  const callTool = async (name, args = {}, ctx) => {
    const tool = byName.get(name);
    if (!tool) {
      throw new ToolError(`unknown tool "${name}" \u2014 available: ${tools.map((t) => t.name).join(", ")}`);
    }
    return tool.run(args, ctx ?? { sessionId: null, endpoint: configuredEndpoint });
  };
  return {
    handle: handler,
    tools: advertise,
    sessions: () => Array.from(sessions.values()),
    call: callTool,
    close: () => sessions.clear()
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createWrapper } = await import("./processWrapper.js");
  const { createStreamHub } = await import("./streamHub.js");
  const { defaultRegistry, addCommand, removeCommand, getCommand, loadRegistry, saveRegistry } = await import("./registryStore.js");
  void loadRegistry;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-mcp-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 300 });
  const hub = createStreamHub(wrapper);
  const registryFile = path.join(dir, "data.yaml");
  const state = defaultRegistry();
  const registry = {
    list: () => state.commands,
    find: (name) => getCommand(state, name),
    add: (def) => {
      const saved = addCommand(state, def);
      saveRegistry(registryFile, state);
      return saved;
    },
    remove: (name) => {
      const removed = removeCommand(state, name);
      if (removed) saveRegistry(registryFile, state);
      return removed;
    }
  };
  const mcp = createMcpServer({ wrapper, hub, registry, endpoint: "http://127.0.0.1:0" });
  const http = await import("node:http");
  const httpServer = http.createServer((req, res) => {
    mcp.handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let sessionId = null;
  const rpc = async (method, params = {}, id = 1, headers = {}) => {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...sessionId ? { "mcp-session-id": sessionId } : {}, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
    });
    const captured = res.headers.get("mcp-session-id");
    if (captured) sessionId = captured;
    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text || "{}");
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  };
  const callTool = async (name, args = {}, id = 9) => {
    const res = await rpc("tools/call", { name, arguments: args }, id);
    const result = res.body.result;
    return { status: res.status, text: result?.content?.[0]?.text ?? "", isError: result?.isError === true, structured: result?.structuredContent };
  };
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "selftest", version: "1" } });
    const initResult = init.body.result;
    ok("initialize answers", init.status === 200 && !!initResult, String(init.status));
    ok("initialize echoes a known protocol version", initResult?.protocolVersion === "2025-06-18", String(initResult?.protocolVersion));
    ok("initialize declares the tools capability", !!initResult?.capabilities?.tools, JSON.stringify(initResult?.capabilities));
    ok("initialize names the server", initResult?.serverInfo?.name === "process-wrapper", JSON.stringify(initResult?.serverInfo));
    ok("initialize carries self-explanatory instructions", (initResult?.instructions ?? "").length > 500, String((initResult?.instructions ?? "").length));
    ok("the instructions explain the laws", (initResult?.instructions ?? "").includes("ONE LIFE = ONE FILE"));
    ok("the instructions say how to choose a tool", (initResult?.instructions ?? "").includes("pw_launch") && (initResult?.instructions ?? "").includes("pw_follow"));
    ok("a session id is issued", !!sessionId && String(init.headers.get("mcp-session-id") ?? "").startsWith("mcp-"), String(sessionId));
    const ack = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "mcp-session-id": String(sessionId) },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    ok("initialized is answered with 202 and no body", ack.status === 202 && await ack.text() === "", String(ack.status));
    ok("the session is on the books", mcp.sessions().some((s) => s.id === sessionId && s.client?.startsWith("selftest")), JSON.stringify(mcp.sessions()));
    const list = await rpc("tools/list");
    const tools = list.body.result?.tools ?? [];
    ok("tools/list answers", list.status === 200 && tools.length >= 13, String(tools.length));
    const names = tools.map((t) => t.name);
    const expected = ["pw_health", "pw_launch", "pw_list", "pw_get", "pw_output", "pw_follow", "pw_wait", "pw_input", "pw_kill", "pw_remove", "pw_commands", "pw_save", "pw_unsave"];
    ok("every capability is advertised", expected.every((n) => names.includes(n)), names.join(","));
    ok("every tool has a description worth reading", tools.every((t) => (t.description ?? "").length > 80), tools.filter((t) => (t.description ?? "").length <= 80).map((t) => t.name).join(","));
    ok("every tool had its description written for an agent (not a stub)", tools.every((t) => !/^TODO|^TBD|^\\s*$/.test(t.description ?? "")));
    const props = tools.flatMap((t) => Object.values(t.inputSchema?.properties ?? {}));
    ok("every input property is described", props.every((p) => typeof p.description === "string" && p.description.length > 10), String(props.filter((p) => !p.description).length));
    ok("launch advertises every option", (() => {
      const launch = tools.find((t) => t.name === "pw_launch");
      const keys = Object.keys(launch?.inputSchema?.properties ?? {});
      return ["command", "saved", "args", "cwd", "env", "name", "tag", "shell", "bufferLimitChars"].every((k) => keys.includes(k));
    })());
    ok("output advertises range and channel", (() => {
      const tool = tools.find((t) => t.name === "pw_output");
      const keys = Object.keys(tool?.inputSchema?.properties ?? {});
      return ["id", "from", "limit", "channel"].every((k) => keys.includes(k));
    })());
    ok("kill advertises force and grace", (() => {
      const tool = tools.find((t) => t.name === "pw_kill");
      const keys = Object.keys(tool?.inputSchema?.properties ?? {});
      return ["id", "force", "graceMs"].every((k) => keys.includes(k));
    })());
    ok("the schema marks required fields", (tools.find((t) => t.name === "pw_kill")?.inputSchema.required ?? []).includes("id"));
    const health = await callTool("pw_health");
    ok("pw_health answers", health.status === 200 && health.text.includes("processWrapper"), health.text.slice(0, 80));
    const launched = await callTool("pw_launch", {
      name: "mcp-echo",
      command: process.execPath,
      args: ["-e", "console.log('mcp-1');setTimeout(()=>console.error('mcp-err'),80);setTimeout(()=>console.log('mcp-2'),160)"],
      tag: "selftest"
    });
    const rec = launched.structured?.process;
    ok("pw_launch starts it and reports the id", !!rec?.id && rec.life !== void 0, JSON.stringify(launched.structured).slice(0, 120));
    const id = rec?.id;
    ok("pw_launch names the stream file", !!rec?.streamFile, String(rec?.streamFile));
    const waited = await callTool("pw_wait", { id, timeoutMs: 2e4 });
    const finalRec = waited.structured;
    ok("pw_wait returns the terminal life", finalRec?.terminal === true && finalRec?.process?.life === "exited", JSON.stringify(finalRec?.process?.life));
    ok("pw_wait reports the exit code", finalRec?.process?.exitCode === 0, String(finalRec?.process?.exitCode));
    const copy = await callTool("pw_output", { id });
    ok("pw_output returns the whole life as text", copy.text.includes("mcp-1") && copy.text.includes("mcp-2") && copy.text.includes("mcp-err"), copy.text.slice(-120));
    const ranged = await callTool("pw_output", { id, from: 6, limit: 5 });
    ok("pw_output honours from+limit", ranged.structured?.from === 6 && ranged.structured?.to === 11, JSON.stringify(ranged.structured).slice(0, 100));
    const errOnly = await callTool("pw_output", { id, channel: "stderr" });
    ok("pw_output can narrow to one channel", errOnly.text.includes("mcp-err") && !errOnly.text.includes("mcp-1"), errOnly.text.slice(-80));
    const got = await callTool("pw_get", { id });
    ok("pw_get carries the buffer status", got.text.includes("buffer") && got.text.includes("streamFile"), got.text.slice(0, 80));
    const listed = await callTool("pw_list", { life: "exited" });
    ok("pw_list filters by life", listed.text.includes(id), listed.text.slice(0, 80));
    const tagged = await callTool("pw_list", { tag: "selftest" });
    ok("pw_list filters by tag", tagged.text.includes(id), tagged.text.slice(0, 80));
    const live = await callTool("pw_launch", {
      name: "mcp-live",
      command: process.execPath,
      args: ["-e", "console.log('up');process.stdin.on('data',d=>console.log('in:'+d.toString().trim()));let n=0;setInterval(()=>console.log('tick'+(++n)),250)"]
    });
    const liveId = live.structured?.process?.id;
    await sleep(600);
    const followed = await callTool("pw_follow", { id: liveId, from: 0, timeoutMs: 1200 });
    const followMeta = followed.structured;
    ok("pw_follow collects live text", (followMeta.chars ?? 0) > 0 && followed.text.includes("tick1"), followed.text.slice(0, 120));
    ok("pw_follow says why it stopped", followMeta.reason === "timeout", String(followMeta.reason));
    ok("pw_follow tells you where to continue", followed.text.includes(`from=${followMeta.to}`), followed.text.slice(-80));
    const fed = await callTool("pw_input", { id: liveId, text: "hello-agent" });
    ok("pw_input is accepted", fed.status === 200 && !fed.isError, fed.text);
    await sleep(400);
    const afterFeed = await callTool("pw_output", { id: liveId });
    ok("the child received the stdin from the tool", afterFeed.text.includes("in:hello-agent"), afterFeed.text.slice(-120));
    const killed = await callTool("pw_kill", { id: liveId, force: true });
    ok("pw_kill kills it", killed.structured?.kill?.outcome === "killed", JSON.stringify(killed.structured));
    const killedRecord = await callTool("pw_get", { id: liveId });
    ok("the killed record keeps its captured text", killedRecord.text.includes('"life": "killed"'), killedRecord.text.slice(0, 120));
    const killedTwice = await callTool("pw_kill", { id: liveId });
    ok("killing a finished process is not an error", !killedTwice.isError && killedTwice.text.includes("killed"), killedTwice.text.slice(0, 80));
    const saved = await callTool("pw_save", { name: "mcp-saved", command: process.execPath, args: ["-e", "console.log('saved-by-an-agent')"], description: "saved through MCP" });
    ok("pw_save stores it", !saved.isError && saved.text.includes("mcp-saved"), saved.text);
    ok("data.yaml really got it", fs.readFileSync(registryFile, "utf8").includes("mcp-saved"));
    const cmds = await callTool("pw_commands");
    ok("pw_commands lists it", cmds.text.includes("mcp-saved"), cmds.text.slice(0, 100));
    const byName = await callTool("pw_launch", { saved: "mcp-saved" });
    const byNameId = byName.structured?.process?.id;
    ok("pw_launch launches a saved command by name", byName.structured?.process?.name === "mcp-saved", JSON.stringify(byName.structured).slice(0, 120));
    await callTool("pw_wait", { id: byNameId, timeoutMs: 2e4 });
    const savedOut = await callTool("pw_output", { id: byNameId });
    ok("the saved command really ran", savedOut.text.includes("saved-by-an-agent"), savedOut.text.slice(-80));
    const unsaved = await callTool("pw_unsave", { name: "mcp-saved" });
    ok("pw_unsave drops it", !unsaved.isError && unsaved.text.includes("Dropped"), unsaved.text);
    ok("data.yaml no longer has it", !fs.readFileSync(registryFile, "utf8").includes("mcp-saved"));
    const noId = await callTool("pw_output", {});
    ok("a missing required argument is refused clearly", noId.isError === true && noId.text.includes('"id" is required'), noId.text);
    const ghost = await callTool("pw_output", { id: "nope" });
    ok("an unknown id is refused with the way out", ghost.isError === true && ghost.text.includes("pw_list"), ghost.text);
    const badLife = await callTool("pw_list", { life: "sideways" });
    ok("a bad enum value is refused", badLife.isError === true && badLife.text.includes('"life" must be one of'), badLife.text.slice(0, 90));
    const badChannel = await callTool("pw_output", { id, channel: "stdoutt" });
    ok("a bad channel is refused", badChannel.isError === true && badChannel.text.includes('"channel" must be one of'), badChannel.text.slice(0, 90));
    const missingSaved = await callTool("pw_launch", { saved: "never-saved" });
    ok("an unknown saved name is refused and lists what exists", missingSaved.isError === true && missingSaved.text.includes("Saved:"), missingSaved.text.slice(0, 120));
    const dupName = await callTool("pw_save", { name: "mcp-saved2", command: "x" });
    const dupName2 = await callTool("pw_save", { name: "mcp-saved2", command: "y" });
    ok("a duplicate saved name is refused", dupName2.isError === true && dupName2.text.includes("already exists"), dupName2.text);
    await callTool("pw_unsave", { name: "mcp-saved2" });
    void dupName;
    const unknownTool = await rpc("tools/call", { name: "pw_teleport", arguments: {} });
    ok("an unknown tool is a protocol error with the list", unknownTool.status === 200 && unknownTool.body.error?.code === -32602, JSON.stringify(unknownTool.body).slice(0, 120));
    const unknownMethod = await rpc("does/not/exist");
    ok("an unknown method is -32601", unknownMethod.body.error?.code === -32601, JSON.stringify(unknownMethod.body).slice(0, 100));
    const badJson = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" });
    ok("a broken body is a parse error", badJson.status === 400 && (await badJson.json()).error.code === -32700, String(badJson.status));
    const resources = await rpc("resources/list");
    const resList = resources.body.result?.resources ?? [];
    ok("resources list the process lives", resList.some((r) => r.uri.includes(id)), JSON.stringify(resList.map((r) => r.uri)).slice(0, 120));
    const read = await rpc("resources/read", { uri: `process-wrapper://processes/${id}/output` });
    const readText = (read.body.result?.contents ?? [])[0]?.text ?? "";
    ok("a resource read returns the captured text", readText.includes("mcp-1"), readText.slice(0, 60));
    const readMissing = await rpc("resources/read", { uri: "process-wrapper://processes/nope/output" });
    ok("an unknown resource uri is refused", readMissing.body.error?.code === -32602);
    const ping = await rpc("ping");
    ok("ping answers with an empty result", JSON.stringify(ping.body.result) === "{}", JSON.stringify(ping.body).slice(0, 80));
    const batch = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", id: "b", method: "tools/list" }])
    });
    const batchBody = await batch.json();
    ok("a batch is answered in order", Array.isArray(batchBody) && batchBody.length === 2 && batchBody[0].id === "a" && batchBody[1].id === "b", JSON.stringify(batchBody).slice(0, 100));
    const frames = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })
    });
    const frameText = await frames.text();
    ok("an SSE-accepting client gets frames", (frames.headers.get("content-type") || "").startsWith("text/event-stream") && frameText.startsWith("event: message"), frameText.slice(0, 60));
    const getRes = await fetch(base, { method: "GET" });
    const getBody = await getRes.json();
    ok("GET is 405 with an explanation", getRes.status === 405 && (getBody.error?.message ?? "").includes("POST"), String(getRes.status));
    ok("the explanation points at the SSE alternative", (getBody.error?.message ?? "").includes("/stream"), getBody.error?.message ?? "");
    const delRes = await fetch(base, { method: "DELETE", headers: { "mcp-session-id": String(sessionId) } });
    ok("DELETE closes the session", delRes.status === 200 && (await delRes.json()).closed === true, String(delRes.status));
    ok("the session is gone from the books", !mcp.sessions().some((s) => s.id === sessionId));
    const removed = await callTool("pw_remove", { id: byNameId });
    ok("pw_remove forgets it", !removed.isError && removed.text.includes("Removed"), removed.text);
    ok("the life file outlives removal", fs.existsSync(String(removed.structured.streamFile)), String(removed.structured.streamFile));
    const goneRes = await callTool("pw_get", { id: byNameId });
    ok("a removed id is refused afterwards", goneRes.isError === true, goneRes.text.slice(0, 80));
    ok("nothing is left running", wrapper.list({ life: "running" }).length === 0, JSON.stringify(wrapper.list({ life: "running" }).length));
  } finally {
    mcp.close();
    await wrapper.shutdown().catch(() => {
    });
    await new Promise((resolve) => httpServer.close(() => resolve()));
    httpServer.closeAllConnections?.();
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[mcpServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ToolError,
  createMcpServer,
  runTests
};
//# sourceMappingURL=mcpServer.js.map
