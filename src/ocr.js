import Ocr from '@gutenye/ocr-browser';

let ocr = null;

const MODEL_BASE = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/';
const MODELS = {
  detectionPath: `${MODEL_BASE}ch_PP-OCRv4_det_infer.onnx`,
  recognitionPath: `${MODEL_BASE}ch_PP-OCRv4_rec_infer.onnx`,
  dictionaryPath: `${MODEL_BASE}ppocr_keys_v1.txt`,
};

export async function initOCR(onProgress) {
  onProgress?.(0, 'Loading OCR models...');
  ocr = await Ocr.create({ models: MODELS });
  onProgress?.(100, 'OCR ready');
}

export async function detectText(videoElement) {
  if (!ocr) return [];

  // Draw current frame to a temporary canvas to get a URL for the library
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  const results = await ocr.detect(dataUrl);

  return results.map((line) => ({
    text: line.text,
    score: line.score,
    box: {
      x: line.frame.left,
      y: line.frame.top,
      width: line.frame.width,
      height: line.frame.height,
    },
  }));
}
