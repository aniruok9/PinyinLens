// Candidate OCR models, pinned by immutable URL (tag or commit) and SHA-256.
// Detector params are copied from each model's official PaddleOCR inference.yml (spec §6.2).

const MS = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx';
const HF = 'https://huggingface.co/PaddlePaddle';
const V6_TINY_DET = `${HF}/PP-OCRv6_tiny_det_onnx/resolve/2ba1506c0380b8f0b03dd142459aac66d4421f6c`;
const V6_SMALL_DET = `${HF}/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62`;
const V6_TINY_REC = `${HF}/PP-OCRv6_tiny_rec_onnx/resolve/2612ab37152ae0a677521bae4e1e3d4fb4cf7c30`;
const V6_SMALL_REC = `${HF}/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513`;

const V4V5_DET_PARAMS = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, maxCandidates: 1000 };

export const DET_MODELS = {
  v4: {
    url: `${MS}/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx`,
    sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    size: 4745517,
    params: V4V5_DET_PARAMS,
  },
  v5: {
    url: `${MS}/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx`,
    sha256: '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae',
    size: 4819576,
    params: V4V5_DET_PARAMS,
  },
  'v6-tiny': {
    url: `${V6_TINY_DET}/inference.onnx`,
    sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8',
    size: 1780590,
    params: { thresh: 0.2, boxThresh: 0.4, unclipRatio: 1.4, maxCandidates: 3000 },
  },
  'v6-small': {
    url: `${V6_SMALL_DET}/inference.onnx`,
    sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
    size: 9880512,
    params: { thresh: 0.2, boxThresh: 0.45, unclipRatio: 1.4, maxCandidates: 3000 },
  },
};

export const REC_MODELS = {
  v4: {
    url: `${MS}/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx`,
    sha256: '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    size: 10857958,
    charset: { from: 'onnx-metadata', count: 6623 },
  },
  v5: {
    url: `${MS}/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx`,
    sha256: '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5',
    size: 16631306,
    charset: { from: 'onnx-metadata', count: 18383 },
  },
  'v6-tiny': {
    url: `${V6_TINY_REC}/inference.onnx`,
    sha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
    size: 4462639,
    charset: {
      from: 'inference-yml',
      url: `${V6_TINY_REC}/inference.yml`,
      sha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
      count: 6904,
    },
  },
  'v6-small': {
    url: `${V6_SMALL_REC}/inference.onnx`,
    sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    size: 21159378,
    charset: {
      from: 'inference-yml',
      url: `${V6_SMALL_REC}/inference.yml`,
      sha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
      count: 18708,
    },
  },
};

// The configuration the app ships by default: picked by scripts/bench.js on all labelled
// fixtures (docs/benchmarks/2026-10-03-ocr-models.md).
export const DEFAULT_CONFIG = { det: 'v6-tiny', rec: 'v6-tiny', longSide: 960 };

// Models deployed with the app (the default plus what `?det=&rec=` may switch to on a device).
export const SHIPPED = { det: ['v6-tiny', 'v6-small'], rec: ['v6-tiny', 'v6-small'] };
