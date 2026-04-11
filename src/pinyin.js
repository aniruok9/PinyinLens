import { pinyin } from 'pinyin-pro';

// Match CJK Unified Ideographs (common Chinese characters)
const CJK_RE = /[\u4e00-\u9fff]/;

export function containsChinese(text) {
  return CJK_RE.test(text);
}

export function convertPinyin(chineseText) {
  return pinyin(chineseText);
}
