/**
 * baseline.js - the word "unusual" as a measurement instead of an adjective.
 *
 * The operator's rule (2026-11-15): the Resource Manager "should alert if unusual cpu/gpu/disk activity occurs - have
 * Echidna either find the problem, or re-define unusual".
 *
 * So "unusual" is never a constant. It is a band learned from this node's own quiet history, and it can be redefined:
 *   record(sample)  - fold a measurement into the running statistics (Welford: mean and variance in one pass, no history
 *                     file of every sample)
 *   evaluate(sample)- compare a measurement with the learned band; a finding carries the numbers, the band and a z-score
 *                     so a reader can see how far outside it is, not just that it is outside
 *   redefine(...)   - widen, narrow or reset a band. This is the door Echidna uses when the machine has legitimately
 *                     changed (a render farm came online) and the old band is the thing that is wrong.
 *
 * Nothing is ever "unusual" before the baseline has enough samples: a young baseline says `learning`, which is honest,
 * where a guessed band would page on the first busy minute.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Which measurements have a band, and the shape of each one. `dir` is the side where a breach is bad. */
export const METRICS = {
  cpuLoadPct:  { label: 'CPU load %',        dir: 'high', floor: 0,  ceil: 100, k: 3.0, absMin: 70 },
  gpuUtilPct:  { label: 'GPU utilisation %', dir: 'high', floor: 0,  ceil: 100, k: 3.0, absMin: 90 },
  gpuTempC:    { label: 'GPU temperature C', dir: 'high', floor: 0,  ceil: 110, k: 3.0, absMin: 88 },
  diskBusyPct: { label: 'Disk busy %',       dir: 'high', floor: 0,  ceil: 100, k: 3.5, absMin: 80 },
  memFreePct:  { label: 'Free memory %',     dir: 'low',  floor: 0,  ceil: 100, k: 3.0, absMax: 8 },
  // counts move by one when a tab closes; only a real jump is worth a person's attention
  procCount:   { label: 'Process count',     dir: 'both', floor: 0,  ceil: 100000, k: 3.5, absDelta: 8 },
  listenCount: { label: 'Listening ports',   dir: 'both', floor: 0,  ceil: 10000, k: 4.0, absDelta: 5 },
};
const MIN_SAMPLES = 24;          // ~12 minutes at a 30 s pass: long enough not to page on a single busy minute
const MAX_SAMPLES = 20000;       // after this, older weight decays: the baseline follows the machine
const SMOOTH = 0.02;             // per-sample weight once the baseline is mature (an EWMA over ~50 passes)

function welford(state, value) {
  const n = state.n + 1;
  const delta = value - state.mean;
  const mean = state.mean + delta / n;
  const m2 = state.m2 + delta * (value - mean);
  return { n, mean, m2 };
}

function bandOf(state, spec) {
  const sd = state.n > 1 ? Math.sqrt(state.m2 / (state.n - 1)) : 0;
  // a tight baseline must not become an alarm: the band is at least k standard deviations wide AND at least one unit,
  // so a machine that idles at exactly 3 % does not "breach" at 4 %.
  const spread = Math.min(Math.max(1, sd * spec.k), (state.mean * 0.35) + 10);
  const low = Math.max(spec.floor, state.mean - spread);
  const high = Math.min(spec.ceil, state.mean + spread);
  return { low: round(low), high: round(high), mean: round(state.mean), sd: round(sd) };
}

/** A breach has to be BOTH outside the learned band and worth a person's attention (absMin / absMax). */
function worthAttention(spec, value, direction, mean = null) {
  if (direction === 'above' && Number.isFinite(spec.absMin) && value < spec.absMin) return false;
  if (direction === 'below' && Number.isFinite(spec.absMax) && value > spec.absMax) return false;
  // a count that wobbles by a couple is not an incident even when the standard deviation is tiny
  if (Number.isFinite(spec.absDelta) && Number.isFinite(mean) && Math.abs(value - mean) < spec.absDelta) return false;
  return true;
}

const round = (n) => Math.round(n * 10) / 10;

