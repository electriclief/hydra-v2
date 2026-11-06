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

/** The observer's own record of one peer - written under the observer's branch, never the peer's. */
export function observation(verdict, at = Date.now()) {
  return {
    verdict: verdict.verdict,
    cycle: verdict.cycle,
    misses: verdict.misses,
    reason: verdict.reason,
    at,
    seenAt: new Date(at).toISOString(),
  };
}
