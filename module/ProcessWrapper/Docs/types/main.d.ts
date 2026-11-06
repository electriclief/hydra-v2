/**
 * @module main
 * @description The entry point: reads the flags, builds the wrapper + hub, puts the API on
 *              a port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Server settings
 *         come from flags and the environment ONLY — `data.yaml` belongs to the saved
 *         commands, and nothing here ever rewrites a part of it it does not own (a hand
 *         edit there can never be silently dropped).
 */
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import type { ApiServer } from './apiServer.js';
import { type ConsoleEvents } from './consoleEvents.js';
import { type SystemWatch } from './systemWatch.js';
export interface MainOptions {
    port: number;
    host: string;
    token: string | null;
    /** data.yaml holding the saved commands. */
    registryFile: string;
    /** Directory holding one text file per process life. */
    streamDir: string;
    bufferLimitChars: number;
    graceMs: number;
    /** Start it and say nothing (tests). */
    quiet: boolean;
    /** Boot the drain watch with the wrapper: sampler child + small logs + a note per drain. */
    watch: boolean;
}
/** Everything main() built, so a caller can drive or stop it. */
export interface RunningWrapper {
    wrapper: ProcessWrapperService;
    hub: StreamHub;
    api: ApiServer;
    /** The console palette — the three events any hand can fire at this wrapper. */
    palette: ConsoleEvents;
    /** The drain watch, when armed (null when started with watch: false). */
    watch: SystemWatch | null;
    options: MainOptions;
    stop(): Promise<void>;
}
/** Flags + environment → options. Precedence: flag → environment → default. */
export declare function parseArgs(argv: string[], env?: Record<string, string | undefined>): MainOptions;
/** Build the wrapper, the hub and the API around the given options. */
export declare function startWrapper(options?: Partial<MainOptions>): Promise<RunningWrapper>;
/** The banner — where it listens, what it can be asked, where the text lands. */
export declare function banner(running: RunningWrapper): string;
/** Run it: build, announce, and hold the process until a stop signal. */
export declare function main(argv?: string[]): Promise<RunningWrapper>;
export declare function runTests(): Promise<void>;
