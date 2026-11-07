/**
 * Turning a registry's entries into one node, and a list of registries into a LAN.
 *
 * Input is the shape State actually serves: [{ path, content, ... }]. Nothing here knows about HTTP, so the
 * whole assembly is testable without a network - which matters, because "the menu shows the wrong thing" is
 * almost always an assembly bug, not a transport bug.
 *
 * Path grammar this reader understands (and ignores everything else):
 *   node.<ref>.id
 *   node.<ref>.doors
 *   node.<ref>.cycle
 *   node.<ref>.services.<slug>
 *   node.<ref>.scheduler.booked.<jobId>
 *   node.<ref>.resources.<name>
 *   node.<ref>.health.degraded
 *   node.<ref>.observed.<peer>
 */

export function emptyNode(ref) {
  return {
    ref,
    id: null,
    doors: null,
    cycle: null,
    services: {},
    scheduler: { booked: {} },
    resources: {},
    health: {},
    observed: {},
    standby: null,
    // the shared conversation (thread + monitor): carried, never computed, exactly like standby
    conversation: null,
    unknown: {},
  };
}

/** One registry's entries -> one node object. Later reads win for scalars; services merge per slug. */
export function assemble(entries = [], refHint = null) {
  const nodes = new Map();

  for (const entry of entries || []) {
    const path = String(entry?.path || entry?.name || '');
    const parts = path.split('.').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'node') continue;

    const ref = parts[1];
    const node = nodes.get(ref) || emptyNode(ref);
    nodes.set(ref, node);

    const rest = parts.slice(2);
    const content = entry?.content ?? null;

    if (rest[0] === 'id') node.id = content;
    else if (rest[0] === 'doors') node.doors = content;
    else if (rest[0] === 'cycle') node.cycle = content;
    else if (rest[0] === 'services' && rest[1]) node.services[rest[1]] = content;
    else if (rest[0] === 'services' && !rest[1] && content && typeof content === 'object') {
      // the rollup index: every advertised service in one entry, so a reader needs one pull, not a discovery pass
      for (const [slug, svc] of Object.entries(content.services || {})) node.services[slug] = svc;
    }
    else if (rest[0] === 'scheduler' && rest[1] === 'booked' && rest[2]) node.scheduler.booked[rest[2]] = content;
    else if (rest[0] === 'resources' && rest[1]) node.resources[rest[1]] = content;
    else if (rest[0] === 'health') node.health[rest.slice(1).join('.') || 'summary'] = content;
    else if (rest[0] === 'observed' && rest[1]) node.observed[rest[1]] = content;
    // the Idle Service owns this branch; Mirror only carries it, it never computes it
    else if (rest[0] === 'standby') node.standby = content;
    // the Echidna host publishes the one conversation; every other node reads THIS branch to show the same talk
    else if (rest[0] === 'echidna') node.conversation = content;
    else node.unknown[path] = content;
  }

  if (refHint && nodes.has(refHint)) return nodes.get(refHint);
  if (refHint) return nodes.get(refHint) || emptyNode(refHint);
  return [...nodes.values()][0] || null;
}

export function allNodes(entries = []) {
  const byRef = new Map();
  for (const entry of entries || []) {
    const path = String(entry?.path || entry?.name || '');
    const parts = path.split('.');
    if (parts.length >= 3 && parts[0] === 'node') byRef.set(parts[1], true);
  }
  return [...byRef.keys()].map((ref) => assemble(entries, ref));
}

/**
 * The menu's two facts about a service: is it offered, and is it ready. Everything else is detail.
 * A service entry that is missing `ready` is treated as not ready - never as ready by omission.
 */
export function serviceRows(node) {
  return Object.entries(node?.services || {})
    .map(([slug, svc]) => ({
      slug,
      name: svc?.name || slug,
      provider: svc?.provider || null,
      karma: typeof svc?.karma === 'number' ? svc.karma : null,
      ready: svc?.ready === true,
      modes: Array.isArray(svc?.modes) ? svc.modes : [],
    }))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || a.slug.localeCompare(b.slug));
}

export function bookedRows(node) {
  return Object.entries(node?.scheduler?.booked || {})
    .map(([id, job]) => ({ id, ...job }))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

/** A node's display name: what it calls itself, else its ref. Never invented. */
export function displayName(node) {
  return node?.id?.name || node?.ref || 'unknown node';
}
