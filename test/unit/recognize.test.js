import { describe, expect, it } from 'vitest';
import { createImage } from '../../src/ocr/image.js';
import { buildRecBatch, charSpans, cropLine, ctcDecode, frameQuad } from '../../src/ocr/recognize.js';

// Softmax-like output for one item: at each timestep the given class gets probability p.
function probsFor(classes, C, p = 0.9) {
  const out = new Float32Array(classes.length * C);
  classes.forEach((k, t) => {
    out.fill((1 - p) / (C - 1), t * C, (t + 1) * C);
    out[t * C + k] = p;
  });
  return out;
}

describe('cropLine', () => {
  it('crops a horizontal box upright with a frame that maps back to the source', () => {
    const img = createImage(100, 50);
    const quad = [
      [10, 5],
      [70, 5],
      [70, 25],
      [10, 25],
    ];
    const { image, frame, vertical } = cropLine(img, quad);
    expect(vertical).toBe(false);
    expect([image.width, image.height]).toEqual([60, 20]);
    expect(frameQuad(frame, 0, 60)).toEqual(quad);
  });

  it('rotates tall boxes counter-clockwise so reading runs top to bottom', () => {
    const img = createImage(100, 100);
    const quad = [
      [40, 10],
      [60, 10],
      [60, 90],
      [40, 90],
    ]; // 20 wide, 80 tall
    const { image, frame, vertical } = cropLine(img, quad);
    expect(vertical).toBe(true);
    expect([image.width, image.height]).toEqual([80, 20]);
    // The first 10 crop columns are the top 10 source rows of the column.
    const [tl, tr, br, bl] = frameQuad(frame, 0, 10);
    expect([tl, tr, br, bl]).toEqual([
      [60, 10],
      [60, 20],
      [40, 20],
      [40, 10],
    ]);
  });
});

describe('buildRecBatch', () => {
  it('uses width 320 for short crops and normalises to [-1, 1] in BGR order', () => {
    const crop = createImage(24, 48);
    for (let i = 0; i < crop.data.length; i += 4) crop.data.set([255, 0, 0, 255], i); // pure red
    const { data, dims, widths } = buildRecBatch([crop]);
    expect(dims).toEqual([1, 3, 48, 320]);
    expect(widths).toEqual([24]);
    const plane = 48 * 320;
    expect([data[0], data[plane], data[2 * plane]]).toEqual([-1, -1, 1]); // B, G, R at (0, 0)
    expect(data[30]).toBe(0); // right padding
  });

  it('sizes the batch to the widest crop, rounded up to a multiple of 8', () => {
    const { dims, widths } = buildRecBatch([createImage(100, 10), createImage(30, 30)]);
    expect(widths).toEqual([480, 48]);
    expect(dims).toEqual([2, 3, 48, 480]);
    expect(buildRecBatch([createImage(101, 10)]).dims[3]).toBe(488); // 484.8 → 485 → 488
  });
});

describe('ctcDecode', () => {
  const charset = ['你', '好', '世'];
  const C = charset.length + 2; // blank + charset + space

  it('collapses repeats, drops blanks, and keeps blank-separated repeats', () => {
    // 你 你 _ 好 _ 好 space 世
    const probs = probsFor([1, 1, 0, 2, 0, 2, 4, 3], C);
    const { text, chars, score } = ctcDecode(probs, 0, 8, C, charset);
    expect(text).toBe('你好好 世');
    expect(chars.map((c) => [c.t0, c.t1])).toEqual([
      [0, 1],
      [3, 3],
      [5, 5],
      [6, 6],
      [7, 7],
    ]);
    expect(score).toBeCloseTo(0.9, 5);
  });

  it('reads the requested batch item', () => {
    const probs = new Float32Array([...probsFor([1, 0], C), ...probsFor([3, 0], C)]);
    expect(ctcDecode(probs, 1, 2, C, charset).text).toBe('世');
  });

  it('returns an empty line with score 0 when everything is blank', () => {
    expect(ctcDecode(probsFor([0, 0, 0], C), 0, 3, C, charset)).toEqual({ text: '', score: 0, chars: [] });
  });
});

describe('charSpans', () => {
  it('centres characters on their timesteps and splits halfway between neighbours', () => {
    // T = 40 over a 320-wide batch: 8 px per timestep. Resized crop 160 wide = crop 80 wide.
    const chars = [
      { t0: 2, t1: 2 },
      { t0: 6, t1: 8 },
      { t0: 12, t1: 12 },
    ];
    // centres in resized px: 20, 60, 100 → crop px: 10, 30, 50
    expect(charSpans(chars, 40, 320, 160, 80)).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
    ]);
  });

  it('gives a lone character the whole crop', () => {
    expect(charSpans([{ t0: 3, t1: 3 }], 40, 100, 50, 50)).toEqual([[0, 50]]);
  });
});
