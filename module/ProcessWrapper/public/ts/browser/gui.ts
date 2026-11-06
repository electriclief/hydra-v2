/**
 * @module gui
 * @description The human face of the wrapper: a page served from the API root that starts
 *              processes, shows the live table, follows a stream and kills.
 * @intent The API and the MCP endpoint are for machines; an operator needs one screen: type a
 *         command, watch it talk, stop it. This module is that screen — and it is deliberately
 *         split in two: the pure half (formatting and markup, no DOM) which the gate can
 *         self-check, and `mount()` which does the wiring against real elements. It talks to
 *         the SAME client module the CLI uses, so the page can never drift from the API.
 *
 * Loaded natively as an ES module (`<script type="module" src="/js/browser/gui.js">`) — no
 * bundler, because the browser resolves the same relative imports Node does.
 */

import { createProcessClient, type ProcessClient, type StreamEvent } from '../client.js';
import type { ProcessRecord, ProcessLife, StreamChannel } from '../processWrapper.js';
import type { CommandDefinition } from '../registryStore.js';

// --- Interface Definitions ---

/** Everything the page needs to know about one render pass. */
export interface GuiState {
  processes: ProcessRecord[];
  selectedId: string | null;
  following: boolean;
  saved: CommandDefinition[];
  savedName: string | null;
  channel: StreamChannel | 'both';
  health: Record<string, unknown> | null;
  error: string | null;
  now: number;
}

/** The handle `mount()` returns, so a test (or the console) can drive the page. */
export interface GuiHandle {
  refresh(): Promise<void>;
  select(id: string | null): void;
  setFollowing(on: boolean): void;
  stop(): void;
  state(): GuiState;
}

// --- Function Definitions ---

/** Escape text for HTML. Every value that reaches the DOM goes through here. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The CSS class for a life, so the table colours itself. */
export function lifeClass(life: ProcessLife): string {
  return `life life-${life}`;
}

/** Characters, in a size an eye can read at a glance. */
export function formatChars(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** How long a life has been (or was) going. */
export function formatUptime(rec: ProcessRecord, now: number = Date.now()): string {
  const end = rec.endedAt ?? now;
  const ms = Math.max(0, end - rec.spawnedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, '0')}m`;
}

/** One row of the process table. Pure: state in, markup out. */
export function renderProcessRow(rec: ProcessRecord, opts: { selected?: boolean; now?: number } = {}): string {
  const live = rec.life === 'running' || rec.life === 'starting';
  return [
    `<tr class="${opts.selected ? 'selected' : ''}" data-id="${escapeHtml(rec.id)}">`,
    `<td class="mono id">${escapeHtml(rec.id)}</td>`,
    `<td>${escapeHtml(rec.name)}${rec.tag ? ` <span class="tag">${escapeHtml(rec.tag)}</span>` : ''}</td>`,
    `<td class="mono num">${rec.pid ?? '—'}</td>`,
    `<td><span class="${lifeClass(rec.life)}">${escapeHtml(rec.life)}</span></td>`,
    // the structure has to be visible: who owns this process's output is a property of the row, not a footnote
    rec.isolation === 'supervised'
      ? `<td><span class="tag" title="nothing of this process's output reaches this door: it was not spawned here">supervised</span></td>`
      : `<td class="mono muted">in-loop</td>`,
    `<td class="mono num">${formatChars(rec.chars.stdout + rec.chars.stderr)}</td>`,
    `<td class="mono num">${formatUptime(rec, opts.now)}</td>`,
    `<td class="mono num">${rec.exitCode === null ? '—' : rec.exitCode}</td>`,
    `<td class="actions">`,
    rec.isolation === 'supervised'
      ? `<span class="muted" title="adopted: its stdout was never ours to read">no capture</span>`
      : `<button data-act="view" data-id="${escapeHtml(rec.id)}" title="show this stream">view</button>`,
    live
      ? `<button data-act="kill" data-id="${escapeHtml(rec.id)}" title="ask it to stop">kill</button>` +
        `<button class="danger" data-act="force" data-id="${escapeHtml(rec.id)}" title="kill the whole tree now">force</button>`
      : `<button data-act="rm" data-id="${escapeHtml(rec.id)}" title="forget it (the life file stays)">forget</button>`,
    `</td>`,
    `</tr>`,
  ].join('');
}

/** The process table body, or a friendly empty line. */
export function renderProcessTable(list: ProcessRecord[], opts: { selectedId?: string | null; now?: number } = {}): string {
  if (!list.length) {
    return `<tr class="empty"><td colspan="8">nothing launched yet — type a command above, or launch a saved one</td></tr>`;
  }
  return list.map((rec) => renderProcessRow(rec, { selected: rec.id === opts.selectedId, now: opts.now })).join('');
}

/** One saved command, with its launch and delete affordances. */
export function renderCommandRow(def: CommandDefinition): string {
  const line = [def.command, ...def.args].join(' ');
  return [
    `<li data-name="${escapeHtml(def.name)}">`,
    `<button data-act="launch-saved" data-name="${escapeHtml(def.name)}" title="launch this saved command">▶</button>`,
    `<span class="mono name">${escapeHtml(def.name)}</span>`,
    `<span class="mono cmd">${escapeHtml(line)}</span>`,
    def.description ? `<span class="desc">${escapeHtml(def.description)}</span>` : '',
    def.tag ? `<span class="tag">${escapeHtml(def.tag)}</span>` : '',
    `<button class="danger" data-act="unsave" data-name="${escapeHtml(def.name)}" title="drop it from data.yaml">✕</button>`,
    `</li>`,
  ].join('');
}

/** The saved-command picker's options. */
export function renderSavedOptions(list: CommandDefinition[], selected: string | null): string {
  const head = `<option value="">— raw command —</option>`;
  return (
    head +
    list
      .map((def) => {
        const label = `${def.name}${def.description ? ` — ${def.description}` : ''}`;
        return `<option value="${escapeHtml(def.name)}"${def.name === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('')
  );
}

