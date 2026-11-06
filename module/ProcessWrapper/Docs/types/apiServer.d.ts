/**
 * @module apiServer
 * @description The HTTP face of the wrapper: launch a process, read or follow a copy of
 *              its output stream, write to its stdin, list it, kill it.
 * @intent A wrapper that can only be used from the process that owns it is a library, not
 *         a wrapper. This module puts the process table on a port so any surface — a page,
 *         a script, another Hydra node, curl — can start a command and take its own copy of
 *         the output as a text stream (whole, ranged, or live over SSE), and can kill what
 *         it started. No dependencies: node:http, one file, every route self-checked.
 *
 * Routes (all JSON unless noted):
 *   GET    /health                          → liveness + counters
 *   GET    /api/processes                   → the table (?life=&tag=)
 *   POST   /api/processes                   → launch {command|saved, args, cwd, env, name, tag, shell}
 *   GET    /api/processes/:id               → one record
 *   GET    /api/processes/:id/output        → a COPY of the text (?from=&limit=&channel=) text/plain
 *   GET    /api/processes/:id/stream        → a LIVE copy, SSE (?from=&channel=)
 *   GET    /api/processes/:id/file          → where the ground-truth stream file is
 *   POST   /api/processes/:id/input         → write to stdin {text}
 *   POST   /api/processes/:id/kill          → kill {force, graceMs}
 *   DELETE /api/processes/:id               → kill + drop the record
 *   GET    /api/commands                    → saved commands (data.yaml)
 *   POST   /api/commands                    → save one
 *   DELETE /api/commands/:name              → drop one
 */
import http from 'node:http';
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import { type McpServer } from './mcpServer.js';
import type { ConsoleEvents } from './consoleEvents.js';
export interface ApiServerOptions {
    wrapper: ProcessWrapperService;
    hub: StreamHub;
    /** Port to listen on (default 8125; 0 asks the OS for a free one). */
    port?: number;
    /** Interface to bind (default 127.0.0.1 — the wrapper is local unless said otherwise). */
    host?: string;
    /** Shared secret; when set, every /api and /mcp request needs `x-pw-token` or `?token=`. */
    token?: string | null;
    /** data.yaml path holding saved commands (default: ./data.yaml). */
    registryFile?: string;
    /** Read/write the registry from disk (default true; tests keep it in memory). */
    persistRegistry?: boolean;
    /** SSE heartbeat in ms (default 15000). */
    heartbeatMs?: number;
    /** Folder served at the root: the GUI, its CSS and its compiled script (default ./public). */
    publicDir?: string;
    /** Serve the MCP endpoint at /mcp (default true). */
    enableMcp?: boolean;
    /** The console palette (an embedded Event_Handler); when set, /api/events answers. */
    palette?: ConsoleEvents | null;
}
export interface ApiServer {
    server: http.Server;
    /** The real bound URL (port resolved when 0 was asked for). */
    url: string;
    port: number;
    /** The MCP endpoint mounted at /mcp (null when disabled). */
    mcp: McpServer | null;
    close(): Promise<void>;
}
/** The error body every failure shares. */
export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
    };
}
/** Build the API server around a wrapper + hub. */
export declare function createApiServer(options: ApiServerOptions): ApiServer;
/** createApiServer + listen, resolving once the port is really bound. */
export declare function startApiServer(options: ApiServerOptions): Promise<ApiServer & {
    stop(): Promise<void>;
}>;
export declare function runTests(): Promise<void>;
