import { describe, expect, it } from 'vitest';
import { layoutLabels } from '../../src/app/overlay.js';

// Monospace stand-in for canvas text measurement: each character is 0.6 em wide.
const measure = (text, fontSize) => text.length * 0.6 * fontSize;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const line = (vertical, chars, tokens) => ({ vertical, tokens: tokens ?? [{ isCJK: true, chars }] });
const identity = { scale: 1, tx: 0, ty: 0 };

describe('layoutLabels', () => {
  it('centres each syllable under its character, sized from the character height', () => {
    const [label] = layoutLabels([line(false, [{ pinyin: 'ā', quad: rect(100, 50, 40, 40) }])], identity, measure);
    expect(label).toMatchObject({ text: 'ā', align: 'center', x: 120, y: 92, fontSize: 18 }); // 0.45 * 40
  });

  it('shrinks long syllables to 90% of the character width', () => {
    const [label] = layoutLabels([line(false, [{ pinyin: 'zhuāng', quad: rect(0, 0, 20, 40) }])], identity, measure);
    // natural width 6 * 0.6 * 18 = 64.8 > 18 → fontSize 18 * 18 / 64.8 = 5
    expect(label.fontSize).toBeCloseTo(5);
    expect(label.width).toBeCloseTo(18);
  });

  it('places labels to the right of vertical columns', () => {
    // Vertical line, reading orientation: quad[0]→quad[1] runs down the column's right edge (x = 60).
    const quad = [[60, 10], [60, 50], [20, 50], [20, 10]];
    const [label] = layoutLabels([line(true, [{ pinyin: 'yī', quad }])], identity, measure);
    expect(label).toMatchObject({ align: 'left', x: 62, fontSize: 18 }); // height = 40 along the column
    expect(label.y).toBeCloseTo(30 - 9);
  });

  it('applies the view transform and skips non-CJK tokens and characters without pinyin', () => {
    const tokens = [
      { isCJK: false, chars: [{ pinyin: null, quad: rect(0, 0, 10, 10) }] },
      { isCJK: true, chars: [{ pinyin: null, quad: rect(0, 0, 10, 10) }, { pinyin: 'miàn', quad: rect(10, 0, 10, 10) }] },
    ];
    const labels = layoutLabels([line(false, null, tokens)], { scale: 2, tx: 5, ty: 7 }, measure);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: 'miàn', x: 35, y: 29 }); // (15*2+5, 10*2+7+2)
  });
});
