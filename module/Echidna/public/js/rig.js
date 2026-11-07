import fs from "node:fs";
import path from "node:path";
function fromRig(rig, source) {
  const pal = rig.palette ?? {};
  const prop = rig.proportions ?? {};
  const face = rig.face ?? {};
  const r = typeof prop.head_r === "number" ? prop.head_r : 46;
  const shoulderW = typeof prop.shoulder_w === "number" ? prop.shoulder_w : 88;
  const eyeScale = typeof face.eye_size === "number" ? face.eye_size : 1;
  const brow = typeof face.brow === "number" ? face.brow : 0.5;
  const mouthW = typeof face.mouth_w === "number" ? face.mouth_w : 14;
  const hairLen = String(rig.hair_style || rig.physique?.hair_length || "short").toLowerCase();
  const style = hairLen.includes("long") ? "long" : hairLen.includes("bob") || hairLen.includes("collar") ? "bob" : "short";
  return {
    name: rig.name ?? path.basename(source, ".json"),
    source,
    palette: {
      // the rig calls the garment 'suit' or 'robe'; the monitor only needs one cloth colour
      skin: pal.skin ?? "#c99b7a",
      hair: pal.hair ?? "#2f2a26",
      cloth: pal.suit ?? pal.robe ?? pal.shirt ?? "#2b3340",
      accent: pal.accent ?? "#e7c84b"
    },
    head: {
      r,
      // a slimmer character gets a narrower jaw, derived from shoulder width rather than guessed per face
      jaw: 0.86 + Math.min(0.08, Math.max(0, (shoulderW - 78) / 400))
    },
    eyes: {
      y: -Math.round(r * 0.17),
      dx: Math.round(r * 0.34),
      r: Number((2.9 * eyeScale).toFixed(2)),
      lid: 0.82
    },
    brow: { y: -Math.round(r * 0.42), w: Math.round(r * 0.42), thick: Number((2.4 + brow * 1.6).toFixed(1)) },
    hair: { style, fringe: 0.3 },
    mouth: { y: Math.round(r * 0.34), w: Math.round(mouthW + 2) },
    shoulders: { w: Math.round(shoulderW * 1.15), y: Math.round(r * 1.55) },
    voice: rig.voice ? { model: rig.voice.model ?? null, voiceId: rig.voice.voice_id ?? null, rate: rig.voice.rate ?? 1 } : null,
    wardrobe: rig.wardrobe ?? null,
    role: rig.role ?? null
  };
}
function loadRig(dir) {
  const out = {};
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(dir, file);
      try {
        const rig = JSON.parse(fs.readFileSync(full, "utf8"));
        const key = path.basename(file, ".json").toLowerCase();
        out[key] = fromRig(rig, full);
      } catch {
      }
    }
    if (!Object.keys(out).length) return { characters: out, error: `no character records in ${dir}` };
    return { characters: out, error: null };
  } catch (error) {
    return { characters: out, error: `rig directory not readable: ${error.message}` };
  }
}
export {
  fromRig,
  loadRig
};
//# sourceMappingURL=rig.js.map
