import { createProcessClient } from "../client.js";
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function lifeClass(life) {
  return `life life-${life}`;
}
function formatChars(n) {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1e3) return String(n);
  if (n < 1e3 * 1e3) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function formatUptime(rec, now = Date.now()) {
  const end = rec.endedAt ?? now;
  const ms = Math.max(0, end - rec.spawnedAt);
  if (ms < 1e3) return `${ms}ms`;
  const s = ms / 1e3;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m${String(Math.floor(s % 60)).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, "0")}m`;
}
function renderProcessRow(rec, opts = {}) {
  const live = rec.life === "running" || rec.life === "starting";
  return [
    `<tr class="${opts.selected ? "selected" : ""}" data-id="${escapeHtml(rec.id)}">`,
    `<td class="mono id">${escapeHtml(rec.id)}</td>`,
    `<td>${escapeHtml(rec.name)}${rec.tag ? ` <span class="tag">${escapeHtml(rec.tag)}</span>` : ""}</td>`,
    `<td class="mono num">${rec.pid ?? "\u2014"}</td>`,
    `<td><span class="${lifeClass(rec.life)}">${escapeHtml(rec.life)}</span></td>`,
    `<td class="mono num">${formatChars(rec.chars.stdout + rec.chars.stderr)}</td>`,
    `<td class="mono num">${formatUptime(rec, opts.now)}</td>`,
    `<td class="mono num">${rec.exitCode === null ? "\u2014" : rec.exitCode}</td>`,
    `<td class="actions">`,
    `<button data-act="view" data-id="${escapeHtml(rec.id)}" title="show this stream">view</button>`,
    live ? `<button data-act="kill" data-id="${escapeHtml(rec.id)}" title="ask it to stop">kill</button><button class="danger" data-act="force" data-id="${escapeHtml(rec.id)}" title="kill the whole tree now">force</button>` : `<button data-act="rm" data-id="${escapeHtml(rec.id)}" title="forget it (the life file stays)">forget</button>`,
    `</td>`,
    `</tr>`
  ].join("");
}
function renderProcessTable(list, opts = {}) {
  if (!list.length) {
    return `<tr class="empty"><td colspan="8">nothing launched yet \u2014 type a command above, or launch a saved one</td></tr>`;
  }
  return list.map((rec) => renderProcessRow(rec, { selected: rec.id === opts.selectedId, now: opts.now })).join("");
}
function renderCommandRow(def) {
  const line = [def.command, ...def.args].join(" ");
  return [
    `<li data-name="${escapeHtml(def.name)}">`,
    `<button data-act="launch-saved" data-name="${escapeHtml(def.name)}" title="launch this saved command">\u25B6</button>`,
    `<span class="mono name">${escapeHtml(def.name)}</span>`,
    `<span class="mono cmd">${escapeHtml(line)}</span>`,
    def.description ? `<span class="desc">${escapeHtml(def.description)}</span>` : "",
    def.tag ? `<span class="tag">${escapeHtml(def.tag)}</span>` : "",
    `<button class="danger" data-act="unsave" data-name="${escapeHtml(def.name)}" title="drop it from data.yaml">\u2715</button>`,
    `</li>`
  ].join("");
}
function renderSavedOptions(list, selected) {
  const head = `<option value="">\u2014 raw command \u2014</option>`;
  return head + list.map((def) => {
    const label = `${def.name}${def.description ? ` \u2014 ${def.description}` : ""}`;
    return `<option value="${escapeHtml(def.name)}"${def.name === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}
