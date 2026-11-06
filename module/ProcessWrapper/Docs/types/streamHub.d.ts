/**
 * @module streamHub
 * @description Hands out COPIES of a running process's output stream — one independent
 *              cursor per consumer, with replay-from-offset and honest backpressure.
 * @intent The wrapper can capture a stream, but a stream with one reader is not a stream:
 *         several surfaces (the SSE API, a CLI follower, a future Hydra module) each need
 *         their own copy at their own pace. The hub gives every consumer its own cursor so
 *         a slow reader can never stall, truncate or corrupt another's copy — and when a
 *         reader really does fall behind its ceiling, it is told it dropped text instead
 *         of being quietly lied to.
 */
import type { ProcessWrapperService, StreamChannel, StreamChunk } from './processWrapper.js';
/** What a consumer of a copy must implement. `onData` returning false = apply backpressure. */
export interface CopySink {
    /** A copy of the process's captured text. Return false to have the hub queue for you. */
    onData(chunk: StreamChunk): boolean | void;
    /** The process ended (or the copy was closed) — no more data will follow. */
    onEnd(reason: CopyEndReason): void;
    /** This copy's own queue hit its ceiling and shed text. Reported, never silent. */
    onDrop?(info: DropInfo): void;
}
export type CopyEndReason = 'process-ended' | 'closed' | 'sink-error' | 'no-such-process';
export interface DropInfo {
    droppedChars: number;
    /** Total characters this copy has shed since it opened. */
    totalDroppedChars: number;
    at: number;
}
/** One consumer's handle on a copy. */
export interface CopyHandle {
    id: string;
    processId: string;
    /** Flush a queued copy after a sink signalled backpressure. */
    drain(): void;
    /** Stop this copy (the process keeps running and capturing). */
    close(): void;
    stats(): CopyStats;
}
export interface CopyStats {
    id: string;
    processId: string;
    channel: StreamChannel | 'both';
    from: number;
    deliveredChars: number;
    queuedChars: number;
    queuedChunks: number;
    droppedChars: number;
    ends: CopyEndReason | null;
    open: boolean;
}
export interface HubOptions {
    /** Per-copy ceiling for the hub's own queue, in characters (default 1_000_000). */
    queueLimitChars?: number;
}
export interface OpenOptions {
    /** Character offset to start the copy at (default 0). */
    from?: number;
    /** Narrow the copy to one channel (default: both, tagged per chunk). */
    channel?: StreamChannel;
    /** Deliver already-captured text first (default true). */
    replay?: boolean;
}
/** THE HUB. One per wrapper; every copy it hands out is independent. */
export declare class StreamHub {
    private wrapper;
    private queueLimitChars;
    private copies;
    private seq;
    constructor(wrapper: ProcessWrapperService, options?: HubOptions);
    /** Open a new copy of one process's stream. */
    open(processId: string, sink: CopySink, opts?: OpenOptions): CopyHandle;
    /** Keep the trail bounded: closed copies are forgotten oldest-first past the cap. */
    private prune;
    /** How many copies are open right now. */
    openCount(): number;
    /** Every copy this hub has handed out (open and finished). */
    stats(): CopyStats[];
    /** Close every copy (the wrapper's processes keep running). */
    closeAll(reason?: CopyEndReason): number;
}
/** Make a hub for a wrapper. */
export declare function createStreamHub(wrapper: ProcessWrapperService, options?: HubOptions): StreamHub;
export declare function runTests(): Promise<void>;
