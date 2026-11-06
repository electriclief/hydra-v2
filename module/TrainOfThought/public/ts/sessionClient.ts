/**
 * The session-manager dependency — LAZY, and over HTTP only.
 *
 * TrainOfThought never imports SessionDiary's code. A thought's trail carries plain 8-hex refs, so
 * the evidence outlives the dependency; this client only turns those refs into titles/goals while
 * the door on :8134 is answering. If it is down, every call resolves to `ok:false` with a reason and
 * nothing throws — the DAG, the frontier and the archive stay fully usable.
 *
 * The probe is cached for a few seconds so a list of 200 nodes does not become 200 socket attempts.
 */

export interface SessionCard {
  ref: string;
  ok: boolean;
  id?: string;
  title?: string;
  goal?: string;
  outcome?: string;
  source?: string;
  model?: string;
  startedAt?: number;
  messages?: number;
  toolCalls?: number;
  reason?: string;
}

export interface SessionClientOptions {
  base?: string;
  /** How long a probe result is trusted. */
  ttlMs?: number;
  /** Per-request timeout — the diary answers in ms or not at all. */
  timeoutMs?: number;
}

const DEFAULT_BASE = 'http://127.0.0.1:8134';

export class SessionClient {
  readonly base: string;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private probedAt = 0;
  private up = false;

  constructor(options: SessionClientOptions = {}) {
    this.base = (options.base ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.ttlMs = options.ttlMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 1200;
  }

  private async json<T>(pathName: string): Promise<T | null> {
    try {
      const response = await fetch(this.base + pathName, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  /** Is the session door answering? Cached for `ttlMs`; false is a fact, not an error. */
  async probe(): Promise<boolean> {
    const now = Date.now();
    if (this.probedAt !== 0 && now - this.probedAt < this.ttlMs) return this.up;
    const health = await this.json<{ ok?: boolean; door?: string }>('/health');
    this.up = health?.ok === true && health?.door === 'SessionDiary';
    this.probedAt = now;
    return this.up;
  }

  /** One ref -> one card. A missing/down door is reported, never thrown. */
  async card(ref: string): Promise<SessionCard> {
    if (!(await this.probe())) return { ref, ok: false, reason: 'session door not answering on ' + this.base };
    const payload = await this.json<{ ok?: boolean; card?: Record<string, unknown>; session?: Record<string, unknown> }>(
      `/api/sessions/${encodeURIComponent(ref)}`,
    );
    if (!payload || payload.ok !== true) return { ref, ok: false, reason: 'no session with ref ' + ref };
    const card = (payload.card ?? payload.session ?? {}) as Record<string, unknown>;
    return {
      ref,
      ok: true,
      id: typeof card.id === 'string' ? card.id : undefined,
      title: typeof card.title === 'string' ? card.title : undefined,
      goal: typeof card.goal === 'string' ? card.goal : undefined,
      outcome: typeof card.outcome === 'string' ? card.outcome : undefined,
      source: typeof card.source === 'string' ? card.source : undefined,
      model: typeof card.model === 'string' ? card.model : undefined,
      startedAt: typeof card.startedAt === 'number' ? card.startedAt : undefined,
      messages: typeof card.messageCount === 'number' ? card.messageCount : typeof card.messages === 'number' ? card.messages : undefined,
      toolCalls: typeof card.toolCallCount === 'number' ? card.toolCallCount : typeof card.toolCalls === 'number' ? card.toolCalls : undefined,
    };
  }

  /** Many refs, sequentially — one door, and a burst of parallel sockets helps nobody. */
  async cards(refs: string[]): Promise<SessionCard[]> {
    const out: SessionCard[] = [];
    for (const ref of refs) out.push(await this.card(ref));
    return out;
  }
}
