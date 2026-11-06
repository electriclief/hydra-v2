#!/usr/bin/env node
/**
 * session-start.mjs — what a NEW session runs before it plans anything.
 *
 * The point of the exercise: a session that begins on a box where every door is down still has to know what
 * the train of thought says is next. So this reads the STORE (files), prints the brief, and records the link
 * in files. The doors are used only if they happen to be up, and never block anything:
 *
 *   data/frontier.md                     the brief (generated, do not edit)
 *   SessionDiary/data/session-links.jsonl  sessionId -> thought refs, appended here
 *   POST /api/thoughts/<ref>/trail        the same link in the train, only when :8135 answers
 *
 * A session normally serves MORE THAN ONE thought, so --take is repeatable and also accepts a comma list.
 *
 * Usage:
 *   node scripts/session-start.mjs                                  # print the brief
 *   node scripts/session-start.mjs --list                           # just the refs that are ready
 *   node scripts/session-start.mjs --session <id> --take <ref>[,<ref>...] [--note "why"]
 *   node scripts/session-start.mjs --session <id> --take a --take b --quiet
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdown, snapshot } from '../public/js/frontier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DATA = path.resolve(opt('--data', path.join(ROOT, 'data')));
const LINKS = path.resolve(opt('--links', 'C:/AI/hydra-local/module/SessionDiary/data/session-links.jsonl'));
const sessionId = opt('--session', `adhoc-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const note = opt('--note', '');
const quiet = args.includes('--quiet');
const DASH = 8135;

/** every --take, in order, split on commas, without duplicates: a session usually serves several refs */
function takes() {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--take' || !args[i + 1]) continue;
    for (const part of args[i + 1].split(',')) {
      const ref = part.trim();
      if (ref && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

const storeFile = path.join(DATA, 'thoughts.json');
let nodes = [];
try {
  const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
} catch (e) {
  console.error(`session-start: cannot read ${storeFile} — ${e.message}`);
  process.exit(1);
}

const snap = snapshot(nodes);

if (args.includes('--list')) {
  for (const row of snap.takeUp) console.log(`${row.ref}\t${row.title}`);
  process.exit(0);
}

if (!quiet) {
  process.stdout.write(markdown(snap));
  process.stdout.write('\n');
}

const served = takes();
if (served.length === 0) {
  if (!quiet) {
    console.log('No --take given: nothing was recorded. A session that reads the frontier must still say');
    console.log('which refs it is serving (usually several), or the next session cannot tell what happened.');
  }
  process.exit(0);
}

const known = new Set(nodes.map((n) => n.ref));
const unknown = served.filter((ref) => !known.has(ref));
if (unknown.length) {
  console.error(`session-start: no thought with ref ${unknown.join(', ')} (see --list or frontier.md)`);
  process.exit(2);
}

// 1. the session manager's own record: one line carrying every ref, works with every door down
fs.mkdirSync(path.dirname(LINKS), { recursive: true });
fs.appendFileSync(
  LINKS,
  JSON.stringify({ at: new Date().toISOString(), sessionId, refs: served, note }) + '\n',
  'utf8',
);

// 2. the train's own trail: one line per ref, only if the door answers, and never fatal
let recorded = 0;
const failures = [];
for (const ref of served) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(`http://127.0.0.1:${DASH}/api/thoughts/${ref}/trail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        kind: 'session',
        text: note || `session ${sessionId} took this up`,
        by: 'session',
        sessionRef: sessionId,
      }),
    });
    clearTimeout(t);
    if (res.ok) recorded++;
    else failures.push(`${ref}:${res.status}`);
  } catch {
    failures.push(`${ref}:door-down`);
  }
}

const doorNote = failures.length === 0
  ? `trail recorded on :${DASH} for ${recorded}/${served.length}`
  : `${recorded}/${served.length} on the trail (${failures.join(' ')} — files still hold every link)`;

console.log(`recorded: ${sessionId} -> ${served.join(', ')} (${doorNote})`);
console.log(`links:   ${LINKS}`);
