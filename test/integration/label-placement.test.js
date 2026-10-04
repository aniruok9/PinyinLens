import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { DEFAULT_CONFIG } from '../../scripts/models.config.js';
import { labelBox, layoutLabels, placeLabels } from '../../src/app/overlay.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { annotate } from '../../src/text/annotate.js';

// The two fixture menus with tightly spaced lines, where labels drawn under every line covered the
// next line's characters (76 of 103 labels on the chicken-ribs menu).
const CROWDED = ['menu-chicken-ribs-black.png', 'menu-addons-cream.png'];
const FIXTURES = new URL('../fixtures/', import.meta.url);
const measure = (text, fontSize) => text.length * 0.55 * fontSize; // roughly system-ui's lowercase advance
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const bounds = (quad) => ({
  x0: Math.min(...quad.map((p) => p[0])),
  x1: Math.max(...quad.map((p) => p[0])),
  y0: Math.min(...quad.map((p) => p[1])),
  y1: Math.max(...quad.map((p) => p[1])),
});

describe('label placement on crowded menus', () => {
  let ocr;
  const scans = {};
  const photos = {};

  beforeAll(async () => {
    const det = loadDet(DEFAULT_CONFIG.det);
    const rec = loadRec(DEFAULT_CONFIG.rec);
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    for (const name of CROWDED) {
      photos[name] = loadPng(new URL(name, FIXTURES));
      scans[name] = annotate((await ocr.scan(photos[name], { longSide: DEFAULT_CONFIG.longSide })).lines);
    }
  });
  afterAll(() => ocr?.release());

  for (const name of CROWDED) {
    it(`${name}: every syllable keeps a label, and no label strip covers another line's characters or labels or leaves the photo`, () => {
      const lines = scans[name];
      const { width, height } = photos[name];
      const labels = layoutLabels(lines, { scale: 1, tx: 0, ty: 0 }, measure, placeLabels(lines, measure, { width, height }));
      const syllables = lines.flatMap((l) => l.tokens.filter((t) => t.isCJK).flatMap((t) => t.chars.filter((c) => c.pinyin)));
      expect(labels).toHaveLength(syllables.length);

      const chars = lines.flatMap((l, i) => l.tokens.filter((t) => t.isCJK).flatMap((t) => t.chars.map((c) => ({ line: i, box: bounds(c.quad) }))));
      const strips = labels.filter((label) => !label.halo).map((label) => ({ line: label.line, box: labelBox(label) }));
      const covered = strips.filter((s) => chars.some((c) => c.line !== s.line && overlaps(s.box, c.box)));
      const stacked = strips.filter((s) => strips.some((t) => t.line !== s.line && overlaps(s.box, t.box)));
      const outside = strips.filter((s) => s.box.x0 < 0 || s.box.y0 < 0 || s.box.x1 > width || s.box.y1 > height);
      expect(covered).toEqual([]);
      expect(stacked).toEqual([]);
      expect(outside).toEqual([]);
    });
  }

  it('outlines the labels of lines with no room at all rather than dropping them', () => {
    const lines = scans['menu-chicken-ribs-black.png'];
    const placements = placeLabels(lines, measure, photos['menu-chicken-ribs-black.png']);
    expect(placements.some((p) => p.halo)).toBe(true);
    expect(placements.some((p) => !p.halo && (p.side === 'before' || p.scale < 1))).toBe(true);
  });
});
