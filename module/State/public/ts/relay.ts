/**
 * A link's only verb: ask the registry it points at. This is the "auto-resolver" — it lives with State so that a
 * caller can ask ANY State ANY path and never has to know where the answer lives.
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
  /** The name the far registry resolved it to. */
  name?: string;
}

const clean = (base: string): string => String(base || '').replace(/\/+$/, '');

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

  const params = new URLSearchParams({ name, follow: '1', via: [...via, base].join(',') });
  const url = `${base}/api/state/pull?${params.toString()}`;

  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hardStop = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ kind: 'timeout' });
    }, timeoutMs);
  });

  const work = (async () => {
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return { kind: 'unreachable' as const };
      }
      if (!res.ok || !body || body.ok !== true) {
        const code = String(body?.error?.code || '');
        return { kind: (code === 'no_such_entry' ? 'absent' : 'unreachable') as 'absent' | 'unreachable' };
      }
      return { kind: 'ok' as const, body };
    } catch (error: any) {
      return { kind: (error?.name === 'AbortError' ? 'timeout' : 'unreachable') as 'timeout' | 'unreachable' };
    }
  })();

  try {
    const settled = await Promise.race([work, hardStop]);
    if (settled.kind !== 'ok') {
      return { ok: false, value: null, source: base, hops: hops + 1, via: [...via, base], why: settled.kind };
    }
    const body = (settled as { body: any }).body;
    return {
      ok: true,
      value: body.content ?? null,
      source: base,
      hops: typeof body.hops === 'number' ? body.hops : hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : [...via, base],
      full: body.full !== false,
      marks: body.marks && typeof body.marks === 'object' ? body.marks : {},
      name: typeof body.name === 'string' ? body.name : name,
      at: typeof body.at === 'string' ? body.at : undefined,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
