import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDoors, DoorError } from "./doors.js";
import { buildBookInput, buildValues, isLive, lazyOutputs, resolveLaunch } from "./runLogic.js";
const MAX_BODY = 2e6;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json"
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new DoorError("body too large", "bad_json", 400));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new DoorError("the body must be JSON", "bad_json", 400));
      }
    });
    req.on("error", reject);
  });
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data ?? null));
}
function fail(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}
async function createBasicServer(options) {
  const doors = "services" in options.doors && "pw" in options.doors ? options.doors : createDoors(options.doors);
  const host = options.host ?? "127.0.0.1";
  const publicDir = options.publicDir ?? fileURLToPath(new URL("../", import.meta.url));
  const watchMs = options.watchMs ?? 1200;
  const eh = options.eh ?? null;
  let current = null;
  let watchTimer = null;
  function stopWatch() {
    if (watchTimer !== null) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }
  function startWatch() {
    if (watchTimer !== null) return;
    watchTimer = setInterval(() => {
      void tick();
    }, watchMs);
    if (typeof watchTimer === "object" && watchTimer !== null && "unref" in watchTimer) {
      watchTimer.unref?.();
    }
  }
  async function tick() {
    if (!current) {
      stopWatch();
      return;
    }
    try {
      const rec = await doors.pw.get(current.runId);
      if (!rec) {
        await finalize(null);
        return;
      }
      if (!isLive(rec)) await finalize(rec);
    } catch {
    }
  }
  async function finalize(rec) {
    const run = current;
    if (!run) return;
    current = null;
    stopWatch();
    const exitCode = rec?.exitCode ?? null;
    const okEnd = exitCode === 0;
    if (run.bookingId) {
      try {
        await doors.rm.pop(run.bookingId);
      } catch {
      }
    }
    const summary = {
      status: okEnd ? "ended" : "failed",
      runId: run.runId,
      service: run.name,
      exitCode,
      endedAt: (/* @__PURE__ */ new Date()).toISOString(),
      command: run.command,
      outputPath: run.outputPath
    };
    try {
      await doors.state.register("Basic.Run." + run.name, summary);
      await doors.state.register("Basic.Last", summary);
      await doors.state.register("Basic", {
        value: okEnd ? "solid" : "flashing",
        note: `${run.name} ${okEnd ? "done" : "failed"} (exit ${exitCode ?? "?"})`
      });
    } catch {
    }
    eh?.trigger?.("basic.run-ended", summary, { source: "process" });
  }
  async function view() {
    if (!current) return { ok: true, busy: false, run: null };
    let rec = null;
    try {
      rec = await doors.pw.get(current.runId);
    } catch {
      rec = null;
    }
    const run = {
      runId: current.runId,
      name: current.name,
      pid: rec?.pid ?? current.pid,
      life: rec?.life ?? "running",
      exitCode: rec?.exitCode ?? null,
      startedAt: current.startedAt,
      command: current.command,
      outputPath: current.outputPath,
      gui: current.gui,
      progressHow: current.progressHow
    };
    return { ok: true, busy: isLive(rec ?? { life: "running", endedAt: null }), run };
  }
  async function startRun(body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const provided = body.values && typeof body.values === "object" ? body.values : {};
    if (!name) throw new DoorError("a run names its service", "bad_request", 400);
    if (current) throw new DoorError(`busy \u2014 ${current.name} is running`, "busy", 409);
    const defAnswer = await doors.services.get(name);
    const def = defAnswer.service;
    if (!def || typeof def.name !== "string") throw new DoorError(`no definition for ${name}`, "no_such_service", 404);
    const filled = buildValues(def, provided);
    if (filled.missing.length) {
      throw new DoorError(`missing required input(s): ${filled.missing.join(", ")}`, "missing_inputs", 400);
    }
    let gpuName = null;
    if (def.needs?.gpu === true) {
      const refreshed = await doors.rm.refresh();
      const gpu = (refreshed.resources?.gpus ?? [])[0];
      gpuName = gpu?.name ?? null;
      if (!gpuName) throw new DoorError("this service needs a gpu and the node reports none", "no_gpu", 409);
    }
    const booked = await doors.rm.book(buildBookInput(def, gpuName));
    if (!booked.ok || !booked.booking) {
      const err = booked.error ?? { code: "book_refused", message: "the resources are taken" };
      throw new DoorError(err.message, "book_refused", 409);
    }
    const bookingId = booked.booking.id;
    const unbook = async () => {
      try {
        await doors.rm.pop(bookingId);
      } catch {
      }
    };
    const lazy = lazyOutputs(def, filled.values, (p) => existsSync(p));
    const launch = resolveLaunch(def, lazy.values);
    if (!launch.command) {
      await unbook();
      throw new DoorError("the definition offers no launch command", "no_launch", 500);
    }
    if (launch.missing.length) {
      await unbook();
      throw new DoorError(`unresolved launch token(s): ${launch.missing.join(", ")}`, "unresolved_tokens", 500);
    }
    const outputV = (def.variables?.input ?? []).find((v) => v?.role === "output" && typeof v.name === "string");
    const outputPath = outputV ? lazy.values[outputV.name] ?? null : null;
    let rec;
    try {
      rec = await doors.pw.launch({ command: launch.command, name: def.name, tag: "basic" });
    } catch (e) {
      await unbook();
      throw e;
    }
    current = {
      runId: rec.id,
      name: def.name,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      command: launch.command,
      outputPath,
      gui: def.gui && def.gui.value ? { kind: def.gui.kind, value: def.gui.value, note: def.gui.note } : null,
      progressHow: def.progress?.how ?? null,
      bookingId,
      pid: rec.pid ?? null
    };
    startWatch();
    try {
      await doors.state.register("Basic.Run." + def.name, {
        status: "running",
        runId: rec.id,
        pid: rec.pid ?? null,
        startedAt: current.startedAt,
        command: launch.command,
        outputPath,
        progressHow: current.progressHow
      });
      await doors.state.register("Basic", { value: "highlighted", note: `${def.name} running` });
    } catch {
    }
    eh?.trigger?.("basic.run-started", { name: def.name, runId: rec.id, command: launch.command }, { source: "user" });
    const started = await view();
    return { ok: true, run: started.run, outputPath, freshOutput: lazy.changed };
  }
  async function openGui() {
    if (!current?.gui?.value) throw new DoorError("this run offers no gui", "no_gui", 404);
    const kind = String(current.gui.kind ?? "url");
    const value = current.gui.value;
    const command = kind === "url" ? `start "" "${value}"` : value;
    const rec = await doors.pw.launch({ command, name: current.name + ":gui", tag: "basic-gui", shell: true });
    return { ok: true, runId: rec.id };
  }
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    const method = (req.method ?? "GET").toUpperCase();
    try {
      if (segments[0] === "api" && segments[1] === "basic") {
        const rest = segments.slice(2);
        if (method === "GET" && rest[0] === "services" && rest.length === 1) {
          return sendJson(res, 200, await doors.services.list());
        }
        if (method === "GET" && rest[0] === "services" && rest.length === 2) {
          return sendJson(res, 200, await doors.services.get(rest[1]));
        }
        if (method === "GET" && rest[0] === "services" && rest.length === 3) {
          const half = rest[2] === "inputs" ? "inputs" : rest[2] === "ad" ? "ad" : null;
          if (!half) return fail(res, 404, "no_route", "pages are ad or inputs");
          const html = await doors.services.page(rest[1], half);
          return send(res, 200, html, "text/html; charset=utf-8");
        }
        if (method === "GET" && rest[0] === "state" && rest.length === 1) {
          return sendJson(res, 200, await view());
        }
        if (method === "GET" && rest[0] === "progress" && rest.length === 1) {
          if (!current) return fail(res, 404, "no_run", "nothing is running");
          const from = Number(url.searchParams.get("from") ?? "0") || 0;
          const out = await doors.pw.output(current.runId, from);
          return sendJson(res, 200, { ok: true, runId: current.runId, from: out.next, text: out.text });
        }
        if (method === "POST" && rest[0] === "run" && rest.length === 1) {
          const body = await readBody(req);
          return sendJson(res, 200, await startRun(body));
        }
        if (method === "POST" && rest[0] === "stop" && rest.length === 1) {
          if (!current) return fail(res, 404, "no_run", "nothing is running");
          const body = await readBody(req);
          const kill = await doors.pw.kill(current.runId, body.force === true);
          return sendJson(res, 200, { ok: true, kill });
        }
        if (method === "POST" && rest[0] === "gui" && rest.length === 1) {
          return sendJson(res, 200, await openGui());
        }
        return fail(res, 404, "no_route", `no basic route at /${segments.join("/")}`);
      }
      if (method === "GET") {
        const rel = segments.length === 0 ? "index.html" : segments.join("/");
        const target = path.resolve(publicDir, rel);
        if (!target.startsWith(path.resolve(publicDir))) return fail(res, 403, "forbidden", "outside the root");
        try {
          const data = await readFile(target);
          const ext = path.extname(target).toLowerCase();
          return send(res, 200, data.toString("utf8"), MIME[ext] ?? "application/octet-stream");
        } catch {
          return fail(res, 404, "no_route", "no such file \u2014 the API lives under /api/basic");
        }
      }
      return fail(res, 404, "no_route", "no such route");
    } catch (e) {
      if (e instanceof DoorError) return fail(res, e.status || 500, e.code, e.message);
      return fail(res, 500, "internal", e instanceof Error ? e.message : String(e));
    }
  }
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  return {
    url: `http://${host}:${port}`,
    port,
    stop: () => new Promise((resolve) => {
      stopWatch();
      server.close(() => resolve());
    })
  };
}
async function stubDoor(answer) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size <= 1e6) chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const url = new URL(req.url ?? "/", "http://x");
      calls.push({ method: req.method ?? "GET", path: url.pathname + url.search, body });
      const hit = answer(req.method ?? "GET", url.pathname, body);
      if (!hit) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "no_route", message: "stub" } }));
        return;
      }
      res.writeHead(hit.status ?? 200, { "content-type": "application/json; charset=utf-8", ...hit.headers ?? {} });
      res.end(hit.text ?? JSON.stringify(hit.json ?? null));
    });
  });
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
    })
  };
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL basicServer :: ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const demoDef = {
    name: "demo",
    provider: { launch: "echo {{prompt}}" },
    variables: { input: [{ name: "prompt", required: true }, { name: "out", role: "output", default: "C:/tmp/out.txt" }] },
    needs: { gpu: true, ramMb: 1e3 },
    progress: { how: "stdout", source: "stdout" },
    gui: { kind: "url", value: "http://127.0.0.1:8080" }
  };
  let pwEnded = false;
  let pwKilled = false;
  const pwRec = () => ({
    id: "p1",
    name: "demo",
    tag: "basic",
    pid: 111,
    life: pwEnded ? "ended" : "running",
    spawnedAt: Date.now(),
    endedAt: pwEnded ? Date.now() : null,
    exitCode: pwEnded ? 0 : null,
    signal: null,
    error: null
  });
  const services = await stubDoor((m, p) => {
    if (p === "/api/services") return { json: { ok: true, services: [{ name: "demo", ok: true, what: "does a thing", provider: "app", modes: [], karma: 1 }] } };
    if (p === "/api/services/demo") return { json: { ok: true, service: demoDef } };
    if (p === "/api/services/demo/ad") return { text: "<h1>the demo ad</h1>" };
    if (p === "/api/services/demo/inputs") return { text: "<h1>the demo inputs</h1>" };
    return null;
  });
  const pw = await stubDoor((m, p, b) => {
    if (m === "POST" && p === "/api/processes") return { json: { ok: true, process: pwRec() } };
    if (m === "GET" && p === "/api/processes/p1") return { json: { ok: true, process: pwRec() } };
    if (m === "GET" && p.startsWith("/api/processes/p1/output")) return { text: "tick 1", headers: { "x-pw-to": "6" } };
    if (m === "POST" && p === "/api/processes/p1/kill") {
      pwKilled = true;
      pwEnded = true;
      return { json: { ok: true } };
    }
    return null;
  });
  const rm = await stubDoor((m, p) => {
    if (p === "/api/resources/refresh") return { json: { ok: true, resources: { gpus: [{ name: "Demo GPU", vramMb: 4096 }] } } };
    if (m === "POST" && p === "/api/book") return { json: { ok: true, booking: { id: "b1", service: "demo" } } };
    if (p === "/api/bookings/b1/pop") return { json: { ok: true } };
    return null;
  });
  const state = await stubDoor((m, p, b) => {
    if (p === "/api/state/register") return { json: { ok: true, name: b?.name } };
    return null;
  });
  const server = await createBasicServer({
    doors: { servicesUrl: services.url, pwUrl: pw.url, rmUrl: rm.url, stateUrl: state.url },
    port: 0,
    watchMs: 60
  });
  const get = async (p) => {
    const r = await fetch(server.url + p);
    return { status: r.status, body: await r.json() };
  };
  const post = async (p, body) => {
    const r = await fetch(server.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const listed = await get("/api/basic/services");
  ok("the listing rides from the services door", listed.body.ok === true);
  const ad = await fetch(server.url + "/api/basic/services/demo/ad");
  ok("an ad page rides through as html", ad.headers.get("content-type")?.includes("text/html") === true && (await ad.text()).includes("demo ad"));
  const idle = await get("/api/basic/state");
  ok("idle reads busy:false", idle.body.busy === false);
  const run = await post("/api/basic/run", { name: "demo", values: { prompt: "hello" } });
  ok("a run books, launches and answers ok", run.status === 200 && run.body.ok === true && run.body.run.runId === "p1", JSON.stringify({ status: run.status, body: run.body }));
  ok("the launch carried resolved tokens", pw.calls.find((c) => c.method === "POST" && c.path === "/api/processes")?.body?.command === "echo hello");
  ok("the booking was the register's own poll and book", rm.calls.some((c) => c.path === "/api/resources/refresh") && rm.calls.some((c) => c.path === "/api/book"));
  const busyState = await get("/api/basic/state");
  ok("a run is busy right away", busyState.body.busy === true);
  const second = await post("/api/basic/run", { name: "demo", values: { prompt: "again" } });
  ok("one at a time \u2014 a second run is refused busy", second.status === 409 && second.body.error?.code === "busy");
  const progress = await get("/api/basic/progress?from=0");
  ok("progress copies the live output", progress.body.text === "tick 1" && progress.body.from === 6);
  const stop = await post("/api/basic/stop", {});
  ok("the stop reaches the wrapper", stop.body.ok === true && Boolean(pwKilled));
  await wait(240);
  const after = await get("/api/basic/state");
  ok("the ending clears busy on its own", after.body.busy === false);
  ok("the booking popped at the end", rm.calls.some((c) => c.path === "/api/bookings/b1/pop"));
  const registered = state.calls.filter((c) => c.path === "/api/state/register").map((c) => c.body?.name);
  ok("state held the run record", registered.includes("Basic.Run.demo"));
  ok("state held the tab visual", registered.includes("Basic"));
  const step = await fetch(server.url + "/");
  ok("the UI page is served", step.status === 200 && (await step.text()).includes("<html"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[basicServer] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
  await server.stop();
  await Promise.all([services.close(), pw.close(), rm.close(), state.close()]);
}
export {
  createBasicServer,
  runTests
};
//# sourceMappingURL=basicServer.js.map
