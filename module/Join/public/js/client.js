import http from "node:http";
const jsonOf = async (res) => await res.json();
class JoinClient {
  baseUrl;
  timeoutMs;
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8131").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 4e3;
  }
  async get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    return jsonOf(res);
  }
  /** Everything this node has: modules (should + is, kept apart) and the offered catalog. */
  shelf() {
    return this.get("/api/shelf");
  }
  /**
   * Resolve ONE name. A 404 is a real answer here (genuinely absent) and comes back with
   * the alternatives — so this never dead-ends.
   */
  async resolve(name) {
    const res = await fetch(`${this.baseUrl}/api/resolve/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    return jsonOf(res);
  }
  health() {
    return this.get("/health");
  }
}
function createJoinClient(options = {}) {
  return new JoinClient(options);
}
function runTests() {
  let server;
  const up = http.createServer((rq, rs) => {
    const url = rq.url ?? "";
    if (url.startsWith("/api/resolve/State")) {
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify({ ok: true, name: "State", found: true, port: 8127, liveness: "up" }));
    } else if (url.startsWith("/api/resolve/")) {
      rs.writeHead(404, { "content-type": "application/json" });
      rs.end(JSON.stringify({ ok: false, found: false, liveness: "absent", alternatives: ["State"] }));
    } else {
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify({ ok: true, modules: [], offered: [] }));
    }
  });
  void (async () => {
    try {
      await new Promise((r) => up.listen(0, "127.0.0.1", () => r()));
      server = up;
      const port = up.address().port;
      const c = createJoinClient({ baseUrl: `http://127.0.0.1:${port}` });
      const h = await c.health();
      console.assert(h.ok === true, "the client reads health from a real door", String(h.ok));
      const s = await c.shelf();
      console.assert(Array.isArray(s.modules), "the client reads the shelf", String(Array.isArray(s.modules)));
      const found = await c.resolve("State");
      console.assert(found.found === true && found.port === 8127, "a found name comes back whole", JSON.stringify(found));
      const absent = await c.resolve("Nope");
      console.assert(
        absent.found === false && absent.alternatives.includes("State"),
        "a refusal arrives as data with its alternatives, not as an exception",
        JSON.stringify(absent.alternatives)
      );
      const odd = await c.resolve("two words");
      console.assert(odd.found === false, "a name with a space is encoded, not mangled", String(odd.found));
    } catch (e) {
      console.assert(false, "the client suite ran without a crash", e instanceof Error ? e.message : String(e));
    } finally {
      if (server) server.close();
    }
  })();
}
export {
  JoinClient,
  createJoinClient,
  runTests
};
//# sourceMappingURL=client.js.map
