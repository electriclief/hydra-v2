/**
 * @module gui (browser)
 * @description The page: the active set (walk it, pull from it), a pull bench (name +
 *              marks → the answer), and a live toggle (the change feed refreshes the
 *              list at the VIEWER'S own cadence — State controls no clocks). Pure
 *              renderers (self-checked by the gate) + mount() for the DOM wiring.
 * @intent The page imports the SAME client the tests use. A page that imports a module
 *         and gets a dead UI is the classic failure — the gate proves every id it wires
 *         exists in the real index.html, and that a page missing one fails loudly.
 */

import { createStateClient } from '../client.js';
import type { PullAnswer, StateEntryInfo } from '../stateRegistry.js';

// --- Interface Definitions ---

/** Every element id the page wires — the gate cross-checks this list against index.html. */
export const GUI_IDS = [
  'st-status',
  'st-count',
  'st-query',
  'st-refresh',
  'st-live',
  'st-table',
  'st-name',
  'st-marks',
  'st-pull',
  'st-output',
];

export interface GuiHandle {
  stop(): void;
}

// --- Function Definitions ---

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One held-state row: the path, when it landed, what it declares, one pull button. */
export function renderEntryRow(info: StateEntryInfo): string {
  const time = escapeHtml(info.registeredAt.length >= 19 ? info.registeredAt.slice(11, 19) : info.registeredAt);
  const flags: string[] = [];
  if (info.hasRecipe) flags.push('<span class="badge door">door</span>');
  for (const [key, mode] of Object.entries(info.serving)) flags.push(`<span class="badge">${escapeHtml(key)}:${escapeHtml(mode)}</span>`);
  if (info.hasRender) flags.push('<span class="badge dim">render</span>');
  if (info.hasUpdate) flags.push('<span class="badge dim">update</span>');
  return [
    '<tr>',
    `<td><code>${escapeHtml(info.path)}</code></td>`,
    `<td class="dim">${time}</td>`,
    `<td>${flags.join(' ') || '<span class="dim">—</span>'}</td>`,
    `<td><button type="button" data-pull="${escapeHtml(info.path)}">pull</button></td>`,
    '</tr>',
  ].join('');
}

/** The answer, the way the reply reads: FULL or DELTA, the content, the fresh marks. */
export function renderReply(answer: PullAnswer): string {
  if (!answer.ok) {
    const list = answer.code === 'ambiguous' ? ` — candidates: ${(answer.candidates ?? []).map(escapeHtml).join(', ')}` : '';
    return `<div class="line err">${escapeHtml(answer.code)}: ${escapeHtml(answer.name)}${list}</div>`;
  }
  const badge = answer.full ? '<span class="badge full">FULL</span>' : '<span class="badge delta">DELTA</span>';
  const marks = Object.entries(answer.marks);
  return [
    `<div class="line">${badge} <code>${escapeHtml(answer.name)}</code> <span class="dim">${escapeHtml(answer.at)}</span></div>`,
    `<pre class="content">${escapeHtml(JSON.stringify(answer.content, null, 2))}</pre>`,
    marks.length ? `<div class="line dim">marks: ${escapeHtml(JSON.stringify(answer.marks))}</div>` : '',
  ].join('');
}

export function renderStatus(health: unknown): string {
  const h = health as { ok?: boolean; entries?: number; changes?: number } | null;
  if (!h || h.ok !== true) return 'offline';
  return `online · ${h.entries ?? 0} held · ${h.changes ?? 0} changes`;
}

