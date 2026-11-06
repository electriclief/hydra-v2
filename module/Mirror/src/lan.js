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

export const SCHEMA_VERSION = 1;

export function lanJson({ self, peers = [], at = Date.now(), cycleOf = () => null }) {
  const nodes = [];
  if (self) nodes.push(view(self, 'self', at, cycleOf(self.ref)));
  for (const peer of peers) nodes.push(view(peer.node, peer.verdict, at, peer.cycle, { misses: peer.misses, reason: peer.reason, ref: peer.ref }));

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
    },
    nodes,
  };
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
    // WHAT THE CARD IS DOING, as its owner reported it. `ageS` is the honesty: a report older than the owner's
    // own poll interval is stale, and a screen must be able to say so instead of showing old news as current.
    standby: standbyOf(node?.standby, at),
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
