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
const ENTRY_NAME = 'Electron_Wrapper_module.js';

const PURPOSE = [
  'Electron_Wrapper is THE GENERIC ELECTRON SHELL: a template + registered tabs. Hand it a',
  'template (spot(s) for tab insertions — "where tabs go and how to render") and register tabs',
  '({name, path}: the path is an ADDRESS, and the wrapper maps each tab as a div/iframe to its',
  'page); register menus (label -> function, nested, with separators); wire an event-handler',
  'instance and every tab click, menu click, tab close and the app\'s own close ("app closed")',
  'goes OUT as an event through it.',
  '',
  'It ships WITH an app tray — default ON, icon as input, a menu tree with matching onclick.',
  'Point it at a State door and each tab\'s state is PULLED and mirrored: solid (silent default)',
  '· highlighted · flashing, and a lone flashing tab auto-selects. The module wraps; it decides',
  'nothing; it is CONTENT-BLIND — what a tab renders (ComfyUI, anything) is nobody\'s business.',
  'The compiled app never needs updating: tabs and menus are registered after run start, added',
  'and popped as life goes on. Closing a tab informs the handler and pops it; registering it',
  'again brings it back.',
  '',
  'The Golden Layout dialect lives ONLY in public/ts/renderer/app.ts — the neutral arrangement',
  'is plain data, so the layout library under the wrapper stays swappable. Generic — for all',
  'projects; no project words inside. Embed it: the ONE FILE another code thread loads is',
  'Electron_Wrapper_module.js at the module root — createModule() stands the wrapper up in the',
  'host\'s thread (pass the electron surface, or run inside a real app). npm run demo is the',
  'other life: a hand-runnable dumb terminal fed by demo/template.json — edit the addresses,',
  'run, done.',
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
        '<td>THE ONE FILE LOADED — the embed entry for another code thread (re-exports the surface, adds createModule; the compiled app never needs updating — tabs/menus register after run start).</td></tr>',
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
<title>Electron_Wrapper — Docs</title>
<link rel="stylesheet" href="index.css">
</head>
<body>
<h1>Electron_Wrapper</h1>
<p class="sub">Module docs — the ONE file. Purpose + the contract (.d.ts) of every file.
Generated by <code>npm run docs</code> — edit the sources, not this file.</p>

<h2>Purpose</h2>
<div class="purpose">
${purposeHtml}
</div>

<h2>Run it</h2>
<pre>npm test               # the gate: build → typecheck → selftest
npm run demo           # the demo app (needs an electron binary; see README)
node Electron_Wrapper_module.js   # the embed entry's own check</pre>

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
