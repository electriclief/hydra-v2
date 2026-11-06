/**
 * @module mcpRegistry
 * @description The AGENT face as a REGISTRY — the same tool table the module's own /mcp
 *              serves, handed over as an object with its call hand (list + call, MCP-shaped).
 *              Api_Root mounts this SAME object later; standalone and root share one
 *              implementation, so they cannot drift.
 * @intent Operator ruling (2026-09-16): every module ships an mcp registry ready for
 *         Api_Root (folder-dialect standard). First precedent — this module.
 */
import type { McpTool, McpToolResult, ToolContext, RegistryBridge } from './mcpServer.js';
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
/** THE REGISTRY — list + call, MCP-shaped. Same object on the module's /mcp and on Api_Root. */
export interface McpRegistry {
    module: string;
    /** The advertised tools (no run hand). */
    list(): Omit<McpTool, 'run'>[];
    /** The call hand — the same path `tools/call` walks. Unknown names throw ToolError. */
    call(name: string, args?: Record<string, unknown>, ctx?: ToolContext): Promise<McpToolResult>;
}
export interface RegistryOptions {
    wrapper: ProcessWrapperService;
    hub: StreamHub;
    /** Saved-commands bridge — or give a data.yaml path and one is built. */
    registry?: RegistryBridge;
    /** data.yaml the built bridge reads/writes (default ./data.yaml). */
    registryFile?: string;
    /** Base URL used inside tool output links (default http://127.0.0.1:8125). */
    endpoint?: string;
}
/** A bridge over one data.yaml — the same contract apiServer hands its own /mcp. */
export declare function createFileBridge(file: string): RegistryBridge;
/** Build the registry: the module's whole agent surface as one mountable object. */
export declare function createPwMcpRegistry(options: RegistryOptions): McpRegistry;
export declare function runTests(): Promise<void>;
