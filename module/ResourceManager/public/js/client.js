class RmError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "RmError";
    this.code = code;
    this.status = status;
  }
}
function createRmClient(options = {}) {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8129").replace(/\/+$/, "");
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
      throw new RmError(err?.message ?? `HTTP ${res.status}`, err?.code ?? "http_error", res.status);
    }
    return data;
  }
  return {
    health: () => api("/health"),
    resources: (refresh = false) => refresh ? api("/api/resources/refresh", { method: "POST" }) : api("/api/resources"),
    bookings: (includeEnded = false) => api("/api/bookings" + (includeEnded ? "?include=ended" : "")),
    getBooking: (id) => api("/api/bookings/" + encodeURIComponent(id)),
    book: (request) => api("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }),
    pop: (id) => api("/api/bookings/" + encodeURIComponent(id) + "/pop", { method: "POST" }),
    clear: (id) => api("/api/bookings/" + encodeURIComponent(id) + "/clear", { method: "POST" })
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createBookingStore } = await import("./bookingStore.js");
  const { startApiServer } = await import("./apiServer.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-client-"));
  const fakeReads = {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    node: "test-node",
    platform: "win32",
    cpu: { model: "fake", cores: 8, loadPct: 1 },
    ram: { totalMb: 16e3, freeMb: 9e3 },
    gpus: [{ name: "RX 6800", vramMb: 16384, vramSource: "registry", memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: "C:", freeMb: 1e5, totalMb: 5e5 }],
    shares: [],
    notes: []
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const api = await startApiServer({ store, reads: () => fakeReads, port: 0, publicDir: path.join(process.cwd(), "public") });
  const client = createRmClient({ baseUrl: api.url });
  const health = await client.health();
  ok("health through the client", health.ok === true && health.module === "resource-manager");
  const view = await client.resources();
  ok("the poll through the client", view.ok === true && view.resources.cpu.cores === 8 && Array.isArray(view.bookings));
  const booked = await client.book({ service: "image-gen", gpu: "RX 6800", cores: 4 });
  ok("book through the client lands", booked.ok === true && booked.ok && booked.booking.id.startsWith("bk-"));
  const refused = await client.book({ service: "other", gpu: "RX 6800" });
  ok("a refusal returns ok:false without throwing", refused.ok === false && !refused.ok && refused.error.code === "double_booked");
  ok("the refusal carries the wait info", refused.ok === false && !refused.ok && refused.error.blockers.length > 0);
  const list = await client.bookings(true);
  ok("bookings through the client", list.active.length === 1 && Array.isArray(list.ended));
  const bookedId = booked.ok ? booked.booking.id : "none";
  const one = await client.getBooking(bookedId);
  ok("getBooking by id", one.ok === true && one.booking.service === "image-gen");
  const popped = await client.pop(bookedId);
  ok("pop through the client", popped.ok === true && popped.booking.endReason === "popped");
  let threw = null;
  try {
    await client.pop("bk-nope");
  } catch (err) {
    threw = err instanceof RmError ? err : null;
  }
  ok("an unknown booking throws with the server code", threw !== null && threw.code === "no_such_booking", threw ? threw.code : "no throw");
  const cleared = await client.book({ service: "third", paths: ["C:/elsewhere"] });
  ok("a paths-only booking is legal (file work, no gpu)", cleared.ok === true);
  const clearedId = cleared.ok ? cleared.booking.id : "none";
  const clearedEnd = await client.clear(clearedId);
  ok("clear through the client", clearedEnd.ok === true && clearedEnd.booking.endReason === "cleared");
  const refreshed = await client.resources(true);
  ok("the forced refresh reads through the client", refreshed.ok === true && refreshed.resources.collectedAt.length > 0);
  await api.stop();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  RmError,
  createRmClient,
  runTests
};
//# sourceMappingURL=client.js.map
