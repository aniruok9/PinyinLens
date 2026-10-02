import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { DEFAULT_CONFIG } from '../../scripts/models.config.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { annotate } from '../../src/text/annotate.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const NAME = 'menu-kkm.png';
const { det: detId, rec: recId, longSide } = DEFAULT_CONFIG;

// Spec success criterion 5, checked against the configuration the app ships.
describe(`shipped config: det ${detId}, rec ${recId}, long side ${longSide}`, () => {
  let ocr;
  let lines;

  beforeAll(async () => {
    const det = loadDet(detId);
    const rec = loadRec(recId);
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    ({ lines } = await ocr.scan(loadPng(new URL(NAME, FIXTURES)), { longSide }));
  });
  afterAll(() => ocr?.release());

  it('reads all 12 dish names exactly', () => {
    const score = scoreRequired(labels[NAME].required, lines);
    expect(score.exact, JSON.stringify(score.results, null, 1)).toBe(labels[NAME].required.length);
  });

  it('puts the expected pinyin under every dish', () => {
    const tokens = annotate(lines).flatMap((l) => l.tokens);
    for (const [dish, expected] of Object.entries(labels[NAME].pinyin)) {
      const token = tokens.find((t) => t.text === dish);
      expect(token, `no token reads ${dish}`).toBeDefined();
      expect(token.chars.map((c) => c.pinyin).join(' '), dish).toBe(expected);
    }
  });
});
