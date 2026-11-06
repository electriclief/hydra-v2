/**
 * @module doors
 * @description THE FIVE DOORS Basic_App talks through — thin fetch clients, one per
 *              module: services (the definitions + the two pages) · pw (ProcessWrapper:
 *              launch · table · output copy · kill) · rm (the Register: refresh · book ·
 *              pop) · state (variable storage: register · pull · drop). The Event_Handler
 *              rides in-process (the shell's hand), so it is not a door here.
 *              Nothing here decides anything — the callers carry all meaning.
 * @intent Basic_App is GENERIC: it loads "available services" having no idea what they
 *         are. The doors are HOW it asks without knowing.
 */

// --- Interface Definitions ---

export interface DoorsConfig {
  servicesUrl: string;
  pwUrl: string;
  rmUrl: string;
  stateUrl: string;
}

export interface ServiceVariable {
  name: string;
  label?: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
  full?: boolean;
  muted?: boolean;
  role?: string;
  [extra: string]: unknown;
}

export interface ServiceSummary {
  name: string;
  what: string;
  provider: string;
  modes: string[];
  karma: number | null;
  ok: boolean;
  file?: string;
  [extra: string]: unknown;
}

export interface ServiceDefinition {
  name: string;
  advert?: { what?: string; time?: string; karma?: number; [k: string]: unknown };
  provider?: { name?: string; repo?: string; launch?: string; probe?: string; update?: string; [k: string]: unknown };
  variables?: { init?: ServiceVariable[]; input?: ServiceVariable[]; files?: unknown[]; [k: string]: unknown };
  modes?: Array<{ name?: string; [k: string]: unknown }>;
  needs?: { gpu?: boolean; vramGb?: number; ramMb?: number; cores?: number; diskGb?: number; [k: string]: unknown };
  output?: { kind?: string; location?: string; description?: string; [k: string]: unknown };
  progress?: { how?: string; source?: string; pattern?: string; note?: string; [k: string]: unknown };
  gui?: { kind?: string; value?: string; note?: string; [k: string]: unknown };
  pages?: { ad?: string; inputs?: string; [k: string]: unknown };
  [extra: string]: unknown;
}

export interface ProcessRecord {
  id: string;
  name: string;
  tag: string | null;
  pid: number | null;
  life: string;
  spawnedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  streamFile?: string;
  error: string | null;
  [extra: string]: unknown;
}

export interface BookingBlocker {
  kind: string;
  detail: string;
  heldBy: { id: string; service: string; since: string } | null;
}

export interface BookOutcome {
  ok: boolean;
  booking?: { id: string; service: string; [k: string]: unknown };
  error?: { code: string; message: string; blockers?: BookingBlocker[] };
}

export interface BookInput {
  service: string;
  gpu?: string | null;
  cores?: number | null;
  ramMb?: number | null;
  diskMb?: number | null;
  paths?: string[];
  note?: string | null;
  run?: string | null;
}

export interface DoorClients {
  services: {
    list(): Promise<{ ok: boolean; services: ServiceSummary[] }>;
    get(name: string): Promise<{ ok: boolean; service: ServiceDefinition; file?: string; warnings?: unknown[] }>;
    page(name: string, half: 'ad' | 'inputs'): Promise<string>;
  };
  pw: {
    launch(body: Record<string, unknown>): Promise<ProcessRecord>;
    get(id: string): Promise<ProcessRecord | null>;
    list(tag?: string): Promise<ProcessRecord[]>;
    output(id: string, from: number): Promise<{ text: string; next: number }>;
    kill(id: string, force?: boolean): Promise<Record<string, unknown>>;
  };
  rm: {
    refresh(): Promise<{ ok: boolean; resources: { gpus?: Array<{ name: string; vramMb: number | null }>; [k: string]: unknown }; [k: string]: unknown }>;
    book(input: BookInput): Promise<BookOutcome>;
    pop(id: string): Promise<Record<string, unknown>>;
  };
  state: {
    register(name: string, content: unknown, extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
    pull(name: string): Promise<unknown>;
    drop(name: string): Promise<Record<string, unknown>>;
  };
}

export class DoorError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'DoorError';
    this.code = code;
    this.status = status;
  }
}

// --- Function Definitions ---

