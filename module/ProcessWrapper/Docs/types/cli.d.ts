#!/usr/bin/env node
/**
 * @module cli
 * @description The terminal face of a running wrapper: start, list, read a copy, follow it,
 *              feed stdin, kill, and manage the saved commands.
 * @intent The API is the surface for other code; an operator needs the same power in one
 *         line — `pw start "python bar.py" --follow`, `pw output <id> --from 400`. This
 *         module is only a thin translator: argv → client calls, so it can never drift from
 *         the API (there is no second implementation of anything here).
 *
 * Usage:
 *   pw health
 *   pw start "<command>" [--name N] [--tag T] [--cwd DIR] [--shell] [--follow]
 *   pw list [--life running|exited|killed|failed]
 *   pw show <id>
 *   pw output <id> [--from N] [--limit N] [--channel stdout|stderr]
 *   pw follow <id> [--from N]
 *   pw input <id> "<text>"
 *   pw kill <id> [--force]
 *   pw rm <id>
 *   pw commands | pw save <name> "<command>" [--desc D] | pw unsave <name>
 * Global: --url http://127.0.0.1:8125 --token T
 */
import { type ProcessClient } from './client.js';
export interface CliOptions {
    command: string;
    args: string[];
    flags: Record<string, string | boolean>;
}
/** argv → { command, positional args, flags }. Unknown `--x` becomes a boolean flag. */
export declare function parseCliArgs(argv: string[]): CliOptions;
/** Run one CLI invocation. Writes to stdout/stderr; returns the process exit code. */
export declare function runCli(argv: string[], io?: {
    out: (s: string) => void;
    err: (s: string) => void;
}, client?: ProcessClient): Promise<number>;
export declare function runTests(): Promise<void>;
