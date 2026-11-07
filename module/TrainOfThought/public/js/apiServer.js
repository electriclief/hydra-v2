import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ThoughtError } from "./store.js";
import { depsSettled, frontier, isReady, layers, whyStuck } from "./dag.js";
import { markdown as frontierMarkdown, snapshot as frontierSnapshot } from "./frontier.js";
import { handoffPacket, recordTick } from "./cycle.js";
import { SessionClient } from "./sessionClient.js";
import { attachArtifact, listArtifacts, nodeDir } from "./artifacts.js";
import { renderArchive, renderIndex, renderThought } from "./render.js";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600"
};
function send(res, status, body2) {
  const text = JSON.stringify(body2, null, 2);
  res.writeHead(status, { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
function html(res, status, body2) {
  res.writeHead(status, { ...CORS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body2);
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ThoughtError("bad_json", "request body must be a JSON object");
  }
}
const str = (value, fallback = "") => typeof value === "string" ? value : fallback;
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
function present(store, node) {
  const settled = depsSettled(store.nodes, node);
  return {
    ...node,
    folder: nodeDir(store, node),
    ready: isReady(store.nodes, node, store.now),
    depsDone: settled.done,
    depsTotal: settled.total,
    layer: layers(store.nodes).get(node.ref) ?? 0,
    sessions: uniqueSessions(node)
  };
}
function uniqueSessions(node) {
  const out = [];
  for (const entry of node.trail) if (entry.sessionRef && !out.includes(entry.sessionRef)) out.push(entry.sessionRef);
  for (const ref of node.closed?.sessionRefs ?? []) if (!out.includes(ref)) out.push(ref);
  return out;
}
const SHELF = process.env.TOT_SHELF ? path.resolve(process.env.TOT_SHELF) : path.resolve(process.cwd(), "..", "..");
const OUTPUT_ROOTS = [
  { rel: "docs", label: "docs - pages, module map, cast pages" },
  { rel: "docs/voice-samples", label: "voice samples" },
  { rel: "media/ep01", label: "episode 01" },
  { rel: "module/SessionDiary/data/files", label: "diary files (per session)" },
  { rel: "module/TrainOfThought/data/thoughts", label: "thought nodes on disk" }
];
function scanOutputs(shelf = SHELF) {
  const walk = (dir) => {
    let files = 0;
    let bytes = 0;
    let latest = 0;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { files, bytes, latest };
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = walk(abs);
        files += sub.files;
        bytes += sub.bytes;
        latest = Math.max(latest, sub.latest);
      } else if (entry.isFile()) {
        try {
          const st = fs.statSync(abs);
          files += 1;
          bytes += st.size;
          latest = Math.max(latest, st.mtimeMs);
        } catch {
        }
      }
    }
    return { files, bytes, latest };
  };
  return OUTPUT_ROOTS.map(({ rel, label }) => {
    const abs = path.join(shelf, rel);
    const exists = fs.existsSync(abs);
    const counted = exists ? walk(abs) : { files: 0, bytes: 0, latest: 0 };
    return {
      label,
      rel,
      path: abs,
      exists,
      files: counted.files,
      bytes: counted.bytes,
      latestAt: counted.latest ? new Date(counted.latest).toISOString() : null
    };
  });
}
function treePage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Tree \u2014 what exists, what is planned, what waits</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#151922; --line:#232936; --text:#e6e8ee; --dim:#8b93a5; --accent:#7dd3fc; }
  body { margin:0; padding:28px; background:var(--bg); color:var(--text); font:14px/1.6 system-ui, sans-serif; }
  h1 { font-size:13px; letter-spacing:.16em; text-transform:uppercase; color:var(--dim); margin:0 0 20px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:14px; }
  h2 { font-size:15px; margin:0 0 10px; display:flex; gap:10px; align-items:baseline; }
  h2 .n { color:var(--dim); font-size:12px; font-weight:400; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; gap:10px; align-items:baseline; padding:5px 0; border-top:1px solid rgba(255,255,255,.04); }
  li:first-child { border-top:none; }
  .name { flex:1; }
  .meta { color:var(--dim); font-size:12px; white-space:nowrap; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  button { background:#1d2431; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:2px 9px; font:12px system-ui; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  .empty { color:var(--dim); font-size:13px; }
  .ref { color:var(--dim); font-family:ui-monospace, monospace; font-size:11px; }
</style></head><body>
<h1>Train of Thought \u2014 the tree <a href="/trains" style="float:right;font-size:11px;letter-spacing:.06em">trains index \u2192</a></h1>
<div id="root" class="empty">loading\u2026</div>
<script>
function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function hb(n){ if(!n) return '0 B'; var u=['B','KB','MB','GB'],i=0; while(n>=1024&&i<u.length-1){n/=1024;i++;} return (i?n.toFixed(1):n)+' '+u[i]; }
function ago(iso){ if(!iso) return 'never'; var s=Math.round((Date.now()-Date.parse(iso))/1000); if(!isFinite(s)) return 'never'; if(s<90) return s+'s ago'; if(s<5400) return Math.round(s/60)+'m ago'; if(s<172800) return Math.round(s/3600)+'h ago'; return Math.round(s/86400)+'d ago'; }
function openPath(p){
  fetch('/api/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:p})})
    .then(function(r){return r.json();})
    .then(function(d){ if(!d.ok) alert(d.error||'refused'); })
    .catch(function(e){ alert('open failed: '+e); });
}
function render(t){
  var out = '<section><h2>Service outputs <span class="n">what this shelf has actually produced</span></h2><ul>';
  out += (t.outputs||[]).map(function(o){
    return '<li><span class="name">'+esc(o.label)+' <span class="ref">'+esc(o.rel)+'</span></span>'
      + '<span class="meta">'+(o.exists? o.files+' files \xB7 '+hb(o.bytes)+' \xB7 '+ago(o.latestAt) : 'not present')+'</span>'
      + (o.exists? '<button data-open="' + esc(o.rel) + '">open folder</button>' : '')
      + '</li>';
  }).join('') || '<li class="empty">nothing scanned</li>';
  out += '</ul></section>';

  out += '<section><h2>Hydra V2 design <span class="n">state, progress, open questions</span></h2><ul>';
  out += (t.design||[]).map(function(d){
    var lines = (d.next||[]).map(function(x){ return '<li><span class="name" style="padding-left:14px;color:var(--dim)">'+esc(x)+'</span></li>'; }).join('');
    return '<li><span class="name"><a href="/node/'+esc(d.ref)+'">'+esc(d.title)+'</a> <span class="ref">'+esc(d.ref)+' \xB7 '+esc(d.state)+'</span></span></li>'+lines;
  }).join('') || '<li class="empty">no design train yet \u2014 tag a node with "design"</li>';
  out += '</ul></section>';

  out += '<section><h2>Wanted, not built yet <span class="n">'+((t.wanted||[]).length)+' of '+((t.wantedTotal||(t.wanted||[]).length))+' asks, newest train first</span></h2><ul>';
  out += (t.wanted||[]).map(function(w){
    return '<li><span class="name">'+esc(w.line)+'</span><span class="meta"><a href="/node/'+esc(w.ref)+'">'+esc(w.title)+'</a></span></li>';
  }).join('') || '<li class="empty">nothing waiting \u2014 every ask has a node</li>';
  out += '</ul></section>';
  document.getElementById('root').innerHTML = out;
  document.getElementById('root').className = '';
  // one delegated listener instead of inline handlers: the inline form needs quote escaping inside a template
  // literal, and the first attempt shipped a broken page because of exactly that.
  var root = document.getElementById('root');
  root.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () { openPath(b.getAttribute('data-open')); });
  });
}
fetch('/api/tree',{cache:'no-store'}).then(function(r){return r.json();}).then(render)
  .catch(function(e){ document.getElementById('root').textContent = 'tree unavailable: '+e; });
</script></body></html>`;
}
function createServer(options) {
  const { store } = options;
  const sessions = new SessionClient({ base: options.sessionBase });
  return http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathName = url.pathname.replace(/\/+$/, "") || "/";
      if (method === "OPTIONS") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      try {
        if (pathName === "/health") {
          send(res, 200, {
            ok: true,
            door: "TrainOfThought",
            store: store.file,
            nodes: store.nodes.length,
            active: store.nodes.filter((node) => node.state === "active").length,
            ready: store.ready().length,
            archived: store.nodes.filter((node) => node.state === "done").length,
            sessions: { door: sessions.base, up: await sessions.probe() },
            at: store.now
          });
          return;
        }
        if (pathName === "/api/outputs" && method === "GET") {
          send(res, 200, { ok: true, shelf: SHELF, rows: scanOutputs() });
          return;
        }
        if (pathName === "/api/tree" && method === "GET") {
          const nodes = store.nodes.filter((n) => n.state !== "done").sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? "") - Date.parse(a.updatedAt ?? a.createdAt ?? ""));
          const seen = /* @__PURE__ */ new Set();
          const wanted = [];
          for (const n of nodes) {
            for (const line of n.next ?? []) {
              const key = line.trim().toLowerCase();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              wanted.push({ ref: n.ref, title: n.title, line, since: n.updatedAt ?? n.createdAt ?? null });
            }
          }
          const design = nodes.filter((n) => (n.tags ?? []).includes("design") || /design/i.test(n.title));
          send(res, 200, {
            ok: true,
            at: (/* @__PURE__ */ new Date()).toISOString(),
            outputs: scanOutputs(),
            design: design.map((n) => ({ ref: n.ref, title: n.title, state: n.state, next: n.next ?? [] })),
            wanted: wanted.slice(0, 60),
            wantedTotal: wanted.length,
            counts: { outputs: OUTPUT_ROOTS.length, design: design.length, wanted: wanted.length, active: nodes.length }
          });
          return;
        }
        if (pathName === "/api/open" && method === "POST") {
          const input = await body(req);
          const asked = typeof input.path === "string" ? input.path.trim() : "";
          const abs = path.resolve(SHELF, asked);
          const inside = abs === SHELF || abs.startsWith(SHELF + path.sep);
          if (!asked || !inside || !fs.existsSync(abs)) {
            send(res, 400, { ok: false, error: "refused: path must exist inside the shelf", shelf: SHELF, asked });
            return;
          }
          try {
            const child = spawn("explorer.exe", [abs], { detached: true, stdio: "ignore", windowsHide: true });
            child.unref();
            send(res, 200, { ok: true, opened: abs });
          } catch (err) {
            send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (pathName === "/tree" && method === "GET") {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(treePage());
          return;
        }
        if (pathName === "/api/seats" && method === "GET") {
          store.reload();
          const expired = store.reapExpired();
          send(res, 200, { ok: true, seats: store.seats(), expired });
          return;
        }
        if (pathName === "/api/login" && method === "POST") {
          store.reload();
          store.reapExpired();
          const payload = await body(req);
          const by = str(payload.by, "agent");
          const minutes = num(payload.minutes) ?? 240;
          const sessionRef = str(payload.sessionRef) || void 0;
          const fresh = payload.new;
          let node;
          if (fresh && typeof fresh === "object") {
            node = store.add(
              {
                title: str(fresh.title),
                intent: str(fresh.intent),
                next: Array.isArray(fresh.next) ? fresh.next : [],
                tags: Array.isArray(fresh.tags) ? fresh.tags : []
              },
              by
            );
          } else {
            const want = str(payload.thought) || str(payload.ref);
            if (!want) throw new ThoughtError("bad_login", "login needs { thought } (ref or part of a title) or { new: { title, intent } }");
            const found = store.resolve(want);
            if (!found) throw new ThoughtError("no_such_node", `no train matches "${want}" \u2014 pass { new: { title, intent } } to start one`);
            if (found.state === "done") throw new ThoughtError("archived", `${found.ref} is closed \u2014 reopen it before logging in`);
            node = found;
          }
          const live = node.claimed && node.claimed.expiresAt > store.now;
          if (!live) store.claim(node.ref, by, minutes);
          else if (node.claimed?.by !== by) {
            throw new ThoughtError("claimed", `${node.ref} is held by ${node.claimed?.by} until ${new Date(node.claimed?.expiresAt ?? 0).toISOString()}`);
          }
          store.trail(node.ref, {
            kind: "session",
            text: fresh ? "logged in \u2014 new train" : "logged in \u2014 resuming",
            by,
            ...sessionRef ? { sessionRef } : {}
          });
          const files = listArtifacts(store, node);
          send(res, 200, {
            ok: true,
            ref: node.ref,
            node: present(store, node),
            folder: nodeDir(store, node),
            files,
            packet: sessionRef ? handoffPacket(store, sessionRef) : null,
            frontier: store.ready().map((ready) => ({ ref: ready.ref, title: ready.title, action: ready.next[0] ?? null })),
            seats: store.seats()
          });
          return;
        }
        if (pathName === "/api/logout" && method === "POST") {
          store.reload();
          const payload = await body(req);
          const by = str(payload.by, "agent");
          const sessionRef = str(payload.sessionRef) || void 0;
          const want = str(payload.ref) || str(payload.thought);
          const node = want ? store.resolve(want) : store.nodes.find((candidate) => candidate.claimed?.by === by);
          if (!node) throw new ThoughtError("no_seat", `no train is held by ${by} \u2014 say which one with { ref }`);
          const note = str(payload.note).trim();
          store.trail(node.ref, {
            kind: note ? "note" : "state",
            text: note ? `logged out \xB7 ${note}` : "logged out",
            by,
            ...sessionRef ? { sessionRef } : {}
          });
          if (Array.isArray(payload.next)) store.update(node.ref, { next: payload.next }, by);
          if (payload.state === "parked" || payload.state === "blocked") store.setState(node.ref, payload.state, by);
          store.release(node.ref, by, true);
          send(res, 200, { ok: true, ref: node.ref, node: present(store, store.require(node.ref)), seats: store.seats() });
          return;
        }
        if (pathName === "/api/thoughts" && method === "GET") {
          const state = url.searchParams.get("state");
          const q = (url.searchParams.get("q") ?? "").toLowerCase();
          const tag = url.searchParams.get("tag");
          const rows = store.nodes.filter((node) => {
            if (state === "all") return true;
            if (state) return node.state === state;
            return node.state !== "done";
          }).filter((node) => tag ? node.tags.includes(tag) : true).filter((node) => q ? `${node.title} ${node.intent} ${node.next.join(" ")}`.toLowerCase().includes(q) : true).sort((a, b) => b.touched - a.touched).map((node) => present(store, node));
          send(res, 200, { ok: true, count: rows.length, rows });
          return;
        }
        if (pathName === "/api/brief" && method === "GET") {
          const wanted = (url.searchParams.get("states") ?? "blocked,active,open").split(",").map((s) => s.trim()).filter(Boolean);
          const order = ["blocked", "active", "open", "done"];
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 60) || 60));
          const rows = store.nodes.filter((node) => wanted.includes(node.state)).sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.touched - a.touched).slice(0, limit);
          const bullets = rows.map((node) => ({ ref: node.ref, state: node.state, title: node.title }));
          const text = bullets.map((b) => `${b.ref}  ${b.state.padEnd(7)}  ${b.title}`).join("\n");
          send(res, 200, { ok: true, count: bullets.length, chars: text.length, bullets, text });
          return;
        }
        if (pathName === "/api/next" && method === "GET") {
          const ready = store.ready();
          if (ready.length === 0) {
            send(res, 200, { ok: true, next: null, why: whyStuck(store.nodes, store.now) });
            return;
          }
          send(res, 200, { ok: true, next: present(store, ready[0]), alsoReady: ready.slice(1).map((node) => node.ref) });
          return;
        }
        if (pathName === "/api/frontier" || pathName === "/api/frontier.md" || pathName === "/api/frontier.json") {
          const snap = frontierSnapshot(store.nodes);
          if (pathName === "/api/frontier" || pathName === "/api/frontier.md") {
            res.writeHead(200, { ...CORS, "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
            res.end(frontierMarkdown(snap));
          } else {
            send(res, 200, { ok: true, frontier: snap });
          }
          return;
        }
        if (pathName === "/api/archive" && method === "GET") {
          const rows = store.nodes.filter((node) => node.state === "done").sort((a, b) => (b.closed?.at ?? 0) - (a.closed?.at ?? 0)).map((node) => present(store, node));
          send(res, 200, { ok: true, count: rows.length, rows });
          return;
        }
        if (pathName.startsWith("/api/handoff/") && method === "GET") {
          const packet = handoffPacket(store, pathName.slice("/api/handoff/".length));
          const refs = [];
          for (const entry of packet.trail) if (entry.sessionRef && !refs.includes(entry.sessionRef)) refs.push(entry.sessionRef);
          for (const row of packet.frontier) for (const ref of row.sessions) if (!refs.includes(ref)) refs.push(ref);
          const cards = url.searchParams.get("sessions") === "0" ? [] : await sessions.cards(refs);
          send(res, 200, { ok: true, packet, sessions: cards });
          return;
        }
        if (pathName === "/api/cycle/tick" && method === "POST") {
          const payload = await body(req);
          const cycle = num(payload.cycle) ?? 0;
          const sessions2 = Array.isArray(payload.sessions) ? payload.sessions : [];
          if (cycle <= 0) throw new ThoughtError("bad_cycle", "cycle must be a positive number");
          store.reload();
          send(res, 200, { ok: true, result: recordTick(store, { cycle, sessions: sessions2, by: str(payload.by, "cycle") }) });
          return;
        }
        if (pathName === "/api/thoughts" && method === "POST") {
          store.reload();
          const payload = await body(req);
          const node = store.add(
            {
              title: str(payload.title),
              intent: str(payload.intent),
              deps: Array.isArray(payload.deps) ? payload.deps : [],
              next: Array.isArray(payload.next) ? payload.next : [],
              tags: Array.isArray(payload.tags) ? payload.tags : []
            },
            str(payload.by, "agent")
          );
          send(res, 201, { ok: true, node: present(store, node) });
          return;
        }
        const thoughtRoute = /^\/api\/thoughts\/([^/]+)(?:\/([a-z]+))?$/.exec(pathName);
        if (thoughtRoute) {
          const ref = thoughtRoute[1];
          const action = thoughtRoute[2];
          if (!action && method === "GET") {
            const node = store.find(ref);
            if (!node) throw new ThoughtError("no_such_node", `no thought with ref ${ref}`);
            const refs = uniqueSessions(node);
            const cards = url.searchParams.get("sessions") === "0" ? [] : await sessions.cards(refs);
            send(res, 200, { ok: true, node: present(store, node), sessions: cards });
            return;
          }
          store.reload();
          const payload = method === "GET" ? {} : await body(req);
          const by = str(payload.by, "agent");
          if (!action && method === "PATCH") {
            const node = store.update(
              ref,
              {
                ...typeof payload.title === "string" ? { title: payload.title } : {},
                ...typeof payload.intent === "string" ? { intent: payload.intent } : {},
                ...Array.isArray(payload.next) ? { next: payload.next } : {},
                ...Array.isArray(payload.tags) ? { tags: payload.tags } : {}
              },
              by
            );
            send(res, 200, { ok: true, node: present(store, node) });
            return;
          }
          if (action === "link" && method === "POST") {
            send(res, 200, { ok: true, node: present(store, store.link(ref, str(payload.dep), by)) });
            return;
          }
          if (action === "unlink" && method === "POST") {
            send(res, 200, { ok: true, node: present(store, store.unlink(ref, str(payload.dep), by)) });
            return;
          }
          if (action === "trail" && method === "POST") {
            const node = store.trail(ref, {
              kind: str(payload.kind, "note"),
              text: str(payload.text),
              by,
              ...typeof payload.sessionRef === "string" ? { sessionRef: payload.sessionRef } : {}
            });
            send(res, 200, { ok: true, node: present(store, node) });
            return;
          }
          if (action === "state" && method === "POST") {
            const node = store.setState(ref, str(payload.state, "active"), by, str(payload.text) || void 0);
            send(res, 200, { ok: true, node: present(store, node) });
            return;
          }
          if (action === "close" && method === "POST") {
            const node = store.close(
              ref,
              { summary: str(payload.summary), sessionRefs: Array.isArray(payload.sessionRefs) ? payload.sessionRefs : [] },
              by
            );
            send(res, 200, { ok: true, node: present(store, node) });
            return;
          }
          if (action === "reopen" && method === "POST") {
            send(res, 200, { ok: true, node: present(store, store.reopen(ref, by, str(payload.text) || void 0)) });
            return;
          }
          if (action === "claim" && method === "POST") {
            send(res, 200, { ok: true, node: present(store, store.claim(ref, str(payload.by, "agent"), num(payload.minutes) ?? 30)) });
            return;
          }
          if (action === "release" && method === "POST") {
            send(res, 200, { ok: true, node: present(store, store.release(ref, by, payload.force === true)) });
            return;
          }
          if (action === "files" && method === "GET") {
            const node = store.require(ref);
            send(res, 200, { ok: true, folder: nodeDir(store, node), files: listArtifacts(store, node) });
            return;
          }
          if (action === "attach" && method === "POST") {
            const node = store.require(ref);
            const source = str(payload.path);
            if (!source) throw new ThoughtError("bad_path", "attach needs { path } \u2014 the file or folder to point at");
            let attached;
            try {
              attached = attachArtifact(store, node, source, str(payload.name) || void 0);
            } catch (error) {
              const message = error.message;
              if (/ENOENT/.test(message)) throw new ThoughtError("no_such_file", `nothing at ${source}`);
              if (/already attached/.test(message)) throw new ThoughtError("already_attached", message);
              throw new ThoughtError("attach_failed", message);
            }
            store.trail(ref, {
              kind: "note",
              text: `attached ${attached.name} (${attached.mode}) \u2192 ${attached.target}`,
              by
            });
            send(res, 200, { ok: true, attached, files: listArtifacts(store, store.require(ref)) });
            return;
          }
          throw new ThoughtError("no_route", `${method} ${pathName} is not a route on this door`);
        }
        if ((pathName === "/" || pathName === "/tree") && method === "GET") {
          html(res, 200, treePage());
          return;
        }
        if (pathName === "/trains" && method === "GET") {
          html(res, 200, renderIndex(store, frontier(store.nodes, store.now)));
          return;
        }
        if (pathName === "/archive" && method === "GET") {
          html(res, 200, renderArchive(store));
          return;
        }
        const pageRoute = /^\/t\/([0-9a-f]{8})$/.exec(pathName);
        if (pageRoute && method === "GET") {
          const node = store.find(pageRoute[1]);
          if (!node) {
            html(res, 404, `<!DOCTYPE html><meta charset="utf-8"><title>no such train</title><body style="background:#0d1117;color:#d8dee9;font:15px system-ui;padding:60px">No train with ref ${pageRoute[1]} \u2014 <a href="/" style="color:#8fb3d9">back to trains</a></body>`);
            return;
          }
          store.reload();
          const fresh = store.find(pageRoute[1]) ?? node;
          const cards = await sessions.cards(uniqueSessions(fresh));
          html(res, 200, renderThought(store, fresh, cards, listArtifacts(store, fresh)));
          return;
        }
        throw new ThoughtError("no_route", `${method} ${pathName} is not a route on this door`);
      } catch (error) {
        const code = error instanceof ThoughtError ? error.code : "internal";
        const status = code === "no_such_node" || code === "no_route" ? 404 : code === "claimed" || code === "not_holder" ? 409 : 400;
        send(res, status, { ok: false, error: { code, message: error.message } });
      }
    })();
  });
}
export {
  createServer,
  scanOutputs
};
//# sourceMappingURL=apiServer.js.map