/** The health badge text. */
export function renderHealthBadge(health: Record<string, unknown> | null): string {
  if (!health) return 'not reachable';
  const procs = (health.processes ?? {}) as { live?: number; total?: number };
  const saved = health.savedCommands;
  return `ok · ${procs.live ?? 0} live / ${procs.total ?? 0} total · ${saved ?? 0} saved · ${health.copies ?? 0} copies open`;
}

/** The stream chapter heading for one process. */
export function renderStreamHeader(rec: ProcessRecord | null): string {
  if (!rec) return 'pick a process';
  return `${rec.id} · ${rec.life} · pid ${rec.pid ?? '—'} · ${formatChars(rec.chars.stdout + rec.chars.stderr)} chars · ${rec.streamFile}`;
}

/** A follow note — what the live copy is doing. */
export function followNotice(ev: StreamEvent): string {
  if (ev.event === 'end') return `[stream ended: ${String(ev.data.reason ?? 'end')}]\n`;
  if (ev.event === 'drop') return `[this copy fell behind and shed ${String(ev.data.droppedChars ?? '?')} chars — the life file still has them]\n`;
  if (ev.event === 'open') return `[following from ${String(ev.data.from ?? 0)}]\n`;
  return '';
}

/** Parse the env box: JSON object, or one KEY=VALUE per line, or empty. Throws on junk. */
export function parseEnvInput(raw: string): Record<string, string> | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (text.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`env looks like JSON but does not parse: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('env must be a JSON object of names to values');
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) throw new Error(`env line "${trimmed}" is neither JSON nor KEY=VALUE`);
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Wire the page to a running wrapper. Does nothing when there is no DOM (the gate). */
export function mount(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): GuiHandle | null {
  if (!doc) return null;
  const win = doc.defaultView;
  if (!win) return null; // a document without a window (ssr/tests) — nothing to wire

  const $ = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) throw new Error(`gui: missing element #${id}`);
    return el as T;
  };

  const base = doc.location.origin;
  const tokenKey = 'pw.token';
  const savedToken = win.localStorage?.getItem(tokenKey) ?? null;

  let client: ProcessClient = createProcessClient({ baseUrl: base, token: savedToken });
  const state: GuiState = {
    processes: [],
    selectedId: null,
    following: false,
    saved: [],
    savedName: null,
    channel: 'both',
    health: null,
    error: null,
    now: Date.now(),
  };
  let followHandle: { close(): void } | null = null;
  let followFrom = 0;
  let loadedChars = -1;
  let timer: number | null = null;

  const tbody = $<HTMLTableSectionElement>('procs-body');
  const streamEl = $<HTMLPreElement>('stream');
  const streamHeader = $<HTMLElement>('stream-header');
  const streamMeta = $<HTMLElement>('stream-meta');
  const healthEl = $<HTMLElement>('health');
  const errorEl = $<HTMLElement>('error');
  const savedList = $<HTMLUListElement>('commands');
  const savedSelect = $<HTMLSelectElement>('saved-select');
  const commandInput = $<HTMLInputElement>('command');
  const startButton = $<HTMLButtonElement>('start');
  const followToggle = $<HTMLInputElement>('follow');
  const channelSelect = $<HTMLSelectElement>('channel');
  const tokenInput = $<HTMLInputElement>('token');
  const apiEl = $<HTMLElement>('api-url');
  const mcpEl = $<HTMLElement>('mcp-url');

  apiEl.textContent = base;
  mcpEl.textContent = `${base}/mcp`;
  if (savedToken) tokenInput.value = savedToken;
  tokenInput.addEventListener('change', () => {
    const value = tokenInput.value.trim();
    win.localStorage?.setItem(tokenKey, value);
    client = createProcessClient({ baseUrl: base, token: value || null });
    void refresh();
  });

  const showError = (message: string | null) => {
    state.error = message;
    errorEl.textContent = message ?? '';
    errorEl.classList.toggle('hidden', !message);
  };

  const closeFollow = () => {
    followHandle?.close();
    followHandle = null;
  };

  const append = (text: string) => {
    streamEl.textContent = (streamEl.textContent ?? '') + text;
    streamEl.scrollTop = streamEl.scrollHeight;
  };

  const startFollow = () => {
    if (!state.selectedId) return;
    closeFollow();
    followFrom = (streamEl.textContent ?? '').length;
    followHandle = client.follow(
      state.selectedId,
      (ev) => {
        if (ev.event === 'chunk') {
          append(String(ev.data.text ?? ''));
          streamMeta.textContent = `${streamEl.textContent?.length ?? 0} chars shown · following`;
        } else {
          const note = followNotice(ev);
          if (note) append(note);
          if (ev.event === 'end') {
            streamMeta.textContent = `${streamEl.textContent?.length ?? 0} chars shown · stream ended`;
            state.following = false;
            followToggle.checked = false;
          }
        }
      },
      { from: followFrom, channel: state.channel === 'both' ? undefined : state.channel },
    );
  };

  const loadStream = async (id: string) => {
    try {
      const copy = await client.output(id, { channel: state.channel });
      streamEl.textContent = copy.text;
      loadedChars = copy.total;
      streamMeta.textContent = `${copy.total} chars captured · showing ${copy.to - copy.from}${copy.complete ? '' : ' (the buffer shed the front; the life file has it all)'}`;
      if (state.following) startFollow();
    } catch (err) {
      showError(`could not read ${id}: ${(err as Error).message}`);
    }
  };

  const select = (id: string | null) => {
    state.selectedId = id;
    closeFollow();
    streamEl.textContent = '';
    loadedChars = -1;
    const rec = state.processes.find((p) => p.id === id) ?? null;
    streamHeader.textContent = renderStreamHeader(rec);
    streamMeta.textContent = '';
    if (!id) return;
    void loadStream(id);
  };

  const refresh = async () => {
    state.now = Date.now();
    try {
      const [list, health, saved] = await Promise.all([client.list(), client.health(), client.commands()]);
      state.processes = list;
      state.health = health;
      state.saved = saved;
      healthEl.textContent = renderHealthBadge(health);
      tbody.innerHTML = renderProcessTable(list, { selectedId: state.selectedId, now: state.now });
      savedList.innerHTML = saved.map(renderCommandRow).join('') || `<li class="empty">nothing saved yet</li>`;
      savedSelect.innerHTML = renderSavedOptions(saved, state.savedName);
      showError(null);

      // Keep the stream pane current when a process is selected but not being followed:
      // a copy is cheap, so re-read it whenever the captured count moved.
      const selected = state.selectedId ? list.find((p) => p.id === state.selectedId) ?? null : null;
      if (selected) {
        streamHeader.textContent = renderStreamHeader(selected);
        const total = selected.chars.stdout + selected.chars.stderr;
        if (!state.following && total !== loadedChars) await loadStream(selected.id);
      } else if (state.selectedId) {
        select(null); // it was removed or forgotten from somewhere else
      }
    } catch (err) {
      healthEl.textContent = 'not reachable';
      showError(`${(err as Error).message}${tokenInput.value ? '' : ' — if this box needs a token, set it above'}`);
    }
  };

  const launch = async () => {
    const advanced = {
      name: $<HTMLInputElement>('opt-name').value.trim() || undefined,
      tag: $<HTMLInputElement>('opt-tag').value.trim() || undefined,
      cwd: $<HTMLInputElement>('opt-cwd').value.trim() || undefined,
      shell: $<HTMLInputElement>('opt-shell').checked,
    };
    try {
      const env = parseEnvInput($<HTMLTextAreaElement>('opt-env').value);
      showError(null);
      const rec = state.savedName
        ? await client.launch({ saved: state.savedName, ...advanced, env })
        : await client.launch({ command: commandInput.value.trim(), ...advanced, env });
      await refresh();
      select(rec.id);
      if (state.following) startFollow();
    } catch (err) {
      showError(`launch failed: ${(err as Error).message}`);
    }
  };

  $<HTMLFormElement>('launch-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    void launch();
  });

  savedSelect.addEventListener('change', () => {
    state.savedName = savedSelect.value || null;
    const def = state.saved.find((c) => c.name === state.savedName) ?? null;
    commandInput.value = def ? [def.command, ...def.args].join(' ') : '';
    commandInput.readOnly = !!def;
    commandInput.classList.toggle('readonly', !!def);
    startButton.textContent = def ? `start saved "${def.name}"` : 'start';
  });

  followToggle.addEventListener('change', () => {
    state.following = followToggle.checked;
    if (state.following) startFollow();
    else closeFollow();
  });

  channelSelect.addEventListener('change', () => {
    state.channel = channelSelect.value as StreamChannel | 'both';
    if (state.selectedId) select(state.selectedId);
  });

  tbody.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const act = target.getAttribute('data-act');
    const id = target.getAttribute('data-id');
    if (!act || !id) return;
    if (act === 'view') select(id);
    if (act === 'kill' || act === 'force') {
      void (async () => {
        try {
          await client.kill(id, { force: act === 'force' });
          await refresh();
        } catch (err) {
          showError(`kill failed: ${(err as Error).message}`);
        }
      })();
    }
    if (act === 'rm') {
      void (async () => {
        try {
          await client.remove(id);
          if (state.selectedId === id) select(null);
          await refresh();
        } catch (err) {
          showError(`remove failed: ${(err as Error).message}`);
        }
      })();
    }
  });

  $<HTMLButtonElement>('reload').addEventListener('click', () => {
    if (state.selectedId) select(state.selectedId);
  });

  $<HTMLButtonElement>('clear').addEventListener('click', () => {
    streamEl.textContent = '';
    streamMeta.textContent = '';
  });

  const sendStdin = async () => {
    const input = $<HTMLInputElement>('stdin');
    const text = input.value;
    if (!state.selectedId || !text) return;
    try {
      await client.input(state.selectedId, text);
      append(`\n[sent ${text.length} chars to stdin]\n`);
      input.value = '';
    } catch (err) {
      showError(`stdin failed: ${(err as Error).message}`);
    }
  };
  $<HTMLButtonElement>('send').addEventListener('click', () => void sendStdin());
  $<HTMLInputElement>('stdin').addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') {
      ev.preventDefault();
      void sendStdin();
    }
  });

  savedList.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const act = target.getAttribute('data-act');
    const name = target.getAttribute('data-name');
    if (!act || !name) return;
    if (act === 'launch-saved') {
      void (async () => {
        try {
          const rec = await client.launch({ saved: name });
          await refresh();
          select(rec.id);
        } catch (err) {
          showError(`launch failed: ${(err as Error).message}`);
        }
      })();
    }
    if (act === 'unsave') {
      void (async () => {
        try {
          await client.removeCommand(name);
          await refresh();
        } catch (err) {
          showError(`unsave failed: ${(err as Error).message}`);
        }
      })();
    }
  });

  $<HTMLFormElement>('save-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    void (async () => {
      const name = $<HTMLInputElement>('save-name').value.trim();
      const command = $<HTMLInputElement>('save-cmd').value.trim();
      const description = $<HTMLInputElement>('save-desc').value.trim();
      try {
        await client.saveCommand({ name, command, description } as Partial<CommandDefinition> & { name: string; command: string });
        $<HTMLInputElement>('save-name').value = '';
        $<HTMLInputElement>('save-cmd').value = '';
        $<HTMLInputElement>('save-desc').value = '';
        await refresh();
      } catch (err) {
        showError(`save failed: ${(err as Error).message}`);
      }
    })();
  });

  const autoRefresh = $<HTMLInputElement>('autorefresh');
  timer = win.setInterval(() => {
    if (autoRefresh.checked) void refresh();
  }, 2000);

  void refresh();

  return {
    refresh,
    select,
    setFollowing: (on: boolean) => {
      followToggle.checked = on;
      state.following = on;
      if (on) startFollow();
      else closeFollow();
    },
    stop: () => {
      closeFollow();
      if (timer !== null) win.clearInterval(timer);
      timer = null;
    },
    state: () => ({ ...state, processes: state.processes }),
  };
}

