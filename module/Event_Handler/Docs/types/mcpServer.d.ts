/**
 * @module mcpServer
 * @description The MCP-over-HTTP face — streamable HTTP, JSON-RPC, sessions. It serves
 *              whatever REGISTRY it is handed (list + call): this module's own registry
 *              today, other registries later (Api_Root mounts them the same way). One
 *              implementation, many faces.
 * @intent House conventions (from ProcessWrapper, kept here): plain JSON or SSE-framed
 *         replies, `initialize` carries instructions that say how to pick a tool,
 *         notifications answer 202 with no body, an unknown method is -32601, an unknown
 *         tool/params is -32602, and a refused tool argument comes back as `isError: true`
 *         with a message that says what to do.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpRegistry } from './mcpTools.js';
export interface McpServerOptions {
    registry: McpRegistry;
    /** Sent in the initialize reply — say what this box is and how to pick a tool. */
    instructions?: string;
    /** Protocol revisions spoken, newest first (the first is the default). */
    protocolVersions?: string[];
}
export interface McpServer {
    /** Route POST/GET/DELETE /mcp here from the HTTP layer. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
export declare function createMcpServer(options: McpServerOptions): McpServer;
export declare function runTests(): Promise<void>;
