// Asserts that every character quad lies inside its line's quad (bbox, 2px tolerance) and that
// characters follow reading order: quad[0]->quad[1] is the reading axis for every line.
export function expectCharsInReadingOrder(lines, expect) {
  for (const line of lines) {
    const xs = line.quad.map((p) => p[0]);
    const ys = line.quad.map((p) => p[1]);
    const inside = ([x, y]) =>
      x >= Math.min(...xs) - 2 && x <= Math.max(...xs) + 2 && y >= Math.min(...ys) - 2 && y <= Math.max(...ys) + 2;
    const [start, end] = line.quad;
    const axis = [end[0] - start[0], end[1] - start[1]];
    const along = (q) => ((q[0][0] + q[2][0]) / 2) * axis[0] + ((q[0][1] + q[2][1]) / 2) * axis[1];
    line.chars.forEach((c, k) => {
      expect(c.quad.every(inside), `${line.text}[${k}] outside its line`).toBe(true);
      if (k > 0) expect(along(c.quad), `${line.text}[${k}] out of order`).toBeGreaterThan(along(line.chars[k - 1].quad));
    });
  }
}
