/**
 * @module serviceCatalog
 * @description The catalog — THE FOLDER IS THE CATALOG: scan it, load every `.js` service
 *              file as DATA (never executed), validate, and serve: list (shapes only — the
 *              pages never ride a listing), get (the whole definition), ad + inputs (the
 *              maker's two pages), reload (re-scan), refusals (every bad file with its reason).
 * @intent A bad file never breaks the catalog: it rides as a refusal. Duplicate names are
 *         refused on BOTH sides. Nothing runs here — the definitions are the whole job;
 *         scheduling and running are the Scheduler module's business, later.
 */

import fs from 'node:fs';
import path from 'node:path';
import { summarizeService, type ServiceDefinition, type ServiceSummary, type ValidationIssue } from './serviceSchema.js';
import { loadServiceFile } from './serviceFile.js';

// --- Interface Definitions ---

export interface ServiceEntry {
  /** The definition's own name; falls back to the file stem when it never validated. */
  name: string;
  /** Absolute path of the file it came from. */
  file: string;
  ok: boolean;
  definition: ServiceDefinition | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  loadedAt: string;
}

export interface ServiceCatalog {
  /** The folder this catalog serves (the folder IS the catalog). */
  dir: string;
  /** Re-scan the folder; answers the fresh entries. */
  reload(): ServiceEntry[];
  /** The listing — shapes only. An optional filter matches name · provider · mode · what. */
  list(query?: string): ServiceSummary[];
  /** One entry by exact name — null when unknown or refused. */
  get(name: string): ServiceEntry | null;
  /** The AD page (the sell sheet) of one service — null when unknown or refused. */
  ad(name: string): string | null;
  /** The INPUTS page (the way in) of one service — null when unknown or refused. */
  inputs(name: string): string | null;
  /** Every entry, good or refused. */
  entries(): ServiceEntry[];
  /** Only the refused ones. */
  refusals(): ServiceEntry[];
}

export interface CatalogOptions {
  dir: string;
}

// --- Function Definitions ---

export function createServiceCatalog(options: CatalogOptions): ServiceCatalog {
  const dir = path.resolve(options.dir);
  let entries: ServiceEntry[] = [];

  const stem = (file: string): string => path.basename(file).replace(/\.js$/, '');

  function reload(): ServiceEntry[] {
    const loadedAt = new Date().toISOString();
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((name) => name.endsWith('.js')).sort();
    } catch {
      /* no folder yet — an empty catalog is honest */
    }
    const fresh: ServiceEntry[] = files.map((name) => {
      const file = path.join(dir, name);
      const result = loadServiceFile(file);
      return {
        name: result.definition?.name ?? stem(file),
        file,
        ok: result.definition !== null,
        definition: result.definition,
        errors: result.report.errors.slice(),
        warnings: result.report.warnings.slice(),
        loadedAt,
      };
    });

    // duplicates — refused on BOTH sides (the name must mean one thing)
    const byName = new Map<string, ServiceEntry[]>();
    for (const entry of fresh) {
      const list = byName.get(entry.name) ?? [];
      list.push(entry);
      byName.set(entry.name, list);
    }
    for (const [name, list] of byName) {
      if (list.length > 1) {
        const message = `duplicate service name "${name}" — ${list.length} files claim it: ${list.map((e) => path.basename(e.file)).join(', ')}`;
        for (const entry of list) {
          entry.errors.push({ level: 'error', field: 'name', message });
          entry.ok = false;
          entry.definition = null;
        }
      }
    }

    entries = fresh;
    return entries;
  }

  function list(query?: string): ServiceSummary[] {
    const needle = (query ?? '').trim().toLowerCase();
    return entries
      .map((entry) =>
        entry.definition
          ? summarizeService(entry.definition, entry.file, entry.ok)
          : { name: entry.name, what: '', provider: '', modes: [] as string[], karma: null, output: null, children: 0, ok: false, file: entry.file },
      )
      .filter((summary) => {
        if (!needle) return true;
        const haystack = [summary.name, summary.what, summary.provider, ...summary.modes].join(' ').toLowerCase();
        return haystack.includes(needle);
      });
  }

  function get(name: string): ServiceEntry | null {
    return entries.find((entry) => entry.ok && entry.name === name) ?? null;
  }

  function ad(name: string): string | null {
    const entry = get(name);
    return entry?.definition ? String(entry.definition.pages?.ad) : null;
  }

  function inputs(name: string): string | null {
    const entry = get(name);
    return entry?.definition ? String(entry.definition.pages?.inputs) : null;
  }

  const catalog: ServiceCatalog = {
    dir,
    reload,
    list,
    get,
    ad,
    inputs,
    entries: () => entries,
    refusals: () => entries.filter((entry) => !entry.ok),
  };
  catalog.reload(); // the folder is the catalog — it scans itself on creation
  return catalog;
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-cat-'));
  const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
  const def = (name: string, what: string) =>
    `module.exports = { name: "${name}", advert: { what: "${what}" }, provider: { name: "demo app" }, modes: [{ name: "cpu", install: { steps: ["do it"] } }], pages: { ad: "<h1>${name}</h1>", inputs: "<h1>in</h1>" } };`;

  write('a.js', def('resize', 'resize an image'));
  write('b.js', def('render', 'render a video'));
  write('bad.js', 'module.exports = { name: "", page: "" };');
  write('dup.js', def('resize', 'the other resize'));

  const catalog = createServiceCatalog({ dir });
  ok('the catalog scans itself on creation', catalog.entries().length === 4, String(catalog.entries().length));
  ok('duplicates are refused on BOTH sides', catalog.entries().filter((e) => e.name === 'resize' && !e.ok).length === 2);
  ok('the good one is untouched', catalog.get('render') !== null && catalog.get('render')?.definition?.advert.what === 'render a video');
  ok('a refused name does not resolve', catalog.get('resize') === null);
  ok('refusals carry their reason', catalog.refusals().length === 3 && catalog.refusals().some((e) => e.errors.some((x) => x.message.includes('duplicate'))));

  const listed = catalog.list();
  ok('the listing carries shapes', listed.length === 4 && listed.every((s) => !('pages' in s) && !JSON.stringify(s).includes('<h1>')));
  ok('a filter narrows by name/provider/mode/what', catalog.list('video').length === 1 && catalog.list('video')[0].name === 'render');
  ok('the ad page answers by name', (catalog.ad('render') ?? '').includes('<h1>render</h1>'));
  ok('the inputs page answers by name', (catalog.inputs('render') ?? '').includes('<h1>in</h1>'));
  ok('the pages refuse for unknown names', catalog.ad('nope') === null && catalog.inputs('nope') === null);

  write('c.js', def('tts', 'speak a line'));
  catalog.reload();
  ok('a reload picks up a new file', catalog.entries().length === 5 && catalog.get('tts') !== null);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[serviceCatalog] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
