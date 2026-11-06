function toEntry(decl, liveness, detail) {
  return {
    name: decl.name,
    kind: decl.kind,
    should: {
      port: decl.port,
      start: decl.start,
      wiredAtBoot: decl.wiredAtBoot,
      what: decl.what,
      missing: decl.missing,
      url: decl.url ?? null,
      deps: decl.deps ?? [],
      provides: decl.provides ?? [],
      tags: decl.tags ?? []
    },
    is: liveness,
    detail,
    kindKnown: decl.kindKnown ?? true,
    origin: decl.origin ?? "file"
  };
}
async function buildShelf(decls, deps) {
  const out = [];
  for (const d of decls) {
    if (d.port !== null) {
      const up = await deps.probe(d.port);
      out.push(toEntry(d, up ? "up" : "down", up ? `answering on ${d.port}` : `declared on ${d.port}, not answering${d.start ? "" : " \xB7 no start command declared"}`));
    } else if (d.url) {
      const up = deps.probeDecl ? await deps.probeDecl(d) : null;
      out.push(toEntry(d, up === true ? "up" : "down", up === null ? `answers on ${d.url} \u2014 not probed here (no port)` : up ? `answering on ${d.url}` : `declared at ${d.url}, not answering`));
    } else if (d.kind === "shell") {
      out.push(toEntry(d, "down", "a shell \u2014 no door to probe; the window decides"));
    } else {
      out.push(toEntry(d, "down", `${d.kind} \u2014 no port and no url declared, so there is nothing to probe`));
    }
  }
  return out;
}
function sameName(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}
async function resolve(name, decls, deps, offered = []) {
  const here = decls.filter((d) => sameName(d.name, name));
  for (const d of here) {
    if (d.kind === "door" && d.port !== null) {
      if (await deps.probe(d.port)) {
        return {
          name: d.name,
          found: true,
          kind: d.kind,
          port: d.port,
          liveness: "up",
          what: d.what,
          wiredAtBoot: d.wiredAtBoot,
          reason: `answering on ${d.port}`,
          alternatives: []
        };
      }
      let startNote = "no start command declared \u2014 this one needs a human";
      let id;
      if (deps.start && d.start) {
        const res = await deps.start(d.name, d);
        startNote = res.ok ? `asked ProcessWrapper to start it${res.id ? ` (life ${res.id})` : ""}` : `ProcessWrapper refused: ${res.error ?? "unknown reason"}`;
        id = res.id;
        void id;
      }
      return {
        name: d.name,
        found: true,
        kind: d.kind,
        port: d.port,
        liveness: "starting",
        what: d.what,
        wiredAtBoot: d.wiredAtBoot,
        reason: `declared on ${d.port}, not answering \u2014 ${startNote}`,
        alternatives: []
      };
    }
    if (d.url) {
      const up = deps.probeDecl ? await deps.probeDecl(d) : null;
      return {
        name: d.name,
        found: true,
        kind: d.kind,
        port: null,
        liveness: up === true ? "up" : "down",
        what: d.what,
        wiredAtBoot: d.wiredAtBoot,
        reason: up === null ? `answers on ${d.url} \u2014 not probed here (no port); nothing on this shelf can start it` : up ? `answering on ${d.url}` : `declared at ${d.url}, not answering \u2014 nothing on this shelf can start it`,
        alternatives: [],
        url: d.url,
        origin: d.origin
      };
    }
    return {
      name: d.name,
      found: true,
      kind: d.kind,
      port: null,
      liveness: "down",
      what: d.what,
      wiredAtBoot: d.wiredAtBoot,
      reason: d.kind === "shell" ? "a shell \u2014 it has no door; the window decides whether it is showing" : "the catalog \u2014 it holds definitions and runs nothing",
      alternatives: []
    };
  }
  const offer = offered.find((o) => sameName(o.name, name));
  if (offer) {
    return {
      name: offer.name,
      found: true,
      kind: "catalog",
      port: null,
      liveness: "offered",
      what: offer.what,
      wiredAtBoot: false,
      reason: `offered by ${offer.provider} \u2014 it starts when it is run, not before`,
      alternatives: []
    };
  }
  return {
    name,
    found: false,
    kind: "unknown",
    port: null,
    liveness: "absent",
    what: "",
    wiredAtBoot: false,
    reason: `no such thing on this shelf \u2014 and that is the ONLY answer that means "not here"`,
    alternatives: [...decls.map((d) => d.name), ...offered.map((o) => o.name)].sort()
  };
}
function runTests() {
  const decls = [
    {
      name: "State",
      kind: "door",
      port: 8127,
      start: "node main.js",
      wiredAtBoot: false,
      what: "the generic retainer",
      sources: { port: "join.json" },
      missing: []
    },
    {
      name: "Electron_Wrapper",
      kind: "shell",
      port: null,
      start: "electron main.cjs",
      wiredAtBoot: true,
      what: "the one window",
      sources: { kind: "join.json" },
      missing: []
    },
    {
      name: "Basic_App",
      kind: "door",
      port: 8130,
      start: "node main.js",
      wiredAtBoot: false,
      what: "the service shelf instance",
      sources: { port: "join.json" },
      missing: []
    }
  ];
  const offered = [
    { name: "chat", provider: "llama.cpp", what: "one chat, several brains", liveness: "offered" }
  ];
  const calls = [];
  const upPorts = /* @__PURE__ */ new Set([8127]);
  const deps = {
    probe: async (port) => {
      calls.push(`probe:${port}`);
      return upPorts.has(port);
    },
    start: async (name) => {
      calls.push(`start:${name}`);
      upPorts.add(8130);
      return { ok: true, id: "life-1" };
    },
    listOffered: async () => offered
  };
  void (async () => {
    const a = await resolve("State", decls, deps, offered);
    console.assert(a.found === true && a.liveness === "up" && a.port === 8127, "an up door answers with its port", JSON.stringify(a.liveness));
    console.assert(!calls.some((c2) => c2.startsWith("start:")), "an up door is never re-started");
    const b = await resolve("Basic_App", decls, deps, offered);
    console.assert(b.found === true, 'something here-but-down is NOT "not found"', String(b.found));
    console.assert(b.liveness === "starting", "and it answers `starting`", b.liveness);
    console.assert(calls.includes("start:Basic_App"), "and it asked ProcessWrapper to start it", calls.join(","));
    console.assert(b.reason.includes("asked ProcessWrapper"), "the reason says what it did", b.reason);
    const b2 = await resolve("Basic_App", decls, deps, offered);
    console.assert(b2.liveness === "up", "the second ask finds it up \u2014 it resolved, it never vanished", b2.liveness);
    const c = await resolve("Electron_Wrapper", decls, deps, offered);
    console.assert(c.found === true && c.port === null, "a shell is found with no port", String(c.port));
    console.assert(!calls.includes("start:Electron_Wrapper"), 'a shell is never "started" by Join');
    const d = await resolve("chat", decls, deps, offered);
    console.assert(
      d.found === true && d.liveness === "offered" && d.port === null,
      "an offered service is found with no port",
      `${d.liveness}/${d.port}`
    );
    console.assert(d.reason.includes("starts when it is run"), "offered explains itself", d.reason);
    const e = await resolve("Nonexistent", decls, deps, offered);
    console.assert(e.found === false && e.liveness === "absent", "absent is the only real refusal", e.liveness);
    console.assert(
      e.alternatives.includes("State") && e.alternatives.includes("chat"),
      "a refusal still hands over what IS here",
      e.alternatives.join(",")
    );
    const f = await resolve("sTaTe", decls, deps, offered);
    console.assert(f.found === true && f.port === 8127, "names match without regard to case", String(f.found));
    const shelf = await buildShelf(decls, deps);
    const basic = shelf.find((x) => x.name === "Basic_App");
    console.assert(!!basic && basic.should.port === 8130, "the should column is there whatever the is column says", String(basic?.should.port));
    const upState = shelf.find((x) => x.name === "State");
    console.assert(
      upState?.is === "up" && upState?.should.port === 8127,
      "up is a probe result held beside the declaration, never instead of it",
      `${upState?.is}`
    );
    console.assert(
      shelf.every((x) => x.should !== void 0 && x.is !== void 0),
      "every row carries both columns"
    );
  })();
}
export {
  buildShelf,
  resolve,
  runTests,
  toEntry
};
//# sourceMappingURL=resolver.js.map
