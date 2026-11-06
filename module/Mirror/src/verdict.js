/**
 * Verdict rules, mirrored from Core/src/verdict.js.
 *
 * Deliberately duplicated rather than imported across module folders: a module must be able to run from its own
 * directory, and a runtime import that reaches into a sibling module is a deployment trap. The duplication is
 * kept honest by Mirror's gate, which imports BOTH copies and fails if they ever disagree.
 */
export function classify(prev = {}, seen = {}, thresholds = {}) {
  const stalledAfter = thresholds.stalledAfter ?? 3;
  const goneAfter = thresholds.goneAfter ?? 12;
  const prevCycle = typeof prev.cycle === 'number' ? prev.cycle : null;
  const misses = typeof prev.misses === 'number' ? prev.misses : 0;

  if (!seen.reachable) {
    const next = misses + 1;
    return { verdict: next >= goneAfter ? 'gone' : 'stalled', cycle: prevCycle, misses: next, reason: 'no answer' };
  }
  if (typeof seen.cycle !== 'number') {
    return { verdict: 'stalled', cycle: prevCycle, misses: misses + 1, reason: 'answers, publishes no cycle' };
  }
  if (prevCycle === null) return { verdict: 'alive', cycle: seen.cycle, misses: 0, reason: 'first sight' };
  if (seen.cycle > prevCycle) return { verdict: 'alive', cycle: seen.cycle, misses: 0, reason: `advanced ${prevCycle} -> ${seen.cycle}` };

  const next = misses + 1;
  return {
    verdict: next >= goneAfter ? 'gone' : 'stalled',
    cycle: seen.cycle,
    misses: next,
    reason: next >= stalledAfter ? `counter static for ${next} ticks` : 'counter static',
  };
}
