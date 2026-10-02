import { describe, expect, it } from 'vitest';
import { dbPostprocess, detInputSize, toDetInput } from '../../src/ocr/detect.js';
import { createImage } from '../../src/ocr/image.js';

const PARAMS = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, maxCandidates: 1000 };

// Probability map with value `p` inside each [x0, y0, x1, y1] (inclusive) block.
function probMap(width, height, blocks) {
  const prob = new Float32Array(width * height);
  for (const [x0, y0, x1, y1, p] of blocks) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) prob[y * width + x] = p;
  }
  return prob;
}

describe('detInputSize', () => {
  it('scales the long side to the target and rounds both sides to multiples of 32', () => {
    expect(detInputSize(1479, 883, 960)).toEqual({ width: 960, height: 576 });
    expect(detInputSize(1080, 1920, 960)).toEqual({ width: 544, height: 960 });
  });

  it('upscales small inputs and never goes below 32', () => {
    expect(detInputSize(400, 10, 960)).toEqual({ width: 960, height: 32 });
  });
});

describe('toDetInput', () => {
  it('writes B, G, R planes normalised with PaddleOCR det mean/std', () => {
    const img = createImage(1, 1);
    img.data.set([255, 0, 51, 255]); // R=255 G=0 B=51
    const out = toDetInput(img, 1, 1);
    expect(out[0]).toBeCloseTo((51 / 255 - 0.485) / 0.229, 5); // B plane
    expect(out[1]).toBeCloseTo((0 - 0.456) / 0.224, 5); // G plane
    expect(out[2]).toBeCloseTo((1 - 0.406) / 0.225, 5); // R plane
  });

  it('resizes to the requested size', () => {
    expect(toDetInput(createImage(10, 10), 32, 64)).toHaveLength(3 * 32 * 64);
  });
});

describe('dbPostprocess', () => {
  it('turns a confident text blob into an expanded quad scaled to the target', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 19, 0.9]]); // 30 x 10 blob
    const boxes = dbPostprocess(prob, 64, 32, PARAMS, { width: 128, height: 64 });
    expect(boxes).toHaveLength(1);
    // Hull spans x 10..39, y 10..19 → rect 29 x 9; d = 29*9*1.5/76 ≈ 5.15
    // → x 4.85..44.15, y 4.85..24.15 → ×2 and rounded.
    expect(boxes[0].quad).toEqual([
      [10, 10],
      [88, 10],
      [88, 48],
      [10, 48],
    ]);
    expect(boxes[0].score).toBeCloseTo(0.9, 5);
  });

  it('drops blobs whose mean score is below boxThresh', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 19, 0.5]]);
    expect(dbPostprocess(prob, 64, 32, PARAMS, { width: 64, height: 32 })).toEqual([]);
  });

  it('drops blobs thinner than 3 pixels', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 11, 0.9]]); // 2 rows tall
    expect(dbPostprocess(prob, 64, 32, PARAMS, { width: 64, height: 32 })).toEqual([]);
  });

  it('returns boxes top-to-bottom, then left-to-right', () => {
    const prob = probMap(64, 40, [
      [40, 2, 60, 8, 0.9],
      [2, 2, 20, 8, 0.9],
      [2, 25, 30, 33, 0.9],
    ]);
    const boxes = dbPostprocess(prob, 64, 40, PARAMS, { width: 64, height: 40 });
    expect(boxes.map((b) => b.quad[0][0] < 32 && b.quad[0][1] < 20)).toEqual([true, false, false]);
    expect(boxes[2].quad[0][1]).toBeGreaterThan(15);
  });
});
