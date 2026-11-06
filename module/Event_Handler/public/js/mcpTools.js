class ToolRefusal extends Error {
}
const SOURCES = ["user", "agent", "process", "system"];
function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function buildTools(handler) {
  return [
    {
      name: "event_list",
      description: "THE PALETTE \u2014 every event registered on this handler: name, description, fire/outcome counters. Call this first: anything listed here can be fired with event_trigger.",
      inputSchema: { type: "object", properties: {} },
      run: async () => jsonResult({ events: handler.list() })
    },
    {
      name: "event_trigger",
      description: "FIRE an event \u2014 fire-and-forget. The receipt comes back immediately; the OUTCOME lands later as its own event (`<name>.result` or `<name>.error`) \u2014 read it with event_log. This is the same door a user click walks; the log records who fired it (source).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The event to fire \u2014 use a name from event_list." },
          payload: { type: "object", description: "Optional free-form JSON handed to the event as-is." },
          source: { type: "string", description: "Who fires it (defaults to agent when called over MCP).", enum: ["user", "agent", "process", "system"] }
        },
        required: ["name"]
      },
      run: async (args) => {
        const name = typeof args.name === "string" ? args.name : "";
        if (!name) throw new ToolRefusal("event_trigger needs a name \u2014 call event_list to see the palette");
        const source = SOURCES.includes(args.source) ? args.source : "agent";
        const receipt = handler.trigger(name, args.payload, { source });
        if (!receipt.ok) {
          return { content: [{ type: "text", text: `no such event: ${name} \u2014 call event_list to see the palette` }], isError: true };
        }
        return jsonResult(receipt);
      }
    },
    {
      name: "event_log",
      description: "READ the record \u2014 the last N matching events from the rolling log (bounded, ~24 h). Filter by name (exact) and/or source; outcomes are their own lines (`<name>.result` / `<name>.error`, linked by `of`).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Last N lines (default 100, cap 5000)." },
          sinceHours: { type: "number", description: "Only events from the last N hours." },
          name: { type: "string", description: "Exact event name filter, e.g. tick or tick.result." },
          source: { type: "string", description: "Exact source filter.", enum: ["user", "agent", "process", "system"] }
        }
      },
      run: async (args) => {
        const since = typeof args.sinceHours === "number" ? Date.now() - args.sinceHours * 36e5 : void 0;
        const read = handler.read({
          limit: typeof args.limit === "number" ? args.limit : 100,
          since,
          name: typeof args.name === "string" && args.name ? args.name : void 0,
          source: typeof args.source === "string" && args.source ? args.source : void 0
        });
        return jsonResult({ matched: read.matched, fileBytes: read.fileBytes, lines: read.lines });
      }
    },
    {
      name: "event_purge",
      description: "TRIM the log on demand \u2014 drop events older than the retention window (~24 h) and enforce the byte ceiling. The self-trim runs periodically anyway; this is the manual hand.",
      inputSchema: { type: "object", properties: {} },
      run: async () => jsonResult(handler.purge())
    }
  ];
}
function createMcpRegistry(handler) {
  const tools = buildTools(handler);
  return {
    module: "event-handler",
    list: () => tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    call: async (name, args) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new ToolRefusal(`unknown tool: ${name}`);
      return tool.run(args ?? {});
    }
  };
}
async function runTests() {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { createEventHandler } = await import("./eventHandler.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eh-tools-"));
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const handler = createEventHandler({ logPath: path.join(dir, "events.log"), purgeIntervalMs: 0 });
  handler.start();
  handler.register("demo", (payload) => ({ got: payload }), { description: "a demo" });
  const registry = createMcpRegistry(handler);
  const advertised = registry.list();
  ok("registry names its module", registry.module === "event-handler");
  ok("four generic verbs are advertised", advertised.length === 4, advertised.map((t) => t.name).join(","));
  ok("the palette tool is there", advertised.some((t) => t.name === "event_list"));
  ok("advertised tools carry no run hand", advertised.every((t) => !("run" in t)));
  ok("every advertised tool has a description and schema", advertised.every((t) => t.description.length > 20 && t.inputSchema.type === "object"));
  const listed = await registry.call("event_list", {});
  const palette = JSON.parse(listed.content[0].text);
  ok("event_list returns the palette", palette.events.length === 1 && palette.events[0].name === "demo");
  const fired = await registry.call("event_trigger", { name: "demo", payload: { n: 1 } });
  const receipt = JSON.parse(fired.content[0].text);
  ok("event_trigger fires with source agent", receipt.ok === true && receipt.source === "agent");
  const refused = await registry.call("event_trigger", { name: "nope" });
  ok("an unknown event is refused with isError", refused.isError === true && refused.content[0].text.includes("event_list"));
  let refusal = false;
  try {
    await registry.call("event_trigger", {});
  } catch (err) {
    refusal = err instanceof ToolRefusal;
  }
  ok("a missing name throws ToolRefusal", refusal);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logged = await registry.call("event_log", { name: "demo.result" });
  const read = JSON.parse(logged.content[0].text);
  ok("event_log reads the outcome line", read.matched === 1 && read.lines[0].of === "demo");
  const purged = await registry.call("event_purge", {});
  const purge = JSON.parse(purged.content[0].text);
  ok("event_purge answers with before/after", typeof purge.before === "number" && typeof purge.after === "number");
  let unknown = false;
  try {
    await registry.call("no_such_tool", {});
  } catch (err) {
    unknown = err instanceof ToolRefusal;
  }
  ok("an unknown tool throws ToolRefusal", unknown);
  handler.close();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ToolRefusal,
  buildTools,
  createMcpRegistry,
  runTests
};
//# sourceMappingURL=mcpTools.js.map
