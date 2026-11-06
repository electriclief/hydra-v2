/**
 * @module staticFiles
 * @description Serves public/ on the same port — the GUI, its CSS, its compiled script.
 *              MIME map, index fallback, a traversal guard that resolves inside the root,
 *              and a 404 that names the API routes.
 * @intent Static files are not actions: the page is served WITHOUT the shared token so an
 *         operator can load it and type one in; only /api/* and /mcp are guarded.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
export interface StaticOptions {
    /** Folder served at the root (default: <cwd>/public). */
    root?: string;
}
export interface StaticResult {
    status: number;
    file: string | null;
}
export declare function contentTypeFor(file: string): string;
/** Resolve a URL path INSIDE root, or null when it tries to escape. */
export declare function resolveInside(root: string, urlPath: string): string | null;
/** Serve one request from the static root. Returns what happened. */
export declare function serveStatic(req: IncomingMessage, res: ServerResponse, options?: StaticOptions): StaticResult;
export declare function runTests(): Promise<void>;
