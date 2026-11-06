/**
 * What this node says about itself, as entries for State.
 *
 * Split into separate names on purpose, so a peer can pull the CHEAP one:
 *   node.<ref>.cycle   the heartbeat (pulled by every peer, every tick)
 *   node.<ref>.id      what this box is (pulled rarely, changes rarely)
 *   node.<ref>.doors   what it answers on (pulled rarely)
 *
 * One big object would force every peer to read everything to ask "are you alive?", which is exactly the cost
 * the delta flags and the split are here to avoid.
 */

export function refOf(nodeJson = {}, fallback = 'node') {
  const raw = String(nodeJson.ref || process.env.HYDRA_REF || fallback).trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'node';
}

/** The identity entry: facts about the box, never paths into other boxes. */
export function idEntry(nodeJson = {}, facts = {}) {
  return {
    ref: facts.ref,
    name: nodeJson.name || facts.ref,
    gpu: nodeJson.gpu || null,
    modelsDir: nodeJson.modelsDir || null,
    ready_for: Array.isArray(nodeJson.ready_for) ? nodeJson.ready_for : [],
    acting_main: nodeJson.acting_main === true,
    platform: process.platform,
    pid: process.pid,
    startedAt: facts.startedAt,
    since: new Date(facts.startedAt).toISOString(),
  };
}

/** The doors entry: every module folder that declares a port, and whether it answers right now. */
export function doorsEntry(doors = [], at = Date.now()) {
  return {
    at,
    since: new Date(at).toISOString(),
    count: doors.length,
    up: doors.filter((d) => d.up).length,
    doors: doors.map((d) => ({ name: d.name, port: d.port, up: d.up === true })),
  };
}

/**
 * The heartbeat. `cycle` is monotonic and never reset while the process lives: a peer proves liveness by seeing
 * it ADVANCE between two pulls, so nothing here needs a clock agreement and State never stores a timer.
 */
export function cycleEntry(state = {}, at = Date.now()) {
  return {
    cycle: state.cycle,
    at,
    since: new Date(at).toISOString(),
    tickMs: state.tickMs,
    uptimeSec: Math.round((at - state.startedAt) / 1000),
    // room for the Phoenix cycle's own numbers when it lands - the seam already defines them
    fillPct: typeof state.fillPct === 'number' ? state.fillPct : null,
    sessions: typeof state.sessions === 'number' ? state.sessions : null,
  };
}

export function slugOf(name, fallback = 'service') {
  const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

/**
 * One entry per service, nested under the node: node.<ref>.services.<slug>.
 *
 * This is the broker's payload. A stranger deciding whether to ask this box for something needs the service
 * name, what it is, what it costs in karma, and whether it is ready - and nothing else. Not paths, not model
 * inventories, not logs. `minimal()` in broadcast.js enforces that projection.
 */
export function serviceEntries(services = [], at = Date.now()) {
  return services.map((svc) => ({
    name: slugOf(svc.name),
    content: {
      name: svc.name,
      what: svc.what || null,
      provider: svc.provider || null,
      modes: Array.isArray(svc.modes) ? svc.modes : [],
      karma: typeof svc.karma === 'number' ? svc.karma : null,
      output: svc.output || null,
      ready: svc.ok === true,
      at: new Date(at).toISOString(),
    },
  }));
}

export function entryNames(ref) {
  return {
    id: `node.${ref}.id`,
    doors: `node.${ref}.doors`,
    cycle: `node.${ref}.cycle`,
    services: `node.${ref}.services`,
    service: (slug) => `node.${ref}.services.${slug}`,
    observed: (peer) => `node.${ref}.observed.${peer}`,
  };
}

/**
 * A link is data, not a pointer to execute: `node.<ref>` registered as `{ kind: 'link', to }` says "the rest of
 * this path lives in another registry". State stores it and does nothing with it; the QUERY ENGINE is what
 * follows it, which is why the freshness of a resolved value is decided by whoever asks, not by a publisher's
 * tick. That is the whole difference between a live read and a snapshot.
 */
export function linkEntry(to, at = Date.now()) {
  return { kind: 'link', to: String(to).replace(/\/+$/, ''), at };
}

/** The ref a link entry is registered under, or null when the name is not a node path. */
export function linkRefOf(name) {
  const parts = String(name).split('.').filter(Boolean);
  return parts.length === 2 && parts[0] === 'node' ? parts[1] : null;
}
