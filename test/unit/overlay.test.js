import { describe, expect, it } from 'vitest';
import { drawLabels, labelBox, layoutLabels, placeLabels } from '../../src/app/overlay.js';

// Monospace stand-in for canvas text measurement: each character is 0.6 em wide.
const measure = (text, fontSize) => text.length * 0.6 * fontSize;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const line = (vertical, chars, tokens) => ({ vertical, tokens: tokens ?? [{ isCJK: true, chars }] });
const identity = { scale: 1, tx: 0, ty: 0 };

describe('layoutLabels', () => {
  it('centres each syllable under its character, sized from the character height', () => {
    const [label] = layoutLabels([line(false, [{ pinyin: 'ā', quad: rect(100, 50, 40, 40) }])], identity, measure);
    expect(label).toMatchObject({ text: 'ā', align: 'center', x: 120, fontSize: 18, halo: false }); // 0.45 * 40
    expect(label.y).toBeCloseTo(90 + 2.7); // gap 0.15 em
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
    expect(label).toMatchObject({ align: 'left', fontSize: 18 }); // height = 40 along the column
    expect(label.x).toBeCloseTo(60 + 2.7);
    expect(label.y).toBeCloseTo(30 - 9);
  });

  it('applies the view transform and skips non-CJK tokens and characters without pinyin', () => {
    const tokens = [
      { isCJK: false, chars: [{ pinyin: null, quad: rect(0, 0, 10, 10) }] },
      { isCJK: true, chars: [{ pinyin: null, quad: rect(0, 0, 10, 10) }, { pinyin: 'miàn', quad: rect(10, 0, 10, 10) }] },
    ];
    const labels = layoutLabels([line(false, null, tokens)], { scale: 2, tx: 5, ty: 7 }, measure);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: 'miàn', x: 35 }); // 15*2+5
    expect(labels[0].y).toBeCloseTo(10 * 2 + 7 + 0.15 * 7.5); // 'miàn' shrinks to 7.5px to fit 90% of 20px
  });

  it('puts labels above (or left of) their characters, smaller, or outlined, as placed', () => {
    const lines = [line(false, [{ pinyin: 'ā', quad: rect(100, 50, 40, 40) }]), line(true, [{ pinyin: 'yī', quad: [[60, 10], [60, 50], [20, 50], [20, 10]] }])];
    const before = { side: 'before', scale: 0.5, halo: true };
    const [above, left] = layoutLabels(lines, identity, measure, [before, before]);
    expect(above).toMatchObject({ x: 120, fontSize: 9, halo: true });
    expect(above.y).toBeCloseTo(50 - 0.15 * 9 - 1.2 * 9); // label bottom just above the character
    expect(left.x).toBeCloseTo(20 - 0.15 * 9 - measure('yī', 9));
  });

  it('scales exactly with the view, so a placement holds at every zoom', () => {
    const lines = [line(false, [{ pinyin: 'kǒu', quad: rect(10, 20, 30, 30) }])];
    const [one] = layoutLabels(lines, identity, measure);
    const [three] = layoutLabels(lines, { scale: 3, tx: 0, ty: 0 }, measure);
    for (const key of ['x', 'y', 'fontSize', 'width']) expect(three[key]).toBeCloseTo(3 * one[key]);
  });
});

