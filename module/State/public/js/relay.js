const clean = (base) => String(base || "").replace(/\/+$/, "");
async function ask(url, timeoutMs, notState) {
  const ctl = new AbortController();
  let timer = null;
  const hardStop = new Promise((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return { kind: "wrong_protocol" };
      }
      if (notState(res.status, body)) return { kind: "wrong_protocol" };
      if (!res.ok || !body || body.ok !== true) {
        const code = String(body?.error?.code || "");
        const why = typeof body?.why === "string" ? body.why : code === "no_such_entry" ? "absent" : "unreachable";
        return { kind: "absent", why };
      }
      return { kind: "ok", body };
    } catch (error) {
      return { kind: error?.name === "AbortError" ? "timeout" : "unreachable" };
    }
  })();
  try {
    return await Promise.race([work, hardStop]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function relayPull(to, name, via = [], timeoutMs = 900, hops = 0) {
  const base = clean(to);
  if (!base) return { ok: false, value: null, source: base, hops, via, why: "absent" };
  if (via.includes(base)) return { ok: false, value: null, source: base, hops, via: [...via, base], why: "cycle" };
  const chain = [...via, base];
  const node = `${base}/api/state/pull?${new URLSearchParams({ name, follow: "1", via: chain.join(",") }).toString()}`;
  const first = await ask(node, timeoutMs, (status, body) => status === 404 && String(body?.error?.code || "") !== "no_such_entry");
  if (first.kind === "ok") {
    const body = first.body;
    return {
      ok: true,
      value: body.content ?? null,
      source: base,
      hops: typeof body.hops === "number" ? body.hops : hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : chain,
      full: body.full !== false,
      marks: body.marks && typeof body.marks === "object" ? body.marks : {},
      name: typeof body.name === "string" ? body.name : name,
      at: typeof body.at === "string" ? body.at : void 0,
      proto: "state"
    };
  }
  if (first.kind === "absent") {
    return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: first.why || "absent", proto: "state" };
  }
  if (first.kind === "timeout") return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: "timeout" };
  if (first.kind === "unreachable") return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: "unreachable" };
  const app = await ask(`${base}/api/resolve?name=${encodeURIComponent(name)}`, timeoutMs, () => false);
  if (app.kind === "ok") {
    const body = app.body;
    return {
      ok: true,
      value: body.content ?? body.value ?? null,
      source: base,
      hops: hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : chain,
      full: true,
      marks: {},
      name: typeof body.name === "string" ? body.name : name,
      at: typeof body.at === "string" ? body.at : void 0,
      proto: "resolve"
    };
  }
  if (app.kind === "absent") return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: app.why || "absent", proto: "resolve" };
  return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: app.kind === "timeout" ? "timeout" : "unreachable" };
}
async function runTests() {
  const { createServer } = await import("node:http");
  const serve = (handler) => new Promise((resolve) => {
    const server = createServer((req, res) => handler(new URL(req.url || "/", "http://x"), res));
    server.listen(
      0,
      "127.0.0.1",
      () => resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(() => r()))
      })
    );
  });
  const json = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    res.end(text);
  };
  const registry = await serve((url, res) => {
    if (url.pathname === "/api/state/pull") return json(res, 200, { ok: true, name: url.searchParams.get("name"), content: { cycle: 7 } });
    return json(res, 404, { ok: false, error: { code: "no_route" } });
  });
  const viaState = await relayPull(registry.base, "node.x.cycle");
  console.assert(viaState.ok && viaState.proto === "state", "a registry answers on the registry protocol");
  console.assert(viaState.value?.cycle === 7, "the registry answer is the value");
  await registry.close();
  const adapter = await serve((url, res) => {
    if (url.pathname === "/api/resolve") return json(res, 200, { ok: true, name: url.searchParams.get("name"), content: { pct: 42 }, at: "now" });
    return json(res, 404, { ok: false, why: "no_route", detail: "/api/state/pull is not a route here" });
  });
  const viaApp = await relayPull(adapter.base, "foo_bar.progress");
  console.assert(viaApp.ok && viaApp.proto === "resolve", "an app adapter answers on the adapter protocol");
  console.assert(viaApp.value?.pct === 42, "the adapter answer is the value");
  await adapter.close();
  const stale = await serve((url, res) => {
    if (url.pathname === "/api/resolve") return json(res, 200, { ok: false, why: "stale", name: url.searchParams.get("name") });
    return json(res, 404, { ok: false, error: { code: "no_route" } });
  });
  const viaStale = await relayPull(stale.base, "foo_bar.progress");
  console.assert(viaStale.ok === false && viaStale.why === "stale", "an adapter absence keeps its own reason");
  await stale.close();
  let adapterHits = 0;
  const picky = await serve((url, res) => {
    if (url.pathname === "/api/state/pull") return json(res, 404, { ok: false, error: { code: "no_such_entry" } });
    adapterHits += 1;
    return json(res, 200, { ok: true, content: "should never be reached" });
  });
  const viaPicky = await relayPull(picky.base, "node.x.nope");
  console.assert(viaPicky.ok === false && viaPicky.why === "absent", "a registry absence is final");
  console.assert(adapterHits === 0, "the adapter protocol is not tried after an honest registry absence");
  await picky.close();
  const page = await serve((_url, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>studio menu</html>");
  });
  const viaPage = await relayPull(page.base, "x.y");
  console.assert(viaPage.ok === false && viaPage.why === "unreachable", "a web page is not a state answer");
  await page.close();
  const loop = await relayPull("http://127.0.0.1:9", "x.y", ["http://127.0.0.1:9"]);
  console.assert(loop.ok === false && loop.why === "cycle", "a link back to one already walked is refused");
  const dead = await relayPull("http://127.0.0.1:9", "x.y", [], 400);
  console.assert(dead.ok === false && (dead.why === "unreachable" || dead.why === "timeout"), "a dead port is unreachable or timeout");
}
export {
  relayPull,
  runTests
};
//# sourceMappingURL=relay.js.map
