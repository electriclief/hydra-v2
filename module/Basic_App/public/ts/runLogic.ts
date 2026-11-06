/**
 * @module runLogic
 * @description THE INSTANCE LAYER, pure and testable: given a service DEFINITION and the
 *              user's values, produce the things a run needs — the resolved launch command
 *              ({{token}} resolution over init defaults + input values), the required-input
 *              check, the resource BOOK request (the service's needs mapped for the
 *              Register), the lazy output path (never the same filename twice when the user
 *              is lazy), and the busy read over ProcessWrapper's table.
 * @intent This is the instance's brain per the rulings — and it is deliberately liftable:
 *         when the Scheduler module lands, this layer moves THERE and Basic_App calls it.
 *         Keep it pure: no fetch, no fs, no clocks. The caller supplies existence checks.
 */

import type { BookInput, ProcessRecord, ServiceDefinition, ServiceVariable } from './doors.js';

// --- Interface Definitions ---

export interface ResolvedRun {
  command: string | null;
  missing: string[];
}

export interface ValuesResult {
  values: Record<string, unknown>;
  missing: string[];
}

export interface LazyOutputResult {
  values: Record<string, unknown>;
  changed: Array<{ name: string; from: string; to: string }>;
}

// --- Function Definitions ---

/** Live = started and not yet ended. Defensive over the life string. */
export function isLive(record: ProcessRecord): boolean {
  if (record.endedAt !== null && record.endedAt !== undefined) return false;
  const life = String(record.life ?? '').toLowerCase();
  return life === 'starting' || life === 'running' || life === 'live';
}

/** The first live process carrying the tag — the busy holder. */
export function busyFrom(records: ProcessRecord[], tag = 'basic'): ProcessRecord | null {
  return records.find((r) => r.tag === tag && isLive(r)) ?? null;
}

/** init defaults + input values, one flat context for the launch template. */
export function buildContext(def: ServiceDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const v of def.variables?.init ?? []) {
    if (v && typeof v.name === 'string') context[v.name] = v.default ?? '';
  }
  for (const v of def.variables?.input ?? []) {
    if (v && typeof v.name === 'string' && v.name in values) context[v.name] = values[v.name];
  }
  return context;
}

/** Fill the input values from the user's entries (defaults when absent) and name what is missing. */
export function buildValues(def: ServiceDefinition, provided: Record<string, unknown>): ValuesResult {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const v of def.variables?.input ?? []) {
    if (!v || typeof v.name !== 'string') continue;
    const raw = v.name in provided ? provided[v.name] : v.default;
    const empty = raw === undefined || raw === null || raw === '';
    if (empty && v.required === true) missing.push(v.name);
    values[v.name] = empty && v.default !== undefined ? v.default : raw;
  }
  return { values, missing };
}

/** {{token}} resolution over the context. Unknown tokens stay visible and are reported. */
export function resolveTokens(template: string, context: Record<string, unknown>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
    if (name in context) {
      const v = context[name];
      return v === undefined || v === null ? '' : String(v);
    }
    unknown.push(name);
    return whole;
  });
  return { text, unknown };
}

/** The launch command for a run — provider.launch resolved over init + inputs. */
export function resolveLaunch(def: ServiceDefinition, values: Record<string, unknown>): ResolvedRun {
  const launch = def.provider?.launch;
  if (typeof launch !== 'string' || !launch.trim()) return { command: null, missing: ['provider.launch'] };
  const { text, unknown } = resolveTokens(launch, buildContext(def, values));
  return { command: text, missing: unknown };
}

/** The service's needs → the Register's book request (gpu chosen by the caller from the poll). */
export function buildBookInput(def: ServiceDefinition, gpuName: string | null, runId?: string | null): BookInput {
  const needs = def.needs ?? {};
  const diskGb = typeof needs.diskGb === 'number' ? needs.diskGb : null;
  return {
    service: def.name,
    gpu: needs.gpu === true ? gpuName : null,
    cores: typeof needs.cores === 'number' ? needs.cores : null,
    ramMb: typeof needs.ramMb === 'number' ? needs.ramMb : null,
    diskMb: diskGb === null ? null : Math.round(diskGb * 1024),
    note: 'basic app run',
    run: runId ?? null,
  };
}

