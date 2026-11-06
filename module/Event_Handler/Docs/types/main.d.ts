/**
 * @module main
 * @description The entry point: reads the flags, builds the handler, puts the API on a
 *              port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Settings come
 *         from flags and the environment ONLY. The log path is the flag the operator
 *         owns: `--log <path>` (default ./data/events.log).
 */
import { type EventHandler } from './eventHandler.js';
import { type ApiServer } from './apiServer.js';
export interface MainOptions {
    port: number;
    host: string;
    token: string | null;
    /** THE path — where events are logged (one rolling JSONL file). */
    logPath: string;
    retentionHours: number;
    maxBytes: number;
    /** Start it and say nothing (tests). */
    quiet: boolean;
}
export interface RunningEventHandler {
    handler: EventHandler;
    api: ApiServer;
    options: MainOptions;
    stop(): Promise<void>;
}
/** Flags + environment → options. Precedence: flag → environment → default. */
export declare function parseArgs(argv: string[], env?: Record<string, string | undefined>): MainOptions;
/** Build the handler + the API around the given options. */
export declare function startWrapper(options?: Partial<MainOptions>): Promise<RunningEventHandler>;
/** The banner — where it listens, what can be fired, where the record lands. */
export declare function banner(running: RunningEventHandler): string;
/** Run it: build, announce, and hold the process until a stop signal. */
export declare function main(argv?: string[]): Promise<RunningEventHandler>;
export declare function runTests(): Promise<void>;
