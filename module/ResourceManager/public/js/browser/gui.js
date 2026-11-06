import { summarizeBooking } from "../resourceSchema.js";
const GUI_IDS = {
  root: "rm-root",
  sub: "rm-sub",
  resources: "rm-resources",
  bookings: "rm-bookings",
  form: "rm-form",
  outcome: "rm-outcome"
};
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtMb(value) {
  if (value === null || value === void 0 || !Number.isFinite(value)) return "\u2014";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} TB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}
function row(k, v) {
  return `<div class="row"><span class="k">${escapeHtml(k)}</span><span>${v}</span></div>`;
}
function renderResources(reads) {
  const parts = [];
  parts.push(row("node", `${escapeHtml(reads.node)} <span class="dim">(${escapeHtml(reads.platform)})</span>`));
  parts.push(row("cpu", `${escapeHtml(reads.cpu.model)} \u2014 ${reads.cpu.cores} cores \xB7 load ${reads.cpu.loadPct ?? "?"}%`));
  parts.push(row("ram", `${fmtMb(reads.ram.freeMb)} free of ${fmtMb(reads.ram.totalMb)}`));
  const gpus = reads.gpus.length ? reads.gpus.map((gpu) => {
    const observed = reads.gpusObserved.filter((p) => gpuObservedLooksRelated(p.name, gpu.name));
    const obs = observed.length ? ` <span class="badge">observed: ${observed.map((p) => escapeHtml(p.name)).join(", ")}</span>` : "";
    return `${escapeHtml(gpu.name)} \u2014 ${fmtMb(gpu.vramMb)} <span class="dim">(${escapeHtml(gpu.vramSource)})</span>${obs}`;
  }).join("<br>") : '<span class="dim">none read</span>';
  parts.push(row("gpus", gpus));
  const stray = reads.gpusObserved.filter((p) => !reads.gpus.some((gpu) => gpuObservedLooksRelated(p.name, gpu.name)));
  if (stray.length) parts.push(row("observed", `<span class="badge">${stray.map((p) => escapeHtml(`${p.name} (pid ${p.pid} \xB7 ${p.reason})`)).join('</span> <span class="badge">')}</span>`));
  parts.push(
    row(
      "disks",
      reads.disks.length ? reads.disks.map((disk) => `${escapeHtml(disk.device)} ${fmtMb(disk.freeMb)} free / ${fmtMb(disk.totalMb)}`).join("<br>") : '<span class="dim">none read</span>'
    )
  );
  parts.push(
    row(
      "shares",
      reads.shares.length ? reads.shares.map((share) => {
        const state = share.exists ? `<span class="badge ok">exists</span>` : `<span class="badge err">missing</span>`;
        return `${escapeHtml(share.label ? share.label + " \u2014 " : "")}<span class="mono">${escapeHtml(share.path)}</span> ${state} ${fmtMb(share.freeMb)} free`;
      }).join("<br>") : '<span class="dim">none declared (data/shares.json)</span>'
    )
  );
  if (reads.notes.length) parts.push(row("notes", `<span class="dim">${reads.notes.map(escapeHtml).join("<br>")}</span>`));
  return parts.join("");
}
function gpuObservedLooksRelated(processName, gpuName) {
  const p = processName.toLowerCase();
  const g = gpuName.toLowerCase();
  return g.includes("nvidia") && !p.includes("lolminer") || g.includes("radeon") && !/python|llama|sd|comfy/.test(p) ? p.length > 0 : false;
}
function renderBookings(active, ended = []) {
  const rows = active.length ? active.map(
    (booking) => `<tr><td>${escapeHtml(booking.service)}${booking.mode ? ` <span class="dim">\xB7 ${escapeHtml(booking.mode)}</span>` : ""}</td><td>${escapeHtml(summarizeBooking(booking))}</td><td class="dim">${escapeHtml(booking.bookedAt.replace("T", " ").slice(0, 19))}${booking.expected ? ` \xB7 ~${escapeHtml(booking.expected)}` : ""}</td><td><button data-act="pop" data-id="${escapeHtml(booking.id)}">pop</button> <button data-act="clear" data-id="${escapeHtml(booking.id)}">clear</button></td></tr>`
  ).join("") : "";
  const table = active.length ? `<table><thead><tr><th>service</th><th>holds</th><th>since</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="dim">nothing is booked \u2014 the register is empty (it never lies about that).</p>';
  const endedRows = ended.length ? `<p class="dim" style="margin-top:10px">ended (last ${ended.length}): ${ended.slice(-8).map((booking) => `${escapeHtml(booking.service)} <span class="badge">${booking.endReason}</span>`).join(" \xB7 ")}</p>` : "";
  return table + endedRows;
}
function renderOutcome(outcome) {
  if (outcome.ok) {
    return `<div class="outcome ok">booked <span class="mono">${escapeHtml(outcome.booking.id)}</span> \u2014 ${escapeHtml(outcome.booking.service)} holds ${escapeHtml(summarizeBooking(outcome.booking)) || "(nothing)"}</div>`;
  }
  const blockers = outcome.error.blockers.map((blocker) => `<div class="dim">${blocker.heldBy ? `\u21B3 held by ${escapeHtml(blocker.heldBy.service)} since ${escapeHtml(blocker.heldBy.since)}` : "\u21B3 " + escapeHtml(blocker.kind)}</div>`).join("");
  return `<div class="outcome err">refused <span class="badge err">${escapeHtml(outcome.error.code)}</span> \u2014 ${escapeHtml(outcome.error.message)}${blockers}</div>`;
}
const SHELL = `
<section class="panes">
  <div class="pane"><h3>the machine <button id="rm-refresh" style="float:right">refresh</button></h3><div id="rm-resources" class="dim">loading\u2026</div></div>
  <div class="pane"><h3>the register</h3><div id="rm-bookings" class="dim">loading\u2026</div></div>
</section>
<h2>book</h2>
<form id="rm-form">
  <div class="grid">
    <div><label for="rm-service">service *</label><input id="rm-service" required></div>
    <div><label for="rm-mode">mode</label><input id="rm-mode"></div>
    <div><label for="rm-gpu">gpu</label><input id="rm-gpu" placeholder="exactly as the poll shows it"></div>
    <div><label for="rm-cores">cores</label><input id="rm-cores" type="number" min="0" step="1"></div>
    <div><label for="rm-ram">ram MB</label><input id="rm-ram" type="number" min="0"></div>
    <div><label for="rm-disk">disk MB</label><input id="rm-disk" type="number" min="0"></div>
    <div class="wide"><label for="rm-paths">paths (comma separated \u2014 a booked folder covers its subtree)</label><input id="rm-paths"></div>
    <div class="wide"><label for="rm-expected">expected (info only \u2014 leave empty when unknown)</label><input id="rm-expected"></div>
  </div>
  <button type="submit">book</button>
</form>
<div id="rm-outcome"></div>
`;
function mount(root, options) {
  const client = options.client;
  root.innerHTML = SHELL;
  const byId = (id) => root.querySelector("#" + id);
  const resourcesEl = byId(GUI_IDS.resources);
  const bookingsEl = byId(GUI_IDS.bookings);
  const outcomeEl = byId(GUI_IDS.outcome);
  const value = (id) => byId(id)?.value.trim() ?? "";
  async function refresh() {
    try {
      const [view, register] = await Promise.all([client.resources(), client.bookings(true)]);
      if (resourcesEl) resourcesEl.innerHTML = renderResources(view.resources);
      if (bookingsEl) bookingsEl.innerHTML = renderBookings(register.active, register.ended ?? []);
    } catch (err) {
      if (resourcesEl) resourcesEl.innerHTML = `<span class="badge err">read failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`;
    }
  }
  byId("rm-refresh")?.addEventListener("click", () => void refresh());
  root.addEventListener("click", (event) => {
    const target = event.target;
    const button = target?.closest?.("[data-act]");
    if (!button) return;
    const id = button.getAttribute("data-id") ?? "";
    const act = button.getAttribute("data-act");
    void (async () => {
      try {
        if (act === "pop") await client.pop(id);
        else if (act === "clear") await client.clear(id);
      } catch (err) {
        if (outcomeEl) outcomeEl.innerHTML = `<div class="outcome err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      }
      await refresh();
    })();
  });
  byId(GUI_IDS.form)?.addEventListener("submit", (event) => {
    event.preventDefault();
    const paths = value("rm-paths");
    const num = (id) => {
      const raw = value(id);
      if (!raw) return void 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : void 0;
    };
    void (async () => {
      try {
        const outcome = await client.book({
          service: value("rm-service"),
          mode: value("rm-mode") || null,
          gpu: value("rm-gpu") || null,
          cores: num("rm-cores"),
          ramMb: num("rm-ram"),
          diskMb: num("rm-disk"),
          paths: paths ? paths.split(/[,\n;]+/).map((piece) => piece.trim()).filter(Boolean) : [],
          expected: value("rm-expected") || null
        });
        if (outcomeEl) outcomeEl.innerHTML = renderOutcome(outcome);
      } catch (err) {
        if (outcomeEl) outcomeEl.innerHTML = `<div class="outcome err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      }
      await refresh();
    })();
  });
  void refresh();
  const intervalMs = options.intervalMs ?? 5e3;
  const timer = intervalMs > 0 ? setInterval(() => void refresh(), intervalMs) : null;
  return { stop: () => {
    if (timer) clearInterval(timer);
  } };
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById(GUI_IDS.root);
    if (!root) return;
    void import("../client.js").then(({ createRmClient }) => {
      mount(root, { client: createRmClient({ baseUrl: window.location.origin }) });
    });
  });
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const reads = {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    node: "test-node",
    platform: "win32",
    cpu: { model: "Fake Ryzen", cores: 16, loadPct: 12.5 },
    ram: { totalMb: 32768, freeMb: 2e4 },
    gpus: [{ name: "AMD Radeon RX 6800", vramMb: 16384, vramSource: "registry", memUsedMb: null }],
    gpusObserved: [{ name: "lolMiner.exe", pid: 7, reason: "miner" }],
    disks: [{ device: "C:", freeMb: 1e5, totalMb: 5e5 }],
    shares: [{ label: "models", path: "C:\\Hydra\\shared\\models", exists: true, freeMb: 1e5, totalMb: 5e5 }],
    notes: []
  };
  const resourcesHtml = renderResources(reads);
  ok("resources: names the machine and its cores", resourcesHtml.includes("Fake Ryzen") && resourcesHtml.includes("16 cores"));
  ok("resources: vram shows in GB with its source", resourcesHtml.includes("16.0 GB") && resourcesHtml.includes("registry"));
  ok("resources: the observed miner is visible", resourcesHtml.includes("lolMiner.exe"));
  ok("resources: the share shows with its state", resourcesHtml.includes("models") && resourcesHtml.includes("exists"));
  const booking = {
    id: "bk-abc",
    service: "image-gen",
    mode: "krea2",
    gpu: "AMD Radeon RX 6800",
    cores: 4,
    ramMb: 8e3,
    diskMb: null,
    paths: ["C:\\work\\proj"],
    expected: "~20 min",
    note: null,
    run: null,
    bookedAt: "2026-09-24T12:00:00.000Z"
  };
  const bookingsHtml = renderBookings([booking], []);
  ok("bookings: the row carries service and holds", bookingsHtml.includes("image-gen") && bookingsHtml.includes("4 cores") && bookingsHtml.includes("C:\\work\\proj"));
  ok("bookings: the exits are wired (data-act)", bookingsHtml.includes('data-act="pop"') && bookingsHtml.includes('data-act="clear"'));
  ok("bookings: an empty register says so plainly", renderBookings([], []).includes("nothing is booked"));
  const okHtml = renderOutcome({ ok: true, booking });
  ok("outcome: a landed book shows its id", okHtml.includes("outcome ok") && okHtml.includes("bk-abc"));
  const refuseHtml = renderOutcome({
    ok: false,
    error: { code: "double_booked", message: "gpu is booked by image-gen", blockers: [{ kind: "gpu", detail: "x", heldBy: { id: "bk-1", service: "image-gen", since: "2026-09-24T11:00:00.000Z" } }] }
  });
  ok("outcome: a refusal shows the code and the holder", refuseHtml.includes("refused") && refuseHtml.includes("double_booked") && refuseHtml.includes("image-gen"));
  ok("escape: markup cannot ride in", escapeHtml("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;");
  ok("fmtMb: scales to GB and TB", fmtMb(512) === "512 MB" && fmtMb(2048) === "2.0 GB" && fmtMb(1024 * 1024 * 3) === "3.0 TB");
  ok("GUI_IDS names every hook the page needs", Object.keys(GUI_IDS).length === 6 && typeof mount === "function");
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[browser/gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  GUI_IDS,
  escapeHtml,
  fmtMb,
  mount,
  renderBookings,
  renderOutcome,
  renderResources,
  runTests
};
//# sourceMappingURL=gui.js.map
