/**
 * @module graph
 * @description The job as a GRAPH, not a list. A step names the service it drives, the steps it waits on
 *              (`needs` = incoming edges), the artifact names it produces, and — for a later step — the
 *              `{{step.key}}` tokens that resolve from a predecessor's real output at run time.
 * @intent A one-service job is the degenerate one-step DAG, so this costs nothing today and avoids the
 *         migration that a flat job record would force the first time a video needs an image and a voice.
 */

// --- Interface Definitions ---

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** One node of the job graph. */
export interface StepSpec {
  /** Unique within the job. Referenced by `needs` and by `{{id.key}}` tokens. */
  id: string;
  /** The service definition this step drives (a name, never a node path). */
  service: string;
  /** Where it must run. Absent = this node. Cross-node execution is not wired yet and is refused by name. */
  node?: string;
  /** The service's declared inputs, possibly carrying `{{step.key}}` tokens. */
  values: Record<string, unknown>;
  /** INCOMING edges: these steps must be done before this one may start. */
  needs: string[];
  /** Artifact NAMES this step produces. Not paths — the path lives in `output`. */
  produces?: string[];
  /** Run-time fact: the real path or value behind each produced name. */
  output?: Record<string, string>;
  state?: StepState;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  ms?: number;
}

export type GraphErrorCode =
  | 'empty_graph'
  | 'bad_step_id'
  | 'duplicate_step'
  | 'unknown_dep'
  | 'cycle'
  | 'bad_needs';

export interface GraphError {
  code: GraphErrorCode;
  message: string;
  refs: string[];
}

export interface GraphCheck {
  ok: boolean;
  errors: GraphError[];
}

// --- Function Definitions ---

const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * Validate the shape and the edges. Every refusal names the offending refs, because "invalid graph"
 * sends the operator hunting while "cycle: s1 -> s2 -> s1" does not.
 */
export function validateGraph(steps: StepSpec[]): GraphCheck {
  const errors: GraphError[] = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: [{ code: 'empty_graph', message: 'a job needs at least one step', refs: [] }] };
  }

  const seen = new Set<string>();
  for (const raw of steps) {
    const id = String(raw?.id ?? '');
    if (!STEP_ID.test(id)) {
      errors.push({ code: 'bad_step_id', message: `step id must look like s1 (letters/digits/._-): "${id}"`, refs: [id] });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ code: 'duplicate_step', message: `two steps share the id "${id}"`, refs: [id] });
    }
    seen.add(id);
    if (raw.needs !== undefined && !Array.isArray(raw.needs)) {
      errors.push({ code: 'bad_needs', message: `step "${id}" needs an array of step ids`, refs: [id] });
    }
  }

  for (const raw of steps) {
    const id = String(raw?.id ?? '');
    for (const dep of (Array.isArray(raw?.needs) ? raw.needs : []) as string[]) {
      if (String(dep) === id) {
        errors.push({ code: 'cycle', message: `step "${id}" depends on itself`, refs: [id] });
        continue;
      }
      if (!seen.has(String(dep))) {
        errors.push({ code: 'unknown_dep', message: `step "${id}" waits on "${dep}", which is not in this job`, refs: [id, String(dep)] });
      }
    }
  }

  // a cycle would deadlock the single-slot queue and look exactly like "nothing is happening"
  const topo = topoOrder(steps);
  if (topo.cycle.length > 0) {
    errors.push({ code: 'cycle', message: `these steps wait on each other: ${topo.cycle.join(' -> ')}`, refs: topo.cycle });
  }

  return { ok: errors.length === 0, errors };
}

/** Kahn's algorithm. `cycle` is the refs that could not be ordered — named, never silently broken. */
export function topoOrder(steps: StepSpec[]): { order: string[]; cycle: string[] } {
  const ids = steps.map((s) => String(s.id));
  const needs = new Map<string, string[]>();
  for (const s of steps) needs.set(String(s.id), (Array.isArray(s.needs) ? s.needs : []).map(String));

  const done = new Set<string>();
  const order: string[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of ids) {
      if (done.has(id)) continue;
      const deps = needs.get(id) ?? [];
      if (deps.every((d) => done.has(d))) {
        done.add(id);
        order.push(id);
        progressed = true;
      }
    }
  }

  const cycle = ids.filter((id) => !done.has(id));
  return { order, cycle };
}

/** The steps that may start now: every dep done, itself still pending. */
export function readySteps(steps: StepSpec[], done: Set<string>): StepSpec[] {
  return steps.filter((s) => {
    if ((s.state ?? 'pending') !== 'pending') return false;
    const deps = (Array.isArray(s.needs) ? s.needs : []).map(String);
    return deps.every((d) => done.has(d));
  });
}

/** `{{s1.image}}` → the value the producing step actually recorded. */
export function resolveValues(
  values: Record<string, unknown>,
  outputs: Record<string, Record<string, string>>,
): { values: Record<string, unknown>; unresolved: string[] } {
  const unresolved: string[] = [];
  const TOKEN = /\{\{\s*([A-Za-z0-9._-]+)\.([A-Za-z0-9._-]+)\s*\}\}/g;

  const sub = (input: unknown): unknown => {
    if (typeof input === 'string') {
      return input.replace(TOKEN, (_m, step: string, key: string) => {
        const hit = outputs[step]?.[key];
        if (typeof hit === 'string') return hit;
        unresolved.push(`{{${step}.${key}}}`);
        return `{{${step}.${key}}}`;
      });
    }
    if (Array.isArray(input)) return input.map(sub);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = sub(v);
      return out;
    }
    return input;
  };

  return { values: sub(values) as Record<string, unknown>, unresolved };
}

/** The flat shape the door stored before graphs existed, lifted into the degenerate one-step DAG. */
export function fromLegacyJob(job: { id: string; service: string; inputs?: Record<string, unknown> }): StepSpec[] {
  return [
    {
      id: 's1',
      service: String(job.service),
      values: { ...(job.inputs ?? {}) },
      needs: [],
      state: 'pending',
    },
  ];
}
