/**
 * @module serviceSchema
 * @description THE SERVICE OBJECT — the shape of one service definition (the elaborate
 *              object as the talk settled it): advert (what · expected time · karma weight)
 *              · provider (the app that runs it, with install/update/launch/probe) ·
 *              variables (init · input · files — a file slot plugs a file OR a service that
 *              produces it) · modes (one service, several fits — each with its own models,
 *              needs, karma weight and INSTALL, where the version dance lives: pinned
 *              python·cuda·torch combos and per-sm_XX build notes for older cards) · needs
 *              (what the Resource Manager books) · output · children (declared, wired by
 *              their outputs) · update (a declared command) · pages (the TWO the service
 *              PRODUCES: ad — the sell sheet; inputs — the way in, which gathers the
 *              required inputs and carries progress during the run) · progress (the
 *              declared how-to — the INSTANCE tracks and shows it) · gui (the service's own
 *              gui, when it has one — a button follows it). v0.2: the core is checked hard,
 *              everything else passes through untouched — nothing frozen; the object stays
 *              liquid.
 * @intent "Services is just an elaborate object" (operator). Services declares; nothing here
 *         runs. A service file is DATA — validated, never executed.
 */

// --- Interface Definitions ---

export interface ServiceVariable {
  name: string;
  label?: string;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'range';
  default?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  help?: string;
  full?: boolean;
  muted?: boolean;
  /** 'output' marks the output path among the inputs — give it a default; the instance keeps filenames fresh (never the same name twice when the user is lazy). */
  role?: string;
  [extra: string]: unknown;
}

/** A required FILE — per request (a run's input file), or per install (a node's file). */
export interface ServiceFileSlot {
  name: string;
  path?: string;
  kind?: string;
  note?: string;
  /** The slot may plug a FILE, or a SERVICE that produces it. */
  service?: string;
  [extra: string]: unknown;
}

/** A LINK — everything heavy travels by link, never inside the file. */
export interface ServiceLink {
  path?: string;
  url?: string;
  sha256?: string;
  source?: { magnet?: string; peer?: string; [extra: string]: unknown };
  note?: string;
  [extra: string]: unknown;
}

/** THE INSTALL FACE — where the version dance lives (older GPU cards are first-class). */
export interface ServiceInstall {
  /** What runs the weights (llama.cpp · audio.cpp · sd.cpp · ComfyUI …). */
  engine?: string;
  /** Hard preconditions, each checkable: 'windows' · 'python>=3.11' · 'nvidia-driver>=560'. */
  requires?: string[];
  /** Pinned toolchain combos that still exist and fit: { python: '3.11', cuda: '11.8', torch: '2.5.1+cu118' }. */
  pins?: Record<string, string>;
  /** The card's compute, when a build is per-architecture: e.g. '52' → an sm_52 build. */
  sm?: string;
  arch?: string;
  /** The ordered steps. A bare string still loads; an object carries its own mechanical verify. */
  steps?: (string | InstallStep)[];
  /** What was learned — rules that PREDICT, never forbid. See InstallHint. */
  hints?: (string | InstallHint)[];
  /** The awkward cases: platform quirks, locks, drivers. Each carries its own reason and escape. */
  exceptions?: InstallException[];
  /** Which verifications this install produces evidence for: sha256 · exit0 · version · health · file. */
  evidence?: string[];
  /** Where the payload comes from when the network cannot serve it (paths, urls). */
  fallback?: string[];
  note?: string;
  [extra: string]: unknown;
}

/** ONE INSTALL STEP — "do" is how, "verify" is the only thing that can turn it green. */
export interface InstallStep {
  id?: string;
  do: string;
  /** MECHANICAL, so a runner can decide alone: 'sha256:<hash>' · 'exit0' · 'version:<s>' · 'health:<path>' · 'file:<path>'. */
  verify?: string;
  retry?: number;
  note?: string;
  [extra: string]: unknown;
}

/**
 * A HINT PREDICTS, IT NEVER FORBIDS. Any rule that names a condition must carry what would make it unnecessary,
 * because a rule with no escape hatch ages into folklore and outlives the hardware that caused it.
 */
