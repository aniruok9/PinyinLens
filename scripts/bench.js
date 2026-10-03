// Benchmarks every detector x recognizer x detection size on the labelled fixtures.
// Usage: node scripts/bench.js [--det=v4,v6-tiny] [--rec=v5] [--long=960,1280] [--runs=1] [--json=out.json]
// Timings are milliseconds per menu (mean over fixtures of each fixture's median scan) from this
// machine's single-threaded WASM: compare rows, don't read them as phone numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createOcr } from '../src/ocr/pipeline.js';
import { chooseConfig } from './lib/choose.js';
import { scoreRequired } from './lib/metrics.js';
import { loadDet, loadRec } from './lib/model-files.js';
import { ort } from './lib/ort-node.js';
import { loadPng } from './lib/png.js';
import { DET_MODELS, REC_MODELS } from './models.config.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const list = (value, all) => (value ? value.split(',') : all);
const dets = list(args.det, Object.keys(DET_MODELS));
const recs = list(args.rec, Object.keys(REC_MODELS));
const longSides = list(args.long, ['960']).map(Number);
const runs = Number(args.runs ?? 1);

const FIXTURES = new URL('../test/fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const fixtures = Object.entries(labels).map(([name, l]) => ({ name, image: loadPng(new URL(name, FIXTURES)), required: l.required }));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const mb = (bytes) => bytes / 1e6;

const rows = [];
for (const det of dets) {
  for (const rec of recs) {
    const d = loadDet(det);
    const r = loadRec(rec);
    const ocr = await createOcr({ ort, det: d.bytes, rec: r.bytes, charset: r.charset, detParams: d.params });
    for (const longSide of longSides) {
      const times = { det: [], rec: [], total: [] };
      let exact = 0;
      let required = 0;
      let cerSum = 0;
      const misses = [];
      for (const f of fixtures) {
        let result;
        const fixtureTimes = { det: [], rec: [], total: [] };
        for (let i = 0; i < runs; i++) {
          result = await ocr.scan(f.image, { longSide });
          for (const k of Object.keys(fixtureTimes)) fixtureTimes[k].push(result.timings[k]);
        }
        for (const k of Object.keys(times)) times[k].push(median(fixtureTimes[k]));
        const score = scoreRequired(f.required, result.lines);
        exact += score.exact;
        required += f.required.length;
        cerSum += score.meanCer * f.required.length;
        misses.push(...score.results.filter((x) => !x.exact).map((x) => `${x.label}→${x.text || '∅'}`));
      }
      rows.push({
        det,
        rec,
        longSide,
        downloadMB: mb(DET_MODELS[det].size + REC_MODELS[rec].size),
        exact,
        required,
        meanCer: cerSum / required,
        detMs: mean(times.det),
        recMs: mean(times.rec),
        totalMs: mean(times.total),
        misses,
      });
      console.error(`measured ${det} + ${rec} @ ${longSide}`);
    }
    await ocr.release();
  }
}

console.log('| det | rec | long side | models MB | exact | mean CER | det ms/menu | rec ms/menu | total ms/menu | misses |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.det} | ${r.rec} | ${r.longSide} | ${r.downloadMB.toFixed(1)} | ${r.exact}/${r.required} | ${r.meanCer.toFixed(3)} | ` +
      `${Math.round(r.detMs)} | ${Math.round(r.recMs)} | ${Math.round(r.totalMs)} | ${r.misses.join(', ')} |`,
  );
}
const choice = chooseConfig(rows);
console.log(
  choice
    ? `\nSelection rule picks: det=${choice.det} rec=${choice.rec} longSide=${choice.longSide}`
    : '\nNo configuration read 90% of the labelled phrases exactly.',
);
if (args.json) writeFileSync(args.json, JSON.stringify({ rows, choice }, null, 2));
