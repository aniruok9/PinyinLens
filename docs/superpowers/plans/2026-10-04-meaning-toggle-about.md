# Tap for Meaning, Pinyin Toggle and About Implementation Plan (Rebuild, Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a frozen scan, tapping a Chinese character opens a card with its word's pinyin and English meanings from CC-CEDICT, offline; an eye button hides and shows the pinyin; an About sheet credits CC-CEDICT and the other components and can open the debug panel.

**Architecture:** A vendored CC-CEDICT snapshot is compacted at build time into `public/ocr/cedict.tsv` and listed in the asset manifest, so the existing loader caches and SHA-verifies it. After the OCR engine is ready, the main thread loads it into a second, dictionary-only worker. A tap is hit-tested against the frozen scan's character quads (pure `hittest.js`). The tapped character's CJK run goes to the worker, which segments it by forward maximum matching and returns the word containing the character with its entries. The reducer gains `card`, `pinyinVisible`, `about` and `dict`; `ui.js` renders them into static DOM, and `main.js` wires taps, the card, the toggle and About.

**Tech Stack:** No new dependencies. Plan 1–2 stack: Vite 8.3.2, vite-plugin-pwa 2.0.0, onnxruntime-web 1.24.3, pinyin-pro 3.28.1, Vitest 5.0.3, Playwright 1.63.0, Node ≥ 22 (`node:zlib` for the snapshot).

**Spec:** `docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md`. This plan implements §2's last two v1 features, §5's CC-CEDICT sourcing, §7.2's highlight, §7.4, §7.5's toggle, the About entry point for §8's debug panel, and the §9.4 E2E items "Tap a character → card appears" and "Toggle hides the overlay". Task 7 updates the spec where this plan deviates.

