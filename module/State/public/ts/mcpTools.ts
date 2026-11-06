/**
 * @module mcpTools
 * @description The AGENT face as a REGISTRY — the module hands its tool set over as an
 *              object with its call hand (list + call, MCP-shaped). The module's own /mcp
 *              mounts it today; Api_Root will mount the SAME registry later — they cannot
 *              drift, because it is literally the same object.
 * @intent Operator ruling (2026-09-16): every module ships an mcp registry ready for
 *         Api_Root. Generic verbs only — the list, the pull, the register, the drop.
 *         Over MCP the standing is JSON only: liveness checks and pull recipes ride on
 *         in-process registrations (createModule/register in code), never over the wire.
 */

import type { State } from './stateRegistry.js';

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

function jsonResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: 'text', text }], isError };
}

/** Marks arrive from the wire as whatever JSON says — keep numbers, pass the rest through. */
function readMarks(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const marks: Record<string, number | string> = {};
  for (const [key, mark] of Object.entries(value as Record<string, unknown>)) {
    if (typeof mark === 'number' || typeof mark === 'string') marks[key] = mark;
  }
  return marks;
}

// --- Function Definitions ---

export function buildTools(state: State): McpTool[] {
  return [
    {
      name: 'state_list',
      description:
        'DISCOVER — the active set: every entry held right now (path, when it landed, whether it answers pulls itself, its serving flags). The SHAPE is listed; contents are pulled, never embedded. Call this first, then state_pull. A query matches exact paths, endings (the leaf), and things under it.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional name filter: a full path, a leaf ("ClientName"), or a parent — matched by suffix and prefix.' },
        },
      },
      run: async (args) => {
        const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim() : undefined;
        return jsonResult(state.discover(query));
      },
    },
    {
      name: 'state_pull',
      description:
        'PULL an entry — ask for what it holds. Name by full path, or the leaf alone when it is unique (an ambiguous name is refused with the candidates — extend until unique). Carry your marks for elements registered "to be delta served": "I already hold up to N" → the answer is the part past your mark; a new / unknown / stale mark → the FULL state. The reply\u2019s marks are what you now hold — carry them into your next pull.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The entry to pull — full dotted path, or the shortest unique suffix (e.g. the leaf alone).' },
          marks: { type: 'object', description: 'What you already hold, per flagged element: {"log": 812}. Omit for the full state.' },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name : '';
        if (!name) throw new ToolRefusal('state_pull needs a name — call state_list to see the active set');
        const answer = await state.pull(name, { marks: readMarks(args.marks) });
        if (!answer.ok) {
          const hint = answer.code === 'ambiguous' ? `ambiguous: ${answer.name} matches ${(answer.candidates ?? []).join(', ')} — extend the suffix until unique` : `no such entry: ${answer.name} — call state_list to see the active set`;
          return textResult(hint, true);
        }
        return jsonResult(answer);
      },
    },
    {
      name: 'state_register',
      description:
        'REGISTER (or update) an entry: a dotted-path name + ANY JSON object. The same path re-registered = last hand-in wins; an identical hand-in is a no-op. Optional standing rides alongside: serving flags ({"key":"delta"} marks an element "to be delta served"), a render map, an update contract — all relayed to viewers as-is. Over MCP the standing is JSON only (no functions); liveness checks and pull recipes ride on in-process registrations.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The dotted path to hold (e.g. "Root.Name"); segments are letters/digits/_/-.' },
          content: { type: 'object', description: 'ANY JSON object — held exactly as handed in.' },
          serving: { type: 'object', description: 'Per-element serving flags: {"log": "delta"} — the one flag for now.' },
          render: { type: 'object', description: 'Optional render map — relayed to viewers, understood by no one.' },
          update: { type: 'object', description: 'Optional refresh contract (cadence · trigger · link) — relayed, never run.' },
        },
        required: ['name', 'content'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name : '';
        if (!name) throw new ToolRefusal('state_register needs a name — a dotted path like "Root.Name"');
        if (args.content === undefined) throw new ToolRefusal('state_register needs content — ANY JSON object');
        const serving = args.serving && typeof args.serving === 'object' && !Array.isArray(args.serving) ? (args.serving as Record<string, string>) : undefined;
        const entry = state.register(name, args.content, { serving, render: args.render, update: args.update });
        return jsonResult({ ok: true, entry });
      },
    },
    {
      name: 'state_drop',
      description:
        'DROP an entry — the explicit death hand (a registration lives as long as its registrant; entries also pop on their own when their declared liveness says the registrant is gone). The name resolves like a pull: a unique leaf is enough.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The entry to drop — full dotted path, or the shortest unique suffix.' },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name : '';
        if (!name) throw new ToolRefusal('state_drop needs a name — call state_list to see the active set');
        const dropped = state.drop(name);
        if (!dropped) return textResult(`nothing to drop: ${name} — call state_list to see the active set`, true);
        return jsonResult({ ok: true, dropped: true, name });
      },
    },
  ];
}

