/**
 * The only two things Core does on the wire: register into its own State, and pull a peer's.
 *
 * Every call carries a hard timeout. A pull that waits on a dead TCP connect is how a menu hangs, so the
 * timeout is the feature, not a safety net.
 */

async function withTimeout(url, init = {}, timeoutMs = 600) {
  const ctl = new AbortController();
  let t = null;
  // abort() asks; this race enforces. A destroyed socket can leave fetch pending forever, and the tick must not
  // hang on a dead peer.
  const hardStop = new Promise((resolve) => {
    t = setTimeout(() => {
      ctl.abort();
      resolve({ ok: false, status: 0, body: null, error: 'timeout' });
    }, timeoutMs);
  });
  const work = (async () => {
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      return { ok: res.ok, status: res.status, body };
    } catch (error) {
      return { ok: false, status: 0, body: null, error: error.name === 'AbortError' ? 'timeout' : String(error.message) };
    }
  })();
  try {
    return await Promise.race([work, hardStop]);
  } finally {
    clearTimeout(t);
  }
}

export async function register(base, name, content, extra = {}, timeoutMs = 800) {
  return withTimeout(
    `${base}/api/state/register`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, content, ...extra }) },
    timeoutMs,
  );
}

export async function pull(base, name, marks = null, timeoutMs = 600) {
  const q = new URLSearchParams({ name });
  if (marks) q.set('marks', JSON.stringify(marks));
  return withTimeout(`${base}/api/state/pull?${q.toString()}`, {}, timeoutMs);
}

export async function activeSet(base, timeoutMs = 600) {
  return withTimeout(`${base}/api/state`, {}, timeoutMs);
}

export async function getJson(url, timeoutMs = 600) {
  return withTimeout(url, {}, timeoutMs);
}

export async function drop(base, name, timeoutMs = 600) {
  return withTimeout(`${base}/api/state/drop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }, timeoutMs);
}