/** Never the same filename twice when the user is lazy: out.png → out-2.png → out-3.png … */
export function freshOutputPath(path: string, exists: (p: string) => boolean): string {
  const p = String(path ?? '').trim();
  if (!p) return p;
  if (!exists(p)) return p;
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const dot = p.lastIndexOf('.');
  const hasExt = dot > slash + 1;
  const stem = hasExt ? p.slice(0, dot) : p;
  const ext = hasExt ? p.slice(dot) : '';
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** Apply the lazy rule to every role:'output' input the user left as-is (or on its default). */
export function lazyOutputs(
  def: ServiceDefinition,
  values: Record<string, unknown>,
  exists: (p: string) => boolean,
): LazyOutputResult {
  const changed: LazyOutputResult['changed'] = [];
  const out = { ...values };
  for (const v of def.variables?.input ?? []) {
    if (!v || v.role !== 'output' || typeof v.name !== 'string') continue;
    const current = out[v.name];
    if (typeof current !== 'string' || !current.trim()) continue;
    const fresh = freshOutputPath(current, exists);
    if (fresh !== current) {
      out[v.name] = fresh;
      changed.push({ name: v.name, from: current, to: fresh });
    }
  }
  return { values: out, changed };
}

/** A form-shaped view of the inputs for the renderer (typed, defaulted, marked). */
export function inputFields(def: ServiceDefinition): ServiceVariable[] {
  return (def.variables?.input ?? []).filter((v): v is ServiceVariable => !!v && typeof v.name === 'string');
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL runLogic :: ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const def: ServiceDefinition = {
    name: 'demo',
    provider: { name: 'app', launch: 'run -m {{model}} -p "{{prompt}}" -o {{out}} -n {{missing_token}}' },
    variables: {
      init: [{ name: 'model', default: 'C:/models/a.gguf' }],
      input: [
        { name: 'prompt', type: 'textarea', required: true },
        { name: 'out', type: 'text', default: 'C:/out/img.png', role: 'output' },
        { name: 'steps', type: 'number', default: 20 },
      ],
    },
    needs: { gpu: true, vramGb: 4, ramMb: 4000, cores: 4, diskGb: 2 },
  };

  const filled = buildValues(def, { prompt: 'a cat' });
  ok('defaults fill the values', filled.values.model === undefined && filled.values.steps === 20 && filled.missing.length === 0);
  const missing = buildValues(def, {});
  ok('a required input left empty is named', missing.missing.includes('prompt'));

  const launch = resolveLaunch(def, { prompt: 'a cat', out: 'C:/out/img.png' });
  ok('the launch resolves init + inputs', launch.command === 'run -m C:/models/a.gguf -p "a cat" -o C:/out/img.png -n {{missing_token}}');
  ok('an unknown token stays visible and is reported', launch.missing.includes('missing_token'));

  const book = buildBookInput(def, 'RX 6800', 'r-1');
  ok('the book carries the needs', book.service === 'demo' && book.gpu === 'RX 6800' && book.ramMb === 4000 && book.diskMb === 2048 && book.run === 'r-1');
  const bookNoGpu = buildBookInput({ name: 'x', needs: { gpu: false } }, 'RX 6800');
  ok('a gpu-less service books no gpu', bookNoGpu.gpu === null);

  const taken = new Set(['C:/out/img.png', 'C:/out/img-2.png']);
  const fresh = freshOutputPath('C:/out/img.png', (p) => taken.has(p));
  ok('the lazy rule steps past taken names', fresh === 'C:/out/img-3.png');
  const free = freshOutputPath('C:/out/new.png', (p) => taken.has(p));
  ok('a free name is left alone', free === 'C:/out/new.png');
  const takenNoExt = new Set(['C:/out/img']);
  const noExt = freshOutputPath('C:/out/img', (p) => takenNoExt.has(p));
  ok('a no-extension path still gets a suffix', noExt === 'C:/out/img-2');

  const lazy = lazyOutputs(def, { prompt: 'a cat', out: 'C:/out/img.png' }, (p) => taken.has(p));
  ok('lazyOutputs rewrites the output and reports it', lazy.values.out === 'C:/out/img-3.png' && lazy.changed.length === 1);

  const live = { id: 'a', name: 'n', tag: 'basic', life: 'running', endedAt: null } as unknown as ProcessRecord;
  const dead = { id: 'b', name: 'n', tag: 'basic', life: 'ended', endedAt: 123 } as unknown as ProcessRecord;
  const busy = busyFrom([dead, live]);
  ok('busy picks the live one', busy !== null && busy.id === 'a');
  ok('no live = not busy', busyFrom([dead]) === null);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[runLogic] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}
