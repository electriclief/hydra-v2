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
/**
 * Take over `console.assert` for the duration of a self-check. Node's console.assert only
 * prints; this makes a failure countable (and still prints it, so the why is visible).
 */
export declare function recordAsserts(consoleLike?: {
    assert: (...args: any[]) => void;
}): AssertRecorder;
/** Run every module's self-check in order and collect the honest tally. */
export declare function runAll(modules: TestModule[]): Promise<GateResult>;
/** The gate as text: one line per module, then the totals. */
export declare function formatGate(result: GateResult): string;
/** The module list the gate runs. Imported lazily so a broken module cannot block the gate. */
export declare function defaultModules(): Promise<TestModule[]>;
/** Run the whole gate, print it, and answer with the result. */
export declare function gate(modules?: TestModule[]): Promise<GateResult>;
export declare function runTests(): Promise<void>;
