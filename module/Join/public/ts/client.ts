/**
 * @module client
 * @description THE CLIENT — one ES module an app imports instead of guessing ports. It is
 *              the same client the page uses, so the browser cannot drift from the API.
 * @intent A limited agent should never need to know a port to find a thing. Import this,
 *              call resolve() with a NAME, and get an answer that distinguishes up ·
 *              starting · offered · absent.
 */

import http from 'node:http';

// --- Interface Definitions ---

export interface JoinClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

// --- Function Definitions ---

const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T;

export class JoinClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: JoinClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:8131').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    return jsonOf<T>(res);
  }

  /** Everything this node has: modules (should + is, kept apart) and the offered catalog. */
  shelf<T = unknown>(): Promise<T> {
    return this.get<T>('/api/shelf');
  }

  /**
   * Resolve ONE name. A 404 is a real answer here (genuinely absent) and comes back with
   * the alternatives — so this never dead-ends.
   */
  async resolve<T = unknown>(name: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/resolve/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return jsonOf<T>(res);
  }

  health<T = unknown>(): Promise<T> {
    return this.get<T>('/health');
  }
}

export function createJoinClient(options: JoinClientOptions = {}): JoinClient {
  return new JoinClient(options);
}

// --- Function Definitions (tests) ---

/** Drive the client against a REAL server on an ephemeral port. */
export function runTests(): void {
  let server: import('node:http').Server | undefined;

  const up = http.createServer((rq, rs) => {
    // the 404 branch must set the code ONCE - writing headers twice is a real crash,
    // and it is the stub's bug, not the client's
    const url = rq.url ?? '';
    if (url.startsWith('/api/resolve/State')) {
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ ok: true, name: 'State', found: true, port: 8127, liveness: 'up' }));
    } else if (url.startsWith('/api/resolve/')) {
      rs.writeHead(404, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ ok: false, found: false, liveness: 'absent', alternatives: ['State'] }));
    } else {
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ ok: true, modules: [], offered: [] }));
    }
  });

  void (async () => {
    try {
      await new Promise<void>(r => up.listen(0, '127.0.0.1', () => r()));
      server = up;
      const port = (up.address() as { port: number }).port;
      const c = createJoinClient({ baseUrl: `http://127.0.0.1:${port}` });

      const h = await c.health<{ ok: boolean }>();
      console.assert(h.ok === true, 'the client reads health from a real door', String(h.ok));

      const s = await c.shelf<{ modules: unknown[] }>();
      console.assert(Array.isArray(s.modules), 'the client reads the shelf', String(Array.isArray(s.modules)));

      const found = await c.resolve<{ found: boolean; port: number }>('State');
      console.assert(found.found === true && found.port === 8127, 'a found name comes back whole', JSON.stringify(found));

      // a 404 is a REAL answer here and must not throw - it carries the alternatives
      const absent = await c.resolve<{ found: boolean; alternatives: string[] }>('Nope');
      console.assert(absent.found === false && absent.alternatives.includes('State'),
        'a refusal arrives as data with its alternatives, not as an exception', JSON.stringify(absent.alternatives));

      // a name needing encoding survives the round trip
      const odd = await c.resolve<{ found: boolean }>('two words');
      console.assert(odd.found === false, 'a name with a space is encoded, not mangled', String(odd.found));
    } catch (e) {
      console.assert(false, 'the client suite ran without a crash', e instanceof Error ? e.message : String(e));
    } finally {
      if (server) server.close();
    }
  })();
}