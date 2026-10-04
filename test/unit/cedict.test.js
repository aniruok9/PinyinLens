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

  it('writes references to other words as the simplified word and tone-marked pinyin', () => {
    const text = [
      '書 书 [shu1] /book/abbr. for 書經|书经[Shu1 jing1]/',
      '魚 鱼 [yu2] /used in the names of aquatic animals (including abalone 鮑魚|鲍鱼[bao4 yu2])/',
      '卡 卡 [ka3] /to block/also pr. [qia3]/',
      '一模一樣 一模一样 [yi1 mu2 yi1 yang4] /exactly alike/also pr. [yi1mo2-yi1yang4]/',
      '七夕 七夕 [Qi1 xi1] /the night when 牛郎織女|牛郎织女 meet/',
    ].join('\n');
    expect(compactDictionary(text).split('\n')).toEqual([
      '书\tshū\tbook/abbr. for 书经 (Shū jīng)',
      '鱼\tyú\tused in the names of aquatic animals (including abalone 鲍鱼 (bào yú))',
      '卡\tkǎ\tto block/also pr. [qiǎ]',
      '一模一样\tyī mú yī yàng\texactly alike/also pr. [yīmó-yīyàng]',
      '七夕\tQī xī\tthe night when 牛郎织女 meet',
      '',
    ]);
  });

  it('leaves out measure words, whether a gloss of their own or in brackets', () => {
    const text = ['飯 饭 [fan4] /cooked rice/CL:碗[wan3]/meal/', '魚 鱼 [yu2] /fish (CL:條|条[tiao2],尾[wei3])/'].join('\n');
    expect(compactDictionary(text)).toBe(['饭\tfàn\tcooked rice/meal', '鱼\tyú\tfish', ''].join('\n'));
  });

  it('drops an entry whose meanings all appear in another entry for the same word and reading', () => {
    const text = [
      '荳 豆 [dou4] /legume; pulse; bean; pea (CL:顆|颗[ke1],粒[li4]) (variant of 豆[dou4])/',
      '豆 豆 [dou4] /legume; pulse; bean; pea (CL:顆|颗[ke1],粒[li4])/(old) stemmed cup or bowl/',
      '面 面 [mian4] /face/side/',
      '麵 面 [mian4] /flour/noodles/',
    ].join('\n');
    expect(compactDictionary(text).split('\n')).toEqual([
      '豆\tdòu\tlegume; pulse; bean; pea/(old) stemmed cup or bowl',
      '面\tmiàn\tface/side',
      '面\tmiàn\tflour/noodles',
      '',
    ]);
  });
});
