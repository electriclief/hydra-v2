#!/usr/bin/env node
/**
 * embed-image.cjs — turn a hero image into the one line a service file may carry.
 *
 * WHY THIS EXISTS
 *   Service files are DATA, loaded into memory whole. A page may embed an image as a
 *   base64 `src` (no external references), but the file must stay small enough that a
 *   shelf of many services still fits in a small node's RAM. This tool does the encode
 *   and tells you the price before you paste it.
 *
 * USAGE
 *   node scripts/embed-image.cjs <image> [constName]
 *   node scripts/embed-image.cjs ..\..\Receive\hydra-images\spoils-jpg\spoils-chat.jpg HERO_CHAT
 *
 * OUTPUT (stdout)
 *   - the image's real dimensions and byte size
 *   - `const <NAME> = 'data:image/<mime>;base64,...';`
 *   - the matching <img> tag with width/height attributes set (no layout shift)
 *   - a WARN line when the encoded payload is over budget
 *
 * BUDGET (ServicePages.md): one hero per ad page, ~800-1200 px wide, JPEG q≈85,
 *   110-200 KB base64. Over 250 KB = WARN, over 500 KB = REFUSE.
 *
 * Optimising an image is NOT this tool's job (no runtime dependencies, no ImageMagick
 * guessing). One ffmpeg line does it:
 *   ffmpeg -y -i in.png -vf scale=1200:-2 -q:v 3 out.jpg
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Real pixel dimensions from the file header — PNG or JPEG, no library. */
function dimensions(buf) {
  // PNG: 8-byte signature, then IHDR width/height big-endian
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: walk the segment chain to a Start-Of-Frame marker
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return { mime: 'image/jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', w: 0, h: 0 };
  }
  return null;
}

function main() {
  const [file, nameArg] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/embed-image.cjs <image> [constName]');
    process.exit(2);
  }
  const abs = path.resolve(file);
  const buf = fs.readFileSync(abs);
  const dims = dimensions(buf);
  if (!dims) {
    console.error(`refused: ${abs} is not a PNG or JPEG (this tool never guesses)`);
    process.exit(1);
  }

  const name = (nameArg || path.basename(abs).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase())
    .replace(/^([^A-Z_])/, '_$1');

  const b64 = buf.toString('base64');
  const kb = (n) => Math.round(n / 1024);
  const dataUri = `data:${dims.mime};base64,`;
  const encodedBytes = b64.length + dataUri.length;

  console.log(`file        ${abs}`);
  console.log(`type        ${dims.mime}  ${dims.w}x${dims.h}`);
  console.log(`image       ${kb(buf.length)} KB raw`);
  console.log(`embedded    ${kb(encodedBytes)} KB base64  (${(100 * encodedBytes / buf.length).toFixed(0)}% of raw)`);
  console.log(`budget      200 KB target · 250 KB WARN · 500 KB REFUSE`);
  console.log('');

  if (encodedBytes > 500 * 1024) {
    console.log(`REFUSED — ${kb(encodedBytes)} KB is over the 500 KB ceiling.`);
    console.log('  Re-encode first:  ffmpeg -y -i "' + abs + '" -vf scale=1200:-2 -q:v 3 out.jpg');
    process.exit(1);
  }
  if (encodedBytes > 250 * 1024) {
    console.log(`WARN — ${kb(encodedBytes)} KB is over the 250 KB warning line. Paste only if you mean it.`);
    console.log('');
  }

  console.log(`const ${name} = '${dataUri}${b64}';`);
  console.log('');
  console.log(`<img src="\${${name}}" width="${dims.w}" height="${dims.h}" alt="">`);
  console.log('');
  console.log('note: inside a page template literal use ${' + name + '} — never a backtick.');
}

main();
