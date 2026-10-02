// Geometry for DB text-detection postprocessing. Reproduces what PaddleOCR's DBPostProcess
// gets from OpenCV (findContours, minAreaRect) and pyclipper (unclip), without either.
//
// A rect is { center: [x, y], u: [x, y], v: [x, y], halfU, halfV } where u and v are
// orthonormal axes: the four corners are center ± halfU·u ± halfV·v.

// 8-connected components of a binary mask (OpenCV findContours treats foreground as
// 8-connected). Returns one Int32Array of pixel indices (y * width + x) per component.
export function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const pixels = [];
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !visited[q]) {
            visited[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    components.push(Int32Array.from(pixels));
  }
  return components;
}

// The leftmost and rightmost pixel of each row: the convex hull of these equals the hull
// of the whole component, at a fraction of the points.
export function rowExtremes(pixels, width) {
  const rows = new Map();
  for (const p of pixels) {
    const x = p % width;
    const y = (p - x) / width;
    const row = rows.get(y);
    if (!row) rows.set(y, [x, x]);
    else {
      if (x < row[0]) row[0] = x;
      if (x > row[1]) row[1] = x;
    }
  }
  const points = [];
  for (const [y, [x0, x1]] of rows) {
    points.push([x0, y]);
    if (x1 !== x0) points.push([x1, y]);
  }
  return points;
}

// Andrew's monotone chain; drops duplicate and collinear points.
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Minimum-area enclosing rectangle (rotating calipers: one side lies on a hull edge).
// Returns null for degenerate hulls (fewer than 3 points).
export function minAreaRect(hull) {
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [px, py] of hull) {
      const pu = px * ux + py * uy;
      const pv = px * vx + py * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, minU, maxU, minV, maxV };
  }
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  return {
    center: [cu * best.ux + cv * best.vx, cu * best.uy + cv * best.vy],
    u: [best.ux, best.uy],
    v: [best.vx, best.vy],
    halfU: (best.maxU - best.minU) / 2,
    halfV: (best.maxV - best.minV) / 2,
  };
}

export const shortSide = (rect) => 2 * Math.min(rect.halfU, rect.halfV);

// PaddleOCR's unclip: offset the box outward by d = area * ratio / perimeter.
// For a rectangle the offset shape's min-area rect is exactly each side grown by d.
export function expandRect(rect, ratio) {
  const w = 2 * rect.halfU;
  const h = 2 * rect.halfV;
  const perimeter = 2 * (w + h);
  const d = perimeter > 0 ? (w * h * ratio) / perimeter : 0;
  return { ...rect, halfU: rect.halfU + d, halfV: rect.halfV + d };
}

export function rectCorners({ center: [cx, cy], u: [ux, uy], v: [vx, vy], halfU, halfV }) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([su, sv]) => [cx + su * halfU * ux + sv * halfV * vx, cy + su * halfU * uy + sv * halfV * vy]);
}

// [top-left, top-right, bottom-right, bottom-left], as PaddleOCR's get_mini_boxes orders them:
// the two leftmost points become TL/BL by y, the two rightmost TR/BR by y.
export function orderQuad(points) {
  const byX = [...points].sort((p, q) => p[0] - q[0]);
  const [tl, bl] = byX.slice(0, 2).sort((p, q) => p[1] - q[1]);
  const [tr, br] = byX.slice(2).sort((p, q) => p[1] - q[1]);
  return [tl, tr, br, bl];
}

// Mean of `prob` over the pixels inside the rect (PaddleOCR's box_score_fast).
export function rectMeanScore(prob, width, height, rect) {
  const corners = rectCorners(rect);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const {
    center: [cx, cy],
    u: [ux, uy],
    v: [vx, vy],
  } = rect;
  const limU = rect.halfU + 0.5;
  const limV = rect.halfV + 0.5;
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(dx * ux + dy * uy) <= limU && Math.abs(dx * vx + dy * vy) <= limV) {
        sum += prob[y * width + x];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}
