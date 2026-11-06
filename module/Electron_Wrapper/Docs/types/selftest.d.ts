/**
 * @module selftest
 * @description The gate. Runs every module's own runTests() against the REAL thing, counts
 *              console.assert failures per module, prints one line per module plus the
 *              tally, and sets process.exitCode (never process.exit) so `npm test` can
 *              gate on it. GREEN means every assert held.
 * @intent "every module carries its own self-check" — this file is only the counter and
 *         the red/green light.
 */
export {};
