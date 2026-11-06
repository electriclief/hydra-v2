/**
 * @module mcpTools
 * @description The AGENT face as a REGISTRY — the module hands its tool set over as an
 *              object with its call hand (list + call, MCP-shaped). The module's own /mcp
 *              mounts it today; Api_Root will mount the SAME registry later — they cannot
 *              drift, because it is literally the same object.
 * @intent Operator ruling (2026-09-16): every module ships an mcp registry ready for
 *         Api_Root. Generic verbs only — the palette, the fire, the read, the trim.
 */
import type { EventHandler } from './eventHandler.js';
export interface McpToolResult {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
}
export interface McpToolProperty {
    type: string;
    description: string;
    enum?: string[];
}
export interface McpToolSchema {
    type: 'object';
    properties: Record<string, McpToolProperty>;
    required?: string[];
}
export interface McpTool {
    name: string;
    description: string;
    inputSchema: McpToolSchema;
    run: (args: Record<string, unknown>) => Promise<McpToolResult>;
}
/** THE REGISTRY — list + call, MCP-shaped. Same object on the module's /mcp and on Api_Root. */
export interface McpRegistry {
    module: string;
    /** The advertised tools (no run hand). */
    list(): Array<Omit<McpTool, 'run'>>;
    /** The call hand. Throws ToolRefusal for arguments that can be answered better. */
    call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}
/** A refusal the caller can act on — travels as `isError: true`, never a protocol error. */
export declare class ToolRefusal extends Error {
}
export declare function buildTools(handler: EventHandler): McpTool[];
export declare function createMcpRegistry(handler: EventHandler): McpRegistry;
export declare function runTests(): Promise<void>;