// --- Bootstrap: the page loads this module, so wire the DOM as soon as it is ready ---
// Guarded on `document` so Node (the gate) can import the module headless and self-check it.

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const boot = () => {
    try {
      mount();
    } catch (err) {
      console.error('[gui] could not wire the page:', err);
      const banner = document.getElementById('error');
      if (banner) {
        banner.textContent = `the GUI could not start: ${(err as Error).message}`;
        banner.classList.remove('hidden');
      }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

// --- Built-in Test Suite ---
// The pure half is self-checked here; the DOM half is verified against the real page (the
// element ids this module wires are exactly the ones public/index.html carries).

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const rec = (over: Partial<ProcessRecord> = {}): ProcessRecord => ({
    id: 'demo-001-ab12',
    name: 'demo',
    tag: null,
    isolation: 'in-loop',
    command: 'demo.exe',
    args: [],
    cwd: '.',
    shell: false,
    pid: 4242,
    life: 'running',
    spawnedAt: Date.now() - 4200,
    endedAt: null,
    exitCode: null,
    signal: null,
    chars: { stdout: 1200, stderr: 0 },
    truncated: false,
    streamFile: 'C:/x/demo-001-ab12.log',
    error: null,
    ...over,
  });

  // 1. escaping — nothing a process prints may become markup
  ok('escapeHtml escapes the angle brackets', escapeHtml('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', escapeHtml('<script>'));
  ok('escapeHtml escapes quotes', escapeHtml('a"b\'c') === 'a&quot;b&#39;c', escapeHtml('a"b\'c'));
  ok('escapeHtml handles null', escapeHtml(null) === '');

  // 2. numbers a human reads
  ok('small counts stay exact', formatChars(923) === '923', formatChars(923));
  ok('thousands are shortened', formatChars(12_340) === '12k', formatChars(12_340));
  ok('millions are shortened', formatChars(2_500_000) === '2.5M', formatChars(2_500_000));
  ok('nonsense counts do not crash the page', formatChars(Number.NaN) === '0');
  ok('uptime reads in ms under a second', formatUptime(rec({ spawnedAt: 1000, endedAt: 1400 }), 10_000) === '400ms', formatUptime(rec({ spawnedAt: 1000, endedAt: 1400 }), 10_000));
  ok('uptime reads in seconds', formatUptime(rec({ spawnedAt: 1000, endedAt: 9600 }), 10_000) === '8.6s', formatUptime(rec({ spawnedAt: 1000, endedAt: 9600 }), 10_000));
  ok('uptime reads in minutes and seconds', formatUptime(rec({ spawnedAt: 0, endedAt: 125_000 }), 0) === '2m05s', formatUptime(rec({ spawnedAt: 0, endedAt: 125_000 }), 0));
  ok('a running process counts up to now', formatUptime(rec({ spawnedAt: 0 }), 5000) === '5.0s', formatUptime(rec({ spawnedAt: 0 }), 5000));

  // 3. the table markup the page needs
  const row = renderProcessRow(rec());
  ok('a row carries the id for clicking', row.includes('data-id="demo-001-ab12"'), row.slice(0, 80));
  ok('a live row offers kill and force', row.includes('data-act="kill"') && row.includes('data-act="force"'), row);
  ok('a live row offers view', row.includes('data-act="view"'));
  ok('a live row does NOT offer forget', !row.includes('data-act="rm"'));
  const doneRow = renderProcessRow(rec({ life: 'exited', exitCode: 0, endedAt: Date.now() }));
  ok('a finished row offers forget instead of kill', doneRow.includes('data-act="rm"') && !doneRow.includes('data-act="kill"'));
  ok('a finished row shows its exit code', doneRow.includes('<td class="mono num">0</td>'), doneRow);
  ok('the life is styled by class', row.includes('life life-running'), row.slice(0, 200));
  ok('a tag is shown when present', renderProcessRow(rec({ tag: 'gpu' })).includes('<span class="tag">gpu</span>'));
  ok('the selected row is marked', renderProcessRow(rec(), { selected: true }).startsWith('<tr class="selected"'));
  ok('a name with markup cannot inject', renderProcessRow(rec({ name: '<img onerror=x>' })).includes('&lt;img onerror=x&gt;'));
  ok('an empty table explains itself', renderProcessTable([]).includes('nothing launched yet'));
  ok('the table renders every row', renderProcessTable([rec({ id: 'a-1' }), rec({ id: 'b-2' })], { selectedId: 'b-2' }).split('<tr').length - 1 === 2);
  ok('the selected id is marked in the table', renderProcessTable([rec({ id: 'a-1' }), rec({ id: 'b-2' })], { selectedId: 'b-2' }).includes('class="selected" data-id="b-2"'));

  // 4. saved commands and the picker
  const def: CommandDefinition = {
    name: 'tick',
    command: 'node',
    args: ['-e', "setInterval(()=>console.log('tick'),1000)"],
    cwd: '',
    env: {},
    shell: false,
    isolation: 'in-loop',
    description: 'a ticker',
    tag: 'demo',
    createdAt: '',
    updatedAt: '',
  };
  const cmdRow = renderCommandRow(def);
  ok('a saved command offers launch and drop', cmdRow.includes('data-act="launch-saved"') && cmdRow.includes('data-act="unsave"'));
  ok('a saved command shows its line and description', cmdRow.includes('a ticker') && cmdRow.includes('setInterval'));
  ok('the picker starts with a raw option', renderSavedOptions([def], null).startsWith('<option value="">— raw command —</option>'));
  ok('the picker marks the chosen name', renderSavedOptions([def], 'tick').includes('<option value="tick" selected>'));
  ok('the picker shows the description as the label', renderSavedOptions([def], null).includes('tick — a ticker'));

  // 5. the badge and the stream heading
  ok('the badge says when the box is unreachable', renderHealthBadge(null) === 'not reachable');
  const badge = renderHealthBadge({ processes: { live: 2, total: 5 }, savedCommands: 3, copies: 1 });
  ok('the badge counts live, total, saved and copies', badge.includes('2 live / 5 total') && badge.includes('3 saved') && badge.includes('1 copies open'), badge);
  ok('the stream heading names the file', renderStreamHeader(rec()).includes('demo-001-ab12.log'));
  ok('an empty stream heading asks for a pick', renderStreamHeader(null) === 'pick a process');

  // 6. follow notices and the env box
  ok('a drop notice admits the loss', followNotice({ event: 'drop', data: { droppedChars: 42 } }).includes('42'));
  ok('an end notice names the reason', followNotice({ event: 'end', data: { reason: 'process-ended' } }).includes('process-ended'));
  ok('a chunk produces no notice text', followNotice({ event: 'chunk', data: {} }) === '');
  ok('env accepts KEY=VALUE lines', JSON.stringify(parseEnvInput('HF_HOME=C:/models\nPY=1')) === JSON.stringify({ HF_HOME: 'C:/models', PY: '1' }), JSON.stringify(parseEnvInput('HF_HOME=C:/models\nPY=1')));
  ok('env accepts a JSON object', JSON.stringify(parseEnvInput('{"A":"1"}')) === JSON.stringify({ A: '1' }));
  ok('an empty env box means no env', parseEnvInput('   ') === undefined);
  ok('a broken env box explains itself', (() => {
    try {
      parseEnvInput('{oops: 1}');
      return false;
    } catch (err) {
      return (err as Error).message.includes('does not parse');
    }
  })());
  ok('a junk env line explains itself', (() => {
    try {
      parseEnvInput('just-a-word');
      return false;
    } catch (err) {
      return (err as Error).message.includes('KEY=VALUE');
    }
  })());

  // 7. the DOM half, without a browser: a stub page built from the ids mount() wires, plus
  //    the contract check that public/index.html really carries them.
  const REQUIRED_IDS = [
    'health', 'error', 'procs-body', 'stream', 'stream-header', 'stream-meta', 'commands',
    'saved-select', 'command', 'start', 'follow', 'channel', 'token', 'api-url', 'mcp-url',
    'launch-form', 'reload', 'clear', 'stdin', 'send', 'save-form', 'save-name', 'save-cmd',
    'save-desc', 'opt-name', 'opt-tag', 'opt-cwd', 'opt-env', 'opt-shell', 'autorefresh',
  ];
  const fs = await import('node:fs');
  const url = await import('node:url');
  const pagePath = url.fileURLToPath(new URL('../../../public/index.html', import.meta.url));
  const page = fs.readFileSync(pagePath, 'utf8');
  ok('the page carries every id the module wires', REQUIRED_IDS.every((id) => page.includes(`id="${id}"`)), REQUIRED_IDS.filter((id) => !page.includes(`id="${id}"`)).join(','));
  ok('the page loads the module it needs', page.includes('/js/browser/gui.js'));

  const makeStub = (ids: string[]) => {
    const els = new Map<string, Record<string, unknown>>();
    for (const id of ids) {
      els.set(id, {
        id,
        textContent: '',
        innerHTML: '',
        value: '',
        checked: false,
        readOnly: false,
        scrollTop: 0,
        scrollHeight: 0,
        options: [],
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
      });
    }
    const cleared: number[] = [];
    const doc = {
      location: { origin: 'http://127.0.0.1:8125' },
      getElementById: (id: string) => els.get(id) ?? null,
      addEventListener() {},
      defaultView: {
        setInterval: () => 7,
        clearInterval: (t: number) => cleared.push(t),
        localStorage: { getItem: () => null, setItem() {} },
      },
    };
    return { doc: doc as unknown as Document, els, cleared };
  };

  ok('mount() without a document is a no-op, not a crash', mount(undefined) === null);
  const stub = makeStub(REQUIRED_IDS);
  const handle = mount(stub.doc);
  ok('mount wires the whole real page without throwing', handle !== null);
  ok('the stub page has every element the module asked for', REQUIRED_IDS.every((id) => stub.els.has(id)));
  ok('mount exposes state, refresh, select and stop', !!handle && typeof handle.refresh === 'function' && typeof handle.select === 'function' && typeof handle.stop === 'function' && handle.state().processes.length === 0);
  ok('mount points the page at its own origin', (stub.els.get('api-url')?.textContent as string) === 'http://127.0.0.1:8125' && (stub.els.get('mcp-url')?.textContent as string) === 'http://127.0.0.1:8125/mcp', String(stub.els.get('mcp-url')?.textContent));
  handle?.stop();
  ok('stop clears the refresh timer', stub.cleared.includes(7), JSON.stringify(stub.cleared));
  const missingOne = REQUIRED_IDS.filter((id) => id !== 'procs-body');
  ok('a page missing one id fails loudly instead of half-working', (() => {
    try {
      mount(makeStub(missingOne).doc);
      return false;
    } catch (err) {
      return (err as Error).message.includes('procs-body');
    }
  })());

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
