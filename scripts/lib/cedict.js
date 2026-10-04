// Build-time CC-CEDICT conversion (Node): the MDBG text format → the compact tab-separated
// dictionary the app ships (one line per reading: simplified, tone-marked pinyin, glosses).

const TONE_MARKS = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

// One numbered syllable → tone marks: "kou3" → "kǒu", "lu:4" → "lǜ", "ma5" → "ma".
// The mark goes on a or e if present, on the o of "ou", otherwise on the last vowel.
export function markSyllable(syllable) {
  const match = /^([a-zü:]+)([1-5])$/i.exec(syllable);
  if (!match) return syllable.replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
  const letters = match[1].replace(/u:/g, 'ü').replace(/U:/g, 'Ü');
  const tone = Number(match[2]);
  if (tone === 5) return letters;
  const lower = letters.toLowerCase();
  let at = lower.search(/[ae]/);
  if (at < 0) at = lower.indexOf('ou');
  if (at < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i])) {
        at = i;
        break;
      }
    }
  }
  if (at < 0) return letters; // no vowel (e.g. "m2", "ng5")
  const vowel = lower[at];
  let marked = TONE_MARKS[vowel][tone - 1];
  if (letters[at] !== vowel) marked = marked.toUpperCase();
  return letters.slice(0, at) + marked + letters.slice(at + 1);
}

export const markPinyin = (numbered) => numbered.split(' ').map(markSyllable).join(' ');

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
// Cross-references that carry no meaning of their own.
const REFERENCE_ONLY = /^(old |archaic |Japanese |Taiwan )?variant of |^see [^/]*\[/;

// One CC-CEDICT line → { traditional, simplified, pinyin, glosses } or null (comment/malformed).
export function parseLine(line) {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, traditional, simplified, pinyin, glosses] = match;
  return { traditional, simplified, pinyin: markPinyin(pinyin), glosses: glosses.split('/') };
}

// The whole CC-CEDICT text → compact TSV: "simplified\tpinyin\tgloss/gloss/gloss" per line,
// keeping at most `maxGlosses` meaningful glosses and dropping entries that are only
// cross-references.
export function compactDictionary(text, { maxGlosses = 3 } = {}) {
  const out = [];
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    const glosses = entry.glosses.filter((g) => g && !REFERENCE_ONLY.test(g)).slice(0, maxGlosses);
    if (glosses.length) out.push(`${entry.simplified}\t${entry.pinyin}\t${glosses.join('/')}`);
  }
  return `${out.join('\n')}\n`;
}