function renderHealthBadge(health) {
  if (!health) return "not reachable";
  const procs = health.processes ?? {};
  const saved = health.savedCommands;
  return `ok \xB7 ${procs.live ?? 0} live / ${procs.total ?? 0} total \xB7 ${saved ?? 0} saved \xB7 ${health.copies ?? 0} copies open`;
}
function renderStreamHeader(rec) {
  if (!rec) return "pick a process";
  return `${rec.id} \xB7 ${rec.life} \xB7 pid ${rec.pid ?? "\u2014"} \xB7 ${formatChars(rec.chars.stdout + rec.chars.stderr)} chars \xB7 ${rec.streamFile}`;
}
function followNotice(ev) {
  if (ev.event === "end") return `[stream ended: ${String(ev.data.reason ?? "end")}]
`;
  if (ev.event === "drop") return `[this copy fell behind and shed ${String(ev.data.droppedChars ?? "?")} chars \u2014 the life file still has them]
`;
  if (ev.event === "open") return `[following from ${String(ev.data.from ?? 0)}]
`;
  return "";
}
function parseEnvInput(raw) {
  const text = raw.trim();
  if (!text) return void 0;
  if (text.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`env looks like JSON but does not parse: ${err.message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("env must be a JSON object of names to values");
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) throw new Error(`env line "${trimmed}" is neither JSON nor KEY=VALUE`);
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return Object.keys(out).length ? out : void 0;
}
function mount(doc = typeof document === "undefined" ? void 0 : document) {
  if (!doc) return null;
  const win = doc.defaultView;
  if (!win) return null;
  const $ = (id) => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`gui: missing element #${id}`);
    return el;
  };
  const base = doc.location.origin;
  const tokenKey = "pw.token";
  const savedToken = win.localStorage?.getItem(tokenKey) ?? null;
  let client = createProcessClient({ baseUrl: base, token: savedToken });
  const state = {
    processes: [],
    selectedId: null,
    following: false,
    saved: [],
    savedName: null,
    channel: "both",
    health: null,
    error: null,
    now: Date.now()
  };
  let followHandle = null;
  let followFrom = 0;
  let loadedChars = -1;
  let timer = null;
  const tbody = $("procs-body");
  const streamEl = $("stream");
  const streamHeader = $("stream-header");
  const streamMeta = $("stream-meta");
  const healthEl = $("health");
  const errorEl = $("error");
  const savedList = $("commands");
  const savedSelect = $("saved-select");
  const commandInput = $("command");
  const startButton = $("start");
  const followToggle = $("follow");
  const channelSelect = $("channel");
  const tokenInput = $("token");
  const apiEl = $("api-url");
  const mcpEl = $("mcp-url");
  apiEl.textContent = base;
  mcpEl.textContent = `${base}/mcp`;
  if (savedToken) tokenInput.value = savedToken;
  tokenInput.addEventListener("change", () => {
    const value = tokenInput.value.trim();
    win.localStorage?.setItem(tokenKey, value);
    client = createProcessClient({ baseUrl: base, token: value || null });
    void refresh();
  });
  const showError = (message) => {
    state.error = message;
    errorEl.textContent = message ?? "";
    errorEl.classList.toggle("hidden", !message);
  };
  const closeFollow = () => {
    followHandle?.close();
    followHandle = null;
  };
  const append = (text) => {
    streamEl.textContent = (streamEl.textContent ?? "") + text;
    streamEl.scrollTop = streamEl.scrollHeight;
  };
  const startFollow = () => {
    if (!state.selectedId) return;
    closeFollow();
    followFrom = (streamEl.textContent ?? "").length;
    followHandle = client.follow(
      state.selectedId,
      (ev) => {
        if (ev.event === "chunk") {
          append(String(ev.data.text ?? ""));
          streamMeta.textContent = `${streamEl.textContent?.length ?? 0} chars shown \xB7 following`;
        } else {
          const note = followNotice(ev);
          if (note) append(note);
          if (ev.event === "end") {
            streamMeta.textContent = `${streamEl.textContent?.length ?? 0} chars shown \xB7 stream ended`;
            state.following = false;
            followToggle.checked = false;
          }
        }
      },
      { from: followFrom, channel: state.channel === "both" ? void 0 : state.channel }
    );
  };
  const loadStream = async (id) => {
    try {
      const copy = await client.output(id, { channel: state.channel });
      streamEl.textContent = copy.text;
      loadedChars = copy.total;
      streamMeta.textContent = `${copy.total} chars captured \xB7 showing ${copy.to - copy.from}${copy.complete ? "" : " (the buffer shed the front; the life file has it all)"}`;
      if (state.following) startFollow();
    } catch (err) {
      showError(`could not read ${id}: ${err.message}`);
    }
  };
  const select = (id) => {
    state.selectedId = id;
    closeFollow();
    streamEl.textContent = "";
    loadedChars = -1;
    const rec = state.processes.find((p) => p.id === id) ?? null;
    streamHeader.textContent = renderStreamHeader(rec);
    streamMeta.textContent = "";
    if (!id) return;
    void loadStream(id);
  };
  const refresh = async () => {
    state.now = Date.now();
    try {
      const [list, health, saved] = await Promise.all([client.list(), client.health(), client.commands()]);
      state.processes = list;
      state.health = health;
      state.saved = saved;
      healthEl.textContent = renderHealthBadge(health);
      tbody.innerHTML = renderProcessTable(list, { selectedId: state.selectedId, now: state.now });
      savedList.innerHTML = saved.map(renderCommandRow).join("") || `<li class="empty">nothing saved yet</li>`;
      savedSelect.innerHTML = renderSavedOptions(saved, state.savedName);
      showError(null);
      const selected = state.selectedId ? list.find((p) => p.id === state.selectedId) ?? null : null;
      if (selected) {
        streamHeader.textContent = renderStreamHeader(selected);
        const total = selected.chars.stdout + selected.chars.stderr;
        if (!state.following && total !== loadedChars) await loadStream(selected.id);
      } else if (state.selectedId) {
        select(null);
      }
    } catch (err) {
      healthEl.textContent = "not reachable";
      showError(`${err.message}${tokenInput.value ? "" : " \u2014 if this box needs a token, set it above"}`);
    }
  };
  const launch = async () => {
    const advanced = {
      name: $("opt-name").value.trim() || void 0,
      tag: $("opt-tag").value.trim() || void 0,
      cwd: $("opt-cwd").value.trim() || void 0,
      shell: $("opt-shell").checked
    };
    try {
      const env = parseEnvInput($("opt-env").value);
      showError(null);
      const rec = state.savedName ? await client.launch({ saved: state.savedName, ...advanced, env }) : await client.launch({ command: commandInput.value.trim(), ...advanced, env });
      await refresh();
      select(rec.id);
      if (state.following) startFollow();
    } catch (err) {
      showError(`launch failed: ${err.message}`);
    }
  };
  $("launch-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    void launch();
  });
  savedSelect.addEventListener("change", () => {
    state.savedName = savedSelect.value || null;
    const def = state.saved.find((c) => c.name === state.savedName) ?? null;
    commandInput.value = def ? [def.command, ...def.args].join(" ") : "";
    commandInput.readOnly = !!def;
    commandInput.classList.toggle("readonly", !!def);
    startButton.textContent = def ? `start saved "${def.name}"` : "start";
  });
  followToggle.addEventListener("change", () => {
    state.following = followToggle.checked;
    if (state.following) startFollow();
    else closeFollow();
  });
  channelSelect.addEventListener("change", () => {
    state.channel = channelSelect.value;
    if (state.selectedId) select(state.selectedId);
  });
  tbody.addEventListener("click", (ev) => {
    const target = ev.target;
    const act = target.getAttribute("data-act");
    const id = target.getAttribute("data-id");
    if (!act || !id) return;
    if (act === "view") select(id);
    if (act === "kill" || act === "force") {
      void (async () => {
        try {
          await client.kill(id, { force: act === "force" });
          await refresh();
        } catch (err) {
          showError(`kill failed: ${err.message}`);
        }
      })();
    }
    if (act === "rm") {
      void (async () => {
        try {
          await client.remove(id);
          if (state.selectedId === id) select(null);
          await refresh();
        } catch (err) {
          showError(`remove failed: ${err.message}`);
        }
      })();
    }
  });
  $("reload").addEventListener("click", () => {
    if (state.selectedId) select(state.selectedId);
  });
  $("clear").addEventListener("click", () => {
    streamEl.textContent = "";
    streamMeta.textContent = "";
  });
  const sendStdin = async () => {
    const input = $("stdin");
    const text = input.value;
    if (!state.selectedId || !text) return;
    try {
      await client.input(state.selectedId, text);
      append(`
[sent ${text.length} chars to stdin]
`);
      input.value = "";
    } catch (err) {
      showError(`stdin failed: ${err.message}`);
    }
  };
  $("send").addEventListener("click", () => void sendStdin());
  $("stdin").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void sendStdin();
    }
  });
  savedList.addEventListener("click", (ev) => {
    const target = ev.target;
    const act = target.getAttribute("data-act");
    const name = target.getAttribute("data-name");
    if (!act || !name) return;
    if (act === "launch-saved") {
      void (async () => {
        try {
          const rec = await client.launch({ saved: name });
          await refresh();
          select(rec.id);
        } catch (err) {
          showError(`launch failed: ${err.message}`);
        }
      })();
    }
    if (act === "unsave") {
      void (async () => {
        try {
          await client.removeCommand(name);
          await refresh();
        } catch (err) {
          showError(`unsave failed: ${err.message}`);
        }
      })();
    }
  });
  $("save-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    void (async () => {
      const name = $("save-name").value.trim();
      const command = $("save-cmd").value.trim();
      const description = $("save-desc").value.trim();
      try {
        await client.saveCommand({ name, command, description });
        $("save-name").value = "";
        $("save-cmd").value = "";
        $("save-desc").value = "";
        await refresh();
      } catch (err) {
        showError(`save failed: ${err.message}`);
      }
    })();
  });
  const autoRefresh = $("autorefresh");
  timer = win.setInterval(() => {
    if (autoRefresh.checked) void refresh();
  }, 2e3);
  void refresh();
  return {
    refresh,
    select,
    setFollowing: (on) => {
      followToggle.checked = on;
      state.following = on;
      if (on) startFollow();
      else closeFollow();
    },
    stop: () => {
      closeFollow();
      if (timer !== null) win.clearInterval(timer);
      timer = null;
    },
    state: () => ({ ...state, processes: state.processes })
  };
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
  const boot = () => {
    try {
      mount();
    } catch (err) {
      console.error("[gui] could not wire the page:", err);
      const banner = document.getElementById("error");
      if (banner) {
        banner.textContent = `the GUI could not start: ${err.message}`;
        banner.classList.remove("hidden");
      }
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const rec = (over = {}) => ({
    id: "demo-001-ab12",
    name: "demo",
    tag: null,
    command: "demo.exe",
    args: [],
    cwd: ".",
    shell: false,
    pid: 4242,
    life: "running",
    spawnedAt: Date.now() - 4200,
    endedAt: null,
    exitCode: null,
    signal: null,
    chars: { stdout: 1200, stderr: 0 },
    truncated: false,
    streamFile: "C:/x/demo-001-ab12.log",
    error: null,
    ...over
  });
  ok("escapeHtml escapes the angle brackets", escapeHtml("<script>alert(1)</script>") === "&lt;script&gt;alert(1)&lt;/script&gt;", escapeHtml("<script>"));
  ok("escapeHtml escapes quotes", escapeHtml(`a"b'c`) === "a&quot;b&#39;c", escapeHtml(`a"b'c`));
  ok("escapeHtml handles null", escapeHtml(null) === "");
  ok("small counts stay exact", formatChars(923) === "923", formatChars(923));
  ok("thousands are shortened", formatChars(12340) === "12k", formatChars(12340));
  ok("millions are shortened", formatChars(25e5) === "2.5M", formatChars(25e5));
  ok("nonsense counts do not crash the page", formatChars(Number.NaN) === "0");
  ok("uptime reads in ms under a second", formatUptime(rec({ spawnedAt: 1e3, endedAt: 1400 }), 1e4) === "400ms", formatUptime(rec({ spawnedAt: 1e3, endedAt: 1400 }), 1e4));
  ok("uptime reads in seconds", formatUptime(rec({ spawnedAt: 1e3, endedAt: 9600 }), 1e4) === "8.6s", formatUptime(rec({ spawnedAt: 1e3, endedAt: 9600 }), 1e4));
  ok("uptime reads in minutes and seconds", formatUptime(rec({ spawnedAt: 0, endedAt: 125e3 }), 0) === "2m05s", formatUptime(rec({ spawnedAt: 0, endedAt: 125e3 }), 0));
  ok("a running process counts up to now", formatUptime(rec({ spawnedAt: 0 }), 5e3) === "5.0s", formatUptime(rec({ spawnedAt: 0 }), 5e3));
  const row = renderProcessRow(rec());
  ok("a row carries the id for clicking", row.includes('data-id="demo-001-ab12"'), row.slice(0, 80));
  ok("a live row offers kill and force", row.includes('data-act="kill"') && row.includes('data-act="force"'), row);
  ok("a live row offers view", row.includes('data-act="view"'));
  ok("a live row does NOT offer forget", !row.includes('data-act="rm"'));
  const doneRow = renderProcessRow(rec({ life: "exited", exitCode: 0, endedAt: Date.now() }));
  ok("a finished row offers forget instead of kill", doneRow.includes('data-act="rm"') && !doneRow.includes('data-act="kill"'));
  ok("a finished row shows its exit code", doneRow.includes('<td class="mono num">0</td>'), doneRow);
  ok("the life is styled by class", row.includes("life life-running"), row.slice(0, 200));
  ok("a tag is shown when present", renderProcessRow(rec({ tag: "gpu" })).includes('<span class="tag">gpu</span>'));
  ok("the selected row is marked", renderProcessRow(rec(), { selected: true }).startsWith('<tr class="selected"'));
  ok("a name with markup cannot inject", renderProcessRow(rec({ name: "<img onerror=x>" })).includes("&lt;img onerror=x&gt;"));
  ok("an empty table explains itself", renderProcessTable([]).includes("nothing launched yet"));
  ok("the table renders every row", renderProcessTable([rec({ id: "a-1" }), rec({ id: "b-2" })], { selectedId: "b-2" }).split("<tr").length - 1 === 2);
  ok("the selected id is marked in the table", renderProcessTable([rec({ id: "a-1" }), rec({ id: "b-2" })], { selectedId: "b-2" }).includes('class="selected" data-id="b-2"'));
  const def = {
    name: "tick",
    command: "node",
    args: ["-e", "setInterval(()=>console.log('tick'),1000)"],
    cwd: "",
    env: {},
    shell: false,
    description: "a ticker",
    tag: "demo",
    createdAt: "",
    updatedAt: ""
  };
  const cmdRow = renderCommandRow(def);
  ok("a saved command offers launch and drop", cmdRow.includes('data-act="launch-saved"') && cmdRow.includes('data-act="unsave"'));
  ok("a saved command shows its line and description", cmdRow.includes("a ticker") && cmdRow.includes("setInterval"));
  ok("the picker starts with a raw option", renderSavedOptions([def], null).startsWith('<option value="">\u2014 raw command \u2014</option>'));
  ok("the picker marks the chosen name", renderSavedOptions([def], "tick").includes('<option value="tick" selected>'));
  ok("the picker shows the description as the label", renderSavedOptions([def], null).includes("tick \u2014 a ticker"));
  ok("the badge says when the box is unreachable", renderHealthBadge(null) === "not reachable");
  const badge = renderHealthBadge({ processes: { live: 2, total: 5 }, savedCommands: 3, copies: 1 });
  ok("the badge counts live, total, saved and copies", badge.includes("2 live / 5 total") && badge.includes("3 saved") && badge.includes("1 copies open"), badge);
  ok("the stream heading names the file", renderStreamHeader(rec()).includes("demo-001-ab12.log"));
  ok("an empty stream heading asks for a pick", renderStreamHeader(null) === "pick a process");
  ok("a drop notice admits the loss", followNotice({ event: "drop", data: { droppedChars: 42 } }).includes("42"));
  ok("an end notice names the reason", followNotice({ event: "end", data: { reason: "process-ended" } }).includes("process-ended"));
  ok("a chunk produces no notice text", followNotice({ event: "chunk", data: {} }) === "");
  ok("env accepts KEY=VALUE lines", JSON.stringify(parseEnvInput("HF_HOME=C:/models\nPY=1")) === JSON.stringify({ HF_HOME: "C:/models", PY: "1" }), JSON.stringify(parseEnvInput("HF_HOME=C:/models\nPY=1")));
  ok("env accepts a JSON object", JSON.stringify(parseEnvInput('{"A":"1"}')) === JSON.stringify({ A: "1" }));
  ok("an empty env box means no env", parseEnvInput("   ") === void 0);
  ok("a broken env box explains itself", (() => {
    try {
      parseEnvInput("{oops: 1}");
      return false;
    } catch (err) {
      return err.message.includes("does not parse");
    }
  })());
  ok("a junk env line explains itself", (() => {
    try {
      parseEnvInput("just-a-word");
      return false;
    } catch (err) {
      return err.message.includes("KEY=VALUE");
    }
  })());
  const REQUIRED_IDS = [
    "health",
    "error",
    "procs-body",
    "stream",
    "stream-header",
    "stream-meta",
    "commands",
    "saved-select",
    "command",
    "start",
    "follow",
    "channel",
    "token",
    "api-url",
    "mcp-url",
    "launch-form",
    "reload",
    "clear",
    "stdin",
    "send",
    "save-form",
    "save-name",
    "save-cmd",
    "save-desc",
    "opt-name",
    "opt-tag",
    "opt-cwd",
    "opt-env",
    "opt-shell",
    "autorefresh"
  ];
  const fs = await import("node:fs");
  const url = await import("node:url");
  const pagePath = url.fileURLToPath(new URL("../../../public/index.html", import.meta.url));
  const page = fs.readFileSync(pagePath, "utf8");
  ok("the page carries every id the module wires", REQUIRED_IDS.every((id) => page.includes(`id="${id}"`)), REQUIRED_IDS.filter((id) => !page.includes(`id="${id}"`)).join(","));
  ok("the page loads the module it needs", page.includes("/js/browser/gui.js"));
  const makeStub = (ids) => {
    const els = /* @__PURE__ */ new Map();
    for (const id of ids) {
      els.set(id, {
        id,
        textContent: "",
        innerHTML: "",
        value: "",
        checked: false,
        readOnly: false,
        scrollTop: 0,
        scrollHeight: 0,
        options: [],
        classList: { add() {
        }, remove() {
        }, toggle() {
        }, contains: () => false },
        addEventListener() {
        },
        setAttribute() {
        },
        getAttribute: () => null
      });
    }
    const cleared = [];
    const doc = {
      location: { origin: "http://127.0.0.1:8125" },
      getElementById: (id) => els.get(id) ?? null,
      addEventListener() {
      },
      defaultView: {
        setInterval: () => 7,
        clearInterval: (t) => cleared.push(t),
        localStorage: { getItem: () => null, setItem() {
        } }
      }
    };
    return { doc, els, cleared };
  };
  ok("mount() without a document is a no-op, not a crash", mount(void 0) === null);
  const stub = makeStub(REQUIRED_IDS);
  const handle = mount(stub.doc);
  ok("mount wires the whole real page without throwing", handle !== null);
  ok("the stub page has every element the module asked for", REQUIRED_IDS.every((id) => stub.els.has(id)));
  ok("mount exposes state, refresh, select and stop", !!handle && typeof handle.refresh === "function" && typeof handle.select === "function" && typeof handle.stop === "function" && handle.state().processes.length === 0);
  ok("mount points the page at its own origin", stub.els.get("api-url")?.textContent === "http://127.0.0.1:8125" && stub.els.get("mcp-url")?.textContent === "http://127.0.0.1:8125/mcp", String(stub.els.get("mcp-url")?.textContent));
  handle?.stop();
  ok("stop clears the refresh timer", stub.cleared.includes(7), JSON.stringify(stub.cleared));
  const missingOne = REQUIRED_IDS.filter((id) => id !== "procs-body");
  ok("a page missing one id fails loudly instead of half-working", (() => {
    try {
      mount(makeStub(missingOne).doc);
      return false;
    } catch (err) {
      return err.message.includes("procs-body");
    }
  })());
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  escapeHtml,
  followNotice,
  formatChars,
  formatUptime,
  lifeClass,
  mount,
  parseEnvInput,
  renderCommandRow,
  renderHealthBadge,
  renderProcessRow,
  renderProcessTable,
  renderSavedOptions,
  renderStreamHeader,
  runTests
};
//# sourceMappingURL=gui.js.map
