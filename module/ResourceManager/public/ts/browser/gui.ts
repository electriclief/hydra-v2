/**
 * @module browser/gui
 * @description The page — this node's register, live: the machine pane (cpu · ram · gpus
 *              with the observed row · disks · shared folders), the register pane (every
 *              booking with pop/clear), and the book form (the one write; a refusal shows
 *              the wait info). Pure render functions keep it testable without a DOM; mount()
 *              only wires what the page needs.
 * @intent The page shows what the API says — the same client the tests use. Nothing here
 *         decides anything: poll · book · pop · clear, exactly the module's four verbs.
 */

import { summarizeBooking } from '../resourceSchema.js';
import type { Booking, BookOutcome, EndedBooking, ResourceReads } from '../resourceSchema.js';
import type { RmClient } from '../client.js';

// --- Interface Definitions ---

export interface GuiOptions {
  client: RmClient;
  /** Auto-refresh cadence (default 5000 ms; 0 = off). */
  intervalMs?: number;
}

export const GUI_IDS = {
  root: 'rm-root',
  sub: 'rm-sub',
  resources: 'rm-resources',
  bookings: 'rm-bookings',
  form: 'rm-form',
  outcome: 'rm-outcome',
} as const;

// --- Function Definitions ---

export function escapeHtml(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtMb(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} TB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

function row(k: string, v: string): string {
  return `<div class="row"><span class="k">${escapeHtml(k)}</span><span>${v}</span></div>`;
}

/** The machine pane — what the poll just read. */
export function renderResources(reads: ResourceReads): string {
  const parts: string[] = [];
  parts.push(row('node', `${escapeHtml(reads.node)} <span class="dim">(${escapeHtml(reads.platform)})</span>`));
  parts.push(row('cpu', `${escapeHtml(reads.cpu.model)} — ${reads.cpu.cores} cores · load ${reads.cpu.loadPct ?? '?'}%`));
  parts.push(row('ram', `${fmtMb(reads.ram.freeMb)} free of ${fmtMb(reads.ram.totalMb)}`));
  const gpus = reads.gpus.length
    ? reads.gpus
        .map((gpu) => {
          const observed = reads.gpusObserved.filter((p) => gpuObservedLooksRelated(p.name, gpu.name));
          const obs = observed.length ? ` <span class="badge">observed: ${observed.map((p) => escapeHtml(p.name)).join(', ')}</span>` : '';
          return `${escapeHtml(gpu.name)} — ${fmtMb(gpu.vramMb)} <span class="dim">(${escapeHtml(gpu.vramSource)})</span>${obs}`;
        })
        .join('<br>')
    : '<span class="dim">none read</span>';
  parts.push(row('gpus', gpus));
  const stray = reads.gpusObserved.filter((p) => !reads.gpus.some((gpu) => gpuObservedLooksRelated(p.name, gpu.name)));
  if (stray.length) parts.push(row('observed', `<span class="badge">${stray.map((p) => escapeHtml(`${p.name} (pid ${p.pid} · ${p.reason})`)).join('</span> <span class="badge">')}</span>`));
  parts.push(
    row(
      'disks',
      reads.disks.length
        ? reads.disks.map((disk) => `${escapeHtml(disk.device)} ${fmtMb(disk.freeMb)} free / ${fmtMb(disk.totalMb)}`).join('<br>')
        : '<span class="dim">none read</span>',
    ),
  );
  parts.push(
    row(
      'shares',
      reads.shares.length
        ? reads.shares
            .map((share) => {
              const state = share.exists ? `<span class="badge ok">exists</span>` : `<span class="badge err">missing</span>`;
              return `${escapeHtml(share.label ? share.label + ' — ' : '')}<span class="mono">${escapeHtml(share.path)}</span> ${state} ${fmtMb(share.freeMb)} free`;
            })
            .join('<br>')
        : '<span class="dim">none declared (data/shares.json)</span>',
    ),
  );
  if (reads.notes.length) parts.push(row('notes', `<span class="dim">${reads.notes.map(escapeHtml).join('<br>')}</span>`));
  return parts.join('');
}

function gpuObservedLooksRelated(processName: string, gpuName: string): boolean {
  const p = processName.toLowerCase();
  const g = gpuName.toLowerCase();
  return (g.includes('nvidia') && !p.includes('lolminer')) || (g.includes('radeon') && !/python|llama|sd|comfy/.test(p)) ? p.length > 0 : false;
}

/** The register pane — every booking, with its exits. */
export function renderBookings(active: Booking[], ended: EndedBooking[] = []): string {
  const rows = active.length
    ? active
        .map(
          (booking) =>
            `<tr><td>${escapeHtml(booking.service)}${booking.mode ? ` <span class="dim">· ${escapeHtml(booking.mode)}</span>` : ''}</td>` +
            `<td>${escapeHtml(summarizeBooking(booking))}</td>` +
            `<td class="dim">${escapeHtml(booking.bookedAt.replace('T', ' ').slice(0, 19))}${booking.expected ? ` · ~${escapeHtml(booking.expected)}` : ''}</td>` +
            `<td><button data-act="pop" data-id="${escapeHtml(booking.id)}">pop</button> <button data-act="clear" data-id="${escapeHtml(booking.id)}">clear</button></td></tr>`,
        )
        .join('')
    : '';
  const table = active.length
    ? `<table><thead><tr><th>service</th><th>holds</th><th>since</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="dim">nothing is booked — the register is empty (it never lies about that).</p>';
  const endedRows = ended.length
    ? `<p class="dim" style="margin-top:10px">ended (last ${ended.length}): ${ended
        .slice(-8)
        .map((booking) => `${escapeHtml(booking.service)} <span class="badge">${booking.endReason}</span>`)
        .join(' · ')}</p>`
    : '';
  return table + endedRows;
}

export function renderOutcome(outcome: BookOutcome): string {
  if (outcome.ok) {
    return `<div class="outcome ok">booked <span class="mono">${escapeHtml(outcome.booking.id)}</span> — ${escapeHtml(outcome.booking.service)} holds ${escapeHtml(summarizeBooking(outcome.booking)) || '(nothing)'}</div>`;
  }
  const blockers = outcome.error.blockers
    .map((blocker) => `<div class="dim">${blocker.heldBy ? `↳ held by ${escapeHtml(blocker.heldBy.service)} since ${escapeHtml(blocker.heldBy.since)}` : '↳ ' + escapeHtml(blocker.kind)}</div>`)
    .join('');
  return `<div class="outcome err">refused <span class="badge err">${escapeHtml(outcome.error.code)}</span> — ${escapeHtml(outcome.error.message)}${blockers}</div>`;
}

const SHELL = `
<section class="panes">
  <div class="pane"><h3>the machine <button id="rm-refresh" style="float:right">refresh</button></h3><div id="rm-resources" class="dim">loading…</div></div>
  <div class="pane"><h3>the register</h3><div id="rm-bookings" class="dim">loading…</div></div>
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
    <div class="wide"><label for="rm-paths">paths (comma separated — a booked folder covers its subtree)</label><input id="rm-paths"></div>
    <div class="wide"><label for="rm-expected">expected (info only — leave empty when unknown)</label><input id="rm-expected"></div>
  </div>
  <button type="submit">book</button>
</form>
<div id="rm-outcome"></div>
`;

/** Wire the page. DOM-only — the pure renderers above carry the tests. */
export function mount(root: HTMLElement, options: GuiOptions): { stop(): void } {
  const client = options.client;
  root.innerHTML = SHELL;
  const byId = (id: string): HTMLElement | null => root.querySelector('#' + id);
  const resourcesEl = byId(GUI_IDS.resources);
  const bookingsEl = byId(GUI_IDS.bookings);
  const outcomeEl = byId(GUI_IDS.outcome);
  const value = (id: string): string => (byId(id) as HTMLInputElement | null)?.value.trim() ?? '';

  async function refresh(): Promise<void> {
    try {
      const [view, register] = await Promise.all([client.resources(), client.bookings(true)]);
      if (resourcesEl) resourcesEl.innerHTML = renderResources(view.resources);
      if (bookingsEl) bookingsEl.innerHTML = renderBookings(register.active, register.ended ?? []);
    } catch (err) {
      if (resourcesEl) resourcesEl.innerHTML = `<span class="badge err">read failed: ${escapeHtml(err instanceof Error ? err.message : String(err))}</span>`;
    }
  }

  byId('rm-refresh')?.addEventListener('click', () => void refresh());
  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('[data-act]') as HTMLElement | null;
    if (!button) return;
    const id = button.getAttribute('data-id') ?? '';
    const act = button.getAttribute('data-act');
    void (async () => {
      try {
        if (act === 'pop') await client.pop(id);
        else if (act === 'clear') await client.clear(id);
      } catch (err) {
        if (outcomeEl) outcomeEl.innerHTML = `<div class="outcome err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      }
      await refresh();
    })();
  });

  byId(GUI_IDS.form)?.addEventListener('submit', (event) => {
    event.preventDefault();
    const paths = value('rm-paths');
    const num = (id: string): number | undefined => {
      const raw = value(id);
      if (!raw) return undefined;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    void (async () => {
      try {
        const outcome = await client.book({
          service: value('rm-service'),
          mode: value('rm-mode') || null,
          gpu: value('rm-gpu') || null,
          cores: num('rm-cores'),
          ramMb: num('rm-ram'),
          diskMb: num('rm-disk'),
          paths: paths ? paths.split(/[,\n;]+/).map((piece) => piece.trim()).filter(Boolean) : [],
          expected: value('rm-expected') || null,
        });
        if (outcomeEl) outcomeEl.innerHTML = renderOutcome(outcome);
      } catch (err) {
        if (outcomeEl) outcomeEl.innerHTML = `<div class="outcome err">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
      }
      await refresh();
    })();
  });

  void refresh();
  const intervalMs = options.intervalMs ?? 5000;
  const timer = intervalMs > 0 ? setInterval(() => void refresh(), intervalMs) : null;
  return { stop: () => { if (timer) clearInterval(timer); } };
}

// A browser boots itself; Node (the gate) only imports.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById(GUI_IDS.root);
    if (!root) return;
    void import('../client.js').then(({ createRmClient }) => {
      mount(root, { client: createRmClient({ baseUrl: window.location.origin }) });
    });
  });
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const reads: ResourceReads = {
    collectedAt: new Date().toISOString(),
    node: 'test-node',
    platform: 'win32',
    cpu: { model: 'Fake Ryzen', cores: 16, loadPct: 12.5 },
    ram: { totalMb: 32768, freeMb: 20000 },
    gpus: [{ name: 'AMD Radeon RX 6800', vramMb: 16384, vramSource: 'registry', memUsedMb: null }],
    gpusObserved: [{ name: 'lolMiner.exe', pid: 7, reason: 'miner' }],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [{ label: 'models', path: 'C:\\Hydra\\shared\\models', exists: true, freeMb: 100000, totalMb: 500000 }],
    notes: [],
  };

  const resourcesHtml = renderResources(reads);
  ok('resources: names the machine and its cores', resourcesHtml.includes('Fake Ryzen') && resourcesHtml.includes('16 cores'));
  ok('resources: vram shows in GB with its source', resourcesHtml.includes('16.0 GB') && resourcesHtml.includes('registry'));
  ok('resources: the observed miner is visible', resourcesHtml.includes('lolMiner.exe'));
  ok('resources: the share shows with its state', resourcesHtml.includes('models') && resourcesHtml.includes('exists'));

  const booking: Booking = {
    id: 'bk-abc', service: 'image-gen', mode: 'krea2', gpu: 'AMD Radeon RX 6800', cores: 4, ramMb: 8000,
    diskMb: null, paths: ['C:\\work\\proj'], expected: '~20 min', note: null, run: null, bookedAt: '2026-09-24T12:00:00.000Z',
  };
  const bookingsHtml = renderBookings([booking], []);
  ok('bookings: the row carries service and holds', bookingsHtml.includes('image-gen') && bookingsHtml.includes('4 cores') && bookingsHtml.includes('C:\\work\\proj'));
  ok('bookings: the exits are wired (data-act)', bookingsHtml.includes('data-act="pop"') && bookingsHtml.includes('data-act="clear"'));
  ok('bookings: an empty register says so plainly', renderBookings([], []).includes('nothing is booked'));

  const okHtml = renderOutcome({ ok: true, booking });
  ok('outcome: a landed book shows its id', okHtml.includes('outcome ok') && okHtml.includes('bk-abc'));
  const refuseHtml = renderOutcome({
    ok: false,
    error: { code: 'double_booked', message: 'gpu is booked by image-gen', blockers: [{ kind: 'gpu', detail: 'x', heldBy: { id: 'bk-1', service: 'image-gen', since: '2026-09-24T11:00:00.000Z' } }] },
  });
  ok('outcome: a refusal shows the code and the holder', refuseHtml.includes('refused') && refuseHtml.includes('double_booked') && refuseHtml.includes('image-gen'));

  ok('escape: markup cannot ride in', escapeHtml('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
  ok('fmtMb: scales to GB and TB', fmtMb(512) === '512 MB' && fmtMb(2048) === '2.0 GB' && fmtMb(1024 * 1024 * 3) === '3.0 TB');
  ok('GUI_IDS names every hook the page needs', Object.keys(GUI_IDS).length === 6 && typeof mount === 'function');

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[browser/gui] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
