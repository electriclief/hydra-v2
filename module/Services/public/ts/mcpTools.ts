/**
 * @module mcpTools
 * @description The AGENT face as a REGISTRY — the module hands its tool set over as an
 *              object with its call hand (list + call, MCP-shaped). The module's own /mcp
 *              mounts it today; Api_Root will mount the SAME registry later — they cannot
 *              drift, because it is literally the same object.
 * @intent Operator ruling (2026-09-16): every module ships an mcp registry ready for
 *         Api_Root. The point of Services is exactly this: let an LLM (Echidna) agent see
 *         everything a service declares — advert, provider, variables, modes, the install
 *         face with the version dance for older cards — and nothing here runs.
 */

import type { ServiceCatalog } from './serviceCatalog.js';
import { buildManifest, lastSyncMark, syncFrom } from './shelf.js';

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

// --- Function Definitions ---

export function buildTools(catalog: ServiceCatalog, extras: { shelfRoot?: string } = {}): McpTool[] {
  const shelfRoot = extras.shelfRoot;
  return [
    {
      name: 'services_list',
      description:
        'THE AVAILABLE SERVICES — the catalog this node carries, as shapes: name, what it does, its provider, its modes, its karma weight, whether it is sound. Contents only ever answer services_get. Call this first, then pick.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional substring filter across name · provider · mode · what it does.' },
        },
      },
      run: async (args) => {
        const filter = typeof args.filter === 'string' && args.filter.trim() ? args.filter.trim() : undefined;
        const services = catalog.list(filter);
        return jsonResult({ ok: true, count: services.length, dir: catalog.dir, services });
      },
    },
    {
      name: 'services_get',
      description:
        'THE WHOLE DEFINITION of one service: advert (what · expected time — from history · karma weight) · provider (the app that runs it, with its install/update/launch) · variables (init · input · file slots — a slot plugs a file OR a service that produces it) · modes (one service, several fits; each mode carries its models, needs, karma weight and INSTALL — the version dance: pinned python/cuda/torch combos and per-sm_XX build notes for older cards) · needs (what the Resource Manager will book) · output · children · update · pages (ad — the sell sheet; inputs — the way in) · progress (how the run is watched) · gui (its own gui, when it has one). Read it, do not run it: running is the Scheduler\'s business.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The service name, exactly as services_list shows it.' },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) throw new ToolRefusal('services_get needs a name — call services_list to see them');
        const entry = catalog.get(name);
        if (!entry) return textResult(`no such service: ${name} — call services_list to see the catalog, or services_validate when a file was just added`, true);
        return jsonResult({ ok: true, service: entry.definition, file: entry.file, warnings: entry.warnings });
      },
    },
    {
      name: 'services_ad',
      description:
        'THE AD PAGE (the sell sheet) of one service — the html the maker wrote to sell it: the advert, images, blocks. It rides INSIDE the definition; this returns it as text.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The service name, exactly as services_list shows it.' },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) throw new ToolRefusal('services_ad needs a name — call services_list to see them');
        const ad = catalog.ad(name);
        if (ad === null) return textResult(`no ad page for: ${name} — call services_list to see the catalog`, true);
        return { content: [{ type: 'text', text: ad }] };
      },
    },
    {
      name: 'services_inputs',
      description:
        'THE INPUTS PAGE (the way in) of one service — gathers the required inputs before the run; during the run the progress rides on it. It rides INSIDE the definition; this returns it as text.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The service name, exactly as services_list shows it.' },
        },
        required: ['name'],
      },
      run: async (args) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name) throw new ToolRefusal('services_inputs needs a name — call services_list to see them');
        const inputs = catalog.inputs(name);
        if (inputs === null) return textResult(`no inputs page for: ${name} — call services_list to see the catalog`, true);
        return { content: [{ type: 'text', text: inputs }] };
      },
    },
    {
      name: 'services_reload',
      description:
        'RE-SCAN the services folder — the folder IS the catalog. Use after a service file was added, edited, or removed; answers the fresh count and every refusal with its reason.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const entries = catalog.reload();
        return jsonResult({
          ok: true,
          dir: catalog.dir,
          count: entries.length,
          refused: catalog.refusals().map((entry) => ({ file: entry.file, errors: entry.errors })),
        });
      },
    },
    {
      name: 'services_validate',
      description:
        'THE VALIDATION REPORT — every definition this node carries, with errors (refusals) and warnings (things that will bite later: no expected time yet, a mode without install). Pass a name for one service only.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Optional service name — omit for the whole catalog.' },
        },
      },
      run: async (args) => {
        const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : undefined;
        const list = name ? catalog.entries().filter((entry) => entry.name === name) : catalog.entries();
        if (name && list.length === 0) return textResult(`no such service: ${name} — call services_list to see the catalog`, true);
        return jsonResult({
          ok: list.every((entry) => entry.ok),
          reports: list.map((entry) => ({ name: entry.name, file: entry.file, ok: entry.ok, errors: entry.errors, warnings: entry.warnings })),
        });
      },
    },
    {
      name: 'services_shelf',
      description:
        'THE REVISION — what this node is carrying: rev (a hash of every in-scope file), how many files, how many bytes, '
        + 'when it last pulled and from where. Pass `peer` to compare without changing anything: you get behind/ahead '
        + 'counts. A node is ahead only if it carries files the peer does not; nothing is ever deleted by a pull.',
      inputSchema: {
        type: 'object',
        properties: {
          peer: { type: 'string', description: 'Optional peer base URL, e.g. http://192.168.1.123:8128 — omit for this node alone.' },
        },
      },
      run: async (args) => {
        if (!shelfRoot) return textResult('this Services instance was started without a shelf root — nothing to report', true);
        const mine = buildManifest(shelfRoot);
        const base = {
          rev: mine.rev,
          files: mine.files.length,
          bytes: mine.bytes,
          lastSync: lastSyncMark(shelfRoot),
        };
        const peer = typeof args.peer === 'string' && args.peer.trim() ? args.peer.trim() : '';
        if (!peer) return jsonResult({ ok: true, ...base });
        try {
          const out = await syncFrom(shelfRoot, peer, { apply: false });
          return jsonResult({ ok: true, ...base, peer: out.peer, peerRev: out.peerRev, behind: out.behind, ahead: out.ahead, inSync: out.behind === 0 });
        } catch (err) {
          return jsonResult({ ok: false, ...base, peer, error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      name: 'services_sync',
      description:
        'PULL A NEWER SHELF — fetch only the files that differ from `peer`, each verified against the peer\'s own '
        + 'manifest and staged before it replaces anything. Default is a dry run: you get the list of files and '
        + 'nothing is written. Pass apply:true to write. A file whose bytes do not match its hash is REFUSED, and the '
        + 'node keeps running what it had.',
      inputSchema: {
        type: 'object',
        properties: {
          peer: { type: 'string', description: 'Peer base URL to pull from, e.g. http://192.168.1.123:8128' },
          apply: { type: 'boolean', description: 'false (default) = report what would move; true = fetch and verify.' },
          only: { type: 'string', description: 'Optional comma-separated paths to restrict the pull to.' },
        },
        required: ['peer'],
      },
      run: async (args) => {
        if (!shelfRoot) return textResult('this Services instance was started without a shelf root — nothing to pull into', true);
        const peer = typeof args.peer === 'string' ? args.peer.trim() : '';
        if (!peer) return textResult('peer is required — the base URL of the node whose shelf you want', true);
        const only = typeof args.only === 'string' && args.only.trim() ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        try {
          const out = await syncFrom(shelfRoot, peer, { apply: args.apply === true, only });
          return jsonResult({ ok: true, ...out });
        } catch (err) {
          return textResult(`pull failed: ${err instanceof Error ? err.message : String(err)}`, true);
        }
      },
    },
  ];
}

export function createServiceMcpRegistry(catalog: ServiceCatalog, extras: { shelfRoot?: string } = {}): McpRegistry {
  const tools = buildTools(catalog, extras);
  return {
    module: 'services',
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
  const { createServiceCatalog } = await import('./serviceCatalog.js');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-mcp-'));
  fs.writeFileSync(
    path.join(dir, 'tts.js'),
    'module.exports = { name: "tts", advert: { what: "speak a line" }, provider: { name: "piper" }, modes: [{ name: "cpu", install: { steps: ["pip install piper"] } }], pages: { ad: "<h1>tts</h1>", inputs: "<h1>in</h1>" } };',
  );
  fs.writeFileSync(path.join(dir, 'broken.js'), 'module.exports = { name: "" };');
  const catalog = createServiceCatalog({ dir });
  const registry = createServiceMcpRegistry(catalog);

  const advertised = registry.list();
  ok('registry names its module', registry.module === 'services');
  ok('eight tools are advertised', advertised.length === 8, advertised.map((t) => t.name).join(','));
  ok('advertised tools carry no run hand', advertised.every((t) => !('run' in t)));
  ok('every advertised tool has a description and schema', advertised.every((t) => t.description.length > 20 && t.inputSchema.type === 'object'));

  const listed = await registry.call('services_list', {});
  const listBody = JSON.parse(listed.content[0].text) as { count: number; services: Array<{ name: string; ok: boolean }> };
  ok('services_list shows the catalog by shape', listBody.count === 2 && listBody.services.some((s) => s.name === 'tts' && s.ok === true));
  ok('a broken service rides the listing as refused', listBody.services.some((s) => s.name === 'broken' && s.ok === false));
  ok('the listing never carries the pages', !JSON.stringify(listBody).includes('<h1>'));

  const got = await registry.call('services_get', { name: 'tts' });
  const gotBody = JSON.parse(got.content[0].text) as { service: { advert: { what: string }; modes: Array<{ name: string }> } };
  ok('services_get answers the whole definition', gotBody.service.advert.what === 'speak a line' && gotBody.service.modes[0].name === 'cpu');

  const ad = await registry.call('services_ad', { name: 'tts' });
  ok('services_ad answers the ad page as text', ad.content[0].text.includes('<h1>tts</h1>'));
  const inPage = await registry.call('services_inputs', { name: 'tts' });
  ok('services_inputs answers the way-in page as text', inPage.content[0].text.includes('<h1>in</h1>'));

  const refused = await registry.call('services_get', { name: 'nope' });
  ok('an unknown service is refused with a hint', refused.isError === true && refused.content[0].text.includes('services_list'));

  const reloaded = await registry.call('services_reload', {});
  const reloadBody = JSON.parse(reloaded.content[0].text) as { count: number; refused: unknown[] };
  ok('services_reload re-scans and reports refusals', reloadBody.count === 2 && reloadBody.refused.length === 1);

  const report = await registry.call('services_validate', {});
  const reportBody = JSON.parse(report.content[0].text) as { ok: boolean; reports: Array<{ name: string; ok: boolean }> };
  ok('services_validate reports the whole catalog', reportBody.ok === false && reportBody.reports.length === 2);

  let refusalThrown = false;
  try {
    await registry.call('nope_nope', {});
  } catch (err) {
    refusalThrown = err instanceof ToolRefusal;
  }
  ok('an unknown tool throws ToolRefusal', refusalThrown);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[mcpTools] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
