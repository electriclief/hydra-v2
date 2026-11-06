/**
 * @module browser/gui
 * @description THE PAGE — one instance, two panes: LEFT the shelf (hover or arrow keys
 *              highlight; the RIGHT pane swaps to the viewed service's AD), then "Prepare
 *              this serve" → the INPUTS (its page + a form built from the definition's own
 *              data) → Run → a live progress pane that copies the run's output while it
 *              runs. ONE at a time, no queue: while busy the buttons that would harm the
 *              run go INACTIVE — never hidden. Every run remembers its last inputs
 *              (a field marked muted always resets — it is the defaulted hand).
 * @intent The instance keeps its own courtesy; the modules keep the truth. This is Basic.
 */

import type { ServiceDefinition, ServiceSummary, ServiceVariable } from '../doors.js';

// --- Interface Definitions ---

export interface Field {
  name: string;
  label: string;
  type: string;
  value: string;
  required: boolean;
  muted: boolean;
  full: boolean;
  help: string | null;
  min: number | null;
  max: number | null;
  step: number | null;
  options: string[];
  isOutput: boolean;
}

export interface RunState {
  ok: boolean;
  busy: boolean;
  run: null | {
    runId: string;
    name: string;
    pid: number | null;
    life: string;
    exitCode: number | null;
    startedAt: string;
    command: string;
    outputPath: string | null;
    gui: { kind?: string; value?: string; note?: string } | null;
    progressHow: string | null;
  };
}

// --- Function Definitions ---

/** The definition's typed inputs → the form's own view. Saved values override; muted never does. */
export function buildFields(def: ServiceDefinition, saved: Record<string, unknown> = {}): Field[] {
  const out: Field[] = [];
  for (const v of def.variables?.input ?? []) {
    if (!v || typeof v.name !== 'string') continue;
    const muted = v.muted === true;
    const fallback = v.default === undefined || v.default === null ? '' : String(v.default);
    const kept = muted ? fallback : saved[v.name] !== undefined && saved[v.name] !== null ? String(saved[v.name]) : fallback;
    out.push({
      name: v.name,
      label: typeof v.label === 'string' && v.label ? v.label : v.name,
      type: typeof v.type === 'string' && v.type ? v.type : 'text',
      value: kept,
      required: v.required === true,
      muted,
      full: v.full === true || (typeof v.type === 'string' && v.type === 'textarea'),
      help: typeof v.help === 'string' ? v.help : null,
      min: typeof v.min === 'number' ? v.min : null,
      max: typeof v.max === 'number' ? v.max : null,
      step: typeof v.step === 'number' ? v.step : null,
      options: Array.isArray(v.options) ? v.options.map(String) : [],
      isOutput: v.role === 'output',
    });
  }
  return out;
}

