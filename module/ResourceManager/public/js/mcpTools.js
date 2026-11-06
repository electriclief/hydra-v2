class ToolRefusal extends Error {
}
function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}
function amountOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function pathsOf(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
  if (typeof value === "string" && value.trim()) return value.split(/[,\n;]+/).map((piece) => piece.trim()).filter(Boolean);
  return [];
}
function buildTools(store, reads) {
  return [
    {
      name: "rm_resources",
      description: "THE POLL \u2014 this node's resources, a pure read: cpu (cores \xB7 load) \xB7 gpus (name \xB7 vram \xB7 observed gpu-side processes nobody booked) \xB7 ram \xB7 disks \xB7 Hydra shared folders \xB7 every current booking (service \xB7 what it holds \xB7 since). Asking holds nothing and remembers nothing.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const current = await reads();
        return jsonResult({
          ok: true,
          node: current.node,
          collectedAt: current.collectedAt,
          cpu: current.cpu,
          ram: current.ram,
          gpus: current.gpus,
          gpusObserved: current.gpusObserved,
          disks: current.disks,
          shares: current.shares,
          bookings: store.active(),
          notes: current.notes
        });
      }
    },
    {
      name: "rm_book",
      description: "BOOK resources for a run \u2014 the ONE write. The caller passes the CHOSEN resources (amounts for cores/ramMb/diskMb; a gpu by name, whole and pinned \u2014 1 app per gpu; paths[] \u2014 a booked folder covers its subtree, children assumed). The book lands whole or is refused whole: on refusal the answer carries the wait info (what is in the way, held by which service, since when). Nothing is queued, nothing is scheduled here.",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "The service this run is \u2014 the booking's identity." },
          mode: { type: "string", description: "Optional service mode (recorded)." },
          gpu: { type: "string", description: "A gpu by name, exactly as rm_resources shows it. Whole and pinned." },
          cores: { type: "number", description: "Cpu cores to book (amount)." },
          ramMb: { type: "number", description: "Ram in MB to book (amount)." },
          diskMb: { type: "number", description: "Disk in MB to book (amount)." },
          paths: { type: "string", description: "Absolute folders this run works in \u2014 comma or newline separated. A booked folder covers its subtree." },
          expected: { type: "string", description: "The expected time the caller decided on (recorded as info; leave empty when unknown)." },
          note: { type: "string", description: "A short note for the register." },
          run: { type: "string", description: "Optional run id when the caller carries one." }
        },
        required: ["service"]
      },
      run: async (args) => {
        const outcome = await store.book({
          service: args.service,
          mode: args.mode,
          gpu: args.gpu,
          cores: amountOf(args.cores),
          ramMb: amountOf(args.ramMb),
          diskMb: amountOf(args.diskMb),
          paths: pathsOf(args.paths),
          expected: args.expected,
          note: args.note,
          run: args.run
        });
        return jsonResult(outcome);
      }
    },
    {
      name: "rm_bookings",
      description: "THE REGISTER \u2014 every current booking (what is held, by which service, since when). Pass include_ended to also see the last popped/cleared ones.",
      inputSchema: {
        type: "object",
        properties: {
          include_ended: { type: "boolean", description: "Also list ended bookings (popped \xB7 cleared)." }
        }
      },
      run: async (args) => {
        const includeEnded = args.include_ended === true || args.include_ended === "true";
        return jsonResult({ ok: true, active: store.active(), ...includeEnded ? { ended: store.ended() } : {} });
      }
    },
    {
      name: "rm_pop",
      description: "POP a booking \u2014 the normal exit: the run ended, so what it held is unassignable-no-more. The resources free the moment this answers.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The booking id rm_book returned." } },
        required: ["id"]
      },
      run: async (args) => {
        const id = typeof args.id === "string" ? args.id.trim() : "";
        if (!id) throw new ToolRefusal("rm_pop needs the booking id \u2014 call rm_bookings to see them");
        const ended = store.pop(id);
        if (!ended) return textResult(`no such booking: ${id} \u2014 call rm_bookings to see the register`, true);
        return jsonResult({ ok: true, booking: ended });
      }
    },
    {
      name: "rm_clear",
      description: "CLEAR a booking by hand \u2014 the corpse path: e.g. a run died without popping, or the operator takes a stale hold back. Same effect as pop; recorded as cleared so the register remembers it was a hand.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "The booking id rm_book returned." } },
        required: ["id"]
      },
      run: async (args) => {
        const id = typeof args.id === "string" ? args.id.trim() : "";
        if (!id) throw new ToolRefusal("rm_clear needs the booking id \u2014 call rm_bookings to see them");
        const ended = store.clear(id);
        if (!ended) return textResult(`no such booking: ${id} \u2014 call rm_bookings to see the register`, true);
        return jsonResult({ ok: true, booking: ended });
      }
    }
  ];
}
function createRmMcpRegistry(store, reads) {
  const tools = buildTools(store, reads);
  return {
    module: "resource-manager",
    list: () => tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    call: async (name, args) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new ToolRefusal(`unknown tool: ${name}`);
      return tool.run(args ?? {});
    }
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createBookingStore } = await import("./bookingStore.js");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-mcp-"));
  const fakeReads = {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    node: "test-node",
    platform: "win32",
    cpu: { model: "fake", cores: 8, loadPct: 3 },
    ram: { totalMb: 16e3, freeMb: 9e3 },
    gpus: [{ name: "RX 6800", vramMb: 16384, vramSource: "registry", memUsedMb: null }],
    gpusObserved: [{ name: "lolMiner.exe", pid: 1, reason: "miner" }],
    disks: [{ device: "C:", freeMb: 1e5, totalMb: 5e5 }],
    shares: [],
    notes: []
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const registry = createRmMcpRegistry(store, () => fakeReads);
  const advertised = registry.list();
  ok("registry names its module", registry.module === "resource-manager");
  ok("five tools are advertised", advertised.length === 5, advertised.map((t) => t.name).join(","));
  ok("advertised tools carry no run hand", advertised.every((t) => !("run" in t)));
  ok("every advertised tool has a description and schema", advertised.every((t) => t.description.length > 20 && t.inputSchema.type === "object"));
  const poll = await registry.call("rm_resources", {});
  const pollBody = JSON.parse(poll.content[0].text);
  ok("rm_resources answers the whole read", pollBody.ok === true && pollBody.node === "test-node" && pollBody.cpu.cores === 8 && Array.isArray(pollBody.bookings));
  ok("rm_resources carries the observed row", pollBody.gpusObserved.some((p) => p.reason === "miner"));
  const booked = await registry.call("rm_book", { service: "image-gen", gpu: "RX 6800", cores: 4, paths: "C:\\work\\a, C:\\work\\b" });
  const bookedBody = JSON.parse(booked.content[0].text);
  ok("rm_book lands the whole book", bookedBody.ok === true && bookedBody.booking.id.startsWith("bk-") && bookedBody.booking.paths.length === 2);
  const doubleBook = await registry.call("rm_book", { service: "other", gpu: "RX 6800" });
  const doubleBody = JSON.parse(doubleBook.content[0].text);
  ok("rm_book refusal rides as a normal answer (ok:false, not isError)", doubleBody.ok === false && doubleBook.isError !== true);
  ok("the refusal names the holder \u2014 the wait info", doubleBody.error.code === "double_booked" && doubleBody.error.blockers[0].heldBy?.service === "image-gen");
  const missingService = await registry.call("rm_book", { cores: 2 });
  ok("rm_book without a service answers invalid_book", JSON.parse(missingService.content[0].text).error.code === "invalid_book");
  const listed = await registry.call("rm_bookings", {});
  ok("rm_bookings lists the active register", JSON.parse(listed.content[0].text).active.length === 1);
  const popped = await registry.call("rm_pop", { id: bookedBody.booking.id });
  ok("rm_pop lifts the booking", JSON.parse(popped.content[0].text).booking.endReason === "popped");
  const ended = await registry.call("rm_bookings", { include_ended: true });
  ok("rm_bookings can show the ended ones", JSON.parse(ended.content[0].text).ended.length === 1);
  const popMissing = await registry.call("rm_pop", { id: "bk-nope" });
  ok("popping an unknown id is an answer with isError", popMissing.isError === true && popMissing.content[0].text.includes("no such booking"));
  let refusalThrown = false;
  try {
    await registry.call("rm_pop", {});
  } catch (err) {
    refusalThrown = err instanceof ToolRefusal;
  }
  ok("rm_pop without an id throws ToolRefusal", refusalThrown);
  let unknownThrown = false;
  try {
    await registry.call("nope_nope", {});
  } catch (err) {
    unknownThrown = err instanceof ToolRefusal;
  }
  ok("an unknown tool throws ToolRefusal", unknownThrown);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  ToolRefusal,
  buildTools,
  createRmMcpRegistry,
  runTests
};
//# sourceMappingURL=mcpTools.js.map