**Known deviations from the spec** (proposed during planning, need the user's approval):
1. **The dictionary has its own worker, and lookups are stateless** (spec §4.1 had `loadDict`/`lookup { lineIndex, charIndex }` on the OCR worker, which kept the last scan's lines). The main thread sends the tapped character's run, index and readings instead. The OCR worker stays unchanged, a 3MB dictionary download never delays a scan, and lookups need no scan state.
2. **CC-CEDICT is vendored in git** (`data/cedict/`, 3.9MB gzipped) instead of a GitHub Release asset. It is versioned with the code and builds offline in CI.
3. **No `scripts/build-dict.js`:** `scripts/fetch-assets.js` compacts the dictionary with `scripts/lib/cedict.js`, in the step that already writes `public/ocr/` and the manifest.
4. **One word per tap:** the run is segmented, and the card shows the segment containing the tapped character (阿公可口面: tapping 口 shows 可口, tapping 面 shows 面). Spec §7.4 step 2, "可口面 → 可口 + 面 on one card", only applies when OCR merges words into a "word" the dictionary lacks. Segmenting the whole run makes that case one tap per part.
5. **The debug panel opens from a "Show debug info" button in About**, not a long press (spec §8). A button is easier to find, and it works the same with touch and mouse.
6. **The card sits above the shutter**, not flush with the bottom edge, so the shutter and the eye button stay usable while it is open.

**Provenance:** every code block was run during planning in a scratch copy of the repo at commit `c0808b4`, with the real models, the vendored snapshot and the fixtures. Vitest ran 24 files / 145 tests and Playwright 25 tests (headless Chromium shell 1223), all passing. Each Review Focus test was checked to fail when the guard it pins is removed.

## Global Constraints

- Everything in Plan 1's and Plan 2's Global Constraints still holds (`docs/superpowers/plans/2026-10-02-ocr-engine.md`, `docs/superpowers/plans/2026-10-03-app-shell.md`). In particular:
  - No UI framework, and no new dependencies.
  - `src/text/` and the worker cores stay DOM-free and Node-free; `src/app/` is the only DOM code.
  - One service worker (vite-plugin-pwa), no `skipWaiting`/`clientsClaim`.
  - Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `src/worker/dict.worker.js` and `src/worker/ocr.worker.js` are the only files that use `self`. `scripts/lib/cedict.js` is Node build code: the browser never parses CC-CEDICT's text format.
- The dictionary reaches the browser only through the manifest (`manifest.dict`) and `src/app/assets.js`, cached in `pinyinlens-assets-<version>` and SHA-256 verified like the models. The service worker never precaches `cedict.tsv`.
- The dictionary loads after `engine-ready`, never before: the first visit's model download and first scan come first.
- CC-CEDICT attribution (CC BY-SA 4.0, link to the license, source, snapshot date, how it was shortened) stays in the About sheet and in `data/cedict/README.md`.
- User-visible strings are exactly as written in this plan's code (tests assert several of them).
- Sandbox notes: the controller provides `PW_CHROMIUM_PATH` and `LD_LIBRARY_PATH` if Playwright's Chromium can't start; `npm_config_cache=$TMPDIR/npm-cache` if npm's cache is read-only.

## Review Focus

Conditions the spec implies that a happy-path test wouldn't exercise, most likely to bite a phone user first. Each one is pinned by the test named in brackets:

1. **Tap before the dictionary has arrived** (first visit: it downloads after the models). The card shows the tapped character with "Dictionary loading…", then fills in without another tap. [Task 6, `says the dictionary is loading until it arrives`]
2. **A finger is wider than small text.** A tap just beside a small character still hits the nearest one within one character size (at least 22px). A tap well away from any text closes the card instead of opening a wrong word. [Task 5, `hittest.test.js`; Task 6, `tapping away from the text, or the close button, closes the card`]
3. **The dictionary can't be downloaded** (offline first visit, flaky network). Scanning still works. The card says "Dictionary unavailable (…)", and the next tap tries the download again and succeeds once the network is back. [Task 4, `retries the load on the next lookup when the first one fails`; Task 6, `a dictionary that failed to load says so, and the next tap tries again`]
4. **The card is closed before a slow lookup answers** (also: the user taps another word, or goes back to the camera). The late reply must not reopen the card or overwrite the newer word. [Task 6, `a card closed while the dictionary loads stays closed when it arrives`]
5. **Offline repeat visit.** Meanings work with no network, from the cached dictionary. [Task 6, `meanings work offline on a repeat visit`]

---

## File Structure

| Path | Responsibility |
|---|---|
| `data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz`, `README.md` | Vendored CC-CEDICT snapshot; source, date, hash, license |
| `scripts/lib/cedict.js` | Numbered pinyin → tone marks; CC-CEDICT text → compact TSV |
| `scripts/fetch-assets.js` | + writes `public/ocr/cedict.tsv` and `manifest.dict` |
| `src/text/dict.js` | `createDictionary(tsv)`: forward-maximum-matching segmentation and lookup |
| `src/worker/replies.js` | `withReplies(handle)`: shared id/error reply wrapper for both workers |
| `src/worker/core.js` | OCR worker core, now using `withReplies` (behaviour unchanged) |
| `src/worker/dict-core.js`, `dict.worker.js` | Dictionary worker: message handler (Node-testable) and entry |
| `src/app/dictionary.js` | Main-thread dictionary client: load once, concurrent lookups, retry after failure |
| `src/app/hittest.js` | Screen point → `{ line, token, char }` on the frozen scan |
| `src/app/state.js` | + `pinyinVisible`, `card`, `about`, `dict` |
| `src/app/gestures.js` | + `onTap` (one finger, < 10px, < 300ms) |
| `src/app/overlay.js` | + `drawHighlight` (outline of the tapped word) |
| `src/app/ui.js` | + toggle, word card, About dialog, `data-dict`, debug button label |
| `src/app/main.js` | + dictionary start, tap → card, toggle, About, card dismissal |
| `index.html`, `src/app/style.css` | + eye button, About button, word card, About dialog |
| `test/unit/{cedict,dict,dictionary,hittest}.test.js`, `state.test.js` | Vitest (Node) |
| `test/integration/dictionary.test.js` | Dictionary worker core on the real snapshot |
| `test/e2e/meaning.spec.js`, `helpers.js` | Playwright: card, toggle, About, offline, failure paths |
| `README.md`, `CLAUDE.md`, spec | Docs |

**Shared shapes**

```js
// public/ocr/cedict.tsv: one line per CC-CEDICT reading, at most 3 glosses
"可口\tkě kǒu\ttasty; to taste good\n"
// manifest.json gains
dict: { file: 'cedict.tsv', size, sha256 }
// A lookup result (dictionary worker → main thread)
{ word: '可口', start: 2, end: 4, entries: [{ pinyin: 'kě kǒu', glosses: ['tasty; to taste good'] }] }
// state.card
{ word, reading, entries /* null while looking up */, error /* string or null */ }
```

---

### Task 1: CC-CEDICT snapshot and its build-time compaction

**Files:**
- Create: `data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz`, `data/cedict/README.md`, `scripts/lib/cedict.js`, `test/unit/cedict.test.js`
- Modify: `scripts/fetch-assets.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `compactDictionary(text, { maxGlosses = 3 } = {}) → string` (TSV, one `simplified\tpinyin\tgloss/gloss/gloss` line per reading, trailing newline); `markSyllable(s)`, `markPinyin(s)`, `parseLine(line) → { traditional, simplified, pinyin, glosses } | null`. The built manifest gains `dict: { file: 'cedict.tsv', size, sha256 }`.

- [ ] **Step 1: Vendor the snapshot**

The planning copy is in this session's scratchpad. Copy it, and check the hash:

```bash
mkdir -p data/cedict
cp /tmp/claude-1000/-mnt-d-Documents-codes-PinyinLens/185cb241-8762-4eec-9428-704eb5ab3f7d/scratchpad/app3/data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz data/cedict/
sha256sum data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
```

Expected: `fd16b26f991724564037d7eb19105397c5f1b17938ebda95bbbe67d642cf5fda`. If the copy is gone, download `https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz` instead. MDBG republishes daily, so that file's date and hash differ: put its own `#! date=` line and hash into the README below and into the About sheet (Task 6).

- [ ] **Step 2: Write `data/cedict/README.md`**

```markdown
# CC-CEDICT snapshot

`cedict_1_0_ts_utf-8_mdbg.txt.gz` is [CC-CEDICT](https://cc-cedict.org/wiki/) as published by
[MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) on 2026-10-04 (`#! date=2026-10-04T06:34:39Z`),
SHA-256 `fd16b26f991724564037d7eb19105397c5f1b17938ebda95bbbe67d642cf5fda`.

CC-CEDICT is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
The app credits it in its About sheet (`index.html`).

`npm run build` compacts it into `public/ocr/cedict.tsv` (`scripts/lib/cedict.js`): simplified headword,
tone-marked pinyin and at most three glosses per entry, without "variant of" and "see" references. That
derived file is shared under the same license.

To update: download https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz over this
file, then update the date and hash above and the snapshot date in the About sheet.
```

- [ ] **Step 3: Write the failing test** `test/unit/cedict.test.js`

```js
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run test/unit/cedict.test.js`
Expected: FAIL, `Failed to resolve import "../../scripts/lib/cedict.js"`.

- [ ] **Step 5: Implement** `scripts/lib/cedict.js`

```js
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/unit/cedict.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Publish the dictionary from `scripts/fetch-assets.js`**

Replace the file with:

```js
// Build step: copies the shipped OCR assets into public/ocr/, compacts the vendored CC-CEDICT
// snapshot into public/ocr/cedict.tsv, and writes public/ocr/manifest.json (file names, sizes,
// SHA-256, detector params, default config) for the browser's asset loader.
// Run after `npm run fetch-models`. Usage: node scripts/fetch-assets.js
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { compactDictionary } from './lib/cedict.js';
import { charsetFile, detFile, recFile } from './lib/model-files.js';
import { DEFAULT_CONFIG, DET_MODELS, SHIPPED } from './models.config.js';

const OUT = fileURLToPath(new URL('../public/ocr/', import.meta.url));
const CEDICT = new URL('../data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz', import.meta.url);
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (!SHIPPED.det.includes(DEFAULT_CONFIG.det) || !SHIPPED.rec.includes(DEFAULT_CONFIG.rec)) {
  throw new Error('DEFAULT_CONFIG models must be listed in SHIPPED');
}

// Writes bytes into OUT and describes them for the manifest.
function write(file, bytes) {
  writeFileSync(OUT + file, bytes);
  return { file, size: bytes.length, sha256: sha256(bytes) };
}

const put = (source, file) => write(file, readFileSync(source));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = {
  ort: put(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'),
  det: Object.fromEntries(
    SHIPPED.det.map((id) => [id, { ...put(detFile(id), `det-${id}.onnx`), params: DET_MODELS[id].params }]),
  ),
  rec: Object.fromEntries(
    SHIPPED.rec.map((id) => [
      id,
      { ...put(recFile(id), `rec-${id}.onnx`), charset: put(charsetFile(id), `rec-${id}.charset.json`) },
    ]),
  ),
  dict: write('cedict.tsv', Buffer.from(compactDictionary(gunzipSync(readFileSync(CEDICT)).toString('utf8')))),
  default: DEFAULT_CONFIG,
};
// The cache name derives from this, so any asset change starts a fresh cache.
manifest.version = sha256(JSON.stringify(manifest)).slice(0, 12);

writeFileSync(OUT + 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}manifest.json (version ${manifest.version})`);
```

(Changes: the header comment; the `gunzipSync`, `compactDictionary` and `CEDICT` lines; `put` now goes through `write`; the `dict:` manifest entry.)

- [ ] **Step 8: Check the build output**

Run: `node scripts/fetch-assets.js && node -e "const m=require('./public/ocr/manifest.json');console.log(m.dict)" && head -c 300 public/ocr/cedict.tsv && wc -l public/ocr/cedict.tsv`
Expected: `{ file: 'cedict.tsv', size: 7474021, sha256: '5009808c0fe924b17ace967d3320886378be31b3aabd3c1a9905acb541ad6a7d' }` and 118148 lines, each `simplified<TAB>tone-marked pinyin<TAB>glosses`. A different snapshot (Step 1) gives a different size and hash.

- [ ] **Step 9: Run all tests and commit**

Run: `npm test`
Expected: all pass (6 more tests than before this task).

```bash
git add data/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz data/cedict/README.md scripts/lib/cedict.js test/unit/cedict.test.js scripts/fetch-assets.js
git commit -m "Vendor CC-CEDICT and compact it into the asset manifest at build time

The MDBG snapshot of 2026-10-04 (CC BY-SA 4.0) becomes public/ocr/cedict.tsv:
simplified headword, tone-marked pinyin and up to three glosses per reading,
without variant-of and see-also references. It is listed in manifest.json, so
the asset loader caches and verifies it like the models.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Segmentation and lookup

**Files:**
- Create: `src/text/dict.js`, `test/unit/dict.test.js`

**Interfaces:**
- Consumes: the TSV format from Task 1.
- Produces: `createDictionary(tsv) → { size, segment(run) → Array<[start, end]>, lookup(run, index, readings = []) → { word, start, end, entries: Array<{ pinyin, glosses: string[] }> } }`. `run` is a string of CJK characters; `index` and `start`/`end` count characters; `readings` are per-character pinyin (`''` for none).

- [ ] **Step 1: Write the failing test** `test/unit/dict.test.js`

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/dict.test.js`
Expected: FAIL, `Failed to resolve import "../../src/text/dict.js"`.

- [ ] **Step 3: Implement** `src/text/dict.js`

```js
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
  // overlay's per-character pinyin for the run; entries matching the word's reading come first.
  function lookup(run, index, readings = []) {
    const [start, end] = segment(run).find(([s, e]) => index >= s && index < e);
    const word = [...run].slice(start, end).join('');
    const normalise = (pinyin) => pinyin.toLowerCase().replace(/\s+/g, '');
    const reading = normalise(readings.slice(start, end).join(''));
    const found = words.get(word) ?? [];
    const preferred = found.filter((e) => normalise(e.pinyin) === reading);
    return { word, start, end, entries: [...preferred, ...found.filter((e) => !preferred.includes(e))] };
  }

  return { size: words.size, segment, lookup };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/dict.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/text/dict.js test/unit/dict.test.js
git commit -m "Find the tapped word by forward maximum matching on CC-CEDICT

The run is split into the longest dictionary words; the word containing the
tapped character comes back with every entry, the overlay's reading first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dictionary worker

**Files:**
- Create: `src/worker/replies.js`, `src/worker/dict-core.js`, `src/worker/dict.worker.js`, `test/integration/dictionary.test.js`
- Modify: `src/worker/core.js` (use `withReplies`; behaviour unchanged, `test/integration/worker-core.test.js` still passes)

**Interfaces:**
- Consumes: `createDictionary` (Task 2); `compactDictionary` (Task 1, in the test only).
- Produces: `withReplies(handle) → async (message) → reply`; `createDictCore({ createDictionary }) → async (message) → reply` for `{ type: 'load', id, bytes }` → `{ type: 'ready', id, words }` and `{ type: 'lookup', id, run, index, readings }` → `{ type: 'result', id, result }`, else `{ type: 'error', id, message }`. Worker entry: `src/worker/dict.worker.js` (module worker).

- [ ] **Step 1: Write the failing test** `test/integration/dictionary.test.js`

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/integration/dictionary.test.js`
Expected: FAIL, `Failed to resolve import "../../src/worker/dict-core.js"`.

- [ ] **Step 3: Extract the reply wrapper** `src/worker/replies.js`

```js
// Wraps a worker's message handler: every message gets exactly one reply carrying its id, and a
// thrown error becomes { type: 'error', id, message } instead of an unhandled rejection.
export const withReplies = (handle) => async (message) => {
  try {
    return { id: message.id, ...(await handle(message)) };
  } catch (err) {
    return { type: 'error', id: message.id, message: err.message };
  }
};
```

Then make `src/worker/core.js` use it. The whole file becomes:

```js
import { withReplies } from './replies.js';

// The OCR worker's message handler, kept apart from `self` so Node tests can drive it.
//   { type: 'init', id, wasm, det, rec, charset, detParams, longSide } → { type: 'ready', id, ms }
//   { type: 'scan', id, width, height, data }                           → { type: 'result', id, lines, timings }
// Any failure replies { type: 'error', id, message }. `lines` are annotated (tokens with pinyin).
export function createWorkerCore({ ort, createOcr, annotate }) {
  let ocr = null;
  let longSide = 960;

  async function handle(message) {
    if (message.type === 'init') {
      const start = performance.now();
      ort.env.wasm.wasmBinary = message.wasm;
      ort.env.wasm.numThreads = 1;
      await ocr?.release();
      ocr = await createOcr({
        ort,
        det: message.det,
        rec: message.rec,
        charset: message.charset,
        detParams: message.detParams,
      });
      longSide = message.longSide;
      return { type: 'ready', ms: performance.now() - start };
    }
    if (message.type === 'scan') {
      if (!ocr) throw new Error('OCR engine not initialised');
      const image = { data: new Uint8ClampedArray(message.data), width: message.width, height: message.height };
      const { lines, timings } = await ocr.scan(image, { longSide });
      return { type: 'result', lines: annotate(lines), timings };
    }
    throw new Error(`Unknown message type: ${message.type}`);
  }

  return withReplies(handle);
}
```

- [ ] **Step 4: Implement the worker core and entry**

`src/worker/dict-core.js`:

```js
import { withReplies } from './replies.js';

// The dictionary worker's message handler, kept apart from `self` so Node tests can drive it.
//   { type: 'load', id, bytes }                 → { type: 'ready', id, words }
//   { type: 'lookup', id, run, index, readings } → { type: 'result', id, result: { word, start, end, entries } }
export function createDictCore({ createDictionary }) {
  let dictionary = null;

  async function handle(message) {
    if (message.type === 'load') {
      dictionary = createDictionary(new TextDecoder().decode(message.bytes));
      return { type: 'ready', words: dictionary.size };
    }
    if (message.type === 'lookup') {
      if (!dictionary) throw new Error('Dictionary not loaded');
      return { type: 'result', result: dictionary.lookup(message.run, message.index, message.readings) };
    }
    throw new Error(`Unknown message type: ${message.type}`);
  }

  return withReplies(handle);
}
```

`src/worker/dict.worker.js`:

```js
import { createDictionary } from '../text/dict.js';
import { createDictCore } from './dict-core.js';

const handle = createDictCore({ createDictionary });

self.onmessage = async ({ data }) => {
  self.postMessage(await handle(data));
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/integration/dictionary.test.js test/integration/worker-core.test.js`
Expected: PASS. The dictionary suite's 4 tests check 可口, 甘榜, 金目鲈, 粿, 伊面/面 and the error reply on the real snapshot; the OCR worker-core tests are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/worker/replies.js src/worker/core.js src/worker/dict-core.js src/worker/dict.worker.js test/integration/dictionary.test.js
git commit -m "Add the dictionary worker

A second worker holds CC-CEDICT and answers stateless lookups (run, index,
readings), so the OCR worker keeps no scan state and a dictionary download
never delays a scan. Both workers share one reply wrapper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dictionary client

**Files:**
- Create: `src/app/dictionary.js`, `test/unit/dictionary.test.js`

**Interfaces:**
- Consumes: the dictionary worker protocol (Task 3).
- Produces: `createDictionaryClient({ spawnWorker, loadBytes }) → { load(): Promise<{ type: 'ready', id, words }>, lookup(run, index, readings): Promise<{ word, start, end, entries }> }`. `spawnWorker()` returns a Worker; `loadBytes()` resolves to the dictionary's ArrayBuffer, which is transferred. A failed load or a worker crash rejects what is pending, terminates the worker, and the next call starts over.

- [ ] **Step 1: Write the failing test** `test/unit/dictionary.test.js`

```js
import { describe, expect, it } from 'vitest';
import { createDictionaryClient } from '../../src/app/dictionary.js';

// A stand-in dictionary worker: replies to 'load' and echoes lookups; `crashOn` fires onerror.
function fakeWorkers({ crashOn } = {}) {
  const spawned = [];
  const spawnWorker = () => {
    const worker = {
      messages: [],
      terminated: false,
      postMessage(message, transfer) {
        worker.messages.push({ message, transfer });
        queueMicrotask(() => {
          if (message.type === crashOn) return worker.onerror({ message: 'boom', preventDefault() {} });
          const reply =
            message.type === 'load'
              ? { type: 'ready', words: 3 }
              : { type: 'result', result: { word: message.run.slice(message.index, message.index + 1), entries: [] } };
          worker.onmessage({ data: { id: message.id, ...reply } });
        });
      },
      terminate() {
        worker.terminated = true;
      },
    };
    spawned.push(worker);
    return worker;
  };
  return { spawnWorker, spawned };
}

describe('createDictionaryClient', () => {
  it('loads once, transferring the dictionary bytes, then answers lookups', async () => {
    const { spawnWorker, spawned } = fakeWorkers();
    const bytes = new ArrayBuffer(8);
    let loads = 0;
    const client = createDictionaryClient({ spawnWorker, loadBytes: async () => (loads++, bytes) });
    const [a, b] = await Promise.all([client.lookup('可口', 0, []), client.lookup('可口', 1, [])]);
    expect([a.word, b.word]).toEqual(['可', '口']);
    expect(loads).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].messages[0]).toMatchObject({ message: { type: 'load', bytes }, transfer: [bytes] });
  });

  it('retries the load on the next lookup when the first one fails', async () => {
    const { spawnWorker, spawned } = fakeWorkers();
    let fail = true;
    const client = createDictionaryClient({
      spawnWorker,
      loadBytes: async () => {
        if (fail) throw new Error('offline');
        return new ArrayBuffer(1);
      },
    });
    await expect(client.lookup('面', 0, [])).rejects.toThrow('offline');
    expect(spawned[0].terminated).toBe(true);
    fail = false;
    expect((await client.lookup('面', 0, [])).word).toBe('面');
  });

  it('rejects pending lookups when the worker crashes, and starts a fresh worker next time', async () => {
    const workers = fakeWorkers({ crashOn: 'lookup' });
    const client = createDictionaryClient({ spawnWorker: workers.spawnWorker, loadBytes: async () => new ArrayBuffer(1) });
    await expect(client.lookup('面', 0, [])).rejects.toThrow('boom');
    expect(workers.spawned[0].terminated).toBe(true);
    await expect(client.lookup('面', 0, [])).rejects.toThrow('boom');
    expect(workers.spawned).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/dictionary.test.js`
Expected: FAIL, `Failed to resolve import "../../src/app/dictionary.js"`.

- [ ] **Step 3: Implement** `src/app/dictionary.js`

```js
// Main-thread client for the dictionary worker (spec §7.4). Loads the compact CC-CEDICT once,
// then answers lookups; several may be in flight, matched to replies by id. A failed load or a
// crashed worker is dropped, and the next lookup starts over.
//   spawnWorker(): a Worker (or anything with postMessage/terminate/onmessage/onerror)
//   loadBytes(): Promise<ArrayBuffer> — the dictionary file (transferred to the worker)
export function createDictionaryClient({ spawnWorker, loadBytes }) {
  let worker = null;
  let loading = null;
  let nextId = 1;
  const pending = new Map();

  function reset(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    loading = null;
  }

  function request(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  function load() {
    if (!loading) {
      loading = (async () => {
        worker = spawnWorker();
        worker.onmessage = ({ data }) => {
          const waiter = pending.get(data.id);
          if (!waiter) return;
          pending.delete(data.id);
          if (data.type === 'error') waiter.reject(new Error(data.message));
          else waiter.resolve(data);
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          reset(new Error(event.message || 'Dictionary worker crashed'));
        };
        const bytes = await loadBytes();
        return request({ type: 'load', bytes }, [bytes]);
      })();
      loading.catch((err) => reset(err));
    }
    return loading;
  }

  // The word containing run[index], with its entries: { word, start, end, entries }.
  async function lookup(run, index, readings) {
    await load();
    return (await request({ type: 'lookup', run, index, readings })).result;
  }

  return { load, lookup };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/dictionary.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/dictionary.js test/unit/dictionary.test.js
git commit -m "Add the dictionary worker client

Loads the dictionary once, matches concurrent lookups to replies by id, and
after a failed download or a crashed worker starts over on the next lookup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tap hit-test and app state for the card, toggle and About

**Files:**
- Create: `src/app/hittest.js`, `test/unit/hittest.test.js`
- Modify: `src/app/state.js`, `test/unit/state.test.js`

**Interfaces:**
- Consumes: `toScreen(view, point)` from `src/app/view.js`; annotated lines `{ tokens: [{ isCJK, text, chars: [{ ch, pinyin, quad }] }] }` (quads in content px, reading orientation).
- Produces:
  - `charAt(lines, view, x, y) → { line, token, char } | null`.
  - State fields `pinyinVisible` (true), `card` (null), `about` (false) and `dict` ('loading').
  - Events: `show-card { card }` (frozen only), `close-card`, `toggle-pinyin`, `open-about`, `close-about`, `dict-ready`, `dict-failed`. `resume` also clears `card`.

- [ ] **Step 1: Write the failing tests**

`test/unit/hittest.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { charAt } from '../../src/app/hittest.js';

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// One line: a non-CJK token, then CJK characters in 40px cells starting at x = 100.
const lines = [
  {
    tokens: [
      { isCJK: false, text: 'A', chars: [{ ch: 'A', quad: rect(40, 0, 40, 40) }] },
      { isCJK: true, text: '可口面', chars: [...'可口面'].map((ch, i) => ({ ch, quad: rect(100 + 40 * i, 0, 40, 40) })) },
    ],
  },
];
const identity = { scale: 1, tx: 0, ty: 0 };

describe('charAt', () => {
  it('finds the character under the point', () => {
    expect(charAt(lines, identity, 150, 20)).toEqual({ line: 0, token: 1, char: 1 });
  });

  it('accepts a near miss, picking the closest character', () => {
    expect(charAt(lines, identity, 225, 50)).toEqual({ line: 0, token: 1, char: 2 }); // 10px below 面
  });

  it('returns null away from any Chinese character', () => {
    expect(charAt(lines, identity, 400, 300)).toBeNull();
    expect(charAt(lines, identity, 60, 20)).toBeNull(); // on the non-CJK token
  });

  it('gives small characters a finger-sized target', () => {
    const tiny = { scale: 0.1, tx: 0, ty: 0 }; // 4px characters on screen
    expect(charAt(lines, tiny, 15, 2 + 18)).toEqual({ line: 0, token: 1, char: 1 }); // 18px from 口's centre
  });

  it('works in screen space under the view transform', () => {
    expect(charAt(lines, { scale: 2, tx: 10, ty: 10 }, 10 + 2 * 210, 10 + 2 * 20)).toEqual({ line: 0, token: 1, char: 2 });
  });
});
```

Append to `test/unit/state.test.js`:

```js
describe('reduce: meaning card, pinyin toggle, About, dictionary', () => {
  const frozen = run([{ type: 'freeze' }, { type: 'scan-done', lineCount: 1 }], live);
  const card = { word: '可口', reading: 'kě kǒu', entries: null, error: null };

  it('starts with pinyin shown, no card, About closed, dictionary loading', () => {
    expect(initialState).toMatchObject({ pinyinVisible: true, card: null, about: false, dict: 'loading' });
  });

  it('shows the word card only on a frozen scan, and closes it on resume', () => {
    expect(reduce(live, { type: 'show-card', card }).card).toBeNull();
    const shown = reduce(frozen, { type: 'show-card', card });
    expect(shown.card).toEqual(card);
    expect(reduce(shown, { type: 'close-card' }).card).toBeNull();
    expect(reduce(shown, { type: 'resume' })).toMatchObject({ screen: 'live', card: null });
  });

  it('toggles pinyin visibility, and the choice survives resume', () => {
    const hidden = reduce(frozen, { type: 'toggle-pinyin' });
    expect(hidden.pinyinVisible).toBe(false);
    expect(reduce(hidden, { type: 'resume' }).pinyinVisible).toBe(false);
    expect(reduce(hidden, { type: 'toggle-pinyin' }).pinyinVisible).toBe(true);
  });

  it('opens and closes the About sheet', () => {
    const open = reduce(live, { type: 'open-about' });
    expect(open.about).toBe(true);
    expect(reduce(open, { type: 'close-about' }).about).toBe(false);
  });

  it('tracks the dictionary status', () => {
    expect(reduce(live, { type: 'dict-ready' }).dict).toBe('ready');
    expect(reduce(live, { type: 'dict-failed' }).dict).toBe('failed');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/unit/hittest.test.js test/unit/state.test.js`
Expected: FAIL. hittest: `Failed to resolve import "../../src/app/hittest.js"`; state: the 5 new tests fail (e.g. `expected undefined to be true` for `pinyinVisible`), the 9 existing ones pass.

- [ ] **Step 3: Implement** `src/app/hittest.js`

```js
import { toScreen } from './view.js';

// Which Chinese character a tap on the frozen scan lands on (spec §7.4).

const MIN_REACH = 22; // px: half of a 44px touch target, so tiny text is still tappable

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

// Point inside (or on the edge of) a convex quad whose corners are in order.
function inside(quad, point) {
  const signs = quad.map((corner, i) => Math.sign(cross(corner, quad[(i + 1) % 4], point)));
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
}

// The CJK character under screen point (x, y) for annotated lines shown with `view`, as
// { line, token, char } indices, or null. A character contains the point, or else the closest
// character centre within one character size (at least MIN_REACH) wins: fingers are wider than text.
export function charAt(lines, view, x, y) {
  let best = null;
  for (const [l, line] of lines.entries()) {
    for (const [t, token] of line.tokens.entries()) {
      if (!token.isCJK) continue;
      for (const [c, ch] of token.chars.entries()) {
        const quad = ch.quad.map((p) => toScreen(view, p));
        if (inside(quad, [x, y])) return { line: l, token: t, char: c };
        const centre = [(quad[0][0] + quad[2][0]) / 2, (quad[0][1] + quad[2][1]) / 2];
        const reach = Math.max(dist(quad[0], quad[1]), dist(quad[0], quad[3]), MIN_REACH);
        const d = dist(centre, [x, y]);
        if (d <= reach && (!best || d < best.d)) best = { d, hit: { line: l, token: t, char: c } };
      }
    }
  }
  return best?.hit ?? null;
}
```

- [ ] **Step 4: Extend the reducer.** `src/app/state.js` becomes:

```js
// App state machine (spec §4, §8): a pure reducer. Effects (camera, engine, drawing) live in main.js.
//   screen: 'intro' | 'live' | 'scanning' | 'frozen' | 'error'
//   engine: 'loading' | 'ready' | 'failed'
//   progress: 0..1 of the first-run asset download
//   error: { kind: 'unsupported' | 'camera' | 'engine', message } when screen is 'error'
//   notice: a short message for the toast, or null
//   pinyinVisible: the overlay's show/hide toggle (kept across scans)
//   card: the word card on a frozen scan: { word, reading, entries (null while looking up), error }, or null
//   about: whether the About sheet is open
//   dict: 'loading' | 'ready' | 'failed' — the background CC-CEDICT load
export const initialState = {
  screen: 'intro',
  engine: 'loading',
  progress: 0,
  error: null,
  notice: null,
  pinyinVisible: true,
  card: null,
  about: false,
  dict: 'loading',
};

export function reduce(state, event) {
  switch (event.type) {
    case 'start':
      return state.screen === 'intro' ? { ...state, screen: 'live' } : state;
    case 'progress':
      return { ...state, progress: event.value };
    case 'engine-ready':
      return { ...state, engine: 'ready', progress: 1 };
    case 'fatal':
      return {
        ...state,
        screen: 'error',
        engine: event.kind === 'engine' ? 'failed' : state.engine,
        error: { kind: event.kind, message: event.message },
      };
    case 'freeze':
      return state.screen === 'live' && state.engine === 'ready' ? { ...state, screen: 'scanning', notice: null } : state;
    case 'scan-done':
      if (state.screen !== 'scanning') return state;
      return { ...state, screen: 'frozen', notice: event.lineCount ? null : 'No Chinese text found. Try moving closer.' };
    case 'scan-failed':
      return state.screen === 'scanning' ? { ...state, screen: 'live', notice: 'Scan failed. Try again.' } : state;
    case 'resume':
      return state.screen === 'frozen' ? { ...state, screen: 'live', notice: null, card: null } : state;
    case 'show-card':
      return state.screen === 'frozen' ? { ...state, card: event.card } : state;
    case 'close-card':
      return { ...state, card: null };
    case 'toggle-pinyin':
      return { ...state, pinyinVisible: !state.pinyinVisible };
    case 'open-about':
      return { ...state, about: true };
    case 'close-about':
      return { ...state, about: false };
    case 'dict-ready':
      return { ...state, dict: 'ready' };
    case 'dict-failed':
      return { ...state, dict: 'failed' };
    case 'notice':
      return { ...state, notice: event.message };
    case 'dismiss-notice':
      return { ...state, notice: null };
    default:
      return state;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/hittest.test.js test/unit/state.test.js`
Expected: PASS, 5 + 14 tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/hittest.js test/unit/hittest.test.js src/app/state.js test/unit/state.test.js
git commit -m "Hit-test taps on the frozen scan; add card, toggle and About state

A tap finds the character under it, or the nearest within one character
size (at least 22px). The reducer gains the word card (frozen only, closed
on resume), pinyin visibility, the About sheet and the dictionary status.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The card, the eye button and About in the app

**Files:**
- Create: `test/e2e/meaning.spec.js`
- Modify: `test/e2e/helpers.js`, `index.html`, `src/app/style.css`, `src/app/gestures.js`, `src/app/overlay.js`, `src/app/ui.js`, `src/app/main.js`

**Interfaces:**
- Consumes: `createDictionaryClient` (Task 4); `charAt`, the new state fields and events (Task 5); `manifest.dict` (Task 1); `loader.load(manifest, entries) → Map(file → ArrayBuffer)` (Plan 2).
- Produces:
  - `bindGestures(element, { onPinch, onDrag, onTap })`.
  - `drawHighlight(ctx, quads, view)`.
  - `renderDebug(element, toggle, debug)` (new `toggle` argument).
  - `body[data-dict]`.
  - Element ids `toggle`, `about-button`, `word-card`, `card-head`, `card-close`, `card-word`, `card-reading`, `card-status`, `card-entries`, `about`, `about-close` and `debug-toggle`.

- [ ] **Step 1: Write the failing E2E tests**

Append to `test/e2e/helpers.js`:

```js
// Taps the centre of character `index` of the first Chinese token reading `text` in the last scan,
// mapping its quad through the frozen snapshot's on-screen box.
export async function tapChar(page, text, index) {
  const scan = await lastScan(page);
  const token = scan.lines.flatMap((l) => l.tokens).find((t) => t.text === text);
  if (!token) throw new Error(`no token reads ${text}`);
  const [q0, , q2] = token.chars[index].quad;
  const box = await page.locator('#snapshot').boundingBox();
  const scale = box.width / scan.region.width;
  await page.mouse.click(box.x + ((q0[0] + q2[0]) / 2) * scale, box.y + ((q0[1] + q2[1]) / 2) * scale);
}
```

`test/e2e/meaning.spec.js`:

```js
import { expect, test } from '@playwright/test';
import { MENU, body, freeze, overlayInk, serveMenu, startWhenReady, tapChar } from './helpers.js';

test.beforeEach(({ context }) => serveMenu(context));

const card = (page) => page.locator('#word-card');

async function scanMenu(page) {
  await startWhenReady(page, `./?img=${MENU}`);
  await freeze(page);
}

test('tapping a character shows its word, reading and meaning', async ({ page }) => {
  await scanMenu(page);
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await tapChar(page, '阿公可口面', 3);
  await expect(card(page)).toBeVisible();
  await expect(page.locator('#card-word')).toHaveText('可口');
  await expect(page.locator('#card-reading')).toHaveText('kě kǒu');
  await expect(page.locator('#card-entries')).toContainText('tasty');
  await expect(page.locator('#card-entries .pinyin')).toHaveCount(0); // same reading as above: not repeated
});

test('tapping away from the text, or the close button, closes the card', async ({ page }) => {
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 0);
  await expect(card(page)).toBeVisible();
  const box = await page.locator('#snapshot').boundingBox();
  await page.mouse.click(box.x + 4, box.y + 4); // corner of the photo: no text there
  await expect(card(page)).toBeHidden();

  await tapChar(page, '阿公可口面', 0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toBeHidden();
});

test('says the dictionary is loading until it arrives', async ({ page, context }) => {
  let release;
  const arrived = new Promise((resolve) => (release = resolve));
  await context.route(
    (url) => url.pathname.endsWith('/cedict.tsv'),
    async (route) => {
      await arrived;
      await route.continue();
    },
  );
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-status')).toHaveText('Dictionary loading…');
  release();
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
});

test('the eye button hides and shows the pinyin', async ({ page }) => {
  await scanMenu(page);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Hide pinyin' }).click();
  await expect.poll(() => overlayInk(page)).toBe(0);
  await page.getByRole('button', { name: 'Show pinyin' }).click();
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
});

test('About credits the dictionary and can show debug info', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await page.getByRole('button', { name: 'About PinyinLens' }).click();
  const about = page.getByRole('dialog', { name: 'About PinyinLens' });
  await expect(about).toContainText('CC-CEDICT');
  await expect(about.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
    'href',
    'https://creativecommons.org/licenses/by-sa/4.0/',
  );
  await about.getByRole('button', { name: 'Show debug info' }).click();
  await expect(page.locator('#debug')).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
});

test('meanings work offline on a repeat visit', async ({ page, context }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
  await freeze(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
});

test('swiping the card down closes it', async ({ page }) => {
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 0);
  const head = await page.locator('#card-word').boundingBox();
  await page.mouse.move(head.x + 4, head.y + 4);
  await page.mouse.down();
  await page.mouse.move(head.x + 4, head.y + 84, { steps: 5 });
  await page.mouse.up();
  await expect(card(page)).toBeHidden();
});

test('a card closed while the dictionary loads stays closed when it arrives', async ({ page, context }) => {
  let release;
  const arrived = new Promise((resolve) => (release = resolve));
  await context.route(
    (url) => url.pathname.endsWith('/cedict.tsv'),
    async (route) => {
      await arrived;
      await route.continue();
    },
  );
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  release();
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200))); // let any late reply land
  await expect(card(page)).toBeHidden();
});

test('a dictionary that failed to load says so, and the next tap tries again', async ({ page, context }) => {
  const dictRoute = (url) => url.pathname.endsWith('/cedict.tsv');
  await context.route(dictRoute, (route) => route.abort());
  await scanMenu(page);
  await expect(body(page)).toHaveAttribute('data-dict', 'failed', { timeout: 30_000 });
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-status')).toContainText('Dictionary unavailable', { timeout: 30_000 });
  await context.unroute(dictRoute);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
  await expect(body(page)).toHaveAttribute('data-dict', 'ready');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build && npx playwright test test/e2e/meaning.spec.js`
Expected: all 9 FAIL. There is no `data-dict` attribute, no card, and no eye or About button yet.

- [ ] **Step 3: Markup.** Three edits to `index.html`:

Find:

```html
  <body data-state="intro" data-engine="loading">
```

Replace with:

```html
  <body data-state="intro" data-engine="loading" data-dict="loading">
```

Find:

```html
    <section id="intro" class="card" aria-labelledby="intro-title">
```

Replace with:

```html
    <button id="toggle" type="button" aria-label="Hide pinyin" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        <line class="slash" x1="4" y1="20" x2="20" y2="4" />
      </svg>
    </button>

    <button id="about-button" type="button" aria-label="About PinyinLens">i</button>

    <section id="word-card" aria-label="Word meaning" hidden>
      <div id="card-head">
        <div>
          <p id="card-word" lang="zh-Hans"></p>
          <p id="card-reading"></p>
        </div>
        <button id="card-close" type="button" aria-label="Close">×</button>
      </div>
      <p id="card-status" role="status"></p>
      <ul id="card-entries"></ul>
    </section>

    <section id="intro" class="card" aria-labelledby="intro-title">
```

Find:

```html
    <div id="notice" role="status" hidden></div>
    <pre id="debug" hidden></pre>
```

Replace with:

```html
    <div id="notice" role="status" hidden></div>
    <pre id="debug" hidden></pre>

    <dialog id="about" class="card" aria-labelledby="about-title">
      <h2 id="about-title">About PinyinLens</h2>
      <p>Reads Chinese text through your camera, entirely on your device: nothing you scan is uploaded.</p>
      <h3>Credits</h3>
      <ul>
        <li>
          Word meanings: <a href="https://cc-cedict.org/wiki/">CC-CEDICT</a>, snapshot of 2026-10-04 from
          <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict">MDBG</a>, licensed under
          <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Shortened here to the first
          three meanings of each entry, without its "variant of" and "see" references.
        </li>
        <li>
          Text recognition: <a href="https://github.com/PaddlePaddle/PaddleOCR">PaddleOCR</a> models (Apache 2.0) on
          <a href="https://onnxruntime.ai/">ONNX Runtime Web</a> (MIT).
        </li>
        <li>Pinyin: <a href="https://github.com/zh-lx/pinyin-pro">pinyin-pro</a> (MIT).</li>
      </ul>
      <button id="debug-toggle" type="button" class="secondary">Show debug info</button>
      <button id="about-close" type="button">Close</button>
    </dialog>
```

- [ ] **Step 4: Styles.** Append to `src/app/style.css`:

```css
/* Round icon buttons over the camera view. */
#toggle,
#about-button {
  position: fixed;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

#toggle {
  right: calc(20px + env(safe-area-inset-right));
  bottom: calc(36px + env(safe-area-inset-bottom));
  width: 48px;
  height: 48px;
}

#toggle svg {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

#toggle .slash {
  display: none;
}

#toggle[data-off] .slash {
  display: inline;
}

#about-button {
  top: calc(12px + env(safe-area-inset-top));
  right: calc(12px + env(safe-area-inset-right));
  width: 36px;
  height: 36px;
  font: italic 600 18px/1 Georgia, serif;
}

/* Word card: a bottom sheet above the shutter, so the controls stay usable while it is open. */
#word-card {
  position: fixed;
  left: 50%;
  bottom: calc(112px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  width: min(calc(100vw - 24px), 480px);
  max-height: 45vh;
  border-radius: 16px;
  background: rgba(18, 22, 28, 0.96);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  transform: translateX(-50%);
}

/* The head is the grab handle: swiping down on it dismisses the card. */
#card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 12px 6px 18px;
  touch-action: none;
}

#card-word {
  font-size: 2rem;
  line-height: 1.2;
}

#card-reading {
  color: var(--accent);
  font-size: 1.05rem;
}

#card-close {
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #cfd6e0;
  font-size: 22px;
  line-height: 1;
}

#card-status {
  padding: 0 18px;
  color: #9aa4b2;
}

#card-status:empty {
  display: none;
}

#card-entries {
  overflow: auto;
  padding: 4px 18px 16px;
  list-style: none;
}

#card-entries li {
  padding: 6px 0;
  color: #cfd6e0;
  line-height: 1.4;
}

#card-entries li + li {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

#card-entries .pinyin {
  margin-right: 8px;
  color: #9aa4b2;
}

/* About: a modal <dialog>, centred by the browser. */
dialog.card {
  inset: 0;
  height: fit-content;
  margin: auto;
  border: 0;
  color: inherit;
  transform: none;
}

dialog.card::backdrop {
  background: rgba(0, 0, 0, 0.55);
}

.card h3 {
  margin: 16px 0 6px;
  font-size: 1rem;
}

.card ul {
  padding-left: 1.2em;
}

.card li + li {
  margin-top: 6px;
}

.card a {
  color: var(--accent);
}
```

- [ ] **Step 5: Taps and the word highlight**

`src/app/gestures.js` becomes:

```js
// Pointer gestures on an element (spec §7.3): two-finger pinch reports a scale factor about the
// fingers' midpoint plus the midpoint's movement; one-finger drag reports movement; a quick
// one-finger touch that barely moves is a tap; the mouse wheel zooms (desktop testing).
// Coordinates are client pixels.
const TAP_SLOP = 10; // px
const TAP_MS = 300;

export function bindGestures(element, { onPinch, onDrag, onTap }) {
  const pointers = new Map();
  let last = null; // { distance, mid } while pinching, { point } while dragging
  let tap = null; // { id, x, y, time } while a touch could still be a tap

  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    last = null;
    tap = pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
  });

  element.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= TAP_SLOP) tap = null;
    const [a, b] = pointers.values();
    if (b) {
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (last?.distance) {
        onPinch(distance / last.distance, mid[0], mid[1]);
        onDrag(mid[0] - last.mid[0], mid[1] - last.mid[1]);
      }
      last = { distance, mid };
    } else {
      if (last?.point) onDrag(a[0] - last.point[0], a[1] - last.point[1]);
      last = { point: a };
    }
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    last = null;
  };
  element.addEventListener('pointerup', (event) => {
    const tapped = tap?.id === event.pointerId && event.timeStamp - tap.time < TAP_MS;
    tap = null;
    release(event);
    if (tapped) onTap(event.clientX, event.clientY);
  });
  element.addEventListener('pointercancel', (event) => {
    tap = null;
    release(event);
  });

  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      onPinch(Math.exp(-event.deltaY / 300), event.clientX, event.clientY);
    },
    { passive: false },
  );
}
```

Append to `src/app/overlay.js`:

```js
// Outlines the tapped word (spec §7.2): one box from its first character's leading edge to its
// last character's trailing edge, in reading orientation. quads are content px.
export function drawHighlight(ctx, quads, view) {
  if (!quads.length) return;
  const first = quads[0].map((p) => toScreen(view, p));
  const last = quads[quads.length - 1].map((p) => toScreen(view, p));
  const outline = [first[0], last[1], last[2], first[3]];
  ctx.beginPath();
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#4fc3f7';
  ctx.stroke();
}
```

- [ ] **Step 6: Rendering.** `src/app/ui.js` becomes:

```js
// Renders app state into the static DOM of index.html (spec §7.5, §8).

const ERRORS = {
  unsupported: {
    title: "This browser can't run PinyinLens",
    hint: 'It needs WebAssembly SIMD: Safari 16.4 or later on iPhone, or a recent Chrome, Edge or Firefox.',
  },
  camera: {
    title: 'Camera unavailable',
    hint: 'Allow camera access: on iPhone, Settings › Safari › Camera; in Chrome, tap the lock icon › Permissions › Camera.',
  },
  engine: {
    title: "Couldn't load the reading engine",
    hint: 'Check your connection and try again. If it keeps failing, reset the app data.',
  },
};

const SHUTTER_LABELS = { loading: 'Loading reading engine', freeze: 'Freeze and scan', busy: 'Scanning', resume: 'Back to camera' };
const RING = 2 * Math.PI * 32; // circumference of the shutter's progress ring (r = 32)

export function render(els, state) {
  document.body.dataset.state = state.screen;
  document.body.dataset.engine = state.engine;
  document.body.dataset.dict = state.dict;
  els.intro.hidden = state.screen !== 'intro';
  els.error.hidden = state.screen !== 'error';
  if (state.error) {
    const copy = ERRORS[state.error.kind];
    els.errorTitle.textContent = copy.title;
    els.errorMessage.textContent = state.error.message ? `${copy.hint} (${state.error.message})` : copy.hint;
    els.retry.hidden = state.error.kind === 'unsupported';
    els.reset.hidden = state.error.kind !== 'engine';
  }
  const mode =
    state.screen === 'scanning' ? 'busy' : state.screen === 'frozen' ? 'resume' : state.engine === 'ready' ? 'freeze' : 'loading';
  els.shutter.hidden = !['live', 'scanning', 'frozen'].includes(state.screen);
  els.shutter.dataset.mode = mode;
  els.shutter.disabled = mode === 'loading' || mode === 'busy';
  els.shutter.setAttribute('aria-label', SHUTTER_LABELS[mode]);
  els.progress.style.strokeDashoffset = String(RING * (1 - state.progress));
  els.notice.hidden = !state.notice;
  els.notice.textContent = state.notice ?? '';
  els.toggle.hidden = state.screen !== 'frozen';
  els.toggle.setAttribute('aria-label', state.pinyinVisible ? 'Hide pinyin' : 'Show pinyin');
  els.toggle.toggleAttribute('data-off', !state.pinyinVisible);
  renderCard(els, state.card, state.dict);
  if (state.about && !els.about.open) els.about.showModal();
  else if (!state.about && els.about.open) els.about.close();
}

// The word card (spec §7.4): the tapped word straight away, its dictionary entries when they arrive.
function renderCard(els, card, dict) {
  els.card.hidden = !card;
  if (!card) return;
  els.cardWord.textContent = card.word;
  els.cardReading.textContent = card.reading;
  els.cardStatus.textContent = card.error
    ? `Dictionary unavailable (${card.error})`
    : !card.entries
      ? dict === 'ready'
        ? ''
        : 'Dictionary loading…'
      : card.entries.length
        ? ''
        : 'Not in the dictionary.';
  // An entry's pinyin is shown only when it isn't the reading above (e.g. 行 read xíng, not háng).
  const plain = (pinyin) => pinyin.toLowerCase().replace(/\s+/g, '');
  els.cardEntries.replaceChildren(
    ...(card.entries ?? []).map(({ pinyin, glosses }) => {
      const item = document.createElement('li');
      if (plain(pinyin) !== plain(card.reading)) {
        const reading = document.createElement('span');
        reading.className = 'pinyin';
        reading.textContent = pinyin;
        item.append(reading);
      }
      item.append(glosses.join(' / '));
      return item;
    }),
  );
}

// The debug panel (spec §8; ?debug, or the About sheet's button): what to screenshot when
// something misbehaves on a phone.
export function renderDebug(element, toggle, debug) {
  toggle.textContent = debug.enabled ? 'Hide debug info' : 'Show debug info';
  element.hidden = !debug.enabled;
  if (!debug.enabled) return;
  const ms = (value) => (value == null ? '–' : `${Math.round(value)} ms`);
  const t = debug.timings ?? {};
  const region = debug.region ? `${debug.region.width}×${debug.region.height}` : '–';
  element.textContent = [
    `assets ${debug.version || '–'} · models ${debug.models || '–'}`,
    `engine start ${ms(debug.initMs)}`,
    `last scan ${region}: ${ms(t.total)} (det ${ms(t.det)}, rec ${ms(t.rec)}, post ${ms(t.post)})`,
    `last error ${debug.error || '–'}`,
    navigator.userAgent,
  ].join('\n');
}
```

- [ ] **Step 7: Wiring.** Edits to `src/app/main.js`, in file order:

1. Find:

```js
import { createEngine } from './engine.js';
import { bindGestures } from './gestures.js';
import { drawLabels, labelFont, layoutLabels } from './overlay.js';
```

   Replace with:

```js
import { createDictionaryClient } from './dictionary.js';
import { createEngine } from './engine.js';
import { bindGestures } from './gestures.js';
import { charAt } from './hittest.js';
import { drawHighlight, drawLabels, labelFont, layoutLabels } from './overlay.js';
```

2. Find:

```js
const NOTICE_MS = 4000;
```

   Replace with:

```js
const NOTICE_MS = 4000;
const SWIPE_CLOSE = 40; // px down on the card's head that dismisses it
```

3. Find:

```js
  debug: byId('debug'),
```

   Replace with:

```js
  debug: byId('debug'),
  toggle: byId('toggle'),
  aboutButton: byId('about-button'),
  about: byId('about'),
  aboutClose: byId('about-close'),
  debugToggle: byId('debug-toggle'),
  card: byId('word-card'),
  cardHead: byId('card-head'),
  cardClose: byId('card-close'),
  cardWord: byId('card-word'),
  cardReading: byId('card-reading'),
  cardStatus: byId('card-status'),
  cardEntries: byId('card-entries'),
```

4. Find:

```js
let engine = null;
```

   Replace with:

```js
let engine = null;
let dictionary = null;
```

5. Find:

```js
let frozen = null; // { region, view, lines } while scanning or frozen
```

   Replace with:

```js
let frozen = null; // { region, view, lines } while scanning or frozen
let selection = null; // the word on the card: { line, token, start, end } in frozen.lines
let lookupSeq = 0; // bumped by every tap and close, so a late dictionary reply can't reopen the card
```

6. Find:

```js
  renderDebug(els.debug, debug);
```

   Replace with:

```js
  renderDebug(els.debug, els.debugToggle, debug);
```

7. Find:

```js
    afterFirstLoad();
```

   Replace with:

```js
    afterFirstLoad();
    startDictionary(manifest);
```

8. Find:

```js
  return { message, transfer: [message.wasm, message.det, message.rec] };
```

   Replace with:

```js
  return { message, transfer: [message.wasm, message.det, message.rec] };
}

// The dictionary loads after the engine, so it never slows the first scan. A failed load is
// retried by the next lookup.
function startDictionary(manifest) {
  dictionary = createDictionaryClient({
    spawnWorker: () => new Worker(new URL('../worker/dict.worker.js', import.meta.url), { type: 'module' }),
    loadBytes: async () => (await loader.load(manifest, [manifest.dict])).get(manifest.dict.file),
  });
  dictionary.load().then(
    () => dispatch({ type: 'dict-ready' }),
    (err) => {
      debug.error = `dictionary: ${err.message}`;
      dispatch({ type: 'dict-failed' });
    },
  );
```

9. Find:

```js
  frozen = null;
```

   Replace with:

```js
  frozen = null;
  selection = null;
  lookupSeq++;
```

10. Find:

```js
  if (!frozen?.lines.length) return;
```

   Replace with:

```js
  if (!frozen?.lines.length || !state.pinyinVisible) return;
```

11. Find:

```js
  drawLabels(ctx, layoutLabels(frozen.lines, frozen.view, measure));
```

   Replace with:

```js
  drawLabels(ctx, layoutLabels(frozen.lines, frozen.view, measure));
  if (selection) {
    const { line, token, start, end } = selection;
    const chars = frozen.lines[line].tokens[token].chars.slice(start, end);
    drawHighlight(ctx, chars.map((c) => c.quad), frozen.view);
  }
}

// ── Tap for meaning ─────────────────────────────────────────────────────────────────────────

// A tap on the frozen view: the word under it goes on the card; a tap away from the text closes it.
async function showMeaning(x, y) {
  const hit = charAt(frozen.lines, frozen.view, x, y);
  if (!hit) return closeCard();
  const seq = ++lookupSeq;
  const { chars } = frozen.lines[hit.line].tokens[hit.token];
  const readings = chars.map((c) => c.pinyin ?? '');
  const show = (start, end, entries, error = null) => {
    selection = { line: hit.line, token: hit.token, start, end };
    const word = chars.slice(start, end);
    const reading = readings.slice(start, end).filter(Boolean).join(' ');
    dispatch({ type: 'show-card', card: { word: word.map((c) => c.ch).join(''), reading, entries, error } });
    queueOverlay();
  };
  show(hit.char, hit.char + 1, null); // the character alone until the dictionary finds its word
  try {
    const result = await dictionary.lookup(chars.map((c) => c.ch).join(''), hit.char, readings);
    if (seq !== lookupSeq) return;
    if (state.dict !== 'ready') dispatch({ type: 'dict-ready' });
    show(result.start, result.end, result.entries);
  } catch (err) {
    if (seq !== lookupSeq) return;
    debug.error = `dictionary: ${err.message}`;
    show(hit.char, hit.char + 1, null, err.message);
  }
}

function closeCard() {
  lookupSeq++;
  selection = null;
  if (state.card) dispatch({ type: 'close-card' });
  queueOverlay();
```

12. Find:

```js
    resume();
  }
});
```

   Replace with:

```js
    resume();
  }
});
els.toggle.addEventListener('click', () => {
  dispatch({ type: 'toggle-pinyin' });
  queueOverlay();
});
els.aboutButton.addEventListener('click', () => dispatch({ type: 'open-about' }));
els.aboutClose.addEventListener('click', () => dispatch({ type: 'close-about' }));
els.about.addEventListener('close', () => state.about && dispatch({ type: 'close-about' })); // Escape key
els.debugToggle.addEventListener('click', () => {
  debug.enabled = !debug.enabled;
  renderDebug(els.debug, els.debugToggle, debug);
});
els.cardClose.addEventListener('click', closeCard);
let swipeFrom = null;
els.cardHead.addEventListener('pointerdown', (event) => {
  swipeFrom = event.clientY;
});
// On window: a mouse isn't captured, so its release can land anywhere.
addEventListener('pointerup', (event) => {
  if (swipeFrom !== null && event.clientY - swipeFrom > SWIPE_CLOSE) closeCard();
  swipeFrom = null;
});
addEventListener('pointercancel', () => {
  swipeFrom = null;
});
```

13. Find:

```js
  },
});
```

   Replace with:

```js
  },
  onTap(x, y) {
    if (state.screen === 'frozen') showMeaning(x, y);
  },
});
```

14. Find:

```js
render(els, state);
renderDebug(els.debug, debug);
```

   Replace with:

```js
render(els, state);
renderDebug(els.debug, els.debugToggle, debug);
```


- [ ] **Step 8: Run the E2E tests to verify they pass**

Run: `npm run build && npx playwright test test/e2e/meaning.spec.js`
Expected: PASS, 9 tests.

- [ ] **Step 9: Run everything and look at it**

Run: `npm test && npx playwright test`
Expected: Vitest 24 files / 145 tests and Playwright 25 tests pass.

Look at it: `npm run dev`, then open `http://localhost:5173/PinyinLens/?img=/PinyinLens/test/fixtures/menu-kkm.png` at a phone-sized viewport (390×844), or take Playwright screenshots of the same steps. Freeze, tap 可 in 阿公可口面, and check that 可口 is outlined and the card sits above the shutter. Then tap 面 (two entries, no repeated pinyin), the eye button, and About. Headless Chromium in the sandbox has no CJK font, so the card's characters show as boxes there; phones have the fonts.

- [ ] **Step 10: Commit**

```bash
git add index.html src/app/style.css src/app/gestures.js src/app/overlay.js src/app/ui.js src/app/main.js test/e2e/helpers.js test/e2e/meaning.spec.js
git commit -m "Tap a character for its meaning; eye button; About sheet

A tap on the frozen scan outlines the word and opens a card with its pinyin
and CC-CEDICT meanings, loaded after the engine in a second worker. The card
says when the dictionary is still loading or unavailable, closes on a tap
away, its close button or a swipe down, and ignores late replies. The eye
button hides the pinyin; About credits CC-CEDICT (CC BY-SA 4.0) and the other
components and can show the debug panel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md`

- [ ] **Step 1: README.** Apply these edits:

1. Find:

```markdown
3. Tap the shutter to freeze and scan. Pinch and drag to look around; tap again to go back to the camera.
```

   Replace with:

```markdown
3. Tap the shutter to freeze and scan. Pinch and drag to look around; tap again to go back to the camera.
4. Tap a character for its word's meaning. The eye button hides the pinyin; the **i** button shows credits.
```

2. Find:

```markdown
Add `?debug` to the URL for a panel with timings and versions. `?det=v6-small&rec=v6-small` tries the larger,
```

   Replace with:

```markdown
Add `?debug` to the URL (or tap **i** › Show debug info) for a panel with timings and versions. `?det=v6-small&rec=v6-small` tries the larger,
```

3. Find:

```markdown
| Offline | one service worker for the app shell (vite-plugin-pwa); models in the Cache API, SHA-256 verified: `src/app/assets.js` |
```

   Replace with:

```markdown
| Word meanings | CC-CEDICT (`data/cedict/`), compacted at build time (`scripts/lib/cedict.js`); words found by forward maximum matching in a second worker: `src/text/dict.js`, `src/worker/dict-core.js`, `src/app/dictionary.js`, `src/app/hittest.js` |
| Offline | one service worker for the app shell (vite-plugin-pwa); models and dictionary in the Cache API, SHA-256 verified: `src/app/assets.js` |
```

4. Find:

```markdown
MIT. OCR models: PaddleOCR (Apache-2.0), via PaddlePaddle and RapidOCR releases.
```

   Replace with:

```markdown
MIT. OCR models: PaddleOCR (Apache-2.0), via PaddlePaddle and RapidOCR releases.
Dictionary: [CC-CEDICT](https://cc-cedict.org/wiki/) (CC BY-SA 4.0), see `data/cedict/README.md`.
```


- [ ] **Step 2: CLAUDE.md.** Apply these edits:

1. Find:

```markdown
- Detector thresholds come only from `scripts/models.config.js` (each model's official config).
```

   Replace with:

```markdown
- Detector thresholds come only from `scripts/models.config.js` (each model's official config).
- `data/cedict/` is a vendored CC-CEDICT snapshot (CC BY-SA 4.0). Replacing it means updating its README and the
  About sheet's attribution in `index.html`.
```

2. Find:

```markdown
- `npm run build`: publish shipped models to `public/ocr/` (gitignored) and build `dist/`
```

   Replace with:

```markdown
- `npm run build`: publish shipped models and the compacted dictionary to `public/ocr/` (gitignored) and build `dist/`
```


- [ ] **Step 3: Spec.** Record the deviations approved for this plan:

1. Find:

```markdown
| `loadDict { bytes }` | `dictReady` |
| `lookup { id, lineIndex, charIndex }` | `entries { id, word, span, entries }` |

The worker keeps the last scan's `lines` so that `lookup` can resolve indices. A new `scan` replaces them.
```

   Replace with:

```markdown

**Dictionary worker** (a second worker, `src/worker/dict.worker.js`; revised in Plan 3, 2026-10-04). Lookups are stateless: the main thread sends the tapped character's CJK run, so the OCR worker keeps no scan state and a slow dictionary load never delays a scan.

| Main → Worker | Worker → Main |
|---|---|
| `load { id, bytes }` (the compact dictionary, transferred) | `ready { id, words }` or `error` |
| `lookup { id, run, index, readings }` | `result { id, result: { word, start, end, entries } }` or `error { id, message }` |
```

2. Find:

```markdown
- CC-CEDICT: a snapshot mirrored as a GitHub Release asset of this repo, converted by `scripts/build-dict.js` into a compact format: simplified headword → [tone-marked pinyin, first 3 glosses].
```

   Replace with:

```markdown
- CC-CEDICT: a snapshot vendored in `data/cedict/` (revised in Plan 3: 4MB gzipped in git is simpler than a Release asset). `scripts/fetch-assets.js` compacts it into `public/ocr/cedict.tsv`, one line per reading: simplified headword, tone-marked pinyin, the first 3 glosses ("variant of" and "see" references dropped). It is listed in the manifest as `dict` and loaded after the engine is ready, so it never delays the first scan.
```

3. Find:

```markdown
- Hit-test: inverse-transform the tap point to snapshot space and find the character quad containing it. The word is found by segmenting that character's CJK run with CC-CEDICT forward maximum matching and taking the segment that contains the character.
- Worker lookup:
  1. The whole word in CC-CEDICT.
  2. Otherwise, a greedy longest-match split of the word, each part with its entries (e.g. 可口面 → 可口 *tasty* + 面 *noodles*).
  3. Characters with several readings list every entry, with the reading that matches pinyin-pro's choice first.
- A bottom card shows the characters (large), pinyin, and up to 3 glosses per entry. It's dismissed by tapping outside it or swiping down.
- If CC-CEDICT hasn't loaded yet, the card says "Dictionary loading…" and fills in when it's ready.
- An About sheet carries the CC-CEDICT (CC-BY-SA 4.0) attribution.
```

   Replace with:

```markdown
- Hit-test: the character quad containing the tap point (in screen space), or else the nearest character centre within one character size (at least 22px, so small text is still tappable).
- Lookup: the character's CJK run is segmented with CC-CEDICT forward maximum matching (words up to 8 characters; an unknown character is a word of its own), and the segment containing the character is the word: 阿公可口面 → 阿公 · 可口 · 面. Every entry for the word is listed, the ones whose reading matches pinyin-pro's first.
- A bottom card, above the shutter, shows the word (large), its pinyin, and up to 3 glosses per entry; an entry's pinyin is shown only when it differs from the word's. The word is outlined on the overlay. The card closes on a tap away from the text, its close button, or a swipe down on its head.
- If CC-CEDICT hasn't loaded yet, the card shows the tapped character and "Dictionary loading…", then fills in. If the dictionary can't be loaded, the card says "Dictionary unavailable (…)" and the next tap tries again. A word it doesn't have: "Not in the dictionary."
- An About sheet carries the CC-CEDICT (CC BY-SA 4.0) attribution.
```

4. Find:

```markdown
- **Show/hide toggle** (bottom right, frozen only): an eye icon that hides pinyin and highlights.
```

   Replace with:

```markdown
- **Show/hide toggle** (bottom right, frozen only): an eye icon that hides pinyin and highlights. The choice is kept across scans.
- **About** (top right, an "i"): what the app does, credits and licences, and a "Show debug info" button.
```

5. Find:

```markdown
**Debug panel** (`?debug`, or long-press About): backend, last scan's per-stage timings, per-asset cache status, app and model versions, last error. This is how on-device problems get reported back.

**Not yet built (after Plan 2, 2026-10-04):** while a download retries, the shutter's progress ring simply waits (no "Download interrupted, retrying" text); after the retries the error card appears as specified. The debug panel shows versions, models, engine start time, last-scan timings and the last error, but not yet the backend, per-asset cache status or peak memory, and it opens with `?debug` only (long-press About comes with Plan 3's About sheet).
```

   Replace with:

```markdown
**Debug panel** (`?debug`, or About › Show debug info; revised in Plan 3, a button being easier to find than a long press): backend, last scan's per-stage timings, per-asset cache status, app and model versions, last error. This is how on-device problems get reported back.

**Not yet built (after Plan 2, 2026-10-04):** while a download retries, the shutter's progress ring simply waits (no "Download interrupted, retrying" text); after the retries the error card appears as specified. The debug panel shows versions, models, engine start time, last-scan timings and the last error, but not yet the backend, per-asset cache status or peak memory,.
```

6. Find:

```markdown
    engine.js        # OCR worker client: one request at a time, watchdog, respawn
```

   Replace with:

```markdown
    engine.js        # OCR worker client: one request at a time, watchdog, respawn
    dictionary.js    # dictionary worker client: load once, concurrent lookups, retry after failure
    hittest.js       # tap point → character (pure)
```

7. Find:

```markdown
  worker/            # core.js (message protocol, Node-testable), ocr.worker.js (entry)
  ocr/               # image.js, detect.js, geometry.js, recognize.js, pipeline.js
  text/              # annotate.js (dict.js arrives with Plan 3)
```

   Replace with:

```markdown
  worker/            # core.js + ocr.worker.js (OCR), dict-core.js + dict.worker.js (dictionary), replies.js
  ocr/               # image.js, detect.js, geometry.js, recognize.js, pipeline.js
  text/              # annotate.js, dict.js (segmentation + lookup)
data/cedict/         # vendored CC-CEDICT snapshot + README (licence, date, hash)
```

8. Find:

```markdown
  fetch-assets.js    # build-time: shipped models + ORT wasm → public/ocr/ + manifest.json
  build-dict.js      # CC-CEDICT → compact format
```

   Replace with:

```markdown
  fetch-assets.js    # build-time: shipped models + ORT wasm + compacted CC-CEDICT → public/ocr/ + manifest.json
  lib/cedict.js      # CC-CEDICT → compact format
```


- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run build && npx playwright test`
Expected: Vitest 24 files / 145 tests and Playwright 25 tests pass.

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md
git commit -m "Document tap-for-meaning, the dictionary snapshot and Plan 3's spec revisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

- **Publish:** merge into `main` and `git push origin main` (the user has authorized that one command outside the sandbox). CI tests, builds and deploys. The first deploy changes the manifest version, so each phone downloads the models once more, plus the 7.5MB dictionary (about 3.3MB if GitHub Pages compresses it).
- **On-device check (user):** on iPhone (Safari and the Home Screen app) and Android Chrome:
  - Tap words on a real menu, including small text and a word with two readings.
  - Close the card by tapping away, with its button, and by swiping down.
  - Hide and show the pinyin.
  - Open About and its debug panel.
  - Repeat a visit in airplane mode and check that meanings still work.
