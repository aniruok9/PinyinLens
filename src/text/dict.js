// CC-CEDICT lookups for tap-for-meaning (spec §7.4), on the compact dictionary written by
// scripts/fetch-assets.js (one line per reading: "simplified\tpinyin\tgloss/gloss/gloss").
// DOM-free: runs in the dictionary worker and in Node tests.

const MAX_WORD = 8; // longest headword tried when segmenting

export function createDictionary(tsv) {
  const words = new Map(); // simplified → [{ pinyin, glosses }]
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const [word, pinyin, glosses] = line.split('\t');
    const entry = { pinyin, glosses: glosses.split('/') };
    const list = words.get(word);
    if (list) list.push(entry);
    else words.set(word, [entry]);
  }

  // Forward maximum matching: at each position take the longest dictionary word; a character
  // the dictionary doesn't know becomes a one-character word. Returns [start, end) spans.
  function segment(run) {
    const chars = [...run];
    const spans = [];
    for (let start = 0; start < chars.length; ) {
      let end = Math.min(chars.length, start + MAX_WORD);
      while (end > start + 1 && !words.has(chars.slice(start, end).join(''))) end--;
      spans.push([start, end]);
      start = end;
    }
    return spans;
  }

  // The word containing chars[index] of a CJK run, with its dictionary entries. `readings` are the
  // overlay's per-character pinyin for the run. Entries whose reading matches it exactly come first,
  // then ones matching but for capitals, then the rest: pinyin-pro writes lowercase and CC-CEDICT
  // capitalises proper nouns (listed first), so 鱼 shows "fish" before "surname Yu".
  function lookup(run, index, readings = []) {
    const [start, end] = segment(run).find(([s, e]) => index >= s && index < e);
    const word = [...run].slice(start, end).join('');
    const plain = (pinyin) => pinyin.replace(/\s+/g, '');
    const reading = plain(readings.slice(start, end).join(''));
    const rank = ({ pinyin }) => (plain(pinyin) === reading ? 0 : plain(pinyin).toLowerCase() === reading.toLowerCase() ? 1 : 2);
    const entries = [...(words.get(word) ?? [])].sort((a, b) => rank(a) - rank(b)); // stable: file order within a rank
    return { word, start, end, entries };
  }

  return { size: words.size, segment, lookup };
}
