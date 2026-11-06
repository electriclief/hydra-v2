/**
 * @module page
 * @description The three pages this door serves, rendered from the catalog and nothing else:
 *              the MENU (a tree on the left, the advert of whatever is under the pointer on the
 *              right, a click opening its inputs), the ADVERT (the maker's own ad page inside a
 *              slim frame), and the INPUTS page (the maker's page plus a form built from the
 *              declared fields, whose submit books a job on the Scheduler).
 * @intent A service's words stay in the service file. This module lays them out and never
 *         rewrites them; the only thing it adds is the way in — a form — and the way out — a job.
 */

import type { MenuRow } from './catalog.js';

// --- Interface Definitions ---

export interface PageOptions {
  /** Where the Scheduler answers, for the link and the form's target. */
  schedulerUrl: string;
  /** Why the catalog could not be read, when it could not. */
  error?: string | null;
}

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// --- Function Definitions ---

function css(): string {
  return `
  :root {
    color-scheme: dark;
    --bg: #111318;
    --panel: #191c23;
    --hover: #252a35;
    --border: #303541;
    --text: #e5e7eb;
    --muted: #a1a8b7;
    --accent: #8ab4f8;
    --ok: #86d29b;
    --warn: #e0c98a;
    --bad: #e0a0a0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { display: grid; grid-template-columns: minmax(300px, 420px) 1fr; gap: 16px; padding: 16px; height: 100vh; }
  .panel {
    display: flex; flex-direction: column; min-height: 0;
    padding: 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  }
  .panel h1 {
    margin: 0 0 10px; padding: 2px 8px 12px; border-bottom: 1px solid var(--border);
    font-size: 12px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--muted);
  }
  .panel h1 b { color: var(--text); font-weight: 600; }
  .sub { margin: 0 8px 10px; color: var(--muted); font-size: 12px; }
  .tree { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; min-height: 0; }
  .node { margin: 3px 0; }
  .row {
    display: flex; align-items: center; gap: 9px;
    padding: 9px 10px; border: 1px solid transparent; border-radius: 7px;
    color: var(--text); text-decoration: none; cursor: pointer;
    transition: background .15s, border-color .15s;
  }
  .row:hover, .row.sel { background: var(--hover); border-color: var(--border); }
  .row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .row.refused { color: var(--muted); cursor: not-allowed; }
  .emoji { font-size: 17px; line-height: 1; }
  .node-name { font-weight: 600; overflow-wrap: anywhere; }
  /* the type appends to the name: no auto margin, no far edge */
  .type {
    padding: 1px 7px; border: 1px solid #3a4b65; border-radius: 5px;
    color: var(--accent); font-size: 11px; white-space: nowrap;
  }
  .type.refused { border-color: #5a3030; color: var(--bad); }
  .foot { margin: 10px 8px 0; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; }
  .foot a { color: var(--accent); text-decoration: none; }
  .foot a:hover { text-decoration: underline; }
  .stage { display: flex; flex-direction: column; min-height: 0; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .stage-head { display: flex; align-items: baseline; gap: 10px; padding: 11px 14px; border-bottom: 1px solid var(--border); }
  .stage-head b { font-size: 14px; font-weight: 600; }
  .stage-head .meta { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage-head .open { margin-left: auto; color: var(--accent); text-decoration: none; font-size: 12px; white-space: nowrap; }
  .stage-head .open:hover { text-decoration: underline; }
  iframe { flex: 1; width: 100%; border: 0; background: #0d1117; min-height: 0; }
  .empty { padding: 24px; color: var(--muted); }
  @media (max-width: 820px) {
    .wrap { grid-template-columns: 1fr; height: auto; }
    .stage { height: 70vh; }
    .tree { max-height: 40vh; }
  }
  @media (prefers-reduced-motion: reduce) { .row { transition: none; } }
  `;
}

function shell(title: string, body: string, script = ''): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="What this machine can make locally — text, image, video, music — with nothing leaving the room.">
<title>${esc(title)}</title>
<style>${css()}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
}

/** A dead end that names the way back: used when a page cannot be built at all. */
export function renderNotice(title: string, message: string): string {
  const body = `
<div class="wrap" style="grid-template-columns: 1fr; max-width: 720px; height: auto;">
  <aside class="panel">
    <h1>${esc(title)}</h1>
    <p class="sub" style="margin-top: 8px;">${esc(message)}</p>
    <p class="foot"><a href="/">← the menu</a></p>
  </aside>
</div>`;
  return shell(title, body);
}

/**
 * The advert, framed: the maker's own page, with a way back and a way onward.
 * `embedded` = it is loading inside the menu's preview pane, which already owns the header —
 * so it renders bare rather than growing a second bar of its own.
 */
