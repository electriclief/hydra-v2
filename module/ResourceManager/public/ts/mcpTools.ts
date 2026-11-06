/**
 * @module mcpTools
 * @description The AGENT face as a REGISTRY — the register's tools, MCP-shaped: rm_resources
 *              (THE POLL — pure read: cpu · gpus + observed · ram · disks · shared folders ·
 *              every current booking), rm_book (the ONE write — the chosen resources land
 *              whole or the book is refused whole, and the refusal carries the wait info),
 *              rm_bookings, rm_pop and rm_clear (the exits). The module's own /mcp mounts
 *              this registry today; Api_Root will mount the SAME object later.
 * @intent A refusal is an ANSWER, not a tool failure: it rides as normal content with
 *         ok:false (like "this node does not have those resources" — round-2 vocabulary).
 *         ToolRefusal is only for arguments that cannot be answered at all.
 */

import type { BookingStore, ReadsFn } from './bookingStore.js';

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

function amountOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pathsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
  if (typeof value === 'string' && value.trim()) return value.split(/[,\n;]+/).map((piece) => piece.trim()).filter(Boolean);
  return [];
}

// --- Function Definitions ---

export function buildTools(store: BookingStore, reads: ReadsFn): McpTool[] {
  return [
    {
      name: 'rm_resources',
      description:
        'THE POLL — this node\'s resources, a pure read: cpu (cores · load) · gpus (name · vram · observed gpu-side processes nobody booked) · ram · disks · Hydra shared folders · every current booking (service · what it holds · since). Asking holds nothing and remembers nothing.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const current = await reads();
        return jsonResult({
          ok: true,
          node: current.node,
          collectedAt: current.collectedAt,
          cpu: current.cpu,
          ram: current.ram,
          gpus: current.gpus,
          gpusObserved: current.gpusObserved,
          disks: current.disks,
          shares: current.shares,
          bookings: store.active(),
          notes: current.notes,
        });
      },
    },
    {
      name: 'rm_book',
      description:
        'BOOK resources for a run — the ONE write. The caller passes the CHOSEN resources (amounts for cores/ramMb/diskMb; a gpu by name, whole and pinned — 1 app per gpu; paths[] — a booked folder covers its subtree, children assumed). The book lands whole or is refused whole: on refusal the answer carries the wait info (what is in the way, held by which service, since when). Nothing is queued, nothing is scheduled here.',
      inputSchema: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'The service this run is — the booking\'s identity.' },
          mode: { type: 'string', description: 'Optional service mode (recorded).' },
          gpu: { type: 'string', description: 'A gpu by name, exactly as rm_resources shows it. Whole and pinned.' },
          cores: { type: 'number', description: 'Cpu cores to book (amount).' },
          ramMb: { type: 'number', description: 'Ram in MB to book (amount).' },
          diskMb: { type: 'number', description: 'Disk in MB to book (amount).' },
          paths: { type: 'string', description: 'Absolute folders this run works in — comma or newline separated. A booked folder covers its subtree.' },
          expected: { type: 'string', description: 'The expected time the caller decided on (recorded as info; leave empty when unknown).' },
          note: { type: 'string', description: 'A short note for the register.' },
          run: { type: 'string', description: 'Optional run id when the caller carries one.' },
        },
        required: ['service'],
      },
      run: async (args) => {
        const outcome = await store.book({
          service: args.service,
          mode: args.mode,
          gpu: args.gpu,
          cores: amountOf(args.cores),
          ramMb: amountOf(args.ramMb),
          diskMb: amountOf(args.diskMb),
          paths: pathsOf(args.paths),
          expected: args.expected,
          note: args.note,
          run: args.run,
        });
        return jsonResult(outcome);
      },
    },
    {
      name: 'rm_bookings',
      description:
        'THE REGISTER — every current booking (what is held, by which service, since when). Pass include_ended to also see the last popped/cleared ones.',
      inputSchema: {
        type: 'object',
        properties: {
          include_ended: { type: 'boolean', description: 'Also list ended bookings (popped · cleared).' },
        },
      },
      run: async (args) => {
        const includeEnded = args.include_ended === true || args.include_ended === 'true';
        return jsonResult({ ok: true, active: store.active(), ...(includeEnded ? { ended: store.ended() } : {}) });
      },
    },
    {
      name: 'rm_pop',
      description: 'POP a booking — the normal exit: the run ended, so what it held is unassignable-no-more. The resources free the moment this answers.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The booking id rm_book returned.' } },
        required: ['id'],
      },
      run: async (args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) throw new ToolRefusal('rm_pop needs the booking id — call rm_bookings to see them');
        const ended = store.pop(id);
        if (!ended) return textResult(`no such booking: ${id} — call rm_bookings to see the register`, true);
        return jsonResult({ ok: true, booking: ended });
      },
    },
    {
      name: 'rm_clear',
      description: 'CLEAR a booking by hand — the corpse path: e.g. a run died without popping, or the operator takes a stale hold back. Same effect as pop; recorded as cleared so the register remembers it was a hand.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The booking id rm_book returned.' } },
        required: ['id'],
      },
      run: async (args) => {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) throw new ToolRefusal('rm_clear needs the booking id — call rm_bookings to see them');
        const ended = store.clear(id);
        if (!ended) return textResult(`no such booking: ${id} — call rm_bookings to see the register`, true);
        return jsonResult({ ok: true, booking: ended });
      },
    },
  ];
}

