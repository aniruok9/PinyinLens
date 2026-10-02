import { describe, expect, it } from 'vitest';
import { annotate, annotateLine } from '../../src/text/annotate.js';

// A line whose characters sit in consecutive 10px cells.
function line(text, extra = {}) {
  const chars = [...text].map((ch, i) => ({
    ch,
    prob: 0.9,
    quad: [
      [i * 10, 0],
      [i * 10 + 10, 0],
      [i * 10 + 10, 20],
      [i * 10, 20],
    ],
  }));
  return { quad: [[0, 0], [chars.length * 10, 0], [chars.length * 10, 20], [0, 20]], vertical: false, score: 0.9, text, chars, ...extra };
}
const pinyinOf = (token) => token.chars.map((c) => c.pinyin);

describe('annotateLine', () => {
  it('gives each CJK character its tone-marked pinyin and keeps its quad', () => {
    const [token] = annotateLine(line('阿公可口面')).tokens;
    expect(token.text).toBe('阿公可口面');
    expect(token.isCJK).toBe(true);
    expect(pinyinOf(token)).toEqual(['ā', 'gōng', 'kě', 'kǒu', 'miàn']);
    expect(token.chars[2].quad[0]).toEqual([20, 0]);
  });

  it('splits CJK and non-CJK runs; non-CJK characters get no pinyin', () => {
    const { tokens } = annotateLine(line('猪肉米粉 Pork'));
    expect(tokens.map((t) => [t.text, t.isCJK])).toEqual([
      ['猪肉米粉', true],
      [' Pork', false],
    ]);
    expect(pinyinOf(tokens[1])).toEqual([null, null, null, null, null]);
  });

  it('converts each run separately, so context never crosses runs', () => {
    const { tokens } = annotateLine(line('银行 行'));
    expect(pinyinOf(tokens[0])).toEqual(['yín', 'háng']);
    expect(pinyinOf(tokens[2])).toEqual(['xíng']);
  });

  it('carries the line geometry through', () => {
    const out = annotateLine(line('面', { vertical: true, score: 0.7 }));
    expect([out.vertical, out.score, out.text]).toEqual([true, 0.7, '面']);
  });
});

describe('annotate', () => {
  it('drops lines without Chinese', () => {
    expect(annotate([line('Seafood Koka Noodle'), line('海鲜伊面')]).map((l) => l.text)).toEqual(['海鲜伊面']);
  });
});
