import { pinyin } from 'pinyin-pro';

export function convertPinyin(chineseText) {
  return pinyin(chineseText);
}
