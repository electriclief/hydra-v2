/**
 * The root claim — who holds the pointer table right now.
 *
 * The operator's rule (2026-11-10): "if hydra boot occurs and there is no SERVER (just a node that holds root state) and
 * there is no server to join, it becomes server". So the root is a ROLE, not a machine: first to boot claims it, a
 * lease keeps the claim honest, and if the holder dies the next survivor takes it. Rebuilding is trivial by
 * construction — the root holds only links, so "rebuild" is one POST per node.
 *
 * The tiebreak was delegated to this side of the table and decided: **lowest ref wins, compared lexicographically**
 * ("123" < "1660" < "gvtx980" < "robert" < "xpsw"). It needs no clock, no IP and no roster, so it still resolves when
 * the roster cannot be read.
 *
 * This file is deliberately pure: it is given what the registry said and answers what this node should do. Nothing
 * here fetches, sleeps or writes — that is what makes it testable, and a claim rule that cannot be tested is a claim
 * rule nobody can trust on the day it matters.
 */

export const ROLE = { ROOT: 'root', MEMBER: 'member', OFF: 'off' };

/** Lexicographic, byte order, deliberately not numeric: refs are names, not numbers, and '9' must not beat '10'. */
export function lowerRef(a, b) {
  const x = String(a ?? '').toLowerCase();
  const y = String(b ?? '').toLowerCase();
  if (!x) return y || null;
  if (!y) return x;
  return x <= y ? x : y;
}

/**
 * What should this node do about the root role?
 *
 *   claim      nobody holds a live claim — take it
 *   renew      I hold it — push the lease forward
 *   takeover   the holder's lease expired, or I beat it on the tiebreak — take it from them
 *   yield      someone else holds a live claim and beats me — stand down
 *
 * `claim` is whatever the registry has under `root.claim`, or null. A claim with no lease, or a lease in the past,
 * is dead: a dead root must never keep the role by being the last thing written.
 */
export function decide({ claim, me, now, leaseMs }) {
  if (!me) return { action: 'yield', why: 'this node has no ref, so it cannot hold the root' };
  if (!claim || !claim.ref) return { action: 'claim', why: 'no root claim in the registry' };

  const holder = String(claim.ref).toLowerCase();
  const leaseUntil = Number(claim.leaseUntil);

  if (!Number.isFinite(leaseUntil)) {
    return { action: 'claim', why: `the claim from ${holder} carries no lease, so it cannot be trusted as live` };
  }
  if (leaseUntil <= now) {
    return { action: 'claim', why: `the claim from ${holder} expired ${Math.round((now - leaseUntil) / 1000)}s ago` };
  }
  if (holder === String(me).toLowerCase()) {
    return { action: 'renew', holder, why: 'this node holds the role' };
  }
  const winner = lowerRef(holder, me);
  if (winner === String(me).toLowerCase()) {
    return { action: 'takeover', holder, why: `tiebreak: ${me} is lower than ${holder}` };
  }
  return { action: 'yield', holder, why: `tiebreak: ${holder} is lower than ${me}` };
}

/** The claim entry to write. `token` distinguishes this node's holds from a previous one, so a stale write is visible. */
export function claimEntry({ me, token, now, leaseMs }) {
  return { ref: String(me).toLowerCase(), token: String(token), since: new Date(now).toISOString(), leaseUntil: now + leaseMs };
}

/** Is a claim alive? Used by readers that do not want the whole decision. */
export function isLive(claim, now) {
  return Boolean(claim && claim.ref && Number(claim.leaseUntil) > now);
}
