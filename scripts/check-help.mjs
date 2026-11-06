#!/usr/bin/env node
/**
 * The documentation gate.
 *
 * A module's help.html is not decoration: it is the only place a human (or an agent) can find out what the module
 * is for without reading its source. So it has a shape, and the shape is checked:
 *
 *   <h1>                    the module's name, once
 *   #summary                one paragraph, what it is supposed to do
 *   #concepts               how its variables and structures hold together, in words
 *   #wiring                 what it needs and what it gives back — human wiring, not a .d.ts
 *   #contract (optional)    the same wiring as JSON, so an app can read it without parsing prose
 *
 * A module with no help.html is a WARNING (the standard is rolling out). A module with a malformed help.html is
 * an ERROR, because a page that exists and lies is worse than no page at all.
 *
 *   node scripts/check-help.mjs            # check, warn on missing
 *   node scripts/check-help.mjs --strict   # missing pages are errors too
 *   node scripts/check-help.mjs --json     # the index a docs app would render
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const MODULES = path.join(ROOT, 'module');

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const AS_JSON = args.has('--json');

const text = (html, re) => {
  const m = html.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

/** Everything a docs app needs from one help.html, without rendering it. */
export function extract(html) {
  const contractRaw = text(html, /<script[^>]*id="contract"[^>]*>([\s\S]*?)<\/script>/);
  let contract = null;
  if (contractRaw) {
    try {
      contract = JSON.parse(contractRaw);
    } catch {
      contract = 'INVALID';
    }
  }
  return {
    title: text(html, /<h1[^>]*>([\s\S]*?)<\/h1>/),
    kicker: text(html, /<p class="kicker"[^>]*>([\s\S]*?)<\/p>/),
    summary: text(html, /<section[^>]*id="summary"[^>]*>([\s\S]*?)<\/section>/),
    hasConcepts: /<section[^>]*id="concepts"/.test(html),
    hasWiring: /<section[^>]*id="wiring"/.test(html),
    contract,
  };
}

const rows = [];
const problems = [];
const missing = [];

for (const dir of fs.readdirSync(MODULES, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const dirPath = path.join(MODULES, dir.name);
  const joinFile = path.join(dirPath, 'join.json');
  const helpFile = path.join(dirPath, 'help.html');
  const hasJoin = fs.existsSync(joinFile);

  if (!fs.existsSync(helpFile)) {
    missing.push(dir.name);
    if (hasJoin) rows.push({ module: dir.name, status: 'no page' });
    if (STRICT) problems.push(`${dir.name}: no help.html`);
    continue;
  }

  const html = fs.readFileSync(helpFile, 'utf8');
  const found = extract(html);
  const issues = [];
  if (!found.title) issues.push('no <h1>');
  if (!found.summary || found.summary.length < 80) issues.push('#summary is missing or too thin (min 80 chars)');
  if (!found.hasConcepts) issues.push('no #concepts');
  if (!found.hasWiring) issues.push('no #wiring');
  if (found.contract === 'INVALID') issues.push('#contract is not valid JSON');
  if (found.contract && found.contract !== null) {
    if (!Array.isArray(found.contract.needs)) issues.push('#contract.needs is not an array');
    if (!Array.isArray(found.contract.gives)) issues.push('#contract.gives is not an array');
    if (!found.contract.module) issues.push('#contract.module is missing');
  }

  rows.push({
    module: dir.name,
    status: issues.length ? 'BROKEN' : 'ok',
    title: found.title,
    kicker: found.kicker,
    summaryChars: found.summary ? found.summary.length : 0,
    contract: Boolean(found.contract),
    needs: found.contract && found.contract.needs ? found.contract.needs.length : null,
    gives: found.contract && found.contract.gives ? found.contract.gives.length : null,
    issues,
  });
  for (const issue of issues) problems.push(`${dir.name}: ${issue}`);
}

if (AS_JSON) {
  console.log(JSON.stringify({ ok: problems.length === 0, modules: rows }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

for (const row of rows) {
  if (row.status === 'ok') {
    console.log(`  ok    ${row.module.padEnd(16)} "${row.title}"  summary ${row.summaryChars}ch  contract ${row.contract ? `yes (${row.needs} needs / ${row.gives} gives)` : 'no'}`);
  } else if (row.status === 'no page') {
    console.log(`  --    ${row.module.padEnd(16)} no help.html yet`);
  } else {
    console.log(`  FAIL  ${row.module.padEnd(16)} ${row.issues.join('; ')}`);
  }
}

const documented = rows.filter((r) => r.status === 'ok').length;
const total = rows.filter((r) => r.status !== undefined).length;
console.log(`\nDocs — ${documented}/${total} modules documented${missing.length ? `, ${missing.length} without a page` : ''} — ${problems.length ? 'RED' : 'GREEN'}`);
if (missing.length && !STRICT) console.log(`  missing: ${missing.join(', ')}`);
process.exit(problems.length ? 1 : 0);
