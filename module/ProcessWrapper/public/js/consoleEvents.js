import path from "node:path";
async function createConsoleEvents(options) {
  const wrapper = options.wrapper;
  const defaultCwd = options.defaultCwd ?? process.cwd();
  const logPath = options.logPath ?? path.join(process.cwd(), "data", "console-events.log");
  const ehUrl = new URL("../../../Event_Handler/Event_Handler_module.js", import.meta.url);
  const eh = await import(ehUrl.href);
  const handler = eh.createModule({ logPath }).handler;
  let added = 0;
  const findTarget = (payload) => {
    const all = wrapper.list();
    if (payload.id) return all.find((p) => p.id === payload.id) ?? null;
    if (payload.name) {
      return all.find((p) => p.name === payload.name && p.tag === "console") ?? all.find((p) => p.name === payload.name) ?? null;
    }
    return null;
  };
  const isLive = (id) => {
    const rec = wrapper.get(id);
    return Boolean(rec && (rec.life === "running" || rec.life === "starting"));
  };
  handler.register(
    "add Process Console Display",
    async (payload = {}) => {
      const supplied = { ...payload };
      const provider = payload.provider && typeof payload.provider === "object" ? payload.provider : null;
      const command = String(payload.command ?? provider?.launch ?? "").trim();
      if (!command) {
        return { ok: false, error: "no wiring: supply provider.launch (the Service Provider block) or command", supplied };
      }
      let name = String(payload.name ?? "").trim();
      if (!name) {
        added += 1;
        name = `console-${added}`;
      }
      const rec = await wrapper.launch({
        name,
        command,
        args: Array.isArray(payload.args) ? payload.args.map(String) : void 0,
        cwd: payload.cwd ? String(payload.cwd) : defaultCwd,
        env: payload.env && typeof payload.env === "object" ? payload.env : void 0,
        shell: payload.shell === true,
        // a GUI app that must be SEEN asks for it — Electron's console IS the app
        hideWindow: payload.hideWindow === false ? false : true,
        tag: "console"
      });
      return { ok: true, id: rec.id, name: rec.name, life: rec.life, streamFile: rec.streamFile, supplied };
    },
    { description: "Add a console display: name + the provider wiring (provider.launch is the command) \u2014 the wrapper launches it and the display appears" }
  );
  handler.register(
    "kill Process Console Display",
    async (payload = {}) => {
      const rec = findTarget(payload);
      if (!rec) return { ok: false, error: "no console matches that id or name", supplied: { ...payload } };
      let kill = await wrapper.kill(rec.id, {
        force: payload.force === true,
        graceMs: typeof payload.graceMs === "number" ? payload.graceMs : void 0
      });
      if (payload.force !== true && isLive(rec.id)) {
        kill = await wrapper.kill(rec.id, {
          force: true,
          graceMs: typeof payload.graceMs === "number" ? payload.graceMs : void 0
        });
      }
      const after = wrapper.get(rec.id);
      return { ok: true, id: rec.id, name: rec.name, life: after?.life ?? rec.life, kill };
    },
    { description: "Kill a console by id or name: graceful ask first, escalation to force only if it did not land (force:true skips the ask)" }
  );
  handler.register(
    "note System Drain",
    async (payload = {}) => ({ ok: true, noted: { ...payload } }),
    { description: "A drain was noticed on this machine: the watch fires it by itself; any hand may fire one. The event log keeps the receipt." }
  );
  const list = () => [
    {
      name: "add Process Console Display",
      description: "Add a console display: the wrapper launches the command and its display appears in the window.",
      fields: ["name", "provider.launch (or command)", "args", "cwd", "env", "shell"]
    },
    {
      name: "kill Process Console Display",
      description: "End a console: graceful ask first, escalation to force only if it did not land.",
      fields: ["id | name", "force", "graceMs"]
    },
    {
      name: "note System Drain",
      description: "A drain was noticed on this machine (fired by the system watch; any hand may fire one) \u2014 the event log keeps the receipt.",
      fields: ["name", "pid", "cpuPeak", "diskPeakMBs", "samples", "unexpected"]
    }
  ];
  const trigger = (name, payload = {}, source = "api") => handler.trigger(String(name), payload, { source });
  const log = (limit = 50) => handler.read({ limit });
  return {
    module: "consoleEvents",
    logPath,
    list,
    trigger,
    log,
    handler,
    close: () => handler.close()
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const { createWrapper } = await import("./processWrapper.js");
  const { createStreamHub } = await import("./streamHub.js");
  const { startApiServer } = await import("./apiServer.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const waitFor = async (cond, ms = 8e3) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return cond();
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-console-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 400 });
  const palette = await createConsoleEvents({
    wrapper,
    logPath: path.join(dir, "console-events.log"),
    defaultCwd: dir
  });
  const hub = createStreamHub(wrapper);
  const api = await startApiServer({
    wrapper,
    hub,
    port: 0,
    registryFile: path.join(dir, "data.yaml"),
    palette
  });
  const base = api.url;
  const outcomeLines = () => palette.log(500).lines;
  const latestOutcome = (ofName) => outcomeLines().filter((l) => l.name === `${ofName}.result`).pop();
  try {
    const paletteList = palette.list();
    ok("the palette lists the three doors", paletteList.length === 3 && paletteList[0].name === "add Process Console Display" && paletteList[1].name === "kill Process Console Display" && paletteList[2].name === "note System Drain", JSON.stringify(paletteList.map((p) => p.name)));
    const fired = palette.trigger("add Process Console Display", {
      name: "t-one",
      provider: { name: "node", launch: process.execPath },
      args: ["-e", "console.log('console-ok')"]
    });
    ok("the add answers fire-and-forget", fired.ok === true && fired.name === "add Process Console Display", JSON.stringify(fired));
    ok("the launch happens", await waitFor(() => wrapper.list().some((p) => p.name === "t-one")));
    const one = wrapper.list().find((p) => p.name === "t-one");
    ok("it carries the supplied name + the console tag", one.name === "t-one" && one.tag === "console", JSON.stringify({ name: one.name, tag: one.tag }));
    await wrapper.awaitExit(one.id, 15e3);
    const text = await (await fetch(`${base}/api/processes/${one.id}/output`)).text();
    ok("its console text streams like any process", text.includes("console-ok"), text.slice(0, 120));
    ok("the outcome lands as its own event", await waitFor(() => Boolean(latestOutcome("add Process Console Display"))));
    const out1 = latestOutcome("add Process Console Display");
    ok("the outcome carries the record + the supplied fields", out1?.result?.ok === true && out1?.result?.name === "t-one" && out1?.result?.supplied?.provider?.name === "node", JSON.stringify(out1?.result)?.slice(0, 200));
    palette.trigger("add Process Console Display", { provider: { launch: process.execPath }, args: ["-e", "1"] });
    ok("the lean defaults stand in: name console-1", await waitFor(() => wrapper.list().some((p) => p.name === "console-1")));
    const leanOne = wrapper.list().find((p) => p.name === "console-1");
    ok(
      "the defaulted cwd is the lean default",
      Boolean(leanOne) && String(leanOne?.cwd).replace(/\\/g, "/") === dir.replace(/\\/g, "/"),
      leanOne ? String(leanOne.cwd) : "no console-1 found"
    );
    palette.trigger("add Process Console Display", { name: "empty-one" });
    ok(
      "no wiring \u2192 the outcome says so (never dropped)",
      await waitFor(() => outcomeLines().some((l) => l.name === "add Process Console Display.result" && l.result?.ok === false && String(l.result?.error).includes("no wiring")))
    );
    const pal = await (await fetch(`${base}/api/events`)).json();
    ok("GET /api/events serves the palette", Array.isArray(pal.palette) && pal.palette.length === 3);
    const wireFired = await fetch(`${base}/api/events/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "add Process Console Display",
        payload: { name: "t-wire", provider: { launch: process.execPath }, args: ["-e", "2"] }
      })
    });
    ok("the door takes a trigger (202, fire-and-forget)", wireFired.status === 202, String(wireFired.status));
    ok("the trigger really launched over the wire", await waitFor(() => wrapper.list().some((p) => p.name === "t-wire")));
    const logRes = await (await fetch(`${base}/api/events/log?limit=5`)).json();
    ok("GET /api/events/log serves the rolling record", typeof logRes.log?.matched === "number" && logRes.log.matched > 0, JSON.stringify(logRes).slice(0, 120));
    palette.trigger("add Process Console Display", {
      name: "t-sleep",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 60000)"]
    });
    await waitFor(() => wrapper.list().some((p) => p.name === "t-sleep"));
    const sleepy = wrapper.list().find((p) => p.name === "t-sleep");
    ok("the sleepy console is live", sleepy.life === "running" || sleepy.life === "starting", String(sleepy.life));
    palette.trigger("kill Process Console Display", { name: "t-sleep" });
    ok(
      "the kill event ends it",
      await waitFor(() => {
        const rec = wrapper.get(sleepy.id);
        return Boolean(rec && rec.life !== "running" && rec.life !== "starting");
      }, 15e3)
    );
    const killed = wrapper.get(sleepy.id);
    ok("it ended as killed (through the door)", killed.life === "killed", String(killed.life));
    const unknown = palette.trigger("nope", {});
    ok("an unknown event refuses with a code", unknown.ok === false && unknown.code === "no_such_event", JSON.stringify(unknown));
    const noted = palette.trigger("note System Drain", { name: "chrome", cpuPeak: 30, samples: 2 }, "test");
    ok("the drain note answers fire-and-forget", noted.ok === true && noted.name === "note System Drain", JSON.stringify(noted));
    ok("the drain note lands in the record", await waitFor(() => outcomeLines().some((l) => l.name === "note System Drain.result" && l.result?.ok === true)));
    palette.trigger("add Process Console Display", {
      name: "t-extra",
      provider: { launch: process.execPath },
      args: ["-e", "3"],
      favouriteColour: "green"
    });
    ok(
      "un-understood extras ride in the outcome",
      await waitFor(() => outcomeLines().some((l) => l.name === "add Process Console Display.result" && l.result?.supplied?.favouriteColour === "green"))
    );
  } catch (err) {
    ok("the suite ran without a crash", false, err.message);
  } finally {
    await api.stop();
    await wrapper.shutdown(true);
    palette.close();
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[consoleEvents] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createConsoleEvents,
  runTests
};
//# sourceMappingURL=consoleEvents.js.map
