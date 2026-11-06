const COLUMNS = ["module", "kind", "port", "is", "wired@boot", "what it is"];
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderRow(r) {
  const missing = r.should.missing.length ? ` <span class="miss">missing: ${escapeHtml(r.should.missing.join(" \xB7 "))}</span>` : "";
  return `<tr class="live-${escapeHtml(r.is)}"><td class="nm">${escapeHtml(r.name)}</td><td>${escapeHtml(r.kind)}</td><td class="num">${r.should.port ?? "\u2014"}</td><td class="st st-${escapeHtml(r.is)}">${escapeHtml(r.is)}</td><td>${r.should.wiredAtBoot ? "yes" : "\u2014"}</td><td>${escapeHtml(r.should.what || "(says nothing about itself)")}${missing}</td></tr>`;
}
function renderShelf(data, doc) {
  const rows = doc.getElementById("rows");
  if (!rows) return;
  const head = `<tr>${COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = data.modules.map(renderRow).join("");
  const offered = (data.offered ?? []).length ? `<tr class="offered-head"><td colspan="${COLUMNS.length}">OFFERED \u2014 the catalog. Present \u2260 running: it starts when it is run.</td></tr>` + data.offered.map((o) => `<tr class="live-offered"><td class="nm">${escapeHtml(o.name)}</td><td>service</td><td class="num">\u2014</td><td class="st st-offered">offered</td><td>\u2014</td><td>${escapeHtml(o.what)} <span class="dim">via ${escapeHtml(o.provider)}</span></td></tr>`).join("") : "";
  rows.innerHTML = `<table>${head}${body}${offered}</table>`;
}
async function resolveByName(name, baseUrl) {
  const res = await fetch(`${baseUrl}/api/resolve/${encodeURIComponent(name)}`);
  const body = await res.json();
  if (body.found === true) {
    return `${String(body.name)} \u2014 ${String(body.liveness)}${body.port ? ` on ${String(body.port)}` : ""}
${String(body.reason)}`;
  }
  const alts = Array.isArray(body.alternatives) ? body.alternatives.join(", ") : "";
  return `no such thing: ${name}
what IS here: ${alts}`;
}
function mount(doc = document) {
  const rows = doc.getElementById("rows");
  const lookup = doc.getElementById("lookup");
  const go = doc.getElementById("go");
  const answer = doc.getElementById("answer");
  const baseUrl = doc.body?.getAttribute("data-base") ?? "";
  if (!rows) throw new Error("gui: #rows is missing from the page");
  let timer;
  const load = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/shelf`);
      renderShelf(await res.json(), doc);
    } catch (e) {
      rows.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="miss">cannot read the shelf: ${escapeHtml(e instanceof Error ? e.message : String(e))}</td></tr>`;
    }
  };
  const ask = async () => {
    const name = lookup?.value.trim() ?? "";
    if (!name || !answer) return;
    answer.textContent = "asking\u2026";
    try {
      answer.textContent = await resolveByName(name, baseUrl);
    } catch (e) {
      answer.textContent = `the door did not answer: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  go?.addEventListener("click", () => {
    void ask();
  });
  lookup?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") void ask();
  });
  void load();
  timer = setInterval(() => {
    void load();
  }, 3e3);
  const stop = () => {
    if (timer !== void 0) clearInterval(timer);
  };
  doc.__joinStop = stop;
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => mount(document));
  else mount(document);
}
function runTests() {
  const mk = (id, tag = "div") => {
    const state = { innerHTML: "", textContent: "", value: "" };
    return {
      id,
      tagName: tag.toUpperCase(),
      get innerHTML() {
        return state.innerHTML;
      },
      set innerHTML(v) {
        state.innerHTML = v;
      },
      get textContent() {
        return state.textContent;
      },
      set textContent(v) {
        state.textContent = v;
      },
      value: "",
      setAttribute() {
      },
      getAttribute() {
        return "";
      },
      addEventListener() {
      },
      classList: { add() {
      }, remove() {
      } }
    };
  };
  const ids = ["lookup", "go", "answer"];
  const rowsEl = mk("rows");
  const stub = {
    getElementById: (id) => id === "rows" ? rowsEl : ids.includes(id) ? mk(id) : null,
    body: { getAttribute: () => "" },
    defaultView: null
  };
  const data = {
    modules: [
      { name: "State", kind: "door", should: { port: 8127, wiredAtBoot: false, what: "the retainer", missing: [] }, is: "up", detail: "" },
      { name: "Basic_App", kind: "door", should: { port: 8130, wiredAtBoot: false, what: "the instance", missing: ["start"] }, is: "down", detail: "" },
      { name: "Electron_Wrapper", kind: "shell", should: { port: null, wiredAtBoot: true, what: "the one window", missing: [] }, is: "down", detail: "" }
    ],
    offered: [{ name: "chat", provider: "llama.cpp", what: "one chat" }]
  };
  const rows = stub.getElementById("rows");
  renderShelf(data, stub);
  const html = rows.innerHTML;
  console.assert(html.includes("State") && html.includes("8127"), "the table renders a row with its port", html.slice(0, 80));
  console.assert(html.includes("st-up") && html.includes("st-down"), "liveness is a visible class", "");
  console.assert(html.includes("OFFERED"), "the offered population is labelled", "");
  console.assert(html.includes("missing: start"), "an undeclared fact is shown as missing", "");
  console.assert(html.includes("the retainer"), "the human sentence is rendered", "");
  console.assert(escapeHtml('<b>&"x"') === "&lt;b&gt;&amp;&quot;x&quot;", "escape covers all five", escapeHtml('<b>&"x"'));
  void resolveByName;
}
export {
  escapeHtml,
  mount,
  renderShelf,
  resolveByName,
  runTests
};
//# sourceMappingURL=gui.js.map