describe('placeLabels', () => {
  // A horizontal line of 40px characters starting at (x, y), one per pinyin syllable.
  const row = (x, y, ...syllables) => line(false, syllables.map((pinyin, i) => ({ pinyin, quad: rect(x + 40 * i, y, 40, 40) })));
  // At full size a label strip under a 40px character is 27px tall (1.2 em text + 0.15 em padding, 18px font).

  it('keeps labels under their line when there is room', () => {
    expect(placeLabels([row(0, 0, 'ā'), row(0, 100, 'ā')], measure)).toEqual([
      { side: 'after', scale: 1, halo: false },
      { side: 'after', scale: 1, halo: false },
    ]);
  });

  it('moves a line\'s labels above it when the next line is too close below', () => {
    const [first] = placeLabels([row(0, 50, 'ā'), row(0, 100, 'ā')], measure); // 10px gap below, room above
    expect(first).toEqual({ side: 'before', scale: 1, halo: false });
  });

  it('shrinks labels to fit a gap that is too small for them at full size', () => {
    // 2px above the middle line, 25px below it: 27px strips fit only at 90%.
    const placements = placeLabels([row(0, 8, 'ā'), row(0, 50, 'ā'), row(0, 115, 'ā')], measure);
    expect(placements[1]).toMatchObject({ side: 'after', halo: false });
    expect(placements[1].scale).toBeCloseTo(0.9);
  });

  it('outlines labels, at full size below their line, when no gap is big enough even at half size', () => {
    const [, middle] = placeLabels([row(0, 8, 'ā'), row(0, 50, 'ā'), row(0, 92, 'ā')], measure);
    expect(middle).toEqual({ side: 'after', scale: 1, halo: true });
  });

  it('keeps all of a line\'s labels on one side', () => {
    // Only the second character has a line close below it; the whole line goes above.
    const lines = [row(0, 50, 'ā', 'ō'), line(false, [{ pinyin: 'ē', quad: rect(40, 100, 40, 40) }])];
    const labels = layoutLabels(lines, identity, measure, placeLabels(lines, measure)).filter((l) => l.line === 0);
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label.y).toBeLessThan(50);
  });

  it('never places labels off the photo, where they could not be seen', () => {
    const photo = { width: 400, height: 400 };
    // A line 3px from the top with another close below: above is off the photo, so it shrinks or outlines.
    expect(placeLabels([row(0, 3, 'ā'), row(0, 50, 'ā')], measure, photo)[0]).toEqual({ side: 'after', scale: 1, halo: true });
    // The same for a vertical column at the left edge with another column close on its right.
    const column = (x) => line(true, [{ pinyin: 'yī', quad: [[x + 40, 10], [x + 40, 50], [x, 50], [x, 10]] }]);
    expect(placeLabels([column(3), column(50)], measure, photo)[0]).toEqual({ side: 'after', scale: 1, halo: true });
    // A crowded line 3px from the bottom outlines its labels above itself, the side still on the photo.
    expect(placeLabels([row(0, 310, 'ā'), row(0, 357, 'ā')], measure, photo)[1]).toEqual({ side: 'before', scale: 1, halo: true });
    // Without a close neighbour the edge line keeps its labels below, as usual.
    expect(placeLabels([row(0, 3, 'ā')], measure, photo)[0]).toEqual({ side: 'after', scale: 1, halo: false });
  });

  it('gives each gap between lines to one line\'s labels', () => {
    // The second line's labels take the 35px gap below it. The third line can't put its labels in the
    // same gap and has 2px below it, so it outlines them instead.
    const placements = placeLabels([row(0, -42, 'ā'), row(0, 0, 'ā'), row(0, 75, 'ā'), row(0, 117, 'ā')], measure);
    expect(placements[1]).toEqual({ side: 'after', scale: 1, halo: false });
    expect(placements[2]).toEqual({ side: 'after', scale: 1, halo: true });
  });
});

describe('drawLabels', () => {
  // Records the canvas calls drawLabels makes.
  const recorder = () => {
    const calls = [];
    const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])), set: (target, key, value) => ((target[key] = value), true) });
    return { ctx, calls };
  };
  const label = { text: 'ā', fontSize: 18, width: 10.8, x: 120, y: 92.7, align: 'center' };

  it('draws a label on a dark strip covering its box', () => {
    const { ctx, calls } = recorder();
    drawLabels(ctx, [{ ...label, halo: false }]);
    const box = labelBox(label);
    expect(calls).toContainEqual(['fillRect', box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0]);
    expect(calls.map(([name]) => name)).not.toContain('strokeText');
  });

  it('draws an outlined label with no strip, so what it overlaps stays visible', () => {
    const { ctx, calls } = recorder();
    drawLabels(ctx, [{ ...label, halo: true }]);
    expect(calls.map(([name]) => name)).toEqual(['strokeText', 'fillText']);
  });
});