/** The measurements one inventory sample contributes, flattened to scalar metrics. */
export function metricsOf(inv) {
  const out = {};
  if (!inv) return out;
  if (Number.isFinite(inv.cpu?.loadPct)) out.cpuLoadPct = inv.cpu.loadPct;
  if (Number.isFinite(inv.mem?.totalMb) && Number.isFinite(inv.mem?.freeMb) && inv.mem.totalMb > 0) {
    out.memFreePct = round((inv.mem.freeMb / inv.mem.totalMb) * 100);
  }
  if (Array.isArray(inv.gpus) && inv.gpus.length) {
    const util = inv.gpus.map((g) => g.utilPct).filter(Number.isFinite);
    const temp = inv.gpus.map((g) => g.tempC).filter(Number.isFinite);
    if (util.length) out.gpuUtilPct = Math.max(...util);
    if (temp.length) out.gpuTempC = Math.max(...temp);
  }
  if (Array.isArray(inv.diskIo) && inv.diskIo.length) {
    const busy = inv.diskIo.map((d) => d.busyPct).filter(Number.isFinite);
    if (busy.length) out.diskBusyPct = Math.max(...busy);
  }
  if (Number.isFinite(inv.filteredCount)) out.procCount = inv.filteredCount;
  if (Number.isFinite(inv.listenCount)) out.listenCount = inv.listenCount;
  return out;
}

