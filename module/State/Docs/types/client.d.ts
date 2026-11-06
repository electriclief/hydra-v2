/**
 * @module client
 * @description The ES-module client for the API — fetch in Node or the browser, one SSE
 *              reader, API errors thrown as StateError carrying the server's own code.
 * @intent The page imports the SAME client the tests use — one implementation, no drift.
 */
import type { PullAnswer, RegisterOptions, StateEntryInfo, StateSummary } from './stateRegistry.js';
export interface StateClientOptions {
    baseUrl?: string;
    token?: string | null;
}
export interface StateListing {
    ok: boolean;
    query: string | null;
    entries: StateEntryInfo[];
    summary: StateSummary;
}
export interface ChangeFrame {
    t: string;
    kind: 'registered' | 'updated' | 'dropped';
    path: string;
    reason?: string;
}
export interface StreamHandlers {
    onReady?: () => void;
    onChange?: (frame: ChangeFrame) => void;
}
export interface StateClient {
    health(): Promise<Record<string, unknown>>;
    discover(query?: string): Promise<StateListing>;
    pull(name: string, marks?: Record<string, number | string>): Promise<PullAnswer>;
    /** Register JSON standing only (functions cannot ride the wire). */
    register(name: string, content: unknown, standing?: Pick<RegisterOptions, 'serving' | 'render' | 'update'>): Promise<{
        ok: boolean;
        entry: StateEntryInfo;
    }>;
    drop(name: string): Promise<{
        ok: boolean;
        dropped: boolean;
        name: string;
    }>;
    /** Consume the live change feed until the signal aborts. Resolves when the stream ends. */
    stream(handlers: StreamHandlers, signal?: AbortSignal): Promise<void>;
}
export declare class StateError extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number);
}
/** Split an SSE body into {event, data} frames as they arrive. */
export declare function parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{
    event: string;
    data: string;
}>;
export declare function createStateClient(options?: StateClientOptions): StateClient;
export declare function runTests(): Promise<void>;
