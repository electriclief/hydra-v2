/**
 * Declared intent: what each machine in the house is FOR.
 *
 * The roster is one file the operator owns (`C:/AI/fleet/roster.json` by default), and this module is the only
 * thing in the LAN view that reads it. Observed reality stays where it always was - every node publishes its own
 * branch into its own State, and Mirror assembles it. The two are joined here and never merged: a role is a
 * claim, a verdict is a measurement, and a screen must be able to show one without pretending it is the other.
 *
 * Rules:
 *   - an unreadable roster is a FACT (`ok:false` + the path), never an exception and never an empty LAN
 *   - matching is by the join keys a node actually publishes: its ref, the name in its id entry, and the IP in
 *     the State url it is reached on. Nothing is guessed from a hostname we never asked for.
 *   - a node with no roster row says `no declaration` out loud instead of borrowing its neighbour's role
 *   - `ready_for[]` is a list of capabilities the operator declared; picking a node for a job is a filter over
 *     it, not a decision made here
 */
import fs from 'node:fs';

export const DEFAULT_ROSTER = process.env.MIRROR_ROSTER || 'C:/AI/fleet/roster.json';

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** IPv4 in a State url (`http://192.168.1.127:8127`) - the only key every peer's row can join on. */
export function ipOf(url) {
  const m = String(url || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return m ? m[1] : null;
}

/**
 * Read the roster. The controller is a row like any other (it is a machine with a role too), so `nodes:
 * [{...controller, kind:'controller'}, ...nodes]` is the single list everything downstream filters.
 */
export function loadRoster(file = DEFAULT_ROSTER) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, file, error: error.code === 'ENOENT' ? 'not found' : error.message, fleet: null, rows: [] };
  }
  const rows = [];
  const push = (row, kind) => {
    if (!row || (!row.name && !row.ip)) return;
    rows.push({
      name: row.name || null,
      ip: row.ip || null,
      // the State door this machine answers on: the address a caller dials, not just a name in a table
      door: row.door === null ? null : Number.isFinite(Number(row.door)) && Number(row.door) > 0 ? Number(row.door) : 8127,
      hostname: row.hostname || null,
      role: row.role || null,
      ready_for: Array.isArray(row.ready_for) ? row.ready_for.filter((c) => typeof c === 'string') : [],
      notes: row.notes || '',
      enabled: row.enabled !== false,
      // MANAGED means "this box runs the Hydra app and publishes a door". A machine without it is not a lesser
      // member of the house - it is one Echidna reaches over ssh and cannot ask for state. Absent means managed
      // (every row written before this field existed was a Hydra node).
      managed: row.managed !== false,
      // WHAT ITS MINER ANSWERS ON. Declared, never guessed: a box with no State door can still be mining, and
      // this URL is the only thing that lets the tree say so from a measurement instead of staying silent.
      minerApi: typeof row.minerApi === 'string' && row.minerApi ? row.minerApi : null,
      os: row.os || (row.managed === false ? 'linux' : 'windows'),
      kind,
    });
  };
  push(raw.controller, 'controller');
  for (const node of Array.isArray(raw.nodes) ? raw.nodes : []) push(node, 'node');
  return { ok: true, file, fleet: raw.fleet || null, rows };
}

/** Every key a row can be found by. First writer wins, so an ip never shadows another row's ip. */
export function indexOf(roster) {
  const byKey = new Map();
  for (const row of roster?.rows || []) {
    for (const key of [row.ip, row.name, row.hostname]) {
      const k = norm(key);
      if (k && !byKey.has(k)) byKey.set(k, row);
    }
  }
  return byKey;
}

/** The roster row behind one LAN node, or null. `ref` and `name` cover 123 vs "123 — this box"; `ip` covers the rest. */
export function matchRow(roster, { ref, name, ip } = {}) {
  const byKey = indexOf(roster);
  for (const key of [ip, ref, name]) {
    const k = norm(key);
    if (k && byKey.has(k)) return byKey.get(k);
  }
  // "123 — this box" is still the controller called 123: compare on the first word when nothing else hit
  const first = norm(name).split(/[\s—-]+/)[0];
  return first && byKey.has(first) ? byKey.get(first) : null;
}

/**
 * The declared face of one node: role + ready_for, with the row it came from so a screen can show its name.
 * No row = null, and every reader renders that as "no declaration".
 */
export function intentFor(roster, keys = {}) {
  const row = matchRow(roster, keys);
  if (!row) return null;
  return {
    name: row.name,
    ip: row.ip,
    door: row.door,
    endpoint: row.ip && row.door ? `http://${row.ip}:${row.door}` : null,
    role: row.role,
    ready_for: row.ready_for,
    notes: row.notes,
    kind: row.kind,
    source: roster.file,
  };
}

/**
 * Who can do X, best first: alive before stalled/gone, then the node that publishes the most ready services,
 * then by name so the order never wobbles between refreshes. A candidate that is not on the LAN is still
 * listed - "declared but asleep" is an answer the caller needs, not a row to hide. No capability = every
 * declared row with its live verdict, which is the fleet view a menu needs.
 */
export function candidatesFor(roster, nodes = [], capability = null) {
  const want = norm(capability);
  const byKey = new Map();
  for (const node of nodes || []) {
    for (const key of [node.ip, node.ref, node.name]) {
      const k = norm(key);
      if (k && !byKey.has(k)) byKey.set(k, node);
    }
  }
  const findNode = (row) => {
    for (const key of [row.ip, row.name, row.hostname]) {
      const k = norm(key);
      if (k && byKey.has(k)) return byKey.get(k);
    }
    return null;
  };
  const rank = (v) => (v === 'alive' ? 0 : v === 'stalled' ? 1 : v === 'gone' ? 2 : 3);
  return (roster?.rows || [])
    .filter((row) => !want || row.ready_for.some((c) => norm(c) === want))
    .map((row) => {
      const node = findNode(row);
      const services = (node?.services || []).filter((s) => s.ready);
      return {
        name: row.name,
        ip: row.ip,
        door: row.door,
        endpoint: row.ip && row.door ? `http://${row.ip}:${row.door}` : null,
        role: row.role,
        ready_for: row.ready_for,
        declared: row.enabled,
        verdict: node?.verdict || 'not-on-lan',
        cycle: node?.cycle ?? null,
        // what it is doing right now, as its own Idle Service reports it - a card mining is not free
        standby: node?.standby && !node.standby.stale ? node.standby.mode : null,
        servicesReady: services.length,
        services: services.map((s) => s.slug),
      };
    })
    .sort((a, b) => rank(a.verdict) - rank(b.verdict) || b.servicesReady - a.servicesReady || String(a.name).localeCompare(String(b.name)));
}

/** The gap that matters: declared rows the LAN view never saw. Asleep is a legitimate reason, silence is not. */
export function fleetSummary(roster, nodes = []) {
  if (!roster) return null;
  const seen = new Set();
  for (const node of nodes || []) {
    const row = matchRow(roster, node);
    if (row) seen.add(row.name || row.ip);
  }
  const missing = (roster.rows || [])
    .filter((row) => row.enabled && !seen.has(row.name || row.ip))
    .map((row) => ({ name: row.name, ip: row.ip, role: row.role }));
  return {
    ok: roster.ok === true,
    source: roster.file,
    error: roster.error || null,
    declared: (roster.rows || []).length,
    onLan: seen.size,
    notHere: missing.length,
    notHereNames: missing.map((m) => m.name || m.ip),
  };
}
