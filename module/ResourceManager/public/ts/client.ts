/**
 * @module client
 * @description The ES-module client for the API — fetch in Node or the browser, API
 *              errors thrown as RmError carrying the server's own code. One implementation
 *              for both, so the page and the tests cannot drift. A book REFUSAL is not an
 *              error: it comes back as a normal outcome with ok:false (the wait info) — the
 *              client only throws for real API errors.
 * @intent The page imports the SAME client the tests use — one implementation, no drift.
 */

import type { Booking, BookOutcome, BookRequest, EndedBooking, ResourceReads } from './resourceSchema.js';

// --- Interface Definitions ---

export interface RmClientOptions {
  baseUrl?: string;
  token?: string | null;
}

export interface RmResourcesView {
  ok: boolean;
  resources: ResourceReads;
  bookings: Booking[];
}

export interface RmBookingsView {
  ok: boolean;
  active: Booking[];
  ended?: EndedBooking[];
}

export interface RmBookingView {
  ok: boolean;
  booking: Booking | EndedBooking;
}

export interface RmClient {
  health(): Promise<Record<string, unknown>>;
  resources(refresh?: boolean): Promise<RmResourcesView>;
  bookings(includeEnded?: boolean): Promise<RmBookingsView>;
  getBooking(id: string): Promise<RmBookingView>;
  /** The one write — a refusal returns ok:false, it never throws. */
  book(request: BookRequest): Promise<BookOutcome>;
  pop(id: string): Promise<RmBookingView>;
  clear(id: string): Promise<RmBookingView>;
}

export class RmError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'RmError';
    this.code = code;
    this.status = status;
  }
}

// --- Function Definitions ---

export function createRmClient(options: RmClientOptions = {}): RmClient {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8129').replace(/\/+$/, '');
  const token = options.token ?? null;

  async function api<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(baseUrl + pathName);
    if (token) url.searchParams.set('token', token);
    const res = await fetch(url, init);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new RmError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'http_error', res.status);
    }
    return data as T;
  }

  return {
    health: () => api<Record<string, unknown>>('/health'),

    resources: (refresh = false) =>
      refresh
        ? api<RmResourcesView>('/api/resources/refresh', { method: 'POST' })
        : api<RmResourcesView>('/api/resources'),

    bookings: (includeEnded = false) => api<RmBookingsView>('/api/bookings' + (includeEnded ? '?include=ended' : '')),

    getBooking: (id) => api<RmBookingView>('/api/bookings/' + encodeURIComponent(id)),

    book: (request) =>
      api<BookOutcome>('/api/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),

    pop: (id) => api<RmBookingView>('/api/bookings/' + encodeURIComponent(id) + '/pop', { method: 'POST' }),

    clear: (id) => api<RmBookingView>('/api/bookings/' + encodeURIComponent(id) + '/clear', { method: 'POST' }),
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createBookingStore } = await import('./bookingStore.js');
  const { startApiServer } = await import('./apiServer.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-client-'));
  const fakeReads = {
    collectedAt: new Date().toISOString(),
    node: 'test-node',
    platform: 'win32',
    cpu: { model: 'fake', cores: 8, loadPct: 1 },
    ram: { totalMb: 16000, freeMb: 9000 },
    gpus: [{ name: 'RX 6800', vramMb: 16384, vramSource: 'registry' as const, memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [],
    notes: [],
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const api = await startApiServer({ store, reads: () => fakeReads, port: 0, publicDir: path.join(process.cwd(), 'public') });
  const client = createRmClient({ baseUrl: api.url });

  const health = (await client.health()) as { ok?: boolean; module?: string };
  ok('health through the client', health.ok === true && health.module === 'resource-manager');

  const view = await client.resources();
  ok('the poll through the client', view.ok === true && view.resources.cpu.cores === 8 && Array.isArray(view.bookings));

  const booked = await client.book({ service: 'image-gen', gpu: 'RX 6800', cores: 4 });
  ok('book through the client lands', booked.ok === true && booked.ok && booked.booking.id.startsWith('bk-'));

  const refused = await client.book({ service: 'other', gpu: 'RX 6800' });
  ok('a refusal returns ok:false without throwing', refused.ok === false && !refused.ok && refused.error.code === 'double_booked');
  ok('the refusal carries the wait info', refused.ok === false && !refused.ok && refused.error.blockers.length > 0);

  const list = await client.bookings(true);
  ok('bookings through the client', list.active.length === 1 && Array.isArray(list.ended));

  const bookedId = booked.ok ? booked.booking.id : 'none';
  const one = await client.getBooking(bookedId);
  ok('getBooking by id', one.ok === true && (one.booking as { service: string }).service === 'image-gen');

  const popped = await client.pop(bookedId);
  ok('pop through the client', popped.ok === true && (popped.booking as { endReason: string }).endReason === 'popped');

  let threw: RmError | null = null;
  try {
    await client.pop('bk-nope');
  } catch (err) {
    threw = err instanceof RmError ? err : null;
  }
  ok('an unknown booking throws with the server code', threw !== null && threw.code === 'no_such_booking', threw ? threw.code : 'no throw');

  const cleared = await client.book({ service: 'third', paths: ['C:/elsewhere'] });
  ok('a paths-only booking is legal (file work, no gpu)', cleared.ok === true);
  const clearedId = cleared.ok ? cleared.booking.id : 'none';
  const clearedEnd = await client.clear(clearedId);
  ok('clear through the client', clearedEnd.ok === true && (clearedEnd.booking as { endReason: string }).endReason === 'cleared');

  const refreshed = await client.resources(true);
  ok('the forced refresh reads through the client', refreshed.ok === true && refreshed.resources.collectedAt.length > 0);

  await api.stop();

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[client] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
