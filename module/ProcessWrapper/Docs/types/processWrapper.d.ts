/**
 * @module processWrapper
 * @description Launches any command as a child process and captures stdout/stderr as a
 *              text stream — the ONE process table for the wrapper.
 * @intent A Process Wrapper needs one source of truth for what is running and what it
 *         said: argv parsing, spawn, per-life output capture to a plain-text file
 *         (ground truth), a live RAM buffer for fast copies, line events, stdin, and
 *         kill (graceful first, force tree-kill second). Everything else in this project
 *         — the HTTP API, the stream fan-out, saved commands — rides on this one table.
 *         Law kept here: ONE LIFE = ONE FILE (append-only, never rotated, whole while
 *         alive, kept at death until an operator deletes it) and NOTHING HIDDEN (a child
 *         is only ever created here, and it is always in the table).
 */
import { EventEmitter } from 'node:events';
/** Where a process is in its life. One life = spawn → one terminal state. */
export type ProcessLife = 'starting' | 'running' | 'exited' | 'killed' | 'failed';
/** A process's output arrives on two channels; both are text. */
export type StreamChannel = 'stdout' | 'stderr';
/** Everything needed to start one process. */
export interface ProcessSpec {
    /** `foo.exe`, `"python bar.py"`, or a bare executable when `args` is given. */
    command: string;
    /** Explicit argv appended to `command` (when set, `command` is NOT re-parsed). */
    args?: string[];
    /** Working directory for the child (default: the wrapper's cwd). */
    cwd?: string;
    /** Extra environment variables merged over `process.env`. */
    env?: Record<string, string>;
    /** Friendly label shown in listings (default: the command string). */
    name?: string;
    /** Free grouping label (a project, a box, a purpose); null when none. */
    tag?: string | null;
    /** Run through a shell — needed for pipes/redirects (`a | b`). Default false. */
    shell?: boolean;
    /** Per-process RAM ceiling for the live buffer (overrides the wrapper default). */
    bufferLimitChars?: number;
}
/** One measured piece of a stream, as it arrived. Offsets are CHARACTER offsets. */
export interface StreamChunk {
    seq: number;
    channel: StreamChannel;
    text: string;
    at: number;
    /** Character offset this chunk starts at, inside its own channel. */
    from: number;
    /**
     * Character offset this chunk starts at in the LIFE FILE (arrival order, both channels
     * interleaved) — the same frame `output(id, {from})` uses for the 'both' copy. Offsets
     * are per-frame on purpose: a copy asked to start at N must skip the text before N in the
     * frame it was asked about, whether that text already exists or arrives later.
     */
    fileFrom: number;
}
/** The public face of one process life. */
export interface ProcessRecord {
    id: string;
    name: string;
    tag: string | null;
    command: string;
    args: string[];
    cwd: string;
    shell: boolean;
    pid: number | null;
    life: ProcessLife;
    spawnedAt: number;
    endedAt: number | null;
    exitCode: number | null;
    signal: string | null;
    /** Characters captured per channel (the whole life, from the file's point of view). */
    chars: {
        stdout: number;
        stderr: number;
    };
    /** True when the live RAM buffer had to shed its oldest chunks. */
    truncated: boolean;
    /** The ground-truth text file for THIS life (append-only, never rotated). */
    streamFile: string;
    /** Set when the life failed — the spawn error or the non-zero exit reason. */
    error: string | null;
}
/** A copy of a process's output over a range. */
export interface OutputSlice {
    id: string;
    channel: StreamChannel | 'both';
    from: number;
    to: number;
    total: number;
    text: string;
    /** False when the range asked for is not fully present (the buffer shed it). */
    complete: boolean;
}
export interface KillOptions {
    /** Skip the graceful signal and go straight to the tree kill. */
    force?: boolean;
    /** How long to wait for a graceful exit before forcing (default: wrapper graceMs). */
    graceMs?: number;
}
export interface KillResult {
    id: string;
    pid: number | null;
    requested: 'graceful' | 'force';
    outcome: ProcessLife;
    exitCode: number | null;
    signal: string | null;
    forced: boolean;
}
export interface WrapperOptions {
    /** Directory holding one text file per process life (default: <cwd>/data/streams). */
    streamDir?: string;
    /** Default RAM ceiling per process, in characters (default 4_000_000). */
    bufferLimitChars?: number;
    /** Default graceful-kill grace window in ms (default 3000). */
    graceMs?: number;
    /** Kill the whole tree on Windows via `taskkill /T` (default true). */
    killTree?: boolean;
}
/** What a subscriber is handed: replay first, then live, then the end. */
export interface SubscribeOptions {
    /** Start the copy at this character offset instead of the beginning. */
    from?: number;
    /** Widen the copy to a single channel (default: both, tagged per chunk). */
    channel?: StreamChannel;
    /** Deliver already-captured text immediately (default true). */
    replay?: boolean;
}
/** The table's events — the same events every surface (API, hub, CLI) rides on.
 *  Note: never named `error` — that name is reserved by EventEmitter and an unhandled one
 *  would take the whole wrapper down with it. */
