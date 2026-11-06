/**
 * @module browser/gui
 * @description THE PAGE — the shelf as a readable list, and one box to resolve a name by.
 *              Structure over display: it shows the two columns side by side and refuses to
 *              merge them, because that separation is the module's promise.
 * @intent A limited reader (human or agent) must be able to see what this node HAS and what
 *              is ANSWERING, separately, and then resolve anything by typing its name.
 */

// --- Interface Definitions ---

export interface GuiElements {
  readonly root: HTMLElement;
  readonly lookup: HTMLInputElement;
  readonly go: HTMLButtonElement;
  readonly answer: HTMLElement;
  readonly rows: HTMLElement;
}

// --- Function Definitions ---

const COLUMNS = ['module', 'kind', 'port', 'is', 'wired@boot', 'what it is'];

/** Escape everything — this page renders strings from disk. */
export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One row. `is` and `should` are visibly different columns, always. */
function renderRow(r: { name: string; kind: string; should: { port: number | null; wiredAtBoot: boolean; what: string; missing: string[] }; is: string; detail: string }): string {
  const missing = r.should.missing.length ? ` <span class="miss">missing: ${escapeHtml(r.should.missing.join(' · '))}</span>` : '';
  return `<tr class="live-${escapeHtml(r.is)}">`
    + `<td class="nm">${escapeHtml(r.name)}</td>`
    + `<td>${escapeHtml(r.kind)}</td>`
    + `<td class="num">${r.should.port ?? '—'}</td>`
    + `<td class="st st-${escapeHtml(r.is)}">${escapeHtml(r.is)}</td>`
    + `<td>${r.should.wiredAtBoot ? 'yes' : '—'}</td>`
    + `<td>${escapeHtml(r.should.what || '(says nothing about itself)')}${missing}</td>`
    + `</tr>`;
}

/** The whole table. Offered services are a second population and are labelled as such. */
export function renderShelf(data: { modules: Parameters<typeof renderRow>[0][]; offered?: { name: string; provider: string; what: string }[] }, doc: Document): void {
  const rows = doc.getElementById('rows');
  if (!rows) return;
  const head = `<tr>${COLUMNS.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const body = data.modules.map(renderRow).join('');
  const offered = (data.offered ?? []).length
    ? `<tr class="offered-head"><td colspan="${COLUMNS.length}">OFFERED — the catalog. Present ≠ running: it starts when it is run.</td></tr>`
      + data.offered!.map(o => `<tr class="live-offered"><td class="nm">${escapeHtml(o.name)}</td><td>service</td><td class="num">—</td><td class="st st-offered">offered</td><td>—</td><td>${escapeHtml(o.what)} <span class="dim">via ${escapeHtml(o.provider)}</span></td></tr>`).join('')
    : '';
  rows.innerHTML = `<table>${head}${body}${offered}</table>`;
}

/** Resolve one name by hand — the same door an agent uses. */
export async function resolveByName(name: string, baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/resolve/${encodeURIComponent(name)}`);
  const body = await res.json() as Record<string, unknown>;
  if (body.found === true) {
    return `${String(body.name)} — ${String(body.liveness)}${body.port ? ` on ${String(body.port)}` : ''}\n${String(body.reason)}`;
  }
  const alts = Array.isArray(body.alternatives) ? body.alternatives.join(', ') : '';
  return `no such thing: ${name}\nwhat IS here: ${alts}`;
}

