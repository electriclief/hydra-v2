import { createEventHandlerClient } from "../client.js";
const GUI_IDS = [
  "eh-status",
  "eh-table",
  "eh-count",
  "eh-payload",
  "eh-filter-name",
  "eh-filter-source",
  "eh-live",
  "eh-refresh",
  "eh-purge",
  "eh-log"
];
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderEventRow(ev) {
  const desc = ev.description ? escapeHtml(ev.description) : '<span class="dim">no description</span>';
  return [
    "<tr>",
    `<td><code>${escapeHtml(ev.name)}</code></td>`,
    `<td>${desc}</td>`,
    `<td>${ev.fired}</td>`,
    `<td><button type="button" data-fire="${escapeHtml(ev.name)}">fire</button></td>`,
    "</tr>"
  ].join("");
}
function renderLogLine(line) {
  const time = escapeHtml(line.t.length >= 19 ? line.t.slice(11, 19) : line.t);
  const srcClass = line.source === "agent" ? "src agentsrc" : "src";
  const parts = [`<div class="line"><span class="t">${time}</span>`, `<span class="name">${escapeHtml(line.name)}</span>`, `<span class="${srcClass}">[${escapeHtml(line.source)}]</span>`];
  if (line.payload !== void 0) parts.push(`<span class="dim">payload</span> ${escapeHtml(JSON.stringify(line.payload))}`);
  if (line.result !== void 0) parts.push(`<span class="dim">\u2192</span> ${escapeHtml(JSON.stringify(line.result))}`);
  if (line.error !== void 0) parts.push(`<span class="dim">!</span> ${escapeHtml(line.error)}`);
  parts.push("</div>");
  return parts.join(" ");
}
function renderStatus(health) {
  const h = health;
  if (!h || h.ok !== true) return "offline";
  const kib = Math.round((h.log?.bytes ?? 0) / 1024 * 10) / 10;
  return `online \xB7 ${h.events ?? 0} events \xB7 log ${h.log?.lines ?? 0} lines / ${kib} KiB`;
}
function mount(doc) {
  const d = doc ?? (typeof document === "undefined" ? void 0 : document);
  if (!d) return null;
  const $ = (id) => d.getElementById(id);
  const table = $("eh-table");
  const logBox = $("eh-log");
  const status = $("eh-status");
  const count = $("eh-count");
  const payloadBox = $("eh-payload");
  const filterName = $("eh-filter-name");
  const filterSource = $("eh-filter-source");
  const liveBox = $("eh-live");
  const refreshBtn = $("eh-refresh");
  const purgeBtn = $("eh-purge");
  if (!table || !logBox || !status || !count || !payloadBox || !filterName || !filterSource || !liveBox || !refreshBtn || !purgeBtn) {
    return null;
  }
  const origin = typeof location !== "undefined" && location.origin ? location.origin : "http://127.0.0.1:8126";
  const client = createEventHandlerClient({ baseUrl: origin });
  let live = null;
  const stopStream = () => {
    if (live) {
      live.abort();
      live = null;
    }
  };
  const refreshList = async () => {
    try {
      const data = await client.list();
      table.innerHTML = data.events.length ? data.events.map(renderEventRow).join("") : '<tr><td colspan="4" class="dim">no events registered yet</td></tr>';
      count.textContent = String(data.events.length);
      status.textContent = renderStatus({ ok: true, events: data.events.length, log: data.stats });
      status.className = "status ok";
    } catch {
      status.textContent = "offline \u2014 the handler is not answering";
      status.className = "status err";
    }
  };
  const refreshLog = async () => {
    try {
      const data = await client.readLog({ limit: 300, name: filterName.value.trim() || void 0, source: filterSource.value || void 0 });
      logBox.innerHTML = data.lines.length ? data.lines.map(renderLogLine).join("") : '<div class="line dim">nothing logged yet</div>';
    } catch {
    }
  };
  const startStream = () => {
    stopStream();
    if (!liveBox.checked) return;
    live = new AbortController();
    client.stream({ onEvent: (line) => {
      logBox.innerHTML += renderLogLine(line);
    } }, live.signal).catch(() => {
    });
  };
  table.addEventListener("click", (ev) => {
    const target = ev.target;
    const name = target && typeof target.getAttribute === "function" ? target.getAttribute("data-fire") : null;
    if (!name) return;
    let payload;
    const raw = payloadBox.value.trim();
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        status.textContent = "payload is not JSON \u2014 firing without it";
      }
    }
    void client.trigger(name, payload, "user").catch((err) => {
      status.textContent = String(err);
    });
  });
  refreshBtn.addEventListener("click", () => {
    void refreshList();
    void refreshLog();
  });
  purgeBtn.addEventListener("click", () => {
    void client.purge().then(() => refreshLog()).catch(() => {
    });
  });
  filterName.addEventListener("input", () => void refreshLog());
  filterSource.addEventListener("change", () => void refreshLog());
  liveBox.addEventListener("change", () => startStream());
  void refreshList();
  void refreshLog();
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
  const row = renderEventRow({ name: "demo", description: "a demo", registeredAt: "", fired: 3, results: 3, errors: 0, lastAt: null });
  ok("a row carries the fire button", row.includes('data-fire="demo"') && row.includes("<td>3</td>"));
  const line = renderLogLine({ t: "2026-09-16T22:00:00.000Z", name: "demo.result", source: "agent", of: "demo", result: 42 });
  ok("a result line renders the arrow", line.includes("\u2192") && line.includes("42"));
  ok("an agent line is marked", line.includes("agentsrc"));
  const errLine = renderLogLine({ t: "2026-09-16T22:00:00.000Z", name: "demo.error", source: "process", of: "demo", error: "boom" });
  ok("an error line renders the text", errLine.includes("boom"));
  ok("status renders online", renderStatus({ ok: true, events: 2, log: { lines: 10, bytes: 2048 } }).startsWith("online \xB7 2 events"));
  ok("status renders offline for junk", renderStatus(null) === "offline");
  const stubDoc = (ids) => {
    const els = /* @__PURE__ */ new Map();
    for (const id of ids) {
      els.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        checked: true,
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
  const broken = mount(stubDoc(GUI_IDS.filter((id) => id !== "eh-log")));
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
  renderEventRow,
  renderLogLine,
  renderStatus,
  runTests
};
//# sourceMappingURL=gui.js.map
