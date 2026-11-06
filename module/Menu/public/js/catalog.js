const TASK_LOOKS = {
  "text-generation": { label: "LLM", emoji: "\u{1F999}" },
  "image-text-to-text": { label: "LLM", emoji: "\u{1F999}" },
  "text-to-image": { label: "Image", emoji: "\u{1F5BC}\uFE0F" },
  "image-to-video": { label: "Video", emoji: "\u{1F3AC}" },
  "text-to-video": { label: "Video", emoji: "\u{1F3AC}" },
  "text-to-audio": { label: "Music", emoji: "\u{1F3B5}" },
  "text-to-speech": { label: "Speech", emoji: "\u{1F5E3}\uFE0F" },
  "image-segmentation": { label: "Mask", emoji: "\u2702\uFE0F" }
};
function lookFor(task) {
  const hit = TASK_LOOKS[task];
  if (hit) return hit;
  if (!task) return { label: "Service", emoji: "\u{1F4E6}" };
  const words = task.split(/[-_]/).filter(Boolean);
  return { label: words.length ? words[words.length - 1].replace(/^./, (c) => c.toUpperCase()) : task, emoji: "\u{1F4E6}" };
}
function asString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function asFields(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const f = item;
    const name = asString(f.name);
    if (!name) continue;
    out.push({
      name,
      label: asString(f.label, name),
      type: asString(f.type, "text"),
      default: f.default ?? null,
      options: Array.isArray(f.options) ? f.options.map((o) => String(o)) : [],
      help: asString(f.help) || null,
      full: f.full === true
    });
  }
  return out;
}
function asModels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const m = item;
    const family = asString(m.family) || asString(m.id);
    if (!family) continue;
    const bytes = typeof m.bytes === "number" ? m.bytes : Number.parseInt(String(m.bytes ?? ""), 10);
    out.push({
      file: asString(m.file) || null,
      family,
      quant: asString(m.quant) || null,
      bytes: Number.isFinite(bytes) ? bytes : 0,
      vramGb: typeof m.vramGb === "number" ? m.vramGb : null,
      role: asString(m.role) || null,
      sha256: asString(m.sha256) || null,
      note: asString(m.note) || null,
      inputs: m.inputs && typeof m.inputs === "object" ? m.inputs : null
    });
  }
  return out;
}
async function fetchRows(options) {
  const base = options.servicesUrl.replace(/\/+$/, "");
  const timeout = options.timeoutMs ?? 4e3;
  const get = async (p) => {
    const res = await fetch(base + p, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${p} answered ${res.status}`);
    return res.json();
  };
  let listing;
  try {
    listing = await get("/api/services");
  } catch (e) {
    return { rows: [], error: `the Services door is not answering at ${base} (${e instanceof Error ? e.message : String(e)})` };
  }
  const rows = [];
  for (const summary of listing.services ?? []) {
    const name = asString(summary.name);
    if (!name) continue;
    if (summary.ok === false) {
      rows.push({
        name,
        label: "Refused",
        emoji: "\u26D4",
        task: "",
        what: asString(summary.what, "the catalog refused this file"),
        provider: asString(summary.provider),
        karma: null,
        modes: [],
        fields: [],
        models: [],
        needs: null,
        whenItDoesNotFit: null,
        ok: false,
        errors: []
      });
      continue;
    }
    let def = {};
    try {
      const one = await get(`/api/services/${encodeURIComponent(name)}`);
      def = one.service ?? {};
    } catch {
    }
    const task = asString(def.task, asString(def.tasks?.[0]));
    const look = lookFor(task);
    const advert = def.advert ?? {};
    const variables = def.variables ?? {};
    rows.push({
      name,
      label: look.label,
      emoji: look.emoji,
      task,
      what: asString(advert.what, asString(summary.what)),
      provider: asString(def.provider?.name, asString(summary.provider)),
      karma: typeof advert.karma === "number" ? advert.karma : summary.karma ?? null,
      modes: Array.isArray(summary.modes) ? summary.modes.map(String) : [],
      fields: asFields(variables.input),
      models: asModels(def.models),
      needs: def.needs && typeof def.needs === "object" ? def.needs : null,
      whenItDoesNotFit: asString(def.whenItDoesNotFit) || null,
      ok: true,
      errors: []
    });
  }
  rows.sort((a, b) => Number(b.ok) - Number(a.ok) || a.name.localeCompare(b.name));
  return { rows: options.onlyServable ? rows.filter((r) => r.ok) : rows, error: null };
}
async function fetchRow(options, name) {
  const { rows } = await fetchRows(options);
  return rows.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null;
}
export {
  fetchRow,
  fetchRows,
  lookFor
};
//# sourceMappingURL=catalog.js.map
