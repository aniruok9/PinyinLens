const CJK = /[一-鿿]/;

export const cjkOnly = (text) => [...text].filter((c) => CJK.test(c)).join('');

// Edits needed to turn `label` into the best-matching stretch of `text` (semi-global edit
// distance: text before and after the stretch is free). 0 means the label appears verbatim.
export function substringDistance(label, text) {
  const s = [...label];
  const t = [...text];
  let prev = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return Math.min(...prev);
}

// Scores OCR output against labels that must be read. A label counts as read when it appears
// verbatim inside the CJK characters of some line (one line may hold several dishes). Otherwise
// its CER is the best line's edit distance over the label length, capped at 1. Extra lines are
// not penalised.
export function scoreRequired(required, lines) {
  const candidates = lines.map((l) => cjkOnly(l.text)).filter(Boolean);
  const results = required.map((label) => {
    const length = [...label].length;
    let best = { distance: length, text: '' };
    for (const text of candidates) {
      const distance = substringDistance(label, text);
      if (distance < best.distance) best = { distance, text };
    }
    return { label, text: best.text, distance: best.distance, cer: best.distance / length, exact: best.distance === 0 };
  });
  return {
    results,
    exact: results.filter((r) => r.exact).length,
    meanCer: results.length ? results.reduce((sum, r) => sum + r.cer, 0) / results.length : 0,
  };
}
