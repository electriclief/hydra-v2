/**
 * make-assets.cjs - draw the module's own icons, no dependencies.
 * Writes assets/tray.png (16x16) and assets/icon.png (64x64): a split-pane motif
 * (the wrapper template: one pane left, two stacked right) on a dark field.
 * Run once; the PNGs are committed. Usage: node scripts/make-assets.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// --- tiny PNG writer (RGBA, filter 0 per scanline) ---

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log(`wrote ${file} (${width}x${height}, ${png.length} bytes)`);
}

// --- the motif: split panes on a dark field ---

const FIELD = [30, 36, 48, 255]; // #1e2430
const LEFT = [122, 162, 247, 255]; // #7aa2f7 — the big pane
const RIGHT = [74, 85, 104, 255]; // #4a5568 — the two stacked panes

function motif(size) {
  const u = size / 16; // 16 is the design grid
  const px = (x, y) => {
    const gx = x / u;
    const gy = y / u;
    // border margin: 1 grid unit all around
    if (gx < 1 || gx > 15 || gy < 1 || gy > 15) return FIELD;
    if (gx < 7.5) return gx < 7.5 && gy < 15 && gx >= 1 ? LEFT : FIELD; // left pane cols 1..7
    if (gy < 8) return RIGHT; // right top
    if (gy > 8) return RIGHT; // right bottom; 1-unit gutter at gy 8
    return FIELD;
  };
  return px;
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
writePng(path.join(outDir, 'tray.png'), 16, 16, motif(16));
writePng(path.join(outDir, 'icon.png'), 64, 64, motif(64));
