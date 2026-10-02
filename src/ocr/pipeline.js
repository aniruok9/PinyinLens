import { dbPostprocess, detInputSize, toDetInput } from './detect.js';
import { buildRecBatch, charSpans, cropLine, ctcDecode, frameQuad } from './recognize.js';

const SESSION_OPTIONS = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
const now = () => performance.now();

// Creates an OCR engine.
//   ort:       an onnxruntime-web module whose env is already configured (wasmBinary, numThreads)
//   det, rec:  model bytes (Uint8Array / ArrayBuffer)
//   charset:   recognizer characters (class k = charset[k-1])
//   detParams: { thresh, boxThresh, unclipRatio, maxCandidates } from scripts/models.config.js
//   dropScore: lines with lower mean confidence are discarded (PaddleOCR default 0.5)
// Resolves to { scan, release } after a warm-up run of both models (so ORT's lazy setup is paid
// here, and a recognizer/charset mismatch fails at creation). Any failure releases both sessions.
export async function createOcr({ ort, det, rec, charset, detParams, dropScore = 0.5 }) {
  const detSession = await ort.InferenceSession.create(det, SESSION_OPTIONS);
  let recSession;
  try {
    recSession = await ort.InferenceSession.create(rec, SESSION_OPTIONS);
  } catch (err) {
    await detSession.release();
    throw err;
  }

  async function runDet(input, width, height) {
    const feeds = { [detSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) };
    const out = await detSession.run(feeds);
    return out[detSession.outputNames[0]].data;
  }

  async function runRec({ data, dims }) {
    const out = await recSession.run({ [recSession.inputNames[0]]: new ort.Tensor('float32', data, dims) });
    const tensor = out[recSession.outputNames[0]];
    const [, T, C] = tensor.dims;
    if (C !== charset.length + 2) {
      throw new Error(`Recognizer outputs ${C} classes; charset has ${charset.length} (expected charset + 2)`);
    }
    return { probs: tensor.data, T, C };
  }

  async function warmup() {
    await runDet(new Float32Array(3 * 32 * 32), 32, 32);
    await runRec({ data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] });
  }

  // image: RGBA { data, width, height }. Returns { lines, timings } with all coordinates in
  // image pixels. Line: { quad, vertical, score, text, chars: [{ ch, prob, quad }] }.
  // Line and char quads share one convention: [start-top, end-top, end-bottom, start-bottom],
  // start->end being the reading direction and "top" the crop's top edge. Horizontal lines are
  // image TL,TR,BR,BL; for vertical lines quad[0]->quad[1] runs down the column's right edge.
  let scanning = false;
  async function scan(image, opts) {
    if (scanning) throw new Error('scan already in progress');
    if (!(image.width >= 1 && image.height >= 1)) throw new Error('scan: image must be at least 1x1 pixels');
    scanning = true;
    try {
      return await scanImage(image, opts);
    } finally {
      scanning = false;
    }
  }

  async function scanImage(image, { longSide = 960 } = {}) {
    const timings = {};
    let t = now();
    const size = detInputSize(image.width, image.height, longSide);
    const input = toDetInput(image, size.width, size.height);
    timings.prep = now() - t;

    t = now();
    const prob = await runDet(input, size.width, size.height);
    timings.det = now() - t;

    t = now();
    const boxes = dbPostprocess(prob, size.width, size.height, detParams, image);
    timings.post = now() - t;

    t = now();
    const crops = boxes.map((b) => cropLine(image, b.quad));
    timings.crop = now() - t;

    // One line per inference: on single-threaded WASM, batching only adds padding
    // (measured 4-23% slower than batch size 1, identical accuracy).
    t = now();
    const lines = [];
    for (let i = 0; i < crops.length; i++) {
      const { image: crop, frame, vertical } = crops[i];
      const batch = buildRecBatch([crop]);
      const { probs, T, C } = await runRec(batch);
      const decoded = ctcDecode(probs, 0, T, C, charset);
      const spans = charSpans(decoded.chars, T, batch.dims[3], batch.widths[0], crop.width);
      lines.push({
        quad: frameQuad(frame, 0, crop.width),
        vertical,
        score: decoded.score,
        text: decoded.text,
        chars: decoded.chars.map((c, k) => ({ ch: c.ch, prob: c.prob, quad: frameQuad(frame, ...spans[k]) })),
      });
    }
    timings.rec = now() - t;
    timings.total = timings.prep + timings.det + timings.post + timings.crop + timings.rec;

    return { lines: lines.filter((l) => l.score >= dropScore && l.text.trim() !== ''), timings };
  }

  async function release() {
    if (scanning) throw new Error('release: scan already in progress');
    let first;
    try {
      await detSession.release();
    } catch (err) {
      first = err;
    }
    try {
      await recSession.release();
    } catch (err) {
      first ??= err;
    }
    if (first) throw first;
  }

  try {
    await warmup();
  } catch (err) {
    await release().catch(() => {});
    throw err;
  }
  return { scan, release };
}
