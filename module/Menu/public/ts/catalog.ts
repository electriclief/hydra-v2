/**
 * @module catalog
 * @description What the menu knows about a service, read from the Services door (never copied):
 *              its name, its one-sentence advert, the task it does (and the label that follows
 *              the name in the tree), its karma, and the input fields it declares — the fields
 *              the inputs page turns into a form.
 * @intent The tree is a VIEW of the catalog. Nothing here invents a service, and a service that
 *         the catalog refuses is shown as refused rather than hidden: a broken door is news.
 */

// --- Interface Definitions ---

/** One declared input, straight from `variables.input` in the service file. */
export interface MenuField {
  name: string;
  label: string;
  type: string;
  default: unknown;
  options: string[];
  help: string | null;
  full: boolean;
}

/** One weights file as the service declares it — size and digest, not a path. */
export interface MenuModel {
  /** basename on disk — the node decides which folder that sits in */
  file: string | null;
  family: string;
  quant: string | null;
  bytes: number;
  vramGb: number | null;
  role: string | null;
  sha256: string | null;
  note: string | null;
  /** what Launch should send for THIS model (model file, quant, variant…) */
  inputs: Record<string, unknown> | null;
}

export interface MenuRow {
  name: string;
  /** The short label that appends to the name in the tree: LLM · Video · Image · Music. */
  label: string;
  emoji: string;
  task: string;
  what: string;
  provider: string;
  karma: number | null;
  modes: string[];
  fields: MenuField[];
  /** The weights, with real sizes — what the row actually runs. */
  models: MenuModel[];
  /** What it wants from the machine, and what to do when it is not there. */
  needs: Record<string, unknown> | null;
  whenItDoesNotFit: string | null;
  /** false = the catalog refused the file; the row says so and cannot be opened. */
  ok: boolean;
  errors: string[];
}

export interface CatalogOptions {
  /** Where the Services door answers. */
  servicesUrl: string;
  timeoutMs?: number;
  /** Only rows where the page exists (default false — refused rows are shown, greyed). */
  onlyServable?: boolean;
}

// --- Function Definitions ---

/** task → the label that follows the name, and the glyph. Data, not a lookup the page needs. */
const TASK_LOOKS: Record<string, { label: string; emoji: string }> = {
  'text-generation': { label: 'LLM', emoji: '🦙' },
  'image-text-to-text': { label: 'LLM', emoji: '🦙' },
  'text-to-image': { label: 'Image', emoji: '🖼️' },
  'image-to-video': { label: 'Video', emoji: '🎬' },
  'text-to-video': { label: 'Video', emoji: '🎬' },
  'text-to-audio': { label: 'Music', emoji: '🎵' },
  'text-to-speech': { label: 'Speech', emoji: '🗣️' },
  'image-segmentation': { label: 'Mask', emoji: '✂️' },
};

export function lookFor(task: string): { label: string; emoji: string } {
  const hit = TASK_LOOKS[task];
  if (hit) return hit;
  if (!task) return { label: 'Service', emoji: '📦' };
  // an unknown task still says what it is, in its own words
  const words = task.split(/[-_]/).filter(Boolean);
  return { label: words.length ? words[words.length - 1].replace(/^./, (c) => c.toUpperCase()) : task, emoji: '📦' };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function asFields(raw: unknown): MenuField[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuField[] = [];
  for (const item of raw) {
    const f = item as Record<string, unknown>;
    const name = asString(f.name);
    if (!name) continue;
    out.push({
      name,
      label: asString(f.label, name),
      type: asString(f.type, 'text'),
      default: f.default ?? null,
      options: Array.isArray(f.options) ? f.options.map((o) => String(o)) : [],
      help: asString(f.help) || null,
      full: f.full === true,
    });
  }
  return out;
}

function asModels(raw: unknown): MenuModel[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuModel[] = [];
  for (const item of raw) {
    const m = item as Record<string, unknown>;
    const family = asString(m.family) || asString(m.id);
    if (!family) continue;
    const bytes = typeof m.bytes === 'number' ? m.bytes : Number.parseInt(String(m.bytes ?? ''), 10);
    out.push({
      file: asString(m.file) || null,
      family,
      quant: asString(m.quant) || null,
      bytes: Number.isFinite(bytes) ? bytes : 0,
      vramGb: typeof m.vramGb === 'number' ? m.vramGb : null,
      role: asString(m.role) || null,
      sha256: asString(m.sha256) || null,
      note: asString(m.note) || null,
      inputs: m.inputs && typeof m.inputs === 'object' ? (m.inputs as Record<string, unknown>) : null,
    });
  }
  return out;
}

interface Summary {
  name: string;
  what?: string;
  provider?: string;
  karma?: number | null;
  modes?: string[];
  ok?: boolean;
}

/** Fetch the catalog. A dead Services door is reported as an empty list WITH the reason. */
export async function fetchRows(options: CatalogOptions): Promise<{ rows: MenuRow[]; error: string | null }> {
  const base = options.servicesUrl.replace(/\/+$/, '');
  const timeout = options.timeoutMs ?? 4000;
  const get = async (p: string): Promise<unknown> => {
    const res = await fetch(base + p, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${p} answered ${res.status}`);
    return res.json();
  };

  let listing: { services?: Summary[] };
  try {
    listing = (await get('/api/services')) as { services?: Summary[] };
  } catch (e) {
    return { rows: [], error: `the Services door is not answering at ${base} (${e instanceof Error ? e.message : String(e)})` };
  }

  const rows: MenuRow[] = [];
  for (const summary of listing.services ?? []) {
    const name = asString(summary.name);
    if (!name) continue;
    if (summary.ok === false) {
      rows.push({
        name, label: 'Refused', emoji: '⛔', task: '', what: asString(summary.what, 'the catalog refused this file'),
        provider: asString(summary.provider), karma: null, modes: [], fields: [],
        models: [], needs: null, whenItDoesNotFit: null, ok: false, errors: [],
      });
      continue;
    }
    // the whole definition, for the task, the fields and the pages
    let def: Record<string, unknown> = {};
    try {
      const one = (await get(`/api/services/${encodeURIComponent(name)}`)) as { service?: Record<string, unknown> };
      def = one.service ?? {};
    } catch {
      /* a row without a definition still lists; it just has no form */
    }
    const task = asString(def.task, asString((def.tasks as string[] | undefined)?.[0]));
    const look = lookFor(task);
    const advert = (def.advert ?? {}) as Record<string, unknown>;
    const variables = (def.variables ?? {}) as Record<string, unknown>;
    rows.push({
      name,
      label: look.label,
      emoji: look.emoji,
      task,
      what: asString(advert.what, asString(summary.what)),
      provider: asString((def.provider as Record<string, unknown> | undefined)?.name, asString(summary.provider)),
      karma: typeof advert.karma === 'number' ? advert.karma : (summary.karma ?? null),
      modes: Array.isArray(summary.modes) ? summary.modes.map(String) : [],
      fields: asFields(variables.input),
      models: asModels(def.models),
      needs: def.needs && typeof def.needs === 'object' ? (def.needs as Record<string, unknown>) : null,
      whenItDoesNotFit: asString(def.whenItDoesNotFit) || null,
      ok: true,
      errors: [],
    });
  }

  rows.sort((a, b) => Number(b.ok) - Number(a.ok) || a.name.localeCompare(b.name));
  return { rows: options.onlyServable ? rows.filter((r) => r.ok) : rows, error: null };
}

/** One row by name, from the same fetch. */
export async function fetchRow(options: CatalogOptions, name: string): Promise<MenuRow | null> {
  const { rows } = await fetchRows(options);
  return rows.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null;
}
