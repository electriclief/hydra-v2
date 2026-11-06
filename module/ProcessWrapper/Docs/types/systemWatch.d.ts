/**
 * @module systemWatch
 * @description THE DRAIN WATCH: one sampler child launched through the table (visible,
 *              killable, one life file), one small human log of what was UNEXPECTED or
 *              CPU/DISK-heavy, and a note fired for every drain so the console palette
 *              (and the window) hears it the moment it starts.
 * @intent Operator idea (2026-09-29): the wrapper should NOTICE when something unexpected
 *         slows the machine it lives on -- and keep receipts, so next time the answer is a
 *         log line, not an argument. CPU + hard disks only (never GPU). Small by design:
 *         the watch log holds EVENTS, not samples; the samples live in the sampler's own
 *         life file. "Unexpected" is a TOOL, not a rule: the expected list is a text file
 *         the operator edits; absence from it only ever tags a line, it never hides one.
 */
import type { ProcessWrapperService } from './processWrapper.js';
/** One process in a sample's CPU top list. */
export interface SampleTop {
    name: string;
    pid: number;
    cpu: number;
}
/** One drive in a sample's disk list. */
export interface SampleDisk {
    id: string;
    busy: number;
    readMBs: number;
    writeMBs: number;
}
/** One process in a sample's IO top list. */
export interface SampleIO {
    name: string;
    pid: number;
    readMBs: number;
    writeMBs: number;
    ioMBs: number;
}
/** One sampler line, parsed. Every field optional -- the sampler degrades, never dies. */
export interface WatchSample {
    t?: string;
    cores?: number;
    cpuTotal?: number;
    procs?: number;
    /** The busiest drive, as "<id> <busy>%" -- a convenience the sampler includes. */
    busy?: string;
    top?: SampleTop[];
    disk?: SampleDisk[];
    topIO?: SampleIO[];
    /** Process names never seen before this sample (the sampler owns the seen-set). */
    newNames?: string[];
}
/** One watch event, as logged and (for drains) as fired. */
export interface DrainRecord {
    kind: 'new' | 'drain' | 'episode-end' | 'watch-note';
    at: string;
    name: string;
    pid: number | null;
    cpuPeak: number | null;
    diskPeakMBs: number | null;
    samples: number | null;
    /** True when the name is not on the expected list (tag only -- the line is logged either way). */
    unexpected: boolean;
    detail: string;
    /** The human log line, exactly as appended. */
    line: string;
}
export interface SystemWatchOptions {
    wrapper: ProcessWrapperService;
    /** Where the small logs land (default: <cwd>/data/watch). */
    logDir?: string;
    /** The sampler script (default: <module root>/scripts/system-sampler.ps1). */
    samplerPath?: string;
    /** Seconds between samples (default: 20). */
    intervalSec?: number;
    /** The expected list -- one process name per line, `#` lines ignored (default: <logDir>/expected.txt). */
    expectedFile?: string;
    /** Called for every drain record -- main wires this to the console palette. */
    notify?: (record: DrainRecord) => void;
    /** Start the sampler child (default: true; tests pass false and feed samples by hand). */
    autostart?: boolean;
    /** Silence the [system-watch] stdout notes (tests). */
    quiet?: boolean;
    /** A process is "hot" at or above this CPU percent of the whole machine (default 20). */
    procCpuPct?: number;
    /** ...or at or above this much disk IO per second, MB (default 20). */
    procIOMBs?: number;
    /** The machine itself is "hot" at or above this total CPU percent (default 60). */
    totalCpuPct?: number;
    /** Samples a threshold must hold before a drain is declared (default 2). */
    sustain?: number;
}
/** A snapshot of the watch, for status reads and tests. */
export interface SystemWatchStatus {
    running: boolean;
    samplerId: string | null;
    since: number;
    samples: number;
    records: number;
    logPath: string;
    expectedPath: string;
    intervalSec: number;
}
export interface SystemWatch {
    module: 'systemWatch';
    logDir: string;
    /** Today's drain log (daily files; small by construction -- events only). */
    logPath: string;
    expectedPath: string;
    samplerId: string | null;
    startedAt: number;
    /** Feed one sample (the line handler's core; public so tests can drive it). */
    ingest(sample: WatchSample): DrainRecord[];
    status(): SystemWatchStatus;
    stop(): Promise<void>;
}
/** Parse one sampler line. Null when it is not a sample (banner chatter, junk). */
export declare function parseSampleLine(line: string): WatchSample | null;
/** Local time, seconds precision, for log lines. */
export declare function stamp(d: Date): string;
/** One log line, fixed shape so it greps: time | kind | name | facts | tags. */
export declare function formatRecord(rec: Omit<DrainRecord, 'line'>): string;
/**
 * The engine of one watch: everything between a sampler line and a log line lives here,
 * without touching the filesystem or the wrapper -- so the tests can drive it directly.
 */
export declare function createWatchCore(options?: {
    expected?: Set<string>;
    procCpuPct?: number;
    procIOMBs?: number;
    totalCpuPct?: number;
    sustain?: number;
    now?: () => Date;
}): {
    ingest: (sample: WatchSample) => DrainRecord[];
    watching: () => number;
    samples: () => number;
};
/** Read the expected list: one name per line, `#` comments, case-insensitive. */
export declare function loadExpected(file: string): Set<string>;
/**
 * Build the watch for one wrapper, in this thread. Launches the sampler through the
 * table (NOTHING HIDDEN -- it is a named child with a life file), consumes its lines,
 * appends one tiny log line per event, and fires `notify` for every drain.
 */
export declare function createSystemWatch(options: SystemWatchOptions): Promise<SystemWatch>;
export declare function runTests(): Promise<void>;
