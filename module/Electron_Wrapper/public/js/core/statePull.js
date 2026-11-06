import { applySnapshot } from "./visuals.js";
import http from "node:http";
function extractVisualValue(content) {
  if (content === null || typeof content !== "object") return content;
  const o = content;
  if (o.value !== void 0) return o.value;
  if (o.visual !== void 0) return o.visual;
  if (o.state !== void 0) return o.state;
  return content;
}
function createStatePuller(options) {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const intervalMs = options.intervalMs ?? 1500;
  const fetchImpl = options.fetchImpl ?? fetch;
  let timer = null;
  async function pullOnce() {
    const snapshot = {};
    for (const name of options.names()) {
      try {
        const res = await fetchImpl(`${endpoint}/api/state/pull?name=${encodeURIComponent(name)}`);
        if (!res.ok) continue;
        const body = await res.json();
        if (!body || body.ok !== true || body.content === void 0) continue;
        snapshot[name] = extractVisualValue(body.content);
      } catch {
      }
    }
    options.onSnapshot(applySnapshot(options.names(), snapshot), snapshot);
    return snapshot;
  }
  return {
    pullOnce,
    start() {
      if (timer !== null) return;
      void pullOnce();
      timer = setInterval(() => {
        void pullOnce();
      }, intervalMs);
      if (typeof timer === "object" && timer !== null && "unref" in timer) {
        timer.unref?.();
      }
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    running() {
      return timer !== null;
    }
  };
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL statePull :: ${label}${extra ? " :: " + extra : ""}`);
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    if (url.pathname !== "/api/state/pull") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    const name = url.searchParams.get("name") ?? "";
    const table = {
      alpha: { ok: true, content: { value: "flashing" } },
      beta: { ok: true, content: { state: "highlighted" } },
      gamma: { ok: true, content: "solid" }
    };
    if (!(name in table)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "no such entry" }));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(table[name]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const endpoint = `http://127.0.0.1:${addr.port}`;
  const names = ["alpha", "beta", "gamma", "delta"];
  let lastEntries = [];
  let snapshots = 0;
  const puller = createStatePuller({
    endpoint,
    names: () => names,
    onSnapshot: (entries) => {
      lastEntries = entries;
      snapshots += 1;
    }
  });
  const snap = await puller.pullOnce();
  ok("a pull reads the door", snapshots === 1 && Object.keys(snap).length === 3);
  ok("a value field reads flashing", lastEntries.find((e) => e.name === "alpha")?.visual === "flashing");
  ok("a state field reads highlighted", lastEntries.find((e) => e.name === "beta")?.visual === "highlighted");
  ok("a plain content string reads solid", lastEntries.find((e) => e.name === "gamma")?.visual === "solid");
  ok("a missing entry reads solid (absence is absence)", lastEntries.find((e) => e.name === "delta")?.visual === "solid");
  ok("the snapshot carries only what the door served", !("delta" in snap));
  await new Promise((resolve) => server.close(() => resolve()));
  const dead = await puller.pullOnce();
  ok("a door that is down is tolerated quietly", Object.keys(dead).length === 0 && snapshots === 2);
  ok("and every tab reads solid", lastEntries.every((e) => e.visual === "solid"));
  puller.start();
  const wasRunning = puller.running();
  puller.stop();
  ok("start() runs and stop() clears", wasRunning === true && puller.running() === false);
}
export {
  createStatePuller,
  extractVisualValue,
  runTests
};
//# sourceMappingURL=statePull.js.map