export interface InstallHint {
  /** The condition it applies to: 'device reports fp16:false' · 'pip installed onnxruntime after DML'. */
  when?: string;
  do: string;
  why?: string;
  /** What would make this rule unnecessary — try this first. */
  reconsider?: string;
  /** true only with evidence attached; false means "suspected, not measured" and reads as an invitation. */
  verified?: boolean;
  evidence?: string;
  learned?: string;
  [extra: string]: unknown;
}

/** A PLATFORM QUIRK with its reason and its way out. */
export interface InstallException {
  when: string;
  do: string;
  why?: string;
  reconsider?: string;
  verified?: boolean;
  [extra: string]: unknown;
}

/** WHAT AN INSTALLER LEARNED, AND WHO LEARNED IT — append-only; a wrong entry is superseded, never edited. */
export interface InstallHistoryEntry {
  /** Must equal the service's own revision at the time of the change. */
  rev: number;
  at: string;
  /** Who to ask when this turns out wrong: 'hermes-agent' · 'operator' · an Echidna handle. */
  by: string;
  note: string;
  /** CAPABILITY, not identity: 'GTX 980 Ti, 6 GB, Maxwell, fp16:0' — never a node name or an IP. */
  hardware?: string;
  evidence?: string;
  verified?: boolean;
  [extra: string]: unknown;
}

/** The shape this loader writes. A newer file still LOADS — it only warns, because this is malleable software. */
export const CURRENT_SCHEMA = 2;

/** THE TWO PAGES a service produces — the sell sheet and the way in. */
export interface ServicePages {
  /** The AD page — the sell sheet (the listing): what it does in the maker's own voice · images (small ones inline as base64) · whatever sells it. */
  ad: string;
  /** The INPUTS page — the way in: gathers the required inputs before the run; during the run the progress rides on it. Intentionally vague and custom — made with the user. */
  inputs: string;
}

/** HOW PROGRESS IS SEEN — declared here; the INSTANCE (Basic_App) tracks and shows it. */
export interface ServiceProgress {
  /** In words: how can anyone tell how far along a run is (tokens stream · "step N of M" lines · silent until the end). */
  how: string;
  /** Where it reads from when known: stdout · file · http · none. */
  source?: string;
  /** A pattern or key to look for, when there is one. */
  pattern?: string;
  note?: string;
  [extra: string]: unknown;
}

/** THE SERVICE'S OWN GUI, when it has one — Basic_App shows a button that follows it. */
export interface ServiceGui {
  /** How to reach it: url (a web face it serves) · exe (an app that opens) · command · other. */
  kind?: string;
  /** The url, path or command. */
  value?: string;
  note?: string;
  [extra: string]: unknown;
}

/** ONE MODE — the fit between the service and a machine: a smaller mode is how a service reaches smaller nodes. */
export interface ServiceMode {
  name: string;
  /** What this mode fits: { vramGbMin: '6', sm: '<=52', note: '…' }. */
  fits?: Record<string, string>;
  models?: ServiceLink[];
  needs?: ServiceNeeds;
  /** Karma weight for this mode — the service's own number; the ledger lives elsewhere. */
  karma?: number;
  install?: ServiceInstall;
  [extra: string]: unknown;
}

/** What the Resource Manager will book for a run. */
export interface ServiceNeeds {
  gpu?: boolean;
  vramGb?: number;
  ramMb?: number;
  cores?: number;
  diskGb?: number;
  services?: string[];
  [extra: string]: unknown;
}

