import { resizeBilinear, warpFrame } from './image.js';

export const REC_HEIGHT = 48;
const MIN_BATCH_WIDTH = 320;
const MAX_BATCH_WIDTH = 3200;

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Straightens a detected quad [tl, tr, br, bl] into an upright crop. Quads at least 1.5x
// taller than wide are read as vertical text and rotated 90° counter-clockwise, as
// PaddleOCR's get_rotate_crop_image does. `frame` maps crop pixel (x, y) to the source
// point origin + x*r + y*a, so positions in the crop can be mapped back.
export function cropLine(image, quad) {
  const [tl, tr, br, bl] = quad;
  const w = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
  const h = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))));
  const vertical = h >= 1.5 * w;
  const frame = vertical
    ? {
        origin: tr,
        r: [(bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h],
        a: [(tl[0] - tr[0]) / w, (tl[1] - tr[1]) / w],
        width: h,
        height: w,
      }
    : {
        origin: tl,
        r: [(tr[0] - tl[0]) / w, (tr[1] - tl[1]) / w],
        a: [(bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h],
        width: w,
        height: h,
      };
  return { image: warpFrame(image, frame), frame, vertical };
}

// Source-space quad [tl, tr, br, bl] (in reading orientation) of crop columns x0..x1.
export function frameQuad(frame, x0, x1) {
  const {
    origin: [ox, oy],
    r: [rx, ry],
    a: [ax, ay],
    height,
  } = frame;
  const at = (x, y) => [ox + x * rx + y * ax, oy + x * ry + y * ay];
  return [at(x0, 0), at(x1, 0), at(x1, height), at(x0, height)];
}

// Packs crops into one NCHW batch of height 48. Batch width = widest aspect ratio in the
// batch (at least 320, rounded up to a multiple of 8 so each output timestep covers exactly
// 8 pixels); each crop is resized to height 48 keeping its ratio and zero-padded on the right.
// Pixels are normalised (x/255 - 0.5) / 0.5 in B, G, R plane order.
export function buildRecBatch(crops) {
  // Multiply before dividing: 48 * (320 / 48) is 320.00000000000006 in floating point.
  let widest = 0;
  for (const c of crops) widest = Math.max(widest, (REC_HEIGHT * c.width) / c.height);
  const batchWidth = Math.min(MAX_BATCH_WIDTH, Math.max(MIN_BATCH_WIDTH, Math.ceil(widest / 8) * 8));
  const plane = REC_HEIGHT * batchWidth;
  const data = new Float32Array(crops.length * 3 * plane);
  const widths = crops.map((crop, n) => {
    const w = Math.max(1, Math.min(batchWidth, Math.ceil((REC_HEIGHT * crop.width) / crop.height)));
    const resized = resizeBilinear(crop, w, REC_HEIGHT);
    const base = n * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const o = base + y * batchWidth + x;
        data[o] = resized.data[p + 2] / 127.5 - 1;
        data[o + plane] = resized.data[p + 1] / 127.5 - 1;
        data[o + 2 * plane] = resized.data[p] / 127.5 - 1;
      }
    }
    return w;
  });
  return { data, dims: [crops.length, 3, REC_HEIGHT, batchWidth], widths };
}

// Greedy CTC decode of batch item `item` from softmax output probs [N, T, C].
// Class 0 is blank, class k (1..charset.length) is charset[k-1], the last class is a space.
// Each character records the timesteps it spans (t0..t1) and its first-timestep probability,
// which PaddleOCR averages into the line confidence.
export function ctcDecode(probs, item, T, C, charset) {
  const chars = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    const row = (item * T + t) * C;
    let best = 0;
    let bestP = probs[row];
    for (let k = 1; k < C; k++) {
      if (probs[row + k] > bestP) {
        bestP = probs[row + k];
        best = k;
      }
    }
    if (best !== 0) {
      if (best === prev) chars[chars.length - 1].t1 = t;
      else chars.push({ ch: best <= charset.length ? charset[best - 1] : ' ', t0: t, t1: t, prob: bestP });
    }
    prev = best;
  }
  const score = chars.length ? chars.reduce((sum, c) => sum + c.prob, 0) / chars.length : 0;
  return { text: chars.map((c) => c.ch).join(''), score, chars };
}

// Horizontal extent [x0, x1] of each decoded character, in crop pixels. Timestep t is
// centred at (t + 0.5) * batchWidth / T in the resized crop (resizedWidth wide); a character
// sits at the centre of its timesteps, and neighbours meet halfway between centres.
export function charSpans(chars, T, batchWidth, resizedWidth, cropWidth) {
  const scale = (batchWidth / T) * (cropWidth / resizedWidth);
  const centers = chars.map((c) => ((c.t0 + c.t1) / 2 + 0.5) * scale);
  const last = centers.length - 1;
  return centers.map((c, i) => {
    const left = i > 0 ? (centers[i - 1] + c) / 2 : last > 0 ? c - (centers[1] - c) / 2 : 0;
    const right = i < last ? (c + centers[i + 1]) / 2 : last > 0 ? c + (c - centers[i - 1]) / 2 : cropWidth;
    return [Math.max(0, left), Math.min(cropWidth, right)];
  });
}
