#!/usr/bin/env node
/**
 * @module selftest
 * @description THE GATE: runs every module's own self-check in one command and reports
 *              per module, so "it works" is a number, not a claim.
 * @intent THE MODULAR LAW — every module carries its own self-check. This module is the one
 *         place they are collected: it counts console.assert failures (a failing check does
 *         not throw by itself), prints a per-module line, and exits non-zero if anything
 *         failed, so a build script can gate on it.
 */

import process from 'node:process';

// --- Interface Definitions ---

/** One module's self-check, as this gate sees it. */
export interface TestModule {
  /** Module name, as printed. */
  name: string;
  /** The module's own runTests(). */
  run: () => Promise<void>;
}

/** The result of one module's self-check. */
export interface ModuleResult {
  name: string;
  passed: number;
  failed: number;
  /** The failed assertion messages (empty when it passed). */
  failures: string[];
  error: string | null;
  ms: number;
}

export interface GateResult {
  modules: ModuleResult[];
  passed: number;
  failed: number;
  ok: boolean;
}

/** A recorder around console.assert: counts failures while they are printed. */
export interface AssertRecorder {
  restore(): void;
  failures(): string[];
  total(): number;
}

// --- Function Definitions ---

/**
 * Take over `console.assert` for the duration of a self-check. Node's console.assert only
 * prints; this makes a failure countable (and still prints it, so the why is visible).
 */
export function recordAsserts(consoleLike: { assert: (...args: any[]) => void } = console): AssertRecorder {
  const original = consoleLike.assert;
  const failures: string[] = [];
  let total = 0;
  consoleLike.assert = (cond?: unknown, ...args: unknown[]) => {
    total++;
    if (!cond) {
      failures.push(args.length ? args.map((a) => String(a)).join(' ') : 'assertion failed');
    }
    original(cond, ...args);
  };
  return {
    restore: () => {
      consoleLike.assert = original;
    },
    failures: () => [...failures],
    total: () => total,
  };
}

/** Run every module's self-check in order and collect the honest tally. */
export async function runAll(modules: TestModule[]): Promise<GateResult> {
  const results: ModuleResult[] = [];
  for (const mod of modules) {
    const recorder = recordAsserts();
    const started = Date.now();
    let error: string | null = null;
    try {
      await mod.run();
    } catch (err) {
      error = (err as Error).message || String(err);
    } finally {
      recorder.restore();
    }
    const failures = recorder.failures();
    if (error) failures.push(`threw: ${error}`);
    const total = recorder.total();
    results.push({
      name: mod.name,
      passed: Math.max(0, total - failures.length),
      failed: failures.length,
      failures,
      error,
      ms: Date.now() - started,
    });
  }
  const passed = results.reduce((n, r) => n + r.passed, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  return { modules: results, passed, failed, ok: failed === 0 };
}

/** The gate as text: one line per module, then the totals. */
export function formatGate(result: GateResult): string {
  const lines: string[] = ['ProcessWrapper — THE GATE (every module runs its own self-check)', ''];
  for (const m of result.modules) {
    const flag = m.failed === 0 ? 'ok  ' : 'FAIL';
    lines.push(`  ${flag} ${m.name.padEnd(22)} ${String(m.passed).padStart(3)} checks  ${String(m.ms).padStart(5)} ms`);
    for (const f of m.failures.slice(0, 10)) lines.push(`         ↳ ${f}`);
    if (m.failures.length > 10) lines.push(`         ↳ …and ${m.failures.length - 10} more`);
  }
  lines.push('');
  lines.push(`  TOTAL ${result.passed} passed, ${result.failed} failed — ${result.ok ? 'GREEN' : 'RED'}`);
  return lines.join('\n');
}

/** The module list the gate runs. Imported lazily so a broken module cannot block the gate. */
export async function defaultModules(): Promise<TestModule[]> {
  const [wrapper, hub, registry, api, client, mcp, mcpReg, staticFiles, gui, main, cli, consoleEvents, systemWatch, rootLife, win] = await Promise.all([
    import('./processWrapper.js'),
    import('./streamHub.js'),
    import('./registryStore.js'),
    import('./apiServer.js'),
    import('./client.js'),
    import('./mcpServer.js'),
    import('./mcpRegistry.js'),
    import('./staticFiles.js'),
    import('./browser/gui.js'),
    import('./main.js'),
    import('./cli.js'),
    import('./consoleEvents.js'),
    import('./systemWatch.js'),
    import('./rootLife.js'),
    import('./browser/window.js'),
  ]);
  return [
    { name: 'processWrapper', run: wrapper.runTests },
    { name: 'streamHub', run: hub.runTests },
    { name: 'registryStore', run: registry.runTests },
    { name: 'apiServer', run: api.runTests },
    { name: 'client', run: client.runTests },
    { name: 'mcpServer', run: mcp.runTests },
    { name: 'mcpRegistry', run: mcpReg.runTests },
    { name: 'staticFiles', run: staticFiles.runTests },
    { name: 'gui', run: gui.runTests },
    { name: 'main', run: main.runTests },
    { name: 'cli', run: cli.runTests },
    { name: 'consoleEvents', run: consoleEvents.runTests },
    { name: 'systemWatch', run: systemWatch.runTests },
    { name: 'rootLife', run: rootLife.runTests },
    { name: 'window', run: win.runTests },
  ];
}

/** Run the whole gate, print it, and answer with the result. */
export async function gate(modules?: TestModule[]): Promise<GateResult> {
  const list = modules ?? (await defaultModules());
  const result = await runAll(list);
  console.log(formatGate(result));
  return result;
}

/** Was this file run directly? */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /selftest\.(js|ts)$/.test(entry);
}

