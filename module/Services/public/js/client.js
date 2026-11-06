class ServicesError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServicesError";
    this.code = code;
    this.status = status;
  }
}
function createServicesClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8128").replace(/\/+$/, "");
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
      throw new ServicesError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
    }
    return data;
  }
  const halfUrl = (name, half) => {
    const suffix = token ? "?token=" + encodeURIComponent(token) : "";
    return `${baseUrl}/api/services/${encodeURIComponent(name)}/${half}${suffix}`;
  };
  const readPage = async (name, half) => {
    const res = await fetch(halfUrl(name, half));
    const text = await res.text();
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      let code = "http_error";
      try {
        const err = JSON.parse(text).error;
        if (err?.message) message = err.message;
        if (err?.code) code = err.code;
      } catch {
      }
      throw new ServicesError(message, code, res.status);
    }
    return text;
  };
  return {
    health: () => api("/health"),
    list: (filter) => api("/api/services" + (filter ? "?filter=" + encodeURIComponent(filter) : "")),
    get: (name) => api("/api/services/" + encodeURIComponent(name)),
    ad: (name) => readPage(name, "ad"),
    inputs: (name) => readPage(name, "inputs"),
    adUrl: (name) => halfUrl(name, "ad"),
    inputsUrl: (name) => halfUrl(name, "inputs"),
    reload: () => api("/api/services/reload", { method: "POST" }),
    validate: (name) => api("/api/services/validate").then(
      (report) => name ? { ok: report.reports.filter((r) => r.name === name).every((r) => r.ok), reports: report.reports.filter((r) => r.name === name) } : report
    )
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createServiceCatalog } = await import("./serviceCatalog.js");
  const { startApiServer } = await import("./apiServer.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-client-"));
  fs.writeFileSync(
    path.join(dir, "demo.js"),
    'module.exports = { name: "demo", advert: { what: "a demo", karma: 2 }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>the demo page</h1>", inputs: "<h1>in</h1>" } };'
  );
  const catalog = createServiceCatalog({ dir });
  const api = await startApiServer({ catalog, port: 0 });
  const client = createServicesClient({ baseUrl: api.url });
  const health = await client.health();
  ok("health through the client", health.ok === true);
  const listing = await client.list();
  ok("list through the client", listing.services.length === 1 && listing.services[0].name === "demo");
  const filtered = await client.list("demo");
  ok("a filter walks the client", filtered.services.length === 1);
  const filteredOut = await client.list("zzz");
  ok("a filter can exclude", filteredOut.services.length === 0);
  const one = await client.get("demo");
  ok("get through the client", one.ok === true && String(one.service.advert.what) === "a demo");
  const ad = await client.ad("demo");
  ok("the ad page reads as html text", ad.includes("<h1>the demo page</h1>"));
  const inPage = await client.inputs("demo");
  ok("the inputs page reads as html text", inPage.includes("<h1>in</h1>"));
  ok("the urls encode the name", client.adUrl("demo").endsWith("/api/services/demo/ad") && client.inputsUrl("demo").endsWith("/api/services/demo/inputs"));
  let refused = null;
  try {
    await client.get("nope");
  } catch (err) {
    refused = err instanceof ServicesError ? err : null;
  }
  ok("an unknown service throws with the server code", refused !== null && refused.code === "no_such_service", refused ? refused.code : "no throw");
  fs.writeFileSync(path.join(dir, "two.js"), 'module.exports = { name: "two", advert: { what: "second" }, provider: { name: "demo app" }, pages: { ad: "<h1>two</h1>", inputs: "<h1>in</h1>" } };');
  const reloaded = await client.reload();
  ok("reload through the client", reloaded.count === 2);
  const validate = await client.validate();
  ok("validate through the client", validate.ok === true && validate.reports.length === 2);
  const validateOne = await client.validate("two");
  ok("validate narrows by name", validateOne.reports.length === 1 && validateOne.reports[0].name === "two");
  await api.stop();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ServicesError,
  createServicesClient,
  runTests
};
//# sourceMappingURL=client.js.map
