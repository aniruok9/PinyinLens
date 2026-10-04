import { describe, expect, it } from 'vitest';
import { createDictionary } from '../../src/text/dict.js';

const TSV = [
  '可口\tkě kǒu\ttasty; to taste good',
  '阿公\tā gōng\t(old) grandfather',
  '面\tmiàn\tface/side/surface',
  '面\tmiàn\tflour/noodles',
  '行\tháng\trow; line',
  '行\txíng\tto walk; to go',
  '银行\tyín háng\tbank',
  '口\tkǒu\tmouth',
  '',
].join('\n');

describe('createDictionary', () => {
  const dict = createDictionary(TSV);

  it('counts distinct words', () => {
    expect(dict.size).toBe(6);
  });

  it('segments a run into the longest dictionary words (forward maximum matching)', () => {
    expect(dict.segment('阿公可口面')).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
  });

  it('looks up the word containing the tapped character', () => {
    expect(dict.lookup('阿公可口面', 3, ['ā', 'gōng', 'kě', 'kǒu', 'miàn'])).toEqual({
      word: '可口',
      start: 2,
      end: 4,
      entries: [{ pinyin: 'kě kǒu', glosses: ['tasty; to taste good'] }],
    });
  });

  it('keeps every sense of a word', () => {
    expect(dict.lookup('面', 0, ['miàn']).entries.map((e) => e.glosses[0])).toEqual(['face', 'flour']);
  });

  it("lists the overlay's reading first when a character has several", () => {
    expect(dict.lookup('行', 0, ['xíng']).entries.map((e) => e.pinyin)).toEqual(['xíng', 'háng']);
    expect(dict.lookup('银行', 1, ['yín', 'háng']).entries[0].glosses).toEqual(['bank']);
  });

  it('treats characters missing from the dictionary as one-character words with no entries', () => {
    expect(dict.lookup('叁巴', 1, ['sān', 'bā'])).toEqual({ word: '巴', start: 1, end: 2, entries: [] });
  });
});
