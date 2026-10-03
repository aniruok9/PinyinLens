// The OCR worker's message handler, kept apart from `self` so Node tests can drive it.
//   { type: 'init', id, wasm, det, rec, charset, detParams, longSide } → { type: 'ready', id, ms }
//   { type: 'scan', id, width, height, data }                           → { type: 'result', id, lines, timings }
// Any failure replies { type: 'error', id, message }. `lines` are annotated (tokens with pinyin).
export function createWorkerCore({ ort, createOcr, annotate }) {
  let ocr = null;
  let longSide = 960;

  async function handle(message) {
    if (message.type === 'init') {
      const start = performance.now();
      ort.env.wasm.wasmBinary = message.wasm;
      ort.env.wasm.numThreads = 1;
      await ocr?.release();
      ocr = await createOcr({
        ort,
        det: message.det,
        rec: message.rec,
        charset: message.charset,
        detParams: message.detParams,
      });
      longSide = message.longSide;
      return { type: 'ready', ms: performance.now() - start };
    }
    if (message.type === 'scan') {
      if (!ocr) throw new Error('OCR engine not initialised');
      const image = { data: new Uint8ClampedArray(message.data), width: message.width, height: message.height };
      const { lines, timings } = await ocr.scan(image, { longSide });
      return { type: 'result', lines: annotate(lines), timings };
    }
    throw new Error(`Unknown message type: ${message.type}`);
  }

  return async (message) => {
    try {
      return { id: message.id, ...(await handle(message)) };
    } catch (err) {
      return { type: 'error', id: message.id, message: err.message };
    }
  };
}