/** Wire the page. Returns null when a needed element is missing (fail loudly, never half-work). */
export function mount(doc?: Document): GuiHandle | null {
  const d = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!d) return null;

  const $ = (id: string) => d.getElementById(id);
  const status = $('st-status');
  const count = $('st-count');
  const queryBox = $('st-query') as HTMLInputElement | null;
  const refreshBtn = $('st-refresh');
  const liveBox = $('st-live') as HTMLInputElement | null;
  const table = $('st-table');
  const nameBox = $('st-name') as HTMLInputElement | null;
  const marksBox = $('st-marks') as HTMLTextAreaElement | null;
  const pullBtn = $('st-pull');
  const output = $('st-output');
  if (!status || !count || !queryBox || !refreshBtn || !liveBox || !table || !nameBox || !marksBox || !pullBtn || !output) {
    return null;
  }

  const origin = typeof location !== 'undefined' && location.origin ? location.origin : 'http://127.0.0.1:8127';
  const client = createStateClient({ baseUrl: origin });

  let live: AbortController | null = null;
  const stopStream = () => {
    if (live) {
      live.abort();
      live = null;
    }
  };

  const refreshList = async () => {
    try {
      const data = await client.discover(queryBox.value.trim() || undefined);
      table.innerHTML = data.entries.length
        ? data.entries.map(renderEntryRow).join('')
        : '<tr><td colspan="4" class="dim">nothing held yet</td></tr>';
      count.textContent = String(data.summary.entries);
      status.textContent = renderStatus({ ok: true, entries: data.summary.entries, changes: data.summary.changes });
      status.className = 'status ok';
    } catch {
      status.textContent = 'offline — the registry is not answering';
      status.className = 'status err';
    }
  };

  const runPull = async (name: string) => {
    if (!name) {
      output.innerHTML = '<div class="line err">a pull needs a name</div>';
      return;
    }
    let marks: Record<string, number> = {};
    const rawMarks = marksBox.value.trim();
    if (rawMarks) {
      try {
        marks = JSON.parse(rawMarks) as Record<string, number>;
      } catch {
        status.textContent = 'marks are not JSON — pulling without them';
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
    client
      .stream({ onChange: () => void refreshList() }, live.signal)
      .catch(() => {
        /* reconnects on the next refresh */
      });
  };

  table.addEventListener('click', (ev: Event) => {
    const target = ev.target as HTMLElement | null;
    const name = target && typeof target.getAttribute === 'function' ? target.getAttribute('data-pull') : null;
    if (!name) return;
    nameBox.value = name;
    void runPull(name);
  });

  refreshBtn.addEventListener('click', () => void refreshList());
  queryBox.addEventListener('input', () => void refreshList());
  liveBox.addEventListener('change', () => startStream());
  pullBtn.addEventListener('click', () => void runPull(nameBox.value.trim()));

  void refreshList();
  startStream();

  return {
    stop: () => {
      stopStream();
    },
  };
}

// A browser boots itself; Node (the gate) only imports.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    mount();
  });
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. pure renderers
  ok('escapeHtml closes the door', escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;');
  const row = renderEntryRow({ path: 'A.B', registeredAt: '2026-09-23T10:00:00.000Z', updatedAt: '', hasRecipe: true, serving: { log: 'delta' }, shape: ['log'], hasRender: false, hasUpdate: false });
  ok('a row carries the pull button and flags', row.includes('data-pull="A.B"') && row.includes('log:delta') && row.includes('door'));
  const full = renderReply({ ok: true, name: 'A.B', at: '2026-09-23T10:00:00.000Z', full: true, content: { a: 1 }, marks: { log: 3 } });
  ok('a full reply renders the badge + marks', full.includes('>FULL<') && full.includes('&quot;log&quot;:3'));
  const delta = renderReply({ ok: true, name: 'A.B', at: '2026-09-23T10:00:00.000Z', full: false, content: { log: 'x' }, marks: {} });
  ok('a delta reply renders the badge', delta.includes('>DELTA<'));
  const refused = renderReply({ ok: false, code: 'ambiguous', name: 'B', candidates: ['A.B', 'C.B'], at: '' });
  ok('a refusal renders the candidates', refused.includes('ambiguous') && refused.includes('A.B'));
  ok('status renders online', renderStatus({ ok: true, entries: 2, changes: 5 }).startsWith('online · 2 held'));
  ok('status renders offline for junk', renderStatus(null) === 'offline');

  // 2. mount against a stub document built from the id list
  const stubDoc = (ids: string[]): Document => {
    const els = new Map<string, unknown>();
    for (const id of ids) {
      els.set(id, {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        className: '',
        addEventListener: () => {},
        getAttribute: () => null,
      });
    }
    return { getElementById: (id: string) => els.get(id) ?? null } as unknown as Document;
  };
  const handle = mount(stubDoc(GUI_IDS));
  ok('mount wires the stub page without throwing', handle !== null);
  handle?.stop();
  const broken = mount(stubDoc(GUI_IDS.filter((id) => id !== 'st-output')));
  ok('a page missing ONE id fails loudly (null)', broken === null);

  // 3. the real page carries every id the module wires
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const missing = GUI_IDS.filter((id) => !html.includes(`id="${id}"`));
  ok('index.html carries every wired id', missing.length === 0, missing.join(','));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
