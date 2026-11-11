#!/usr/bin/env node
/**
 * monitor.mjs — put ONE thing on a node's Hydra MONITOR from the command line.
 *
 * The operating rule this exists for (operator, 2026-11-10): the monitor is the compressed idea of the node —
 * "list of tasks you are working on, a question for me holding things up, any output". So posting to it is a
 * first-class action for an agent or a person, not something only a module may do.
 *
 * The board is a stack that shows one card, so post when it is worth the operator's eyes: a question he has to
 * answer, an output worth seeing, a task you started or finished. Do not post progress.
 *
 * Usage:
 *   node monitor.mjs --kind question --title "xpsw · needs a hand" --text "reseat the 6-pin…"
 *   node monitor.mjs --kind output   --title "xpsw · share accepted" --text "19.3 MH/s · A4 R0"
 *   node monitor.mjs --host 192.168.1.107 --port 8138 --kind question --title "…" --text "…"
 *   node monitor.mjs --show [--host …]        # what is on the board right now
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const KINDS = ['question', 'output', 'goal', 'note'];

const host = arg('host', '127.0.0.1');
const port = arg('port', '8138');
const base = `http://${host}:${port}`;
const show = process.argv.includes('--show');

function monitorFile(dir) {
  return path.join(dir, 'module', 'Echidna', 'data', 'monitor.json');
}

if (show) {
  // Read the board from disk when it is this machine, otherwise ask the door.
  if (host === '127.0.0.1') {
    const f = monitorFile(arg('root', 'C:\\AI\\hydra-local'));
    if (!fs.existsSync(f)) { console.error(`no monitor.json at ${f}`); process.exit(13); }
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    const c = (m.stack ?? [])[m.index];
    if (!c) { console.log('the board is empty'); process.exit(0); }
    console.log(`[${c.kind}] ${c.title}\n${c.text}\n(${m.index + 1} of ${(m.stack ?? []).length})`);
    process.exit(0);
  }
  try {
    const r = await fetch(`${base}/api/monitor`);
    if (!r.ok) { console.error(`GET /api/monitor -> ${r.status}`); process.exit(11); }
    console.log(JSON.stringify(await r.json(), null, 2));
  } catch (e) {
    console.error(`no answer from ${base} (${e.message})`);
    process.exit(11);
  }
  process.exit(0);
}

const kind = arg('kind', '');
const title = arg('title', '');
const text = arg('text', '');
if (!KINDS.includes(kind)) { console.error(`--kind must be one of ${KINDS.join(', ')}`); process.exit(2); }
if (!title && !text) { console.error('a card needs --title or --text'); process.exit(2); }

try {
  const r = await fetch(`${base}/api/monitor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, title, text }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await r.text();
  if (!r.ok) { console.error(`POST /api/monitor -> ${r.status} ${body}`); process.exit(11); }
  console.log(`placed [${kind}] ${title}${text ? ' — ' + text : ''}`);
} catch (e) {
  console.error(`no answer from ${base} (${e.message}) — the card was NOT placed`);
  process.exit(11);
}
