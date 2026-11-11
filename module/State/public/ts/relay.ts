/**
 * A link's only verb: ask whatever the link points at.
 *
 * The "auto-resolver" lives with State so a caller can ask ANY State ANY path and never has to know where the answer
 * lives. But a link does not have to point at another State: it can point at an APP's adapter, and that is how a
 * console program becomes part of the LAN's state. Two protocols, tried in order:
 *
 *   1. `/api/state/pull` — the registry protocol. Authoritative: if a State says `no_such_entry`, that is an honest
 *                          absence and it is final.
 *   2. `/api/resolve`    — the adapter protocol, tried only when the target is clearly not a registry (404/no_route
 *                          or a non-JSON page). An adapter answers {ok,name,content} or {ok:false,why}, and `stale`
 *                          or `gone` are absences too — never a cached number passed off as live.
 *
 * Two rules, both learned the hard way:
 *   1. abort() asks; a race enforces. A destroyed socket can leave fetch pending forever, so the timeout is a
 *      promise raced against the work, not a signal we hope gets honoured.
 *   2. the chain travels with the request. `via` comes back in the answer and is passed onward, so a link that
 *      points back at one already walked is refused instead of looping.
 */

export interface RelayReply {
  ok: boolean;
  /** What the far registry answered (or null when it refused). */
  value: unknown;
  /** The base that actually answered. */
  source: string;
  /** How many links were followed to get here. */
  hops: number;
  /** Every base walked, in order, ending with the one that answered. */
  via: string[];
  /** When it failed: absent | unreachable | timeout | cycle. */
  why?: string;
  at?: string;
  full?: boolean;
  marks?: Record<string, number | string>;
  /** The name the far side resolved it to. */
  name?: string;
  /** Which protocol answered: `state` for a registry, `resolve` for an app adapter. */
  proto?: 'state' | 'resolve';
}

const clean = (base: string): string => String(base || '').replace(/\/+$/, '');

type Attempt =
  | { kind: 'ok'; body: any }
  | { kind: 'absent'; why?: string }
  | { kind: 'timeout' }
  | { kind: 'unreachable' }
  | { kind: 'wrong_protocol' };

/** One request, one timeout, one typed result. `notState` marks the reply as "this is not a registry at all". */
async function ask(url: string, timeoutMs: number, notState: (status: number, body: any) => boolean): Promise<Attempt> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hardStop = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });

  const work = (async (): Promise<Attempt> => {
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return { kind: 'wrong_protocol' }; // a menu page is not an answer to a state question
      }
      if (notState(res.status, body)) return { kind: 'wrong_protocol' };
      if (!res.ok || !body || body.ok !== true) {
        const code = String(body?.error?.code || '');
        const why = typeof body?.why === 'string' ? body.why : code === 'no_such_entry' ? 'absent' : 'unreachable';
        return { kind: 'absent', why };
      }
      return { kind: 'ok', body };
    } catch (error: any) {
      return { kind: error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
    }
  })();

  try {
    return await Promise.race([work, hardStop]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function relayPull(
  to: string,
  name: string,
  via: string[] = [],
  timeoutMs = 900,
  hops = 0,
): Promise<RelayReply> {
  const base = clean(to);
  if (!base) return { ok: false, value: null, source: base, hops, via, why: 'absent' };
  if (via.includes(base)) return { ok: false, value: null, source: base, hops, via: [...via, base], why: 'cycle' };

  const chain = [...via, base];
  const node = `${base}/api/state/pull?${new URLSearchParams({ name, follow: '1', via: chain.join(',') }).toString()}`;
  // "not a registry" on a 404 means anything except a registry's own honest "no_such_entry". An adapter that
  // answers {ok:false, why:"no_route"} (AppPlug's shape) must fall through to the adapter protocol, not be read as
  // an absence — that mistake made every app namespace look empty.
  const first = await ask(node, timeoutMs, (status, body) => status === 404 && String(body?.error?.code || "") !== "no_such_entry");

  if (first.kind === 'ok') {
    const body = first.body;
    return {
      ok: true,
      value: body.content ?? null,
      source: base,
      hops: typeof body.hops === 'number' ? body.hops : hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : chain,
      full: body.full !== false,
      marks: body.marks && typeof body.marks === 'object' ? body.marks : {},
      name: typeof body.name === 'string' ? body.name : name,
      at: typeof body.at === 'string' ? body.at : undefined,
      proto: 'state',
    };
  }
  if (first.kind === 'absent') {
    // a registry answered and said no. Final, and honest: a second protocol would turn "I do not have it" into
    // "let me guess by another route".
    return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: first.why || 'absent', proto: 'state' };
  }
  if (first.kind === 'timeout') return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: 'timeout' };
  if (first.kind === 'unreachable') return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: 'unreachable' };

  // not a registry — try the adapter protocol before calling it unreachable
  const app = await ask(`${base}/api/resolve?name=${encodeURIComponent(name)}`, timeoutMs, () => false);
  if (app.kind === 'ok') {
    const body = app.body;
    return {
      ok: true,
      value: body.content ?? body.value ?? null,
      source: base,
      hops: hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : chain,
      full: true,
      marks: {},
      name: typeof body.name === 'string' ? body.name : name,
      at: typeof body.at === 'string' ? body.at : undefined,
      proto: 'resolve',
    };
  }
  if (app.kind === 'absent') return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: app.why || 'absent', proto: 'resolve' };
  return { ok: false, value: null, source: base, hops: hops + 1, via: chain, why: app.kind === 'timeout' ? 'timeout' : 'unreachable' };
}

