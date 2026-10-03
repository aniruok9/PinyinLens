import * as ort from 'onnxruntime-web/wasm';
import { createOcr } from '../ocr/pipeline.js';
import { annotate } from '../text/annotate.js';
import { createWorkerCore } from './core.js';

const handle = createWorkerCore({ ort, createOcr, annotate });

self.onmessage = async ({ data }) => {
  self.postMessage(await handle(data));
};
