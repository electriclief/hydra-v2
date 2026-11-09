/**
 * One LAN object, and a brief an agent can read in one call.
 *
 * lan.json is the machine view: { schemaVersion, at, self, nodes[] }. lan.md is the same facts in the order a
 * person (or a session) reads them: who is up, what they offer, what is booked, what is degraded.
 *
 * Rules that make this trustworthy:
 *   - `self` is a node object like any other; there is no privileged shape
 *   - a node's verdict is 'alive' | 'stalled' | 'gone' | 'unknown', and 'unknown' is said out loud
 *   - nothing is estimated: counts come from the arrays actually present
 */
import { bookedRows, displayName, serviceRows } from './assemble.js';
import { fleetSummary, intentFor, matchRow } from './roster.js';

export const SCHEMA_VERSION = 1;

export function lanJson({ self, peers = [], at = Date.now(), cycleOf = () => null, roster = null, selfIp = null }) {
  const nodes = [];
  if (self) nodes.push(view(self, 'self', at, cycleOf(self.ref), { roster, ip: selfIp }));
  for (const peer of peers) {
    nodes.push(
      view(peer.node, peer.verdict, at, peer.cycle, { misses: peer.misses, reason: peer.reason, ref: peer.ref, roster, ip: peer.ip || null, minerProbe: peer.minerProbe || null }),
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    at: new Date(at).toISOString(),
    self: self ? self.ref : null,
    counts: {
      nodes: nodes.length,
      alive: nodes.filter((n) => n.verdict === 'alive').length,
      services: nodes.reduce((n, node) => n + node.services.length, 0),
      ready: nodes.reduce((n, node) => n + node.services.filter((s) => s.ready).length, 0),
      booked: nodes.reduce((n, node) => n + node.booked.length, 0),
      // declared intent vs the machines actually here: two numbers that are only useful beside each other
      declared: roster?.rows?.length ?? 0,
      withIntent: nodes.filter((n) => n.intent).length,
      // declared, enabled, and NOT on the wire - unmanaged boxes and switched-off boxes alike. This is the number
      // that stops a tree from pretending the network is only what answered.
      absent: declaredAbsent(roster, nodes).length,
      unmanaged: declaredAbsent(roster, nodes).filter((r) => !r.managed).length,
    },
    // what the roster says the house is FOR, and the rows this view never found on the wire
    fleet: fleetSummary(roster, nodes),
    // EVERY declared machine that did not answer, with the reason it could not: no Hydra app (unmanaged), or no
    // answer at all. A tree renders these at the bottom, greyed - never deleted, because a network is not only the
    // machines that are awake.
    declaredAbsent: declaredAbsent(roster, nodes),
    nodes,
  };
}

/** Roster rows that are declared and enabled but produced no node on the wire. */
function declaredAbsent(roster, nodes) {
  const rows = roster?.rows || [];
  if (!rows.length) return [];
  const seenRows = new Set();
  for (const n of nodes) {
    const row = matchRow(roster, { ref: n.ref, name: n.name, ip: n.ip });
    if (row) seenRows.add(row.name || row.ip);
  }
  return rows
    .filter((r) => r.enabled && !seenRows.has(r.name || r.ip))
    .map((r) => ({
      // a row with no name still exists, and an ip is enough to name it by
      name: r.name || r.ip,
      ip: r.ip,
      role: r.role,
      hostname: r.hostname,
      ready_for: r.ready_for || [],
      managed: r.managed !== false,
      os: r.os || null,
      door: r.door,
      notes: r.notes || '',
      // the one word the tree needs: unmanaged boxes are expected to be silent, switched-off ones are not
      // a row with no address is not 'offline' and not 'unmanaged': it has never been on the wire, so
      // saying either would be a claim about a machine nobody has plugged in yet.
      why: !r.ip ? 'no address yet' : (r.managed === false ? 'unmanaged' : 'offline'),
    }));
}

/** The Idle Service's own words, trimmed to what a display needs - plus how old the report is. */
function standbyOf(raw, at) {
  if (!raw || typeof raw !== 'object') return null;
  const miner = raw.miner === true;
  const ai = typeof raw.ai === 'string' ? raw.ai : '';
  const mode = raw.mode === 'ai' || raw.mode === 'mining' || raw.mode === 'idle'
    ? raw.mode
    : ai ? 'ai' : miner ? 'mining' : 'idle';
  const reportedAt = typeof raw.at === 'string' ? Date.parse(raw.at) : NaN;
  const poll = typeof raw.poll === 'number' ? raw.poll : null;
  const ageS = Number.isFinite(reportedAt) ? Math.max(0, Math.round((at - reportedAt) / 1000)) : null;
  return {
    mode,
    ai: ai || null,
    miner,
    minerDetail: raw.minerDetail && typeof raw.minerDetail === 'object' ? raw.minerDetail : null,
    // the CPU miner is its own machine: it can be hashing while the card is yielded, and absent while the card mines
    cpuDetail: raw.cpuDetail && typeof raw.cpuDetail === 'object' ? raw.cpuDetail : null,
    cpu: raw.cpu === true,
    pinned: raw.pinned === true,
    at: typeof raw.at === 'string' ? raw.at : null,
    resumeAt: typeof raw.resumeAt === 'string' ? raw.resumeAt : null,
    idleSince: typeof raw.idleSince === 'string' ? raw.idleSince : null,
    pollS: poll,
    ageS,
    // stale once the owner has missed more than three of its own polls: 15s poll -> 45s of silence
    stale: ageS != null && poll != null ? ageS > poll * 3 : ageS != null ? ageS > 60 : false,
  };
}

/**
 * A node that publishes no standby report can still be MINING, and when its miner answers on its own API that is
 * a measurement - the same class of fact as a heartbeat, not a guess. The shape is deliberately the same as a
 * reported standby, with `source: 'miner-api'` and `measured: true` so no screen can present it as the node's own
 * claim. It carries no grace, no resumeAt and no idleSince: those belong to the guard, which is not talking.
 */
function standbyFromMiner(probe, at) {
  if (!probe || typeof probe !== 'object') return null;
  const rate = typeof probe.rate === 'number' ? probe.rate : null;
  return {
    mode: 'mining',
    ai: null,
    miner: true,
    source: 'miner-api',
    measured: true,
    minerDetail: {
      at: probe.at || null,
      label: probe.algo || 'mining',
      algo: probe.algo || null,
      rate,
      unit: null,
      accepted: probe.accepted ?? null,
      rejected: probe.rejected ?? null,
      pool: probe.pool || null,
      uptime: probe.uptime || null,
    },
    cpuDetail: null,
    cpu: false,
    pinned: false,
    at: probe.at || null,
    resumeAt: null,
    idleSince: null,
    pollS: null,
    ageS: 0,
    stale: false,
  };
}

function view(node, verdict, at, cycle, extra = {}) {
  // a peer that does not answer has NO node: it must still render, with its ref and nothing else
  const services = serviceRows(node);
  return {
    ref: node?.ref || extra.ref || null,
    name: node ? displayName(node) : extra.ref || 'unknown node',
    role: verdict === 'self' ? 'self' : 'peer',
    verdict: verdict === 'self' ? 'alive' : verdict || 'unknown',
    cycle: typeof node?.cycle?.cycle === 'number' ? node.cycle.cycle : cycle ?? null,
    uptimeSec: typeof node?.cycle?.uptimeSec === 'number' ? node.cycle.uptimeSec : null,
    gpu: node?.id?.gpu || null,
    doors: node?.doors ? { count: node.doors.count ?? null, up: node.doors.up ?? null } : null,
    services,
    booked: bookedRows(node),
    // DECLARED INTENT: what this machine is for, from the roster - null when the operator never declared it.
    // Kept beside the verdict on purpose: a role is a claim, a verdict is a measurement.
    ip: extra.ip || null,
    intent: intentFor(extra.roster, { ref: node?.ref || extra.ref, name: node?.id?.name, ip: extra.ip }),
    // does this machine run the Hydra app? An unmanaged box can still be ON the LAN, and then it is a node with a
    // verdict - what it cannot do is publish services or state. The tree needs this to know what to expect of it.
    managed: (() => {
      const r = matchRow(extra.roster, { ref: node?.ref || extra.ref, name: node?.id?.name, ip: extra.ip });
      return r ? r.managed !== false : true;
    })(),
    // WHAT THE CARD IS DOING, as its owner reported it. `ageS` is the honesty: a report older than the owner's
    // own poll interval is stale, and a screen must be able to say so instead of showing old news as current.
    standby: standbyOf(node?.standby, at) || standbyFromMiner(extra.minerProbe, at),
    observedAt: node?.observed || null,
    degraded: node?.health?.degraded === true,
    misses: extra.misses ?? null,
    reason: extra.reason ?? null,
    seenAt: new Date(at).toISOString(),
  };
}

/** The brief. Plain text, stable order, no adjectives that are not backed by a number. */
export function lanMarkdown(lan) {
  const lines = [];
  lines.push('# LAN');
  lines.push('');
  lines.push(`At ${lan.at} — ${lan.counts.nodes} nodes, ${lan.counts.services} services (${lan.counts.ready} ready), ${lan.counts.booked} booked.`);
  if (lan.fleet) {
    // declared vs present, said as two numbers: a roster that disagrees with the wire is the useful fact
    lines.push(
      lan.fleet.ok
        ? `Roster \`${lan.fleet.source}\`: ${lan.fleet.declared} declared, ${lan.fleet.onLan} on the LAN, ${lan.fleet.notHere} not here${lan.fleet.notHere ? ` (${lan.fleet.notHereNames.join(', ')})` : ''}.`
        : `Roster \`${lan.fleet.source}\` is unreadable (${lan.fleet.error}) — roles are unknown, not absent.`,
    );
  }
  if (Array.isArray(lan.declaredAbsent) && lan.declaredAbsent.length) {
    const un = lan.declaredAbsent.filter((r) => r.managed === false);
    const off = lan.declaredAbsent.filter((r) => r.managed !== false);
    lines.push('');
    lines.push(
      `Declared, not on the wire: ${off.length} offline${off.length ? ` (${off.map((r) => r.name).join(', ')})` : ''}` +
        `${un.length ? `; ${un.length} unmanaged over ssh (${un.map((r) => r.name).join(', ')})` : ''}.`,
    );
  }
  lines.push('');

  for (const node of lan.nodes) {
    const who = node.role === 'self' ? 'this node' : 'peer';
    const chips = [
      node.verdict,
      node.cycle === null ? 'no cycle' : `cycle ${node.cycle}`,
      node.doors ? `${node.doors.up}/${node.doors.count} doors` : null,
      node.degraded ? 'DEGRADED' : null,
    ].filter(Boolean);
    lines.push(`## ${node.name} (${node.ref}) — ${who}`);
    lines.push(chips.join(' · '));
    // what this machine is for, when the operator declared it - absence is stated, never borrowed
    lines.push(
      node.intent
        ? `for: ${node.intent.role || 'no role'}${node.intent.ready_for.length ? ` · ${node.intent.ready_for.join(', ')}` : ''}${node.ip ? ` · ${node.ip}` : ''}`
        : 'for: no declaration in the roster',
    );
    if (node.services.length === 0) {
      lines.push('');
      lines.push('no services published');
    } else {
      lines.push('');
      for (const svc of node.services) {
        const bits = [svc.ready ? 'ready' : 'not ready', svc.provider, svc.karma === null ? null : `karma ${svc.karma}`];
        lines.push(`- ${svc.slug} — ${bits.filter(Boolean).join(', ')}`);
      }
    }
    if (node.booked.length) {
      lines.push('');
      lines.push('booked:');
      for (const job of node.booked) lines.push(`- ${job.at || '?'} · ${job.service || job.id} · ${job.state || 'booked'}`);
    }
    lines.push('');
  }

  if (lan.nodes.length <= 1) {
    lines.push('No peers attached. This is the N=1 case: one node, its own services, nothing to read.');
    lines.push('');
  }
  return lines.join('\n');
}
