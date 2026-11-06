import { createServicesClient, ServicesError } from "../client.js";
const GUI_IDS = [
  "svc-status",
  "svc-count",
  "svc-filter",
  "svc-refresh",
  "svc-table",
  "svc-detail"
];
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderServiceRow(summary) {
  const modes = summary.modes.length ? summary.modes.map((mode) => `<span class="badge">${escapeHtml(mode)}</span>`).join(" ") : '<span class="dim">\u2014</span>';
  const karma = summary.karma === null ? '<span class="dim">\u2014</span>' : String(summary.karma);
  const state = summary.ok ? '<span class="badge ok">sound</span>' : '<span class="badge err">refused</span>';
  const pageLink = summary.ok ? `<a href="api/services/${encodeURIComponent(summary.name)}/ad" target="_blank" rel="noreferrer">ad</a> \xB7 <a href="api/services/${encodeURIComponent(summary.name)}/inputs" target="_blank" rel="noreferrer">inputs</a>` : '<span class="dim">\u2014</span>';
  return [
    "<tr>",
    `<td><code>${escapeHtml(summary.name)}</code><div class="dim">${escapeHtml(summary.what)}</div></td>`,
    `<td>${escapeHtml(summary.provider) || '<span class="dim">\u2014</span>'}</td>`,
    `<td>${modes}</td>`,
    `<td>${karma}</td>`,
    `<td>${state}</td>`,
    `<td><button type="button" data-get="${escapeHtml(summary.name)}">inspect</button> ${pageLink}</td>`,
    "</tr>"
  ].join("");
}
function renderDetail(entry) {
  const name = escapeHtml(entry.name);
  const warnings = (entry.warnings ?? []).map((w) => `<div class="line dim">warn: ${escapeHtml(w.field)} \u2014 ${escapeHtml(w.message)}</div>`).join("");
  return [
    `<div class="line"><code>${name}</code> <span class="dim">${escapeHtml(entry.file)}</span></div>`,
    `<div class="line"><a href="api/services/${encodeURIComponent(entry.name)}/ad" target="_blank" rel="noreferrer">open the ad page (the sell sheet)</a> \xB7 <a href="api/services/${encodeURIComponent(entry.name)}/inputs" target="_blank" rel="noreferrer">open the inputs page (the way in)</a></div>`,
    warnings,
    `<pre class="content">${escapeHtml(JSON.stringify(entry.service, null, 2))}</pre>`
  ].join("");
}
function renderRefused(name, message) {
  return `<div class="line err">${escapeHtml(name)}: ${escapeHtml(message)}</div>`;
}
function renderStatus(data) {
  if (!data || data.ok !== true) return "offline";
  const refused = data.refused ? ` \xB7 ${data.refused} refused` : "";
  return `online \xB7 ${data.services ?? 0} services${refused} \xB7 ${data.dir ?? ""}`;
}
function mount(doc) {
  const d = doc ?? (typeof document === "undefined" ? void 0 : document);
  if (!d) return null;
  const $ = (id) => d.getElementById(id);
  const status = $("svc-status");
  const count = $("svc-count");
  const filterBox = $("svc-filter");
  const refreshBtn = $("svc-refresh");
  const table = $("svc-table");
  const detail = $("svc-detail");
  if (!status || !count || !filterBox || !refreshBtn || !table || !detail) {
    return null;
  }
  const origin = typeof location !== "undefined" && location.origin ? location.origin : "http://127.0.0.1:8128";
  const client = createServicesClient({ baseUrl: origin });
  const refreshList = async () => {
    try {
      const data = await client.list(filterBox.value.trim() || void 0);
      table.innerHTML = data.services.length ? data.services.map(renderServiceRow).join("") : '<tr><td colspan="6" class="dim">no services \u2014 drop a .js service file into the services folder and reload</td></tr>';
      count.textContent = String(data.services.length);
      status.textContent = renderStatus({ ok: true, services: data.services.length, refused: data.services.filter((s) => !s.ok).length, dir: data.dir });
      status.className = "status ok";
    } catch {
      status.textContent = "offline \u2014 the services door is not answering";
      status.className = "status err";
    }
  };
  const showDetail = async (name) => {
    if (!name) return;
    try {
      const entry = await client.get(name);
      detail.innerHTML = renderDetail(entry);
    } catch (err) {
      detail.innerHTML = renderRefused(name, err instanceof ServicesError ? err.message : String(err));
    }
  };
  table.addEventListener("click", (ev) => {
    const target = ev.target;
    const name = target && typeof target.getAttribute === "function" ? target.getAttribute("data-get") : null;
    if (!name) return;
    void showDetail(name);
  });
  refreshBtn.addEventListener("click", () => {
    void client.reload().then(() => refreshList());
  });
  filterBox.addEventListener("input", () => void refreshList());
  void refreshList();
  return {
    stop: () => {
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
  const row = renderServiceRow({ name: "tts", what: "speak a line", provider: "piper", modes: ["cpu", "gpu"], karma: 2, output: "file", children: 0, ok: true, file: "x.js" });
  ok("a row carries the modes, karma and state", row.includes('data-get="tts"') && row.includes(">cpu<") && row.includes(">2<") && row.includes("sound"));
  const refusedRow = renderServiceRow({ name: "bad", what: "", provider: "", modes: [], karma: null, output: null, children: 0, ok: false, file: "bad.js" });
  ok("a refused row reads refused", refusedRow.includes("refused") && !refusedRow.includes("api/services"));
  const detailHtml = renderDetail({ ok: true, name: "tts", file: "tts.js", warnings: [{ level: "warning", field: "advert.time", message: "no expected time yet" }], service: { name: "tts" } });
  ok("the detail carries the JSON and the warnings", detailHtml.includes("&quot;name&quot;: &quot;tts&quot;") && detailHtml.includes("advert.time"));
  ok("status renders online", renderStatus({ ok: true, services: 2, refused: 1, dir: "x" }).startsWith("online \xB7 2 services \xB7 1 refused"));
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
  const broken = mount(stubDoc(GUI_IDS.filter((id) => id !== "svc-detail")));
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
  renderDetail,
  renderRefused,
  renderServiceRow,
  renderStatus,
  runTests
};
//# sourceMappingURL=gui.js.map
