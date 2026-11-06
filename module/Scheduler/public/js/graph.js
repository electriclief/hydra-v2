const STEP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
function validateGraph(steps) {
  const errors = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, errors: [{ code: "empty_graph", message: "a job needs at least one step", refs: [] }] };
  }
  const seen = /* @__PURE__ */ new Set();
  for (const raw of steps) {
    const id = String(raw?.id ?? "");
    if (!STEP_ID.test(id)) {
      errors.push({ code: "bad_step_id", message: `step id must look like s1 (letters/digits/._-): "${id}"`, refs: [id] });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ code: "duplicate_step", message: `two steps share the id "${id}"`, refs: [id] });
    }
    seen.add(id);
    if (raw.needs !== void 0 && !Array.isArray(raw.needs)) {
      errors.push({ code: "bad_needs", message: `step "${id}" needs an array of step ids`, refs: [id] });
    }
  }
  for (const raw of steps) {
    const id = String(raw?.id ?? "");
    for (const dep of Array.isArray(raw?.needs) ? raw.needs : []) {
      if (String(dep) === id) {
        errors.push({ code: "cycle", message: `step "${id}" depends on itself`, refs: [id] });
        continue;
      }
      if (!seen.has(String(dep))) {
        errors.push({ code: "unknown_dep", message: `step "${id}" waits on "${dep}", which is not in this job`, refs: [id, String(dep)] });
      }
    }
  }
  const topo = topoOrder(steps);
  if (topo.cycle.length > 0) {
    errors.push({ code: "cycle", message: `these steps wait on each other: ${topo.cycle.join(" -> ")}`, refs: topo.cycle });
  }
  return { ok: errors.length === 0, errors };
}
function topoOrder(steps) {
  const ids = steps.map((s) => String(s.id));
  const needs = /* @__PURE__ */ new Map();
  for (const s of steps) needs.set(String(s.id), (Array.isArray(s.needs) ? s.needs : []).map(String));
  const done = /* @__PURE__ */ new Set();
  const order = [];
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
function readySteps(steps, done) {
  return steps.filter((s) => {
    if ((s.state ?? "pending") !== "pending") return false;
    const deps = (Array.isArray(s.needs) ? s.needs : []).map(String);
    return deps.every((d) => done.has(d));
  });
}
function resolveValues(values, outputs) {
  const unresolved = [];
  const TOKEN = /\{\{\s*([A-Za-z0-9._-]+)\.([A-Za-z0-9._-]+)\s*\}\}/g;
  const sub = (input) => {
    if (typeof input === "string") {
      return input.replace(TOKEN, (_m, step, key) => {
        const hit = outputs[step]?.[key];
        if (typeof hit === "string") return hit;
        unresolved.push(`{{${step}.${key}}}`);
        return `{{${step}.${key}}}`;
      });
    }
    if (Array.isArray(input)) return input.map(sub);
    if (input && typeof input === "object") {
      const out = {};
      for (const [k, v] of Object.entries(input)) out[k] = sub(v);
      return out;
    }
    return input;
  };
  return { values: sub(values), unresolved };
}
function fromLegacyJob(job) {
  return [
    {
      id: "s1",
      service: String(job.service),
      values: { ...job.inputs ?? {} },
      needs: [],
      state: "pending"
    }
  ];
}
export {
  fromLegacyJob,
  readySteps,
  resolveValues,
  topoOrder,
  validateGraph
};
//# sourceMappingURL=graph.js.map
