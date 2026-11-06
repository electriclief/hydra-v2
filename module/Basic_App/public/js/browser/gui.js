function buildFields(def, saved = {}) {
  const out = [];
  for (const v of def.variables?.input ?? []) {
    if (!v || typeof v.name !== "string") continue;
    const muted = v.muted === true;
    const fallback = v.default === void 0 || v.default === null ? "" : String(v.default);
    const kept = muted ? fallback : saved[v.name] !== void 0 && saved[v.name] !== null ? String(saved[v.name]) : fallback;
    out.push({
      name: v.name,
      label: typeof v.label === "string" && v.label ? v.label : v.name,
      type: typeof v.type === "string" && v.type ? v.type : "text",
      value: kept,
      required: v.required === true,
      muted,
      full: v.full === true || typeof v.type === "string" && v.type === "textarea",
      help: typeof v.help === "string" ? v.help : null,
      min: typeof v.min === "number" ? v.min : null,
      max: typeof v.max === "number" ? v.max : null,
      step: typeof v.step === "number" ? v.step : null,
      options: Array.isArray(v.options) ? v.options.map(String) : [],
      isOutput: v.role === "output"
    });
  }
  return out;
}
function renderList(services, selected) {
  if (!services.length) return '<p class="dim">no services answer \u2014 is the services door up?</p>';
  return services.map((s) => {
    const badge = s.ok === false ? '<span class="badge warn">warning</span>' : "";
    const karma = s.karma === null || s.karma === void 0 ? "" : `<span class="karma">${s.karma} karma</span>`;
    return `<div class="item${s.name === selected ? " on" : ""}" data-name="${escapeAttr(s.name)}" tabindex="0">
        <div class="item-name">${escapeHtml(s.name)} ${badge}</div>
        <div class="item-what">${escapeHtml(s.what ?? "")}</div>
        <div class="item-side">${escapeHtml(s.provider ?? "")} ${karma}</div>
      </div>`;
  }).join("");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
function runLine(state) {
  const r = state.run;
  if (!r) return "idle";
  const life = r.life === "running" || r.life === "starting" ? "running" : `ended (exit ${r.exitCode ?? "?"})`;
  return `${r.name} \u2014 ${life} \u2014 pid ${r.pid ?? "\u2026"}`;
}
function mount(doc = document) {
  const el = (id) => doc.getElementById(id);
  const servicesEl = el("services");
  const viewerEl = el("viewer");
  const busyStrip = el("busy-strip");
  const busyText = el("busy-text");
  const btnStop = el("btn-stop");
  const btnGui = el("btn-gui");
  const scout = el("scout");
  const logEl = el("run-log");
  let selected = null;
  let definitions = /* @__PURE__ */ new Map();
  let busy = false;
  let mode = "ad";
  let progressFrom = 0;
  let progressTimer = null;
  const savedKey = (name) => `basic.inputs.${name}`;
  const loadSaved = (name) => {
    try {
      return JSON.parse(localStorage.getItem(savedKey(name)) ?? "{}");
    } catch {
      return {};
    }
  };
  const saveField = (name, field, value, muted) => {
    if (muted) return;
    const all = loadSaved(name);
    all[field] = value;
    localStorage.setItem(savedKey(name), JSON.stringify(all));
  };
  async function api(p, init) {
    const res = await fetch(p, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    return body;
  }
  async function loadServices() {
    try {
      const answer = await api("/api/basic/services");
      servicesEl.innerHTML = renderList(answer.services ?? [], selected);
      for (const item of Array.from(servicesEl.querySelectorAll(".item"))) {
        const name = item.dataset.name ?? "";
        item.addEventListener("mouseenter", () => void show(name));
        item.addEventListener("focus", () => void show(name));
        item.addEventListener("click", () => void show(name));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") void show(name);
        });
      }
    } catch (err) {
      servicesEl.innerHTML = `<p class="dim">${escapeHtml(String(err))}</p>`;
    }
  }
  async function show(name) {
    selected = name;
    for (const item of Array.from(servicesEl.querySelectorAll(".item"))) {
      item.classList.toggle("on", item.dataset.name === name);
    }
    if (busy || mode === "run") return;
    mode = "ad";
    const ad = await fetch(`/api/basic/services/${encodeURIComponent(name)}/ad`).then((r) => r.text());
    viewerEl.innerHTML = `
      <iframe id="ad-frame" sandbox="allow-same-origin"></iframe>
      <div class="foot">
        <button id="btn-prepare" ${busy ? "disabled" : ""}>Prepare this serve \u2192</button>
        <span class="dim" id="pick-note"></span>
      </div>`;
    doc.getElementById("ad-frame").srcdoc = ad;
    const btn = doc.getElementById("btn-prepare");
    btn.addEventListener("click", () => void prepare(name));
  }
  async function prepare(name) {
    if (busy) return;
    mode = "inputs";
    const answer = await api(`/api/basic/services/${encodeURIComponent(name)}`);
    definitions.set(name, answer.service);
    const inputsPage = await fetch(`/api/basic/services/${encodeURIComponent(name)}/inputs`).then((r) => r.text());
    const fields = buildFields(answer.service, loadSaved(name));
    viewerEl.innerHTML = `
      <iframe id="inputs-frame" sandbox="allow-same-origin"></iframe>
      <div class="form" id="form">
        ${fields.map(fieldHtml).join("")}
      </div>
      <div class="foot">
        <button id="btn-back">\u2190 back to the ad</button>
        <button id="btn-run" ${busy ? "disabled" : ""}>\u25B6 Run ${escapeHtml(name)}</button>
        <span class="dim">one at a time \u2014 no queue</span>
      </div>`;
    doc.getElementById("inputs-frame").srcdoc = inputsPage;
    for (const input of Array.from(doc.querySelectorAll("#form [data-field]"))) {
      const fieldName = input.dataset.field ?? "";
      const muted = input.dataset.muted === "1";
      const read = () => input.type === "checkbox" ? input.checked : input.value;
      input.addEventListener("change", () => saveField(name, fieldName, read(), muted));
    }
    doc.getElementById("btn-back").addEventListener("click", () => void show(name));
    doc.getElementById("btn-run").addEventListener("click", () => void run(name));
  }
  function fieldHtml(f) {
    const bits = [];
    const common = `data-field="${escapeAttr(f.name)}" data-muted="${f.muted ? "1" : "0"}"`;
    if (f.type === "textarea") {
      bits.push(`<textarea ${common} rows="4">${escapeHtml(f.value)}</textarea>`);
    } else if (f.type === "select" || f.options.length) {
      const opts = f.options.map((o) => `<option value="${escapeAttr(o)}"${o === f.value ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
      bits.push(`<select ${common}>${opts}</select>`);
    } else if (f.type === "boolean" || f.type === "checkbox") {
      bits.push(`<label class="check"><input type="checkbox" ${common} ${f.value === "true" ? "checked" : ""}> ${escapeHtml(f.label)}</label>`);
    } else {
      const attrs = [
        `type="${f.type === "number" || f.type === "range" ? f.type : "text"}"`,
        common,
        f.min !== null ? `min="${f.min}"` : "",
        f.max !== null ? `max="${f.max}"` : "",
        f.step !== null ? `step="${f.step}"` : "",
        `value="${escapeAttr(f.value)}"`
      ].filter(Boolean).join(" ");
      bits.push(`<input ${attrs}>`);
    }
    const head = `<label class="flabel"><span>${escapeHtml(f.label)}${f.required ? ' <b class="req">*</b>' : ""}${f.isOutput ? ' <span class="dim">(kept fresh on every run)</span>' : ""}</span></label>`;
    const help = f.help ? `<div class="fhelp">${escapeHtml(f.help)}</div>` : "";
    return `<div class="field${f.full ? " full" : ""}${f.muted ? " muted" : ""}">${head}${f.type === "boolean" ? "" : ""}${bits.join("")}${help}</div>`;
  }
  function collect(name) {
    const values = {};
    for (const input of Array.from(doc.querySelectorAll("#form [data-field]"))) {
      values[input.dataset.field ?? ""] = input.type === "checkbox" ? input.checked : input.value;
    }
    return values;
  }
  async function run(name) {
    if (busy) return;
    const btn = doc.getElementById("btn-run");
    if (btn) btn.disabled = true;
    try {
      const answer = await api(
        "/api/basic/run",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, values: collect(name) }) }
      );
      mode = "run";
      progressFrom = 0;
      renderRun(name, answer.run, answer.freshOutput ?? []);
      startProgress(name);
      void pollState();
    } catch (err) {
      mode = "inputs";
      scout.textContent = `run refused: ${String(err)}`;
      if (btn) btn.disabled = false;
    }
  }
  function renderRun(name, r, fresh) {
    const gui = r?.gui;
    const how = r?.progressHow;
    viewerEl.innerHTML = `
      <div class="runhead">
        <b>${escapeHtml(name)}</b> is running \u2014 the app watches now.
        ${r?.outputPath ? `<div class="dim">output \u2192 ${escapeHtml(r.outputPath)}</div>` : ""}
        ${fresh.map((f) => `<div class="dim">kept fresh: ${escapeHtml(f.from)} \u2192 ${escapeHtml(f.to)}</div>`).join("")}
        ${how ? `<div class="dim">progress declared: ${escapeHtml(how)}</div>` : '<div class="dim">no progress declared \u2014 copying the output anyway</div>'}
      </div>
      <div class="foot">
        ${gui?.value ? `<button id="btn-gui">follow the service's own gui \u2192</button>` : ""}
        <button id="btn-stop">\u25A0 Stop</button>
      </div>
      <pre id="run-log"></pre>`;
    logEl.textContent = "";
  }
  function startProgress(name) {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      void (async () => {
        try {
          const answer = await api(`/api/basic/progress?from=${progressFrom}`);
          if (answer.text) {
            const log = doc.getElementById("run-log");
            if (log) log.textContent = (log.textContent ?? "") + answer.text;
          }
          progressFrom = answer.from;
        } catch {
        }
      })();
    }, 900);
  }
  async function pollState() {
    try {
      const state = await api("/api/basic/state");
      busy = state.busy === true;
      busyStrip.style.display = busy ? "flex" : "none";
      if (busy && state.run) {
        busyText.textContent = `${state.run.name} \u2014 ${state.run.life} \u2014 pid ${state.run.pid ?? "\u2026"}`;
        btnStop.style.display = "inline-block";
        btnGui.style.display = state.run.gui?.value ? "inline-block" : "none";
      } else {
        busyText.textContent = "";
        btnStop.style.display = "none";
        btnGui.style.display = "none";
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        if (mode === "run") {
          const done = doc.getElementById("run-log");
          if (done && !done.dataset.settled) done.dataset.settled = "1";
          mode = "ad";
          if (selected) void show(selected);
        }
      }
      for (const b of Array.from(doc.querySelectorAll("#btn-run, #btn-prepare"))) {
        b.disabled = busy;
      }
    } catch {
    }
  }
  btnStop.addEventListener("click", () => {
    void api("/api/basic/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => void 0);
  });
  btnGui.addEventListener("click", () => {
    void api("/api/basic/gui", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch((err) => {
      scout.textContent = `gui: ${String(err)}`;
    });
  });
  void loadServices();
  void pollState();
  setInterval(() => void pollState(), 1500);
  setInterval(() => void loadServices(), 15e3);
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL gui :: ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const list = renderList(
    [
      { name: "chat", what: "one chat, several brains", provider: "llama.cpp", modes: [], karma: 3, ok: true },
      { name: "broken", what: "x", provider: "y", modes: [], karma: null, ok: false }
    ],
    "chat"
  );
  ok("the list marks the viewed row", list.includes('class="item on" data-name="chat"'));
  ok("a warning service carries its badge", list.includes("warning"));
  ok("the karma rides the row", list.includes("3 karma"));
  const fields = buildFields(
    {
      name: "demo",
      variables: {
        input: [
          { name: "prompt", type: "text", required: true },
          { name: "out", type: "text", default: "C:/out.png", role: "output" },
          { name: "model", type: "select", default: "a", options: ["a", "b"], muted: true },
          { name: "steps", type: "number", default: 20, min: 1, max: 100 }
        ]
      }
    },
    { prompt: "kept!", model: "b" }
  );
  ok("saved values come back", fields.find((f) => f.name === "prompt")?.value === "kept!");
  ok("a muted field always resets to its default", fields.find((f) => f.name === "model")?.value === "a");
  ok("the output field is marked", fields.find((f) => f.name === "out")?.isOutput === true);
  ok("numeric bounds survive", fields.find((f) => f.name === "steps")?.max === 100);
  ok("a required field is marked", fields.find((f) => f.name === "prompt")?.required === true);
  ok("escaping holds", escapeHtml(`<b>&"'`).includes("&lt;b&gt;"));
  ok("an idle run line reads idle", runLine({ ok: true, busy: false, run: null }) === "idle");
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  buildFields,
  escapeAttr,
  escapeHtml,
  mount,
  renderList,
  runLine,
  runTests
};
//# sourceMappingURL=gui.js.map