export interface ServiceDefinition {
  /** Unique in the catalog (the folder IS the catalog). */
  name: string;
  /** THE SHAPE this file was written for. Older migrates in memory; newer only warns — never a refusal. */
  schema?: number;
  /** THIS DEFINITION'S own history. Bump when steps/hints/exceptions/needs/modes/launch change — not for prose. */
  revision?: number;
  /** What installers learned, append-only, and who learned it. */
  installer_history?: InstallHistoryEntry[];
  version?: string;
  /** what it does · expected time (HISTORY: average or last runs — unknown is unknown) · karma weight. */
  advert: { what: string; time?: string; karma?: number; note?: string; [extra: string]: unknown };
  /** THE APP THAT RUNS IT — the provider lives INSIDE the service definition. */
  provider: { name: string; repo?: string; launch?: string; probe?: string; update?: string; note?: string; [extra: string]: unknown };
  /** init = install-time facts · input = per-request values · files = per-request required files. */
  variables?: { init?: ServiceVariable[]; input?: ServiceVariable[]; files?: ServiceFileSlot[]; [extra: string]: unknown };
  modes?: ServiceMode[];
  needs?: ServiceNeeds;
  output?: { kind?: string; location?: string; description?: string; [extra: string]: unknown };
  /** Child services, declared by name — their outputs wire into this service's file slots. */
  children?: string[];
  /** Default install when a mode carries none. */
  install?: ServiceInstall;
  /** The declared update: HOW (a command); WHEN is future wisdom. */
  update?: { command?: string; note?: string; [extra: string]: unknown };
  /** THE TWO PAGES a service produces: pages.ad (the sell sheet) · pages.inputs (the way in — gathers the required inputs; carries progress during the run). Both are the maker's, carried as strings. */
  pages: ServicePages;
  /** HOW PROGRESS IS SEEN for a run — declared here; the INSTANCE (Basic_App) tracks and shows it. Absent = unknown (the instance falls back honestly). */
  progress?: ServiceProgress;
  /** THE SERVICE'S OWN GUI, when it has one — a button follows it. Absent = no gui of its own. */
  gui?: ServiceGui;
  [extra: string]: unknown;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** The SHAPE that a listing carries — contents only ever answer a get. */
export interface ServiceSummary {
  name: string;
  what: string;
  provider: string;
  modes: string[];
  karma: number | null;
  output: string | null;
  children: number;
  ok: boolean;
  file: string;
}

// --- Function Definitions ---

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Check one service definition. Errors refuse it; warnings ride along. */
export function validateService(value: unknown): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const bad = (field: string, message: string) => errors.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => warnings.push({ level: 'warning', field, message });

  if (!isObj(value)) {
    bad('$', 'a service definition is an object');
    return { ok: false, errors, warnings };
  }

  if (!str(value.name)) bad('name', 'name is required (a non-empty string, unique in the catalog)');
  if (value.version !== undefined && !str(value.version)) warn('version', 'version should be a string when present');

  // advert — what it does · expected time · karma weight
  if (!isObj(value.advert)) {
    bad('advert', 'advert is required: { what, time?, karma? }');
  } else {
    if (!str(value.advert.what)) bad('advert.what', 'advert.what is required — one line: what does this service do');
    if (value.advert.time !== undefined && typeof value.advert.time !== 'string') bad('advert.time', 'advert.time is a string (it comes from HISTORY — average or last runs; unknown is unknown)');
    if (value.advert.karma !== undefined && !(typeof value.advert.karma === 'number' && Number.isFinite(value.advert.karma) && value.advert.karma >= 0)) {
      bad('advert.karma', 'advert.karma is a number >= 0 (relative weight; free at zero, its effect is priority)');
    }
    if (value.advert.time === undefined) warn('advert.time', 'no expected time yet — fine: it comes from history once there is history');
  }

  // provider — the app that runs it, inside the definition
  if (!isObj(value.provider)) {
    bad('provider', 'provider is required: { name, repo?, launch?, update? } — the app that runs this service lives INSIDE the definition');
  } else {
    if (!str(value.provider.name)) bad('provider.name', 'provider.name is required — the app (python PIL, ComfyUI, llama.cpp, …)');
    if (value.provider.repo !== undefined && !str(value.provider.repo)) warn('provider.repo', 'provider.repo should be a string when present');
    if (value.provider.update !== undefined && !str(value.provider.update)) warn('provider.update', 'provider.update should be the declared update command (a string)');
  }