/** The list pane as markup — the selected row carries the mark. */
export function renderList(services: ServiceSummary[], selected: string | null): string {
  if (!services.length) return '<p class="dim">no services answer — is the services door up?</p>';
  return services
    .map((s) => {
      const badge = s.ok === false ? '<span class="badge warn">warning</span>' : '';
      const karma = s.karma === null || s.karma === undefined ? '' : `<span class="karma">${s.karma} karma</span>`;
      return `<div class="item${s.name === selected ? ' on' : ''}" data-name="${escapeAttr(s.name)}" tabindex="0">
        <div class="item-name">${escapeHtml(s.name)} ${badge}</div>
        <div class="item-what">${escapeHtml(s.what ?? '')}</div>
        <div class="item-side">${escapeHtml(s.provider ?? '')} ${karma}</div>
      </div>`;
    })
    .join('');
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

/** The run pane's little banner line. */
export function runLine(state: RunState): string {
  const r = state.run;
  if (!r) return 'idle';
  const life = r.life === 'running' || r.life === 'starting' ? 'running' : `ended (exit ${r.exitCode ?? '?'})`;
  return `${r.name} — ${life} — pid ${r.pid ?? '…'}`;
}

// --- The live page (browser only; the tests never touch this half) ---

export function mount(doc: Document = document): void {
  const el = (id: string) => doc.getElementById(id) as HTMLElement;
  const servicesEl = el('services');
  const viewerEl = el('viewer');
  const busyStrip = el('busy-strip');
  const busyText = el('busy-text');
  const btnStop = el('btn-stop') as HTMLButtonElement;
  const btnGui = el('btn-gui') as HTMLButtonElement;
  const scout = el('scout');
  const logEl = el('run-log') as HTMLPreElement;

  let selected: string | null = null;
  let definitions = new Map<string, ServiceDefinition>();
  let busy = false;
  let mode: 'ad' | 'inputs' | 'run' = 'ad';
  let progressFrom = 0;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  const savedKey = (name: string) => `basic.inputs.${name}`;
  const loadSaved = (name: string): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(savedKey(name)) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const saveField = (name: string, field: string, value: unknown, muted: boolean): void => {
    if (muted) return; // the defaulted hand always resets
    const all = loadSaved(name);
    all[field] = value;
    localStorage.setItem(savedKey(name), JSON.stringify(all));
  };

  async function api<T>(p: string, init?: RequestInit): Promise<T> {
    const res = await fetch(p, init);
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    return body as T;
  }

  async function loadServices(): Promise<void> {
    try {
      const answer = await api<{ services: ServiceSummary[] }>('/api/basic/services');
      servicesEl.innerHTML = renderList(answer.services ?? [], selected);
      for (const item of Array.from(servicesEl.querySelectorAll<HTMLElement>('.item'))) {
        const name = item.dataset.name ?? '';
        item.addEventListener('mouseenter', () => void show(name));
        item.addEventListener('focus', () => void show(name));
        item.addEventListener('click', () => void show(name));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') void show(name);
        });
      }
    } catch (err) {
      servicesEl.innerHTML = `<p class="dim">${escapeHtml(String(err))}</p>`;
    }
  }

  async function show(name: string): Promise<void> {
    selected = name;
    for (const item of Array.from(servicesEl.querySelectorAll<HTMLElement>('.item'))) {
      item.classList.toggle('on', item.dataset.name === name);
    }
    if (busy || mode === 'run') return; // looking is free, but a live run keeps its pane
    mode = 'ad';
    const ad = await fetch(`/api/basic/services/${encodeURIComponent(name)}/ad`).then((r) => r.text());
    viewerEl.innerHTML = `
      <iframe id="ad-frame" sandbox="allow-same-origin"></iframe>
      <div class="foot">
        <button id="btn-prepare" ${busy ? 'disabled' : ''}>Prepare this serve →</button>
        <span class="dim" id="pick-note"></span>
      </div>`;
    (doc.getElementById('ad-frame') as HTMLIFrameElement).srcdoc = ad;
    const btn = doc.getElementById('btn-prepare') as HTMLButtonElement;
    btn.addEventListener('click', () => void prepare(name));
  }

  async function prepare(name: string): Promise<void> {
    if (busy) return;
    mode = 'inputs';
    const answer = await api<{ service: ServiceDefinition; warnings?: unknown[] }>(`/api/basic/services/${encodeURIComponent(name)}`);
    definitions.set(name, answer.service);
    const inputsPage = await fetch(`/api/basic/services/${encodeURIComponent(name)}/inputs`).then((r) => r.text());
    const fields = buildFields(answer.service, loadSaved(name));
    viewerEl.innerHTML = `
      <iframe id="inputs-frame" sandbox="allow-same-origin"></iframe>
      <div class="form" id="form">
        ${fields.map(fieldHtml).join('')}
      </div>
      <div class="foot">
        <button id="btn-back">← back to the ad</button>
        <button id="btn-run" ${busy ? 'disabled' : ''}>▶ Run ${escapeHtml(name)}</button>
        <span class="dim">one at a time — no queue</span>
      </div>`;
    (doc.getElementById('inputs-frame') as HTMLIFrameElement).srcdoc = inputsPage;
    for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('#form [data-field]'))) {
      const fieldName = input.dataset.field ?? '';
      const muted = input.dataset.muted === '1';
      const read = (): unknown => (input.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value);
      input.addEventListener('change', () => saveField(name, fieldName, read(), muted));
    }
    (doc.getElementById('btn-back') as HTMLButtonElement).addEventListener('click', () => void show(name));
    (doc.getElementById('btn-run') as HTMLButtonElement).addEventListener('click', () => void run(name));
  }

  function fieldHtml(f: Field): string {
    const bits: string[] = [];
    const common = `data-field="${escapeAttr(f.name)}" data-muted="${f.muted ? '1' : '0'}"`;
    if (f.type === 'textarea') {
      bits.push(`<textarea ${common} rows="4">${escapeHtml(f.value)}</textarea>`);
    } else if (f.type === 'select' || f.options.length) {
      const opts = f.options.map((o) => `<option value="${escapeAttr(o)}"${o === f.value ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
      bits.push(`<select ${common}>${opts}</select>`);
    } else if (f.type === 'boolean' || f.type === 'checkbox') {
      bits.push(`<label class="check"><input type="checkbox" ${common} ${f.value === 'true' ? 'checked' : ''}> ${escapeHtml(f.label)}</label>`);
    } else {
      const attrs = [
        `type="${f.type === 'number' || f.type === 'range' ? f.type : 'text'}"`,
        common,
        f.min !== null ? `min="${f.min}"` : '',
        f.max !== null ? `max="${f.max}"` : '',
        f.step !== null ? `step="${f.step}"` : '',
        `value="${escapeAttr(f.value)}"`,
      ]
        .filter(Boolean)
        .join(' ');
      bits.push(`<input ${attrs}>`);
    }
    const head = `<label class="flabel"><span>${escapeHtml(f.label)}${f.required ? ' <b class="req">*</b>' : ''}${f.isOutput ? ' <span class="dim">(kept fresh on every run)</span>' : ''}</span></label>`;
    const help = f.help ? `<div class="fhelp">${escapeHtml(f.help)}</div>` : '';
    return `<div class="field${f.full ? ' full' : ''}${f.muted ? ' muted' : ''}">${head}${f.type === 'boolean' ? '' : ''}${bits.join('')}${help}</div>`;
  }

  function collect(name: string): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('#form [data-field]'))) {
      values[input.dataset.field ?? ''] = input.type === 'checkbox' ? (input as HTMLInputElement).checked : input.value;
    }
    return values;
  }

  async function run(name: string): Promise<void> {
    if (busy) return;
    const btn = doc.getElementById('btn-run') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      const answer = await api<{ run: RunState['run']; outputPath: string | null; freshOutput: Array<{ from: string; to: string }> }>(
        '/api/basic/run',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, values: collect(name) }) },
      );
      mode = 'run';
      progressFrom = 0;
      renderRun(name, answer.run, answer.freshOutput ?? []);
      startProgress(name);
      void pollState();
    } catch (err) {
      mode = 'inputs';
      scout.textContent = `run refused: ${String(err)}`;
      if (btn) btn.disabled = false;
    }
  }

  function renderRun(name: string, r: RunState['run'], fresh: Array<{ from: string; to: string }>): void {
    const gui = r?.gui;
    const how = r?.progressHow;
    viewerEl.innerHTML = `
      <div class="runhead">
        <b>${escapeHtml(name)}</b> is running — the app watches now.
        ${r?.outputPath ? `<div class="dim">output → ${escapeHtml(r.outputPath)}</div>` : ''}
        ${fresh.map((f) => `<div class="dim">kept fresh: ${escapeHtml(f.from)} → ${escapeHtml(f.to)}</div>`).join('')}
        ${how ? `<div class="dim">progress declared: ${escapeHtml(how)}</div>` : '<div class="dim">no progress declared — copying the output anyway</div>'}
      </div>
      <div class="foot">
        ${gui?.value ? `<button id="btn-gui">follow the service's own gui →</button>` : ''}
        <button id="btn-stop">■ Stop</button>
      </div>
      <pre id="run-log"></pre>`;
    logEl.textContent = '';
  }

  function startProgress(name: string): void {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      void (async () => {
        try {
          const answer = await api<{ from: number; text: string }>(`/api/basic/progress?from=${progressFrom}`);
          if (answer.text) {
            const log = doc.getElementById('run-log');
            if (log) log.textContent = (log.textContent ?? '') + answer.text;
          }
          progressFrom = answer.from;
        } catch {
          /* the run ended; the state poll settles the pane */
        }
      })();
    }, 900);
  }

  async function pollState(): Promise<void> {
    try {
      const state = await api<RunState>('/api/basic/state');
      busy = state.busy === true;
      busyStrip.style.display = busy ? 'flex' : 'none';
      if (busy && state.run) {
        busyText.textContent = `${state.run.name} — ${state.run.life} — pid ${state.run.pid ?? '…'}`;
        btnStop.style.display = 'inline-block';
        btnGui.style.display = state.run.gui?.value ? 'inline-block' : 'none';
      } else {
        busyText.textContent = '';
        btnStop.style.display = 'none';
        btnGui.style.display = 'none';
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        if (mode === 'run') {
          const done = doc.getElementById('run-log');
          if (done && !done.dataset.settled) done.dataset.settled = '1';
          mode = 'ad';
          if (selected) void show(selected);
        }
      }
      // the busy rule: buttons that would harm the run go inactive, never hidden
      for (const b of Array.from(doc.querySelectorAll<HTMLButtonElement>('#btn-run, #btn-prepare'))) {
        b.disabled = busy;
      }
    } catch {
      /* the app's own door blipped — try again next tick */
    }
  }

  btnStop.addEventListener('click', () => {
    void api('/api/basic/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
  });
  btnGui.addEventListener('click', () => {
    void api('/api/basic/gui', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch((err) => {
      scout.textContent = `gui: ${String(err)}`;
    });
  });

  void loadServices();
  void pollState();
  setInterval(() => void pollState(), 1500);
  setInterval(() => void loadServices(), 15000);
}

// --- Built-in Test Suite (pure halves only) ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL gui :: ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const list = renderList(
    [
      { name: 'chat', what: 'one chat, several brains', provider: 'llama.cpp', modes: [], karma: 3, ok: true },
      { name: 'broken', what: 'x', provider: 'y', modes: [], karma: null, ok: false },
    ],
    'chat',
  );
  ok('the list marks the viewed row', list.includes('class="item on" data-name="chat"'));
  ok('a warning service carries its badge', list.includes('warning'));
  ok('the karma rides the row', list.includes('3 karma'));

  const fields = buildFields(
    {
      name: 'demo',
      variables: {
        input: [
          { name: 'prompt', type: 'text', required: true },
          { name: 'out', type: 'text', default: 'C:/out.png', role: 'output' },
          { name: 'model', type: 'select', default: 'a', options: ['a', 'b'], muted: true },
          { name: 'steps', type: 'number', default: 20, min: 1, max: 100 },
        ],
      },
    },
    { prompt: 'kept!', model: 'b' },
  );
  ok('saved values come back', fields.find((f) => f.name === 'prompt')?.value === 'kept!');
  ok('a muted field always resets to its default', fields.find((f) => f.name === 'model')?.value === 'a');
  ok('the output field is marked', fields.find((f) => f.name === 'out')?.isOutput === true);
  ok('numeric bounds survive', fields.find((f) => f.name === 'steps')?.max === 100);
  ok('a required field is marked', fields.find((f) => f.name === 'prompt')?.required === true);

  ok('escaping holds', escapeHtml('<b>&"\'').includes('&lt;b&gt;'));
  ok('an idle run line reads idle', runLine({ ok: true, busy: false, run: null }) === 'idle');

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}
