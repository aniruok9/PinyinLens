import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { createOcr } from '../../src/ocr/pipeline.js';

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
    await ocr.warmup();
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
    for (const line of result.lines) {
      const xs = line.quad.map((p) => p[0]);
      const ys = line.quad.map((p) => p[1]);
      const inside = ([x, y]) =>
        x >= Math.min(...xs) - 2 && x <= Math.max(...xs) + 2 && y >= Math.min(...ys) - 2 && y <= Math.max(...ys) + 2;
      const [tl, tr, , bl] = line.quad;
      const axis = line.vertical ? [bl[0] - tl[0], bl[1] - tl[1]] : [tr[0] - tl[0], tr[1] - tl[1]];
      const along = (q) => ((q[0][0] + q[2][0]) / 2) * axis[0] + ((q[0][1] + q[2][1]) / 2) * axis[1];
      line.chars.forEach((c, k) => {
        expect(c.quad.every(inside), `${line.text}[${k}] outside its line`).toBe(true);
        if (k > 0) expect(along(c.quad), `${line.text}[${k}] out of order`).toBeGreaterThan(along(line.chars[k - 1].quad));
      });
    }
  });
});
