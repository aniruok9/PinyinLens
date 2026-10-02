const CJK = /[一-鿿]/;

export function levenshtein(a, b) {
  const s = [...a];
  const t = [...b];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

export const cjkOnly = (text) => [...text].filter((c) => CJK.test(c)).join('');

// Scores OCR output against labels that must be read. Each label is matched to the line
// whose CJK characters have the lowest character error rate (CER) against it; unmatched
// labels score CER 1. Extra lines are not penalised.
export function scoreRequired(required, lines) {
  const candidates = lines.map((l) => cjkOnly(l.text)).filter(Boolean);
  const results = required.map((label) => {
    let best = { cer: 1, text: '' };
    for (const text of candidates) {
      const cer = levenshtein(label, text) / [...label].length;
      if (cer < best.cer) best = { cer, text };
    }
    return { label, text: best.text, cer: best.cer, exact: best.text === label };
  });
  return {
    results,
    exact: results.filter((r) => r.exact).length,
    meanCer: results.reduce((sum, r) => sum + r.cer, 0) / results.length,
  };
}
