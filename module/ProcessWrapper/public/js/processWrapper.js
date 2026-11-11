import { spawn, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
function parseCommand(command) {
  const argv = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " " || ch === "	") {
      if (started || cur.length) {
        argv.push(cur);
        cur = "";
        started = false;
      }
      continue;
    }
    cur += ch;
  }
  if (started || cur.length) argv.push(cur);
  return argv;
}
function sameExe(p) {
  return String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function pidAlive(pid) {
  try {
    if (process.platform === "win32") {
      const out2 = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8", windowsHide: true });
      return out2.includes(String(pid));
    }
    const out = execFileSync("ps", ["-p", String(pid), "-o", "pid="], { encoding: "utf8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}
function makeId(name, seq) {
  const slug = name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18);
  return `${slug || "proc"}-${String(seq).padStart(3, "0")}-${crypto.randomBytes(2).toString("hex")}`;
}
class ProcessWrapperService extends EventEmitter {
  streamDir;
  bufferLimitChars;
  graceMs;
  killTree;
  seq = 0;
  table = /* @__PURE__ */ new Map();
  children = /* @__PURE__ */ new Map();
  buffers = /* @__PURE__ */ new Map();
  tails = /* @__PURE__ */ new Map();
  killed = /* @__PURE__ */ new Set();
  subs = /* @__PURE__ */ new Map();
  closed = false;
  constructor(options = {}) {
    super();
    this.streamDir = options.streamDir || path.join(process.cwd(), "data", "streams");
    this.bufferLimitChars = options.bufferLimitChars ?? 4e6;
    this.graceMs = options.graceMs ?? 3e3;
    this.killTree = options.killTree ?? true;
    fs.mkdirSync(this.streamDir, { recursive: true });
  }
  /**
   * Take responsibility for a process this wrapper did NOT start.
   *
   * A process manager that only knows its own children is a launcher, not a manager: the miner arrives through
   * schtasks, so it is invisible in the Processes tab and has no stop button, which is exactly the "nothing runs
   * invisibly" rule broken by omission. Adoption is honest about its limits - there is no pipe to a process that is
   * already running, so its output starts empty and the record says so - and it ends when the pid ends.
   */
  adopt(spec) {
    if (this.closed) throw new Error("wrapper is shut down");
    const pid = Number(spec.pid);
    if (!Number.isFinite(pid) || pid <= 0) throw new Error("pid is required");
    for (const rec of this.table.values()) {
      if (rec.pid === pid && (rec.life === "running" || rec.life === "starting")) return rec;
    }
    const id = makeId(spec.name || `pid-${pid}`, ++this.seq);
    const streamFile = path.join(this.streamDir, `${id}.log`);
    fs.writeFileSync(streamFile, "");
    const record = {
      id,
      name: spec.name || `pid ${pid}`,
      tag: spec.tag ?? null,
      // adoption has no pipe to read from, so nothing of this process's output can ever reach the control loop
      isolation: "supervised",
      command: spec.command || `pid ${pid}`,
      args: spec.args ? spec.args.map(String) : [],
      cwd: spec.cwd || "",
      shell: false,
      pid,
      life: "running",
      spawnedAt: Number.isFinite(Number(spec.startedAt)) ? Number(spec.startedAt) : Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      chars: { stdout: 0, stderr: 0 },
      truncated: false,
      streamFile,
      error: null
    };
    this.table.set(id, record);
    this.buffers.set(id, { chunks: [], chars: { stdout: 0, stderr: 0 } });
    this.tails.set(id, { stdout: "", stderr: "" });
    this.subs.set(id, /* @__PURE__ */ new Set());
    this.watchAdopted(record);
    return record;
  }
  /** Poll an adopted pid until it dies, then settle its record the way a spawned child's exit would. */
  watchAdopted(record) {
    const timer = setInterval(() => {
      const pid = record.pid;
      if (!pid || record.life !== "running") {
        clearInterval(timer);
        return;
      }
      if (!pidAlive(pid)) {
        clearInterval(timer);
        record.life = this.killed.has(record.id) ? "killed" : "exited";
        record.endedAt = Date.now();
        for (const sink of this.subs.get(record.id) ?? []) {
          try {
            sink("end");
          } catch {
          }
        }
      }
    }, 2e3);
    timer.unref?.();
  }
  launch(spec) {
    if (this.closed) throw new Error("wrapper is shut down");
    if (!spec || !spec.command || !String(spec.command).trim()) throw new Error("command is required");
    if (spec.allowDuplicate !== true) {
      const dup = this.findDuplicate(spec);
      if (dup) return dup;
    }
    const id = makeId(spec.name || spec.command, ++this.seq);
    const argv = spec.args && spec.args.length ? [spec.command, ...spec.args.map(String)] : parseCommand(spec.command);
    if (!argv.length) throw new Error("command is required");
    const exe = argv[0];
    const args = argv.slice(1);
    const cwd = spec.cwd ? path.resolve(spec.cwd) : process.cwd();
    const shell = spec.shell === true;
    const streamFile = path.join(this.streamDir, `${id}.log`);
    fs.writeFileSync(streamFile, "");
    const record = {
      id,
      name: spec.name || spec.command,
      tag: spec.tag ?? null,
      isolation: spec.isolation === "supervised" ? "supervised" : "in-loop",
      command: exe,
      args,
      cwd,
      shell,
      pid: null,
      life: "starting",
      spawnedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      chars: { stdout: 0, stderr: 0 },
      truncated: false,
      streamFile,
      error: null
    };
    this.table.set(id, record);
    this.buffers.set(id, { chunks: [], chars: { stdout: 0, stderr: 0 } });
    this.tails.set(id, { stdout: "", stderr: "" });
    this.subs.set(id, /* @__PURE__ */ new Set());
    const limit = spec.bufferLimitChars ?? this.bufferLimitChars;
    let child;
    try {
      child = spawn(exe, args, {
        cwd,
        shell,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
        // windowsHide hides the CHILD's console window. That is right for a node door
        // (we serve a page, not a console) and WRONG for a GUI-subsystem app like
        // Electron, whose console IS the application — hidden means never seen. So it is
        // a per-launch decision now: hideWindow defaults to true, and a console display
        // that is meant to be SEEN sets it false.
        windowsHide: spec.hideWindow !== false,
        // 'supervised' means this door holds a HANDLE, not a pipe: no stdout is read here, so nothing a chatty
        // process writes is billed to the loop that answers the API and the stop button. It is detached from this
        // door's lifetime on purpose - a miner outliving a restart is a thing the operator can see, not a leak.
        stdio: spec.isolation === "supervised" ? ["ignore", "ignore", "ignore"] : ["pipe", "pipe", "pipe"],
        detached: spec.isolation === "supervised"
      });
    } catch (err) {
      this.fail(id, err.message);
      return record;
    }
    this.children.set(id, child);
    child.on("error", (err) => this.fail(id, err.message));
    child.on("spawn", () => {
      record.pid = child.pid ?? null;
      if (record.life === "starting") record.life = "running";
    });
    if (child.pid) {
      record.pid = child.pid;
      record.life = "running";
    }
    const capture = (channel) => (data) => {
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (!text) return;
      this.capture(id, channel, text, limit);
    };
    if (child.stdout) child.stdout.on("data", capture("stdout"));
    if (child.stderr) child.stderr.on("data", capture("stderr"));
    child.on("exit", (code, signal) => this.finish(id, code, signal));
    child.on("close", (code, signal) => this.finish(id, code, signal));
    if (record.isolation === "supervised") {
      child.unref();
      this.watchAdopted(record);
    }
    this.emit("spawn", record);
    return record;
  }
  /** Every process the table knows about, newest first. */
  list(filter = {}) {
    const out = [];
    for (const rec of this.table.values()) {
      if (filter.life && rec.life !== filter.life) continue;
      if (filter.tag && rec.tag !== filter.tag) continue;
      out.push({ ...rec, chars: { ...rec.chars } });
    }
    return out.sort((a, b) => b.spawnedAt - a.spawnedAt);
  }
  /**
   * The life that is ALREADY doing this work, or null.
   *
   * Two requests are the same work when they name the same thing - same `name` - or when they resolve to the same
   * exe, the same argv and the same directory. Matching on the name alone is not enough (an unnamed launch of the same
   * exe twice is the same job) and matching on the command alone is not enough either (one exe can serve two roles).
   * `ignoreId` skips one life, so replacing a row never matches the row being replaced.
   */
  findDuplicate(spec, ignoreId) {
    if (!spec || !spec.command || !String(spec.command).trim()) return null;
    const argv = spec.args && spec.args.length ? [spec.command, ...spec.args.map(String)] : parseCommand(spec.command);
    if (!argv.length) return null;
    const exe = sameExe(argv[0]);
    const argsKey = argv.slice(1).join("\0");
    const cwd = spec.cwd ? path.resolve(spec.cwd) : process.cwd();
    const wantName = String(spec.name ?? "").trim().toLowerCase();
    for (const rec of this.table.values()) {
      if (ignoreId && rec.id === ignoreId) continue;
      if (rec.life !== "starting" && rec.life !== "running") continue;
      const sameName = !!wantName && rec.name.trim().toLowerCase() === wantName;
      const sameWork = sameExe(rec.command) === exe && rec.args.join("\0") === argsKey && path.resolve(rec.cwd) === cwd;
      if (sameName || sameWork) return { ...rec, chars: { ...rec.chars } };
    }
    return null;
  }
  /** One record, or null. */
  get(id) {
    const rec = this.table.get(id);
    return rec ? { ...rec, chars: { ...rec.chars } } : null;
  }
  /** Wait for a life to end (or for the timeout) and return the final record. */
  awaitExit(id, timeoutMs = 3e4) {
    const rec = this.table.get(id);
    if (!rec) return Promise.resolve(null);
    if (rec.life === "exited" || rec.life === "killed" || rec.life === "failed") {
      return Promise.resolve(this.get(id));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off("exit", onExit);
        resolve(this.get(id));
      }, timeoutMs);
      const onExit = (ended) => {
        if (ended.id !== id) return;
        clearTimeout(timer);
        this.off("exit", onExit);
        resolve(this.get(id));
      };
      this.on("exit", onExit);
    });
  }
  /**
   * A copy of the captured text — whole, or a range, or one channel.
   * `both` reads the life file (whole by construction). A single channel is rebuilt from
   * the live buffer: offsets are channel-cumulative, and `complete` is false when the
   * buffer's ceiling already shed the front of that channel (the file still has it).
   */
  output(id, opts = {}) {
    const rec = this.table.get(id);
    if (!rec) throw new Error(`unknown process: ${id}`);
    const channel = opts.channel ?? "both";
    const from = Math.max(0, opts.from ?? 0);
    if (channel === "both") {
      const whole = this.readFile(id);
      const total2 = whole.length;
      let text2 = whole.slice(from);
      if (opts.limit != null && opts.limit >= 0) text2 = text2.slice(0, opts.limit);
      return { id, channel, from, to: from + text2.length, total: total2, text: text2, complete: true };
    }
    const buffered = this.channelText(id, channel);
    const total = rec.chars[channel];
    const dropped = Math.max(0, total - buffered.length);
    const complete = from >= dropped;
    let text = complete ? buffered.slice(from - dropped) : buffered;
    if (opts.limit != null && opts.limit >= 0) text = text.slice(0, opts.limit);
    return { id, channel, from, to: from + text.length, total, text, complete };
  }
  /** Subscribe to a live copy of a process's output. Returns the unsubscribe. */
  subscribe(id, sink, opts = {}) {
    const rec = this.table.get(id);
    if (!rec) throw new Error(`unknown process: ${id}`);
    const set = this.subs.get(id) ?? /* @__PURE__ */ new Set();
    this.subs.set(id, set);
    const startFrom = Math.max(0, opts.from ?? 0);
    const offsetOf = (chunk) => opts.channel ? chunk.from : chunk.fileFrom;
    let delivered = startFrom;
    const deliver = (chunk) => {
      if (chunk === "end") {
        sink("end");
        return;
      }
      if (opts.channel && chunk.channel !== opts.channel) return;
      const start = offsetOf(chunk);
      const end = start + chunk.text.length;
      if (end <= delivered) return;
      const skip = Math.max(0, delivered - start);
      delivered = end;
      sink(skip > 0 ? { ...chunk, text: chunk.text.slice(skip) } : chunk);
    };
    if (opts.replay !== false) {
      const buffered = this.buffers.get(id);
      for (const chunk of buffered ? buffered.chunks : []) deliver(chunk);
    }
    if (rec.life === "exited" || rec.life === "killed" || rec.life === "failed") {
      sink("end");
      return () => {
      };
    }
    set.add(deliver);
    return () => {
      set.delete(deliver);
    };
  }
  /** Write to the process's stdin. Returns false when stdin is gone. */
  write(id, text) {
    const child = this.children.get(id);
    if (!child || !child.stdin || child.stdin.destroyed) return false;
    child.stdin.write(text);
    return true;
  }
  /** End the process's stdin (a clean shutdown for stdin-driven children). */
  closeStdin(id) {
    const child = this.children.get(id);
    if (!child || !child.stdin || child.stdin.destroyed) return false;
    child.stdin.end();
    return true;
  }
  /** Kill a process — graceful signal first, force tree kill after the grace window. */
  async kill(id, opts = {}) {
    const rec = this.table.get(id);
    if (!rec) throw new Error(`unknown process: ${id}`);
    const child = this.children.get(id);
    const force = opts.force === true;
    const grace = opts.graceMs ?? this.graceMs;
    if (!child && rec.pid && rec.life === "running") {
      this.killed.add(id);
      const pid2 = rec.pid;
      this.forceKill(pid2);
      const deadline = Date.now() + Math.max(grace, 1500);
      while (Date.now() < deadline && pidAlive(pid2)) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const gone = !pidAlive(pid2);
      if (gone) {
        rec.life = "killed";
        rec.endedAt = Date.now();
      }
      return {
        id,
        pid: pid2,
        requested: force ? "force" : "graceful",
        outcome: rec.life,
        exitCode: null,
        signal: force ? "SIGKILL" : "SIGTERM",
        forced: true
      };
    }
    if (!child || rec.life === "exited" || rec.life === "killed" || rec.life === "failed") {
      return {
        id,
        pid: rec.pid,
        requested: force ? "force" : "graceful",
        outcome: rec.life,
        exitCode: rec.exitCode,
        signal: rec.signal,
        forced: false
      };
    }
    this.killed.add(id);
    const pid = rec.pid;
    let forced = false;
    try {
      child.kill(force ? void 0 : "SIGTERM");
    } catch {
    }
    if (!force) {
      const ended = await this.raceExit(id, grace);
      if (!ended) {
        forced = true;
        this.forceKill(pid);
      }
    } else {
      forced = true;
      this.forceKill(pid);
    }
    if (forced) await this.raceExit(id, 5e3);
    const after = this.get(id);
    const result = {
      id,
      pid,
      requested: force ? "force" : "graceful",
      outcome: after ? after.life : "killed",
      exitCode: after ? after.exitCode : null,
      signal: after ? after.signal : null,
      forced
    };
    this.emit("kill", result);
    return result;
  }
  /** Kill everything still alive. */
  async shutdown(force = true) {
    this.closed = true;
    const live = this.list({ life: "running" }).concat(this.list({ life: "starting" }));
    const out = [];
    for (const rec of live) {
      try {
        out.push(await this.kill(rec.id, { force, graceMs: 1e3 }));
      } catch {
      }
    }
    return out;
  }
  /** Drop a record from the table. The life file stays until an operator deletes it. */
  remove(id) {
    const rec = this.table.get(id);
    if (!rec) return false;
    if (rec.life === "running" || rec.life === "starting") {
      throw new Error(`process ${id} is still ${rec.life} \u2014 kill it before removing`);
    }
    this.table.delete(id);
    this.children.delete(id);
    this.buffers.delete(id);
    this.tails.delete(id);
    this.subs.delete(id);
    this.killed.delete(id);
    this.emit("removed", { id });
    return true;
  }
  /** The live RAM footprint of one process's capture (characters, per channel). */
  bufferStatus(id) {
    const buf = this.buffers.get(id);
    const rec = this.table.get(id);
    return {
      chunks: buf ? buf.chunks.length : 0,
      chars: buf ? { ...buf.chars } : { stdout: 0, stderr: 0 },
      truncated: rec ? rec.truncated : false
    };
  }
  // --- internals ---
  capture(id, channel, text, limit) {
    const rec = this.table.get(id);
    const buf = this.buffers.get(id);
    if (!rec || !buf) return;
    const channelFrom = buf.chars[channel];
    const chunk = {
      seq: buf.chunks.length,
      channel,
      text,
      at: Date.now(),
      from: channelFrom,
      fileFrom: rec.chars.stdout + rec.chars.stderr
    };
    buf.chunks.push(chunk);
    buf.chars[channel] = channelFrom + text.length;
    rec.chars[channel] += text.length;
    try {
      fs.appendFileSync(rec.streamFile, text);
    } catch (err) {
      this.emit("process-error", { id, error: `capture write failed: ${err.message}` });
    }
    let size = buf.chars.stdout + buf.chars.stderr;
    while (size > limit && buf.chunks.length > 1) {
      const dropped = buf.chunks.shift();
      size -= dropped.text.length;
      buf.chars[dropped.channel] -= dropped.text.length;
      rec.truncated = true;
    }
    if (size > limit && buf.chunks.length === 1 && buf.chunks[0].text.length > limit) {
      rec.truncated = true;
    }
    this.emit("chunk", { id, chunk });
    const tail = this.tails.get(id);
    if (tail) {
      let rest = tail[channel] + text;
      let idx = rest.indexOf("\n");
      while (idx >= 0) {
        const line = rest.slice(0, idx).replace(/\r$/, "");
        rest = rest.slice(idx + 1);
        this.emit("line", { id, channel, line, at: Date.now() });
        idx = rest.indexOf("\n");
      }
      tail[channel] = rest;
    }
    const set = this.subs.get(id);
    if (set) for (const sink of Array.from(set)) sink(chunk);
  }
  finish(id, code, signal) {
    const rec = this.table.get(id);
    if (!rec) return;
    if (rec.life === "exited" || rec.life === "killed" || rec.life === "failed") return;
    rec.endedAt = Date.now();
    rec.exitCode = code;
    rec.signal = signal;
    if (this.killed.has(id)) rec.life = "killed";
    else if (code === 0) rec.life = "exited";
    else {
      rec.life = "failed";
      rec.error = `exit code ${code}${signal ? ` (signal ${signal})` : ""}`;
    }
    const tail = this.tails.get(id);
    if (tail) {
      for (const channel of ["stdout", "stderr"]) {
        if (tail[channel]) {
          this.emit("line", { id, channel, line: tail[channel], at: Date.now() });
          tail[channel] = "";
        }
      }
    }
    const set = this.subs.get(id);
    if (set) {
      for (const sink of Array.from(set)) sink("end");
      set.clear();
    }
    this.children.delete(id);
    this.emit("exit", rec);
  }
  fail(id, error) {
    const rec = this.table.get(id);
    if (!rec) return;
    if (rec.life === "exited" || rec.life === "killed" || rec.life === "failed") return;
    rec.life = "failed";
    rec.error = error;
    rec.endedAt = Date.now();
    const set = this.subs.get(id);
    if (set) {
      for (const sink of Array.from(set)) sink("end");
      set.clear();
    }
    this.children.delete(id);
    this.emit("process-error", { id, error });
    this.emit("exit", rec);
  }
  forceKill(pid) {
    if (!pid) return;
    try {
      if (process.platform === "win32" && this.killTree) {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch {
    }
  }
  raceExit(id, ms) {
    const rec = this.table.get(id);
    if (rec && (rec.life === "exited" || rec.life === "killed" || rec.life === "failed")) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off("exit", onExit);
        resolve(false);
      }, ms);
      const onExit = (ended) => {
        if (ended.id !== id) return;
        clearTimeout(timer);
        this.off("exit", onExit);
        resolve(true);
      };
      this.on("exit", onExit);
    });
  }
  /** The life file, whole — the ground truth for the 'both' channel. */
  readFile(id) {
    const rec = this.table.get(id);
    if (!rec) return "";
    try {
      return fs.readFileSync(rec.streamFile, "utf8");
    } catch {
      return "";
    }
  }
  /** One channel's text, rebuilt from what the live buffer still holds. */
  channelText(id, channel) {
    const buf = this.buffers.get(id);
    if (!buf) return "";
    const parts = [];
    for (const chunk of buf.chunks) if (chunk.channel === channel) parts.push(chunk.text);
    return parts.join("");
  }
}
function createWrapper(options = {}) {
  return new ProcessWrapperService(options);
}
async function runTests() {
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-test-"));
  const w = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 500 });
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("parseCommand splits bare args", JSON.stringify(parseCommand("python bar.py")) === '["python","bar.py"]');
  ok("parseCommand honours quotes", JSON.stringify(parseCommand('"C:/Program Files/py.exe" -c "print(1)"')) === '["C:/Program Files/py.exe","-c","print(1)"]', JSON.stringify(parseCommand('"C:/Program Files/py.exe" -c "print(1)"')));
  ok("parseCommand empty", parseCommand("   ").length === 0);
  const a = w.launch({
    name: "three-lines",
    command: process.execPath,
    args: ["-e", "console.log('one');console.error('two');setTimeout(()=>console.log('three'),60)"]
  });
  ok("launch returns a starting/running record", a.life === "running" || a.life === "starting", a.life);
  const aEnd = await w.awaitExit(a.id, 15e3);
  ok("clean exit reads exited", !!aEnd && aEnd.life === "exited", aEnd ? aEnd.life + "/" + String(aEnd.error) : "null");
  ok("exit code 0", !!aEnd && aEnd.exitCode === 0, String(aEnd?.exitCode));
  const aOut = w.output(a.id);
  ok("stdout+stderr text captured", aOut.text.includes("one") && aOut.text.includes("three") && aOut.text.includes("two"), aOut.text);
  const aErr = w.output(a.id, { channel: "stderr" });
  ok("stderr channel separated", aErr.text.includes("two") && !aErr.text.includes("three"), aErr.text);
  const aFile = fs.readFileSync(a.streamFile, "utf8");
  ok("life file is the ground truth", aFile.includes("one") && aFile.includes("three"), aFile);
  ok("offsets report the whole life", aOut.total > 0 && aOut.complete === true, String(aOut.total));
  const sliced = w.output(a.id, { from: 4, limit: 100 });
  ok("output(from) skips the front", sliced.from === 4 && sliced.text.length > 0 && !sliced.text.startsWith("one"), JSON.stringify(sliced.text));
  const lines = [];
  const b = w.launch({ name: "line-events", command: process.execPath, args: ["-e", "setTimeout(()=>console.log('l1'),10);setTimeout(()=>console.log('l2'),40)"] });
  w.on("line", (ev) => {
    if (ev.id === b.id) lines.push(ev.line);
  });
  await w.awaitExit(b.id, 15e3);
  ok("line events fire in order", lines.join("|") === "l1|l2", lines.join("|"));
  const c = w.launch({ name: "echo-stdin", command: process.execPath, args: ["-e", "process.stdin.on('data',d=>console.log('echo:'+d.toString().trim()))"] });
  await new Promise((r) => setTimeout(r, 400));
  ok("write reaches the child stdin", w.write(c.id, "hello\n") === true);
  let echoText = "";
  const echoDeadline = Date.now() + 5e3;
  while (Date.now() < echoDeadline) {
    echoText = w.output(c.id).text;
    if (echoText.includes("echo:hello")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  ok("stdin echo captured", echoText.includes("echo:hello"), echoText);
  await w.kill(c.id, { force: true });
  ok("kill on an echoing (stdin-driven) child reads killed", w.get(c.id)?.life === "killed", String(w.get(c.id)?.life));
  const d = w.launch({ name: "long-runner", command: process.execPath, args: ["-e", "console.log('up');setInterval(()=>{},100)"] });
  await new Promise((r) => setTimeout(r, 500));
  const kd = await w.kill(d.id, { force: true });
  ok("force kill returns a pid", typeof kd.pid === "number" && kd.pid > 0, String(kd.pid));
  ok("killed life is killed", kd.outcome === "killed", kd.outcome);
  ok("kill result declares force", kd.requested === "force" && kd.forced === true, JSON.stringify(kd));
  const e = w.launch({ name: "bad-exit", command: process.execPath, args: ["-e", "process.exit(3)"] });
  const eEnd = await w.awaitExit(e.id, 15e3);
  ok("non-zero exit reads failed", !!eEnd && eEnd.life === "failed" && eEnd.exitCode === 3, JSON.stringify(eEnd));
  const f = w.launch({ name: "no-such-exe", command: "definitely-not-a-real-exe-xyz" });
  const fEnd = await w.awaitExit(f.id, 15e3);
  ok("missing exe reads failed", !!fEnd && fEnd.life === "failed", JSON.stringify(fEnd));
  ok("missing exe carries the reason", !!fEnd && !!fEnd.error, String(fEnd?.error));
  const seen = [];
  const sub = { ended: false };
  const g = w.launch({ name: "replay", command: process.execPath, args: ["-e", "console.log('early');setTimeout(()=>console.log('late'),250)"] });
  await new Promise((r) => setTimeout(r, 150));
  const unsub = w.subscribe(g.id, (chunk) => {
    if (chunk === "end") {
      sub.ended = true;
      return;
    }
    seen.push(chunk.text);
  });
  await w.awaitExit(g.id, 15e3);
  unsub();
  const seenText = seen.join("");
  ok("subscriber replayed the early text", seenText.includes("early"), seenText);
  ok("subscriber caught the late text", seenText.includes("late"), seenText);
  ok("subscriber got the end", sub.ended === true);
  const earlyFrom = Math.max(0, aOut.text.indexOf("three"));
  const early = [];
  const liveOffset = w.subscribe(a.id, (chunk) => {
    if (chunk !== "end") early.push(chunk.text);
  }, { from: earlyFrom });
  liveOffset();
  ok("a copy opened after the fact trims by offset", early.join("") === aOut.text.slice(earlyFrom), JSON.stringify(early.join("")));
  const liveGate = { text: "" };
  const futureProcess = w.launch({ name: "offset-live", command: process.execPath, args: ["-e", "console.log('AAAA');setTimeout(()=>console.log('BBBB'),200)"] });
  const unsubFuture = w.subscribe(futureProcess.id, (chunk) => {
    if (chunk !== "end") liveGate.text += chunk.text;
  }, { from: 5 });
  await w.awaitExit(futureProcess.id, 15e3);
  unsubFuture();
  ok("a copy opened BEFORE the text skips the front too", liveGate.text === "BBBB\n", JSON.stringify(liveGate.text));
  ok("the same copy equals the stream minus its front", w.output(futureProcess.id).text.slice(5) === liveGate.text, JSON.stringify(w.output(futureProcess.id).text.slice(5)));
  const resuming = [];
  const resumed = w.launch({ name: "offset-resume", command: process.execPath, args: ["-e", "console.log('first');setTimeout(()=>console.log('second'),400)"] });
  await new Promise((r) => setTimeout(r, 500));
  const alreadyRead = w.output(resumed.id);
  const unsubResume = w.subscribe(resumed.id, (chunk) => {
    if (chunk !== "end") resuming.push(chunk.text);
  }, { from: alreadyRead.total });
  await w.awaitExit(resumed.id, 15e3);
  unsubResume();
  ok("a resuming copy continues exactly where the read stopped", alreadyRead.text + resuming.join("") === w.output(resumed.id).text, JSON.stringify(alreadyRead.text + "|" + resuming.join("")));
  const stillRunning = w.launch({ name: "table-hold", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] });
  await new Promise((r) => setTimeout(r, 300));
  const listed = w.list();
  ok("list holds every life", listed.length === 10, String(listed.length));
  ok("get by id", w.get(g.id)?.id === g.id);
  ok("get unknown id is null", w.get("nope") === null);
  ok("running cannot be removed", (() => {
    try {
      w.remove(stillRunning.id);
      return false;
    } catch {
      return true;
    }
  })());
  ok("finished can be removed", w.remove(g.id) === true);
  ok("file survives the removal", fs.existsSync(a.streamFile));
  const heldKill = await w.kill(stillRunning.id, { force: true });
  ok("the held runner was killed", heldKill.outcome === "killed" && w.get(stillRunning.id)?.life === "killed", JSON.stringify(heldKill));
  const h = w.launch({
    name: "big-writer",
    command: process.execPath,
    args: ["-e", "for(let i=0;i<2000;i++)process.stdout.write('x'.repeat(500)+'\\n')"],
    bufferLimitChars: 5e4
  });
  await w.awaitExit(h.id, 3e4);
  const hRec = w.get(h.id);
  ok("big write set the truncated flag", !!hRec && hRec.truncated === true, String(hRec?.truncated));
  const hFile = fs.readFileSync(h.streamFile, "utf8");
  ok("the file kept the WHOLE life despite the RAM ceiling", hFile.length === 2e3 * 501, String(hFile.length));
  const wVis = new ProcessWrapperService({ streamDir: path.join(os.tmpdir(), "pw-vis-" + process.pid) });
  const seenRec = wVis.launch({ command: process.execPath, args: ["-e", 'console.log("seen")'], hideWindow: false });
  const hidRec = wVis.launch({ command: process.execPath, args: ["-e", 'console.log("hidden")'] });
  ok("a display asked to be SEEN launches", !!seenRec.id && !!seenRec.pid, JSON.stringify({ id: seenRec.id, pid: seenRec.pid }));
  ok("and the default (hidden) still launches \u2014 the new option is not a break", !!hidRec.id && !!hidRec.pid, JSON.stringify({ id: hidRec.id, pid: hidRec.pid }));
  ok("seen and hidden are both in the ONE table", !!seenRec.id && !!hidRec.id && seenRec.id !== hidRec.id);
  const visRows = wVis.list({});
  ok("and the table shows both lives", visRows.length >= 2, String(visRows.length));
  await wVis.shutdown(true);
  const wAd = new ProcessWrapperService({ streamDir: path.join(os.tmpdir(), "pw-adopt-" + process.pid) });
  const outside = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
  const adRec = wAd.adopt({ pid: outside.pid, name: "outside-thing", tag: "mined" });
  ok("an adopted process gets a row with its pid", !!adRec.id && adRec.pid === outside.pid, JSON.stringify({ id: adRec.id, pid: adRec.pid }));
  ok("adoption is supervised: nothing of its output reaches this loop", adRec.isolation === "supervised", String(adRec.isolation));
  const adAgain = wAd.adopt({ pid: outside.pid });
  ok("adopting the same pid twice is still ONE row", adAgain.id === adRec.id, `${adAgain.id} vs ${adRec.id}`);
  const adKill = await wAd.kill(adRec.id, { force: true });
  ok("an adopted process can be stopped from the table", adKill.outcome === "killed", JSON.stringify(adKill));
  await new Promise((r) => setTimeout(r, 700));
  ok("and its row is not left claiming a dead pid", wAd.get(adRec.id)?.life !== "running", String(wAd.get(adRec.id)?.life));
  await wAd.shutdown(true);
  const supRec = w.launch({ command: process.execPath, args: ["-e", 'setInterval(()=>console.log("noise"),50)'], isolation: "supervised", tag: "sup" });
  ok("a supervised launch still gets a row and a pid", supRec.isolation === "supervised" && !!supRec.pid, JSON.stringify({ iso: supRec.isolation, pid: supRec.pid }));
  await new Promise((r) => setTimeout(r, 800));
  ok("and none of its noise is captured on this loop", (w.get(supRec.id)?.chars.stdout ?? -1) === 0, String(w.get(supRec.id)?.chars.stdout));
  const supKill = await w.kill(supRec.id, { force: true });
  ok("a supervised child is still stoppable from the table", supKill.outcome === "killed", JSON.stringify(supKill));
  const dupA = w.launch({ name: "dup-target", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] });
  const dupB = w.launch({ name: "dup-target", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"] });
  ok("a second launch by the same name returns the life already up", dupB.id === dupA.id, dupA.id + " vs " + dupB.id);
  ok(
    "and the table holds one row for it",
    w.list({ life: "running" }).filter((r) => r.name === "dup-target").length === 1,
    String(w.list({ life: "running" }).filter((r) => r.name === "dup-target").length)
  );
  const dupC = w.launch({ name: "dup-target", command: process.execPath, args: ["-e", "setInterval(()=>{},100)"], allowDuplicate: true });
  ok("allowDuplicate is the explicit override", dupC.id !== dupA.id, dupA.id + " vs " + dupC.id);
  const dupD = w.launch({ command: "C:\\AI\\Miners\\Thing.exe", args: ["--flag"], cwd: dir });
  const dupE = w.launch({ command: "c:/ai/miners/thing.exe", args: ["--flag"], cwd: dir });
  ok("an unnamed launch of the same exe+argv+cwd is the same work", dupE.id === dupD.id, dupD.id + " vs " + dupE.id);
  const dupF = w.launch({ command: "C:\\AI\\Miners\\Thing.exe", args: ["--other"], cwd: dir });
  ok("a different argv is a different life", dupF.id !== dupD.id, dupD.id + " vs " + dupF.id);
  await w.kill(dupA.id, { force: true });
  await w.kill(dupC.id, { force: true });
  await w.kill(dupD.id, { force: true });
  await w.kill(dupF.id, { force: true });
  const dupG = w.launch({ command: "C:\\AI\\Miners\\Thing.exe", args: ["--flag"], cwd: dir });
  ok("a finished life does not block the same work starting again", dupG.id !== dupD.id, dupD.id + " vs " + dupG.id);
  await w.kill(dupG.id, { force: true });
  await w.shutdown();
  ok("shutdown leaves nothing running", w.list({ life: "running" }).length === 0);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[processWrapper] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ProcessWrapperService,
  createWrapper,
  parseCommand,
  runTests,
  sameExe
};
//# sourceMappingURL=processWrapper.js.map
