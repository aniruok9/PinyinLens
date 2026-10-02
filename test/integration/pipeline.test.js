import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { expectCharsInReadingOrder } from '../helpers/structure.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const NAME = 'menu-kkm.png';

// Baseline: the PP-OCRv4 pair. A correct pipeline reads 10 of the 12 dish names with it
// (measured while planning: it misses 海鲜可口面 and reads 面粉粿 as 面粉颗).
describe('pipeline on the menu fixture (v4 baseline)', () => {
  let ocr;
  let result;

  beforeAll(async () => {
    const det = loadDet('v4');
    const rec = loadRec('v4');
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    result = await ocr.scan(loadPng(new URL(NAME, FIXTURES)));
  });
  afterAll(() => ocr?.release());

  it('reads at least 10 of the 12 dish names exactly', () => {
    const score = scoreRequired(labels[NAME].required, result.lines);
    expect(score.exact, JSON.stringify(score.results, null, 1)).toBeGreaterThanOrEqual(10);
  });

  it('reports a timing for every stage', () => {
    for (const stage of ['prep', 'det', 'post', 'crop', 'rec', 'total']) {
      expect(result.timings[stage], stage).toBeGreaterThanOrEqual(0);
    }
  });

  it('places character quads inside their line, in reading order', () => {
    expectCharsInReadingOrder(result.lines, expect);
  });

  it('rejects a second scan while one is in flight, and release during a scan', async () => {
    const first = ocr.scan(loadPng(new URL(NAME, FIXTURES)));
    await expect(ocr.scan(loadPng(new URL(NAME, FIXTURES)))).rejects.toThrow('scan already in progress');
    await expect(ocr.release()).rejects.toThrow('scan already in progress');
    await first;
  });

  it('rejects an empty image with a clear message', async () => {
    await expect(ocr.scan({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).rejects.toThrow(
      'scan: image must be at least 1x1 pixels',
    );
  });
});
