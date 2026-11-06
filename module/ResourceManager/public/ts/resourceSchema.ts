/**
 * @module resourceSchema
 * @description THE RESOURCE MODEL — every shape this register speaks, in one place:
 *              the READS (cpu · ram · gpus + observed processes · disks · Hydra shared
 *              folders), the BOOKING (keyed to a service run; amounts for cores/ram/disk,
 *              a gpu whole+pinned, paths[]) and the OUTCOMES (booked / refused with the
 *              blockers). Plus the two bits of bookkeeping the register is allowed to do:
 *              amount math (totals) and path overlap (a booked folder covers its subtree).
 * @intent Operator rulings (Resource Manager rounds 1-5, 2026-09-24): the register has
 *         NO internal logic — poll is a pure read, book is the one write, pop/clear the
 *         two exits; the only rule is it won't allow double booking (1 app per gpu).
 *         Paths are not locks — parallel agents book the folders they work in so they
 *         don't step on each other. Nothing here is enforcement — voluntary all the way.
 */

// --- Interface Definitions ---

/** One gpu, as read on this node. vram truth: nvidia-smi > driver registry (the
 *  AdapterRAM UInt32 caps at 4095 MB) > AdapterRAM > unknown. */
export interface GpuRead {
  name: string;
  vramMb: number | null;
  vramSource: 'nvidia-smi' | 'registry' | 'adapterram' | 'unknown';
  memUsedMb: number | null;
}

/** A process this node can SEE on the gpu side that nobody booked — information only,
 *  never a rule (the V1 lesson: llama started outside the runner still counts). */
export interface GpuObserved {
  name: string;
  pid: number;
  reason: string;
}

export interface DiskRead {
  device: string;
  freeMb: number;
  totalMb: number;
}

/** A Hydra shared folder on this node (space-gated: it exists when the disk allows).
 *  The register READS these — it does not create or manage them. */
export interface ShareRead {
  label: string | null;
  path: string;
  exists: boolean;
  freeMb: number | null;
  totalMb: number | null;
}

/** THE POLL — a pure read. Asking holds nothing and remembers nothing. */
export interface ResourceReads {
  collectedAt: string;
  node: string;
  platform: string;
  cpu: { model: string; cores: number; loadPct: number | null };
  ram: { totalMb: number; freeMb: number };
  gpus: GpuRead[];
  gpusObserved: GpuObserved[];
  disks: DiskRead[];
  shares: ShareRead[];
  notes: string[];
}

/** A book request — the CALLER chose these resources; the register only checks them. */
export interface BookRequest {
  /** The service this run is (the booking's identity — the scheduler points at it). */
  service: string;
  mode?: string | null;
  /** A gpu by name, exactly as the poll shows it. Whole and pinned — 1 app per gpu. */
  gpu?: string | null;
  cores?: number | null;
  ramMb?: number | null;
  diskMb?: number | null;
  /** Folders this run works in. A booked folder covers its subtree. */
  paths?: string[];
  /** The scheduler's own expectation (recorded as info; null = unknown). */
  expected?: string | null;
  note?: string | null;
  /** Optional run id, when the caller carries one. */
  run?: string | null;
}

export interface Booking {
  id: string;
  service: string;
  mode: string | null;
  gpu: string | null;
  cores: number | null;
  ramMb: number | null;
  diskMb: number | null;
  paths: string[];
  expected: string | null;
  note: string | null;
  run: string | null;
  bookedAt: string;
}

export interface EndedBooking extends Booking {
  endedAt: string;
  endReason: 'popped' | 'cleared';
}

export interface BookingBlocker {
  kind: 'gpu' | 'cores' | 'ram' | 'disk' | 'path';
  detail: string;
  /** The booking in the way, when a single one is responsible (the wait info). */
  heldBy: { id: string; service: string; since: string } | null;
}

export interface BookRefusal {
  ok: false;
  error: {
    code: 'double_booked' | 'missing_resource' | 'invalid_book' | 'no_such_booking';
    message: string;
    blockers: BookingBlocker[];
  };
}

export interface BookSuccess {
  ok: true;
  booking: Booking;
}

export type BookOutcome = BookSuccess | BookRefusal;

export interface ReadingsTotals {
  cores: number;
  ramMb: number;
  diskFreeMb: number;
}

// --- Function Definitions ---

