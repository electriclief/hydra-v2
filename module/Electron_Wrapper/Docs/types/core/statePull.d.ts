/**
 * @module statePull
 * @description The optional fancy layer: the wrapper PULLS each tab's state from a
 *              State module door and hands the reading to the caller. Tolerant on
 *              purpose — a missing entry, a refused pull, a door that is down: the tab
 *              simply reads solid. The wrapper runs no clocks of its own beyond this
 *              pull cadence, keeps no memory of who asked, and decides nothing.
 * @intent "Electron_Wrapper must expect to pull from state… to match state logic."
 *         Present when pointed at a state door; absent is fine forever.
 */
import { type TabVisualEntry } from './visuals.js';
export interface StatePullOptions {
    /** The state door, e.g. "http://127.0.0.1:8127". */
    endpoint: string;
    /** Pull cadence; default 1500 ms. */
    intervalMs?: number;
    /** What to ask for — the wrapper asks by each registered tab's name. */
    names: () => string[];
    onSnapshot: (entries: TabVisualEntry[], snapshot: Record<string, unknown>) => void;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}
export interface StatePuller {
    pullOnce(): Promise<Record<string, unknown>>;
    start(): void;
    stop(): void;
    running(): boolean;
}
/** The value a state entry carries, unwrapped from the shaped reply. */
export declare function extractVisualValue(content: unknown): unknown;
export declare function createStatePuller(options: StatePullOptions): StatePuller;
export declare function runTests(): Promise<void>;
