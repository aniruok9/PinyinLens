// Draws the app icons (a lens ring on a dark square) into public/icons/. Run once; the PNGs are committed.
// Usage: node scripts/make-icons.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const BACKGROUND = [11, 15, 20];
const RING = [79, 195, 247];
const DOT = [255, 255, 255];

// Fraction of the pixel at (x, y) covered by an annulus/disc, by 4x4 supersampling.
function coverage(x, y, cx, cy, inner, outer) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const d = Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy);
      if (d >= inner && d <= outer) hits++;
    }
  }
  return hits / 16;
}

function icon(size) {
  const png = new PNG({ width: size, height: size });
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pixel = BACKGROUND;
      const ring = coverage(x, y, c, c, size * 0.27, size * 0.36);
      const dot = coverage(x, y, c, c, 0, size * 0.1);
      pixel = pixel.map((v, i) => v + (RING[i] - v) * ring);
      pixel = pixel.map((v, i) => v + (DOT[i] - v) * dot);
      const o = (y * size + x) * 4;
      png.data[o] = pixel[0];
      png.data[o + 1] = pixel[1];
      png.data[o + 2] = pixel[2];
      png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) writeFileSync(new URL(`icon-${size}.png`, dir), icon(size));
console.log('wrote public/icons/icon-192.png and icon-512.png');
