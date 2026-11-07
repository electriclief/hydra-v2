/**
 * @module rig
 * @description Turn an approved character record (media/characters/<name>.json) into what the monitor draws.
 * @intent The rig is the source of truth for who a character IS: palette, proportions, face, hair, voice. The
 *         monitor must never invent a second Destiny - that is how you end up with a face in the app that nobody
 *         approved. So this is an adapter, not a copy: read the approved record, keep its numbers, and only add the
 *         few fields this renderer needs (a head-and-shoulders crop of the same person).
 */

import fs from 'node:fs';
import path from 'node:path';

export interface RigSpec {
  name: string;
  /** Which rig file this came from, so the app can say where a face came from. */
  source: string;
  palette: { skin: string; hair: string; cloth: string; accent: string };
  head: { r: number; jaw: number };
  eyes: { y: number; dx: number; r: number; lid: number };
  brow: { y: number; w: number; thick: number };
  hair: { style: 'short' | 'long' | 'bob'; fringe: number };
  mouth: { y: number; w: number };
  shoulders: { w: number; y: number };
  voice: { model: string | null; voiceId: string | null; rate: number } | null;
  wardrobe: string | null;
  role: string | null;
}

interface RigFile {
  name?: string;
  role?: string;
  palette?: Record<string, string>;
  physique?: { hair_length?: string; body_scale?: number };
  proportions?: { head_r?: number; shoulder_w?: number };
  hair_style?: string;
  wardrobe?: string;
  face?: { eye_size?: number; brow?: number; mouth_w?: number; blink_speed?: number };
  voice?: { model?: string | null; voice_id?: string | null; rate?: number };
}

/** The head-and-shoulders crop of an approved character, derived from its own numbers. */
export function fromRig(rig: RigFile, source: string): RigSpec {
  const pal = rig.palette ?? {};
  const prop = rig.proportions ?? {};
  const face = rig.face ?? {};
  const r = typeof prop.head_r === 'number' ? prop.head_r : 46;
  const shoulderW = typeof prop.shoulder_w === 'number' ? prop.shoulder_w : 88;
  const eyeScale = typeof face.eye_size === 'number' ? face.eye_size : 1;
  const brow = typeof face.brow === 'number' ? face.brow : 0.5;
  const mouthW = typeof face.mouth_w === 'number' ? face.mouth_w : 14;
  const hairLen = String(rig.hair_style || rig.physique?.hair_length || 'short').toLowerCase();
  const style: RigSpec['hair']['style'] = hairLen.includes('long') ? 'long' : hairLen.includes('bob') || hairLen.includes('collar') ? 'bob' : 'short';

  return {
    name: rig.name ?? path.basename(source, '.json'),
    source,
    palette: {
      // the rig calls the garment 'suit' or 'robe'; the monitor only needs one cloth colour
      skin: pal.skin ?? '#c99b7a',
      hair: pal.hair ?? '#2f2a26',
      cloth: pal.suit ?? pal.robe ?? pal.shirt ?? '#2b3340',
      accent: pal.accent ?? '#e7c84b',
    },
    head: {
      r,
      // a slimmer character gets a narrower jaw, derived from shoulder width rather than guessed per face
      jaw: 0.86 + Math.min(0.08, Math.max(0, (shoulderW - 78) / 400)),
    },
    eyes: {
      y: -Math.round(r * 0.17),
      dx: Math.round(r * 0.34),
      r: Number((2.9 * eyeScale).toFixed(2)),
      lid: 0.82,
    },
    brow: { y: -Math.round(r * 0.42), w: Math.round(r * 0.42), thick: Number((2.4 + brow * 1.6).toFixed(1)) },
    hair: { style, fringe: 0.3 },
    mouth: { y: Math.round(r * 0.34), w: Math.round(mouthW + 2) },
    shoulders: { w: Math.round(shoulderW * 1.15), y: Math.round(r * 1.55) },
    voice: rig.voice ? { model: rig.voice.model ?? null, voiceId: rig.voice.voice_id ?? null, rate: rig.voice.rate ?? 1 } : null,
    wardrobe: rig.wardrobe ?? null,
    role: rig.role ?? null,
  };
}

/**
 * Read every approved character from the rig directory. A missing directory is not an error: the pane falls back to
 * its own data file, and says which faces it is showing.
 */
export function loadRig(dir: string): { characters: Record<string, RigSpec>; error: string | null } {
  const out: Record<string, RigSpec> = {};
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(dir, file);
      try {
        const rig = JSON.parse(fs.readFileSync(full, 'utf8')) as RigFile;
        const key = path.basename(file, '.json').toLowerCase();
        out[key] = fromRig(rig, full);
      } catch {
        /* one broken rig record must not hide the others */
      }
    }
    if (!Object.keys(out).length) return { characters: out, error: `no character records in ${dir}` };
    return { characters: out, error: null };
  } catch (error) {
    return { characters: out, error: `rig directory not readable: ${(error as Error).message}` };
  }
}
