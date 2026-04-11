import Ocr from '@gutenye/ocr-browser';

let ocr = null;

const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/';
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

  // Create a blob URL from the current video frame (faster than dataURL)
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const url = URL.createObjectURL(blob);

  try {
    const results = await ocr.detect(url);

    // Library returns { text, mean, box: [[x,y]×4] } (4-corner polygon)
    return results.map((line) => {
      const box = line.box;
      if (!box || box.length < 4) return null;

      // Convert 4-point polygon to bounding rect
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