export interface WrapperEventMap {
    spawn: ProcessRecord;
    chunk: {
        id: string;
        chunk: StreamChunk;
    };
    line: {
        id: string;
        channel: StreamChannel;
        line: string;
        at: number;
    };
    exit: ProcessRecord;
    kill: KillResult;
    removed: {
        id: string;
    };
    'process-error': {
        id: string;
        error: string;
    };
}
/** Split a command string into argv, honouring double and single quotes. */
export declare function parseCommand(command: string): string[];
/**
 * THE TABLE. One instance per wrapper process; holds every child it launched, its
 * captured text, and answers for all of them (there is no second place processes live).
 */
export declare class ProcessWrapperService extends EventEmitter {
    private streamDir;
    private bufferLimitChars;
    private graceMs;
    private killTree;
    private seq;
    private table;
    private children;
    private buffers;
    private tails;
    private killed;
    private subs;
    private closed;
    constructor(options?: WrapperOptions);
    /** Launch a command as a child process and start capturing its output. */
    launch(spec: ProcessSpec): ProcessRecord;
    /** Every process the table knows about, newest first. */
    list(filter?: {
        life?: ProcessLife;
        tag?: string;
    }): ProcessRecord[];
    /** One record, or null. */
    get(id: string): ProcessRecord | null;
    /** Wait for a life to end (or for the timeout) and return the final record. */
    awaitExit(id: string, timeoutMs?: number): Promise<ProcessRecord | null>;
    /**
     * A copy of the captured text — whole, or a range, or one channel.
     * `both` reads the life file (whole by construction). A single channel is rebuilt from
     * the live buffer: offsets are channel-cumulative, and `complete` is false when the
     * buffer's ceiling already shed the front of that channel (the file still has it).
     */
    output(id: string, opts?: {
        from?: number;
        limit?: number;
        channel?: StreamChannel | 'both';
    }): OutputSlice;
    /** Subscribe to a live copy of a process's output. Returns the unsubscribe. */
    subscribe(id: string, sink: (chunk: StreamChunk | 'end') => void, opts?: SubscribeOptions): () => void;
    /** Write to the process's stdin. Returns false when stdin is gone. */
    write(id: string, text: string): boolean;
    /** End the process's stdin (a clean shutdown for stdin-driven children). */
    closeStdin(id: string): boolean;
    /** Kill a process — graceful signal first, force tree kill after the grace window. */
    kill(id: string, opts?: KillOptions): Promise<KillResult>;
    /** Kill everything still alive. */
    shutdown(force?: boolean): Promise<KillResult[]>;
    /** Drop a record from the table. The life file stays until an operator deletes it. */
    remove(id: string): boolean;
    /** The live RAM footprint of one process's capture (characters, per channel). */
    bufferStatus(id: string): {
        chunks: number;
        chars: {
            stdout: number;
            stderr: number;
        };
        truncated: boolean;
    };
    private capture;
    private finish;
    private fail;
    private forceKill;
    private raceExit;
    /** The life file, whole — the ground truth for the 'both' channel. */
    private readFile;
    /** One channel's text, rebuilt from what the live buffer still holds. */
    private channelText;
}
/** Make a wrapper. One per process; it owns every child. */
export declare function createWrapper(options?: WrapperOptions): ProcessWrapperService;
export declare function runTests(): Promise<void>;
