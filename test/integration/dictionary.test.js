import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { compactDictionary } from '../../scripts/lib/cedict.js';
import { createDictionary } from '../../src/text/dict.js';
import { createDictCore } from '../../src/worker/dict-core.js';

// The vendored CC-CEDICT snapshot, compacted exactly as the build does, driven through the
// dictionary worker's message handler.
const SNAPSHOT = new URL('../../data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz', import.meta.url);

describe('dictionary worker core on the real CC-CEDICT', () => {
  const handle = createDictCore({ createDictionary });
  const lookup = async (run, index, readings) =>
    (await handle({ type: 'lookup', id: 2, run, index, readings })).result;

  beforeAll(async () => {
    const tsv = compactDictionary(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8'));
    const ready = await handle({ type: 'load', id: 1, bytes: new TextEncoder().encode(tsv).buffer });
    expect(ready).toMatchObject({ type: 'ready', id: 1 });
    expect(ready.words).toBeGreaterThan(100_000);
  });

  it('splits a dish name into dictionary words and explains the tapped one', async () => {
    const result = await lookup('阿公可口面', 3, ['ā', 'gōng', 'kě', 'kǒu', 'miàn']);
    expect(result).toMatchObject({ word: '可口', start: 2, end: 4 });
    expect(result.entries[0]).toEqual({ pinyin: 'kě kǒu', glosses: ['tasty; to taste good'] });
  });

  it('knows Singapore and Malaysian menu words', async () => {
    expect((await lookup('甘榜鸡', 0, ['gān', 'bǎng', 'jī'])).word).toBe('甘榜');
    expect((await lookup('炸金目鲈', 2, ['zhà', 'jīn', 'mù', 'lú'])).entries[0].glosses[0]).toBe('Barramundi');
    expect((await lookup('面粉粿', 2, ['miàn', 'fěn', 'guǒ'])).entries[0].glosses[0]).toMatch(/^rice cake/);
  });

  it('includes the noodles sense of 面', async () => {
    const { entries } = await lookup('海鲜伊面', 3, ['hǎi', 'xiān', 'yī', 'miàn']);
    expect(entries.length).toBeGreaterThan(0); // 伊面 is one word
    const noodles = await lookup('面', 0, ['miàn']);
    expect(noodles.entries.some((e) => e.glosses.includes('noodles'))).toBe(true);
  });

  it('replies with an error for unknown messages', async () => {
    expect(await handle({ type: 'nope', id: 9 })).toMatchObject({ type: 'error', id: 9 });
  });
});
