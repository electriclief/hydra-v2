const clean = (base) => String(base || "").replace(/\/+$/, "");
async function relayPull(to, name, via = [], timeoutMs = 900, hops = 0) {
  const base = clean(to);
  if (!base) return { ok: false, value: null, source: base, hops, via, why: "absent" };
  if (via.includes(base)) return { ok: false, value: null, source: base, hops, via: [...via, base], why: "cycle" };
  const params = new URLSearchParams({ name, follow: "1", via: [...via, base].join(",") });
  const url = `${base}/api/state/pull?${params.toString()}`;
  const ctl = new AbortController();
  let timer = null;
  const hardStop = new Promise((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      const res = await fetch(url, { signal: ctl.signal });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return { kind: "unreachable" };
      }
      if (!res.ok || !body || body.ok !== true) {
        const code = String(body?.error?.code || "");
        return { kind: code === "no_such_entry" ? "absent" : "unreachable" };
      }
      return { kind: "ok", body };
    } catch (error) {
      return { kind: error?.name === "AbortError" ? "timeout" : "unreachable" };
    }
  })();
  try {
    const settled = await Promise.race([work, hardStop]);
    if (settled.kind !== "ok") {
      return { ok: false, value: null, source: base, hops: hops + 1, via: [...via, base], why: settled.kind };
    }
    const body = settled.body;
    return {
      ok: true,
      value: body.content ?? null,
      source: base,
      hops: typeof body.hops === "number" ? body.hops : hops + 1,
      via: Array.isArray(body.via) && body.via.length ? body.via : [...via, base],
      full: body.full !== false,
      marks: body.marks && typeof body.marks === "object" ? body.marks : {},
      name: typeof body.name === "string" ? body.name : name,
      at: typeof body.at === "string" ? body.at : void 0
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export {
  relayPull
};
//# sourceMappingURL=relay.js.map
