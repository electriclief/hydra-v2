class EventHandlerError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "EventHandlerError";
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
function createEventHandlerClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8126").replace(/\/+$/, "");
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
      throw new EventHandlerError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
    }
    return data;
  }
  return {
    health: () => api("/health"),
    list: () => api("/api/events"),
    trigger: async (name, payload, source) => {
      const answer = await api("/api/events/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source ? { name, payload, source } : { name, payload })
      });
      return answer.receipt;
    },
    readLog: (query = {}) => {
      const params = new URLSearchParams();
      if (query.limit) params.set("limit", String(query.limit));
      if (query.sinceHours) params.set("sinceHours", String(query.sinceHours));
      if (query.name) params.set("name", query.name);
      if (query.source) params.set("source", query.source);
      const qs = params.toString();
      return api("/api/events/log" + (qs ? "?" + qs : ""));
    },
    purge: () => api("/api/events/purge", { method: "POST" }),
    stream: async (handlers, signal) => {
      const suffix = token ? "?token=" + encodeURIComponent(token) : "";
      const res = await fetch(baseUrl + "/api/events/stream" + suffix, { signal });
      if (!res.ok || !res.body) throw new EventHandlerError(`stream refused (HTTP ${res.status})`, "stream_failed", res.status);
      for await (const frame of parseSse(res.body)) {
        if (frame.event === "ready") {
          handlers.onReady?.();
          continue;
        }
        if (frame.event === "event") {
          try {
            handlers.onEvent?.(JSON.parse(frame.data));
          } catch {
          }
        }
      }
    }
  };
}
async function runTests() {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createEventHandler } = await import("./eventHandler.js");
  const { startApiServer } = await import("./apiServer.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-client-"));
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const handler = createEventHandler({ logPath: path.join(dir, "events.log"), purgeIntervalMs: 0 });
  handler.start();
  handler.register("demo", (payload) => ({ got: payload }));
  const api = await startApiServer({ handler, port: 0 });
  const client = createEventHandlerClient({ baseUrl: api.url });
  const health = await client.health();
  ok("health through the client", health.ok === true);
  const list = await client.list();
  ok("list through the client", list.events.length === 1 && list.events[0].name === "demo");
  const receipt = await client.trigger("demo", { n: 5 }, "agent");
  ok("trigger through the client", receipt.ok === true && receipt.source === "agent");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logged = await client.readLog({ name: "demo.result" });
  ok("readLog finds the outcome", logged.matched === 1, JSON.stringify(logged).slice(0, 120));
  let refused = null;
  try {
    await client.trigger("nope");
  } catch (err) {
    refused = err instanceof EventHandlerError ? err : null;
  }
  ok("an unknown event throws with the server code", refused !== null && refused.code === "no_such_event", refused ? refused.code : "no throw");
  const controller = new AbortController();
  const seen = [];
  let ready = false;
  const pump = client.stream({ onReady: () => {
    ready = true;
  }, onEvent: (line) => seen.push(line.name) }, controller.signal).catch(() => {
  });
  for (let i = 0; i < 40 && !ready; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  await client.trigger("demo", { live: true }, "user");
  for (let i = 0; i < 40 && seen.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  ok("the stream said ready", ready);
  ok("the stream carried the event", seen.includes("demo"), seen.join(","));
  controller.abort();
  await pump;
  await api.stop();
  handler.close();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  EventHandlerError,
  createEventHandlerClient,
  parseSse,
  runTests
};
//# sourceMappingURL=client.js.map
