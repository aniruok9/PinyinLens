// OCR Web Worker — ONNX Runtime inference with PaddleOCR models
// TODO: Load det.onnx and rec.onnx models, run detection + recognition pipeline

self.onmessage = async (e) => {
  if (e.data.type === 'detect') {
    const bitmap = e.data.bitmap;
    // TODO: Implement detection + recognition pipeline
    // 1. Downsample bitmap to 640x480
    // 2. Run PP-OCRv3 detection model → bounding boxes
    // 3. Crop detected regions
    // 4. Run PP-OCRv4 recognition model → text strings
    // 5. Post results back

    bitmap.close();

    self.postMessage({
      type: 'result',
      regions: [],
    });
  }
};

// Signal ready after model loading
// TODO: Load ONNX models here
self.postMessage({ type: 'ready' });