/** Paths compare case-insensitively (Windows) and without a trailing separator. */
export function normalizePath(input: string): string {
  let p = String(input ?? '').trim().replace(/\\/g, '/');
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/** A booked folder covers its subtree: equal paths collide, and so does ancestor/child. */
export function pathsCollide(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/');
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Validate a raw book request. Amounts are whole/free numbers ≥ 0; service required. */
export function validateBookRequest(raw: unknown): { ok: true; request: BookRequest } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'the book request must be a JSON object' };
  const body = raw as Record<string, unknown>;

  const service = asTrimmedString(body.service);
  if (!service) return { ok: false, message: 'service is required — a booking always sources from a request to run a service' };

  const request: BookRequest = { service };
  request.mode = asTrimmedString(body.mode);
  request.gpu = asTrimmedString(body.gpu);
  request.expected = asTrimmedString(body.expected);
  request.note = asTrimmedString(body.note);
  request.run = asTrimmedString(body.run);

  for (const key of ['cores', 'ramMb', 'diskMb'] as const) {
    const amount = asAmount(body[key]);
    if (amount !== null && (amount < 0 || !Number.isFinite(amount))) {
      return { ok: false, message: `${key} must be a number ≥ 0` };
    }
    request[key] = amount;
  }

  if (body.paths !== undefined && body.paths !== null) {
    if (!Array.isArray(body.paths)) return { ok: false, message: 'paths must be an array of absolute paths' };
    const paths: string[] = [];
    for (const item of body.paths) {
      const path = asTrimmedString(item);
      if (!path) return { ok: false, message: 'every path must be a non-empty string' };
      paths.push(path);
    }
    request.paths = paths;
  } else {
    request.paths = [];
  }

  const hasAnyResource =
    request.gpu !== null || (request.cores ?? 0) > 0 || (request.ramMb ?? 0) > 0 || (request.diskMb ?? 0) > 0 || (request.paths?.length ?? 0) > 0;
  if (!hasAnyResource) return { ok: false, message: 'nothing to book — name a gpu, an amount of cores/ramMb/diskMb, or paths' };

  return { ok: true, request };
}

/** The totals amount-bookings compare against (cores and ram come from the machine itself). */
export function totalsOf(readings: ResourceReads): ReadingsTotals {
  let diskFreeMb = 0;
  for (const disk of readings.disks ?? []) diskFreeMb += Number.isFinite(disk.freeMb) ? disk.freeMb : 0;
  return {
    cores: Number.isFinite(readings.cpu?.cores) ? readings.cpu.cores : 0,
    ramMb: Number.isFinite(readings.ram?.totalMb) ? readings.ram.totalMb : 0,
    diskFreeMb,
  };
}

/** A one-line human shape of a booking, for tables and logs. */
export function summarizeBooking(booking: Booking | EndedBooking): string {
  const bits: string[] = [];
  if (booking.gpu) bits.push(`gpu ${booking.gpu}`);
  if (booking.cores) bits.push(`${booking.cores} cores`);
  if (booking.ramMb) bits.push(`${booking.ramMb} MB ram`);
  if (booking.diskMb) bits.push(`${booking.diskMb} MB disk`);
  if (booking.paths.length) bits.push(booking.paths.join(' · '));
  return bits.join(' · ');
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  ok('normalize: slashes and case fold', normalizePath('C:\\Work\\Proj\\') === 'c:/work/proj');
  ok('normalize: trailing separators drop', normalizePath('C:/work/proj//') === 'c:/work/proj');

  ok('collide: equal paths', pathsCollide('C:\\work\\proj', 'c:/WORK/proj'));
  ok('collide: child is covered (children assumed)', pathsCollide('C:/work/proj', 'C:/work/proj/src/main.ts'));
  ok('collide: ancestor direction also', pathsCollide('C:/work/proj/src', 'C:/work/proj'));
  ok('collide: siblings do not collide', !pathsCollide('C:/work/proj', 'C:/work/proj2'));
  ok('collide: unrelated do not collide', !pathsCollide('C:/a', 'D:/b'));
  ok('collide: prefix-but-not-child does not collide', !pathsCollide('C:/work/pro', 'C:/work/proj'));

  const good = validateBookRequest({ service: 'image-gen', mode: 'krea2', gpu: 'AMD Radeon RX 6800', cores: 4, ramMb: 8000, paths: ['C:\\work\\out'] });
  ok('validate: a full request passes', good.ok === true && good.ok && good.request.service === 'image-gen' && good.request.paths?.length === 1);
  const noService = validateBookRequest({ cores: 2 });
  ok('validate: service is required', noService.ok === false && !noService.ok && noService.message.includes('service'));
  const negative = validateBookRequest({ service: 'x', cores: -1 });
  ok('validate: negative amounts refused', negative.ok === false);
  const nothing = validateBookRequest({ service: 'x' });
  ok('validate: nothing to book refused', nothing.ok === false && !nothing.ok && nothing.message.includes('nothing to book'));
  const badPaths = validateBookRequest({ service: 'x', paths: 'C:/one' });
  ok('validate: paths must be an array', badPaths.ok === false);

  const totals = totalsOf({
    collectedAt: '', node: '', platform: '',
    cpu: { model: 'x', cores: 16, loadPct: 10 },
    ram: { totalMb: 32000, freeMb: 20000 },
    gpus: [], gpusObserved: [], notes: [],
    disks: [{ device: 'C:', freeMb: 1000, totalMb: 2000 }, { device: 'D:', freeMb: 500, totalMb: 9000 }],
    shares: [],
  });
  ok('totals: cores · ram · disk free sum', totals.cores === 16 && totals.ramMb === 32000 && totals.diskFreeMb === 1500);

  const summary = summarizeBooking({
    id: 'bk-1', service: 'demo', mode: null, gpu: 'RX 6800', cores: 4, ramMb: 8000, diskMb: null,
    paths: ['C:/work'], expected: null, note: null, run: null, bookedAt: '',
  });
  ok('summarize: names what is held', summary.includes('RX 6800') && summary.includes('4 cores') && summary.includes('C:/work'));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[resourceSchema] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
