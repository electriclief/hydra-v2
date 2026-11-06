#!/usr/bin/env node
/*
 * build-docs.cjs — assembles Docs/index.html: THE ONE FILE an agent reads.
 *
 * Standard (operator, 2026-09-16): every module carries a Docs/ folder —
 * minimum index.html that includes PURPOSE + the .d.ts contract of every
 * included file (so one file tells an agent everything about the code it
 * needs), plus index.css (style only — never read by agents).
 *
 * The .d.ts files are emitted from the TypeScript sources to Docs/types/.
 * Usage: npm run docs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TS_DIR = path.join(ROOT, 'public', 'ts');
const TYPES_DIR = path.join(ROOT, 'Docs', 'types');
const OUT_FILE = path.join(ROOT, 'Docs', 'index.html');
const ENTRY_NAME = 'State_module.js';

const PURPOSE = [
  'State is THE GENERIC RETAINER AND RETRIEVER: register ANY object under a dotted-path name',
  '(the tree falls straight out of the string); pull it back — the whole thing, or the part',
  'past the marks the requester carries, when an element was registered "to be delta served";',
  'discover what is held (the SHAPE is listed; contents are pulled, never embedded); drop it.',
  '',
  'Entries describe THEMSELVES — a lazy liveness check · a pull recipe (how the entry answers) ·',
  'per-element serving flags · a render map · an update contract — and the module reads only',
  'what it must, understands none of it, and decides nothing: new / unknown / stale mark →',
  'the FULL state; a fresh mark + a flagged element → the delta past the mark. A pull resolves',
  'by the shortest unique suffix (the leaf works when it is unique; ambiguity is refused WITH',
  'the candidates). A registration lives exactly as long as its registrant — a dead registrant',
  'is popped; absence reads as absence. Refresh is two-sided (source speed + requester speed)',
  'and State controls NEITHER: it runs no clocks, remembers nobody. Vocabulary only:',
  'register · pull · discover · relay.',
  '',
  'Generic — for all projects; no project words inside. It stands alone, and it is the piece',
  'Hydra (v2) will use as its State later — by registration, never by module knowledge. Embed',
  'it: the ONE FILE another code thread loads is State_module.js at the module root — it',
  're-exports the whole surface and adds createModule() / startModule(). The registry boots',
  'BLANK and persists nothing; the host registers what it wants seen. npm start is different:',
  'the module\'s own local thread.',
].join('\n');

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function walk(dir, prefix = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? path.join(prefix, name) : name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function headerOf(source) {
  const match = source.match(/^\/\*\*?[\s\S]*?\*\//);
  return match ? match[0].trim() : '(no header)';
}

function summarize(header) {
  const lines = header.split('\n').map((line) => line.replace(/^\s*\/?\*+\s?/, '').trim());
  const parts = [];
  let collecting = false;
  for (const line of lines) {
    if (line.startsWith('@description')) {
      collecting = true;
      parts.push(line.replace('@description', '').trim());
      continue;
    }
    if (collecting && line.startsWith('@')) break;
    if (collecting && line) parts.push(line);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? text.slice(0, 237) + '…' : text || '(no description)';
}

function main() {
  // 1. emit the .d.ts contracts (this also typechecks the sources)
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) throw new Error('typescript is not installed — run npm install first');
  execFileSync(process.execPath, [tsc, '--declaration', '--emitDeclarationOnly', '--outDir', 'Docs/types'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // 2. collect the sources + their contracts
  const files = walk(TS_DIR);
  const rows = [];
  const blocks = [];

  // the embed entry first — it is the whole-module view
  const entryPath = path.join(ROOT, ENTRY_NAME);
  if (fs.existsSync(entryPath)) {
    const src = fs.readFileSync(entryPath, 'utf8');
    const header = headerOf(src);
    const surface = src
      .split('\n')
      .filter((line) => line.startsWith('export ') || line.startsWith('import '))
      .join('\n');
    rows.push(
      `<tr><td><a href="#f-entry"><code>${ENTRY_NAME}</code></a></td>` +
        '<td>THE ONE FILE LOADED — the embed entry for another code thread (re-exports the surface, adds createModule/startModule; boots blank — the host registers what it wants seen).</td></tr>',
    );
    blocks.push(`<section id="f-entry">
  <h3><code>${ENTRY_NAME}</code> <span class="tag">the embed entry — the one file loaded</span></h3>
  <p class="caption">header</p>
  <pre>${esc(header)}</pre>
  <p class="caption">contract — the declared surface</p>
  <pre class="dts">${esc(surface)}</pre>
</section>`);
  }

  for (const rel of files) {
    const source = fs.readFileSync(path.join(TS_DIR, rel), 'utf8');
    const header = headerOf(source);
    const dtsRel = rel.replace(/\.ts$/, '.d.ts');
    const dtsPath = path.join(TYPES_DIR, dtsRel);
    const dts = fs.existsSync(dtsPath) ? fs.readFileSync(dtsPath, 'utf8') : '(missing — re-run npm run docs)';
    const id = 'f-' + rel.replace(/[\\/.]/g, '-');
    rows.push(
      `<tr><td><a href="#${id}"><code>${esc(rel)}</code></a></td><td>${esc(summarize(header))}</td></tr>`,
    );
    blocks.push(`<section id="${id}">
  <h3><code>${esc(rel)}</code></h3>
  <p class="caption">header</p>
  <pre>${esc(header)}</pre>
  <p class="caption">contract — ${esc(dtsRel)} (as TypeScript sees it)</p>
  <pre class="dts">${esc(dts)}</pre>
</section>`);
  }

  // 3. assemble
  const purposeHtml = PURPOSE.split('\n\n')
    .map((para) => `<p>${esc(para)}</p>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>State — Docs</title>
<link rel="stylesheet" href="index.css">
</head>
<body>
<h1>State</h1>
<p class="sub">Module docs — the ONE file. Purpose + the contract (.d.ts) of every file.
Generated by <code>npm run docs</code> — edit the sources, not this file.</p>

<h2>Purpose</h2>
<div class="purpose">
${purposeHtml}
</div>

<h2>Run it</h2>
<pre>npm test          # the gate: build → typecheck → selftest
npm start         # GUI + API + MCP on http://127.0.0.1:8127
node State_module.js   # the embed entry's own check</pre>

<h2>Files</h2>
<table>
<thead><tr><th>File</th><th>What it does</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>

<h2>The contracts</h2>
${blocks.join('\n')}

<footer>Generated ${new Date().toISOString()} by <code>scripts/build-docs.cjs</code> — ${files.length + (fs.existsSync(entryPath) ? 1 : 0)} files. The gate keeps the code honest; this file keeps an agent oriented.</footer>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log(`docs written → ${path.relative(ROOT, OUT_FILE)} (${files.length} ts files + entry, ${Buffer.byteLength(html)} bytes)`);
}

main();
