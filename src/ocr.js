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
  //
  // Firefox: force single-threaded WASM. Multi-threaded WASM requires pthread Workers
  // (new Worker(url, { type: 'module' })) which are unreliable on Firefox Android —
  // the pthread init hangs, causing WASM backend initialization to never complete.
  //
  // WebKit (macOS Safari, iOS Safari, iOS Chrome/CriOS, iOS Firefox/FxiOS): force
  // single-threaded WASM. iOS tabs have a ~1–1.5GB memory ceiling enforced by the
  // WebKit out-of-process tab killer. Multi-threaded WASM allocates a per-thread
  // heap against a SharedArrayBuffer, which pushes ONNX Runtime over that ceiling
  // during recognition and gets the tab killed mid-OCR (symptom: page "reloads by
  // itself" while the shutter spinner is active, and the reloaded tab then hangs
  // on "Loading detection model..." because the pthread pool init never completes
  // after an OOM-killed predecessor). See CLAUDE.md "Safari/WebKit caveat".
  const ua = navigator.userAgent;
  const isFirefox = /Firefox\//i.test(ua);
  // AppleWebKit without "Chrome/" catches Safari + all iOS browsers (CriOS/FxiOS
  // don't carry "Chrome/"), while excluding desktop Chrome and Android Chrome.
  const isWebKit = /AppleWebKit\//.test(ua) && !/Chrome\//.test(ua);
  if (crossOriginIsolated && !isFirefox && !isWebKit) {
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
  } else {
    ort.env.wasm.numThreads = 1;
  }

  onProgress?.(10, 'Loading detection model...');

  try {
    ocr = await Ocr.create({ models: MODELS });
  } catch (err) {
    throw new Error(`OCR init failed: ${err.message}`);
  }

  onProgress?.(100, 'OCR ready');
}

// Reuse a single offscreen canvas for frame capture to avoid GC churn
let captureCanvas = null;
let captureCtx = null;

// Target width for OCR input — downsampling from 1920→640 gives ~9x fewer pixels,
// dramatically faster inference with minimal accuracy loss for text detection.
const OCR_TARGET_WIDTH = 640;

export async function detectText(videoElement) {
  if (!ocr) return [];

  const srcW = videoElement.videoWidth;
  const srcH = videoElement.videoHeight;
  if (!srcW || !srcH) return [];

  // Downsample to OCR_TARGET_WIDTH, preserving aspect ratio
  const scale = Math.min(1, OCR_TARGET_WIDTH / srcW);
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  if (!captureCanvas) {
    captureCanvas = document.createElement('canvas');
    captureCtx = captureCanvas.getContext('2d');
  }
  captureCanvas.width = dstW;
  captureCanvas.height = dstH;
  captureCtx.drawImage(videoElement, 0, 0, dstW, dstH);

  const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.6));
  const url = URL.createObjectURL(blob);

  // Inverse scale to map OCR coordinates back to full video resolution
  const invScale = 1 / scale;

  try {
    const results = await ocr.detect(url);

    return results.map((line) => {
      const box = line.box;
      if (!box || box.length < 4) return null;

      const xs = box.map((p) => p[0]);
      const ys = box.map((p) => p[1]);
      const minX = Math.min(...xs) * invScale;
      const minY = Math.min(...ys) * invScale;
      const maxX = Math.max(...xs) * invScale;
      const maxY = Math.max(...ys) * invScale;

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
