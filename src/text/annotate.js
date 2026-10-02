import { pinyin } from 'pinyin-pro';

const CJK = /[一-鿿]/;
export const isCJK = (ch) => CJK.test(ch);

// Splits a recognized line into tokens: maximal runs of CJK / non-CJK characters.
// Each CJK run is converted on its own, so pinyin-pro uses word context inside the run
// (e.g. one dish name) but never across runs (e.g. two dishes on one row).
export function annotateLine(line) {
  const tokens = [];
  const { chars } = line;
  let i = 0;
  while (i < chars.length) {
    const cjk = isCJK(chars[i].ch);
    let j = i;
    while (j < chars.length && isCJK(chars[j].ch) === cjk) j++;
    const run = chars.slice(i, j);
    const text = run.map((c) => c.ch).join('');
    const readings = cjk ? pinyin(text, { type: 'array' }) : null;
    tokens.push({
      text,
      isCJK: cjk,
      // pinyin-pro echoes back rare hanzi it has no reading for; that is not pinyin.
      chars: run.map((c, k) => ({
        ch: c.ch,
        pinyin: cjk && readings[k] !== c.ch ? readings[k] : null,
        quad: c.quad,
      })),
    });
    i = j;
  }
  return { quad: line.quad, vertical: line.vertical, score: line.score, text: line.text, tokens };
}

// Annotates OCR lines (output of scan) and drops lines with no Chinese characters.
export function annotate(lines) {
  return lines.filter((l) => l.chars.some((c) => isCJK(c.ch))).map(annotateLine);
}
