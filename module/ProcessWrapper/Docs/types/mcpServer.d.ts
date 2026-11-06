/**
 * @module mcpServer
 * @description The agent face of the wrapper: an MCP server over HTTP at `POST /mcp` that
 *              exposes every capability of this box as a self-describing tool.
 * @intent An API answers a human who already knows what to call; an MCP endpoint has to
 *         explain itself to an agent that does not. This module is the whole contract in one
 *         place: the tool table (name · description · inputSchema with a description on every
 *         property), the `initialize` instructions, JSON-RPC over HTTP (plain JSON or SSE
 *         frames), sessions, and the process table/resources behind them. Nothing here
 *         re-implements a capability — every tool is a thin, documented call onto the same
 *         modules the API and the CLI use.
 *
 * Transport: streamable HTTP.
 *   POST /mcp   JSON-RPC. `initialize` → `Mcp-Session-Id` header + capabilities.
 *               `notifications/initialized` → 202 with no body.
 *               Replies are `application/json`, or SSE frames when you ask for them
 *               (`Accept: text/event-stream`).
 *   GET  /mcp   405 — this server pushes nothing on a server-initiated stream.
 *   DELETE /mcp  close the session named by `Mcp-Session-Id`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import type { CommandDefinition } from './registryStore.js';
/** The saved-commands access a tool needs (owned by whomever holds the registry). */
export interface RegistryBridge {
    list(): CommandDefinition[];
    find(name: string): CommandDefinition | null;
    add(def: Partial<CommandDefinition> & {
        name: string;
        command: string;
    }): CommandDefinition;
    remove(name: string): boolean;
}
/** One tool's result, in MCP shape. */
export interface McpToolResult {
    content: {
        type: 'text';
        text: string;
    }[];
    structuredContent?: unknown;
    isError?: boolean;
}
/** A tool: what it is called, what it does (in prose an agent can act on), and its schema. */
export interface McpTool {
    name: string;
    title: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
    annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
    /** The implementation. Throws ToolError for a user-facing failure (becomes isError). */
    run(args: Record<string, unknown>, ctx: ToolContext): Promise<McpToolResult>;
}
export interface ToolContext {
    sessionId: string | null;
    /** The base URL this server is reachable at, for links handed back to the agent. */
    endpoint: string;
}
export interface McpServerOptions {
    wrapper: ProcessWrapperService;
    hub: StreamHub;
    registry: RegistryBridge;
    /** Server name reported to clients (default 'process-wrapper'). */
    name?: string;
    version?: string;
    /** Base URL used inside instructions and tool output (default http://127.0.0.1:8125). */
    endpoint?: string;
    /** Protocol version answered when the client asks for one we do not know. */
    protocolVersion?: string;
}
export interface SessionInfo {
    id: string;
    client: string | null;
    protocolVersion: string | null;
    startedAt: number;
    lastSeen: number;
    calls: number;
}
export interface McpServer {
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /** The tool table, as advertised by `tools/list`. */
    tools(): Omit<McpTool, 'run'>[];
    /** The call hand — run one tool directly (the same path `tools/call` walks). */
    call(name: string, args?: Record<string, unknown>, ctx?: ToolContext): Promise<McpToolResult>;
    sessions(): SessionInfo[];
    close(): void;
}
/** A user-facing tool failure: reported as `isError: true`, never as a protocol error. */
export declare class ToolError extends Error {
    constructor(message: string);
}
export interface JsonRpcError {
    jsonrpc: '2.0';
    id: string | number | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}
/** Build the MCP server (transport + tool table) over a wrapper, a hub and a registry. */
export declare function createMcpServer(options: McpServerOptions): McpServer;
export declare function runTests(): Promise<void>;
