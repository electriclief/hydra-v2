class DoorError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "DoorError";
    this.code = code;
    this.status = status;
  }
}
function createDoors(config, fetchImpl = fetch) {
  const base = (u) => u.replace(/\/+$/, "");
  async function json(baseUrl, pathName, init = {}) {
    const res = await fetchImpl(base(baseUrl) + pathName, init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = data?.error;
      throw new DoorError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
    }
    return data;
  }
  const post = (body) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  return {
    services: {
      list: () => json(config.servicesUrl, "/api/services"),
      get: (name) => json(
        config.servicesUrl,
        "/api/services/" + encodeURIComponent(name)
      ),
      page: async (name, half) => {
        const res = await fetchImpl(base(config.servicesUrl) + "/api/services/" + encodeURIComponent(name) + "/" + half);
        const text = await res.text();
        if (!res.ok) throw new DoorError(`no ${half} page for ${name}`, "no_page", res.status);
        return text;
      }
    },
    pw: {
      launch: async (body) => {
        const data = await json(
          config.pwUrl,
          "/api/processes",
          post(body)
        );
        const rec = data.process ?? data.record ?? data;
        return rec;
      },
      get: async (id) => {
        try {
          const data = await json(
            config.pwUrl,
            "/api/processes/" + encodeURIComponent(id)
          );
          return data.process ?? data.record ?? data;
        } catch (e) {
          if (e instanceof DoorError && e.status === 404) return null;
          throw e;
        }
      },
      list: async (tag) => {
        const q = tag ? "?tag=" + encodeURIComponent(tag) : "";
        const data = await json(
          config.pwUrl,
          "/api/processes" + q
        );
        return data.processes ?? data.items ?? [];
      },
      output: async (id, from) => {
        const res = await fetchImpl(
          base(config.pwUrl) + "/api/processes/" + encodeURIComponent(id) + "/output?from=" + Math.max(0, Math.floor(from))
        );
        const text = await res.text();
        if (!res.ok) throw new DoorError(`no output for ${id}`, "no_output", res.status);
        const headerTo = Number(res.headers.get("x-pw-to"));
        return { text, next: Number.isFinite(headerTo) && headerTo >= 0 ? headerTo : from + text.length };
      },
      kill: (id, force = false) => json(config.pwUrl, "/api/processes/" + encodeURIComponent(id) + "/kill", post({ force }))
    },
    rm: {
      refresh: () => json(config.rmUrl, "/api/resources/refresh", post({})),
      book: async (input) => {
        const res = await fetchImpl(base(config.rmUrl) + "/api/book", post(input));
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (data && typeof data === "object" && "ok" in data) {
          return data;
        }
        const err = data?.error;
        throw new DoorError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
      },
      pop: (id) => json(config.rmUrl, "/api/bookings/" + encodeURIComponent(id) + "/pop", post({}))
    },
    state: {
      register: (name, content, extra) => json(config.stateUrl, "/api/state/register", post({ name, content, ...extra ?? {} })),
      pull: (name) => json(config.stateUrl, "/api/state/pull?name=" + encodeURIComponent(name)),
      drop: (name) => json(config.stateUrl, "/api/state/drop", post({ name }))
    }
  };
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL doors :: ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const calls = [];
  const answers = [
    { match: "/api/services/demo/ad", body: "<h1>ad</h1>" },
    { match: "/api/services", body: JSON.stringify({ ok: true, services: [{ name: "demo", ok: true }] }) },
    { match: "/api/processes?tag=basic", body: JSON.stringify({ ok: true, processes: [{ id: "p1", life: "running" }] }) },
    { match: "/api/processes/p1/output", body: "hello", headers: { "x-pw-to": "5" } },
    { match: "/api/resources/refresh", body: JSON.stringify({ ok: true, resources: { gpus: [{ name: "RX 6800", vramMb: 16368 }] } }) },
    { match: "/api/book", body: JSON.stringify({ ok: false, error: { code: "double_booked", message: "held", blockers: [] } }) }
  ];
  const fakeFetch = (async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = answers.find((a) => u.includes(a.match));
    if (!hit) return new Response('{"error":{"code":"no_route","message":"stub"}}', { status: 404 });
    return new Response(hit.body ?? "", { status: hit.status ?? 200, headers: hit.headers });
  });
  const doors = createDoors(
    { servicesUrl: "http://x:1", pwUrl: "http://x:2", rmUrl: "http://x:3", stateUrl: "http://x:4" },
    fakeFetch
  );
  const list = await doors.services.list();
  ok("services.list answers from its door", list.ok === true && list.services[0].name === "demo");
  const ad = await doors.services.page("demo", "ad");
  ok("a page rides out as text", ad === "<h1>ad</h1>");
  const procs = await doors.pw.list("basic");
  ok("pw.list filters by tag in the URL", calls.some((c) => c.url.includes("?tag=basic")) && procs[0].id === "p1");
  const out = await doors.pw.output("p1", 0);
  ok("an output copy carries the next offset", out.text === "hello" && out.next === 5);
  const refresh = await doors.rm.refresh();
  ok("rm.refresh reads gpus", (refresh.resources.gpus ?? [])[0]?.name === "RX 6800");
  const booked = await doors.rm.book({ service: "demo" });
  ok("a book refusal is a normal outcome, not a throw", booked.ok === false && booked.error?.code === "double_booked");
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[doors] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  DoorError,
  createDoors,
  runTests
};
//# sourceMappingURL=doors.js.map
