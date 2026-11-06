/**
 * @module serviceFile
 * @description Read ONE service file — a `.js` file that assigns a literal object to
 *              `module.exports` — as DATA. It is never imported, never executed in the
 *              host: the text is gated (leading comments welcome, then exactly ONE
 *              `module.exports = <literal>`; no code tokens), run in an EMPTY vm sandbox
 *              (no require, no process, no filesystem, no network, code generation off,
 *              2 s timeout), scanned deep for function values, and then validated against
 *              the schema. A file that fails any rung is refused with a reason — the
 *              catalog carries the refusal, nothing crashes.
 * @intent Operator ruling (2026-09-23): "`.js` is best I think too" — one .js file per
 *         service; and the tie (2026-09-23): "a shared service file must not execute on
 *         receipt — load it as DATA." Heavy items travel by LINK, never inside the file;
 *         small images inline as base64; the pages ride as strings (write page scripts
 *         with string concatenation — a literal `${` is refused, and nested backticks end
 *         the literal). Honest limits: the token gate refuses the obvious, the sandbox is
 *         the real door — even a file that slipped past every gate would be running in an
 *         empty 2-second room with no doors, and its result must still be pure data.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import { validateService, type ServiceDefinition, type ValidationReport } from './serviceSchema.js';

// --- Interface Definitions ---

export interface ServiceFileResult {
  /** The file that was read. */
  file: string;
  /** The loaded definition (present only when everything passed). */
  definition: ServiceDefinition | null;
  /** The schema report (errors/warnings) — present even when refused early. */
  report: ValidationReport;
  /** The refusal reason, when the file never became data. */
  error: string | null;
}

/** Tokens that are code, not data — refused anywhere in the text. */
export const CODE_TOKENS = ['${', 'require(', 'import(', 'globalThis', 'eval(', 'Function(', 'process.env', 'child_process'];

// --- Function Definitions ---

/** The exact shape: comments first, then ONE assignment of a literal. */
const FILE_PATTERN = /^(?:\s|(?:\/\/[^\n]*\n)|\/\*[\s\S]*?\*\/)*module\.exports\s*=\s*[\s\S]*$/;

