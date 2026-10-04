import { describe, expect, it } from 'vitest';
import { charAt } from '../../src/app/hittest.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// One line: a non-CJK token, then CJK characters in 40px cells starting at x = 100.
const lines = [
  {
    tokens: [
      { isCJK: false, text: 'A', chars: [{ ch: 'A', quad: rect(40, 0, 40, 40) }] },
      { isCJK: true, text: '可口面', chars: [...'可口面'].map((ch, i) => ({ ch, quad: rect(100 + 40 * i, 0, 40, 40) })) },
    ],
  },
];
const identity = { scale: 1, tx: 0, ty: 0 };

describe('charAt', () => {
  it('finds the character under the point', () => {
    expect(charAt(lines, identity, 150, 20)).toEqual({ line: 0, token: 1, char: 1 });
  });

  it('accepts a near miss, picking the closest character', () => {
    expect(charAt(lines, identity, 225, 50)).toEqual({ line: 0, token: 1, char: 2 }); // 10px below 面
  });

  it('returns null away from any Chinese character', () => {
    expect(charAt(lines, identity, 400, 300)).toBeNull();
    expect(charAt(lines, identity, 60, 20)).toBeNull(); // on the non-CJK token
  });

  it('gives small characters a finger-sized target', () => {
    const tiny = { scale: 0.1, tx: 0, ty: 0 }; // 4px characters on screen
    expect(charAt(lines, tiny, 15, 2 + 18)).toEqual({ line: 0, token: 1, char: 1 }); // 18px from 口's centre
  });

  it('works in screen space under the view transform', () => {
    expect(charAt(lines, { scale: 2, tx: 10, ty: 10 }, 10 + 2 * 210, 10 + 2 * 20)).toEqual({ line: 0, token: 1, char: 2 });
  });
});
