function isAlive(life) {
  return life === "running" || life === "starting";
}
function mergeConsoles(list, prior) {
  const next = /* @__PURE__ */ new Map();
  const added = [];
  const endedIds = [];
  for (const row of list) {
    const old = prior.get(row.id);
    const state = old ? { ...old, name: row.name, life: row.life } : { id: row.id, name: row.name, life: row.life, seen: 0, minimized: false, closing: false };
    if (!old) added.push(row.id);
    if (old && isAlive(old.life) && !isAlive(row.life)) endedIds.push(row.id);
    next.set(row.id, state);
  }
  return { next, added, endedIds };
}
function readRoot(data) {
  const wrapped = data;
  const r = wrapped?.root;
  return r && typeof r.id === "string" ? r : null;
}
function tabLabel(state) {
  const mark = state.closing ? " (closing)" : isAlive(state.life) ? "" : " (ended)";
  return state.name + mark;
}
function visibleTabs(states) {
  return [...states.values()].filter((s) => !s.minimized);
}
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  const wrapped = data;
  return Array.isArray(wrapped?.processes) ? wrapped?.processes : [];
}
function bootConsoleWindow(env = {}) {
  const doc = env.doc ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return;
  const fetchFn = env.fetchFn ?? fetch;
  const origin = env.origin ?? (typeof location !== "undefined" ? location.origin : "http://127.0.0.1:8125");
  const SELF = "__self__";
  let rootRow = null;
  const strip = doc.getElementById("strip");
  const consoleEl = doc.getElementById("console");
  const statusEl = doc.getElementById("status");
  const form = doc.getElementById("addForm");
  const fName = doc.getElementById("f-name");
  const fCommand = doc.getElementById("f-command");
  const fCwd = doc.getElementById("f-cwd");
  if (!strip || !consoleEl || !statusEl) return;
  const states = /* @__PURE__ */ new Map();
  let active = SELF;
  const say = (text) => {
    statusEl.textContent = text;
  };
  const api = async (path) => {
    const res = await fetchFn(origin + path);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };
  const fire = async (name, payload) => {
    try {
      const res = await fetchFn(origin + "/api/events/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, payload, source: "window" })
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  const pushMinimized = () => {
    const names = [...states.values()].filter((s) => s.minimized).map((s) => s.name);
    env.ipc?.minimized(names);
  };
  const appendText = (text) => {
    consoleEl.textContent += text;
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };
  const removeTab = (id) => {
    states.delete(id);
    pushMinimized();
    if (active === id) {
      active = SELF;
      consoleEl.textContent = "";
    }
    renderStrip();
  };
  const select = (key) => {
    active = key;
    consoleEl.textContent = "";
    const st = states.get(key);
    if (st) st.seen = 0;
    renderStrip();
  };
  const minimize = (key) => {
    const st = states.get(key);
    if (!st) return;
    st.minimized = true;
    pushMinimized();
    if (active === key) {
      active = SELF;
      consoleEl.textContent = "";
    }
    renderStrip();
    say(`${st.name} parked - it waits in the Window menu (the process lives on)`);
  };
  const closeTab = (key) => {
    const st = states.get(key);
    if (!st) return;
    if (!isAlive(st.life)) {
      removeTab(key);
      return;
    }
    st.closing = true;
    renderStrip();
    void fire("kill Process Console Display", { name: st.name }).then((ok) => {
      say(ok ? `kill event fired for ${st.name} - graceful ask first` : "the door did not answer the kill");
    });
  };
  const restore = (nameOrStar) => {
    for (const st of states.values()) {
      if (nameOrStar === "*" || st.name === nameOrStar) st.minimized = false;
    }
    pushMinimized();
    renderStrip();
  };
  const renderStrip = () => {
    strip.textContent = "";
    const mkTab = (key, label, closable, minimizable) => {
      const el = doc.createElement("div");
      el.className = "tab" + (key === active ? " active" : "");
      const labelEl = doc.createElement("span");
      labelEl.className = "tab-label";
      labelEl.textContent = label;
      labelEl.onclick = () => select(key);
      el.appendChild(labelEl);
      if (minimizable) {
        const min = doc.createElement("button");
        min.className = "tab-min";
        min.textContent = "_";
        min.title = "minimize - parks in the Window menu (the process lives on)";
        min.onclick = (ev) => {
          ev.stopPropagation();
          minimize(key);
        };
        el.appendChild(min);
      }
      if (closable) {
        const st = states.get(key);
        const x = doc.createElement("button");
        x.className = "tab-x";
        x.textContent = "x";
        x.title = st && isAlive(st.life) ? "close - fires the kill event" : "remove this tab";
        x.onclick = (ev) => {
          ev.stopPropagation();
          closeTab(key);
        };
        el.appendChild(x);
      }
      strip.appendChild(el);
    };
    mkTab(SELF, "ProcessWrapper", false, false);
    for (const st of visibleTabs(states)) mkTab(st.id, tabLabel(st), true, true);
  };
  const renderSelfView = async () => {
    try {
      const health = await api("/health");
      const palette = await api("/api/events");
      const lines = [
        "ProcessWrapper - the console window",
        `door      ${origin}`,
        // THE TRUNK'S OWN ROW. The root used to be the one process with no record here;
        // it captured its own life, so now it reads like any child - and it is first.
        ...rootRow ? [
          `root      ${rootRow.name}`,
          `          pid ${rootRow.pid}  life ${rootRow.life}  ${rootRow.bytes}B in its own life file`,
          "          read it: GET /api/root/output   (served as plain text)"
        ] : ["root      (this host did not capture the root life)"],
        `consoles  ${health.processes?.live ?? "?"} live / ${health.processes?.total ?? "?"} total`,
        `uptime    ${Math.round((health.uptimeMs ?? 0) / 1e3)}s`,
        "",
        "the palette (any hand can fire these):",
        ...(palette.palette ?? []).map((p) => `  ${p.name}
      ${p.description}`),
        "",
        "Add from the bar below - or from the API, a script, a command-line arg.",
        "Every firing lands here as a tab. Minimize parks a display in the Window menu."
      ];
      consoleEl.textContent = lines.join("\n");
    } catch {
      consoleEl.textContent = "the door is not answering yet...\n\nStart it:  node public/js/main.js  (in ProcessWrapper/)\nThen View > Reload.";
    }
  };
  const processPoll = async () => {
    try {
      const raw = await api("/api/processes");
      rootRow = readRoot(raw);
      const list = rowsOf(raw);
      const { next, added, endedIds } = mergeConsoles(list, states);
      states.clear();
      for (const [k, v] of next) states.set(k, v);
      for (const id of endedIds) {
        const st = states.get(id);
        if (st?.closing) removeTab(id);
      }
      if (added.length) {
        const fresh = states.get(added[added.length - 1]);
        select(added[added.length - 1]);
        say(`a console appeared: ${fresh?.name ?? ""}`);
      }
      renderStrip();
    } catch {
      say("the door is not answering - retrying");
    }
  };
  const pullConsole = async () => {
    if (active === SELF) return;
    const st = states.get(active);
    if (!st) return;
    try {
      const res = await fetchFn(`${origin}/api/processes/${st.id}/output?from=${st.seen}`);
      if (res.ok) {
        const text = await res.text();
        if (text) {
          st.seen += text.length;
          appendText(text);
        }
      }
    } catch {
    }
  };
  const selfPoll = async () => {
    if (active === SELF) await renderSelfView();
  };
  if (form && fName && fCommand && fCwd) {
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const command = fCommand.value.trim();
      if (!command) {
        say("the wiring is required - type the command to run");
        return;
      }
      const payload = { provider: { launch: command } };
      const name = fName.value.trim();
      if (name) payload.name = name;
      const cwd = fCwd.value.trim();
      if (cwd) payload.cwd = cwd;
      void fire("add Process Console Display", payload).then((ok) => {
        if (ok) {
          fName.value = "";
          fCommand.value = "";
          say("fired - watch for the tab");
        } else {
          say("the door did not answer - is ProcessWrapper running?");
        }
      });
    };
  }
  if (env.ipc) {
    env.ipc.onRestore((name) => {
      restore(name);
      say(name === "*" ? "all consoles restored" : `restored ${name}`);
    });
  }
  renderStrip();
  void selfPoll();
  void processPoll();
  setInterval(() => void processPoll(), 1500);
  setInterval(() => void pullConsole(), 900);
  setInterval(() => void selfPoll(), 3e3);
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
  const w = window;
  bootConsoleWindow({ ipc: w.cpWindow ?? null });
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("isAlive knows the two living states", isAlive("running") && isAlive("starting") && !isAlive("exited") && !isAlive("killed") && !isAlive("failed"));
  const m1 = mergeConsoles(
    [
      { id: "a", name: "one", life: "running" },
      { id: "b", name: "two", life: "exited" }
    ],
    /* @__PURE__ */ new Map()
  );
  ok("merge creates a state for every row", m1.next.size === 2 && m1.added.length === 2 && m1.added[0] === "a", JSON.stringify(m1.added));
  ok("nothing ends on first sight", m1.endedIds.length === 0);
  const prior = /* @__PURE__ */ new Map([
    ["a", { id: "a", name: "one", life: "running", seen: 5, minimized: true, closing: false }]
  ]);
  const m2 = mergeConsoles([{ id: "a", name: "one", life: "killed" }], prior);
  ok("the minimized flag survives a merge", m2.next.get("a")?.minimized === true);
  ok("the seen mark survives a merge", m2.next.get("a")?.seen === 5);
  ok("a life crossing to dead is reported ended", m2.endedIds.join(",") === "a", JSON.stringify(m2.endedIds));
  const m3 = mergeConsoles(
    [
      { id: "c", name: "c", life: "running" },
      { id: "d", name: "d", life: "running" }
    ],
    /* @__PURE__ */ new Map()
  );
  ok("visible order follows the door table", visibleTabs(m3.next).map((s) => s.id).join(",") === "c,d");
  ok("a minimized tab leaves the strip", visibleTabs(m2.next).length === 0);
  const bare = rowsOf([{ id: "z", name: "z", life: "running" }]);
  const wrapped = rowsOf({ processes: [{ id: "y", name: "y", life: "running" }], count: 1 });
  ok("rowsOf takes the bare array", bare.length === 1 && bare[0].id === "z");
  ok("rowsOf unwraps the door envelope", wrapped.length === 1 && wrapped[0].id === "y");
  ok("rowsOf survives nothing at all", rowsOf({}).length === 0 && rowsOf(null).length === 0);
  ok("an ended tab says so", tabLabel(m2.next.get("a")).includes("(ended)"));
  ok("a closing tab says so", tabLabel({ id: "x", name: "n", life: "running", seen: 0, minimized: false, closing: true }).includes("(closing)"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[window] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  bootConsoleWindow,
  isAlive,
  mergeConsoles,
  readRoot,
  rowsOf,
  runTests,
  tabLabel,
  visibleTabs
};
//# sourceMappingURL=window.js.map
