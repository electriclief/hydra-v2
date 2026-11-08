/**
 * The three verdicts a peer can carry, and the hysteresis that keeps them honest.
 *
 * alive   - its cycle counter advanced since the last pull
 * stalled - it answers, but the counter has not moved (busy, blocked, or hung)
 * gone    - it does not answer at all
 *
 * Hysteresis is per-observer and counted in ticks, never in seconds: a laptop that closes its lid must read as
 * asleep for a while before it reads as gone, and one missed pull must never produce "gone".
 *
 * These are OPINIONS of the observer. The peer's own counter is its truth; when the two disagree, the
 * disagreement is a partition and is shown as such.
 */
export const VERDICTS = ['alive', 'stalled', 'gone'];

/**
 * @param {object} prev  { cycle: number|null, misses: number, verdict?: string }
 * @param {object} seen  { cycle: number|null, reachable: boolean }
 * @param {object} thresholds { stalledAfter, goneAfter } in ticks
 */
export function classify(prev = {}, seen = {}, thresholds = {}) {
  const stalledAfter = thresholds.stalledAfter ?? 3;
  const goneAfter = thresholds.goneAfter ?? 12;
  const prevCycle = typeof prev.cycle === 'number' ? prev.cycle : null;
  const misses = typeof prev.misses === 'number' ? prev.misses : 0;

  if (!seen.reachable || typeof seen.cycle !== 'number') {
    const next = misses + 1;
    return {
      verdict: next >= goneAfter ? 'gone' : 'stalled',
      cycle: prevCycle,
      misses: next,
      reason: 'no answer',
    };
  }

  if (prevCycle === null) {
    return { verdict: 'alive', cycle: seen.cycle, misses: 0, reason: 'first sight' };
  }

  if (seen.cycle > prevCycle) {
    return { verdict: 'alive', cycle: seen.cycle, misses: 0, reason: `advanced ${prevCycle} -> ${seen.cycle}` };
  }

  // it answers, but the counter stands still: the box is up, the thing that ticks is not
  const next = misses + 1;
  return {
    verdict: next >= goneAfter ? 'gone' : 'stalled',
    cycle: seen.cycle,
    misses: next,
    reason: next >= stalledAfter ? `counter static for ${next} ticks` : 'counter static',
  };
}

/**
 * One peer's idle report, trimmed to the three facts a LAN row can show: what mode, what is it doing, and how
 * old the sentence is. Never computed from anything but the peer's own words - a node that publishes nothing
 * gets `null`, which every reader renders as "no report".
 */
export function standbyOf(raw, at = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const miner = raw.miner === true;
  const ai = typeof raw.ai === 'string' ? raw.ai : '';
  const mode = raw.mode === 'ai' || raw.mode === 'mining' || raw.mode === 'idle' ? raw.mode : ai ? 'ai' : miner ? 'mining' : 'idle';
  const reportedAt = typeof raw.at === 'string' ? Date.parse(raw.at) : NaN;
  const ageS = Number.isFinite(reportedAt) ? Math.max(0, Math.round((at - reportedAt) / 1000)) : null;
  const poll = typeof raw.poll === 'number' ? raw.poll : null;
  return {
    mode,
    ai: ai || null,
    miner,
    at: typeof raw.at === 'string' ? raw.at : null,
    ageS,
    // stale once the owner has missed three of its own polls - the same rule Mirror applies, so two screens
    // can never disagree about whether a report is current
    stale: ageS != null && poll != null ? ageS > poll * 3 : ageS != null ? ageS > 60 : false,
  };
}

/** The observer's own record of one peer - written under the observer's branch, never the peer's. */
export function observation(verdict, at = Date.now(), standby = null) {
  return {
    verdict: verdict.verdict,
    cycle: verdict.cycle,
    misses: verdict.misses,
    reason: verdict.reason,
    // what the peer said it was doing, as a snapshot inside OUR observation: the live value always stays the
    // peer's own entry, this is only what we saw when we looked
    standby,
    at,
    seenAt: new Date(at).toISOString(),
  };
}