export function createRmMcpRegistry(store: BookingStore, reads: ReadsFn): McpRegistry {
  const tools = buildTools(store, reads);
  return {
    module: 'resource-manager',
    list: () => tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    call: async (name, args) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new ToolRefusal(`unknown tool: ${name}`);
      return tool.run(args ?? {});
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createBookingStore } = await import('./bookingStore.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mcp-'));
  const fakeReads = {
    collectedAt: new Date().toISOString(),
    node: 'test-node',
    platform: 'win32',
    cpu: { model: 'fake', cores: 8, loadPct: 3 },
    ram: { totalMb: 16000, freeMb: 9000 },
    gpus: [{ name: 'RX 6800', vramMb: 16384, vramSource: 'registry' as const, memUsedMb: null }],
    gpusObserved: [{ name: 'lolMiner.exe', pid: 1, reason: 'miner' }],
    disks: [{ device: 'C:', freeMb: 100000, totalMb: 500000 }],
    shares: [],
    notes: [],
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const registry = createRmMcpRegistry(store, () => fakeReads);

  const advertised = registry.list();
  ok('registry names its module', registry.module === 'resource-manager');
  ok('five tools are advertised', advertised.length === 5, advertised.map((t) => t.name).join(','));
  ok('advertised tools carry no run hand', advertised.every((t) => !('run' in t)));
  ok('every advertised tool has a description and schema', advertised.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));

  const poll = await registry.call('rm_resources', {});
  const pollBody = JSON.parse(poll.content[0].text) as { ok: boolean; node: string; cpu: { cores: number }; bookings: unknown[]; gpusObserved: Array<{ reason: string }> };
  ok('rm_resources answers the whole read', pollBody.ok === true && pollBody.node === 'test-node' && pollBody.cpu.cores === 8 && Array.isArray(pollBody.bookings));
  ok('rm_resources carries the observed row', pollBody.gpusObserved.some((p) => p.reason === 'miner'));

  const booked = await registry.call('rm_book', { service: 'image-gen', gpu: 'RX 6800', cores: 4, paths: 'C:\\work\\a, C:\\work\\b' });
  const bookedBody = JSON.parse(booked.content[0].text) as { ok: boolean; booking: { id: string; paths: string[] } };
  ok('rm_book lands the whole book', bookedBody.ok === true && bookedBody.booking.id.startsWith('bk-') && bookedBody.booking.paths.length === 2);

  const doubleBook = await registry.call('rm_book', { service: 'other', gpu: 'RX 6800' });
  const doubleBody = JSON.parse(doubleBook.content[0].text) as { ok: boolean; error: { code: string; blockers: Array<{ heldBy: { service: string } | null }> } };
  ok('rm_book refusal rides as a normal answer (ok:false, not isError)', doubleBody.ok === false && doubleBook.isError !== true);
  ok('the refusal names the holder — the wait info', doubleBody.error.code === 'double_booked' && doubleBody.error.blockers[0].heldBy?.service === 'image-gen');

  const missingService = await registry.call('rm_book', { cores: 2 });
  ok('rm_book without a service answers invalid_book', (JSON.parse(missingService.content[0].text) as { error: { code: string } }).error.code === 'invalid_book');

  const listed = await registry.call('rm_bookings', {});
  ok('rm_bookings lists the active register', (JSON.parse(listed.content[0].text) as { active: unknown[] }).active.length === 1);

  const popped = await registry.call('rm_pop', { id: bookedBody.booking.id });
  ok('rm_pop lifts the booking', (JSON.parse(popped.content[0].text) as { booking: { endReason: string } }).booking.endReason === 'popped');

  const ended = await registry.call('rm_bookings', { include_ended: true });
  ok('rm_bookings can show the ended ones', (JSON.parse(ended.content[0].text) as { ended: unknown[] }).ended.length === 1);

  const popMissing = await registry.call('rm_pop', { id: 'bk-nope' });
  ok('popping an unknown id is an answer with isError', popMissing.isError === true && popMissing.content[0].text.includes('no such booking'));

  let refusalThrown = false;
  try {
    await registry.call('rm_pop', {});
  } catch (err) {
    refusalThrown = err instanceof ToolRefusal;
  }
  ok('rm_pop without an id throws ToolRefusal', refusalThrown);

  let unknownThrown = false;
  try {
    await registry.call('nope_nope', {});
  } catch (err) {
    unknownThrown = err instanceof ToolRefusal;
  }
  ok('an unknown tool throws ToolRefusal', unknownThrown);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
