#!/usr/bin/env node
/**
 * check-update.mjs — "is this node running the fleet's Hydra?"
 *
 * One question, answered from git: what commit is on disk, what commit is on GitHub, and how far apart are they.
 * It writes its verdict to module/Services/data/update.json so a door can serve it without shelling out, and it
 * prints the same shape on stdout for a person or a script.
 *
 *   node scripts/check-update.mjs            report only (this is what the daily check runs)
 *   node scripts/check-update.mjs --json     same, machine only
 *   node scripts/check-update.mjs --apply    fast-forward to origin IF the tree is clean; refuses otherwise
 *
 * Why refuse when dirty: this repo carries uncommitted work most days (a module patch under test). A blind
 * `git pull` over that either conflicts or, worse, merges someone's half-finished edit into everyone's fleet.
 * A dirty tree is not an error — it is a fact the caller must see before deciding.
 *
 * Exit codes: 0 = up to date or report only, 10 = update available, 11 = could not reach the remote,
 * 12 = --apply refused (dirty tree / not a fast-forward), 13 = not a git checkout.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'module', 'Services', 'data', 'update.json');
const argv = new Set(process.argv.slice(2));
const wantJson = argv.has('--json');
const wantApply = argv.has('--apply');

function git(args, { tolerate = false } = {}) {
  try {
    return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (tolerate) return null;
    const msg = (err.stderr || err.message || '').toString().trim().split('\n')[0];
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

const report = {
  ok: false,
  at: new Date().toISOString(),
  node: path.basename(ROOT),
  repo: null,
  branch: null,
  local: null,
  remote: null,
  behind: null,
  ahead: null,
  dirty: false,
  dirtyFiles: 0,
  updateAvailable: null,
  applied: false,
  note: null,
};

const fail = (note, code) => {
  report.ok = false;
  report.note = note;
  emit();
  process.exit(code);
};

function emit() {
  if (!wantJson && report.note) console.error('[update] ' + report.note);
  try {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch { /* a report we cannot cache is still a report */ }
  if (wantJson) console.log(JSON.stringify(report, null, 2));
  else {
    if (report.ok) {
      console.log(`[update] ${report.node}  ${report.local.short}  ->  origin/${report.branch} ${report.remote.short}`);
      console.log(`[update] behind ${report.behind}  ahead ${report.ahead}  dirty ${report.dirtyFiles} file(s)`);
      console.log(`[update] ${report.updateAvailable ? 'UPDATE AVAILABLE' : 'up to date'}`);
      if (report.local.date) console.log(`[update] local commit ${report.local.date}`);
      if (report.remote.date) console.log(`[update] remote commit ${report.remote.date}`);
    }
  }
}

// --- is this even a checkout? -------------------------------------------------
if (!existsSync(path.join(ROOT, '.git'))) fail('no .git here — this node was copied, not cloned; the update check cannot run', 13);

let remoteUrl;
try {
  remoteUrl = git(['remote', 'get-url', 'origin']);
} catch (e) {
  fail(e.message, 13);
}
report.repo = remoteUrl;

// --- local state --------------------------------------------------------------
try {
  report.branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const localSha = git(['rev-parse', 'HEAD']);
  const localDate = git(['log', '-1', '--format=%cI', 'HEAD']);
  report.local = { sha: localSha, short: localSha.slice(0, 7), date: localDate };
  const porcelain = git(['status', '--porcelain']);
  const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  report.dirty = lines.length > 0;
  report.dirtyFiles = lines.length;
  report.dirtySample = lines.slice(0, 5).map((l) => l.trim());
} catch (e) {
  fail(e.message, 13);
}

// --- remote state: ls-remote first, because it needs no fetch and no credentials prompt ----
try {
  // Ask the remote for its branch head. This is the cheap read: no objects, no working tree.
  const ls = execFileSync('git', ['-C', ROOT, 'ls-remote', 'origin', `refs/heads/${report.branch}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
  }).trim();
  if (!ls) {
    report.note = `origin has no branch ${report.branch}`;
    report.ok = true;
    report.updateAvailable = false;
    emit();
    process.exit(0);
  }
  const remoteSha = ls.split(/\s+/)[0];
  report.remote = { sha: remoteSha, short: remoteSha.slice(0, 7), date: null };
} catch (err) {
  fail(`cannot reach ${report.repo}: ${(err.stderr || err.message || '').toString().trim().split('\n')[0]}`, 11);
}

// --- how far apart? needs the objects, so fetch only when they differ -----------
if (report.remote.sha === report.local.sha) {
  report.ok = true;
  report.behind = 0;
  report.ahead = 0;
  report.updateAvailable = false;
  emit();
  process.exit(0);
}

try {
  execFileSync('git', ['-C', ROOT, 'fetch', '--quiet', 'origin', report.branch], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  });
  report.behind = Number(git(['rev-list', '--count', `HEAD..origin/${report.branch}`], { tolerate: true }) ?? 0);
  report.ahead = Number(git(['rev-list', '--count', `origin/${report.branch}..HEAD`], { tolerate: true }) ?? 0);
  const remoteDate = git(['log', '-1', '--format=%cI', `origin/${report.branch}`], { tolerate: true });
  if (remoteDate) report.remote.date = remoteDate;
  report.updateAvailable = report.behind > 0;
  report.ok = true;
  if (report.behind > 0) {
    report.commits = (git(['log', '--format=%h %s', `HEAD..origin/${report.branch}`], { tolerate: true }) ?? '')
      .split('\n').filter(Boolean).slice(0, 15);
  }
} catch (err) {
  fail(`fetch failed: ${(err.stderr || err.message || '').toString().trim().split('\n')[0]}`, 11);
}

// --- apply, only on a clean fast-forward --------------------------------------
if (wantApply) {
  if (!report.updateAvailable) {
    report.note = 'nothing to apply';
  } else if (report.dirty) {
    report.note = `refused: ${report.dirtyFiles} uncommitted file(s) — commit or stash first, this repo carries work in progress`;
    emit();
    process.exit(12);
  } else {
    try {
      const before = report.local.sha;
      const out = git(['merge', '--ff-only', `origin/${report.branch}`]);
      report.applied = true;
      report.local = { ...report.local, previous: before, sha: git(['rev-parse', 'HEAD']) };
      report.local.short = report.local.sha.slice(0, 7);
      report.note = out || 'fast-forwarded';
    } catch (e) {
      report.note = `refused: not a fast-forward (${e.message})`;
      emit();
      process.exit(12);
    }
  }
}

emit();
process.exit(report.updateAvailable && !report.applied ? 10 : 0);
