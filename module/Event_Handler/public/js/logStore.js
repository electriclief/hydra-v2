import fs from "node:fs";
import path from "node:path";
function parseLine(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (typeof obj === "object" && obj !== null && typeof obj.t === "string" && typeof obj.name === "string" && typeof obj.source === "string") {
      return obj;
    }
    return null;
  } catch {
    return null;
  }
}
class LogStore {
  file;
  retentionHours;
  maxBytes;
  purgeIntervalMs;
  timer = null;
  closed = false;
  appendsSinceSizeCheck = 0;
  constructor(options) {
    this.file = options.file;
    this.retentionHours = options.retentionHours ?? 24;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.purgeIntervalMs = options.purgeIntervalMs ?? 10 * 6e4;
  }
  /** Create the file if missing, trim it once, and arm the periodic self-trim. */
  start() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, "");
    this.purge();
    if (this.purgeIntervalMs > 0) {
      this.timer = setInterval(() => this.purge(), this.purgeIntervalMs);
      this.timer.unref?.();
    }
    return this;
  }
  /** Append one line. The size check rides every 64th append (throttled, cheap). */
  append(line) {
    if (this.closed) return;
    try {
      fs.appendFileSync(this.file, JSON.stringify(line) + "\n");
    } catch {
      return;
    }
    this.appendsSinceSizeCheck++;
    if (this.appendsSinceSizeCheck >= 64) {
      this.appendsSinceSizeCheck = 0;
      try {
        if (fs.statSync(this.file).size > this.maxBytes) this.purge();
      } catch {
      }
    }
  }
  /** The file, parsed; or the last N matching lines. */
  read(options = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 5e3));
    let raw = "";
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      raw = "";
    }
    const all = [];
    for (const text of raw.split("\n")) {
      const parsed = parseLine(text);
      if (parsed) all.push(parsed);
    }
    const matched = all.filter((line) => {
      if (options.name && line.name !== options.name) return false;
      if (options.source && line.source !== options.source) return false;
      if (options.since && Date.parse(line.t) < options.since) return false;
      return true;
    });
    return {
      lines: matched.slice(-limit),
      matched: matched.length,
      fileBytes: Buffer.byteLength(raw)
    };
  }
  /** Trim to the retention window AND under the byte ceiling. Atomic rewrite (tmp + rename). */
  purge() {
    let raw = "";
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      raw = "";
    }
    const bytesBefore = Buffer.byteLength(raw);
    const lines = raw.split("\n").filter(Boolean);
    const before = lines.length;
    const cutoff = Date.now() - this.retentionHours * 36e5;
    let keep = lines.filter((text) => {
      const parsed = parseLine(text);
      if (!parsed) return false;
      return Date.parse(parsed.t) >= cutoff;
    });
    const sizes = keep.map((line) => Buffer.byteLength(line) + 1);
    let bytes = sizes.reduce((sum, n) => sum + n, 0);
    let drop = 0;
    while (keep.length - drop > 1 && bytes > this.maxBytes) {
      bytes -= sizes[drop];
      drop++;
    }
    keep = keep.slice(drop);
    const out = keep.length ? keep.join("\n") + "\n" : "";
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, this.file);
    } catch {
    }
    return {
      before,
      after: keep.length,
      removed: before - keep.length,
      bytesBefore,
      bytesAfter: Buffer.byteLength(out)
    };
  }
  stats() {
    let raw = "";
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      raw = "";
    }
    const lines = raw.split("\n").filter((line) => parseLine(line) !== null).length;
    return {
      file: this.file,
      bytes: Buffer.byteLength(raw),
      lines,
      retentionHours: this.retentionHours,
      maxBytes: this.maxBytes
    };
  }
  stop() {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
function createLogStore(options) {
  return new LogStore(options);
}
async function runTests() {
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-log-"));
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const store = createLogStore({ file: path.join(dir, "events.log"), purgeIntervalMs: 0 });
  store.start();
  const t0 = (/* @__PURE__ */ new Date()).toISOString();
  store.append({ t: t0, name: "tick", source: "user", payload: { n: 1 } });
  store.append({ t: t0, name: "tick.result", source: "user", of: "tick", result: 42 });
  store.append({ t: t0, name: "boom", source: "agent" });
  const all = store.read({ limit: 50 });
  ok("three lines round-trip", all.matched === 3 && all.lines.length === 3, String(all.matched));
  ok("payload survives", all.lines[0].payload.n === 1);
  ok("result survives", all.lines[1].result === 42 && all.lines[1].of === "tick");
  ok("name filter", store.read({ name: "boom" }).matched === 1);
  ok("source filter", store.read({ source: "agent" }).matched === 1);
  ok(
    "limit takes the tail",
    (() => {
      const r = store.read({ limit: 1 });
      return r.lines.length === 1 && r.lines[0].name === "boom";
    })()
  );
  const old = new Date(Date.now() - 30 * 36e5).toISOString();
  store.append({ t: old, name: "ancient", source: "process" });
  const purged = store.purge();
  ok("purge removed the 30 h old line", purged.removed === 1, JSON.stringify(purged));
  ok("purge kept the fresh ones", store.read({ limit: 50 }).matched === 3);
  const small = createLogStore({ file: path.join(dir, "small.log"), maxBytes: 400, purgeIntervalMs: 0 });
  small.start();
  for (let i = 0; i < 40; i++) small.append({ t: t0, name: "spam-" + i, source: "process" });
  small.purge();
  const stats = small.stats();
  ok("byte ceiling holds", stats.bytes <= 400, String(stats.bytes));
  ok(
    "newest survive the trim",
    small.read({ limit: 5 }).lines.some((l) => l.name === "spam-39"),
    small.read({ limit: 5 }).lines.map((l) => l.name).join(",")
  );
  const corrupt = path.join(dir, "corrupt.log");
  fs.writeFileSync(corrupt, "{nope\n" + JSON.stringify({ t: t0, name: "fine", source: "user" }) + "\n");
  const cstore = createLogStore({ file: corrupt, purgeIntervalMs: 0 });
  ok("corrupt line skipped, good line kept", cstore.read({ limit: 10 }).matched === 1);
  store.stop();
  small.stop();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[logStore] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  LogStore,
  createLogStore,
  runTests
};
//# sourceMappingURL=logStore.js.map
