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
export async function createOcr({ ort, det, rec, charset, detParams, dropScore = 0.5 }) {
  const detSession = await ort.InferenceSession.create(det, SESSION_OPTIONS);
  const recSession = await ort.InferenceSession.create(rec, SESSION_OPTIONS);

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

  // Runs both models once on tiny inputs so the first real scan doesn't pay ORT's lazy setup.
  async function warmup() {
    await runDet(new Float32Array(3 * 32 * 32), 32, 32);
    await runRec({ data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] });
  }

  // image: RGBA { data, width, height }. Returns { lines, timings } with all coordinates in
  // image pixels. Line: { quad, vertical, score, text, chars: [{ ch, prob, quad }] }.
  async function scan(image, { longSide = 960 } = {}) {
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
        quad: boxes[i].quad,
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
    await detSession.release();
    await recSession.release();
  }

  return { scan, warmup, release };
}
