class StateError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "StateError";
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
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length || event !== "message") yield { event, data: dataLines.join("\n") };
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
function createStateClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8127").replace(/\/+$/, "");
  const token = options.token ?? null;
  async function api(pathName, init = {}) {
    const url = new URL(baseUrl + pathName);
    if (token) url.searchParams.set("token", token);
    const res = await fetch(url, init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = data?.error;
      throw new StateError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
    }
    return data;
  }
  return {
    health: () => api("/health"),
    discover: (query) => api("/api/state" + (query ? "?q=" + encodeURIComponent(query) : "")),
    pull: (name, marks) => {
      const params = new URLSearchParams({ name });
      if (marks && Object.keys(marks).length) params.set("marks", JSON.stringify(marks));
      return api("/api/state/pull?" + params.toString());
    },
    register: (name, content, standing = {}) => api("/api/state/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, content, serving: standing.serving, render: standing.render, update: standing.update })
    }),
    drop: (name) => api("/api/state/drop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    }),
    stream: async (handlers, signal) => {
      const suffix = token ? "?token=" + encodeURIComponent(token) : "";
      const res = await fetch(baseUrl + "/api/state/stream" + suffix, { signal });
      if (!res.ok || !res.body) throw new StateError(`stream refused (HTTP ${res.status})`, "stream_failed", res.status);
      for await (const frame of parseSse(res.body)) {
        if (frame.event === "ready") {
          handlers.onReady?.();
          continue;
        }
        if (frame.event === "change") {
          try {
            handlers.onChange?.(JSON.parse(frame.data));
          } catch {
          }
        }
      }
    }
  };
}
async function runTests() {
  const { createStateRegistry } = await import("./stateRegistry.js");
  const { startApiServer } = await import("./apiServer.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const state = createStateRegistry();
  state.register("demo.entry", { a: 1, log: "p1\np2\np3" }, { serving: { log: "delta" } });
  const api = await startApiServer({ state, port: 0 });
  const client = createStateClient({ baseUrl: api.url });
  const health = await client.health();
  ok("health through the client", health.ok === true);
  const listing = await client.discover();
  ok("discover through the client", listing.entries.length === 1 && listing.entries[0].path === "demo.entry");
  const full = await client.pull("demo.entry");
  ok("pull through the client answers full + mark", full.ok === true && full.marks.log === 3);
  const delta = await client.pull("demo.entry", { log: 1 });
  ok("a marked pull answers the delta", delta.ok === true && delta.full === false && delta.content.log === "p2\np3");
  const registered = await client.register("client.obj", { n: 9 }, { serving: { n: "delta" } });
  ok("register through the client", registered.ok === true && registered.entry.serving.n === "delta");
  let refused = null;
  try {
    await client.pull("nope");
  } catch (err) {
    refused = err instanceof StateError ? err : null;
  }
  ok("an unknown entry throws with the server code", refused !== null && refused.code === "no_such_entry", refused ? refused.code : "no throw");
  const controller = new AbortController();
  const seen = [];
  let ready = false;
  const pump = client.stream({ onReady: () => {
    ready = true;
  }, onChange: (frame) => seen.push(frame.kind + ":" + frame.path) }, controller.signal).catch(() => {
  });
  for (let i = 0; i < 40 && !ready; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  await client.register("live.one", { x: 1 });
  for (let i = 0; i < 40 && seen.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  ok("the stream said ready", ready);
  ok("the stream carried the change", seen.includes("registered:live.one"), seen.join(","));
  controller.abort();
  await pump;
  const dropped = await client.drop("live.one");
  ok("drop through the client", dropped.dropped === true);
  await api.stop();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  StateError,
  createStateClient,
  parseSse,
  runTests
};
//# sourceMappingURL=client.js.map
