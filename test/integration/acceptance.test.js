import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_EXACT_SHARE } from '../../scripts/lib/choose.js';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { DEFAULT_CONFIG } from '../../scripts/models.config.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { annotate } from '../../src/text/annotate.js';
import { expectCharsInReadingOrder } from '../helpers/structure.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const KKM = 'menu-kkm.png';
const { det: detId, rec: recId, longSide } = DEFAULT_CONFIG;

// Spec success criterion 5, checked against the configuration the app ships.
describe(`shipped config: det ${detId}, rec ${recId}, long side ${longSide}`, () => {
  let ocr;
  const scans = {};

  beforeAll(async () => {
    const det = loadDet(detId);
    const rec = loadRec(recId);
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    for (const name of Object.keys(labels)) {
      scans[name] = (await ocr.scan(loadPng(new URL(name, FIXTURES)), { longSide })).lines;
    }
  });
  afterAll(() => ocr?.release());

  it(`reads at least ${MIN_EXACT_SHARE * 100}% of all labelled phrases exactly`, () => {
    let exact = 0;
    let total = 0;
    const misses = [];
    for (const [name, { required }] of Object.entries(labels)) {
      const score = scoreRequired(required, scans[name]);
      exact += score.exact;
      total += required.length;
      misses.push(...score.results.filter((r) => !r.exact).map((r) => `${name}: ${r.label}→${r.text || '∅'}`));
    }
    expect(exact, misses.join('\n')).toBeGreaterThanOrEqual(MIN_EXACT_SHARE * total);
  });

  it('puts the expected pinyin under every KKM dish it reads', () => {
    const tokens = annotate(scans[KKM]).flatMap((l) => l.tokens);
    let checked = 0;
    for (const [dish, expected] of Object.entries(labels[KKM].pinyin)) {
      const token = tokens.find((t) => t.text.includes(dish));
      if (!token) continue;
      const at = token.text.indexOf(dish);
      expect(token.chars.slice(at, at + dish.length).map((c) => c.pinyin).join(' '), dish).toBe(expected);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('places character quads inside their line, in reading order, on every fixture', () => {
    for (const lines of Object.values(scans)) expectCharsInReadingOrder(lines, expect);
  });
});
