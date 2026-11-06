/**
 * @module mcpRegistry
 * @description The AGENT face as a REGISTRY — the same tool table the module's own /mcp
 *              serves, handed over as an object with its call hand (list + call, MCP-shaped).
 *              Api_Root mounts this SAME object later; standalone and root share one
 *              implementation, so they cannot drift.
 * @intent Operator ruling (2026-09-16): every module ships an mcp registry ready for
 *         Api_Root (folder-dialect standard). First precedent — this module.
 */

import path from 'node:path';
import { createMcpServer, ToolError } from './mcpServer.js';
import type { McpTool, McpToolResult, ToolContext, McpServer, RegistryBridge } from './mcpServer.js';
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import { loadRegistry, saveRegistry, addCommand, removeCommand, getCommand } from './registryStore.js';

// --- Interface Definitions ---

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

// --- Function Definitions ---

/** A bridge over one data.yaml — the same contract apiServer hands its own /mcp. */
export function createFileBridge(file: string): RegistryBridge {
  const state = loadRegistry(file).state;
  return {
    list: () => state.commands ?? [],
    find: (name) => getCommand(state, name),
    add: (def) => {
      const created = addCommand(state, def);
      saveRegistry(file, state);
      return created;
    },
    remove: (name) => {
      const removed = removeCommand(state, name);
      if (removed) saveRegistry(file, state);
      return removed;
    },
  };
}

/** Build the registry: the module's whole agent surface as one mountable object. */
export function createPwMcpRegistry(options: RegistryOptions): McpRegistry {
  const bridge = options.registry ?? createFileBridge(options.registryFile ?? path.join(process.cwd(), 'data.yaml'));
  const server: McpServer = createMcpServer({
    wrapper: options.wrapper,
    hub: options.hub,
    registry: bridge,
    endpoint: options.endpoint,
  });
  return {
    module: 'process-wrapper',
    list: () => server.tools(),
    call: (name, args = {}, ctx) => server.call(name, args, ctx),
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { createWrapper } = await import('./processWrapper.js');
  const { createStreamHub } = await import('./streamHub.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-registry-'));
  const wrapper = createWrapper({ streamDir: path.join(dir, 'streams'), graceMs: 300 });
  const hub = createStreamHub(wrapper);
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const registry = createPwMcpRegistry({ wrapper, hub, registryFile: path.join(dir, 'data.yaml') });
  ok('the registry names its module', registry.module === 'process-wrapper');
  const tools = registry.list();
  ok('the whole tool table is on it', tools.length >= 13, tools.map((t) => t.name).join(','));
  ok('no run hands leak into the list', tools.every((t) => !('run' in t)));
  ok('every tool is self-described', tools.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));

  const health = await registry.call('pw_health');
  ok('the call hand runs a real tool', health.content[0].text.length > 10, health.content[0].text.slice(0, 80));

  let refused = false;
  try {
    await registry.call('pw_teleport', {});
  } catch (err) {
    refused = err instanceof ToolError && err.message.includes('available');
  }
  ok('an unknown tool throws ToolError naming the list', refused);

  // the SAME path the module's own /mcp walks — launch and read through the registry
  const launched = await registry.call('pw_launch', {
    command: process.execPath,
    args: ['-e', "console.log('registry-ok')"],
    name: 'reg-probe',
  });
  const record = launched.structuredContent as { process?: { id?: string } } | undefined;
  const id = record?.process?.id;
  ok('pw_launch through the registry answers a record', typeof id === 'string', launched.content[0].text.slice(0, 120));
  if (id) {
    await wrapper.awaitExit(id, 15000);
    const out = await registry.call('pw_output', { id });
    ok('the outcome text comes back through the registry', out.content[0].text.includes('registry-ok'), out.content[0].text.slice(0, 80));
  } else {
    ok('the outcome text comes back through the registry', false, 'no id from pw_launch');
  }
  await wrapper.shutdown(true);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpRegistry] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
