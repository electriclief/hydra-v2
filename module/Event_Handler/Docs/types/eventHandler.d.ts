/**
 * @module eventHandler
 * @description THE CORE — register events, fire them, log everything.
 *              `register(name, handler)` puts an event on the palette; `trigger(name, payload)`
 *              fires it FIRE-AND-FORGET — the caller never waits — and the outcome lands as
 *              its OWN event (`<name>.result` or `<name>.error`) written by this module's wrap.
 * @intent Operator rulings (2026-09-16): the SAME path serves a user click and an agent
 *         (MCP) trigger — one door; only events that DO something exist here (nothing
 *         mousemove-class ever registers); the log is one rolling file at the path the host
 *         passes. Generic for all projects — no project words inside.
 */
import type { LogLine, LogReadOptions, LogReadResult, LogSource, PurgeResult, LogStats } from './logStore.js';
export interface EventMeta {
    /** What this event does — shown on the palette the agent reads. */
    description?: string;
}
export type EventHandlerFn = (payload: unknown, info: {
    name: string;
    source: LogSource;
}) => unknown;
export interface RegisteredEvent {
    name: string;
    description: string | null;
    registeredAt: string;
    fired: number;
    results: number;
    errors: number;
    lastAt: string | null;
}
export interface TriggerOptions {
    /** Who fires it: a user action, the agent (MCP), the process itself, or the system. */
    source?: LogSource;
}
export interface TriggerReceipt {
    ok: boolean;
    /** Refused reason when ok is false. */
    code?: 'no_such_event';
    name: string;
    at: string;
    source: LogSource;
}
export interface EventHandlerOptions {
    /** THE path — where events are logged (one rolling JSONL file). Required. */
    logPath: string;
    /** Keep events younger than this many hours (default 24). */
    retentionHours?: number;
    /** Keep the file under this many BYTES (default 8 MiB). */
    maxBytes?: number;
    /** How often the self-trim runs, in ms (default 10 min; 0 disables). */
    purgeIntervalMs?: number;
}
export type EventWatcher = (line: LogLine) => void;
export declare class EventHandler {
    private store;
    private events;
    private watchers;
    constructor(options: EventHandlerOptions);
    /** Create the log file, trim it once, arm the periodic self-trim. */
    start(): this;
    /** Put an event on the palette. The handler IS the action. */
    register(name: string, handler: EventHandlerFn, meta?: EventMeta): RegisteredEvent;
    unregister(name: string): boolean;
    has(name: string): boolean;
    /** The palette — what can be fired here. */
    list(): RegisteredEvent[];
    private describe;
    /** THE ONE DOOR — a user click and an agent trigger walk the same path. Fire-and-forget. */
    trigger(name: string, payload?: unknown, options?: TriggerOptions): TriggerReceipt;
    private write;
    /** Watch the log live. Returns the unsubscribe. */
    on(watcher: EventWatcher): () => void;
    read(options?: LogReadOptions): LogReadResult;
    purge(): PurgeResult;
    stats(): LogStats;
    close(): void;
}
export declare function createEventHandler(options: EventHandlerOptions): EventHandler;
export declare function runTests(): Promise<void>;