  // variables — init · input · files
  if (value.variables !== undefined) {
    if (!isObj(value.variables)) {
      bad('variables', 'variables is an object: { init?, input?, files? }');
    } else {
      for (const kind of ['init', 'input'] as const) {
        const list = value.variables[kind];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          bad(`variables.${kind}`, `variables.${kind} is an array of variables`);
          continue;
        }
        list.forEach((entry, i) => {
          if (!isObj(entry) || !str(entry.name)) bad(`variables.${kind}[${i}]`, 'every variable needs a name');
          else if (entry.type !== undefined && !['text', 'textarea', 'number', 'select', 'boolean', 'range'].includes(String(entry.type))) {
            warn(`variables.${kind}[${i}].type`, `unknown type "${String(entry.type)}" — known: text · textarea · number · select · boolean · range`);
          } else if (entry.role === 'output' && entry.default === undefined) {
            warn(`variables.${kind}[${i}].default`, `${String(entry.name)} is the output path (role: 'output') with no default — the lazy user leaves it empty; give it one (the instance keeps filenames fresh, never the same name twice)`);
          }
        });
      }
      const files = value.variables.files;
      if (files !== undefined) {
        if (!Array.isArray(files)) bad('variables.files', 'variables.files is an array of file slots');
        else files.forEach((slot, i) => {
          if (!isObj(slot) || !str(slot.name)) bad(`variables.files[${i}]`, 'every file slot needs a name (a slot plugs a FILE, or a SERVICE that produces it)');
        });
      }
    }
  }

  // modes — one service, several fits
  if (value.modes !== undefined) {
    if (!Array.isArray(value.modes) || value.modes.length === 0) {
      bad('modes', 'modes is a non-empty array when present — a smaller mode is how a service reaches smaller nodes');
    } else {
      const seen = new Set<string>();
      value.modes.forEach((mode, i) => {
        if (!isObj(mode) || !str(mode.name)) {
          bad(`modes[${i}]`, 'every mode needs a name');
          return;
        }
        const name = String(mode.name);
        if (seen.has(name)) bad(`modes[${i}].name`, `duplicate mode name "${name}"`);
        seen.add(name);
        if (mode.karma !== undefined && !(typeof mode.karma === 'number' && Number.isFinite(mode.karma) && mode.karma >= 0)) bad(`modes[${i}].karma`, 'a mode karma weight is a number >= 0');
        if (mode.fits !== undefined && !isObj(mode.fits)) warn(`modes[${i}].fits`, 'fits should be an object like { vramGbMin: "6", sm: "<=52" }');
        if (mode.models !== undefined && !Array.isArray(mode.models)) bad(`modes[${i}].models`, 'models is an array of LINKS (path/url/sha256/source) — never the files themselves');
        if (mode.install === undefined && value.install === undefined) warn(`modes[${i}].install`, `mode "${name}" declares no install and the service has none — the installer will have to guess`);
        if (isObj(mode.install) && mode.install.pins !== undefined && !isObj(mode.install.pins)) bad(`modes[${i}].install.pins`, 'install.pins is an object of pinned versions, e.g. { python: "3.11", torch: "2.5.1+cu118" }');
      });
    }
  }

  // needs — what the Resource Manager books
  if (value.needs !== undefined) {
    if (!isObj(value.needs)) {
      bad('needs', 'needs is an object: { gpu?, vramGb?, ramMb?, cores?, diskGb?, services? }');
    } else {
      for (const key of ['vramGb', 'ramMb', 'cores', 'diskGb'] as const) {
        const n = value.needs[key];
        if (n !== undefined && !(typeof n === 'number' && Number.isFinite(n) && n >= 0)) bad(`needs.${key}`, `needs.${key} is a non-negative number`);
      }
      if (value.needs.services !== undefined && !Array.isArray(value.needs.services)) bad('needs.services', 'needs.services is an array of child service names');
    }
  }

  // output · children · update
  if (value.output !== undefined && !isObj(value.output)) bad('output', 'output is an object: { kind?, location?, description? }');

  // ---- schema / revision / installer_history: all WARNings. This is malleable software; a gap must never stop a read.
  if (value.schema !== undefined) {
    if (!Number.isInteger(value.schema) || (value.schema as number) < 1) {
      warn('schema', 'schema is a positive integer (the shape of this file, not the service version)');
    } else if ((value.schema as number) > CURRENT_SCHEMA) {
      warn('schema', `schema ${value.schema} is newer than this loader (${CURRENT_SCHEMA}) — reading what it understands; fields it does not know are kept as-is`);
    }
  } else {
    warn('schema', 'no schema — read as v1 (install section absent or unrecognised); migrate in memory, never on disk');
  }
  const rev = value.revision;
  if (rev !== undefined && (!Number.isInteger(rev) || (rev as number) < 1)) {
    warn('revision', 'revision is a positive integer, bumped when the definition changes behaviour');
  }
  const hist = value.installer_history;
  if (hist !== undefined) {
    if (!Array.isArray(hist)) {
      warn('installer_history', 'installer_history is an array of { rev, at, by, note } — append-only');
    } else {
      let lastRev = 0;
      hist.forEach((entry, i) => {
        if (!isObj(entry)) { warn(`installer_history[${i}]`, 'every entry is an object: { rev, at, by, note }'); return; }
        if (!Number.isInteger(entry.rev)) warn(`installer_history[${i}].rev`, 'rev is the revision this entry belongs to');
        else lastRev = Math.max(lastRev, entry.rev as number);
        if (!str(entry.by)) warn(`installer_history[${i}].by`, 'credit the author — who to ask when this turns out wrong');
        if (!str(entry.note)) warn(`installer_history[${i}].note`, 'say what was learned; the note IS the value');
        if (entry.verified === true && !str(entry.evidence)) warn(`installer_history[${i}].evidence`, 'verified:true without evidence — attach the banner, the hash or the run');
        if (str(entry.hardware) && /(\d{1,3}\.){3}\d{1,3}|192\.168\.|127\.0\.0\.1/.test(String(entry.hardware))) {
          warn(`installer_history[${i}].hardware`, 'hardware is a CAPABILITY (card, VRAM, architecture) — an address makes the definition one node and kills portability');
        }
      });
      if (typeof rev === 'number' && lastRev > rev) warn('installer_history', `history reaches rev ${lastRev} but revision is ${rev} — the numbers drifted apart`);
      if (typeof rev === 'number' && rev > 1 && lastRev === 0) warn('revision', `revision ${rev} with no installer_history entry — the next installer learns nothing from this change`);
    }
  } else if (typeof rev === 'number' && rev > 1) {
    warn('installer_history', 'revision moved past 1 with no installer_history — what changed, and who found out?');
  }

  // ---- the install face: steps that can be checked, hints that predict instead of forbidding.
  if (value.install !== undefined) {
    if (!isObj(value.install)) {
      warn('install', 'install is an object: { engine?, requires?, steps?, hints?, exceptions?, evidence? }');
    } else {
      const inst = value.install;
      if (inst.steps !== undefined) {
        if (!Array.isArray(inst.steps)) warn('install.steps', 'install.steps is an array (a string, or { do, verify })');
        else inst.steps.forEach((step, i) => {
          if (typeof step === 'string') {
            warn(`install.steps[${i}]`, 'a step given as bare prose has no mechanical verify — only a human can pass it');
            return;
          }
          if (!isObj(step) || !str(step.do)) { warn(`install.steps[${i}]`, 'a step needs do (how)'); return; }
          if (!str(step.verify)) warn(`install.steps[${i}].verify`, 'no verify: sha256:<hash> · exit0 · version:<s> · health:<path> · file:<path> — without one, "passed" is an opinion');
          if (step.retry !== undefined && !Number.isInteger(step.retry)) warn(`install.steps[${i}].retry`, 'retry is an integer');
        });
      }
      if (inst.hints !== undefined && !Array.isArray(inst.hints)) warn('install.hints', 'install.hints is an array (a sentence, or { when, do, why, reconsider, verified })');
      else if (Array.isArray(inst.hints)) inst.hints.forEach((hint, i) => {
        if (typeof hint === 'string') return;
        if (!isObj(hint) || !str(hint.do)) { warn(`install.hints[${i}]`, 'a hint needs do (what to do instead)'); return; }
        if (str(hint.when) && !str(hint.reconsider)) warn(`install.hints[${i}].reconsider`, 'a conditional rule with no reconsider — say what would make it unnecessary, or it becomes folklore');
        if (hint.verified === true && !str(hint.evidence)) warn(`install.hints[${i}].evidence`, 'verified:true without evidence — attach what proved it');
        if (hint.verified === false && !str(hint.learned)) warn(`install.hints[${i}].learned`, 'unverified hint: say when/where it was noticed, so the next installer knows it is a suspicion');
      });
      if (inst.exceptions !== undefined && !Array.isArray(inst.exceptions)) warn('install.exceptions', 'install.exceptions is an array of { when, do, why, reconsider }');
      else if (Array.isArray(inst.exceptions)) inst.exceptions.forEach((exc, i) => {
        if (!isObj(exc) || !str(exc.when) || !str(exc.do)) warn(`install.exceptions[${i}]`, 'an exception needs when (the case) and do (the way through)');
        else if (!str(exc.reconsider)) warn(`install.exceptions[${i}].reconsider`, 'an exception with no reconsider is a superstition with a date');
      });
      if (inst.evidence !== undefined && !Array.isArray(inst.evidence)) warn('install.evidence', 'install.evidence lists the kinds produced: sha256 · exit0 · version · health · file');
    }
  }
  if (value.children !== undefined && (!Array.isArray(value.children) || value.children.some((c) => !str(c)))) {
    bad('children', 'children is an array of service names (their outputs wire into this service\'s file slots)');
  }
  if (value.update !== undefined && !isObj(value.update)) bad('update', 'update is an object: { command?, note? } — the declared HOW; WHEN is future wisdom');

  // pages — a service PRODUCES two: the ad (the sell sheet) and the inputs (the way in)
  if (!isObj(value.pages)) {
    bad('pages', 'pages is required: { ad, inputs } — the sell sheet and the way in (two pages, one service)');
  } else {
    if (!str(value.pages.ad)) bad('pages.ad', 'pages.ad is required — the sell sheet: what it does, in the maker\'s own voice');
    else if (!String(value.pages.ad).trimStart().startsWith('<')) warn('pages.ad', 'pages.ad does not start with "<" — is it really the html page?');
    if (!str(value.pages.inputs)) bad('pages.inputs', 'pages.inputs is required — the way in: gathers the required inputs (during the run the progress rides on it)');
    else if (!String(value.pages.inputs).trimStart().startsWith('<')) warn('pages.inputs', 'pages.inputs does not start with "<" — is it really the html page?');
  }
  if (value.page !== undefined) warn('page', 'the single page is retired — a service produces TWO now: pages.ad (the sell sheet) + pages.inputs (the way in); move the content and drop page');

  // progress — the declared how-to; the instance tracks and shows
  if (value.progress !== undefined) {
    if (!isObj(value.progress)) {
      bad('progress', 'progress is an object: { how, source?, pattern? }');
    } else {
      if (!str(value.progress.how)) bad('progress.how', 'progress.how is required — in words: how can anyone tell how far along a run is');
      if (value.progress.source !== undefined && !['stdout', 'file', 'http', 'none'].includes(String(value.progress.source))) {
        warn('progress.source', `unknown source "${String(value.progress.source)}" — known: stdout · file · http · none`);
      }
    }
  }

  // gui — the service's own gui, when it has one (a button follows it)
  if (value.gui !== undefined) {
    if (!isObj(value.gui)) {
      bad('gui', 'gui is an object: { kind?, value?, note? }');
    } else if (!str(value.gui.value)) {
      warn('gui.value', 'gui carries no value — how does the button follow it (a url, a path, a command)?');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** The listing shape of one definition — names and counts only, never the page. */
export interface MigrationResult {
  definition: Record<string, unknown>;
  from: number;
  to: number;
  notes: string[];
}

/**
 * Migrate IN MEMORY — a reader never rewrites its input, or every door start looks like a commit.
 * Only honest defaults are filled in: no step is invented, and no verify is made up.
 */
export function migrateService(value: Record<string, unknown>): MigrationResult {
  const raw = value ?? {};
  const from = Number.isInteger(raw.schema) ? Number(raw.schema) : 1;
  const out: Record<string, unknown> = { ...raw };
  const notes: string[] = [];
  if (from < 2) {
    out.schema = 2;
    if (!Number.isInteger(out.revision)) { out.revision = 1; notes.push('v1→v2: revision defaulted to 1'); }
    if (out.installer_history === undefined) {
      out.installer_history = [];
      notes.push('v1→v2: installer_history empty — the install face was absent, so nothing has been learned yet');
    }
    if (out.install === undefined) {
      notes.push('v1→v2: no install block — left absent on purpose; an installer has to discover it, not inherit a guess');
    }
  } else {
    out.schema = from;
    if (!Number.isInteger(out.revision)) { out.revision = 1; notes.push(`schema ${from}: revision defaulted to 1`); }
    if (out.installer_history === undefined) out.installer_history = [];
  }
  return { definition: out, from, to: CURRENT_SCHEMA, notes };
}

export function summarizeService(def: ServiceDefinition, file: string, ok: boolean): ServiceSummary {
  const modes = Array.isArray(def.modes) ? def.modes.filter(isObj).map((m) => String(m.name ?? '')) : [];
  const karmaCandidates = [def.advert?.karma, ...(Array.isArray(def.modes) ? def.modes.map((m) => (isObj(m) ? m.karma : undefined)) : [])];
  const karmas = karmaCandidates.filter((k): k is number => typeof k === 'number' && Number.isFinite(k));
  return {
    name: String(def.name ?? ''),
    what: String(def.advert?.what ?? ''),
    provider: String(def.provider?.name ?? ''),
    modes,
    karma: karmas.length ? Math.max(...karmas) : null,
    output: isObj(def.output) && str(def.output.kind) ? String(def.output.kind) : null,
    children: Array.isArray(def.children) ? def.children.length : 0,
    ok,
    file,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const valid = {
    name: 'resize-image',
    advert: { what: 'Resize an image with python PIL', karma: 1 },
    provider: { name: 'python PIL', launch: 'python resize.py {{input}}', update: 'pip install --upgrade pillow' },
    variables: { init: [{ name: 'py', type: 'text', default: 'python' }], input: [{ name: 'width', type: 'number', required: true }], files: [{ name: 'input', kind: 'image' }] },
    modes: [
      { name: 'cpu', karma: 1, install: { pins: { python: '3.11' }, steps: ['pip install pillow'], note: 'any machine' } },
      { name: 'legacy-gpu', fits: { sm: '<=52' }, install: { pins: { python: '3.11', cuda: '11.8', torch: '2.5.1+cu118' }, note: 'old cards: the wheel dance that still has wheels' } },
    ],
    output: { kind: 'file', location: 'out/' },
    pages: { ad: '<!doctype html><h1>Resize</h1>', inputs: '<!doctype html><form>resize</form>' },
    progress: { how: 'the run prints step N of M', source: 'stdout' },
    gui: { kind: 'url', value: 'http://127.0.0.1:7860' },
  };
  const good = validateService(valid);
  ok('a valid definition passes', good.ok === true && good.errors.length === 0, JSON.stringify(good.errors));
  ok('a valid definition copies no warnings about install (modes carry it)', !good.warnings.some((w) => w.field.endsWith('.install')));

  const noName = validateService({ ...valid, name: '' });
  ok('a missing name is an error', noName.ok === false && noName.errors.some((e) => e.field === 'name'));
  const noPages = validateService({ ...valid, pages: undefined });
  ok('a missing pages is an error', noPages.ok === false && noPages.errors.some((e) => e.field === 'pages'));
  const legacyPage = validateService({ ...valid, page: '<h1>old</h1>' });
  ok('the retired single page warns, does not refuse', legacyPage.ok === true && legacyPage.warnings.some((w) => w.field === 'page'));
  const badProgress = validateService({ ...valid, progress: { source: 'stdout' } });
  ok('progress without how is an error', badProgress.ok === false && badProgress.errors.some((e) => e.field === 'progress.how'));
  const noGuiValue = validateService({ ...valid, gui: { kind: 'url' } });
  ok('gui without a value warns', noGuiValue.ok === true && noGuiValue.warnings.some((w) => w.field === 'gui.value'));
  const lazyOut = validateService({ ...valid, variables: { ...valid.variables, input: [...valid.variables.input, { name: 'save-path', role: 'output' }] } });
  ok('an output path without a default warns (the lazy rule)', lazyOut.ok === true && lazyOut.warnings.some((w) => w.field.includes('default')));
  const noWhat = validateService({ ...valid, advert: { karma: 1 } });
  ok('a missing advert.what is an error', noWhat.ok === false && noWhat.errors.some((e) => e.field === 'advert.what'));
  const junk = validateService('nope');
  ok('a non-object is refused', junk.ok === false && junk.errors[0].field === '$');
  const badModes = validateService({ ...valid, modes: [{ name: 'a' }, { name: 'a' }] });
  ok('duplicate mode names are refused', badModes.ok === false && badModes.errors.some((e) => e.message.includes('duplicate')));
  const noInstall = validateService({ ...valid, install: undefined, modes: [{ name: 'solo' }] });
  ok('a mode with no install and no service install warns', noInstall.ok === true && noInstall.warnings.some((w) => w.field === 'modes[0].install'));
  const noTime = validateService(valid);
  ok('no expected time is a warning (history fills it)', noTime.warnings.some((w) => w.field === 'advert.time'));
  const badKarma = validateService({ ...valid, advert: { what: 'x', karma: -1 } });
  ok('a negative karma weight is an error', badKarma.ok === false && badKarma.errors.some((e) => e.field === 'advert.karma'));

  // v0.1 — the object is liquid: unknown fields pass through untouched
  const extra = validateService({ ...valid, experiment: { someday: ['x'] } });
  ok('unknown fields pass through (nothing frozen)', extra.ok === true);

  const summary = summarizeService(valid as never, 'resize-image.js', true);
  ok('the summary carries names and counts', summary.name === 'resize-image' && summary.provider === 'python PIL' && summary.modes.join(',') === 'cpu,legacy-gpu');
  ok('the summary carries the highest karma weight', summary.karma === 1);
  ok('the summary never carries the pages', !JSON.stringify(summary).includes('doctype'));

  // ---- schema · revision · installer_history · install face (added v2). All gaps warn; nothing refuses.
  const noSchema = validateService(valid as never);
  ok('a v1 file with no schema warns and still loads', noSchema.ok === true && noSchema.warnings.some((w) => w.field === 'schema'));
  const newer = validateService({ ...valid, schema: CURRENT_SCHEMA + 1 } as never);
  ok('a newer schema warns but never refuses', newer.ok === true && newer.warnings.some((w) => w.field === 'schema' && w.message.includes('newer')));
  const bumped = validateService({ ...valid, schema: CURRENT_SCHEMA, revision: 3 } as never);
  ok('a revision bump with no installer_history warns', bumped.ok === true && bumped.warnings.some((w) => w.field === 'installer_history' || w.field === 'revision'));
  const credited = validateService({
    ...valid, schema: CURRENT_SCHEMA, revision: 2,
    installer_history: [{ rev: 2, at: '2026-11-05', by: 'hermes-agent', note: 'cuda works on maxwell' }]
  } as never);
  ok('a bump with a credited entry is clean of revision warnings', credited.ok === true && !credited.warnings.some((w) => w.field.startsWith('install') && w.field.includes('history')));
  const unverified = validateService({
    ...valid, schema: CURRENT_SCHEMA, revision: 2,
    installer_history: [{ rev: 2, at: '2026-11-05', by: 'hermes-agent', note: 'suspected', verified: true }]
  } as never);
  ok('verified:true without evidence warns', unverified.ok === true && unverified.warnings.some((w) => w.field.includes('evidence')));
  const ipInHardware = validateService({
    ...valid, schema: CURRENT_SCHEMA, revision: 2,
    installer_history: [{ rev: 2, at: '2026-11-05', by: 'operator', note: 'x', hardware: '192.168.1.134 GTX 980 Ti' }]
  } as never);
  ok('an address in hardware warns (capability, not identity)', ipInHardware.ok === true && ipInHardware.warnings.some((w) => w.field.includes('hardware')));
  const installFace = validateService({
    ...valid, schema: CURRENT_SCHEMA,
    install: {
      engine: 'audio.cpp',
      steps: [{ id: 'weights', do: 'hf download x -> path', verify: 'sha256:abc' }, { do: 'run it' }],
      hints: [{ when: 'fp16:false', do: 'vulkan', why: 'maxwell' }, { do: 'plain hint' }],
      exceptions: [{ when: 'ps 5.1', do: 'ascii only' }]
    }
  } as never);
  ok('a step without verify warns, the file still loads', installFace.ok === true && installFace.warnings.some((w) => w.field.includes('steps[1].verify')));
  ok('a conditional hint without reconsider warns', installFace.warnings.some((w) => w.field.includes('reconsider')));
  ok('a bare string step warns (only a human can pass it)', validateService({ ...valid, schema: CURRENT_SCHEMA, install: { steps: ['do a thing'] } } as never).warnings.some((w) => w.field.includes('steps[0]')));

  const migrated = migrateService({ name: 'old', advert: { what: 'x' }, provider: { name: 'p' }, pages: { ad: '<p>', inputs: '<p>' } } as never);
  ok('migrate fills schema and revision in memory', migrated.definition.schema === CURRENT_SCHEMA && migrated.definition.revision === 1 && migrated.from === 1);
  ok('migrate is honest about what it did not invent', migrated.notes.some((n) => n.includes('install')));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[serviceSchema] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
