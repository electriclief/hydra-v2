/**
 * @module processWrapperClient
 * @description The ES-module client for a ProcessWrapper server: launch, read a copy of a
 *              stream, follow it live, write stdin, kill.
 * @intent Other code (a page, a script, another Hydra module, a test) must be able to use a
 *         wrapper without importing its internals — over the port, with the same shapes the
 *         API speaks. This module is the ONE client: fetch in the browser, fetch in Node,
 *         one dependency-free SSE reader, and honest errors (it throws the API's own code).
 */
import type { ProcessLife, ProcessRecord, KillResult, StreamChannel } from './processWrapper.js';
import type { CommandDefinition } from './registryStore.js';
export interface ProcessClientOptions {
    /** Where the wrapper listens (default http://127.0.0.1:8125). */
    baseUrl?: string;
    /** Shared secret, when the server wants one. */
    token?: string | null;
    /** Inject a fetch implementation (tests, older runtimes). */
    fetchImpl?: typeof fetch;
}
/** What to launch: either a raw command, or a saved one by name. */
export interface LaunchRequest {
    command?: string;
    saved?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    name?: string;
    tag?: string | null;
    shell?: boolean;
    bufferLimitChars?: number;
}
export interface OutputCopy {
    text: string;
    channel: StreamChannel | 'both';
    from: number;
    to: number;
    total: number;
    complete: boolean;
}
export type StreamEventName = 'open' | 'chunk' | 'drop' | 'end';
/** One server-sent event, as it arrived. */
export interface StreamEvent {
    event: StreamEventName;
    data: Record<string, unknown>;
}
/** A live follow: give it a callback, close it when done. */
export interface FollowHandle {
    close(): void;
    /** Resolves when the stream ends (the process ended, or close() was called). */
    done: Promise<void>;
}
/** The API's error, thrown as-is so callers can branch on `code`. */
export declare class ProcessWrapperError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number);
}
export interface ProcessClient {
    baseUrl: string;
    health(): Promise<Record<string, unknown>>;
    list(filter?: {
        life?: ProcessLife;
        tag?: string;
    }): Promise<ProcessRecord[]>;
    launch(req: LaunchRequest): Promise<ProcessRecord>;
    get(id: string): Promise<{
        process: ProcessRecord;
        buffer: {
            chunks: number;
            chars: {
                stdout: number;
                stderr: number;
            };
            truncated: boolean;
        };
        streamFile: string;
    }>;
    output(id: string, opts?: {
        from?: number;
        limit?: number;
        channel?: StreamChannel | 'both';
    }): Promise<OutputCopy>;
    file(id: string): Promise<{
        id: string;
        streamFile: string;
        note: string;
    }>;
    input(id: string, text: string): Promise<{
        id: string;
        wrote: number;
    }>;
    kill(id: string, opts?: {
        force?: boolean;
        graceMs?: number;
    }): Promise<KillResult>;
    remove(id: string): Promise<{
        removed: boolean;
        kill: KillResult | null;
        process: ProcessRecord;
    }>;
    commands(): Promise<CommandDefinition[]>;
    saveCommand(def: Partial<CommandDefinition> & {
        name: string;
        command: string;
    }): Promise<CommandDefinition>;
    removeCommand(name: string): Promise<boolean>;
    stream(id: string, opts?: {
        from?: number;
        channel?: StreamChannel;
        signal?: AbortSignal;
    }): AsyncGenerator<StreamEvent>;
    follow(id: string, onEvent: (ev: StreamEvent) => void, opts?: {
        from?: number;
        channel?: StreamChannel;
    }): FollowHandle;
}
/** Split an SSE byte stream into events, tolerating comment heartbeats and split frames. */
export declare function parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent>;
/** Make a client for a running wrapper. */
export declare function createProcessClient(options?: ProcessClientOptions): ProcessClient;
export declare function runTests(): Promise<void>;
