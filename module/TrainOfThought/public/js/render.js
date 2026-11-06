import { nodeDir } from "./artifacts.js";
import { claimLive, depsSettled, layers } from "./dag.js";
const CSS = `
  :root{
    --bg:#0a0d12; --bg2:#0f141b; --panel:#0d1219; --line:#1c242e; --rule:#151d26;
    --text:#e4e9f0; --prose:#c2cbd8; --dim:#7b8794; --faint:#4d5866;
    --accent:#8fb3d9; --warm:#d9a88f; --ok:#8fd9a8;
    --display:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,sans-serif;
    --sans:"Segoe UI",system-ui,-apple-system,sans-serif;
    --serif:Georgia,"Iowan Old Style","Times New Roman",serif;
    --mono:Consolas,"Cascadia Mono",ui-monospace,monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--text)}
  body{font:15px/1.65 var(--sans);padding:64px clamp(20px,5vw,72px) 110px;max-width:1180px;margin:0 auto;
       -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  a{color:inherit;text-decoration:none}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
  h1{font-family:var(--display);font-size:clamp(30px,4vw,42px);font-weight:300;letter-spacing:-.022em;
     line-height:1.12;margin:14px 0 10px;color:#f2f5f9}
  h2{font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);
     font-weight:400;margin:0 0 14px}
  .sub{font-family:var(--mono);font-size:11.5px;color:var(--dim);letter-spacing:.02em}
  .masthead{padding-bottom:26px}

  /* the drawn map */
  .map{margin:30px 0 6px;border:1px solid var(--line);background:var(--panel);padding:10px 6px 6px}
  .map svg{display:block;width:100%;height:auto}
  .map .caption{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
                color:var(--faint);padding:6px 12px 10px}

  /* the one thing to do next */
  .next{display:grid;grid-template-columns:1fr auto;align-items:end;gap:18px;margin:26px 0 30px;padding:22px 24px;
        background:var(--bg2);border:1px solid var(--line);border-left:2px solid var(--accent)}
  .next .label{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
  .next .t{display:block;font-family:var(--display);font-size:21px;font-weight:350;letter-spacing:-.012em;color:#fff;margin:6px 0 3px}
  .next .action{font-size:14px;color:var(--prose)}
  .next .why{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:8px}
  .next .go{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
  .next a:hover .t{text-decoration:underline;text-underline-offset:3px}
  .next.empty{border-left-color:var(--warm)}
  .next.empty .label{color:var(--warm)}

  /* filter */
  .controls{display:flex;gap:14px;align-items:center;margin:0 0 22px}
  input[type=search],input[type=text],textarea{width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);
    font:13px var(--sans);padding:11px 13px;border-radius:2px;outline:none;transition:border-color .15s}
  input:focus,textarea:focus{border-color:#2f4256}
  input::placeholder,textarea::placeholder{color:var(--faint)}
  .controls input{max-width:340px}

  /* the list */
  .thead,.row{display:grid;grid-template-columns:40px minmax(200px,1.2fr) minmax(200px,1.5fr) 62px 84px 96px;gap:16px;align-items:baseline}
  .thead{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);
         padding:0 0 10px;border-bottom:1px solid var(--line)}
  .row{padding:13px 0;border-bottom:1px solid var(--rule);transition:background .12s}
  .row:hover{background:#0d131a}
  .row.ready{box-shadow:inset 2px 0 0 var(--accent);padding-left:12px}
  .row .layer{font-family:var(--mono);font-size:10.5px;color:var(--faint)}
  .row .t{display:block;font-size:15px;color:var(--text);letter-spacing:-.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row.ready .t{color:#fff}
  .row:hover .t{text-decoration:underline;text-underline-offset:3px}
  .row .tags{margin-top:5px;display:flex;gap:5px;flex-wrap:wrap}
  .tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
       border:1px solid var(--rule);padding:1px 6px;border-radius:9px}
  .row .action{font-size:12.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .num{font-family:var(--mono);font-size:11px;color:var(--faint);white-space:nowrap}
  .state{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .state.active{color:var(--accent)}
  .state.blocked,.state.held{color:var(--warm)}
  .state.done{color:var(--ok)}

  /* archive */
  .archive{margin-top:64px;padding-top:26px;border-top:1px solid var(--line)}
  .archive .row{grid-template-columns:minmax(200px,1fr) 100px}
  .archive .summary{grid-column:1/-1;font-family:var(--serif);font-size:14.5px;color:var(--dim);margin-top:4px;line-height:1.5}
  .archive .row:hover .summary{color:var(--prose)}

  /* thought page */
  .back{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .back:hover{color:var(--accent)}
  .thought h1{max-width:22ch;margin:16px 0 12px;font-size:clamp(28px,3.6vw,38px)}
  .intent{font-family:var(--serif);font-size:17px;line-height:1.78;color:var(--prose);max-width:62ch;margin:22px 0 0}
  .intent.empty{font-family:var(--sans);font-size:14px;color:var(--faint)}
  .grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:52px;margin-top:46px}
  ol.steps{margin:0;padding:0;list-style:none;counter-reset:step}
  ol.steps li{counter-increment:step;padding:11px 0 11px 30px;position:relative;border-bottom:1px solid var(--rule);
              color:var(--prose);font-size:14px}
  ol.steps li::before{content:counter(step);position:absolute;left:0;top:11px;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
  ol.steps li:first-child{color:#fff}
  ol.steps li:first-child::before{color:var(--accent)}
  .chips{display:flex;gap:7px;flex-wrap:wrap}
  .chip{font-size:12px;color:var(--dim);border:1px solid var(--line);padding:3px 9px;border-radius:11px;transition:color .12s,border-color .12s}
  .chip.done{color:var(--accent);border-color:#25323f}
  .chip:hover{color:var(--text);border-color:#2f4256}
  .trail,.sessions{margin-top:52px}
  .entry{display:grid;grid-template-columns:112px 1fr;gap:18px;padding:10px 0;border-top:1px solid var(--rule);font-size:13px}
  .entry .when{font-family:var(--mono);font-size:10.5px;color:var(--faint)}
  .entry .what{color:var(--prose)}
  .entry .kind{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-right:9px}
  .entry .by{font-family:var(--mono);font-size:10.5px;color:var(--faint)}
  .card{padding:12px 0;border-top:1px solid var(--rule)}
  .card .t{font-size:14px;color:var(--text)}
  .card .g{display:block;font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-top:3px;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .card.down .t{color:var(--dim)}
  .folder .path{font-family:var(--mono);font-size:11px;color:var(--faint);margin-bottom:12px;word-break:break-all}
  .file{display:grid;grid-template-columns:1fr 84px 96px;gap:14px;padding:8px 0;border-top:1px solid var(--rule);font-size:13px}
  .file .n{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .file .n .mode{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-left:8px}
  .file .s,.file .w{font-family:var(--mono);font-size:10.5px;color:var(--faint);text-align:right}
  .file .t{grid-column:1/-1;font-family:var(--mono);font-size:10px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .acts{margin-top:40px;display:flex;gap:9px;flex-wrap:wrap;align-items:center}
  button{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);
         background:none;border:1px solid var(--line);padding:9px 14px;border-radius:2px;cursor:pointer;
         transition:color .15s,border-color .15s}
  button:hover{color:var(--text);border-color:#2f4256}
  button.primary{color:var(--accent);border-color:#25323f}
  .noteform{margin-top:16px;display:grid;gap:10px;max-width:620px}
  textarea{resize:vertical;min-height:58px}
  .empty-note{font-size:13px;color:var(--faint);padding:10px 0}
  footer{margin-top:70px;padding-top:18px;border-top:1px solid var(--rule);font-family:var(--mono);
         font-size:10.5px;letter-spacing:.06em;color:var(--faint)}
  footer a{color:var(--faint)} footer a:hover{color:var(--accent)}
  @media (max-width:780px){
    body{padding:34px 16px 70px}
    .thead{display:none}
    .row{grid-template-columns:26px 1fr;gap:8px}
    .row .num,.row .state,.row .action{grid-column:2}
    .grid2{grid-template-columns:1fr;gap:32px}
    .entry{grid-template-columns:1fr;gap:3px}
    .next{grid-template-columns:1fr}
  }
`;
const esc = (text) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
const stamp = (at) => new Date(at).toISOString().slice(0, 16).replace("T", " ");
const page = (title, body) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>${body}</body></html>`;
function dagMap(store, ready, options = {}) {
  const scope = options.nodes ?? store.nodes.filter((node) => node.state !== "done");
  if (scope.length === 0) {
    return `<div class="map"><div class="caption">the map draws itself once there is a thought</div></div>`;
  }
  const depth = layers(store.nodes);
  const cols = /* @__PURE__ */ new Map();
  for (const node of scope) {
    const level = depth.get(node.ref) ?? 0;
    cols.set(level, [...cols.get(level) ?? [], node]);
  }
  const levels = [...cols.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(...levels.map((level) => (cols.get(level) ?? []).length));
  const colW = 236;
  const rowH = 52;
  const padX = 34;
  const padY = 34;
  const width = padX * 2 + Math.max(levels.length - 1, 0) * colW + 150;
  const height = padY * 2 + Math.max(maxRows - 1, 0) * rowH + 24;
  const stops = [];
  for (const level of levels) {
    const column = (cols.get(level) ?? []).slice().sort((a, b) => a.touched - b.touched);
    const offset = (maxRows - column.length) / 2;
    column.forEach((node, index) => {
      stops.push({
        node,
        x: padX + (level - levels[0]) * colW + 8,
        y: padY + (index + offset) * rowH,
        layer: level,
        ready: ready.has(node.ref)
      });
    });
  }
  const at = new Map(stops.map((stop) => [stop.node.ref, stop]));
  const guides = levels.map((level) => {
    const x = padX + (level - levels[0]) * colW;
    return `<line x1="${x}" y1="${padY - 18}" x2="${x}" y2="${height - padY + 6}" stroke="#141c25" stroke-width="1"/>
        <text x="${x}" y="${padY - 26}" fill="#3f4a57" font-size="9" letter-spacing="1.6">L${level}</text>`;
  }).join("");
  const curves = stops.flatMap(
    (stop) => stop.node.deps.map((dep) => at.get(dep)).filter((from) => Boolean(from)).map((from) => {
      const x1 = from.x + 9;
      const y1 = from.y;
      const x2 = stop.x - 9;
      const y2 = stop.y;
      const mid = (x1 + x2) / 2;
      const lit = from.node.state === "done" || stop.ready;
      return `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none"
            stroke="${lit ? "#2c4152" : "#1c242e"}" stroke-width="1.25"/>`;
    })
  ).join("");
  const nodes = stops.map((stop) => {
    const held = claimLive(stop.node, store.now);
    const done = stop.node.state === "done";
    const blocked = stop.node.state === "blocked" || stop.node.state === "parked" || held;
    const fill = done ? "#0a0d12" : stop.ready ? "#8fb3d9" : blocked ? "#0d1219" : "#111821";
    const stroke = done ? "#2a3542" : blocked ? "#d9a88f" : stop.ready ? "#8fb3d9" : "#38506a";
    const focused = options.focus === stop.node.ref;
    const label = stop.node.title.length > 30 ? `${stop.node.title.slice(0, 29)}\u2026` : stop.node.title;
    return `<g>
        ${focused ? `<circle cx="${stop.x}" cy="${stop.y}" r="13" fill="none" stroke="#8fb3d9" stroke-opacity=".35"/>` : ""}
        <circle cx="${stop.x}" cy="${stop.y}" r="5.5" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>
        <text x="${stop.x + 15}" y="${stop.y + 4}" font-size="12.5" fill="${done ? "#4d5866" : stop.ready ? "#e9eef5" : "#9aa6b4"}">${esc(label)}</text>
      </g>`;
  }).join("");
  return `<div class="map">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="train map: ${scope.length} thoughts in ${levels.length} layers">
      <g font-family="Segoe UI, system-ui, sans-serif">${guides}${curves}${nodes}</g>
    </svg>
    <div class="caption">${scope.length} stops \xB7 ${levels.length} layers \xB7 ${ready.size} ready \u2014 left to right is the order the train runs</div>
  </div>`;
}
function nextBlock(store, ready) {
  if (ready.length === 0) {
    const active = store.nodes.filter((node) => node.state === "active").length;
    const waiting = store.nodes.filter((node) => node.state === "active" && !depsSettled(store.nodes, node).ok).length;
    const claimed = store.nodes.filter((node) => claimLive(node, store.now)).length;
    const empty = store.nodes.filter((node) => node.state === "active" && node.next.length === 0).length;
    const parked = store.nodes.filter((node) => node.state === "blocked" || node.state === "parked").length;
    const why = [
      `${active} active`,
      waiting ? `${waiting} waiting on deps` : "",
      claimed ? `${claimed} claimed` : "",
      empty ? `${empty} with no next action` : "",
      parked ? `${parked} parked or blocked` : ""
    ].filter(Boolean).join(" \xB7 ");
    return `<div class="next empty"><div>
      <div class="label">nothing ready</div>
      <div class="t">The frontier is empty</div>
      <div class="why">${esc(why || "no thoughts yet \u2014 add one")}</div></div></div>`;
  }
  const top = ready[0];
  const rest = ready.length - 1;
  return `<a class="next" href="/t/${esc(top.ref)}"><div>
      <div class="label">next</div>
      <div class="t">${esc(top.title)}</div>
      <div class="action">${esc(top.next[0] ?? "")}</div>
      <div class="why">${esc(top.ref)} \xB7 ${rest > 0 ? `${rest} more ready behind it` : "the only ready train"}</div>
    </div><div class="go">open \u2192</div></a>`;
}
function renderIndex(store, ready) {
  const readyRefs = new Set(ready.map((node) => node.ref));
  const depth = layers(store.nodes);
  const live = store.nodes.filter((node) => node.state !== "done");
  const rows = live.slice().sort((a, b) => (depth.get(a.ref) ?? 0) - (depth.get(b.ref) ?? 0) || b.touched - a.touched).map((node) => {
    const settled = depsSettled(store.nodes, node);
    const isReady = readyRefs.has(node.ref);
    const held = claimLive(node, store.now);
    const cls = held ? "held" : node.state;
    return `<a class="row${isReady ? " ready" : ""}" href="/t/${esc(node.ref)}" data-text="${esc(
      `${node.title} ${node.intent} ${node.tags.join(" ")} ${node.next.join(" ")}`.toLowerCase()
    )}">
        <span class="layer">${depth.get(node.ref) ?? 0}</span>
        <span><span class="t">${esc(node.title)}</span>${node.tags.length ? `<span class="tags">${node.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</span>` : ""}</span>
        <span class="action">${esc(node.next[0] ?? "no next action")}</span>
        <span class="num">${settled.total === 0 ? "root" : `${settled.done}/${settled.total}`}</span>
        <span class="state ${esc(cls)}">${esc(cls)}</span>
        <span class="num">${stamp(node.touched)}</span>
      </a>`;
  }).join("");
  const archived = store.nodes.filter((node) => node.state === "done").sort((a, b) => (b.closed?.at ?? 0) - (a.closed?.at ?? 0)).slice(0, 5).map(
    (node) => `<a class="row" href="/t/${esc(node.ref)}">
        <span class="t">${esc(node.title)}</span>
        <span class="num">${stamp(node.closed?.at ?? node.touched)}</span>
        <span class="summary">${esc(node.closed?.summary ?? "")}</span>
      </a>`
  ).join("");
  const archivedCount = store.nodes.filter((node) => node.state === "done").length;
  const body = `
    <div class="masthead">
      <div class="kicker">Train of Thought \xB7 long-term intentions</div>
      <h1>${live.length} ${live.length === 1 ? "train" : "trains"} running</h1>
      <div class="sub">${store.nodes.length} nodes \xB7 ${ready.length} ready \xB7 ${archivedCount} archived \xB7 built ${stamp(store.now)}</div>
      ${store.seats().length ? `<div class="sub" style="margin-top:8px">${store.seats().map((seat) => `${esc(seat.by)} on <a href="/t/${esc(seat.ref)}" style="color:var(--accent)">${esc(seat.title)}</a> until ${stamp(seat.expiresAt)}`).join(" \xB7 ")}</div>` : ""}
    </div>
    ${dagMap(store, readyRefs)}
    ${nextBlock(store, ready)}
    <div class="controls"><input type="search" id="filter" placeholder="filter trains\u2026" autocomplete="off" spellcheck="false"></div>
    <div class="thead"><span>layer</span><span>thought</span><span>next action</span><span>deps</span><span>state</span><span>touched</span></div>
    <div id="rows">${rows || '<div class="empty-note">No trains yet \u2014 POST /api/thoughts to start one.</div>'}</div>
    ${archived ? `<div class="archive"><h2>Archived \u2014 done, and why</h2>${archived}
            <div class="sub" style="margin-top:14px"><a href="/archive" style="color:var(--dim)">all ${archivedCount} archived \u2192</a></div></div>` : ""}
    <footer><a href="/api/next">/api/next</a> \xB7 <a href="/api/thoughts">/api/thoughts</a> \xB7 <a href="/api/archive">/api/archive</a></footer>
    <script>
      (function () {
        var box = document.getElementById('filter');
        if (!box) return;
        box.addEventListener('input', function () {
          var q = box.value.trim().toLowerCase();
          var rows = document.querySelectorAll('#rows .row');
          for (var i = 0; i < rows.length; i++) {
            var hit = !q || (rows[i].getAttribute('data-text') || '').indexOf(q) >= 0;
            rows[i].style.display = hit ? '' : 'none';
          }
        });
      })();
    </script>`;
  return page("Train Of Thought", body);
}
function renderThought(store, node, cards, files = []) {
  const settled = depsSettled(store.nodes, node);
  const held = claimLive(node, store.now);
  const depth = layers(store.nodes).get(node.ref) ?? 0;
  const folder = nodeDir(store, node);
  const fileRows = files.length ? files.map(
    (file) => `<div class="file">
            <span class="n">${esc(file.name)}<span class="mode">${file.kind}</span></span>
            <span class="s">${file.bytes === null ? "\u2014" : `${Math.max(1, Math.round(file.bytes / 1024))} KB`}</span>
            <span class="w">${stamp(file.mtime)}</span>
            ${file.target ? `<span class="t">\u2192 ${esc(file.target)}</span>` : ""}
          </div>`
  ).join("") : `<div class="empty-note">Empty. Anything this train makes belongs here \u2014 drop files in the folder, or attach a path so it is linked rather than copied.</div>`;
  const neighbours = /* @__PURE__ */ new Set([node.ref, ...node.deps]);
  for (const other of store.nodes) if (other.deps.includes(node.ref)) neighbours.add(other.ref);
  const readyRefs = new Set(store.ready().map((ready) => ready.ref));
  const localNodes = store.nodes.filter((other) => neighbours.has(other.ref));
  const steps = node.next.length ? `<ol class="steps">${node.next.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>` : '<div class="empty-note">No next action recorded \u2014 a successor session would start cold.</div>';
  const deps = node.deps.length ? `<div class="chips">${node.deps.map((ref) => {
    const target = store.find(ref);
    return `<a class="chip${target?.state === "done" ? " done" : ""}" href="/t/${esc(ref)}">${esc(target?.title ?? ref)}</a>`;
  }).join("")}</div>` : '<div class="empty-note">Root of its train \u2014 nothing to wait for.</div>';
  const trail = node.trail.slice().reverse().map(
    (entry) => `<div class="entry"><div class="when">${stamp(entry.at)}</div>
        <div class="what"><span class="kind">${esc(entry.kind)}</span>${esc(entry.text)} <span class="by">\xB7 ${esc(entry.by)}</span></div></div>`
  ).join("");
  const sessionCards = cards.length ? cards.map(
    (card) => card.ok ? `<div class="card"><span class="t">${esc(card.title ?? card.ref)}</span>
                 <span class="g">${esc(card.ref)} \xB7 ${card.messages ?? "?"} messages \xB7 ${esc(card.model ?? "")}</span>
                 <span class="g">${esc(card.goal ?? "")}</span></div>` : `<div class="card down"><span class="t">${esc(card.ref)}</span><span class="g">${esc(card.reason ?? "session unavailable")}</span></div>`
  ).join("") : '<div class="empty-note">No sessions attached yet.</div>';
  const actions = `
    <div class="acts">
      ${held ? `<button data-act="release" data-ref="${esc(node.ref)}">log out ${esc(node.claimed?.by ?? "")}</button>` : `<button class="primary" data-act="claim" data-ref="${esc(node.ref)}">log in \xB7 take seat</button>`}
      <button data-act="state" data-ref="${esc(node.ref)}" data-state="parked">park</button>
      <button data-act="state" data-ref="${esc(node.ref)}" data-state="blocked">block</button>
      <button data-act="close" data-ref="${esc(node.ref)}">close\u2026</button>
    </div>
    <div class="noteform">
      <textarea id="note" rows="2" placeholder="add a line to the trail\u2026"></textarea>
      <div><button data-act="note" data-ref="${esc(node.ref)}">add note</button></div>
    </div>`;
  const closed = node.state === "done" && node.closed ? `<div class="next" style="margin-top:34px"><div class="label">closed</div>
        <div class="t" style="font-family:var(--serif);font-weight:400">${esc(node.closed.summary)}</div>
        <div class="why">${stamp(node.closed.at)}</div></div>` : "";
  const body = `
    <div class="thought">
      <a class="back" href="/">\u2190 trains</a>
      <h1>${esc(node.title)}</h1>
      <div class="sub">${esc(node.ref)} \xB7 ${esc(node.state)}${held ? ` \xB7 held by ${esc(node.claimed?.by ?? "")}` : ""} \xB7 layer ${depth} \xB7 ${settled.total === 0 ? "root" : `${settled.done}/${settled.total} deps`} \xB7 touched ${stamp(node.touched)}</div>
      ${node.intent.trim() ? `<p class="intent">${esc(node.intent)}</p>` : '<p class="intent empty">No intent recorded \u2014 this node says what to do but not why.</p>'}
      ${closed}
      ${dagMap(store, readyRefs, { focus: node.ref, nodes: localNodes })}
      <div class="grid2">
        <div><h2>Next</h2>${steps}</div>
        <div><h2>Waits for</h2>${deps}</div>
      </div>
      ${actions}
      <div class="trail"><h2>Trail</h2>${trail || '<div class="empty-note">Nothing yet.</div>'}</div>
      <div class="folder" style="margin-top:52px"><h2>Folder \u2014 what this train made</h2>
        <div class="path">${esc(folder)}</div>
        ${fileRows}
        <div class="noteform" style="margin-top:16px">
          <input type="text" id="attach" placeholder="C:\\path\\to\\file-or-folder  (linked, not copied)">
          <div><button data-act="attach" data-ref="${esc(node.ref)}">attach path</button></div>
        </div>
      </div>
      <div class="sessions"><h2>Sessions</h2>${sessionCards}</div>
      <footer>${esc(node.ref)} \xB7 evidence lives in the session diary on :8134 \xB7 this page never writes to it</footer>
    </div>
    <script>
      function act(name, ref, extra) {
        fetch('/api/thoughts/' + ref + '/' + name, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ by: 'user' }, extra || {})),
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) { alert(j.error.code + ': ' + j.error.message); return; }
          location.reload();
        }).catch(function (e) { alert('request failed: ' + e.message); });
      }
      document.addEventListener('click', function (event) {
        var el = event.target.closest('button[data-act]');
        if (!el) return;
        var ref = el.getAttribute('data-ref'), what = el.getAttribute('data-act');
        if (what === 'note') {
          var box = document.getElementById('note');
          var text = ((box && box.value) || '').trim();
          if (!text) { alert('write something first'); return; }
          act('trail', ref, { kind: 'note', text: text });
        } else if (what === 'attach') {
          var field = document.getElementById('attach');
          var path = ((field && field.value) || '').trim();
          if (!path) { alert('give an absolute path first'); return; }
          act('attach', ref, { path: path });
        } else if (what === 'close') {
          var summary = prompt('Why is this train done? One line \u2014 it becomes the archive entry.');
          if (!summary) return;
          act('close', ref, { summary: summary });
        } else if (what === 'state') {
          act('state', ref, { state: el.getAttribute('data-state') });
        } else {
          act(what, ref, {});
        }
      });
    </script>`;
  return page(`${node.title} \xB7 Train Of Thought`, body);
}
function renderArchive(store) {
  const done = store.nodes.filter((node) => node.state === "done").sort((a, b) => (b.closed?.at ?? 0) - (a.closed?.at ?? 0));
  const rows = done.map(
    (node) => `<a class="row" href="/t/${esc(node.ref)}">
        <span class="t">${esc(node.title)}</span>
        <span class="num">${stamp(node.closed?.at ?? node.touched)}</span>
        <span class="summary">${esc(node.closed?.summary ?? "")}</span>
      </a>`
  ).join("");
  const body = `
    <a class="back" href="/">\u2190 trains</a>
    <div class="masthead" style="margin-top:22px">
      <div class="kicker">Archived</div>
      <h1>Done, and why</h1>
      <div class="sub">${done.length} closed ${done.length === 1 ? "train" : "trains"} \xB7 each line is the sentence that closed it</div>
    </div>
    ${rows || '<div class="empty-note">Nothing archived yet.</div>'}`;
  return page("Archived \xB7 Train Of Thought", body);
}
export {
  CSS,
  renderArchive,
  renderIndex,
  renderThought
};
//# sourceMappingURL=render.js.map
