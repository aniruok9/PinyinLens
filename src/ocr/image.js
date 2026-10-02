// Pure-JS operations on RGBA images { data: Uint8ClampedArray, width, height }.
// No DOM, so the same code runs in a Worker and in Node.

export function createImage(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

// Writes the bilinear blend of the 4 source pixels around (x0..x1, y0..y1) into d[o..o+3].
function blendInto(s, sw, x0, x1, y0, y1, fx, fy, d, o) {
  const i00 = (y0 * sw + x0) * 4;
  const i01 = (y0 * sw + x1) * 4;
  const i10 = (y1 * sw + x0) * 4;
  const i11 = (y1 * sw + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = s[i00 + c] + (s[i01 + c] - s[i00 + c]) * fx;
    const bottom = s[i10 + c] + (s[i11 + c] - s[i10 + c]) * fx;
    d[o + c] = top + (bottom - top) * fy;
  }
}

// Bilinear resize with half-pixel centres (cv2.resize INTER_LINEAR convention).
export function resizeBilinear(src, dstWidth, dstHeight) {
  const { data: s, width: sw, height: sh } = src;
  const out = createImage(dstWidth, dstHeight);
  const d = out.data;
  const xRatio = sw / dstWidth;
  const yRatio = sh / dstHeight;
  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.max(0, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.min(Math.floor(sy), sh - 1);
    const y1 = Math.min(y0 + 1, sh - 1);
    const fy = sy - y0;
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.max(0, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.min(Math.floor(sx), sw - 1);
      const x1 = Math.min(x0 + 1, sw - 1);
      const fx = sx - x0;
      const o = (y * dstWidth + x) * 4;
      blendInto(s, sw, x0, x1, y0, y1, fx, fy, d, o);
    }
  }
  return out;
}

// Samples an upright image from a parallelogram of `src`:
// output pixel (x, y) reads source point origin + x*r + y*a (bilinear, edges replicated;
// pixel centres at integer coordinates, as in cv2.warpPerspective).
// frame: { origin: [x, y], r: [dx, dy], a: [dx, dy], width, height }
export function warpFrame(src, frame) {
  const { data: s, width: sw, height: sh } = src;
  const { origin, r, a, width, height } = frame;
  const out = createImage(width, height);
  const d = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(Math.max(origin[0] + x * r[0] + y * a[0], 0), sw - 1);
      const sy = Math.min(Math.max(origin[1] + x * r[1] + y * a[1], 0), sh - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * width + x) * 4;
      blendInto(s, sw, x0, x1, y0, y1, fx, fy, d, o);
    }
  }
  return out;
}
