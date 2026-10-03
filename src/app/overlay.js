import { toScreen } from './view.js';

// Pinyin labels for annotated OCR lines, laid out in screen space (spec §7.2) and drawn on a
// device-pixel-ratio canvas, so they stay sharp at any zoom.

const GAP = 2; // px between a character and its label
const PAD = 2; // px of background strip around label text
export const labelFont = (size) => `600 ${size}px system-ui, -apple-system, sans-serif`;

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// lines: annotated lines (tokens → chars with pinyin and quad in content px, quads in reading
// orientation). measure(text, fontSize) → text width in px. Returns
// [{ text, fontSize, width, x, y, align }]: (x, y) is the label's top-centre for horizontal lines
// ('center') and its top-left for vertical lines ('left').
export function layoutLabels(lines, view, measure) {
  const labels = [];
  for (const line of lines) {
    for (const token of line.tokens) {
      if (!token.isCJK) continue;
      for (const { pinyin, quad } of token.chars) {
        if (!pinyin) continue;
        const [q0, q1, q2, q3] = quad.map((p) => toScreen(view, p));
        const along = dist(q0, q1); // reading direction
        const across = dist(q0, q3);
        const charW = line.vertical ? across : along;
        const charH = line.vertical ? along : across;
        let fontSize = 0.45 * charH;
        const maxWidth = (line.vertical ? 2 : 0.9) * charW;
        const natural = measure(pinyin, fontSize);
        if (natural > maxWidth) fontSize *= maxWidth / natural;
        const width = measure(pinyin, fontSize);
        if (line.vertical) {
          // Reading runs down the column; quad[0]→quad[1] is its right edge.
          labels.push({ text: pinyin, fontSize, width, x: Math.max(q0[0], q1[0]) + GAP, y: (q0[1] + q1[1]) / 2 - fontSize / 2, align: 'left' });
        } else {
          labels.push({ text: pinyin, fontSize, width, x: (q3[0] + q2[0]) / 2, y: Math.max(q3[1], q2[1]) + GAP, align: 'center' });
        }
      }
    }
  }
  return labels;
}

// Draws labels: white text on a translucent dark strip. ctx is already scaled for the DPR.
export function drawLabels(ctx, labels) {
  ctx.textBaseline = 'top';
  for (const label of labels) {
    const left = label.align === 'center' ? label.x - label.width / 2 : label.x;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(left - PAD, label.y - PAD, label.width + 2 * PAD, label.fontSize * 1.2 + 2 * PAD);
    ctx.font = labelFont(label.fontSize);
    ctx.textAlign = label.align;
    ctx.fillStyle = '#fff';
    ctx.fillText(label.text, label.x, label.y);
  }
}
