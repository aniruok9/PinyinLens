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

// Every numbered syllable in a string, spaced or not: "ke3 kou3" → "kě kǒu", "yi1mo2-yi1yang4" → "yīmó-yīyàng".
export const markPinyin = (numbered) => numbered.replace(/[a-zü:]+[1-5]/gi, markSyllable);

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

// Bracketed asides that only point elsewhere: measure words and variant notes.
const ASIDE = /\s*\((CL:|(old |archaic |Japanese |Taiwan )?variant of )[^)]*\)/g;
// A reference to another word, "書經|书经[Shu1 jing1]" or "书经[Shu1 jing1]", and bare "[qia3]" pinyin.
const REFERENCE = /(?:[^\s|[\]/,;()]+\|)?([^\s|[\]/,;()]+)\[([^\]]+)\]/g;
const BARE_PINYIN = /\[([^\]]+)\]/g;
const TRAD_SIMP = /[^\s|[\]/,;()]+\|([^\s|[\]/,;()]+)/g; // "牛郎織女|牛郎织女" with no pinyin

// One gloss as a reader should see it, or '' when nothing meaningful is left.
function cleanGloss(gloss) {
  if (!gloss || REFERENCE_ONLY.test(gloss) || gloss.startsWith('CL:')) return '';
  return gloss
    .replace(ASIDE, '')
    .replace(REFERENCE, (_, word, pinyin) => `${word} (${markPinyin(pinyin)})`)
    .replace(BARE_PINYIN, (_, pinyin) => `[${markPinyin(pinyin)}]`)
    .replace(TRAD_SIMP, '$1')
    .trim();
}

// The whole CC-CEDICT text → compact TSV: "simplified\tpinyin\tgloss/gloss/gloss" per line,
// keeping at most `maxGlosses` meaningful glosses. References to other words read "书经 (Shū jīng)";
// measure words, variant notes, entries left with nothing, and entries whose shown glosses all
// appear among another entry's shown glosses for the same word and reading (traditional variants
// of one word) are dropped.
export function compactDictionary(text, { maxGlosses = 3 } = {}) {
  const groups = new Map(); // "simplified\tpinyin" → [glosses, ...] in file order
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    const glosses = entry.glosses.map(cleanGloss).filter(Boolean);
    if (!glosses.length) continue;
    const key = `${entry.simplified}\t${entry.pinyin}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(glosses);
  }
  const out = [];
  for (const [key, entries] of groups) {
    const shown = entries.map((glosses) => glosses.slice(0, maxGlosses));
    shown.forEach((glosses, i) => {
      const covered = shown.some(
        (other, j) => j !== i && glosses.every((g) => other.includes(g)) && (other.length > glosses.length || j < i),
      );
      if (!covered) out.push(`${key}\t${glosses.join('/')}`);
    });
  }
  return `${out.join('\n')}\n`;
}