/**
 * The gate. A registry, an adapter, and a liar — the three things a link can point at.
 *
 * Case 4 is the one worth keeping: a registry that says "no such entry" must NOT be re-asked on the adapter
 * protocol. Otherwise every honest absence in the LAN becomes a guess.
 */
export async function runTests(): Promise<void> {
  const { createServer } = await import('node:http');

  const serve = (handler: (url: URL, res: any) => void): Promise<{ base: string; close: () => Promise<void> }> =>
    new Promise((resolve) => {
      const server = createServer((req, res) => handler(new URL(req.url || '/', 'http://x'), res));
      server.listen(0, '127.0.0.1', () =>
        resolve({
          base: `http://127.0.0.1:${(server.address() as any).port}`,
          close: () => new Promise<void>((r) => server.close(() => r())),
        }),
      );
    });

  const json = (res: any, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  // 1. a registry
  const registry = await serve((url, res) => {
    if (url.pathname === '/api/state/pull') return json(res, 200, { ok: true, name: url.searchParams.get('name'), content: { cycle: 7 } });
    return json(res, 404, { ok: false, error: { code: 'no_route' } });
  });
  const viaState = await relayPull(registry.base, 'node.x.cycle');
  console.assert(viaState.ok && viaState.proto === 'state', 'a registry answers on the registry protocol');
  console.assert((viaState.value as any)?.cycle === 7, 'the registry answer is the value');
  await registry.close();

  // 2. an app adapter: no registry route at all, but /api/resolve works
  const adapter = await serve((url, res) => {
    if (url.pathname === '/api/resolve') return json(res, 200, { ok: true, name: url.searchParams.get('name'), content: { pct: 42 }, at: 'now' });
    // exactly what AppPlug answers for a route it does not have: {ok:false, why:'no_route'}, no error.code
    return json(res, 404, { ok: false, why: 'no_route', detail: '/api/state/pull is not a route here' });
  });
  const viaApp = await relayPull(adapter.base, 'foo_bar.progress');
  console.assert(viaApp.ok && viaApp.proto === 'resolve', 'an app adapter answers on the adapter protocol');
  console.assert((viaApp.value as any)?.pct === 42, 'the adapter answer is the value');
  await adapter.close();

  // 3. an adapter that says the number is stale: a typed absence, not last week's percentage
  const stale = await serve((url, res) => {
    if (url.pathname === '/api/resolve') return json(res, 200, { ok: false, why: 'stale', name: url.searchParams.get('name') });
    return json(res, 404, { ok: false, error: { code: 'no_route' } });
  });
  const viaStale = await relayPull(stale.base, 'foo_bar.progress');
  console.assert(viaStale.ok === false && viaStale.why === 'stale', 'an adapter absence keeps its own reason');
  await stale.close();

  // 4. a registry that honestly does not have it must not be re-asked elsewhere
  let adapterHits = 0;
  const picky = await serve((url, res) => {
    if (url.pathname === '/api/state/pull') return json(res, 404, { ok: false, error: { code: 'no_such_entry' } });
    adapterHits += 1;
    return json(res, 200, { ok: true, content: 'should never be reached' });
  });
  const viaPicky = await relayPull(picky.base, 'node.x.nope');
  console.assert(viaPicky.ok === false && viaPicky.why === 'absent', 'a registry absence is final');
  console.assert(adapterHits === 0, 'the adapter protocol is not tried after an honest registry absence');
  await picky.close();

  // 5. a page that is not an answer at all
  const page = await serve((_url, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>studio menu</html>');
  });
  const viaPage = await relayPull(page.base, 'x.y');
  console.assert(viaPage.ok === false && viaPage.why === 'unreachable', 'a web page is not a state answer');
  await page.close();

  // 6. the loop guard still holds
  const loop = await relayPull('http://127.0.0.1:9', 'x.y', ['http://127.0.0.1:9']);
  console.assert(loop.ok === false && loop.why === 'cycle', 'a link back to one already walked is refused');

  // 7. nothing listening is unreachable, not absent
  const dead = await relayPull('http://127.0.0.1:9', 'x.y', [], 400);
  console.assert(dead.ok === false && (dead.why === 'unreachable' || dead.why === 'timeout'), 'a dead port is unreachable or timeout');
}
