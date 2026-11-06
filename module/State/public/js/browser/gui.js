import { createStateClient } from "../client.js";
const GUI_IDS = [
  "st-status",
  "st-count",
  "st-query",
  "st-refresh",
  "st-live",
  "st-table",
  "st-name",
  "st-marks",
  "st-pull",
  "st-output"
];
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderEntryRow(info) {
  const time = escapeHtml(info.registeredAt.length >= 19 ? info.registeredAt.slice(11, 19) : info.registeredAt);
  const flags = [];
  if (info.hasRecipe) flags.push('<span class="badge door">door</span>');
  for (const [key, mode] of Object.entries(info.serving)) flags.push(`<span class="badge">${escapeHtml(key)}:${escapeHtml(mode)}</span>`);
  if (info.hasRender) flags.push('<span class="badge dim">render</span>');
  if (info.hasUpdate) flags.push('<span class="badge dim">update</span>');
  return [
    "<tr>",
    `<td><code>${escapeHtml(info.path)}</code></td>`,
    `<td class="dim">${time}</td>`,
    `<td>${flags.join(" ") || '<span class="dim">\u2014</span>'}</td>`,
    `<td><button type="button" data-pull="${escapeHtml(info.path)}">pull</button></td>`,
    "</tr>"
  ].join("");
}
function renderReply(answer) {
  if (!answer.ok) {
    const list = answer.code === "ambiguous" ? ` \u2014 candidates: ${(answer.candidates ?? []).map(escapeHtml).join(", ")}` : "";
    return `<div class="line err">${escapeHtml(answer.code)}: ${escapeHtml(answer.name)}${list}</div>`;
  }
  const badge = answer.full ? '<span class="badge full">FULL</span>' : '<span class="badge delta">DELTA</span>';
  const marks = Object.entries(answer.marks);
  return [
    `<div class="line">${badge} <code>${escapeHtml(answer.name)}</code> <span class="dim">${escapeHtml(answer.at)}</span></div>`,
    `<pre class="content">${escapeHtml(JSON.stringify(answer.content, null, 2))}</pre>`,
    marks.length ? `<div class="line dim">marks: ${escapeHtml(JSON.stringify(answer.marks))}</div>` : ""
  ].join("");
}
function renderStatus(health) {
  const h = health;
  if (!h || h.ok !== true) return "offline";
  return `online \xB7 ${h.entries ?? 0} held \xB7 ${h.changes ?? 0} changes`;
}
function mount(doc) {
  const d = doc ?? (typeof document === "undefined" ? void 0 : document);
  if (!d) return null;
  const $ = (id) => d.getElementById(id);
  const status = $("st-status");
  const count = $("st-count");
  const queryBox = $("st-query");
  const refreshBtn = $("st-refresh");
  const liveBox = $("st-live");
  const table = $("st-table");
  const nameBox = $("st-name");
  const marksBox = $("st-marks");
  const pullBtn = $("st-pull");
  const output = $("st-output");
  if (!status || !count || !queryBox || !refreshBtn || !liveBox || !table || !nameBox || !marksBox || !pullBtn || !output) {
    return null;
  }
  const origin = typeof location !== "undefined" && location.origin ? location.origin : "http://127.0.0.1:8127";
  const client = createStateClient({ baseUrl: origin });
  let live = null;
  const stopStream = () => {
    if (live) {
      live.abort();
      live = null;
    }
  };
  const refreshList = async () => {
    try {
      const data = await client.discover(queryBox.value.trim() || void 0);
      table.innerHTML = data.entries.length ? data.entries.map(renderEntryRow).join("") : '<tr><td colspan="4" class="dim">nothing held yet</td></tr>';
      count.textContent = String(data.summary.entries);
      status.textContent = renderStatus({ ok: true, entries: data.summary.entries, changes: data.summary.changes });
      status.className = "status ok";
    } catch {
      status.textContent = "offline \u2014 the registry is not answering";
      status.className = "status err";
    }
  };
  const runPull = async (name) => {
    if (!name) {
      output.innerHTML = '<div class="line err">a pull needs a name</div>';
      return;
    }
    let marks = {};
    const rawMarks = marksBox.value.trim();
    if (rawMarks) {
      try {
        marks = JSON.parse(rawMarks);
      } catch {
        status.textContent = "marks are not JSON \u2014 pulling without them";
      }
    }
    try {
      const answer = await client.pull(name, marks);
      output.innerHTML = renderReply(answer);
    } catch (err) {
      output.innerHTML = `<div class="line err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    }
  };
  const startStream = () => {
    stopStream();
    if (!liveBox.checked) return;
    live = new AbortController();
    client.stream({ onChange: () => void refreshList() }, live.signal).catch(() => {
    });
  };
  table.addEventListener("click", (ev) => {
    const target = ev.target;
    const name = target && typeof target.getAttribute === "function" ? target.getAttribute("data-pull") : null;
    if (!name) return;
    nameBox.value = name;
    void runPull(name);
  });
  refreshBtn.addEventListener("click", () => void refreshList());
  queryBox.addEventListener("input", () => void refreshList());
  liveBox.addEventListener("change", () => startStream());
  pullBtn.addEventListener("click", () => void runPull(nameBox.value.trim()));
  void refreshList();
  startStream();
  return {
    stop: () => {
      stopStream();
    }
  };
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
    mount();
  });
}
async function runTests() {
  const path = await import("node:path");
  const fs = await import("node:fs");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("escapeHtml closes the door", escapeHtml("<img src=x onerror=alert(1)>") === "&lt;img src=x onerror=alert(1)&gt;");
  const row = renderEntryRow({ path: "A.B", registeredAt: "2026-09-23T10:00:00.000Z", updatedAt: "", hasRecipe: true, serving: { log: "delta" }, shape: ["log"], hasRender: false, hasUpdate: false });
  ok("a row carries the pull button and flags", row.includes('data-pull="A.B"') && row.includes("log:delta") && row.includes("door"));
  const full = renderReply({ ok: true, name: "A.B", at: "2026-09-23T10:00:00.000Z", full: true, content: { a: 1 }, marks: { log: 3 } });
  ok("a full reply renders the badge + marks", full.includes(">FULL<") && full.includes("&quot;log&quot;:3"));
  const delta = renderReply({ ok: true, name: "A.B", at: "2026-09-23T10:00:00.000Z", full: false, content: { log: "x" }, marks: {} });
  ok("a delta reply renders the badge", delta.includes(">DELTA<"));
  const refused = renderReply({ ok: false, code: "ambiguous", name: "B", candidates: ["A.B", "C.B"], at: "" });
  ok("a refusal renders the candidates", refused.includes("ambiguous") && refused.includes("A.B"));
  ok("status renders online", renderStatus({ ok: true, entries: 2, changes: 5 }).startsWith("online \xB7 2 held"));
  ok("status renders offline for junk", renderStatus(null) === "offline");
  const stubDoc = (ids) => {
    const els = /* @__PURE__ */ new Map();
    for (const id of ids) {
      els.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        checked: false,
        className: "",
        addEventListener: () => {
        },
        getAttribute: () => null
      });
    }
    return { getElementById: (id) => els.get(id) ?? null };
  };
  const handle = mount(stubDoc(GUI_IDS));
  ok("mount wires the stub page without throwing", handle !== null);
  handle?.stop();
  const broken = mount(stubDoc(GUI_IDS.filter((id) => id !== "st-output")));
  ok("a page missing ONE id fails loudly (null)", broken === null);
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const missing = GUI_IDS.filter((id) => !html.includes(`id="${id}"`));
  ok("index.html carries every wired id", missing.length === 0, missing.join(","));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  GUI_IDS,
  escapeHtml,
  mount,
  renderEntryRow,
  renderReply,
  renderStatus,
  runTests
};
//# sourceMappingURL=gui.js.map
