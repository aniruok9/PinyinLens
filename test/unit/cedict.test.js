import { describe, expect, it } from 'vitest';
import { compactDictionary, markPinyin, markSyllable, parseLine } from '../../scripts/lib/cedict.js';

describe('markSyllable', () => {
  it('puts the tone on a or e first, then on the o of "ou", otherwise on the last vowel', () => {
    expect(['ma1', 'he2', 'kou3', 'gui4', 'xiu1', 'lüe4'].map(markSyllable)).toEqual(['mā', 'hé', 'kǒu', 'guì', 'xiū', 'lüè']);
  });

  it('writes u: as ü, keeps capitals, and leaves neutral tones and vowel-less syllables unmarked', () => {
    expect(['lu:4', 'nu:3', 'Hai3', 'ma5', 'r5', 'm2'].map(markSyllable)).toEqual(['lǜ', 'nǚ', 'Hǎi', 'ma', 'r', 'm']);
  });
});

describe('markPinyin', () => {
  it('converts every syllable', () => {
    expect(markPinyin('ke3 kou3')).toBe('kě kǒu');
  });
});

describe('parseLine', () => {
  it('splits a dictionary line into forms, tone-marked pinyin and glosses', () => {
    expect(parseLine('可口 可口 [ke3 kou3] /tasty; to taste good/')).toEqual({
      traditional: '可口',
      simplified: '可口',
      pinyin: 'kě kǒu',
      glosses: ['tasty; to taste good'],
    });
  });

  it('ignores comments and malformed lines', () => {
    expect(parseLine('#! version=1')).toBeNull();
    expect(parseLine('')).toBeNull();
  });
});

describe('compactDictionary', () => {
  it('keeps simplified forms and at most three glosses, dropping cross-references and entries made only of them', () => {
    const text = [
      '# CC-CEDICT',
      '麵 面 [mian4] /flour/noodles/(of food) soft (not crunchy)/(of a person) slow; sluggish/',
      '麪 面 [mian4] /variant of 麵|面[mian4]/',
      '行 行 [xing2] /to walk; to go/see also 行[hang2]/',
      '',
    ].join('\n');
    expect(compactDictionary(text)).toBe(
      ['面\tmiàn\tflour/noodles/(of food) soft (not crunchy)', '行\txíng\tto walk; to go', ''].join('\n'),
    );
  });
});
