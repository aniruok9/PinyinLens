import { describe, expect, it } from 'vitest';
import {
  connectedComponents,
  convexHull,
  expandRect,
  minAreaRect,
  orderQuad,
  rectCorners,
  rectMeanScore,
  rowExtremes,
  shortSide,
} from '../../src/ocr/geometry.js';

// Builds a mask from rows of '#' (on) and '.' (off).
function mask(rows) {
  const width = rows[0].length;
  return { width, height: rows.length, data: Uint8Array.from(rows.join(''), (c) => (c === '#' ? 1 : 0)) };
}
const sortedPoints = (pts) => [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
const closeTo = (pts, expected) =>
  sortedPoints(pts).forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], 6);
    expect(p[1]).toBeCloseTo(expected[i][1], 6);
  });

describe('connectedComponents', () => {
  it('separates blobs and joins diagonal neighbours (8-connectivity)', () => {
    const m = mask(['##..#', '.#..#', '..#..', '.....', '#....']);
    const comps = connectedComponents(m.data, m.width, m.height).map((c) => [...c].sort((a, b) => a - b));
    expect(comps).toEqual([[0, 1, 6, 12], [4, 9], [20]]);
  });
});

describe('rowExtremes + convexHull', () => {
  it('reduces a filled rectangle to its 4 corners', () => {
    const m = mask(['.....', '.###.', '.###.', '.###.']);
    const [pixels] = connectedComponents(m.data, m.width, m.height);
    expect(sortedPoints(convexHull(rowExtremes(pixels, m.width)))).toEqual([
      [1, 1],
      [1, 3],
      [3, 1],
      [3, 3],
    ]);
  });

  it('drops interior and collinear points', () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(sortedPoints(hull)).toEqual([
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
    ]);
  });
});

describe('minAreaRect', () => {
  it('fits an axis-aligned rectangle exactly', () => {
    const rect = minAreaRect([
      [10, 20],
      [40, 20],
      [40, 30],
      [10, 30],
    ]);
    expect(rect.center[0]).toBeCloseTo(25);
    expect(rect.center[1]).toBeCloseTo(25);
    expect([2 * rect.halfU, 2 * rect.halfV].sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it('finds the rotated rectangle around a tilted box', () => {
    // 20 x 4 box rotated 30° around (50, 50).
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const pts = [
      [-10, -2],
      [10, -2],
      [10, 2],
      [-10, 2],
    ].map(([x, y]) => [50 + x * c - y * s, 50 + x * s + y * c]);
    const rect = minAreaRect(convexHull(pts));
    expect(shortSide(rect)).toBeCloseTo(4, 6);
    expect(2 * Math.max(rect.halfU, rect.halfV)).toBeCloseTo(20, 6);
    closeTo(rectCorners(rect), sortedPoints(pts));
  });

  it('returns null for degenerate hulls', () => {
    expect(
      minAreaRect([
        [0, 0],
        [5, 5],
      ]),
    ).toBeNull();
  });
});

describe('expandRect', () => {
  it('grows every side by area * ratio / perimeter', () => {
    const rect = { center: [0, 0], u: [1, 0], v: [0, 1], halfU: 15, halfV: 5 }; // 30 x 10
    const out = expandRect(rect, 1.5); // d = 300 * 1.5 / 80 = 5.625
    expect(out.halfU).toBeCloseTo(15 + 5.625);
    expect(out.halfV).toBeCloseTo(5 + 5.625);
  });
});

describe('orderQuad', () => {
  it('orders as top-left, top-right, bottom-right, bottom-left', () => {
    expect(
      orderQuad([
        [9, 9],
        [0, 0],
        [0, 9],
        [9, 0],
      ]),
    ).toEqual([
      [0, 0],
      [9, 0],
      [9, 9],
      [0, 9],
    ]);
  });
});

describe('rectMeanScore', () => {
  it('averages the probability map inside the rect only', () => {
    const width = 6;
    const height = 4;
    const prob = new Float32Array(width * height);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) prob[y * width + x] = 0.9;
    const inside = { center: [2, 1.5], u: [1, 0], v: [0, 1], halfU: 1, halfV: 0.5 };
    expect(rectMeanScore(prob, width, height, inside)).toBeCloseTo(0.9, 6);
    const wider = { ...inside, center: [3, 1.5], halfU: 2 }; // x = 1..5, two columns are 0
    expect(rectMeanScore(prob, width, height, wider)).toBeCloseTo(0.54, 6);
  });
});
