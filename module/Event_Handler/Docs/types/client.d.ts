/**
 * @module client
 * @description The ES-module client for the API — fetch in Node or the browser, one SSE
 *              reader, API errors thrown as EventHandlerError carrying the server's own code.
 * @intent The page imports the SAME client the tests use — one implementation, no drift.
 */
import type { RegisteredEvent, TriggerReceipt } from './eventHandler.js';
import type { LogLine, LogStats, PurgeResult } from './logStore.js';
export interface EventHandlerClientOptions {
    baseUrl?: string;
    token?: string | null;
}
export interface LogQuery {
    limit?: number;
    sinceHours?: number;
    name?: string;
    source?: string;
}
export interface LogAnswer {
    matched: number;
    fileBytes: number;
    lines: LogLine[];
}
export interface StreamHandlers {
    onEvent?: (line: LogLine) => void;
    onReady?: () => void;
}
export interface EventHandlerClient {
    health(): Promise<Record<string, unknown>>;
    list(): Promise<{
        ok: boolean;
        events: RegisteredEvent[];
        stats: LogStats;
    }>;
    trigger(name: string, payload?: unknown, source?: string): Promise<TriggerReceipt>;
    readLog(query?: LogQuery): Promise<LogAnswer>;
    purge(): Promise<PurgeResult & {
        ok: boolean;
    }>;
    /** Consume the live feed until the signal aborts. Resolves when the stream ends. */
    stream(handlers: StreamHandlers, signal?: AbortSignal): Promise<void>;
}
export declare class EventHandlerError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number);
}
/** Split an SSE body into {event, data} frames as they arrive. */
export declare function parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{
    event: string;
    data: string;
}>;
export declare function createEventHandlerClient(options?: EventHandlerClientOptions): EventHandlerClient;
export declare function runTests(): Promise<void>;