export function createDoors(config: DoorsConfig, fetchImpl: typeof fetch = fetch): DoorClients {
  const base = (u: string) => u.replace(/\/+$/, '');

  async function json<T>(baseUrl: string, pathName: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(base(baseUrl) + pathName, init);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new DoorError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'http_error', res.status);
    }
    return data as T;
  }

  const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  return {
    services: {
      list: () => json<{ ok: boolean; services: ServiceSummary[] }>(config.servicesUrl, '/api/services'),
      get: (name) =>
        json<{ ok: boolean; service: ServiceDefinition; file?: string; warnings?: unknown[] }>(
          config.servicesUrl,
          '/api/services/' + encodeURIComponent(name),
        ),
      page: async (name, half) => {
        const res = await fetchImpl(base(config.servicesUrl) + '/api/services/' + encodeURIComponent(name) + '/' + half);
        const text = await res.text();
        if (!res.ok) throw new DoorError(`no ${half} page for ${name}`, 'no_page', res.status);
        return text;
      },
    },
    pw: {
      launch: async (body) => {
        const data = await json<{ ok?: boolean; process?: ProcessRecord; record?: ProcessRecord }>(
          config.pwUrl,
          '/api/processes',
          post(body),
        );
        const rec = data.process ?? data.record ?? (data as unknown as ProcessRecord);
        return rec;
      },
      get: async (id) => {
        try {
          const data = await json<{ ok?: boolean; process?: ProcessRecord; record?: ProcessRecord }>(
            config.pwUrl,
            '/api/processes/' + encodeURIComponent(id),
          );
          return data.process ?? data.record ?? (data as unknown as ProcessRecord);
        } catch (e) {
          if (e instanceof DoorError && e.status === 404) return null;
          throw e;
        }
      },
      list: async (tag) => {
        const q = tag ? '?tag=' + encodeURIComponent(tag) : '';
        const data = await json<{ ok?: boolean; processes?: ProcessRecord[]; items?: ProcessRecord[] }>(
          config.pwUrl,
          '/api/processes' + q,
        );
        return data.processes ?? data.items ?? [];
      },
      output: async (id, from) => {
        const res = await fetchImpl(
          base(config.pwUrl) + '/api/processes/' + encodeURIComponent(id) + '/output?from=' + Math.max(0, Math.floor(from)),
        );
        const text = await res.text();
        if (!res.ok) throw new DoorError(`no output for ${id}`, 'no_output', res.status);
        const headerTo = Number(res.headers.get('x-pw-to'));
        return { text, next: Number.isFinite(headerTo) && headerTo >= 0 ? headerTo : from + text.length };
      },
      kill: (id, force = false) =>
        json<Record<string, unknown>>(config.pwUrl, '/api/processes/' + encodeURIComponent(id) + '/kill', post({ force })),
    },
    rm: {
      refresh: () => json<never>(config.rmUrl, '/api/resources/refresh', post({})) as Promise<never>,
      book: async (input) => {
        const res = await fetchImpl(base(config.rmUrl) + '/api/book', post(input));
        const text = await res.text();
        let data: unknown = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (data && typeof data === 'object' && 'ok' in (data as Record<string, unknown>)) {
          return data as BookOutcome; // a refusal is a normal outcome — ok:false with the blockers
        }
        const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
        throw new DoorError(err?.message ?? `HTTP ${res.status}`, err?.code ?? 'http_error', res.status);
      },
      pop: (id) => json<Record<string, unknown>>(config.rmUrl, '/api/bookings/' + encodeURIComponent(id) + '/pop', post({})),
    },
    state: {
      register: (name, content, extra) =>
        json<Record<string, unknown>>(config.stateUrl, '/api/state/register', post({ name, content, ...(extra ?? {}) })),
      pull: (name) => json<unknown>(config.stateUrl, '/api/state/pull?name=' + encodeURIComponent(name)),
      drop: (name) => json<Record<string, unknown>>(config.stateUrl, '/api/state/drop', post({ name })),
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL doors :: ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // a scripted fetch: records calls, answers by table
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const answers: Array<{ match: string; status?: number; body?: string; headers?: Record<string, string> }> = [
    { match: '/api/services/demo/ad', body: '<h1>ad</h1>' },
    { match: '/api/services', body: JSON.stringify({ ok: true, services: [{ name: 'demo', ok: true }] }) },
    { match: '/api/processes?tag=basic', body: JSON.stringify({ ok: true, processes: [{ id: 'p1', life: 'running' }] }) },
    { match: '/api/processes/p1/output', body: 'hello', headers: { 'x-pw-to': '5' } },
    { match: '/api/resources/refresh', body: JSON.stringify({ ok: true, resources: { gpus: [{ name: 'RX 6800', vramMb: 16368 }] } }) },
    { match: '/api/book', body: JSON.stringify({ ok: false, error: { code: 'double_booked', message: 'held', blockers: [] } }) },
  ];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = answers.find((a) => u.includes(a.match));
    if (!hit) return new Response('{"error":{"code":"no_route","message":"stub"}}', { status: 404 });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers });
  }) as typeof fetch;

  const doors = createDoors(
    { servicesUrl: 'http://x:1', pwUrl: 'http://x:2', rmUrl: 'http://x:3', stateUrl: 'http://x:4' },
    fakeFetch,
  );

  const list = await doors.services.list();
  ok('services.list answers from its door', list.ok === true && list.services[0].name === 'demo');
  const ad = await doors.services.page('demo', 'ad');
  ok('a page rides out as text', ad === '<h1>ad</h1>');
  const procs = await doors.pw.list('basic');
  ok('pw.list filters by tag in the URL', calls.some((c) => c.url.includes('?tag=basic')) && procs[0].id === 'p1');
  const out = await doors.pw.output('p1', 0);
  ok('an output copy carries the next offset', out.text === 'hello' && out.next === 5);
  const refresh = await doors.rm.refresh();
  ok('rm.refresh reads gpus', (refresh.resources.gpus ?? [])[0]?.name === 'RX 6800');
  const booked = await doors.rm.book({ service: 'demo' });
  ok('a book refusal is a normal outcome, not a throw', booked.ok === false && booked.error?.code === 'double_booked');

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[doors] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}
