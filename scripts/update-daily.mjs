#!/usr/bin/env node
/**
 * update-daily.mjs — the once-a-day face of check-update.mjs.
 *
 * Runs the check, publishes the verdict into this node's own State as `node.<ref>.update`, then sleeps until the
 * next 03:00 and does it again. Publishing into State (rather than inventing a door) is deliberate: Mirror already
 * reads every node's State and the Menu already reads Mirror, so one registration makes "which node is behind?"
 * a fleet-wide question with no new plumbing on any node.
 *
 *   node scripts/update-daily.mjs --once     run one check, publish, exit (this is the manual/Echidna trigger)
 *   node scripts/update-daily.mjs            forever: check at 03:00 local, publish, sleep
 *
 * Exit codes: 0 ok, 1 the check itself failed, 2 could not publish to State.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOG = path.join(ROOT, 'logs', 'update.log');
const STATE = process.env.HYDRA_STATE_URL || 'http://127.0.0.1:8127';
const once = process.argv.includes('--once');

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG), { recursive: true });
    appendFileSync(LOG, line + '\n');
  } catch { /* logging is best effort */ }
}

function nodeRef() {
  try {
    const p = path.join(ROOT, 'module', 'Menu', 'data', 'node.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j.ref) return String(j.ref);
    }
  } catch { /* fall through */ }
  return os.hostname().toLowerCase();
}

async function check() {
  try {
    const { stdout } = await run(process.execPath, [path.join(ROOT, 'scripts', 'check-update.mjs'), '--json'], {
      cwd: ROOT, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, report: JSON.parse(stdout) };
  } catch (err) {
    // 10 means "update available" and is a perfectly good answer, not a failure
    if (err.code === 10 && err.stdout) {
      try { return { ok: true, report: JSON.parse(err.stdout) }; } catch { /* fall through */ }
    }
    return { ok: false, error: (err.stderr || err.message || String(err)).toString().trim().split('\n')[0] };
  }
}

async function publish(ref, payload) {
  const name = `node.${ref}.update`;
  const body = JSON.stringify({ name, content: payload });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(STATE + '/api/state/register', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      log(`publish attempt ${attempt}: HTTP ${res.status}`);
    } catch (err) {
      log(`publish attempt ${attempt}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return false;
}

async function cycle() {
  const ref = nodeRef();
  const { ok, report, error } = await check();
  const payload = ok
    ? {
      at: report.at,
      repo: report.repo,
      branch: report.branch,
      local: report.local,
      remote: report.remote,
      behind: report.behind,
      ahead: report.ahead,
      dirty: report.dirty,
      dirtyFiles: report.dirtyFiles,
      updateAvailable: report.updateAvailable,
      verdict: report.updateAvailable ? 'update-available' : (report.ok ? 'up-to-date' : 'unknown'),
      note: report.note ?? null,
    }
    : { at: new Date().toISOString(), verdict: 'check-failed', error };

  if (ok) {
    log(`${ref}: local ${report.local.short} origin ${report.remote.short} behind ${report.behind} ahead ${report.ahead} dirty ${report.dirtyFiles} -> ${payload.verdict}`);
  } else {
    log(`${ref}: check failed — ${error}`);
  }

  const published = await publish(ref, payload);
  log(published ? `published node.${ref}.update` : `COULD NOT publish node.${ref}.update to ${STATE}`);
  return published ? 0 : 2;
}

function msUntilNext(hour = 3) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

const code = await cycle();
if (once) process.exit(code);

while (true) {
  const wait = msUntilNext(3);
  log(`next check in ${Math.round(wait / 60000)} min (03:00 local)`);
  await new Promise((r) => setTimeout(r, wait));
  try { await cycle(); } catch (err) { log(`cycle threw: ${err.message}`); }
}
