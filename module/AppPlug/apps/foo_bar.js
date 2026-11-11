#!/usr/bin/env node
/**
 * foo_bar — a stand-in for a console program that knows nothing about Hydra.
 *
 * It prints progress lines and nothing else: no API, no port, no protocol. That is the point. AppPlug reads this
 * stream the way it would read any .exe's stdout.
 *
 *   node foo_bar.js [--steps 50] [--delay-ms 400] [--stall-at 3] [--exit-after 900] [--fail]
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const steps = arg('steps', 50);
const delay = arg('delay-ms', 400);
const stallAt = arg('stall-at', 0);
const exitAfter = arg('exit-after', 0);
const shouldFail = process.argv.includes('--fail');

let i = 0;
let exitTimer = null;

console.log('foo_bar v1.0');
console.log('phase: warmup');

const tick = setInterval(() => {
  i += 1;
  if (stallAt && i > stallAt) return; // go quiet on purpose: this is how 'stale' gets proved
  console.log(`phase: working`);
  console.log(`work: ${Math.round((i / steps) * 100)}%`);
  if (shouldFail && i === 3) {
    console.log('error: disk on fire');
    process.exitCode = 2;
    clearInterval(tick);
    return;
  }
  if (i >= steps) {
    clearInterval(tick);
    console.log('work: 100%');
    console.log('done');
    if (!exitAfter) return; // stay alive like a real tool waiting for the next job
  }
}, delay);

if (exitAfter) {
  exitTimer = setTimeout(() => { clearInterval(tick); console.log('done'); process.exit(0); }, exitAfter);
}

process.on('SIGTERM', () => { clearInterval(tick); if (exitTimer) clearTimeout(exitTimer); process.exit(0); });
