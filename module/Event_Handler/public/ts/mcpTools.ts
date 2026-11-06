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
import type { LogSource } from './logStore.js';

// --- Interface Definitions ---

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
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
export class ToolRefusal extends Error {}

const SOURCES: LogSource[] = ['user', 'agent', 'process', 'system'];

function jsonResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// --- Function Definitions ---

export function buildTools(handler: EventHandler): McpTool[] {
  return [
    {
      name: 'event_list',
      description:
        'THE PALETTE — every event registered on this handler: name, description, fire/outcome counters. Call this first: anything listed here can be fired with event_trigger.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => jsonResult({ events: handler.list() }),
    },
    {
      name: 'event_trigger',
      description:
        'FIRE an event — fire-and-forget. The receipt comes back immediately; the OUTCOME lands later as its own event (`<name>.result` or `<name>.error`) — read it with event_log. This is the same door a user click walks; the log records who fired it (source).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The event to fire — use a name from event_list.' },
          payload: { type: 'object', description: 'Optional free-form JSON handed to the event as-is.' },
          source: { type: 'string', description: 'Who fires it (defaults to agent when called over MCP).', enum: ['user', 'agent', 'process', 'system'] },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name : '';
        if (!name) throw new ToolRefusal('event_trigger needs a name — call event_list to see the palette');
        const source = SOURCES.includes(args.source as LogSource) ? (args.source as LogSource) : 'agent';
        const receipt = handler.trigger(name, args.payload, { source });
        if (!receipt.ok) {
          return { content: [{ type: 'text', text: `no such event: ${name} — call event_list to see the palette` }], isError: true };
        }
        return jsonResult(receipt);
      },
    },
    {
      name: 'event_log',
      description:
        'READ the record — the last N matching events from the rolling log (bounded, ~24 h). Filter by name (exact) and/or source; outcomes are their own lines (`<name>.result` / `<name>.error`, linked by `of`).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Last N lines (default 100, cap 5000).' },
          sinceHours: { type: 'number', description: 'Only events from the last N hours.' },
          name: { type: 'string', description: 'Exact event name filter, e.g. tick or tick.result.' },
          source: { type: 'string', description: 'Exact source filter.', enum: ['user', 'agent', 'process', 'system'] },
        },
      },
      run: async (args) => {
        const since = typeof args.sinceHours === 'number' ? Date.now() - args.sinceHours * 3_600_000 : undefined;
        const read = handler.read({
          limit: typeof args.limit === 'number' ? args.limit : 100,
          since,
          name: typeof args.name === 'string' && args.name ? args.name : undefined,
          source: typeof args.source === 'string' && args.source ? args.source : undefined,
        });
        return jsonResult({ matched: read.matched, fileBytes: read.fileBytes, lines: read.lines });
      },
    },
    {
      name: 'event_purge',
      description:
        'TRIM the log on demand — drop events older than the retention window (~24 h) and enforce the byte ceiling. The self-trim runs periodically anyway; this is the manual hand.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => jsonResult(handler.purge()),
    },
  ];
}

export function createMcpRegistry(handler: EventHandler): McpRegistry {
  const tools = buildTools(handler);
  return {
    module: 'event-handler',
    list: () =>
      tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    call: async (name, args) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new ToolRefusal(`unknown tool: ${name}`);
      return tool.run(args ?? {});
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const { createEventHandler } = await import('./eventHandler.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-tools-'));
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const handler = createEventHandler({ logPath: path.join(dir, 'events.log'), purgeIntervalMs: 0 });
  handler.start();
  handler.register('demo', (payload) => ({ got: payload }), { description: 'a demo' });
  const registry = createMcpRegistry(handler);

  const advertised = registry.list();
  ok('registry names its module', registry.module === 'event-handler');
  ok('four generic verbs are advertised', advertised.length === 4, advertised.map((t) => t.name).join(','));
  ok('the palette tool is there', advertised.some((t) => t.name === 'event_list'));
  ok('advertised tools carry no run hand', advertised.every((t) => !('run' in t)));
  ok('every advertised tool has a description and schema', advertised.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));

  // event_list — the palette
  const listed = await registry.call('event_list', {});
  const palette = JSON.parse(listed.content[0].text) as { events: Array<{ name: string }> };
  ok('event_list returns the palette', palette.events.length === 1 && palette.events[0].name === 'demo');

  // event_trigger — fire and receipt (fire-and-forget)
  const fired = await registry.call('event_trigger', { name: 'demo', payload: { n: 1 } });
  const receipt = JSON.parse(fired.content[0].text) as { ok: boolean; source: string };
  ok('event_trigger fires with source agent', receipt.ok === true && receipt.source === 'agent');

  // unknown event → a refusal the caller can act on
  const refused = await registry.call('event_trigger', { name: 'nope' });
  ok('an unknown event is refused with isError', refused.isError === true && refused.content[0].text.includes('event_list'));

  // missing name → ToolRefusal
  let refusal = false;
  try {
    await registry.call('event_trigger', {});
  } catch (err) {
    refusal = err instanceof ToolRefusal;
  }
  ok('a missing name throws ToolRefusal', refusal);

  // outcome lands, event_log reads it back
  await new Promise((resolve) => setTimeout(resolve, 200));
  const logged = await registry.call('event_log', { name: 'demo.result' });
  const read = JSON.parse(logged.content[0].text) as { matched: number; lines: Array<{ name: string; of: string }> };
  ok('event_log reads the outcome line', read.matched === 1 && read.lines[0].of === 'demo');

  // event_purge answers with counts
  const purged = await registry.call('event_purge', {});
  const purge = JSON.parse(purged.content[0].text) as { before: number; after: number };
  ok('event_purge answers with before/after', typeof purge.before === 'number' && typeof purge.after === 'number');

  // unknown tool
  let unknown = false;
  try {
    await registry.call('no_such_tool', {});
  } catch (err) {
    unknown = err instanceof ToolRefusal;
  }
  ok('an unknown tool throws ToolRefusal', unknown);

  handler.close();
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
