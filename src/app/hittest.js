import { toScreen } from './view.js';

// Which Chinese character a tap on the frozen scan lands on (spec §7.4).

const MIN_REACH = 22; // px: half of a 44px touch target, so tiny text is still tappable

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// Point inside (or on the edge of) a convex quad whose corners are in order.
function inside(quad, point) {
  const signs = quad.map((corner, i) => Math.sign(cross(corner, quad[(i + 1) % 4], point)));
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
}

// The CJK character under screen point (x, y) for annotated lines shown with `view`, as
// { line, token, char } indices, or null. A character contains the point, or else the closest
// character centre within one character size (at least MIN_REACH) wins: fingers are wider than text.
export function charAt(lines, view, x, y) {
  let best = null;
  for (const [l, line] of lines.entries()) {
    for (const [t, token] of line.tokens.entries()) {
      if (!token.isCJK) continue;
      for (const [c, ch] of token.chars.entries()) {
        const quad = ch.quad.map((p) => toScreen(view, p));
        if (inside(quad, [x, y])) return { line: l, token: t, char: c };
        const centre = [(quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2];
        const reach = Math.max(dist(quad[0], quad[1]), dist(quad[0], quad[3]), MIN_REACH);
        const d = dist(centre, [x, y]);
        if (d <= reach && (!best || d < best.d)) best = { d, hit: { line: l, token: t, char: c } };
      }
    }
  }
  return best?.hit ?? null;
}
