#!/usr/bin/env node
/**
 * scripts/build-docs.cjs — generates Docs/index.html + Docs/index.css.
 *
 * One page that tells an agent everything about this module's code:
 *   1. PURPOSE (from package.json + the module's own note)
 *   2. THE EMBED ENTRY (Services_module.js) — its declared surface
 *   3. every source under public/ts/ — its header block + its emitted .d.ts contract,
 *      both as escaped <pre> blocks
 *
 * Emits declarations with tsc (--declaration --emitDeclarationOnly --outDir Docs/types),
 * then assembles the page. The html is GENERATED — never hand-edit it; re-run `npm run docs`.
 */

'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TS_DIR = path.join(ROOT, 'public', 'ts');
const TYPES_DIR = path.join(ROOT, 'Docs', 'types');
const DOCS_DIR = path.join(ROOT, 'Docs');
const ENTRY = path.join(ROOT, 'ResourceManager_module.js');

const PURPOSE = [
  'Resource Manager — the register. Reads this node\'s resources (cpu cores · gpus with vram truth',
  '· ram · disks · Hydra shared folders · observed gpu-side processes) and keeps BOOKINGS: what a run',
  'holds (amounts for cores/ram/disk, a gpu whole+pinned, paths by subtree). No internal logic — poll',
  'is a pure read, book the one write, pop/clear the exits; the only rule is it won\'t allow double',
  'booking (1 app per gpu). Not enforcement — voluntary all the way.',
].join(' ');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function headerOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^\/\*\*[\s\S]*?\*\//);
  return match ? match[0] : '(no header block)';
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emitTypes() {
  console.log('emitting declarations to Docs/types/ …');
  execSync('npx tsc -p tsconfig.json --noEmit false --declaration --emitDeclarationOnly --outDir Docs/types', {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function dtsFor(tsFile) {
  const relPath = path.relative(TS_DIR, tsFile).replace(/\.ts$/, '.d.ts');
  const dts = path.join(TYPES_DIR, relPath);
  if (!fs.existsSync(dts)) return '(no declarations emitted for this file)';
  return fs.readFileSync(dts, 'utf8');
}

/** The embed entry's declared surface — the names another thread can pull off it. */
function entrySurface() {
  if (!fs.existsSync(ENTRY)) return null;
  const text = fs.readFileSync(ENTRY, 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  const block = text.match(/export\s*\{([\s\S]*?)\};/);
  if (block) {
    for (const piece of block[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return { file: ENTRY, text, names: [...names].sort() };
}

function build() {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  emitTypes();

  const sources = walk(TS_DIR).sort();
  const entry = entrySurface();

  const sections = [];
  sections.push(`<section class="purpose"><h2>Purpose</h2><p>${escapeHtml(PURPOSE)}</p></section>`);

  if (entry) {
    sections.push(
      `<section class="entry"><h2>${escapeHtml(rel(entry.file))} <span class="dim">— the embed entry</span></h2>` +
        `<p class="dim">Declared surface: ${entry.names.map((n) => `<code>${escapeHtml(n)}</code>`).join(' · ')}</p>` +
        `<pre>${escapeHtml(entry.text)}</pre></section>`,
    );
  }

  for (const source of sources) {
    sections.push(
      `<section class="source"><h2>${escapeHtml(rel(source))}</h2>` +
        `<pre class="header">${escapeHtml(headerOf(source))}</pre>` +
        `<pre class="contract">${escapeHtml(dtsFor(source))}</pre></section>`,
    );
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resource Manager — module docs</title>
<link rel="stylesheet" href="./index.css">
</head>
<body>
<header><h1>Resource Manager</h1><p class="dim">generated ${new Date().toISOString()} — re-run <code>npm run docs</code> after any change; never hand-edit</p></header>
<main>
${sections.join('\n')}
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), html);

  const css = `:root { --ink:#d8dee9; --dim:#7b8794; --back:#10141a; --line:#2a3441; --code:#1b232e; }
* { box-sizing: border-box; }
body { margin:0; background:var(--back); color:var(--ink); font:14px/1.55 "Segoe UI", system-ui, sans-serif; }
header { padding:20px 26px 8px; border-bottom:1px solid var(--line); }
header h1 { margin:0 0 4px; font-size:22px; }
main { padding:12px 26px 60px; max-width:1100px; }
section { margin:22px 0; padding:14px 16px; background:#141a22; border:1px solid var(--line); border-radius:8px; }
section h2 { margin:0 0 8px; font-size:15px; color:#9ecbff; }
.dim { color:var(--dim); }
code { background:var(--code); padding:1px 5px; border-radius:4px; }
pre { margin:8px 0; padding:10px 12px; background:var(--code); border:1px solid var(--line); border-radius:6px; overflow:auto; font:12px/1.5 Consolas, monospace; white-space:pre-wrap; }
pre.header { max-height:260px; }
pre.contract { max-height:520px; }
`;
  fs.writeFileSync(path.join(DOCS_DIR, 'index.css'), css);

  console.log(`Docs/index.html written — ${sources.length} sources + the entry surface.`);
}

build();
