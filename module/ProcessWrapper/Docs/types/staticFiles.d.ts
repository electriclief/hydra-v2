/**
 * @module staticFiles
 * @description Serves the `public/` folder over the same port as the API — the GUI, its
 *              stylesheet and its compiled script.
 * @intent The wrapper is one box with one port: the API answers /api/*, and everything else
 *         is the human face. This module is the smallest honest file server for that: a MIME
 *         map, an index fallback, a traversal guard, and a 404 that explains where the API
 *         went instead of pretending the file exists.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
export interface StaticOptions {
    /** Directory to serve from (default: ./public relative to the process cwd). */
    root?: string;
    /** Serve this file for `/` and for a directory miss (default index.html). */
    index?: string;
    /** Cache-Control for served files (default 'no-cache' — the GUI is code, not content). */
    cacheControl?: string;
}
export interface StaticResult {
    /** What happened, for tests and logs: served | not-found | forbidden | not-a-file. */
    status: 'served' | 'not-found' | 'forbidden' | 'not-a-file';
    path: string;
    contentType?: string;
    bytes?: number;
}
/** The content type for a path, by extension. */
export declare function contentTypeFor(file: string): string;
/** URL path → an absolute file path inside the root, or null when it escapes the root. */
export declare function resolveInside(root: string, urlPath: string): string | null;
/** Serve one request from a root directory. Writes to the response either way. */
export declare function serveStatic(req: IncomingMessage, res: ServerResponse, options?: StaticOptions): StaticResult;
export declare function runTests(): Promise<void>;
