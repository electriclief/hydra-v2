import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
function parseSampleLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.top)) parsed.top = void 0;
    if (!Array.isArray(parsed.topIO)) parsed.topIO = void 0;
    if (!Array.isArray(parsed.newNames)) parsed.newNames = void 0;
    return parsed;
  } catch {
    return null;
  }
}
function dayKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${m}${day}`;
}
function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function formatRecord(rec) {
  const bits = [rec.at, rec.kind.padEnd(11), rec.name];
  if (rec.pid != null) bits.push(`pid ${rec.pid}`);
  if (rec.detail) bits.push(rec.detail);
  if (rec.unexpected) bits.push("UNEXPECTED");
  return bits.join(" | ");
}
function createWatchCore(options = {}) {
  const expected = options.expected ?? /* @__PURE__ */ new Set();
  const procCpuPct = options.procCpuPct ?? 20;
  const procIOMBs = options.procIOMBs ?? 20;
  const totalCpuPct = options.totalCpuPct ?? 60;
  const sustain = Math.max(1, options.sustain ?? 2);
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const hot = /* @__PURE__ */ new Map();
  let samples = 0;
  const isHot = (name) => {
    if (name === "(system)") return false;
    return !expected.has(name.toLowerCase());
  };
  const record = (kind, name, pid, detail, extras = {}) => {
    const base = {
      kind,
      at: stamp(now()),
      name,
      pid,
      cpuPeak: extras.cpuPeak ?? null,
      diskPeakMBs: extras.diskPeakMBs ?? null,
      samples: extras.samples ?? null,
      unexpected: extras.unexpected ?? isHot(name),
      detail
    };
    return { ...base, line: formatRecord(base) };
  };
  function ingest(sample) {
    samples += 1;
    const out = [];
    for (const name of Array.isArray(sample.newNames) ? sample.newNames : []) {
      if (!name) continue;
      out.push(record("new", name, null, "first seen on this machine life"));
    }
    const pressure = /* @__PURE__ */ new Map();
    for (const row of Array.isArray(sample.top) ? sample.top : []) {
      if (!row || !row.name) continue;
      const cell = pressure.get(row.name) ?? { pid: null, cpu: 0, io: 0 };
      cell.cpu = Math.max(cell.cpu, row.cpu ?? 0);
      if (row.pid) cell.pid = row.pid;
      pressure.set(row.name, cell);
    }
    for (const row of Array.isArray(sample.topIO) ? sample.topIO : []) {
      if (!row || !row.name) continue;
      const cell = pressure.get(row.name) ?? { pid: null, cpu: 0, io: 0 };
      cell.io = Math.max(cell.io, row.ioMBs ?? 0);
      if (row.pid) cell.pid = row.pid;
      pressure.set(row.name, cell);
    }
    if ((sample.cpuTotal ?? 0) >= totalCpuPct) {
      const cell = pressure.get("(system)") ?? { pid: null, cpu: 0, io: 0 };
      cell.cpu = sample.cpuTotal ?? 0;
      pressure.set("(system)", cell);
    }
    const seenThisSample = /* @__PURE__ */ new Set();
    for (const [name, cell] of pressure) {
      const overCpu = cell.cpu >= procCpuPct;
      const overIo = cell.io >= procIOMBs;
      if (!overCpu && !overIo) continue;
      seenThisSample.add(name);
      const state = hot.get(name) ?? { above: 0, cpuPeak: null, diskPeak: null, firstAt: now(), lastAt: now() };
      state.above += 1;
      state.lastAt = now();
      state.cpuPeak = Math.max(state.cpuPeak ?? 0, cell.cpu) || null;
      state.diskPeak = Math.max(state.diskPeak ?? 0, cell.io) || null;
      hot.set(name, state);
      if (state.above === sustain) {
        const ranges = [];
        if (state.cpuPeak) ranges.push(`cpu peak ${state.cpuPeak}%`);
        if (state.diskPeak) ranges.push(`disk ${state.diskPeak} MB/s`);
        out.push(record("drain", name, cell.pid, `${ranges.join(", ")} held ${state.above} samples${sample.busy ? ", busiest " + sample.busy : ""}`, {
          cpuPeak: state.cpuPeak,
          diskPeakMBs: state.diskPeak,
          samples: state.above
        }));
      }
    }
    for (const [name, state] of Array.from(hot)) {
      if (seenThisSample.has(name)) continue;
      if (state.above >= sustain) {
        const ranges = [];
        if (state.cpuPeak) ranges.push(`cpu peak ${state.cpuPeak}%`);
        if (state.diskPeak) ranges.push(`disk ${state.diskPeak} MB/s`);
        out.push(record("episode-end", name, null, `${ranges.join(", ")} over ${state.above} samples`, {
          cpuPeak: state.cpuPeak,
          diskPeakMBs: state.diskPeak,
          samples: state.above
        }));
      }
      hot.delete(name);
    }
    return out;
  }
  function watching() {
    return hot.size;
  }
  return { ingest, watching, samples: () => samples };
}
function loadExpected(file) {
  const set = /* @__PURE__ */ new Set();
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "# expected.txt -- one process name per line; names here are KNOWN and are never tagged UNEXPECTED.\n# this is a tool, not a rule: absence tags a line, it never hides one. Edit freely; the watch reads it once per start.\n", "utf8");
      return set;
    }
    const text = fs.readFileSync(file, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      set.add(line.toLowerCase());
    }
  } catch {
  }
  return set;
}
async function createSystemWatch(options) {
  const wrapper = options.wrapper;
  const logDir = options.logDir ?? path.join(process.cwd(), "data", "watch");
  fs.mkdirSync(logDir, { recursive: true });
  const expectedPath = options.expectedFile ?? path.join(logDir, "expected.txt");
  const intervalSec = Math.max(3, options.intervalSec ?? 20);
  const samplerPath = options.samplerPath ?? fileURLToPath(new URL("../../scripts/system-sampler.ps1", import.meta.url));
  const quiet = options.quiet === true;
  const expected = loadExpected(expectedPath);
  const core = createWatchCore({
    expected,
    procCpuPct: options.procCpuPct,
    procIOMBs: options.procIOMBs,
    totalCpuPct: options.totalCpuPct,
    sustain: options.sustain
  });
  const startedAt = Date.now();
  let records = 0;
  let restarts = 0;
  let stopping = false;
  let samplerId = null;
  const logPathFor = (d) => path.join(logDir, `watch-${dayKey(d)}.log`);
  const writeRecord = (rec) => {
    const full = rec.line ? rec : { ...rec, line: formatRecord(rec) };
    records += 1;
    try {
      fs.appendFileSync(logPathFor(/* @__PURE__ */ new Date()), full.line + "\n", "utf8");
    } catch {
    }
    if (!quiet) console.log("[system-watch] " + full.line);
    if (full.kind === "drain" && options.notify) {
      try {
        options.notify(full);
      } catch {
      }
    }
  };
  const onLine = (ev) => {
    if (ev.id !== samplerId || ev.channel !== "stdout") return;
    const sample = parseSampleLine(ev.line);
    if (!sample) return;
    let produced = [];
    try {
      produced = core.ingest(sample);
    } catch {
      return;
    }
    for (const rec of produced) writeRecord(rec);
  };
  const onExit = (rec) => {
    if (rec.id !== samplerId || stopping) return;
    const why = rec.error ?? `exit code ${rec.exitCode}`;
    if (restarts < 3) {
      restarts += 1;
      writeRecord({
        kind: "watch-note",
        at: stamp(/* @__PURE__ */ new Date()),
        name: "system-watch",
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: `sampler ended (${why}) -- restarting (${restarts}/3)`,
        line: ""
      });
      startSampler();
    } else {
      writeRecord({
        kind: "watch-note",
        at: stamp(/* @__PURE__ */ new Date()),
        name: "system-watch",
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: "sampler ended 3 times -- the watch is BLIND until restart",
        line: ""
      });
    }
  };
  function startSampler() {
    try {
      const rec = wrapper.launch({
        name: "system-watch",
        tag: "watch",
        command: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", samplerPath, "-IntervalSec", String(intervalSec)]
      });
      samplerId = rec.id;
    } catch (err) {
      samplerId = null;
      writeRecord({
        kind: "watch-note",
        at: stamp(/* @__PURE__ */ new Date()),
        name: "system-watch",
        pid: null,
        cpuPeak: null,
        diskPeakMBs: null,
        samples: null,
        unexpected: false,
        detail: `sampler could not launch: ${err.message}`,
        line: ""
      });
    }
  }
  wrapper.on("line", onLine);
  wrapper.on("exit", onExit);
  if (options.autostart !== false) startSampler();
  return {
    module: "systemWatch",
    logDir,
    get logPath() {
      return logPathFor(/* @__PURE__ */ new Date());
    },
    expectedPath,
    get samplerId() {
      return samplerId;
    },
    startedAt,
    ingest: (sample) => {
      const out = core.ingest(sample);
      for (const rec of out) writeRecord(rec);
      return out;
    },
    status: () => ({
      running: !stopping,
      samplerId,
      since: startedAt,
      samples: core.samples(),
      records,
      logPath: logPathFor(/* @__PURE__ */ new Date()),
      expectedPath,
      intervalSec
    }),
    stop: async () => {
      stopping = true;
      wrapper.off("line", onLine);
      wrapper.off("exit", onExit);
      if (samplerId) {
        const rec = wrapper.get(samplerId);
        if (rec && (rec.life === "running" || rec.life === "starting")) {
          try {
            await wrapper.kill(samplerId, { force: true, graceMs: 1500 });
          } catch {
          }
        }
      }
    }
  };
}
async function runTests() {
  const os = await import("node:os");
  const { createWrapper } = await import("./processWrapper.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("a real sample line parses", parseSampleLine('{"t":"2026-09-29 10:00:00","cpuTotal":12.5,"top":[{"name":"chrome","pid":1,"cpu":20}]}')?.cpuTotal === 12.5);
  ok("junk is null", parseSampleLine("not json at all") === null && parseSampleLine("") === null && parseSampleLine("{broken") === null);
  const core = createWatchCore({ sustain: 2 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-watch-"));
  const fired = [];
  const first = core.ingest({ cpuTotal: 10, top: [{ name: "chrome", pid: 100, cpu: 4 }], newNames: ["chrome", "notepad"] });
  ok("first sample: new names are recorded", first.filter((r) => r.kind === "new").length === 2, JSON.stringify(first.map((r) => r.kind)));
  ok("a quiet new name is not a drain", first.every((r) => r.kind !== "drain"));
  const second = core.ingest({ cpuTotal: 30, top: [{ name: "notepad", pid: 101, cpu: 25 }], newNames: [] });
  ok("one hot sample is not yet a drain (sustain 2)", second.every((r) => r.kind !== "drain"), JSON.stringify(second.map((r) => r.kind)));
  const third = core.ingest({ cpuTotal: 55, top: [{ name: "notepad", pid: 101, cpu: 27 }], newNames: [] });
  const drains = third.filter((r) => r.kind === "drain");
  ok("the second hot sample is the drain", drains.length === 1 && drains[0].name === "notepad", JSON.stringify(third.map((r) => r.kind)));
  ok("the drain carries the cpu peak", drains[0].cpuPeak === 27, String(drains[0].cpuPeak));
  ok("an unblessed name is tagged UNEXPECTED", drains[0].unexpected === true);
  const fourth = core.ingest({ cpuTotal: 12, top: [{ name: "chrome", pid: 100, cpu: 3 }], newNames: [] });
  const ends = fourth.filter((r) => r.kind === "episode-end");
  ok("cooling closes the episode, with the peak", ends.length === 1 && ends[0].name === "notepad" && ends[0].cpuPeak === 27, JSON.stringify(ends));
  const blessed = createWatchCore({ sustain: 1, expected: /* @__PURE__ */ new Set(["mbamservice"]) });
  const blessedOut = blessed.ingest({ cpuTotal: 30, top: [{ name: "MBAMService", pid: 7, cpu: 22 }], newNames: [] });
  ok("a blessed name still gets its drain line", blessedOut.some((r) => r.kind === "drain" && r.name === "MBAMService"));
  ok("...but it is not tagged UNEXPECTED", blessedOut.find((r) => r.kind === "drain")?.unexpected === false);
  const total = createWatchCore({ sustain: 2, totalCpuPct: 60 });
  total.ingest({ cpuTotal: 70, top: [{ name: "a", pid: 1, cpu: 20 }], newNames: [] });
  const totalOut = total.ingest({ cpuTotal: 75, top: [{ name: "a", pid: 1, cpu: 25 }], newNames: [] });
  ok("a hot machine total is a drain on its own", totalOut.some((r) => r.kind === "drain" && r.name === "(system)"), JSON.stringify(totalOut.map((r) => r.name)));
  const shape = formatRecord({ kind: "drain", at: "2026-09-29 10:00:00", name: "chrome", pid: 42, cpuPeak: 30, diskPeakMBs: null, samples: 2, unexpected: true, detail: "cpu peak 30%" });
  ok("log lines are pipe-delimited and tagged", shape.includes(" | drain ") && shape.includes("chrome") && shape.endsWith("UNEXPECTED"), shape);
  const expFile = path.join(dir, "expected.txt");
  const emptyExpected = loadExpected(expFile);
  ok("a missing expected list is created, empty", fs.existsSync(expFile) && emptyExpected.size === 0);
  fs.writeFileSync(expFile, "# comment\nBrave\n\nmbamservice\n", "utf8");
  const loaded = loadExpected(expFile);
  ok("the list reads names, skips comments, lowercases", loaded.has("brave") && loaded.has("mbamservice") && loaded.size === 2, String(loaded.size));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 500 });
  const samplerPath = fileURLToPath(new URL("../../scripts/system-sampler.ps1", import.meta.url));
  const once = wrapper.launch({
    name: "sampler-once",
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", samplerPath, "-Once"]
  });
  await wrapper.awaitExit(once.id, 3e4);
  const text = wrapper.output(once.id).text.trim();
  const line = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).pop() ?? "";
  const sample = parseSampleLine(line);
  ok("the real sampler emits a parseable line", sample !== null, JSON.stringify(text.slice(0, 160)));
  ok("the sample carries cpu + top + disk + io", Boolean(sample && typeof sample.cpuTotal === "number" && Array.isArray(sample.top) && Array.isArray(sample.disk) && Array.isArray(sample.topIO)), JSON.stringify(sample)?.slice(0, 200));
  ok("the sample names this machine's drives", Boolean(sample && sample.disk && sample.disk.some((d) => /C:/.test(d.id))), JSON.stringify(sample?.disk));
  const watch = await createSystemWatch({
    wrapper,
    logDir: path.join(dir, "watch"),
    expectedFile: path.join(dir, "watch", "expected.txt"),
    intervalSec: 3,
    quiet: true,
    notify: (r) => fired.push(r)
  });
  ok("the sampler is a child IN the table (nothing hidden)", Boolean(watch.samplerId && wrapper.get(watch.samplerId)), String(watch.samplerId));
  const gotSample = await new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (watch.status().samples >= 1) return resolve(true);
      if (Date.now() - t0 > 15e3) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
  ok("a sample really arrived and was ingested (line -> watch)", gotSample, `samples=${watch.status().samples}`);
  const st = watch.status();
  ok("status counts samples as they arrive", st.samples >= 0 && st.intervalSec === 3, JSON.stringify(st));
  ok("the notifier only ever hears drains", fired.every((r) => r.kind === "drain"));
  await watch.stop();
  const stopped = wrapper.get(watch.samplerId ?? "");
  ok("stop leaves no sampler running", !stopped || stopped.life !== "running" && stopped.life !== "starting", stopped ? stopped.life : "gone");
  await wrapper.shutdown(true);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[systemWatch] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createSystemWatch,
  createWatchCore,
  formatRecord,
  loadExpected,
  parseSampleLine,
  runTests,
  stamp
};
//# sourceMappingURL=systemWatch.js.map
