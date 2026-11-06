class ProcessWrapperError extends Error {
  code;
  status;
  constructor(code, message, status) {
    super(message);
    this.name = "ProcessWrapperError";
    this.code = code;
    this.status = status;
  }
}
async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let name = null;
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (name) {
          let data = {};
          if (dataLines.length) {
            try {
              data = JSON.parse(dataLines.join("\n"));
            } catch {
              data = { raw: dataLines.join("\n") };
            }
          }
          yield { event: name, data };
        }
        sep = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.cancel().catch(() => {
    });
  }
}
function createProcessClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8125").replace(/\/+$/, "");
  const token = options.token ?? null;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const headers = (extra = {}) => ({
    "content-type": "application/json",
    ...token ? { "x-pw-token": token } : {},
    ...extra
  });
  const fail = async (res) => {
    let code = `http_${res.status}`;
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
    }
    throw new ProcessWrapperError(code, message, res.status);
  };
  const json = async (path, init = {}) => {
    const res = await doFetch(baseUrl + path, { headers: headers(), ...init });
    if (!res.ok) return fail(res);
    return await res.json();
  };
  const client = {
    baseUrl,
    health: () => json("/health"),
    list: async (filter = {}) => {
      const q = new URLSearchParams();
      if (filter.life) q.set("life", filter.life);
      if (filter.tag) q.set("tag", filter.tag);
      const body = await json(`/api/processes${q.toString() ? "?" + q.toString() : ""}`);
      return body.processes;
    },
    launch: async (req) => {
      const res = await doFetch(baseUrl + "/api/processes", { method: "POST", headers: headers(), body: JSON.stringify(req) });
      if (!res.ok) return fail(res);
      return (await res.json()).process;
    },
    get: (id) => json(`/api/processes/${encodeURIComponent(id)}`),
    output: async (id, opts = {}) => {
      const q = new URLSearchParams();
      if (opts.from != null) q.set("from", String(opts.from));
      if (opts.limit != null) q.set("limit", String(opts.limit));
      if (opts.channel) q.set("channel", opts.channel);
      const res = await doFetch(baseUrl + `/api/processes/${encodeURIComponent(id)}/output${q.toString() ? "?" + q.toString() : ""}`, { headers: headers() });
      if (!res.ok) return fail(res);
      const text = await res.text();
      return {
        text,
        channel: res.headers.get("x-pw-channel") ?? "both",
        from: Number(res.headers.get("x-pw-from") ?? 0),
        to: Number(res.headers.get("x-pw-to") ?? text.length),
        total: Number(res.headers.get("x-pw-total") ?? text.length),
        complete: res.headers.get("x-pw-complete") !== "false"
      };
    },
    file: (id) => json(`/api/processes/${encodeURIComponent(id)}/file`),
    input: (id, text) => json(`/api/processes/${encodeURIComponent(id)}/input`, { method: "POST", body: JSON.stringify({ text }) }),
    kill: async (id, opts = {}) => {
      const body = await json(`/api/processes/${encodeURIComponent(id)}/kill`, { method: "POST", body: JSON.stringify(opts) });
      return body.kill;
    },
    remove: (id) => json(`/api/processes/${encodeURIComponent(id)}`, { method: "DELETE" }),
    commands: async () => {
      const body = await json("/api/commands");
      return body.registry.commands;
    },
    saveCommand: async (def) => {
      const body = await json("/api/commands", { method: "POST", body: JSON.stringify(def) });
      return body.command;
    },
    removeCommand: async (name) => {
      await json(`/api/commands/${encodeURIComponent(name)}`, { method: "DELETE" });
      return true;
    },
    stream: async function* (id, opts = {}) {
      const q = new URLSearchParams();
      if (opts.from != null) q.set("from", String(opts.from));
      if (opts.channel) q.set("channel", opts.channel);
      const res = await doFetch(baseUrl + `/api/processes/${encodeURIComponent(id)}/stream${q.toString() ? "?" + q.toString() : ""}`, {
        headers: headers({ accept: "text/event-stream" }),
        signal: opts.signal
      });
      if (!res.ok) return fail(res);
      if (!res.body) throw new ProcessWrapperError("no_body", "the response has no body to stream", res.status);
      yield* parseSse(res.body);
    },
    follow: (id, onEvent, opts = {}) => {
      const controller = new AbortController();
      const done = (async () => {
        try {
          for await (const ev of client.stream(id, { ...opts, signal: controller.signal })) {
            if (controller.signal.aborted) break;
            onEvent(ev);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            onEvent({ event: "end", data: { reason: "client-error", error: err.message } });
          }
        }
      })();
      return {
        close: () => controller.abort(),
        done
      };
    }
  };
  return client;
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createWrapper } = await import("./processWrapper.js");
  const { createStreamHub } = await import("./streamHub.js");
  const { startApiServer } = await import("./apiServer.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-client-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 300 });
  const hub = createStreamHub(wrapper);
  const api = await startApiServer({ wrapper, hub, port: 0, token: null, registryFile: path.join(dir, "data.yaml") });
  const client = createProcessClient({ baseUrl: api.url });
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const health = await client.health();
    ok("client reaches /health", health.ok === true && health.module === "processWrapper", JSON.stringify(health));
    const proc = await client.launch({
      name: "client-echo",
      command: process.execPath,
      args: ["-e", "console.log('client-1');setTimeout(()=>console.log('client-2'),90)"]
    });
    ok("client launch returns a record", !!proc.id && typeof proc.pid === "number", JSON.stringify(proc).slice(0, 120));
    await wrapper.awaitExit(proc.id, 15e3);
    const list = await client.list();
    ok("client list sees it", list.some((p) => p.id === proc.id), String(list.length));
    const listed = await client.list({ life: "exited" });
    ok("client list filters by life", listed.some((p) => p.id === proc.id), String(listed.length));
    const copy = await client.output(proc.id);
    ok("client output carries the whole life", copy.text.includes("client-1") && copy.text.includes("client-2"), copy.text);
    ok("client output reports offsets", copy.total === copy.text.length && copy.complete === true, JSON.stringify(copy));
    const tailCopy = await client.output(proc.id, { from: 9 });
    ok("client output honours from", tailCopy.from === 9 && !tailCopy.text.includes("client-1"), JSON.stringify(tailCopy.text));
    const detail = await client.get(proc.id);
    ok("client get carries the buffer status", typeof detail.buffer.chunks === "number", JSON.stringify(detail.buffer));
    ok("client get carries the stream file", detail.streamFile.endsWith(".log"), detail.streamFile);
    const file = await client.file(proc.id);
    ok("client file names the ground truth", file.streamFile === detail.streamFile, JSON.stringify(file));
    const live = await client.launch({
      name: "client-live",
      command: process.execPath,
      args: ["-e", "console.log('A');setTimeout(()=>console.log('B'),100);setTimeout(()=>console.log('C'),220)"]
    });
    const events = [];
    const streamState = { sawEnd: false };
    for await (const ev of client.stream(live.id, { from: 0 })) {
      if (ev.event === "chunk") events.push(String(ev.data.text));
      if (ev.event === "end") {
        streamState.sawEnd = true;
        break;
      }
    }
    ok("client stream yields every line", events.join("").includes("A") && events.join("").includes("C"), events.join(""));
    ok("client stream yields the end event", streamState.sawEnd === true);
    const collected = [];
    const followState = { ended: false };
    const ticking = await client.launch({
      name: "client-follow",
      command: process.execPath,
      args: ["-e", "let i=0;const t=setInterval(()=>console.log('f'+(++i)),80);setTimeout(()=>clearInterval(t),700)"]
    });
    const handle = client.follow(ticking.id, (ev) => {
      if (ev.event === "chunk") collected.push(String(ev.data.text));
      if (ev.event === "end") followState.ended = true;
    });
    const followDeadline = Date.now() + 8e3;
    while (!collected.join("").includes("f1") && Date.now() < followDeadline) await sleep(50);
    ok("follow delivered live text", collected.join("").includes("f1"), collected.join("").slice(0, 60));
    await wrapper.awaitExit(ticking.id, 15e3);
    const endDeadline = Date.now() + 5e3;
    while (!followState.ended && Date.now() < endDeadline) await sleep(50);
    ok("follow reports the end of the life", followState.ended === true, String(followState.ended));
    handle.close();
    await handle.done;
    const echoer = await client.launch({
      name: "client-stdin",
      command: process.execPath,
      args: ["-e", "process.stdin.on('data',d=>console.log('say:'+d.toString().trim()));setInterval(()=>{},50)"]
    });
    await sleep(400);
    const wrote = await client.input(echoer.id, "hello-client\n");
    ok("client input is acknowledged", wrote.wrote === "hello-client\n".length, JSON.stringify(wrote));
    let saidBack = "";
    const saidDeadline = Date.now() + 5e3;
    while (Date.now() < saidDeadline) {
      saidBack = (await client.output(echoer.id)).text;
      if (saidBack.includes("say:hello-client")) break;
      await sleep(80);
    }
    ok("the child said it back", saidBack.includes("say:hello-client"), saidBack);
    const kill = await client.kill(echoer.id, { force: true });
    ok("client kill reports the outcome", kill.outcome === "killed" && kill.forced === true, JSON.stringify(kill));
    const removed = await client.remove(echoer.id);
    ok("client remove drops the record", removed.removed === true, JSON.stringify(removed).slice(0, 100));
    ok("the removed process is gone from the table", (await client.list()).every((p) => p.id !== echoer.id));
    const savedCmd = await client.saveCommand({ name: "client-saved", command: process.execPath, args: ["-e", "console.log('saved-here')"], description: "client test" });
    ok("client saved a command", savedCmd.name === "client-saved", JSON.stringify(savedCmd).slice(0, 100));
    const cmds = await client.commands();
    ok("client lists saved commands", cmds.some((c) => c.name === "client-saved"), String(cmds.length));
    const byName = await client.launch({ saved: "client-saved" });
    ok("client launches a saved command by name", byName.name === "client-saved", byName.name);
    await wrapper.awaitExit(byName.id, 15e3);
    ok("the saved command really ran", (await client.output(byName.id)).text.includes("saved-here"));
    ok("client dropped the saved command", await client.removeCommand("client-saved") === true);
    ok("the saved command is really gone", (await client.commands()).every((c) => c.name !== "client-saved"));
    let code = "";
    try {
      await client.get("nope-not-here");
    } catch (err) {
      code = err.code;
    }
    ok("client throws the API error code (404)", code === "not_found", code);
    let launchCode = "";
    try {
      await client.launch({});
    } catch (err) {
      launchCode = err.code;
    }
    ok("client throws the launch error code", launchCode === "launch_failed" || launchCode === "bad_json", launchCode);
    let savedCode = "";
    try {
      await client.launch({ saved: "not-saved" });
    } catch (err) {
      savedCode = err.code;
    }
    ok("client throws the missing-saved code", savedCode === "no_such_command", savedCode);
    const guarded = await startApiServer({ wrapper, hub, port: 0, token: "right", registryFile: path.join(dir, "guarded.yaml") });
    const wrong = createProcessClient({ baseUrl: guarded.url, token: "wrong" });
    let authCode = "";
    try {
      await wrong.health();
    } catch (err) {
      authCode = err.code;
    }
    ok("a wrong token is refused with unauthorized", authCode === "unauthorized", authCode);
    const right = createProcessClient({ baseUrl: guarded.url, token: "right" });
    ok("the right token works", (await right.health()).ok === true);
    await guarded.stop();
  } finally {
    await wrapper.shutdown().catch(() => {
    });
    await api.stop().catch(() => {
    });
    ok("nothing left running after the client tests", wrapper.list({ life: "running" }).length === 0);
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[processWrapperClient] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ProcessWrapperError,
  createProcessClient,
  parseSse,
  runTests
};
//# sourceMappingURL=client.js.map
