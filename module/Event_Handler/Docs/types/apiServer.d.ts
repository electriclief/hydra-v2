/**
 * @module apiServer
 * @description The HTTP face: /health · /api/events (the palette) · /api/events/trigger ·
 *              /api/events/log · /api/events/purge · /api/events/stream (the live SSE feed),
 *              the static GUI at /, and the MCP mount at /mcp. Dependency-free (node:http);
 *              an optional shared token guards /api/* and /mcp.
 * @intent One implementation, three faces (page · API · agent). Errors are always
 *         {error:{code,message}} with a real code; static files are not actions and are
 *         served without the token.
 */
import http from 'node:http';
import type { EventHandler } from './eventHandler.js';
export interface ApiServerOptions {
    handler: EventHandler;
    /** Port to listen on (default 8126; 0 asks the OS). */
    port?: number;
    /** Bind interface (default 127.0.0.1 — local unless said otherwise). */
    host?: string;
    /** Shared secret; when set, /api/* and /mcp need `x-eh-token` or `?token=`. */
    token?: string | null;
    /** Folder served at the root — the GUI (default: <cwd>/public). */
    publicDir?: string;
    /** Serve the MCP endpoint at /mcp (default true). */
    enableMcp?: boolean;
}
export interface ApiServer {
    server: http.Server;
    /** The real bound URL (port resolved when 0 was asked for). */
    url: string;
    port: number;
    close(): Promise<void>;
}
export declare function createApiServer(options: ApiServerOptions): ApiServer;
/** createApiServer + listen, resolving once the port is really bound. */
export declare function startApiServer(options: ApiServerOptions): Promise<ApiServer & {
    stop(): Promise<void>;
}>;
export declare function runTests(): Promise<void>;