/** Strip comments — used only for counting assignments, never for the token gate. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function refused(file: string, reason: string): ServiceFileResult {
  return {
    file,
    definition: null,
    report: { ok: false, errors: [{ level: 'error', field: '$file', message: reason }], warnings: [] },
    error: reason,
  };
}

/** Walk the loaded value: functions, symbols, bigints and cycles are refused with a path. */
export function findRefusedValue(value: unknown, pathStr = '$', seen = new Set<unknown>(), depth = 0): string | null {
  if (depth > 32) return `${pathStr}: nesting too deep`;
  const kind = typeof value;
  if (kind === 'function') return `${pathStr}: a function value — a service file is data, never code`;
  if (kind === 'symbol' || kind === 'bigint') return `${pathStr}: a ${kind} value — not data`;
  if (value && (kind === 'object')) {
    if (seen.has(value)) return `${pathStr}: a circular reference`;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = findRefusedValue(value[i], `${pathStr}[${i}]`, seen, depth + 1);
        if (hit) return hit;
      }
    } else {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        const hit = findRefusedValue(inner, `${pathStr}.${key}`, seen, depth + 1);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/** The whole rung-ladder over TEXT (no fs) — the testable heart. */
export function loadServiceText(text: string): { value: unknown; error: string | null } {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { value: null, error: 'the file is empty' };
  }
  if (!FILE_PATTERN.test(text)) {
    return { value: null, error: 'not a service file: comments may lead, but the file must then assign ONE literal — `module.exports = <literal>;`' };
  }
  const assignments = stripComments(text).split('module.exports').length - 1;
  if (assignments !== 1) {
    return { value: null, error: `refused: exactly one module.exports assignment, found ${assignments} — comments may mention the phrase, the code may not repeat it` };
  }
  const hit = CODE_TOKENS.find((token) => text.includes(token));
  if (hit) {
    return { value: null, error: `refused: the text contains "${hit}" — a service file is DATA; page scripts use concatenation, heavy items use links` };
  }
  try {
    // An EMPTY sandbox: no require, no process, no globals; code generation from strings off.
    const sandbox: Record<string, unknown> = { module: { exports: {} } };
    const context = vm.createContext(sandbox, { name: 'service-file', codeGeneration: { strings: false, wasm: false } });
    const value = vm.runInContext(text, context, { timeout: 2000 });
    const asValue = value === undefined ? (sandbox.module as { exports: unknown }).exports : value;
    const refusedPath = findRefusedValue(asValue);
    if (refusedPath) return { value: null, error: `refused: ${refusedPath}` };
    return { value: asValue, error: null };
  } catch (err) {
    return { value: null, error: `the literal did not load: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Read one file from disk and carry it through every rung. */
export function loadServiceFile(filePath: string): ServiceFileResult {
  let text: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2_000_000) return refused(filePath, 'the file is over 2 MB — the definition is meant to be tiny; heavy items go by link');
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return refused(filePath, `cannot read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const loaded = loadServiceText(text);
  if (loaded.error) return refused(filePath, loaded.error);
  const report = validateService(loaded.value);
  return {
    file: filePath,
    definition: report.ok ? (loaded.value as ServiceDefinition) : null,
    report,
    error: report.ok ? null : `the definition did not validate: ${report.errors.map((e) => e.field + ': ' + e.message).join(' · ')}`,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const path = await import('node:path');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-file-'));

  // 1. a REAL good file — a leading comment, template-literal pages, tiny base64, links
  const good = [
    '// demo — a starter service file: comments may lead, then ONE data assignment',
    'module.exports = {',
    '  name: "demo",',
    '  advert: { what: "a demo", karma: 2 },',
    '  provider: { name: "python demo" },',
    '  pages: { ad: `<h1>demo</h1><img src="data:image/png;base64,iVBORw0KGgo=">`, inputs: `<h1>in</h1>` },',
    '};',
  ].join('\n');
  const goodPath = path.join(dir, 'demo.js');
  fs.writeFileSync(goodPath, good);
  const loadGood = loadServiceFile(goodPath);
  ok('a real good file loads as data', loadGood.definition !== null && loadGood.error === null, String(loadGood.error));
  ok('the pages ride out as strings', typeof loadGood.definition?.pages?.ad === 'string' && loadGood.definition.pages.ad.includes('<h1>demo</h1>') && loadGood.definition.pages.inputs.includes('<h1>in</h1>'));

  // 2. the refusals — each for its own reason
  const requires = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, evil: require("fs") };';
  ok('a require() is refused as code', (loadServiceText(requires).error ?? '').includes('require('));

  const interpolates = 'module.exports = { name: "x", page: `<p>${process.env.SECRET}</p>`, advert: { what: "x" }, provider: { name: "x" } };';
  ok('a ${ interpolation is refused', (loadServiceText(interpolates).error ?? '').includes('${'));

  const fnValue = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, hand: (function(){ return 1; }) };';
  ok('a function value is refused with its path', (loadServiceText(fnValue).error ?? '').includes('$.hand'));

  const notAFile = 'export default { name: "x" };';
  ok('a foreign shape is refused', (loadServiceText(notAFile).error ?? '').includes('module.exports'));

  ok('empty text is refused', (loadServiceText('   ').error ?? '').includes('empty'));

  const brokenLiteral = 'module.exports = { name: "x", page: "<p>x</p>", ;';
  ok('a broken literal is refused with the load error', (loadServiceText(brokenLiteral).error ?? '').includes('did not load'));

  const double = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" } };\nmodule.exports = { name: "y" };';
  ok('a second assignment is refused', (loadServiceText(double).error ?? '').includes('exactly one'));

  const mentionsInComment = '// this file assigns module.exports once — that sentence must not break the count\nmodule.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" } };';
  ok('a comment may mention the phrase', loadServiceText(mentionsInComment).error === null, String(loadServiceText(mentionsInComment).error));

  // 3. schema rides along — a loadable but invalid definition is refused at the last rung
  const invalid = 'module.exports = { name: "", page: "" };';
  const invalidPath = path.join(dir, 'invalid.js');
  fs.writeFileSync(invalidPath, invalid);
  const loadInvalid = loadServiceFile(invalidPath);
  ok('an invalid definition is refused with its fields', loadInvalid.definition === null && (loadInvalid.error ?? '').includes('name'));

  const missing = loadServiceFile(path.join(dir, 'nowhere.js'));
  ok('a missing file is refused, not thrown', missing.definition === null && (missing.error ?? '').includes('cannot read'));

  // 4. sandbox has no doors even if the gate is bypassed in test
  const sneak = 'module.exports = { name: "x", page: "<p>x</p>", advert: { what: "x" }, provider: { name: "x" }, probe: (typeof process === "undefined" ? 1 : 2) };';
  const sneakLoad = loadServiceText(sneak);
  ok('the sandbox has no process (age 1, not 2)', sneakLoad.error === null && (sneakLoad.value as { probe: number }).probe === 1, String(sneakLoad.error));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[serviceFile] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