export function createMcpRegistry(state: State): McpRegistry {
  const tools = buildTools(state);
  return {
    module: 'state',
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
  const { createStateRegistry } = await import('./stateRegistry.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const state = createStateRegistry();
  state.register('demo.one', { n: 1 });
  const registry = createMcpRegistry(state);

  const advertised = registry.list();
  ok('registry names its module', registry.module === 'state');
  ok('four generic verbs are advertised', advertised.length === 4, advertised.map((t) => t.name).join(','));
  ok('the pull tool is there', advertised.some((t) => t.name === 'state_pull'));
  ok('advertised tools carry no run hand', advertised.every((t) => !('run' in t)));
  ok('every advertised tool has a description and schema', advertised.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));

  // state_list — the active set
  const listed = await registry.call('state_list', {});
  const set = JSON.parse(listed.content[0].text) as { entries: Array<{ path: string; shape: string[] }> };
  ok('state_list returns the active set', set.entries.length === 1 && set.entries[0].path === 'demo.one');
  ok('the listing carries shapes, never contents', JSON.stringify(set.entries[0].shape) === '["n"]' && !JSON.stringify(set).includes('"n": 1'));

  // state_register — hand ANY object in
  const registered = await registry.call('state_register', { name: 'wire.obj', content: { a: 5, log: 'x\ny\nz' }, serving: { log: 'delta' } });
  const reg = JSON.parse(registered.content[0].text) as { ok: boolean; entry: { path: string; serving: Record<string, string> } };
  ok('state_register lands the entry', reg.ok === true && reg.entry.path === 'wire.obj' && reg.entry.serving.log === 'delta');

  // state_pull — full, then delta on the repeat
  const pulled = await registry.call('state_pull', { name: 'wire.obj' });
  const fullAnswer = JSON.parse(pulled.content[0].text) as { ok: boolean; full: boolean; marks: { log?: number } };
  ok('state_pull answers the full state + mark', fullAnswer.ok === true && fullAnswer.full === true && fullAnswer.marks.log === 3);
  const again = await registry.call('state_pull', { name: 'wire.obj', marks: { log: 1 } });
  const deltaAnswer = JSON.parse(again.content[0].text) as { full: boolean; content: { log: string } };
  ok('the repeat pulls the delta', deltaAnswer.full === false && deltaAnswer.content.log === 'y\nz');

  // refusals that tell the caller what to do
  const missing = await registry.call('state_pull', { name: 'nope' });
  ok('an unknown entry is refused with isError', missing.isError === true && missing.content[0].text.includes('state_list'));
  let refusal = false;
  try {
    await registry.call('state_pull', {});
  } catch (err) {
    refusal = err instanceof ToolRefusal;
  }
  ok('a missing name throws ToolRefusal', refusal);

  // state_drop
  const dropped = await registry.call('state_drop', { name: 'wire.obj' });
  const dropBody = JSON.parse(dropped.content[0].text) as { dropped: boolean };
  ok('state_drop answers', dropBody.dropped === true);
  const dropAgain = await registry.call('state_drop', { name: 'wire.obj' });
  ok('dropping twice is refused politely', dropAgain.isError === true);

  // unknown tool
  let unknown = false;
  try {
    await registry.call('no_such_tool', {});
  } catch (err) {
    unknown = err instanceof ToolRefusal;
  }
  ok('an unknown tool throws ToolRefusal', unknown);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
