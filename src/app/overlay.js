import { toScreen } from './view.js';

// Pinyin labels for annotated OCR lines (spec §7.2). Where each line's labels go is decided once
// per scan (placeLabels, in image px), so that where there is room they cover no other line's
// characters; they are laid out for the current view and drawn on every redraw, on a
// device-pixel-ratio canvas, so they stay sharp at any zoom. Every size is proportional to the
// characters, so a placement holds at every zoom.

const GAP = 0.15; // em between a character and its label
const PAD = 0.15; // em of background strip around label text
const LINE = 1.2; // em: height of a label's text
const HALO = 0.25; // em: outline width of a label drawn without a strip
const MIN_SCALE = 0.5; // smallest a crowded line's labels shrink before they overlap instead
const SCALE_STEP = 0.05;
export const labelFont = (size) => `600 ${size}px system-ui, -apple-system, sans-serif`;

const NATURAL = { side: 'after', scale: 1, halo: false };
const IDENTITY = { scale: 1, tx: 0, ty: 0 };

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const bounds = (points) => ({
  x0: Math.min(...points.map((p) => p[0])),
  x1: Math.max(...points.map((p) => p[0])),
  y0: Math.min(...points.map((p) => p[1])),
  y1: Math.max(...points.map((p) => p[1])),
});

// The labels of line number `l` for `view`, with placement { side, scale, halo }: side 'after' is
// below a horizontal line or right of a vertical one, 'before' is above or left.
function lineLabels(line, l, view, measure, { side, scale, halo }) {
  const labels = [];
  for (const token of line.tokens) {
    if (!token.isCJK) continue;
    for (const { pinyin, quad } of token.chars) {
      if (!pinyin) continue;
      const [q0, q1, q2, q3] = quad.map((p) => toScreen(view, p));
      const along = dist(q0, q1); // reading direction
      const across = dist(q0, q3);
      const charW = line.vertical ? across : along;
      const charH = line.vertical ? along : across;
      let fontSize = 0.45 * charH * scale;
      const maxWidth = (line.vertical ? 2 : 0.9) * charW;
      const natural = measure(pinyin, fontSize);
      if (natural > maxWidth) fontSize *= maxWidth / natural;
      const width = measure(pinyin, fontSize);
      const gap = GAP * fontSize;
      const label = { line: l, text: pinyin, fontSize, width, halo };
      if (line.vertical) {
        // Reading runs down the column: quad[0]→quad[1] is its right edge, quad[3]→quad[2] its left.
        const x = side === 'after' ? Math.max(q0[0], q1[0]) + gap : Math.min(q2[0], q3[0]) - gap - width;
        labels.push({ ...label, x, y: (q0[1] + q1[1]) / 2 - fontSize / 2, align: 'left' });
      } else {
        const x = side === 'after' ? (q3[0] + q2[0]) / 2 : (q0[0] + q1[0]) / 2;
        const y = side === 'after' ? Math.max(q3[1], q2[1]) + gap : Math.min(q0[1], q1[1]) - gap - LINE * fontSize;
        labels.push({ ...label, x, y, align: 'center' });
      }
    }
  }
  return labels;
}

// lines: annotated lines (tokens → chars with pinyin and quad in content px, quads in reading
// orientation). measure(text, fontSize) → text width in px. placements: placeLabels' result
// (missing lines go below). Returns [{ line, text, fontSize, width, x, y, align, halo }]: (x, y) is
// the label's top-centre for horizontal lines ('center') and its top-left for vertical ones ('left').
export function layoutLabels(lines, view, measure, placements = []) {
  return lines.flatMap((line, l) => lineLabels(line, l, view, measure, placements[l] ?? NATURAL));
}

// The area a label's strip covers (also its footprint when placing labels).
export function labelBox({ x, y, width, fontSize, align }) {
  const left = align === 'center' ? x - width / 2 : x;
  const pad = PAD * fontSize;
  return { x0: left - pad, y0: y - pad, x1: left + width + pad, y1: y + LINE * fontSize + pad };
}

// Where each line's labels go, one { side, scale, halo } per line, chosen in image px: below the line
// (right of a vertical one) if the labels stay on the photo (width × height) and cover no other
// line's Chinese characters and no labels placed earlier, else above (left), else shrunk until they
// fit on either side, down to MIN_SCALE; failing all that, at full size below (or above, if below is
// off the photo), outlined instead of on a strip so that the characters underneath stay readable.
// Lines are placed top to bottom, so a gap between two lines holds only one line's labels, and all
// of a line's labels share one placement.
export function placeLabels(lines, measure, { width = Infinity, height = Infinity } = {}) {
  const onPhoto = (b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= width && b.y1 <= height;
  const chars = lines.map((line) => line.tokens.filter((t) => t.isCJK).flatMap((t) => t.chars.map((c) => bounds(c.quad))));
  const tries = [{ side: 'after', scale: 1 }, { side: 'before', scale: 1 }];
  for (let k = 1; 1 - k * SCALE_STEP >= MIN_SCALE - 1e-9; k++) {
    for (const side of ['after', 'before']) tries.push({ side, scale: 1 - k * SCALE_STEP });
  }
  const placements = lines.map(() => NATURAL);
  const placed = []; // boxes of the labels placed so far
  const order = lines
    .map((line, l) => ({ l, box: bounds(line.tokens.flatMap((t) => t.chars.flatMap((c) => c.quad))) }))
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  for (const { l, box } of order) {
    const line = lines[l];
    // Labels never reach further than about two characters from their line.
    const reach = 2.5 * Math.max(0, ...chars[l].map((c) => Math.max(c.x1 - c.x0, c.y1 - c.y0)));
    const zone = { x0: box.x0 - reach, y0: box.y0 - reach, x1: box.x1 + reach, y1: box.y1 + reach };
    const obstacles = [...chars.flatMap((c, other) => (other === l ? [] : c)), ...placed].filter((o) => overlaps(o, zone));
    const boxes = (placement) => lineLabels(line, l, IDENTITY, measure, placement).map(labelBox);
    const free = (placement) => boxes(placement).every((b) => onPhoto(b) && !obstacles.some((o) => overlaps(b, o)));
    const outlined = ['after', 'before'].map((side) => ({ side, scale: 1, halo: true }));
    const placement =
      tries.map((attempt) => ({ ...attempt, halo: false })).find(free) ??
      outlined.find((p) => boxes(p).every(onPhoto)) ??
      outlined[0];
    placements[l] = placement;
    placed.push(...lineLabels(line, l, IDENTITY, measure, placement).map(labelBox));
  }
  return placements;
}

// Draws labels: white text on a translucent dark strip, or, for labels that overlap other text,
// outlined white text with no strip. ctx is already scaled for the DPR.
export function drawLabels(ctx, labels) {
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  for (const label of labels) {
    ctx.font = labelFont(label.fontSize);
    ctx.textAlign = label.align;
    if (label.halo) {
      ctx.lineWidth = HALO * label.fontSize;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeText(label.text, label.x, label.y);
    } else {
      const box = labelBox(label);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(label.text, label.x, label.y);
  }
}

// Outlines the tapped word (spec §7.2): one box from its first character's leading edge to its
// last character's trailing edge, in reading orientation. quads are content px.
export function drawHighlight(ctx, quads, view) {
  if (!quads.length) return;
  const first = quads[0].map((p) => toScreen(view, p));
  const last = quads[quads.length - 1].map((p) => toScreen(view, p));
  const outline = [first[0], last[1], last[2], first[3]];
  ctx.beginPath();
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#4fc3f7';
  ctx.stroke();
}
