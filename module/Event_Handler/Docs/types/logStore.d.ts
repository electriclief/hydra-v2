/**
 * @module logStore
 * @description The event log: ONE rolling JSONL file — append, read, tail, filter, purge.
 *              It keeps itself small: lines older than the retention window are trimmed,
 *              and the file never grows past the byte ceiling (oldest lines go first).
 * @intent Operator ruling (2026-09-16): the log holds only events that DO something and is
 *         not needed beyond ~a day — it is purged periodically and stays bounded. One file,
 *         at the path the host passes; the store owns it and rewrites it atomically.
 */
export type LogSource = 'user' | 'agent' | 'process' | 'system';
/** One line of the log — the record. */
export interface LogLine {
    /** ISO time the event was logged. */
    t: string;
    /** The event's name (a trigger) or `<name>.result` / `<name>.error` (its outcome). */
    name: string;
    /** Who caused it. */
    source: LogSource;
    /** Free-form payload — present only when the caller gave one. */
    payload?: unknown;
    /** For outcome lines: the trigger they belong to. */
    of?: string;
    /** For `<name>.result` lines: what the handler returned. */
    result?: unknown;
    /** For `<name>.error` lines: what the handler threw. */
    error?: string;
}
export interface LogStoreOptions {
    /** The one file this store owns (created on start). */
    file: string;
    /** Keep events younger than this many hours (default 24). */
    retentionHours?: number;
    /** Keep the file under this many BYTES — oldest lines go first (default 8 MiB). */
    maxBytes?: number;
    /** How often the self-trim runs, in ms (default 10 min; 0 disables the timer). */
    purgeIntervalMs?: number;
}
export interface LogReadOptions {
    /** Last N matching lines (default 200; capped at 5000). */
    limit?: number;
    /** Only lines with t >= since (epoch ms). */
    since?: number;
    /** Exact name match. */
    name?: string;
    /** Exact source match. */
    source?: string;
}
export interface LogReadResult {
    lines: LogLine[];
    matched: number;
    fileBytes: number;
}
export interface PurgeResult {
    before: number;
    after: number;
    removed: number;
    bytesBefore: number;
    bytesAfter: number;
}
export interface LogStats {
    file: string;
    bytes: number;
    lines: number;
    retentionHours: number;
    maxBytes: number;
}
export declare class LogStore {
    private file;
    private retentionHours;
    private maxBytes;
    private purgeIntervalMs;
    private timer;
    private closed;
    private appendsSinceSizeCheck;
    constructor(options: LogStoreOptions);
    /** Create the file if missing, trim it once, and arm the periodic self-trim. */
    start(): this;
    /** Append one line. The size check rides every 64th append (throttled, cheap). */
    append(line: LogLine): void;
    /** The file, parsed; or the last N matching lines. */
    read(options?: LogReadOptions): LogReadResult;
    /** Trim to the retention window AND under the byte ceiling. Atomic rewrite (tmp + rename). */
    purge(): PurgeResult;
    stats(): LogStats;
    stop(): void;
}
export declare function createLogStore(options: LogStoreOptions): LogStore;
export declare function runTests(): Promise<void>;
