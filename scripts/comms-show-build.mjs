#!/usr/bin/env node
/**
 * comms-show-build.mjs - render every line of the portal's presentation to a wav BEFORE anybody hears it.
 *
 * The rule this exists for: nothing is synthesised while somebody is listening. A demo that runs piper between sentences
 * goes quiet, halts, and reads as a broken machine - so every line is rendered here, its real duration is measured off
 * the wav header (not estimated from the words), and data/show.json is written back carrying the file and the length.
 *
 *   node scripts/comms-show-build.mjs                 # render + measure + write back
 *   node scripts/comms-show-build.mjs --check         # measure what exists, change nothing
 *   node scripts/comms-show-build.mjs --only hello    # re-render one line
 *   node scripts/comms-show-build.mjs --length-scale 1.03
 *
 * Piper and the voice come from the node's own node.json (comms.piper / comms.voice), so the bytes that are spoken here
 * are produced by the same engine the AudioOut door would use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const MOD = path.join(ROOT, 'module', 'CommsNode');
const FILE = path.join(MOD, 'data', 'show.json');
const OUT = path.join(MOD, 'data', 'show');

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes('--' + name);

function nodeConfig() {
  for (const f of [path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), path.join(ROOT, 'module', 'Core', 'data', 'node.json')]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  }
  return {};
}
const node = nodeConfig();
const comms = node.comms || {};

const PIPER = argOf('piper', comms.piper ?? '');
const VOICE = argOf('voice', comms.voice ?? '');
const LENGTH_SCALE = String(argOf('length-scale', '1.0'));
const CHECK = flag('check');
const ONLY = argOf('only', null);

/** Duration from the wav itself: the data chunk divided by the byte rate the fmt chunk declares. */
function wavSeconds(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, byteRate = null, dataBytes = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') { dataBytes = Math.min(size, buf.length - (off + 8)); break; }
    off += 8 + size + (size % 2);
  }
  if (!byteRate || dataBytes == null) return null;
  return { seconds: dataBytes / byteRate, byteRate, bytes: buf.length };
}

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
if (!CHECK) fs.mkdirSync(OUT, { recursive: true });

if (!CHECK && (!PIPER || !fs.existsSync(PIPER))) {
  console.error(`piper not found: ${PIPER || '(comms.piper unset in node.json)'}`);
  process.exit(2);
}
if (!CHECK && (!VOICE || !fs.existsSync(VOICE))) {
  console.error(`voice not found: ${VOICE || '(comms.voice unset in node.json)'}`);
  process.exit(2);
}

let totalMs = 0, rendered = 0, failed = 0;
const rows = [];
for (const line of doc.lines) {
  if (ONLY && line.id !== ONLY) { rows.push({ id: line.id, skipped: true }); continue; }
  const wav = path.join(OUT, `${line.id}.wav`);
  if (!CHECK) {
    const r = spawnSync(PIPER, ['--model', VOICE, '--output_file', wav, '--length_scale', LENGTH_SCALE],
      { input: line.text, timeout: 180000, encoding: 'utf8' });
    const rtf = (r.stderr || '').match(/Real-time factor:\s*([\d.]+)/i);
    if (r.status !== 0 || !fs.existsSync(wav)) {
      failed++;
      rows.push({ id: line.id, error: (r.stderr || '').trim().slice(-300) });
      continue;
    }
    rendered++;
    line.wav = wav;
    line.rtf = rtf ? Number(rtf[1]) : null;
  }
  if (!fs.existsSync(wav)) { failed++; rows.push({ id: line.id, error: 'missing ' + wav }); continue; }
  const d = wavSeconds(wav);
  if (!d) { failed++; rows.push({ id: line.id, error: 'not a readable wav ' + wav }); continue; }
  line.ms = Math.round(d.seconds * 1000);
  totalMs += line.ms;
  rows.push({ id: line.id, chars: line.text.length, seconds: Number(d.seconds.toFixed(2)), ms: line.ms, rtf: line.rtf ?? null, bytes: d.bytes, byteRate: d.byteRate });
}

if (!CHECK) {
  doc.voice = path.basename(VOICE);
  doc.renderedAt = new Date().toISOString();
  doc.totalMs = totalMs;
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

const n = (v, w) => String(v).padStart(w);
console.log(`show: ${doc.title ?? '(untitled)'}  ·  ${rows.length} line(s)  ·  ${CHECK ? 'check only' : 'rendered ' + rendered}`);
for (const r of rows) {
  if (r.skipped) { console.log(`  ${r.id.padEnd(9)} (skipped)`); continue; }
  if (r.error) { console.log(`  ${r.id.padEnd(9)} ERROR ${r.error}`); continue; }
  console.log(`  ${r.id.padEnd(9)} ${n(r.seconds, 6)}s  ${n(r.ms, 6)}ms  ${n(r.chars, 4)} chars  rtf ${r.rtf ?? '-'}  ${n(r.bytes, 8)} B`);
}
const gap = Number(doc.gapMs ?? 900);
console.log(`  ${'total'.padEnd(9)} ${n((totalMs / 1000).toFixed(1), 6)}s of speech  ·  with ${gap} ms gaps: ${((totalMs + gap * doc.lines.length) / 1000 / 60).toFixed(2)} min`);
console.log(`  file: ${FILE}`);
if (failed) { console.log(`  FAILED lines: ${failed}`); process.exit(1); }
