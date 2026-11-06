/**
 * @module consoleEvents
 * @description The console palette: three registered events — "add Process Console Display",
 *              "kill Process Console Display" and "note System Drain" — hosted on an
 *              Event_Handler instance
 *              embedded IN THIS THREAD (the wrapper's own). A trigger anywhere (the
 *              window's footer form, the API, a command-line arg, a script, a curl…)
 *              just fills the fields and fires the event; the add door launches the
 *              process through the wrapper, the kill door ends it. One door, many hands.
 * @intent Operator concept (2026-09-25): ProcessWrapper is launched once — everything
 *         else arrives as events. No pre-decisions: whatever the registration supplies
 *         (name · provider wiring · cwd · args · env · shell) lands in the launch; only
 *         what is missing falls back to the lean defaults below. Extras are kept visible
 *         in the outcome event — never dropped.
 */
import type { ProcessWrapperService } from './processWrapper.js';
/** The fields the add event understands; extras ride along, visible, never dropped. */
export interface ConsoleAddPayload {
    name?: string;
    /** The wiring to connect (the Service Provider block); `launch` is the command. */
    provider?: {
        name?: string;
        launch?: string;
        repo?: string;
        probe?: string;
        update?: string;
        [key: string]: unknown;
    };
    /** A direct command — wins over provider.launch when both are present. */
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    shell?: boolean;
    [key: string]: unknown;
}
/** The fields the kill event understands. */
export interface ConsoleKillPayload {
    id?: string;
    name?: string;
    /** Skip the graceful ask (default: ask first, escalate to force only if needed). */
    force?: boolean;
    graceMs?: number;
    [key: string]: unknown;
}
export interface ConsoleEventsOptions {
    wrapper: ProcessWrapperService;
    /** Where the rolling event log lands (default: <cwd>/data/console-events.log). */
    logPath?: string;
    /** cwd used when a registration supplies none (default: <cwd>). */
    defaultCwd?: string;
}
/** One palette entry, as served. */
export interface ConsoleEventInfo {
    name: string;
    description: string;
    fields: string[];
}
/** The palette's public face. */
export interface ConsoleEvents {
    module: string;
    logPath: string;
    /** The two events, described — what this wrapper can be asked. */
    list(): ConsoleEventInfo[];
    /** Fire the thing. Fire-and-forget: the receipt answers now, the outcome lands as its own event. */
    trigger(name: string, payload?: Record<string, unknown>, source?: string): {
        ok: boolean;
        name?: string;
        source?: string;
        at?: string;
        code?: string;
    };
    /** The rolling log (newest last), capped. */
    log(limit?: number): {
        matched: number;
        lines: unknown[];
    };
    /** The embedded handler, as built (tests and advanced callers). */
    handler: {
        register(name: string, fn: (payload: any, ctx: any) => any, options?: any): any;
        trigger(name: string, payload?: any, options?: any): any;
        read(query?: any): any;
        close(): void;
    };
    close(): void;
}
/**
 * Build the palette for one wrapper, in this thread. The Event_Handler itself is loaded
 * from the sibling module's embed entry (module/Event_Handler/Event_Handler_module.js) —
 * the implementation lives there; this file only holds the two registrations.
 */
export declare function createConsoleEvents(options: ConsoleEventsOptions): Promise<ConsoleEvents>;
export declare function runTests(): Promise<void>;
