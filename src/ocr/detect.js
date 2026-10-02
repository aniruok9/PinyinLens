import {
  connectedComponents,
  convexHull,
  expandRect,
  minAreaRect,
  orderQuad,
  rectCorners,
  rectMeanScore,
  rowExtremes,
  shortSide,
} from './geometry.js';
import { resizeBilinear } from './image.js';

// PaddleOCR det NormalizeImage values, applied in plane order to a BGR image.
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Detector input size: long side scaled to `longSide`, each side rounded to a multiple of 32.
export function detInputSize(width, height, longSide) {
  const ratio = longSide / Math.max(width, height);
  return {
    width: Math.max(32, Math.round((width * ratio) / 32) * 32),
    height: Math.max(32, Math.round((height * ratio) / 32) * 32),
  };
}

// RGBA image → NCHW Float32Array with planes B, G, R (PaddleOCR decodes images as BGR).
export function toDetInput(image, width, height) {
  const src = image.width === width && image.height === height ? image : resizeBilinear(image, width, height);
  const d = src.data;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (d[p + 2] / 255 - DET_MEAN[0]) / DET_STD[0];
    out[plane + i] = (d[p + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
    out[2 * plane + i] = (d[p] / 255 - DET_MEAN[2]) / DET_STD[2];
  }
  return out;
}

// DB postprocess: detector probability map (width x height) → text boxes in the
// coordinates of `target` ({ width, height }, the image that was resized for detection).
// params: { thresh, boxThresh, unclipRatio, maxCandidates } from the model's official config.
// Returns [{ quad: [tl, tr, br, bl], score }] sorted top-to-bottom, then left-to-right.
export function dbPostprocess(prob, width, height, params, target) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = prob[i] > params.thresh ? 1 : 0;
  const sx = target.width / width;
  const sy = target.height / height;
  const boxes = [];
  // Matches PaddleOCR: maxCandidates caps the contours before any filtering.
  for (const pixels of connectedComponents(mask, width, height).slice(0, params.maxCandidates)) {
    const rect = minAreaRect(convexHull(rowExtremes(pixels, width)));
    if (!rect || shortSide(rect) < 3) continue;
    const score = rectMeanScore(prob, width, height, rect);
    if (score < params.boxThresh) continue;
    const expanded = expandRect(rect, params.unclipRatio);
    if (shortSide(expanded) < 5) continue;
    const quad = orderQuad(rectCorners(expanded)).map(([x, y]) => [
      clamp(Math.round(x * sx), 0, target.width),
      clamp(Math.round(y * sy), 0, target.height),
    ]);
    boxes.push({ quad, score });
  }
  return boxes.sort((a, b) => a.quad[0][1] - b.quad[0][1] || a.quad[0][0] - b.quad[0][0]);
}
