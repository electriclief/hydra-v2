const DEFAULT_BASE = "http://127.0.0.1:8134";
class SessionClient {
  base;
  ttlMs;
  timeoutMs;
  probedAt = 0;
  up = false;
  constructor(options = {}) {
    this.base = (options.base ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.ttlMs = options.ttlMs ?? 15e3;
    this.timeoutMs = options.timeoutMs ?? 1200;
  }
  async json(pathName) {
    try {
      const response = await fetch(this.base + pathName, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
  /** Is the session door answering? Cached for `ttlMs`; false is a fact, not an error. */
  async probe() {
    const now = Date.now();
    if (this.probedAt !== 0 && now - this.probedAt < this.ttlMs) return this.up;
    const health = await this.json("/health");
    this.up = health?.ok === true && health?.door === "SessionDiary";
    this.probedAt = now;
    return this.up;
  }
  /** One ref -> one card. A missing/down door is reported, never thrown. */
  async card(ref) {
    if (!await this.probe()) return { ref, ok: false, reason: "session door not answering on " + this.base };
    const payload = await this.json(
      `/api/sessions/${encodeURIComponent(ref)}`
    );
    if (!payload || payload.ok !== true) return { ref, ok: false, reason: "no session with ref " + ref };
    const card = payload.card ?? payload.session ?? {};
    return {
      ref,
      ok: true,
      id: typeof card.id === "string" ? card.id : void 0,
      title: typeof card.title === "string" ? card.title : void 0,
      goal: typeof card.goal === "string" ? card.goal : void 0,
      outcome: typeof card.outcome === "string" ? card.outcome : void 0,
      source: typeof card.source === "string" ? card.source : void 0,
      model: typeof card.model === "string" ? card.model : void 0,
      startedAt: typeof card.startedAt === "number" ? card.startedAt : void 0,
      messages: typeof card.messageCount === "number" ? card.messageCount : typeof card.messages === "number" ? card.messages : void 0,
      toolCalls: typeof card.toolCallCount === "number" ? card.toolCallCount : typeof card.toolCalls === "number" ? card.toolCalls : void 0
    };
  }
  /** Many refs, sequentially — one door, and a burst of parallel sockets helps nobody. */
  async cards(refs) {
    const out = [];
    for (const ref of refs) out.push(await this.card(ref));
    return out;
  }
}
export {
  SessionClient
};
//# sourceMappingURL=sessionClient.js.map
