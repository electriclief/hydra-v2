/**
 * The broadcast projection - what this node is willing to tell a STRANGER.
 *
 * The broker (and the LAN-to-LAN link after it) does not get the node's full state. It gets a minimal tree:
 * who this is, the cycle it is on, and the services it can make, nested one entry per service. No paths, no
 * model inventories, no logs, no doors this node has not chosen to advertise.
 *
 * Everything in here is derived from entries the node already registered, so the projection cannot drift from
 * what the node says about itself: it is a filter, not a second opinion.
 */

export function minimal(id = {}, cycle = {}, services = {}, at = Date.now()) {
  const out = { ref: id.ref || null, cycle: cycle.cycle ?? null, at: new Date(at).toISOString(), services: {} };

  if (Array.isArray(id.ready_for) && id.ready_for.length) out.ready_for = id.ready_for.slice();
  if (typeof cycle.fillPct === 'number') out.pressure = cycle.fillPct;

  for (const [slug, svc] of Object.entries(services || {})) {
    if (!svc || typeof svc !== 'object') continue;
    // a service that is not ready is still advertised: "I have this, it is not up" is useful to a stranger
    out.services[slug] = {
      name: svc.name || slug,
      provider: svc.provider ?? null,
      karma: svc.karma ?? null,
      ready: svc.ready === true,
      ...(Array.isArray(svc.modes) && svc.modes.length ? { modes: svc.modes.slice() } : {}),
    };
  }

  return out;
}

/** Does the projection leak anything it should not? Used by the gate, so the filter has a test. */
const ALLOWED_ROOT = new Set(['ref', 'cycle', 'at', 'ready_for', 'pressure', 'services']);
const ALLOWED_SERVICE = new Set(['name', 'provider', 'karma', 'ready', 'modes']);

export function leaks(projection) {
  const bad = [];
  for (const key of Object.keys(projection || {})) if (!ALLOWED_ROOT.has(key)) bad.push(key);
  for (const [slug, svc] of Object.entries(projection?.services || {})) {
    for (const key of Object.keys(svc || {})) if (!ALLOWED_SERVICE.has(key)) bad.push(`${slug}.${key}`);
  }
  return bad;
}
