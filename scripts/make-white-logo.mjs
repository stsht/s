// One-off build helper: produces logo-hero-white.png from logo-hero.png.
// Every opaque pixel becomes pure white (#ffffff) while preserving the
// alpha channel, giving us a clean white silhouette for dark-mode gates.
//
// Re-run manually with `node scripts/make-white-logo.mjs` whenever the
// source logo-hero.png changes.

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, 'logo-hero.png');
const OUT = resolve(ROOT, 'logo-hero-white.png');

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
if (channels !== 4) throw new Error(`Expected RGBA, got ${channels} channels`);

const buf = Buffer.from(data);
for (let i = 0; i < buf.length; i += 4) {
  // Keep alpha (buf[i+3]); paint RGB pure white.
  buf[i] = 255;
  buf[i + 1] = 255;
  buf[i + 2] = 255;
}

await sharp(buf, { raw: { width, height, channels: 4 } }).png().toFile(OUT);
console.log(`✓ wrote ${OUT} (${width}x${height})`);
