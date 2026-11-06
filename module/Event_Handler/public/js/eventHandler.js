import { createLogStore } from "./logStore.js";
const NAME_RE = /^[a-z0-9][a-z0-9._\- ]{0,63}$/i;
class EventHandler {
  store;
  events = /* @__PURE__ */ new Map();
  watchers = /* @__PURE__ */ new Set();
  constructor(options) {
    this.store = createLogStore({
      file: options.logPath,
      retentionHours: options.retentionHours,
      maxBytes: options.maxBytes,
      purgeIntervalMs: options.purgeIntervalMs
    });
  }
  /** Create the log file, trim it once, arm the periodic self-trim. */
  start() {
    this.store.start();
    return this;
  }
  /** Put an event on the palette. The handler IS the action. */
  register(name, handler, meta = {}) {
    if (!NAME_RE.test(name)) {
      throw new Error(`bad event name: ${name} \u2014 letters/digits/._- and spaces only`);
    }
    if (name.endsWith(".result") || name.endsWith(".error")) {
      throw new Error(`name ${name} is reserved for outcome events`);
    }
    if (this.events.has(name)) {
      throw new Error(`event already registered: ${name}`);
    }
    this.events.set(name, {
      handler,
      meta,
      registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
      fired: 0,
      results: 0,
      errors: 0,
      lastAt: null
    });
    return this.describe(name);
  }
  unregister(name) {
    return this.events.delete(name);
  }
  has(name) {
    return this.events.has(name);
  }
  /** The palette — what can be fired here. */
  list() {
    return Array.from(this.events.keys()).sort().map((name) => this.describe(name)).filter((row) => row !== null);
  }
  describe(name) {
    const slot = this.events.get(name);
    if (!slot) return null;
    return {
      name,
      description: slot.meta.description ?? null,
      registeredAt: slot.registeredAt,
      fired: slot.fired,
      results: slot.results,
      errors: slot.errors,
      lastAt: slot.lastAt
    };
  }
  /** THE ONE DOOR — a user click and an agent trigger walk the same path. Fire-and-forget. */
  trigger(name, payload, options = {}) {
    const slot = this.events.get(name);
    const source = options.source ?? "process";
    const at = (/* @__PURE__ */ new Date()).toISOString();
    if (!slot) {
      return { ok: false, code: "no_such_event", name, at, source };
    }
    const line = { t: at, name, source };
    if (payload !== void 0) line.payload = payload;
    this.write(line);
    slot.fired++;
    slot.lastAt = at;
    Promise.resolve().then(() => slot.handler(payload, { name, source })).then((result) => {
      slot.results++;
      const done = { t: (/* @__PURE__ */ new Date()).toISOString(), name: `${name}.result`, of: name, source };
      if (result !== void 0) done.result = result;
      this.write(done);
    }).catch((err) => {
      slot.errors++;
      const message = err instanceof Error ? err.message : String(err);
      this.write({ t: (/* @__PURE__ */ new Date()).toISOString(), name: `${name}.error`, of: name, source, error: message });
    });
    return { ok: true, name, at, source };
  }
  write(line) {
    this.store.append(line);
    for (const watcher of Array.from(this.watchers)) {
      try {
        watcher(line);
      } catch {
      }
    }
  }
  /** Watch the log live. Returns the unsubscribe. */
  on(watcher) {
    this.watchers.add(watcher);
    return () => this.watchers.delete(watcher);
  }
  read(options = {}) {
    return this.store.read(options);
  }
  purge() {
    return this.store.purge();
  }
  stats() {
    return this.store.stats();
  }
  close() {
    this.store.stop();
  }
}
function createEventHandler(options) {
  return new EventHandler(options);
}
async function runTests() {
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = (await import("node:fs")).mkdtempSync(path.join(os.tmpdir(), "eh-core-"));
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const waitFor = async (cond, ms = 5e3) => {
    const t02 = Date.now();
    while (Date.now() - t02 < ms) {
      if (cond()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return cond();
  };
  const handler = createEventHandler({ logPath: path.join(dir, "events.log"), purgeIntervalMs: 0 });
  handler.start();
  ok("empty palette at start", handler.list().length === 0);
  handler.register("tick", (payload) => ({ echo: payload, ok: true }), { description: "a demo tick" });
  const pal = handler.list();
  ok("register lands on the palette", pal.length === 1 && pal[0].name === "tick" && pal[0].description === "a demo tick");
  ok(
    "a duplicate is refused",
    (() => {
      try {
        handler.register("tick", () => 0);
        return false;
      } catch {
        return true;
      }
    })()
  );
  ok(
    "a bad name is refused",
    (() => {
      try {
        handler.register("bad name!", () => 0);
        return false;
      } catch {
        return true;
      }
    })()
  );
  ok(
    "a phrase name carries spaces (the operator says it that way)",
    (() => {
      try {
        handler.register("add Process Console Display", () => 0);
        return handler.list().some((e) => e.name === "add Process Console Display");
      } catch {
        return false;
      }
    })()
  );
  ok(
    "a reserved outcome suffix is refused",
    (() => {
      try {
        handler.register("x.result", () => 0);
        return false;
      } catch {
        return true;
      }
    })()
  );
  const rec = handler.trigger("tick", { n: 7 }, { source: "user" });
  ok("the receipt answers immediately", rec.ok === true && rec.source === "user" && rec.name === "tick" && typeof rec.at === "string");
  const unknown = handler.trigger("nope");
  ok("an unknown event is refused with a code", unknown.ok === false && unknown.code === "no_such_event");
  ok("the outcome event lands", await waitFor(() => handler.read({ name: "tick.result", limit: 5 }).matched === 1));
  const outcome = handler.read({ name: "tick.result", limit: 1 }).lines[0];
  ok("the outcome carries of + result", outcome.of === "tick" && JSON.stringify(outcome.result) === JSON.stringify({ echo: { n: 7 }, ok: true }));
  const triggerLine = handler.read({ name: "tick", limit: 1 }).lines[0];
  ok("the trigger line kept payload + source", JSON.stringify(triggerLine.payload) === JSON.stringify({ n: 7 }) && triggerLine.source === "user");
  handler.register("boom", () => {
    throw new Error("on purpose");
  });
  handler.trigger("boom", void 0, { source: "agent" });
  ok("the error event lands", await waitFor(() => handler.read({ name: "boom.error", limit: 5 }).matched === 1));
  const errLine = handler.read({ name: "boom.error", limit: 1 }).lines[0];
  ok("the error carries the message + source", errLine.error === "on purpose" && errLine.source === "agent");
  let finished = false;
  handler.register("slow", async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    finished = true;
    return "late";
  });
  const t0 = Date.now();
  const slowRec = handler.trigger("slow");
  const elapsed = Date.now() - t0;
  ok("the caller is not made to wait", slowRec.ok === true && elapsed < 100, String(elapsed));
  ok("the slow outcome still lands later", await waitFor(() => finished && handler.read({ name: "slow.result", limit: 5 }).matched === 1));
  const seen = [];
  const off = handler.on((line) => seen.push(line.name));
  handler.trigger("tick", { n: 8 });
  ok("a watcher sees the trigger immediately", seen.includes("tick"));
  ok("a watcher sees the outcome too", await waitFor(() => seen.includes("tick.result")));
  off();
  handler.trigger("tick");
  const sawAfterOff = seen.length;
  await new Promise((resolve) => setTimeout(resolve, 150));
  ok("unsubscribe stops the flow", seen.length === sawAfterOff);
  ok(
    "counters: fired / results / errors",
    await waitFor(() => {
      const row = handler.list().find((e) => e.name === "tick");
      return row !== void 0 && row.fired === 3 && row.results === 3;
    })
  );
  const boomRow = handler.list().find((e) => e.name === "boom");
  ok("the error counter caught the throw", boomRow !== void 0 && boomRow.errors === 1 && boomRow.results === 0);
  handler.close();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[eventHandler] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  EventHandler,
  createEventHandler,
  runTests
};
//# sourceMappingURL=eventHandler.js.map
