import * as ort from 'onnxruntime-web';
import Ocr from '@gutenye/ocr-browser';

let ocr = null;

const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/';
const MODELS = {
  detectionPath: `${MODEL_BASE}ch_PP-OCRv4_det_infer.onnx`,
  recognitionPath: `${MODEL_BASE}ch_PP-OCRv4_rec_infer.onnx`,
  dictionaryPath: `${MODEL_BASE}ppocr_keys_v1.txt`,
};

export async function initOCR(onProgress) {
  // Point ONNX Runtime to the unhashed WASM files in public/
  ort.env.wasm.wasmPaths = import.meta.env.BASE_URL;

  // Disable WebGPU — use WASM backend for broadest compatibility
  // (Safari WebGPU causes memory leaks, Firefox lacks full support)
  ort.env.wasm.numThreads = crossOriginIsolated ? navigator.hardwareConcurrency || 4 : 1;

  onProgress?.(10, 'Loading detection model...');

  try {
    ocr = await Ocr.create({ models: MODELS });
  } catch (err) {
    throw new Error(`OCR init failed: ${err.message}`);
  }

  onProgress?.(100, 'OCR ready');
}

export async function detectText(videoElement) {
  if (!ocr) return [];

  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const url = URL.createObjectURL(blob);

  try {
    const results = await ocr.detect(url);

    return results.map((line) => {
      const box = line.box;
      if (!box || box.length < 4) return null;

      const xs = box.map((p) => p[0]);
      const ys = box.map((p) => p[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      return {
        text: line.text,
        score: line.mean,
        box: {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        },
      };
    }).filter(Boolean);
  } finally {
    URL.revokeObjectURL(url);
  }
}
