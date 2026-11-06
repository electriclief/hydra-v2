const CURRENT_SCHEMA = 2;
function isObj(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function validateService(value) {
  const errors = [];
  const warnings = [];
  const bad = (field, message) => errors.push({ level: "error", field, message });
  const warn = (field, message) => warnings.push({ level: "warning", field, message });
  if (!isObj(value)) {
    bad("$", "a service definition is an object");
    return { ok: false, errors, warnings };
  }
  if (!str(value.name)) bad("name", "name is required (a non-empty string, unique in the catalog)");
  if (value.version !== void 0 && !str(value.version)) warn("version", "version should be a string when present");
  if (!isObj(value.advert)) {
    bad("advert", "advert is required: { what, time?, karma? }");
  } else {
    if (!str(value.advert.what)) bad("advert.what", "advert.what is required \u2014 one line: what does this service do");
    if (value.advert.time !== void 0 && typeof value.advert.time !== "string") bad("advert.time", "advert.time is a string (it comes from HISTORY \u2014 average or last runs; unknown is unknown)");
    if (value.advert.karma !== void 0 && !(typeof value.advert.karma === "number" && Number.isFinite(value.advert.karma) && value.advert.karma >= 0)) {
      bad("advert.karma", "advert.karma is a number >= 0 (relative weight; free at zero, its effect is priority)");
    }
    if (value.advert.time === void 0) warn("advert.time", "no expected time yet \u2014 fine: it comes from history once there is history");
  }
  if (!isObj(value.provider)) {
    bad("provider", "provider is required: { name, repo?, launch?, update? } \u2014 the app that runs this service lives INSIDE the definition");
  } else {
    if (!str(value.provider.name)) bad("provider.name", "provider.name is required \u2014 the app (python PIL, ComfyUI, llama.cpp, \u2026)");
    if (value.provider.repo !== void 0 && !str(value.provider.repo)) warn("provider.repo", "provider.repo should be a string when present");
    if (value.provider.update !== void 0 && !str(value.provider.update)) warn("provider.update", "provider.update should be the declared update command (a string)");
  }
  if (value.variables !== void 0) {
    if (!isObj(value.variables)) {
      bad("variables", "variables is an object: { init?, input?, files? }");
    } else {
      for (const kind of ["init", "input"]) {
        const list = value.variables[kind];
        if (list === void 0) continue;
        if (!Array.isArray(list)) {
          bad(`variables.${kind}`, `variables.${kind} is an array of variables`);
          continue;
        }
        list.forEach((entry, i) => {
          if (!isObj(entry) || !str(entry.name)) bad(`variables.${kind}[${i}]`, "every variable needs a name");
          else if (entry.type !== void 0 && !["text", "textarea", "number", "select", "boolean", "range"].includes(String(entry.type))) {
            warn(`variables.${kind}[${i}].type`, `unknown type "${String(entry.type)}" \u2014 known: text \xB7 textarea \xB7 number \xB7 select \xB7 boolean \xB7 range`);
          } else if (entry.role === "output" && entry.default === void 0) {
            warn(`variables.${kind}[${i}].default`, `${String(entry.name)} is the output path (role: 'output') with no default \u2014 the lazy user leaves it empty; give it one (the instance keeps filenames fresh, never the same name twice)`);
          }
        });
      }
      const files = value.variables.files;
      if (files !== void 0) {
        if (!Array.isArray(files)) bad("variables.files", "variables.files is an array of file slots");
        else files.forEach((slot, i) => {
          if (!isObj(slot) || !str(slot.name)) bad(`variables.files[${i}]`, "every file slot needs a name (a slot plugs a FILE, or a SERVICE that produces it)");
        });
      }
    }
  }
  if (value.modes !== void 0) {
    if (!Array.isArray(value.modes) || value.modes.length === 0) {
      bad("modes", "modes is a non-empty array when present \u2014 a smaller mode is how a service reaches smaller nodes");
    } else {
      const seen = /* @__PURE__ */ new Set();
      value.modes.forEach((mode, i) => {
        if (!isObj(mode) || !str(mode.name)) {
          bad(`modes[${i}]`, "every mode needs a name");
          return;
        }
        const name = String(mode.name);
        if (seen.has(name)) bad(`modes[${i}].name`, `duplicate mode name "${name}"`);
        seen.add(name);
        if (mode.karma !== void 0 && !(typeof mode.karma === "number" && Number.isFinite(mode.karma) && mode.karma >= 0)) bad(`modes[${i}].karma`, "a mode karma weight is a number >= 0");
        if (mode.fits !== void 0 && !isObj(mode.fits)) warn(`modes[${i}].fits`, 'fits should be an object like { vramGbMin: "6", sm: "<=52" }');
        if (mode.models !== void 0 && !Array.isArray(mode.models)) bad(`modes[${i}].models`, "models is an array of LINKS (path/url/sha256/source) \u2014 never the files themselves");
        if (mode.install === void 0 && value.install === void 0) warn(`modes[${i}].install`, `mode "${name}" declares no install and the service has none \u2014 the installer will have to guess`);
        if (isObj(mode.install) && mode.install.pins !== void 0 && !isObj(mode.install.pins)) bad(`modes[${i}].install.pins`, 'install.pins is an object of pinned versions, e.g. { python: "3.11", torch: "2.5.1+cu118" }');
      });
    }
  }
  if (value.needs !== void 0) {
    if (!isObj(value.needs)) {
      bad("needs", "needs is an object: { gpu?, vramGb?, ramMb?, cores?, diskGb?, services? }");
    } else {
      for (const key of ["vramGb", "ramMb", "cores", "diskGb"]) {
        const n = value.needs[key];
        if (n !== void 0 && !(typeof n === "number" && Number.isFinite(n) && n >= 0)) bad(`needs.${key}`, `needs.${key} is a non-negative number`);
      }
      if (value.needs.services !== void 0 && !Array.isArray(value.needs.services)) bad("needs.services", "needs.services is an array of child service names");
    }
  }
  if (value.output !== void 0 && !isObj(value.output)) bad("output", "output is an object: { kind?, location?, description? }");
  if (value.schema !== void 0) {
    if (!Number.isInteger(value.schema) || value.schema < 1) {
      warn("schema", "schema is a positive integer (the shape of this file, not the service version)");
    } else if (value.schema > CURRENT_SCHEMA) {
      warn("schema", `schema ${value.schema} is newer than this loader (${CURRENT_SCHEMA}) \u2014 reading what it understands; fields it does not know are kept as-is`);
    }
  } else {
    warn("schema", "no schema \u2014 read as v1 (install section absent or unrecognised); migrate in memory, never on disk");
  }
  const rev = value.revision;
  if (rev !== void 0 && (!Number.isInteger(rev) || rev < 1)) {
    warn("revision", "revision is a positive integer, bumped when the definition changes behaviour");
  }
  const hist = value.installer_history;
  if (hist !== void 0) {
    if (!Array.isArray(hist)) {
      warn("installer_history", "installer_history is an array of { rev, at, by, note } \u2014 append-only");
    } else {
      let lastRev = 0;
      hist.forEach((entry, i) => {
        if (!isObj(entry)) {
          warn(`installer_history[${i}]`, "every entry is an object: { rev, at, by, note }");
          return;
        }
        if (!Number.isInteger(entry.rev)) warn(`installer_history[${i}].rev`, "rev is the revision this entry belongs to");
        else lastRev = Math.max(lastRev, entry.rev);
        if (!str(entry.by)) warn(`installer_history[${i}].by`, "credit the author \u2014 who to ask when this turns out wrong");
        if (!str(entry.note)) warn(`installer_history[${i}].note`, "say what was learned; the note IS the value");
        if (entry.verified === true && !str(entry.evidence)) warn(`installer_history[${i}].evidence`, "verified:true without evidence \u2014 attach the banner, the hash or the run");
        if (str(entry.hardware) && /(\d{1,3}\.){3}\d{1,3}|192\.168\.|127\.0\.0\.1/.test(String(entry.hardware))) {
          warn(`installer_history[${i}].hardware`, "hardware is a CAPABILITY (card, VRAM, architecture) \u2014 an address makes the definition one node and kills portability");
        }
      });
      if (typeof rev === "number" && lastRev > rev) warn("installer_history", `history reaches rev ${lastRev} but revision is ${rev} \u2014 the numbers drifted apart`);
      if (typeof rev === "number" && rev > 1 && lastRev === 0) warn("revision", `revision ${rev} with no installer_history entry \u2014 the next installer learns nothing from this change`);
    }
  } else if (typeof rev === "number" && rev > 1) {
    warn("installer_history", "revision moved past 1 with no installer_history \u2014 what changed, and who found out?");
  }
  if (value.install !== void 0) {
    if (!isObj(value.install)) {
      warn("install", "install is an object: { engine?, requires?, steps?, hints?, exceptions?, evidence? }");
    } else {
      const inst = value.install;
      if (inst.steps !== void 0) {
        if (!Array.isArray(inst.steps)) warn("install.steps", "install.steps is an array (a string, or { do, verify })");
        else inst.steps.forEach((step, i) => {
          if (typeof step === "string") {
            warn(`install.steps[${i}]`, "a step given as bare prose has no mechanical verify \u2014 only a human can pass it");
            return;
          }
          if (!isObj(step) || !str(step.do)) {
            warn(`install.steps[${i}]`, "a step needs do (how)");
            return;
          }
          if (!str(step.verify)) warn(`install.steps[${i}].verify`, 'no verify: sha256:<hash> \xB7 exit0 \xB7 version:<s> \xB7 health:<path> \xB7 file:<path> \u2014 without one, "passed" is an opinion');
          if (step.retry !== void 0 && !Number.isInteger(step.retry)) warn(`install.steps[${i}].retry`, "retry is an integer");
        });
      }
      if (inst.hints !== void 0 && !Array.isArray(inst.hints)) warn("install.hints", "install.hints is an array (a sentence, or { when, do, why, reconsider, verified })");
      else if (Array.isArray(inst.hints)) inst.hints.forEach((hint, i) => {
        if (typeof hint === "string") return;
        if (!isObj(hint) || !str(hint.do)) {
          warn(`install.hints[${i}]`, "a hint needs do (what to do instead)");
          return;
        }
        if (str(hint.when) && !str(hint.reconsider)) warn(`install.hints[${i}].reconsider`, "a conditional rule with no reconsider \u2014 say what would make it unnecessary, or it becomes folklore");
        if (hint.verified === true && !str(hint.evidence)) warn(`install.hints[${i}].evidence`, "verified:true without evidence \u2014 attach what proved it");
        if (hint.verified === false && !str(hint.learned)) warn(`install.hints[${i}].learned`, "unverified hint: say when/where it was noticed, so the next installer knows it is a suspicion");
      });
      if (inst.exceptions !== void 0 && !Array.isArray(inst.exceptions)) warn("install.exceptions", "install.exceptions is an array of { when, do, why, reconsider }");
      else if (Array.isArray(inst.exceptions)) inst.exceptions.forEach((exc, i) => {
        if (!isObj(exc) || !str(exc.when) || !str(exc.do)) warn(`install.exceptions[${i}]`, "an exception needs when (the case) and do (the way through)");
        else if (!str(exc.reconsider)) warn(`install.exceptions[${i}].reconsider`, "an exception with no reconsider is a superstition with a date");
      });
      if (inst.evidence !== void 0 && !Array.isArray(inst.evidence)) warn("install.evidence", "install.evidence lists the kinds produced: sha256 \xB7 exit0 \xB7 version \xB7 health \xB7 file");
    }
  }
  if (value.children !== void 0 && (!Array.isArray(value.children) || value.children.some((c) => !str(c)))) {
    bad("children", "children is an array of service names (their outputs wire into this service's file slots)");
  }
  if (value.update !== void 0 && !isObj(value.update)) bad("update", "update is an object: { command?, note? } \u2014 the declared HOW; WHEN is future wisdom");
  if (!isObj(value.pages)) {
    bad("pages", "pages is required: { ad, inputs } \u2014 the sell sheet and the way in (two pages, one service)");
  } else {
    if (!str(value.pages.ad)) bad("pages.ad", "pages.ad is required \u2014 the sell sheet: what it does, in the maker's own voice");
    else if (!String(value.pages.ad).trimStart().startsWith("<")) warn("pages.ad", 'pages.ad does not start with "<" \u2014 is it really the html page?');
    if (!str(value.pages.inputs)) bad("pages.inputs", "pages.inputs is required \u2014 the way in: gathers the required inputs (during the run the progress rides on it)");
    else if (!String(value.pages.inputs).trimStart().startsWith("<")) warn("pages.inputs", 'pages.inputs does not start with "<" \u2014 is it really the html page?');
  }
  if (value.page !== void 0) warn("page", "the single page is retired \u2014 a service produces TWO now: pages.ad (the sell sheet) + pages.inputs (the way in); move the content and drop page");
  if (value.progress !== void 0) {
    if (!isObj(value.progress)) {
      bad("progress", "progress is an object: { how, source?, pattern? }");
    } else {
      if (!str(value.progress.how)) bad("progress.how", "progress.how is required \u2014 in words: how can anyone tell how far along a run is");
      if (value.progress.source !== void 0 && !["stdout", "file", "http", "none"].includes(String(value.progress.source))) {
        warn("progress.source", `unknown source "${String(value.progress.source)}" \u2014 known: stdout \xB7 file \xB7 http \xB7 none`);
      }
    }
  }
  if (value.gui !== void 0) {
    if (!isObj(value.gui)) {
      bad("gui", "gui is an object: { kind?, value?, note? }");
    } else if (!str(value.gui.value)) {
      warn("gui.value", "gui carries no value \u2014 how does the button follow it (a url, a path, a command)?");
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function migrateService(value) {
  const raw = value ?? {};
  const from = Number.isInteger(raw.schema) ? Number(raw.schema) : 1;
  const out = { ...raw };
  const notes = [];
  if (from < 2) {
    out.schema = 2;
    if (!Number.isInteger(out.revision)) {
      out.revision = 1;
      notes.push("v1\u2192v2: revision defaulted to 1");
    }
    if (out.installer_history === void 0) {
      out.installer_history = [];
      notes.push("v1\u2192v2: installer_history empty \u2014 the install face was absent, so nothing has been learned yet");
    }
    if (out.install === void 0) {
      notes.push("v1\u2192v2: no install block \u2014 left absent on purpose; an installer has to discover it, not inherit a guess");
    }
  } else {
    out.schema = from;
    if (!Number.isInteger(out.revision)) {
      out.revision = 1;
      notes.push(`schema ${from}: revision defaulted to 1`);
    }
    if (out.installer_history === void 0) out.installer_history = [];
  }
  return { definition: out, from, to: CURRENT_SCHEMA, notes };
}
function summarizeService(def, file, ok) {
  const modes = Array.isArray(def.modes) ? def.modes.filter(isObj).map((m) => String(m.name ?? "")) : [];
  const karmaCandidates = [def.advert?.karma, ...Array.isArray(def.modes) ? def.modes.map((m) => isObj(m) ? m.karma : void 0) : []];
  const karmas = karmaCandidates.filter((k) => typeof k === "number" && Number.isFinite(k));
  return {
    name: String(def.name ?? ""),
    what: String(def.advert?.what ?? ""),
    provider: String(def.provider?.name ?? ""),
    modes,
    karma: karmas.length ? Math.max(...karmas) : null,
    output: isObj(def.output) && str(def.output.kind) ? String(def.output.kind) : null,
    children: Array.isArray(def.children) ? def.children.length : 0,
    ok,
    file
  };
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra2 = "") => {
    console.assert(cond, `FAIL ${label}${extra2 ? " :: " + extra2 : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const valid = {
    name: "resize-image",
    advert: { what: "Resize an image with python PIL", karma: 1 },
    provider: { name: "python PIL", launch: "python resize.py {{input}}", update: "pip install --upgrade pillow" },
    variables: { init: [{ name: "py", type: "text", default: "python" }], input: [{ name: "width", type: "number", required: true }], files: [{ name: "input", kind: "image" }] },
    modes: [
      { name: "cpu", karma: 1, install: { pins: { python: "3.11" }, steps: ["pip install pillow"], note: "any machine" } },
      { name: "legacy-gpu", fits: { sm: "<=52" }, install: { pins: { python: "3.11", cuda: "11.8", torch: "2.5.1+cu118" }, note: "old cards: the wheel dance that still has wheels" } }
    ],
    output: { kind: "file", location: "out/" },
    pages: { ad: "<!doctype html><h1>Resize</h1>", inputs: "<!doctype html><form>resize</form>" },
    progress: { how: "the run prints step N of M", source: "stdout" },
    gui: { kind: "url", value: "http://127.0.0.1:7860" }
  };
  const good = validateService(valid);
  ok("a valid definition passes", good.ok === true && good.errors.length === 0, JSON.stringify(good.errors));
  ok("a valid definition copies no warnings about install (modes carry it)", !good.warnings.some((w) => w.field.endsWith(".install")));
  const noName = validateService({ ...valid, name: "" });
  ok("a missing name is an error", noName.ok === false && noName.errors.some((e) => e.field === "name"));
  const noPages = validateService({ ...valid, pages: void 0 });
  ok("a missing pages is an error", noPages.ok === false && noPages.errors.some((e) => e.field === "pages"));
  const legacyPage = validateService({ ...valid, page: "<h1>old</h1>" });
  ok("the retired single page warns, does not refuse", legacyPage.ok === true && legacyPage.warnings.some((w) => w.field === "page"));
  const badProgress = validateService({ ...valid, progress: { source: "stdout" } });
  ok("progress without how is an error", badProgress.ok === false && badProgress.errors.some((e) => e.field === "progress.how"));
  const noGuiValue = validateService({ ...valid, gui: { kind: "url" } });
  ok("gui without a value warns", noGuiValue.ok === true && noGuiValue.warnings.some((w) => w.field === "gui.value"));
  const lazyOut = validateService({ ...valid, variables: { ...valid.variables, input: [...valid.variables.input, { name: "save-path", role: "output" }] } });
  ok("an output path without a default warns (the lazy rule)", lazyOut.ok === true && lazyOut.warnings.some((w) => w.field.includes("default")));
  const noWhat = validateService({ ...valid, advert: { karma: 1 } });
  ok("a missing advert.what is an error", noWhat.ok === false && noWhat.errors.some((e) => e.field === "advert.what"));
  const junk = validateService("nope");
  ok("a non-object is refused", junk.ok === false && junk.errors[0].field === "$");
  const badModes = validateService({ ...valid, modes: [{ name: "a" }, { name: "a" }] });
  ok("duplicate mode names are refused", badModes.ok === false && badModes.errors.some((e) => e.message.includes("duplicate")));
  const noInstall = validateService({ ...valid, install: void 0, modes: [{ name: "solo" }] });
  ok("a mode with no install and no service install warns", noInstall.ok === true && noInstall.warnings.some((w) => w.field === "modes[0].install"));
  const noTime = validateService(valid);
  ok("no expected time is a warning (history fills it)", noTime.warnings.some((w) => w.field === "advert.time"));
  const badKarma = validateService({ ...valid, advert: { what: "x", karma: -1 } });
  ok("a negative karma weight is an error", badKarma.ok === false && badKarma.errors.some((e) => e.field === "advert.karma"));
  const extra = validateService({ ...valid, experiment: { someday: ["x"] } });
  ok("unknown fields pass through (nothing frozen)", extra.ok === true);
  const summary = summarizeService(valid, "resize-image.js", true);
  ok("the summary carries names and counts", summary.name === "resize-image" && summary.provider === "python PIL" && summary.modes.join(",") === "cpu,legacy-gpu");
  ok("the summary carries the highest karma weight", summary.karma === 1);
  ok("the summary never carries the pages", !JSON.stringify(summary).includes("doctype"));
  const noSchema = validateService(valid);
  ok("a v1 file with no schema warns and still loads", noSchema.ok === true && noSchema.warnings.some((w) => w.field === "schema"));
  const newer = validateService({ ...valid, schema: CURRENT_SCHEMA + 1 });
  ok("a newer schema warns but never refuses", newer.ok === true && newer.warnings.some((w) => w.field === "schema" && w.message.includes("newer")));
  const bumped = validateService({ ...valid, schema: CURRENT_SCHEMA, revision: 3 });
  ok("a revision bump with no installer_history warns", bumped.ok === true && bumped.warnings.some((w) => w.field === "installer_history" || w.field === "revision"));
  const credited = validateService({
    ...valid,
    schema: CURRENT_SCHEMA,
    revision: 2,
    installer_history: [{ rev: 2, at: "2026-11-05", by: "hermes-agent", note: "cuda works on maxwell" }]
  });
  ok("a bump with a credited entry is clean of revision warnings", credited.ok === true && !credited.warnings.some((w) => w.field.startsWith("install") && w.field.includes("history")));
  const unverified = validateService({
    ...valid,
    schema: CURRENT_SCHEMA,
    revision: 2,
    installer_history: [{ rev: 2, at: "2026-11-05", by: "hermes-agent", note: "suspected", verified: true }]
  });
  ok("verified:true without evidence warns", unverified.ok === true && unverified.warnings.some((w) => w.field.includes("evidence")));
  const ipInHardware = validateService({
    ...valid,
    schema: CURRENT_SCHEMA,
    revision: 2,
    installer_history: [{ rev: 2, at: "2026-11-05", by: "operator", note: "x", hardware: "192.168.1.134 GTX 980 Ti" }]
  });
  ok("an address in hardware warns (capability, not identity)", ipInHardware.ok === true && ipInHardware.warnings.some((w) => w.field.includes("hardware")));
  const installFace = validateService({
    ...valid,
    schema: CURRENT_SCHEMA,
    install: {
      engine: "audio.cpp",
      steps: [{ id: "weights", do: "hf download x -> path", verify: "sha256:abc" }, { do: "run it" }],
      hints: [{ when: "fp16:false", do: "vulkan", why: "maxwell" }, { do: "plain hint" }],
      exceptions: [{ when: "ps 5.1", do: "ascii only" }]
    }
  });
  ok("a step without verify warns, the file still loads", installFace.ok === true && installFace.warnings.some((w) => w.field.includes("steps[1].verify")));
  ok("a conditional hint without reconsider warns", installFace.warnings.some((w) => w.field.includes("reconsider")));
  ok("a bare string step warns (only a human can pass it)", validateService({ ...valid, schema: CURRENT_SCHEMA, install: { steps: ["do a thing"] } }).warnings.some((w) => w.field.includes("steps[0]")));
  const migrated = migrateService({ name: "old", advert: { what: "x" }, provider: { name: "p" }, pages: { ad: "<p>", inputs: "<p>" } });
  ok("migrate fills schema and revision in memory", migrated.definition.schema === CURRENT_SCHEMA && migrated.definition.revision === 1 && migrated.from === 1);
  ok("migrate is honest about what it did not invent", migrated.notes.some((n) => n.includes("install")));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[serviceSchema] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  CURRENT_SCHEMA,
  migrateService,
  runTests,
  summarizeService,
  validateService
};
//# sourceMappingURL=serviceSchema.js.map
