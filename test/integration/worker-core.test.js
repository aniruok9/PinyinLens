import { describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { DEFAULT_CONFIG } from '../../scripts/models.config.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { annotate } from '../../src/text/annotate.js';
import { createWorkerCore } from '../../src/worker/core.js';

// Drives the worker's message handler exactly as the browser worker does, minus postMessage.
describe('worker core', () => {
  it('initialises from model bytes and answers scans with annotated lines', async () => {
    const handle = createWorkerCore({ ort, createOcr, annotate });
    const det = loadDet(DEFAULT_CONFIG.det);
    const rec = loadRec(DEFAULT_CONFIG.rec);
    const ready = await handle({
      type: 'init',
      id: 1,
      wasm: ort.env.wasm.wasmBinary,
      det: det.bytes,
      rec: rec.bytes,
      charset: rec.charset,
      detParams: det.params,
      longSide: DEFAULT_CONFIG.longSide,
    });
    expect(ready).toMatchObject({ type: 'ready', id: 1 });

    const image = loadPng(new URL('../fixtures/menu-kkm.png', import.meta.url));
    const reply = await handle({ type: 'scan', id: 2, width: image.width, height: image.height, data: image.data.buffer.slice(0) });
    expect(reply).toMatchObject({ type: 'result', id: 2 });
    const token = reply.lines.flatMap((l) => l.tokens).find((t) => t.text === '阿公可口面');
    expect(token.chars.map((c) => c.pinyin)).toEqual(['ā', 'gōng', 'kě', 'kǒu', 'miàn']);
    expect(reply.timings.total).toBeGreaterThan(0);
  });

  it('replies with an error instead of throwing', async () => {
    const handle = createWorkerCore({ ort, createOcr, annotate });
    expect(await handle({ type: 'scan', id: 7, width: 1, height: 1, data: new ArrayBuffer(4) })).toEqual({
      type: 'error',
      id: 7,
      message: 'OCR engine not initialised',
    });
    expect(await handle({ type: 'nope', id: 8 })).toMatchObject({ type: 'error', id: 8, message: 'Unknown message type: nope' });
  });
});
