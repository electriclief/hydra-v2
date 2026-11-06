/**
 * @module main
 * @description The entry point: reads the flags, builds the registry, puts the API on a
 *              port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Settings come
 *         from flags and the environment ONLY. Nothing persists — the registry boots
 *         blank and holds what it is handed, for as long as it is handed.
 */
import { type State } from './stateRegistry.js';
import { type ApiServer } from './apiServer.js';
export interface MainOptions {
    port: number;
    host: string;
    token: string | null;
    /** Start it and say nothing (tests). */
    quiet: boolean;
}
export interface RunningState {
    state: State;
    api: ApiServer;
    options: MainOptions;
    stop(): Promise<void>;
}
/** Flags + environment → options. Precedence: flag → environment → default. */
export declare function parseArgs(argv: string[], env?: Record<string, string | undefined>): MainOptions;
/** Build the registry + the API around the given options. */
export declare function startState(options?: Partial<MainOptions>): Promise<RunningState>;
/** The banner — where it listens, what it holds, what walks the door. */
export declare function banner(running: RunningState): string;
/** Run it: build, announce, and hold the process until a stop signal. */
export declare function main(argv?: string[]): Promise<RunningState>;
export declare function runTests(): Promise<void>;
