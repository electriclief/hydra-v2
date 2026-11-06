import fs from "node:fs";
import path from "node:path";
function readNodeConfig(file) {
  const fallback = { name: "this node", modelsDir: null, modelsDirs: {}, gpu: null, note: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const dirs = {};
    if (raw.modelsDirs && typeof raw.modelsDirs === "object") {
      for (const [k, v] of Object.entries(raw.modelsDirs)) {
        if (typeof v === "string" && v.trim()) dirs[k] = v.trim();
      }
    }
    return {
      name: typeof raw.name === "string" ? raw.name : fallback.name,
      modelsDir: typeof raw.modelsDir === "string" && raw.modelsDir.trim() ? raw.modelsDir.trim() : null,
      modelsDirs: dirs,
      gpu: typeof raw.gpu === "string" ? raw.gpu : null,
      note: typeof raw.note === "string" ? raw.note : null
    };
  } catch {
    return fallback;
  }
}
function readCache(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function writeCache(file, cache) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), "utf8");
  } catch {
  }
}
function declaredModels(raw) {
  return raw.filter((m) => !!m && typeof m === "object");
}
function readModels(options) {
  const declared = declaredModels(options.declared ?? []);
  const dir = options.node.modelsDirs[options.service] ?? options.node.modelsDir;
  const cache = readCache(options.cacheFile);
  const mine = cache[options.service] ?? {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rows = [];
  let touched = false;
  for (const m of declared) {
    const family = String(m.family ?? m.id ?? "unnamed");
    const file = typeof m.file === "string" && m.file.trim() ? m.file.trim() : null;
    const bytes = Number(m.bytes ?? 0) || 0;
    const row = {
      file,
      family,
      quant: typeof m.quant === "string" ? m.quant : null,
      bytes,
      sha256: typeof m.sha256 === "string" ? m.sha256 : null,
      vramGb: typeof m.vramGb === "number" ? m.vramGb : null,
      role: typeof m.role === "string" ? m.role : null,
      note: typeof m.note === "string" ? m.note : null,
      path: file && dir ? path.join(dir, file) : null,
      exists: null,
      actualBytes: null,
      mtime: null,
      changed: false,
      checkedAt: null
    };
    if (options.verify) {
      if (row.path) {
        try {
          const st = fs.statSync(row.path);
          row.exists = st.isFile();
          row.actualBytes = st.size;
          row.mtime = st.mtime.toISOString();
          row.changed = st.size !== row.bytes;
          row.checkedAt = now;
          mine[row.file] = { bytes: st.size, mtime: row.mtime, at: now };
          touched = true;
        } catch {
          row.exists = false;
          row.checkedAt = now;
          if (row.file && mine[row.file]) {
            delete mine[row.file];
            touched = true;
          }
        }
      }
    } else if (row.file && mine[row.file]) {
      row.exists = true;
      row.actualBytes = mine[row.file].bytes;
      row.mtime = mine[row.file].mtime;
      row.changed = mine[row.file].bytes !== row.bytes;
      row.checkedAt = mine[row.file].at;
    }
    rows.push(row);
  }
  if (touched) {
    cache[options.service] = mine;
    writeCache(options.cacheFile, cache);
  }
  const note = !declared.length ? "this service declares no weights \u2014 it is not a model holder" : !dir ? "no modelsDir in the node file: sizes are as declared, nothing was checked on disk" : null;
  return {
    ok: true,
    service: options.service,
    modelsDir: dir,
    verified: options.verify,
    models: rows,
    note,
    error: null
  };
}
export {
  readCache,
  readModels,
  readNodeConfig
};
//# sourceMappingURL=models.js.map