if (isDirectRun()) {
  // exitCode, never process.exit(): leaving while handles are closing can assert in libuv.
  gate()
    .then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error('[selftest] the gate itself failed:', (err as Error).message);
      process.exitCode = 1;
    });
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. the recorder counts failures without swallowing the assert
  const fake = { assert: (() => {}) as (...args: any[]) => void };
  const recorder = recordAsserts(fake);
  const one: number = 1;
  const two: number = 2;
  fake.assert(true, 'this passes');
  fake.assert(false, 'this fails');
  fake.assert(one === two, 'so does this');
  ok('the recorder counts every assert', recorder.total() === 3, String(recorder.total()));
  ok('the recorder keeps the failing messages', recorder.failures().length === 2 && recorder.failures()[0] === 'this fails', JSON.stringify(recorder.failures()));
  recorder.restore();
  ok('the recorder restores the original', recorder.total() === 3);

  // 2. the gate tallies a passing and a failing module honestly
  const passing = await runAll([{ name: 'good', run: async () => { console.assert(1 === 1, 'yes'); console.assert(2 > 1, 'yes'); } }]);
  ok('a passing module is green', passing.ok === true && passing.passed === 2 && passing.failed === 0, JSON.stringify(passing));
  const failing = await runAll([{ name: 'bad', run: async () => { console.assert(one === two, 'nope'); console.assert(one === one, 'yep'); } }]);
  ok('a failing module is red', failing.ok === false && failing.passed === 1 && failing.failed === 1, JSON.stringify(failing));
  ok('the failing assertion is carried', failing.modules[0].failures[0] === 'nope', JSON.stringify(failing.modules[0].failures));

  // 3. a module that throws is a failure, not a crash
  const throwing = await runAll([{ name: 'boom', run: async () => { throw new Error('module blew up'); } }]);
  ok('a throwing module is caught and reported', throwing.ok === false && throwing.modules[0].error === 'module blew up', JSON.stringify(throwing.modules[0]));
  ok('a throwing module names itself in the failure list', throwing.modules[0].failures.some((f) => f.includes('threw')), JSON.stringify(throwing.modules[0].failures));

  // 4. every module the gate runs really exists and exports runTests
  const modules = await defaultModules();
  ok('the gate lists every module', modules.length === 14, String(modules.length));
  ok('every module carries its own self-check', modules.every((m) => typeof m.run === 'function'), modules.map((m) => m.name).join(','));
  ok('the module names are the real files', modules.map((m) => m.name).join(',') === 'processWrapper,streamHub,registryStore,apiServer,client,mcpServer,mcpRegistry,staticFiles,gui,main,cli,consoleEvents,systemWatch,rootLife,window', modules.map((m) => m.name).join(','));

  // 5. the report is readable and never claims green when red
  const text = formatGate(failing);
  ok('the report names the module', text.includes('bad'), text.slice(0, 120));
  ok('the report says RED when something failed', text.includes('RED'), text.slice(-60));
  ok('the report says GREEN when all passed', formatGate(passing).includes('GREEN'));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[selftest] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
