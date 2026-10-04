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
