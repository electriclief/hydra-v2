/**
 * @module selftest
 * @description THE GATE — every module's own self-check, one after another, in one
 *              process: serviceSchema · serviceFile · serviceCatalog · mcpTools ·
 *              mcpServer · staticFiles · apiServer · client · browser/gui · main.
 *              `npm run selftest` is the single command. console.assert failures are
 *              COUNTED (a failed assertion, not only a thrown error, fails the gate),
 *              and main goes last — it binds a real port — so the gate ends the way a
 *              run starts.
 * @intent THE MODULAR LAW (operator): every module carries its own self-check — a module
 *         that cannot prove itself on demand does not ship.
 */

import { pathToFileURL } from 'node:url';

// --- Interface Definitions ---

export interface GateResult {
  module: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

// --- Function Definitions ---

/** Every module this gate walks, in order. main last (it binds a real port). */
export const DEFAULT_MODULES = ['serviceSchema', 'serviceFile', 'serviceCatalog', 'mcpTools', 'mcpServer', 'staticFiles', 'apiServer', 'client', 'browser/gui', 'main'];

/** Run one module's own tests with assertion counting. Never throws. */
export async function runGate(modules: string[] = DEFAULT_MODULES, log: (line: string) => void = console.log): Promise<{ ok: boolean; results: GateResult[] }> {
  const results: GateResult[] = [];
  const originalAssert = console.assert.bind(console);
  let assertionFailures = 0;
  console.assert = ((condition?: unknown, ...rest: unknown[]) => {
    if (!condition) assertionFailures++;
    originalAssert(condition as boolean, ...rest);
  }) as typeof console.assert;

  try {
    for (const name of modules) {
      assertionFailures = 0;
      const url = new URL(name.endsWith('.js') ? './' + name : './' + name + '.js', import.meta.url);
      try {
        const mod = (await import(url.href)) as { runTests?: () => Promise<void> | void };
        if (typeof mod.runTests !== 'function') {
          results.push({ module: name, status: 'skip', detail: 'no runTests exported' });
          log(`SKIP ${name} — no runTests exported`);
          continue;
        }
        await mod.runTests();
        const failed = assertionFailures;
        if (failed > 0) {
          results.push({ module: name, status: 'fail', detail: `${failed} assertion(s) failed` });
          log(`FAIL ${name} — ${failed} assertion(s) failed`);
        } else {
          results.push({ module: name, status: 'pass', detail: '' });
          log(`PASS ${name}`);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({ module: name, status: 'fail', detail });
        log(`FAIL ${name} — ${detail}`);
      }
    }
  } finally {
    console.assert = originalAssert;
  }

  const ok = results.every((result) => result.status !== 'fail');
  return { ok, results };
}

export async function main(): Promise<void> {
  console.log('[services gate] every module\'s own self-check, one command');
  const { ok, results } = await runGate();
  const failed = results.filter((result) => result.status === 'fail');
  console.log(`[services gate] ${results.length - failed.length}/${results.length} modules green`);
  if (!ok) process.exitCode = 1;
}

const isDirect = (() => {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();
if (isDirect) void main();