export function renderAdvert(row: MenuRow, authoredHtml: string, options: PageOptions, embedded = false): string {
  if (embedded) return shell(`${row.name} — advert`, `<div class="page">${authoredHtml}</div><style>.page { min-height: 100vh; }</style>`);
  const body = `
<div class="bar">
  <a href="/">← menu</a>
  <b>${esc(row.name)}</b>
  <span class="type">${esc(row.label)}</span>
  <a class="right" href="/inputs/${encodeURIComponent(row.name)}">Open inputs →</a>
</div>
<div class="page">${authoredHtml}</div>
<style>
  .bar {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; background: #191c23; border-bottom: 1px solid #303541; font-size: 12px;
  }
  .bar a { color: #8ab4f8; text-decoration: none; }
  .bar a:hover { text-decoration: underline; }
  .bar b { font-size: 13px; }
  .bar .right { margin-left: auto; }
  .bar .type { padding: 1px 7px; border: 1px solid #3a4b65; border-radius: 5px; color: #8ab4f8; }
  .page { min-height: calc(100vh - 38px); }
</style>`;
  return shell(`${row.name} — advert`, body);
}

function fieldControl(field: MenuRow['fields'][number]): string {
  const id = `f-${field.name}`;
  const help = field.help ? `<span class="hint">${esc(field.help)}</span>` : '';
  const value = field.default === null || field.default === undefined ? '' : String(field.default);
  let control: string;
  if (field.type === 'select') {
    const options = field.options
      .map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`)
      .join('');
    control = `<select id="${id}" name="${esc(field.name)}">${options}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea id="${id}" name="${esc(field.name)}" rows="4" spellcheck="false">${esc(value)}</textarea>`;
  } else if (field.type === 'number') {
    control = `<input id="${id}" name="${esc(field.name)}" type="number" step="any" value="${esc(value)}">`;
  } else {
    control = `<input id="${id}" name="${esc(field.name)}" type="text" value="${esc(value)}" spellcheck="false">`;
  }
  return `<label class="field${field.full ? ' full' : ''}" for="${id}"><span class="lab">${esc(field.label)}</span>${control}${help}</label>`;
}

/** The inputs page: the maker's page, then the form, then the job it becomes. */
export function renderInputs(row: MenuRow, authoredHtml: string, options: PageOptions, embedded = false): string {
  const form = row.fields.length
    ? row.fields.map(fieldControl).join('')
    : '<p class="hint">this service declares no input fields — the job is the service itself</p>';

  const bar = embedded ? '' : `
<div class="bar">
  <a href="/">← menu</a>
  <b>${esc(row.name)}</b>
  <span class="type">${esc(row.label)}</span>
  <a class="right" href="/advert/${encodeURIComponent(row.name)}">Read the advert →</a>
</div>`;
  // the fields first: a page that makes you scroll past prose to reach the form
  // is a page that forgot what it is for. The maker's copy is the footnote.
  const body = `${bar}
<div class="run">
  <h2>Run it</h2>
  <p class="hint">These are the fields <b>${esc(row.name)}</b> declares in the catalog. Booking writes a job to the
  <a href="${esc(options.schedulerUrl)}/" target="_blank" rel="noreferrer">Scheduler</a>, which runs one job at a time.
  <b>Today the runner is a dummy</b>: the job is recorded and nothing is executed.</p>
  <form id="run-form" novalidate>${form}<div class="submit"><button type="submit">Book this job</button></div></form>
  <div id="run-out" class="out" aria-live="polite"></div>
</div>
<div class="page">${authoredHtml}</div>
<style>
  body { background: #0d1117; }
  .bar {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; background: #191c23; border-bottom: 1px solid #303541; font-size: 12px;
    font-family: system-ui, sans-serif; color: #e5e7eb;
  }
  .bar a { color: #8ab4f8; text-decoration: none; }
  .bar a:hover { text-decoration: underline; }
  .bar b { font-size: 13px; }
  .bar .right { margin-left: auto; }
  .bar .type { padding: 1px 7px; border: 1px solid #3a4b65; border-radius: 5px; color: #8ab4f8; }
  .page { opacity: .92; border-top: 1px solid #303541; }
  .run {
    margin: 0; padding: 4px 24px 40px; background: #111318; border-top: 1px solid #303541;
    font-family: system-ui, sans-serif; color: #e5e7eb;
  }
  .run h2 {
    font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em;
    color: #8fb3d9; margin: 22px 0 4px;
  }
  .hint { color: #7d8998; font-size: 12px; margin: 4px 0 14px; max-width: 720px; line-height: 1.6; }
  .hint a { color: #8ab4f8; }
  form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; max-width: 760px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field.full { grid-column: 1 / -1; }
  .lab { font-size: 12px; color: #a1a8b7; }
  input, select, textarea {
    width: 100%; padding: 7px 9px; background: #191c23; color: #e5e7eb;
    border: 1px solid #303541; border-radius: 7px; font: inherit;
  }
  textarea { resize: vertical; min-height: 84px; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 1px; }
  .submit { grid-column: 1 / -1; }
  button {
    padding: 8px 16px; background: #1d2634; color: #e5e7eb; border: 1px solid #3a4b65;
    border-radius: 7px; font: inherit; cursor: pointer;
  }
  button:hover { background: #252a35; }
  button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .out { margin-top: 18px; max-width: 760px; font-size: 13px; }
  .out code { font: 12px ui-monospace, Consolas, monospace; color: #8ab4f8; }
  .out .st { padding: 1px 7px; border: 1px solid #3a4b65; border-radius: 5px; font-size: 11px; }
  .out .st.done { border-color: #2f5a3f; color: #86d29b; }
  .out .st.failed, .out .st.cancelled { border-color: #5a3030; color: #e0a0a0; }
  .out .st.running { border-color: #5a4a2f; color: #e0c98a; }
  .out pre { margin: 8px 0 0; padding: 10px 12px; background: #191c23; border: 1px solid #303541; border-radius: 8px; white-space: pre-wrap; font: 12px ui-monospace, Consolas, monospace; color: #a1a8b7; }
  .out .bad { color: #e0a0a0; }
  .out .cancel { padding: 4px 10px; font-size: 12px; margin-left: 8px; }
</style>`;

  const script = `
(function () {
  var SERVICE = ${JSON.stringify(row.name)};
  var form = document.getElementById('run-form');
  var out = document.getElementById('run-out');
  var timer = null;

  function setStatus(job) {
    var cls = job.status === 'done' ? 'done' : (job.status === 'failed' || job.status === 'cancelled') ? job.status : job.status === 'running' ? 'running' : '';
    var lines = [];
    lines.push('booked <code>' + job.id + '</code> — <span class="st ' + cls + '">' + job.status + '</span>');
    if (job.status === 'queued') lines.push('<div class="hint">waiting for the one slot — the Scheduler runs a single job at a time</div>');
    if (job.status === 'running') lines.push('<div class="hint">running now — started ' + job.startedAt + '</div>');
    if (job.result) lines.push('<pre>' + (job.result.note || '') + (job.result.ms ? '\\n\\n(' + job.result.ms + ' ms)' : '') + '</pre>');
    if (job.error) lines.push('<p class="bad">' + job.error + '</p>');
    if (job.status === 'queued' || job.status === 'running') {
      lines.push('<button type="button" class="cancel" id="cancel-job">Cancel</button>');
    }
    out.innerHTML = lines.join('');
    var cancel = document.getElementById('cancel-job');
    if (cancel) cancel.addEventListener('click', function () { void cancelJob(job.id); });
  }

  async function cancelJob(id) {
    var res = await fetch('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
    var body = await res.json();
    if (!res.ok) { out.innerHTML += '<p class="bad">' + (body.reason || 'could not cancel') + '</p>'; return; }
    if (body.job) setStatus(body.job);
  }

  async function poll(id) {
    clearTimeout(timer);
    try {
      var res = await fetch('/api/jobs/' + encodeURIComponent(id));
      var body = await res.json();
      if (body.job) setStatus(body.job);
      if (body.job && (body.job.status === 'queued' || body.job.status === 'running')) {
        timer = setTimeout(function () { void poll(id); }, 700);
      }
    } catch (e) {
      timer = setTimeout(function () { void poll(id); }, 1500);
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var inputs = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'number') inputs[el.name] = el.value === '' ? null : Number(el.value);
      else inputs[el.name] = el.value;
    });
    out.innerHTML = '<p class="hint">booking…</p>';
    try {
      var res = await fetch('/api/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service: SERVICE, inputs: inputs })
      });
      var body = await res.json();
      if (!res.ok) {
        out.innerHTML = '<p class="bad">' + ((body.error && body.error.message) || ('the Scheduler answered ' + res.status)) + '</p>';
        return;
      }
      setStatus(body.job);
      void poll(body.job.id);
    } catch (err) {
      out.innerHTML = '<p class="bad">the Scheduler is not answering: ' + err + '</p>';
    }
  });
})();`;

  return shell(`${row.name} — inputs`, body, script);
}
