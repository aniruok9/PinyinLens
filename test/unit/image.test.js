import { describe, expect, it } from 'vitest';
import { createImage, resizeBilinear, warpFrame } from '../../src/ocr/image.js';

// Image whose red channel holds the given values (row-major), alpha 255.
function fromRed(width, height, values) {
  const img = createImage(width, height);
  values.forEach((v, i) => {
    img.data[i * 4] = v;
    img.data[i * 4 + 3] = 255;
  });
  return img;
}
const red = (img) => Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4]);

describe('resizeBilinear', () => {
  it('keeps a constant image constant', () => {
    const out = resizeBilinear(fromRed(3, 2, [90, 90, 90, 90, 90, 90]), 7, 5);
    expect(new Set(red(out))).toEqual(new Set([90]));
  });

  it('averages neighbouring pairs when halving (half-pixel centres)', () => {
    expect(red(resizeBilinear(fromRed(4, 1, [0, 100, 200, 250]), 2, 1))).toEqual([50, 225]);
  });

  it('returns the requested size', () => {
    const out = resizeBilinear(fromRed(4, 4, new Array(16).fill(1)), 3, 9);
    expect([out.width, out.height, out.data.length]).toEqual([3, 9, 3 * 9 * 4]);
  });
});

describe('warpFrame', () => {
  const src = fromRed(3, 2, [10, 20, 30, 40, 50, 60]);

  it('copies the image with an identity frame', () => {
    const out = warpFrame(src, { origin: [0, 0], r: [1, 0], a: [0, 1], width: 3, height: 2 });
    expect(red(out)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('rotates 90° counter-clockwise with origin at the top-right corner', () => {
    // out(x, y) = src(2 - y, x): the top row of the result is the source's right column.
    const out = warpFrame(src, { origin: [2, 0], r: [0, 1], a: [-1, 0], width: 2, height: 3 });
    expect(red(out)).toEqual([30, 60, 20, 50, 10, 40]);
  });

  it('interpolates between pixels and replicates edges', () => {
    const out = warpFrame(src, { origin: [0.5, 0], r: [1, 0], a: [0, 1], width: 3, height: 1 });
    expect(red(out)).toEqual([15, 25, 30]);
  });
});