export function createBaseline({ file, ref = null, quiet = false } = {}) {
  const dataFile = file ?? 'baseline.json';
  let doc = { version: 1, ref, createdAt: new Date().toISOString(), metrics: {}, overrides: {}, lastFindings: [], lastEvalAt: null };
  try {
    if (fs.existsSync(dataFile)) doc = { ...doc, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) };
  } catch { /* a corrupt baseline is a new baseline, and it says so by being young */ }

  let dirty = false;
  const save = () => {
    if (!dirty) return;
    try {
      fs.mkdirSync(path.dirname(path.resolve(dataFile)), { recursive: true });
      fs.writeFileSync(dataFile, JSON.stringify(doc, null, 1));
      dirty = false;
    } catch (error) {
      if (!quiet) console.log(`  baseline save failed: ${error.message}`);
    }
  };
  const timer = setInterval(save, 15000);
  if (timer.unref) timer.unref();

  /**
   * Fold one sample into every metric's statistics. `skipUnusual` is how an anomaly is prevented from teaching the
   * baseline that the anomaly is normal: main.js evaluates the sample first and, when it is a finding, does not fold it.
   * Accepting the new level is then an explicit act (redefine/accept), which is exactly the operator's rule.
   */
  function record(sample, { skipUnusual = false } = {}) {
    if (skipUnusual) return metricsOf(sample);
    const values = metricsOf(sample);
    for (const [name, value] of Object.entries(values)) {
      const spec = METRICS[name];
      if (!spec || !Number.isFinite(value)) continue;
      const m = doc.metrics[name] ?? { n: 0, mean: 0, m2: 0, updatedAt: null };
      let next = welford(m, value);
      // once the baseline is mature, a slow weight keeps it following the machine instead of freezing on week one
      if (next.n > MAX_SAMPLES) next = { n: m.n, mean: m.mean + SMOOTH * (value - m.mean), m2: m.m2 * (1 - SMOOTH) };
      doc.metrics[name] = { ...next, updatedAt: new Date().toISOString() };
      dirty = true;
    }
    return values;
  }

  /** Is this sample outside the learned band? Returns findings with the numbers, never a bare boolean. */
  function evaluate(sample) {
    const values = metricsOf(sample);
    const findings = [];
    let youngest = Infinity;
    for (const [name, value] of Object.entries(values)) {
      const spec = METRICS[name];
      const m = doc.metrics[name];
      if (!spec || !m) continue;
      youngest = Math.min(youngest, m.n);
      if (m.n < MIN_SAMPLES) continue;                  // still learning: no claim is made
      const override = doc.overrides[name];
      const band = override ?? bandOf(m, spec);
      let bad = false;
      if (spec.dir === 'high' || spec.dir === 'both') bad = bad || value > band.high;
      if (spec.dir === 'low' || spec.dir === 'both') bad = bad || value < band.low;
      if (!bad) continue;
      const direction = value > band.high ? 'above' : 'below';
      if (!worthAttention(spec, value, direction, band.mean)) continue;
      const spread = Math.max(0.5, (band.high - band.mean) || 0.5);
      findings.push({
        metric: name, label: spec.label, value, direction,
        band, samples: m.n, z: round((value - band.mean) / spread),
        overridden: Boolean(override),
      });
    }
    doc.lastEvalAt = new Date().toISOString();
    doc.lastFindings = findings;
    dirty = true;
    const learning = youngest !== Infinity && youngest < MIN_SAMPLES;
    return { at: doc.lastEvalAt, unusual: findings.length > 0, learning, youngestSamples: Number.isFinite(youngest) ? youngest : null,
             findings, metrics: Object.keys(doc.metrics) };
  }

  /** The door Echidna uses: accept the machine as it is now, for one metric or for all of them. */
  function redefine({ metric = null, low = null, high = null, accept = false } = {}) {
    if (accept) {
      // "this level is normal now": the accepted band must COVER what was just observed, not merely recompute the old
      // band from history - otherwise accepting a live anomaly would leave the same anomaly flagged on the next pass.
      const names = metric ? [metric] : (doc.lastFindings ?? []).map((f) => f.metric).filter(Boolean);
      const targets = names.length ? names : Object.keys(doc.metrics);
      const applied = [];
      for (const name of targets) {
        const spec = METRICS[name];
        const m = doc.metrics[name];
        if (!spec || !m) continue;
        const finding = (doc.lastFindings ?? []).find((f) => f.metric === name);
        const base = doc.overrides[name] ?? bandOf(m, spec);
        let low = base.low, high = base.high;
        if (finding) {
          const observed = Number(finding.value);
          high = Math.max(high, round(observed * 1.1));
          low = Math.min(low, round(observed * 0.9));
        }
        doc.overrides[name] = { low, high, mean: base.mean ?? round(m.mean), acceptedAt: new Date().toISOString(),
                                acceptedFrom: finding ? { value: finding.value, direction: finding.direction } : null };
        applied.push(name);
      }
      dirty = true;
      save();
      return { ok: true, accepted: applied };
    }
    if (!metric || !METRICS[metric]) return { ok: false, error: 'metric must be one of ' + Object.keys(METRICS).join(', ') };
    if (low === null && high === null) { delete doc.overrides[metric]; dirty = true; save(); return { ok: true, cleared: metric }; }
    doc.overrides[metric] = { low: low ?? null, high: high ?? null, setAt: new Date().toISOString(), setBy: 'operator-or-echidna' };
    dirty = true;
    save();
    return { ok: true, override: doc.overrides[metric] };
  }

  /** Widen/narrow from a fresh measurement: the "this is normal now" door without touching the numbers by hand. */
  function summarize() {
    const metrics = {};
    for (const [name, spec] of Object.entries(METRICS)) {
      const m = doc.metrics[name];
      if (!m) continue;
      metrics[name] = { label: spec.label, samples: m.n, mean: round(m.mean),
                        band: doc.overrides[name] ?? bandOf(m, spec), overridden: Boolean(doc.overrides[name]),
                        updatedAt: m.updatedAt, mature: m.n >= MIN_SAMPLES };
    }
    return { at: new Date().toISOString(), ref: doc.ref, minSamples: MIN_SAMPLES, metrics,
             unusual: (doc.lastFindings ?? []).length > 0, findings: doc.lastFindings ?? [] };
  }

  return { record, evaluate, redefine, summarize, reset() {
    doc = { version: 1, ref, createdAt: new Date().toISOString(), metrics: {}, overrides: {}, lastFindings: [], lastEvalAt: null };
    dirty = true; save();
    return { ok: true, reset: true };
  }, stop() { save(); clearInterval(timer); } };
}
