/**
 * @module selftest
 * @description THE GATE: runs every module's own runTests() in one command, counts
 *              console.assert calls and failures per module, prints GREEN/RED and sets
 *              process.exitCode (never process.exit) so `npm test` can gate on it.
 * @intent Every module carries its own self-check — this is the one hand that runs them all.
 */
export interface TestModule {
    name: string;
    load: () => Promise<{
        runTests?: () => Promise<void>;
    }>;
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
/** Count console.assert calls while a module's self-check runs. */
export declare function recordAsserts(consoleLike?: Pick<Console, 'assert'>): AssertRecorder;
export declare function defaultModules(): Promise<TestModule[]>;
export declare function runAll(modules: TestModule[]): Promise<GateResult>;
export declare function formatGate(result: GateResult): string;
export declare function gate(modules?: TestModule[]): Promise<GateResult>;
export declare function runTests(): Promise<void>;
/** The one command: run every module's gate and report. */
export declare function main(): Promise<void>;
