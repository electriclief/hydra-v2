function createJoinMcpRegistry(shelf) {
  const tools = [
    {
      name: "join_resolve",
      description: 'Resolve one thing by name on this node. Returns its port and whether it is up, starting, or offered. If it is declared but not answering, Join asks ProcessWrapper to start it and answers "starting" \u2014 it does NOT report "not found" for something that is merely not running. Use this FIRST when you need any module; you never need to know a port in advance.',
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "The module or service name, any case." } },
        required: ["name"]
      },
      run: async (args) => {
        const name = String(args.name ?? "").trim();
        if (!name) return { text: 'join_resolve needs a name: { "name": "State" }', isError: true };
        const r = await shelf.resolveName(name);
        return {
          text: JSON.stringify({
            name: r.name,
            found: r.found,
            kind: r.kind,
            port: r.port,
            liveness: r.liveness,
            what: r.what,
            wiredAtBoot: r.wiredAtBoot,
            reason: r.reason,
            alternatives: r.alternatives
          }, null, 2),
          isError: !r.found
        };
      }
    },
    {
      name: "join_shelf",
      description: "Read the WHOLE shelf: every module on this node with `should` (what its own files declare) and `is` (what is answering right now) as SEPARATE columns, plus the offered service catalog. Use this to discover what exists; use join_resolve when you already know the name.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ text: JSON.stringify(await shelf.all(), null, 2) })
    },
    {
      name: "join_reports",
      description: "Why is something not working? Returns the should/is columns for ONE module, with the missing declaration facts named. Use when join_shelf shows something is down and you need the reason before touching it.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "The module name, any case." } },
        required: ["name"]
      },
      run: async (args) => {
        const name = String(args.name ?? "").trim();
        const all = await shelf.all();
        const row = all.modules.find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (!row) return { text: `no such module on this shelf: ${name}`, isError: true };
        return { text: JSON.stringify({ ...row, shelfRoot: all.root }, null, 2) };
      }
    },
    {
      name: "join_kinds",
      description: "The VOCABULARY of this shelf: every kind of thing that can be joined here (door, shell, service, agent, node, mcp, app, storage \u2026) and whether that kind carries a port or a start command. Ask this BEFORE registering something new, so you use an existing kind instead of inventing one. A kind missing here can still be registered \u2014 but call this first.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({
        text: JSON.stringify({ kinds: shelf.kinds, note: "a kind may be added by writing Join/data/kinds.json" }, null, 2)
      })
    },
    {
      name: "join_register",
      description: "JOIN a new thing to this shelf at runtime \u2014 a remote node, an MCP door, a service, an app, a share. Nothing needs to be installed or rebuilt: the member is written to the store and appears in join_shelf immediately. Give {name, kind} at minimum; port for a door, url for anything that answers over http, plus optional deps/provides/tags/probe/meta. Fails with a sentence (never a silent half-row) if the name or kind is not a valid word.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The name it is known by, letters/digits/._- only." },
          kind: { type: "string", description: "A kind from join_kinds, or a new short word." },
          port: { type: "number", description: "Its port, if it is a door-shaped thing." },
          url: { type: "string", description: "Its base url (http://host:port) if it lives off-box." },
          start: { type: "string", description: "The command ProcessWrapper would run to start it." },
          what: { type: "string", description: "One sentence a stranger can read." },
          deps: { type: "string", description: "Comma-separated names that must be up first." },
          tags: { type: "string", description: "Comma-separated labels (remote, gpu, deprecated)." }
        },
        required: ["name", "kind"]
      },
      run: async (args) => {
        const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        try {
          const saved = shelf.members.upsert({
            name: args.name,
            kind: args.kind,
            port: args.port,
            url: args.url,
            start: args.start,
            what: args.what,
            deps: list(args.deps),
            tags: list(args.tags)
          });
          return { text: JSON.stringify({ ok: true, joined: saved, note: "it is on the shelf now \u2014 join_shelf shows it" }, null, 2) };
        } catch (e) {
          return { text: `join_register refused it: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
      }
    },
    {
      name: "join_plan",
      description: "THE ORDER things must come up in, built from what each member declares it depends on. Returns order (dependencies first), blocked (a member whose dependency is not on the shelf, naming the missing one) and cycles (a loop nobody can start). Use it before starting a chain, or when something will not come up because of something else.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ text: JSON.stringify(shelf.plan(), null, 2) })
    }
  ];
  return {
    module: "join",
    list: () => tools.map((t) => ({ ...t })),
    call: async (name, args) => {
      const t = tools.find((x) => x.name === name);
      if (!t) return { text: `no such tool: ${name}. join has: ${tools.map((x) => x.name).join(", ")}`, isError: true };
      return t.run(args);
    }
  };
}
function runTests() {
  const stub = {
    resolveName: async (name) => ({
      name,
      found: name === "State",
      kind: "door",
      port: 8127,
      liveness: "up",
      what: "the generic retainer",
      wiredAtBoot: false,
      reason: "answering on 8127",
      alternatives: []
    }),
    all: async () => ({ modules: [{ name: "State" }], offered: [], root: "x" }),
    kinds: [{ name: "door", hasPort: true, hasStart: true, what: "a module with a door", source: "built-in" }],
    members: {
      upsert: (raw) => ({ ...raw, origin: "registered" })
    },
    plan: () => ({ order: ["State"], blocked: [], cycles: [] })
  };
  const reg = createJoinMcpRegistry(stub);
  void (async () => {
    const tools = reg.list();
    console.assert(tools.length === 6, "join carries six tools", String(tools.length));
    console.assert(
      tools.map((t) => t.name).join(",") === "join_resolve,join_shelf,join_reports,join_kinds,join_register,join_plan",
      "the keyring is the six named tools",
      tools.map((t) => t.name).join(",")
    );
    console.assert(
      tools.every((t) => typeof t.description === "string" && t.description.length > 40),
      "every tool carries its own documentation"
    );
    console.assert(
      JSON.stringify(tools[0].inputSchema).includes("The module or service name"),
      "every property is described"
    );
    const good = await reg.call("join_resolve", { name: "State" });
    console.assert(!good.isError && good.text.includes('"liveness": "up"'), "resolve answers for a known name", good.text.slice(0, 60));
    const bad = await reg.call("join_resolve", { name: "" });
    console.assert(bad.isError === true, "an empty name is refused", String(bad.isError));
    const unknownTool = await reg.call("nope", {});
    console.assert(
      unknownTool.isError === true && unknownTool.text.includes("join_resolve"),
      "an unknown tool names the real ones",
      unknownTool.text.slice(0, 60)
    );
    const rep = await reg.call("join_reports", { name: "State" });
    console.assert(!rep.isError && rep.text.includes("State"), "reports answers for a module", rep.text.slice(0, 40));
    const repMissing = await reg.call("join_reports", { name: "Ghost" });
    console.assert(repMissing.isError === true, "reports refuses a module that is not there", String(repMissing.isError));
    const kindsOut = await reg.call("join_kinds", {});
    console.assert(!kindsOut.isError && kindsOut.text.includes('"door"'), "kinds serves the vocabulary", kindsOut.text.slice(0, 40));
    const joined = await reg.call("join_register", { name: "Pi", kind: "node", url: "http://h:1" });
    console.assert(!joined.isError && joined.text.includes('"ok": true'), "register accepts a new thing", joined.text.slice(0, 40));
    const planOut = await reg.call("join_plan", {});
    console.assert(!planOut.isError && planOut.text.includes('"order"'), "plan serves the order", planOut.text.slice(0, 40));
    const badToolArgs = await reg.call("join_register", { kind: "node" });
    console.assert(
      typeof badToolArgs.text === "string" && badToolArgs.text.length > 0,
      "register always answers with a sentence, never a crash"
    );
  })();
}
export {
  createJoinMcpRegistry,
  runTests
};
//# sourceMappingURL=mcpTools.js.map