/** Wire the page. Exported so the gate can mount it against a stub document. */
export function mount(doc: Document = document): void {
  const rows = doc.getElementById('rows');
  const lookup = doc.getElementById('lookup') as HTMLInputElement | null;
  const go = doc.getElementById('go') as HTMLButtonElement | null;
  const answer = doc.getElementById('answer');
  const baseUrl = doc.body?.getAttribute('data-base') ?? '';

  if (!rows) throw new Error('gui: #rows is missing from the page');

  let timer: ReturnType<typeof setInterval> | undefined;
  const load = async (): Promise<void> => {
    try {
      const res = await fetch(`${baseUrl}/api/shelf`);
      renderShelf(await res.json() as Parameters<typeof renderShelf>[0], doc);
    } catch (e) {
      rows.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="miss">cannot read the shelf: ${escapeHtml(e instanceof Error ? e.message : String(e))}</td></tr>`;
    }
  };

  const ask = async (): Promise<void> => {
    const name = lookup?.value.trim() ?? '';
    if (!name || !answer) return;
    answer.textContent = 'asking…';
    try {
      answer.textContent = await resolveByName(name, baseUrl);
    } catch (e) {
      answer.textContent = `the door did not answer: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  go?.addEventListener('click', () => { void ask(); });
  lookup?.addEventListener('keydown', ev => { if ((ev as KeyboardEvent).key === 'Enter') void ask(); });

  void load();
  timer = setInterval(() => { void load(); }, 3000);

  const stop = (): void => { if (timer !== undefined) clearInterval(timer); };
  // the stop handle is parked on the document so the gate can prove the timer is cleared
  (doc as unknown as { __joinStop?: () => void }).__joinStop = stop;
}

/** The page mounts itself — a module that is imported and never mounted is a dead UI. */
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(document));
  else mount(document);
}

// --- Function Definitions (tests) ---

/** Drive the renderer against a STUB document built from the ids the page wires. */
export function runTests(): void {
  // A stub element that KEEPS what is written to it — a plain object literal loses
  // innerHTML between the write and the read, which reads as a dead renderer.
  const mk = (id: string, tag = 'div'): HTMLElement => {
    const state = { innerHTML: '', textContent: '', value: '' };
    return {
      id, tagName: tag.toUpperCase(),
      get innerHTML() { return state.innerHTML; },
      set innerHTML(v: string) { state.innerHTML = v; },
      get textContent() { return state.textContent; },
      set textContent(v: string) { state.textContent = v; },
      value: '',
      setAttribute() { }, getAttribute() { return ''; }, addEventListener() { },
      classList: { add() { }, remove() { } },
    } as unknown as HTMLElement;
  };
  const ids = ['lookup', 'go', 'answer'];
  // The rows element MUST be the SAME object the renderer writes to and the test reads
  // from — a getElementById that builds a fresh element per call reads back empty.
  const rowsEl = mk('rows');
  const stub = {
    getElementById: (id: string) => (id === 'rows' ? rowsEl : (ids.includes(id) ? mk(id) : null)),
    body: { getAttribute: () => '' },
    defaultView: null,
  } as unknown as Document;

  const data = {
    modules: [
      { name: 'State', kind: 'door', should: { port: 8127, wiredAtBoot: false, what: 'the retainer', missing: [] }, is: 'up', detail: '' },
      { name: 'Basic_App', kind: 'door', should: { port: 8130, wiredAtBoot: false, what: 'the instance', missing: ['start'] }, is: 'down', detail: '' },
      { name: 'Electron_Wrapper', kind: 'shell', should: { port: null, wiredAtBoot: true, what: 'the one window', missing: [] }, is: 'down', detail: '' },
    ],
    offered: [{ name: 'chat', provider: 'llama.cpp', what: 'one chat' }],
  };

  const rows = stub.getElementById('rows') as HTMLElement;
  renderShelf(data as Parameters<typeof renderShelf>[0], stub);
  const html = rows.innerHTML;
  console.assert(html.includes('State') && html.includes('8127'), 'the table renders a row with its port', html.slice(0, 80));
  console.assert(html.includes('st-up') && html.includes('st-down'), 'liveness is a visible class', '');
  console.assert(html.includes('OFFERED'), 'the offered population is labelled', '');
  console.assert(html.includes('missing: start'), 'an undeclared fact is shown as missing', '');
  console.assert(html.includes('the retainer'), 'the human sentence is rendered', '');

  console.assert(escapeHtml('<b>&"x"') === '&lt;b&gt;&amp;&quot;x&quot;', 'escape covers all five', escapeHtml('<b>&"x"'));
  void resolveByName;
}

// runTests();