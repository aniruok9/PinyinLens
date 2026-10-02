import { describe, expect, it } from 'vitest';
import { cjkOnly, levenshtein, scoreRequired } from '../../scripts/lib/metrics.js';

describe('levenshtein', () => {
  it('counts insertions, deletions and substitutions by character', () => {
    expect(levenshtein('面粉粿', '面粉粿')).toBe(0);
    expect(levenshtein('面粉粿', '面粉棵')).toBe(1);
    expect(levenshtein('海鲜伊面', '海鲜面')).toBe(1);
    expect(levenshtein('', '阿公')).toBe(2);
  });
});

describe('cjkOnly', () => {
  it('keeps only Chinese characters', () => {
    expect(cjkOnly('KKM 阿公可口面!')).toBe('阿公可口面');
  });
});

describe('scoreRequired', () => {
  const lines = [{ text: '阿公可口面' }, { text: 'Ah Gong Koka Noodle' }, { text: '面粉棵' }];

  it('matches each label to its closest line and reports exact matches and mean CER', () => {
    const { exact, meanCer, results } = scoreRequired(['阿公可口面', '面粉粿', '海鲜伊面'], lines);
    expect(exact).toBe(1);
    expect(results.map((r) => [r.text, r.exact])).toEqual([
      ['阿公可口面', true],
      ['面粉棵', false],
      ['', false],
    ]);
    expect(meanCer).toBeCloseTo((0 + 1 / 3 + 1) / 3, 6);
  });

  it('scores no labels as mean CER 0, not NaN', () => {
    expect(scoreRequired([], lines)).toMatchObject({ exact: 0, meanCer: 0 });
  });
});
