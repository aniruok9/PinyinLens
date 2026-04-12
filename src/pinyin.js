import { pinyin } from 'pinyin-pro';

// Match CJK Unified Ideographs (common Chinese characters)
const CJK_RE = /[\u4e00-\u9fff]/;
const CJK_RUN = /[\u4e00-\u9fff]+/g;

export function containsChinese(text) {
  return CJK_RE.test(text);
}

export function convertPinyin(chineseText) {
  return pinyin(chineseText);
}

// CJK characters are fullwidth (~2x width of Latin characters).
// Weight them accordingly for proportional positioning within a bounding box.
function charWeight(ch) {
  return CJK_RE.test(ch) ? 2 : 1;
}

// Split OCR text into CJK groups, convert each to pinyin independently
// (preserves polyphonic disambiguation within each group), and compute
// weighted character positions for accurate overlay placement.
export function splitAndConvert(text) {
  const groups = [];
  let match;
  CJK_RUN.lastIndex = 0;
  while ((match = CJK_RUN.exec(text)) !== null) {
    const chars = match[0];
    const pinyinArray = pinyin(chars, { type: 'array' });

    // Compute weighted offset of this group's first character
    let weightBefore = 0;
    for (let i = 0; i < match.index; i++) {
      weightBefore += charWeight(text[i]);
    }

    groups.push({
      chars,
      pinyin: pinyinArray,
      weightOffset: weightBefore,
    });
  }

  // Total weight of all characters for proportional positioning
  let totalWeight = 0;
  for (const ch of text) {
    totalWeight += charWeight(ch);
  }

  return { groups, totalWeight };
}
