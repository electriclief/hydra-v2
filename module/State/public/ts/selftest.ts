/**
 * @module selftest
 * @description THE GATE: runs every module's own runTests() in one command, counts
 *              console.assert calls and failures per module, prints GREEN/RED and sets
 *              process.exitCode (never process.exit) so `npm test` can gate on it.
 * @intent Every module carries its own self-check — this is the one hand that runs them all.
 */

// --- Interface Definitions ---

export interface TestModule {
  name: string;
  load: () => Promise<{ runTests?: () => Promise<void> }>;
}

export interface ModuleResult {
  name: string;
  asserts: number;
  failed: number;
  error: string | null;
}

export interface GateResult {
  modules: ModuleResult[];
  asserts: number;
  failed: number;
  errors: number;
  green: boolean;
}

export interface AssertRecorder {
  stop: () => void;
  readonly asserts: number;
  readonly failed: number;
  readonly failures: string[];
}

// --- Function Definitions ---

/** Count console.assert calls while a module's self-check runs. */
export function recordAsserts(consoleLike: Pick<Console, 'assert'> = console): AssertRecorder {
  const original = consoleLike.assert;
  let asserts = 0;
  let failed = 0;
  const failures: string[] = [];
  consoleLike.assert = ((cond: unknown, ...args: unknown[]) => {
    asserts++;
    if (!cond) {
      failed++;
      failures.push(args.map((a) => String(a)).join(' '));
    }
  }) as unknown as typeof consoleLike.assert;
  return {
    stop: () => {
      consoleLike.assert = original;
    },
    get asserts() {
      return asserts;
    },
    get failed() {
      return failed;
    },
    get failures() {
      return failures;
    },
  };
}

export async function defaultModules(): Promise<TestModule[]> {
  return [
    { name: 'stateRegistry', load: () => import('./stateRegistry.js') },
    { name: 'relay', load: () => import('./relay.js') },
    { name: 'mcpTools', load: () => import('./mcpTools.js') },
    { name: 'mcpServer', load: () => import('./mcpServer.js') },
    { name: 'staticFiles', load: () => import('./staticFiles.js') },
    { name: 'apiServer', load: () => import('./apiServer.js') },
    { name: 'client', load: () => import('./client.js') },
    { name: 'browser/gui', load: () => import('./browser/gui.js') },
    { name: 'main', load: () => import('./main.js') },
    // NOTE: never add 'selftest' itself here — importing the entry file while it is
    // still evaluating deadlocks (module-namespace promise waits on its own TLA).
  ];
}

export async function runAll(modules: TestModule[]): Promise<GateResult> {
  const results: ModuleResult[] = [];
  for (const mod of modules) {
    const recorder = recordAsserts();
    let error: string | null = null;
    try {
      const loaded = await mod.load();
      if (typeof loaded.runTests === 'function') {
        await loaded.runTests();
      } else {
        error = 'no runTests() exported';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    recorder.stop();
    results.push({ name: mod.name, asserts: recorder.asserts, failed: recorder.failed, error });
  }
  const asserts = results.reduce((n, r) => n + r.asserts, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const errors = results.filter((r) => r.error !== null).length;
  return { modules: results, asserts, failed, errors, green: failed === 0 && errors === 0 };
}

export function formatGate(result: GateResult): string {
  const lines: string[] = [];
  for (const mod of result.modules) {
    const status = mod.error ? `ERROR: ${mod.error}` : mod.failed ? `RED — ${mod.failed} failed` : 'ok';
    lines.push(`  ${mod.name.padEnd(14)} ${String(mod.asserts).padStart(4)} asserts · ${status}`);
  }
  lines.push('');
  lines.push(`  ${result.asserts} asserts, ${result.failed} failed, ${result.errors} module errors — ${result.green ? 'GREEN' : 'RED'}`);
  return lines.join('\n');
}

export async function gate(modules?: TestModule[]): Promise<GateResult> {
  const list = modules ?? (await defaultModules());
  return runAll(list);
}

export async function runTests(): Promise<void> {
  // the gate's own mechanics: recording counts what it says it counts
  const recorder = recordAsserts();
  console.assert(true, 'counted pass');
  console.assert(false, 'counted fail');
  recorder.stop();
  console.assert(recorder.asserts === 2, 'recorder counts asserts');
  console.assert(recorder.failed === 1, 'recorder counts failures');
  console.assert(recorder.failures[0].includes('counted fail'), 'recorder keeps the messages');

  // a hermetic mini-gate: two toy modules, one red — the result must read RED
  const toy = await runAll([
    {
      name: 'toy-green',
      load: async () => ({ runTests: async () => { console.assert(true, 'fine'); } }),
    },
    {
      name: 'toy-red',
      load: async () => ({ runTests: async () => { console.assert(false, 'expected red'); } }),
    },
  ]);
  console.assert(toy.green === false && toy.failed === 1, 'the mini-gate reads RED with one failure');
  console.log('[selftest] gate mechanics verified');
}

/** The one command: run every module's gate and report. */
export async function main(): Promise<void> {
  console.log('[state gate] every module\'s own self-check, one command\n');
  const result = await gate();
  console.log(formatGate(result));
  if (!result.green) {
    for (const mod of result.modules) {
      if (mod.error) console.log(`\n${mod.name}: ${mod.error}`);
    }
    process.exitCode = 1;
  }
}

const direct = process.argv[1] && /selftest\.(js|ts)$/.test(process.argv[1]);
if (direct) {
  await main();
}
