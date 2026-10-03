import { describe, expect, it } from 'vitest';
import { cjkOnly, scoreRequired, substringDistance } from '../../scripts/lib/metrics.js';

describe('substringDistance', () => {
  it('finds the label anywhere inside the text', () => {
    expect(substringDistance('面粉粿', '辣椒板面幼面面粉粿')).toBe(0);
    expect(substringDistance('幼面', '辣椒板面幼面面粉粿')).toBe(0);
  });

  it('counts edits against the best-matching stretch of text', () => {
    expect(substringDistance('面粉粿', '辣椒板面幼面面粉棵')).toBe(1);
    expect(substringDistance('海鲜伊面', '海鲜面')).toBe(1);
    expect(substringDistance('阿公可口面', '阿公可口')).toBe(1);
  });

  it('costs the whole label when the text is empty', () => {
    expect(substringDistance('阿公', '')).toBe(2);
  });
});

describe('cjkOnly', () => {
  it('keeps only Chinese characters', () => {
    expect(cjkOnly('KKM 阿公可口面!')).toBe('阿公可口面');
  });
});

describe('scoreRequired', () => {
  const lines = [{ text: '辣椒板面 / 幼面 / 面粉粿' }, { text: 'Ah Gong Koka Noodle' }, { text: '阿公可口' }];

  it('counts a label as read when it appears verbatim inside any line', () => {
    const { exact, results } = scoreRequired(['面粉粿', '幼面', '阿公可口面'], lines);
    expect(exact).toBe(2);
    expect(results.map((r) => [r.label, r.exact, r.distance, r.text])).toEqual([
      ['面粉粿', true, 0, '辣椒板面幼面面粉粿'],
      ['幼面', true, 0, '辣椒板面幼面面粉粿'],
      ['阿公可口面', false, 1, '阿公可口'],
    ]);
  });

  it('averages CER over labels, capping a label with no match at 1', () => {
    const { meanCer, results } = scoreRequired(['阿公可口面', '龙虎会'], lines);
    expect(results[1]).toMatchObject({ text: '', cer: 1, exact: false });
    expect(meanCer).toBeCloseTo((1 / 5 + 1) / 2, 6);
  });

  it('scores no labels as mean CER 0, not NaN', () => {
    expect(scoreRequired([], lines)).toMatchObject({ exact: 0, meanCer: 0 });
  });
});
