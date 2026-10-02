# OCR Engine Implementation Plan (Rebuild, Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old app with a DOM-free, Node-tested OCR engine that reads `image.png` (the KKM menu) into Chinese text with per-character positions and tone-marked pinyin, plus a benchmark that picks which PaddleOCR models to ship.

**Architecture:** Pure-JS modules on typed arrays (`src/ocr/*`, `src/text/*`) take an RGBA image and return lines → characters → pinyin, with character quads in image pixels. ONNX Runtime Web (plain WASM build, single-threaded) runs the PaddleOCR models; the `ort` module is injected, so the same code runs in Node (tests and benchmark, this plan) and in a browser Worker (Plan 2). Node-only helpers (file I/O, model download, PNG decoding) live in `scripts/lib/`.

**Tech Stack:** Node ≥ 22 (ESM), onnxruntime-web 1.24.3, pinyin-pro 3.28.1, Vitest 5.0.3, pngjs 7.0.0, yaml 2.9.1.

**Spec:** `docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md`. This plan implements §6 (OCR pipeline), the §9.1–9.3 test layers for it, and §6.7 (model choice). Plan 2 (app shell) and Plan 3 (meaning card + toggle) follow.

**Provenance:** every code block in this plan was run during planning, in a scratch copy of this layout, with the real models and fixture: 62 tests passed, and the benchmark produced the numbers quoted in Task 9.

## Global Constraints

- Node ≥ 22, ESM only (`"type": "module"`).
- Exact dependency versions (several test expectations depend on them): `onnxruntime-web` **1.24.3**, `pinyin-pro` **3.28.1**, `vitest` **5.0.3**, `pngjs` **7.0.0**, `yaml` **2.9.1**.
- `src/ocr/**` and `src/text/**` must not use DOM or browser APIs (no `document`, `window`, canvas, `Image`, `OffscreenCanvas`, `fetch`) and must not import Node modules. They run unchanged in a Worker and in Node. Node-only code goes in `scripts/lib/`.
- ONNX Runtime: import from `onnxruntime-web/wasm`; `executionProviders: ['wasm']`; `env.wasm.numThreads = 1`; always provide `env.wasm.wasmBinary` so ORT never fetches anything.
- No cross-origin isolation, no SharedArrayBuffer, no OpenCV, no clipper, no OCR wrapper libraries.
- Detector thresholds live **only** in `scripts/models.config.js` (copied from each model's official `inference.yml`); never hardcode them elsewhere.
- Sandbox environment notes:
  - npm's default cache is read-only: install with `npm_config_cache=$TMPDIR/npm-cache npm install`.
  - Node's `fetch` ignores the sandbox proxy unless `NODE_USE_ENV_PROXY=1` is set.
  - Model hosts: `www.modelscope.cn`, `huggingface.co`, `*.hf.co`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `vitest.config.js`, `.gitignore`, `Claude.md` | Toolchain, test config, ignore rules, agent guidance (rewritten) |
| `scripts/models.config.js` | Candidate models: pinned URLs, SHA-256, sizes, official det params, charset source; `DEFAULT_CONFIG` |
| `scripts/fetch-models.js` | CLI: download + verify models, extract character lists into `models/` |
| `scripts/bench.js` | CLI: benchmark every det × rec × long-side on the labelled fixtures |
| `scripts/lib/onnx-meta.js` | Read ONNX `metadata_props` (charset of RapidOCR-converted models) |
| `scripts/lib/yaml-charset.js` | Read `PostProcess.character_dict` from official `inference.yml` |
| `scripts/lib/model-files.js` | `models/` layout; `loadDet(id)`, `loadRec(id)` |
| `scripts/lib/ort-node.js` | ORT configured for Node exactly as the browser will be |
| `scripts/lib/png.js` | PNG → RGBA image |
| `scripts/lib/metrics.js` | Levenshtein, CER, `scoreRequired` |
| `scripts/lib/choose.js` | Spec §6.7 selection rule |
| `src/ocr/image.js` | RGBA resize and parallelogram warp |
| `src/ocr/geometry.js` | Connected components, hull, min-area rect, unclip, box score |
| `src/ocr/detect.js` | Det input size, det tensor, DB postprocess |
| `src/ocr/recognize.js` | Line crop + frame, rec tensor, CTC decode, character spans |
| `src/ocr/pipeline.js` | `createOcr` → `{ scan, warmup, release }` |
| `src/text/annotate.js` | Lines → CJK / non-CJK tokens with per-character pinyin |
| `test/unit/*.test.js` | Pure-function tests (fast, no models) |
| `test/integration/*.test.js` | Tests that load models (need `npm run fetch-models`) |
| `test/fixtures/menu-kkm.png`, `labels.json` | The menu photo (moved from repo-root `image.png`) and its ground truth |
| `docs/benchmarks/2026-10-02-ocr-models.md` | Benchmark results and the model decision |

**Data shapes shared across tasks**

```js
// RGBA image
{ data: Uint8ClampedArray, width, height }
// Quad: [topLeft, topRight, bottomRight, bottomLeft], each [x, y] in image pixels
// (for vertical lines, "top" is the reading start; see cropLine)
// scan() line
{ quad, vertical: boolean, score: number, text: string, chars: [{ ch, prob, quad }] }
// annotate() line
{ quad, vertical, score, text, tokens: [{ text, isCJK, chars: [{ ch, pinyin: string|null, quad }] }] }
```

---

### Task 1: Clean slate, toolchain, and model-metadata readers

**Files:**
- Delete: `src/main.js`, `src/ocr.js`, `src/camera.js`, `src/overlay.js`, `src/pinyin.js`, `src/zoom.js`, `index.html`, `vite.config.js`, `scripts/copy-wasm.js`, `public/coi-serviceworker.min.js`, `package-lock.json`
- Rewrite: `package.json`, `.gitignore`, `Claude.md`
- Create: `vitest.config.js`, `scripts/lib/onnx-meta.js`, `scripts/lib/yaml-charset.js`
- Test: `test/unit/onnx-meta.test.js`, `test/unit/yaml-charset.test.js`

**Interfaces:**
- Produces: `readOnnxMetadata(buf: Uint8Array) → Record<string,string>`, `charsetFromOnnx(buf) → string[]`, `charsetFromInferenceYaml(text: string) → string[]`

- [ ] **Step 1: Remove the old app**

The old implementation is replaced wholesale (spec §2 explains why). `main` keeps serving the old site until the rebuild merges; the deploy workflow only runs on `main`.

```bash
git rm -q src/main.js src/ocr.js src/camera.js src/overlay.js src/pinyin.js src/zoom.js \
  index.html vite.config.js scripts/copy-wasm.js public/coi-serviceworker.min.js package-lock.json
rm -rf node_modules dist public/*.wasm public/*.mjs
```

Keep `README.md`, `.github/`, `.nojekyll`, `public/icons/.gitkeep`, `models/.gitkeep`, `docs/`. Leave the untracked `image.png` in place; Task 7 moves it.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "pinyin-lens",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run test/unit",
    "fetch-models": "node scripts/fetch-models.js",
    "bench": "node scripts/bench.js"
  },
  "dependencies": {
    "onnxruntime-web": "1.24.3",
    "pinyin-pro": "3.28.1"
  },
  "devDependencies": {
    "pngjs": "7.0.0",
    "vitest": "5.0.3",
    "yaml": "2.9.1"
  }
}
```

- [ ] **Step 3: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Integration tests load ONNX models and run real inference.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 4: Rewrite `.gitignore`**

```
node_modules/
dist/
models/*
!models/.gitkeep
public/*.wasm
public/*.mjs
bench-results.json
.DS_Store
*.local
```

- [ ] **Step 5: Rewrite `Claude.md`**

Subagents read this file automatically. The old one gives wrong instructions (e.g. "the two service workers don't conflict"), so replace it entirely:

```markdown
# PinyinLens

PWA: rear camera → tap to freeze → on-device OCR (PaddleOCR models on ONNX Runtime Web, WASM) →
tone-marked pinyin under each Chinese character. Hosted on GitHub Pages, zero cost, offline after first load.

**Source of truth:** `docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md`.
Implementation plans: `docs/superpowers/plans/`.

## Rules
- No cross-origin isolation, no coi-serviceworker, no SharedArrayBuffer, no multi-threaded WASM (`numThreads = 1`).
- No OpenCV and no OCR wrapper libraries: the pipeline in `src/ocr/` is ours, pure JS on typed arrays.
- `src/ocr/` and `src/text/` stay DOM-free and Node-free (they run in a Worker and in Node tests).
  Node-only helpers live in `scripts/lib/`.
- Detector thresholds come only from `scripts/models.config.js` (each model's official config).
- ONNX Runtime is imported from `onnxruntime-web/wasm` and always given `env.wasm.wasmBinary`.
- One service worker only (vite-plugin-pwa), no `skipWaiting`/`clientsClaim`.

## Commands
- `npm test`: unit + integration tests (integration needs `npm run fetch-models` first)
- `npm run fetch-models`: download pinned models into `models/` (gitignored), verify SHA-256
- `npm run bench`: model × size benchmark on `test/fixtures`

## Environment notes
- npm's default cache may be read-only in the sandbox: `npm_config_cache=$TMPDIR/npm-cache npm install`.
- Behind the sandbox proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1`.
- Model hosts: `www.modelscope.cn`, `huggingface.co`, `*.hf.co`.
```

- [ ] **Step 6: Install dependencies**

Run: `npm_config_cache=$TMPDIR/npm-cache npm install`
Expected: `added … packages`, a new `package-lock.json`, and `node_modules/.bin/vitest` exists.

- [ ] **Step 7: Write the failing tests**

`test/unit/onnx-meta.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { charsetFromOnnx, readOnnxMetadata } from '../../scripts/lib/onnx-meta.js';

// Minimal protobuf encoder for building synthetic ONNX headers.
const varint = (n) => {
  const out = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const lenField = (field, bytes) => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
const intField = (field, n) => [...varint(field * 8), ...varint(n)];
const utf8 = (s) => [...new TextEncoder().encode(s)];
const entry = (key, value) => lenField(14, [...lenField(1, utf8(key)), ...lenField(2, utf8(value))]);

describe('readOnnxMetadata', () => {
  it('reads metadata_props and skips other fields', () => {
    const buf = Uint8Array.from([
      ...intField(1, 8), // ir_version
      ...lenField(2, utf8('pytorch')), // producer_name
      ...entry('character', 'a\nb'),
      ...lenField(7, new Array(300).fill(0)), // graph: 300-byte payload needs a 2-byte length varint
      ...entry('shape', '[3, 48, 320]'),
    ]);
    expect(readOnnxMetadata(buf)).toEqual({ character: 'a\nb', shape: '[3, 48, 320]' });
  });

  it('returns an empty object when there is no metadata', () => {
    expect(readOnnxMetadata(Uint8Array.from(intField(1, 8)))).toEqual({});
  });
});

describe('charsetFromOnnx', () => {
  it('splits the character list one entry per line, keeping space-like entries', () => {
    const buf = Uint8Array.from(entry('character', '　\n一\n乙\n'));
    expect(charsetFromOnnx(buf)).toEqual(['　', '一', '乙']);
  });

  it('throws when the model carries no character list', () => {
    expect(() => charsetFromOnnx(Uint8Array.from(entry('other', 'x')))).toThrow(/character/);
  });
});
```

`test/unit/yaml-charset.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { charsetFromInferenceYaml } from '../../scripts/lib/yaml-charset.js';

const YML = `Global:
  model_name: PP-OCRv6_tiny_rec
Hpi:
  backend_configs:
    paddle_infer:
      trt_dynamic_shapes: &id001
        x:
        - - 1
          - 3
    tensorrt:
      dynamic_shapes: *id001
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - 1
  - true
  - '~'
  - 中
  - ｜
`;

describe('charsetFromInferenceYaml', () => {
  it('returns every character_dict entry as a string', () => {
    expect(charsetFromInferenceYaml(YML)).toEqual(['!', '1', 'true', '~', '中', '｜']);
  });

  it('throws when the file has no character_dict', () => {
    expect(() => charsetFromInferenceYaml('PostProcess:\n  name: DBPostProcess\n')).toThrow(/character_dict/);
  });
});
```

- [ ] **Step 8: Run the tests and confirm they fail**

Run: `npx vitest run test/unit`
Expected: FAIL. Both files fail to resolve `../../scripts/lib/onnx-meta.js` / `yaml-charset.js`.

- [ ] **Step 9: Implement `scripts/lib/onnx-meta.js`**

```js
// Reads ModelProto.metadata_props from an ONNX file without a protobuf library.
// ONNX: ModelProto field 14 = repeated StringStringEntryProto { key = 1; value = 2 }.

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [result, pos];
}

// Yields the length-delimited fields of one protobuf message; skips the others.
function* lengthDelimitedFields(buf, start, end) {
  let pos = start;
  while (pos < end) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) [, pos] = readVarint(buf, pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      yield { field, start: pos, end: pos + len };
      pos += len;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

export function readOnnxMetadata(buf) {
  const decoder = new TextDecoder();
  const meta = {};
  for (const f of lengthDelimitedFields(buf, 0, buf.length)) {
    if (f.field !== 14) continue;
    let key = '';
    let value = '';
    for (const e of lengthDelimitedFields(buf, f.start, f.end)) {
      const text = decoder.decode(buf.subarray(e.start, e.end));
      if (e.field === 1) key = text;
      else if (e.field === 2) value = text;
    }
    meta[key] = value;
  }
  return meta;
}

// RapidOCR-converted PaddleOCR recognizers store their character list, one per line,
// under the "character" metadata key.
export function charsetFromOnnx(buf) {
  const { character } = readOnnxMetadata(buf);
  if (!character) throw new Error('ONNX model has no "character" metadata');
  const chars = character.split('\n');
  if (chars[chars.length - 1] === '') chars.pop();
  return chars;
}
```

- [ ] **Step 10: Implement `scripts/lib/yaml-charset.js`**

```js
import { parse } from 'yaml';

// PaddlePaddle's official ONNX releases ship the character list in inference.yml under
// PostProcess.character_dict. The failsafe schema keeps every entry a string
// (so "1", "true" and "~" stay characters instead of becoming numbers/booleans/null).
export function charsetFromInferenceYaml(text) {
  const doc = parse(text, { schema: 'failsafe' });
  const list = doc?.PostProcess?.character_dict;
  if (!Array.isArray(list)) throw new Error('inference.yml has no PostProcess.character_dict list');
  return list.map(String);
}
```

- [ ] **Step 11: Run the tests and confirm they pass**

Run: `npx vitest run test/unit`
Expected: PASS, 2 files, 6 tests.

- [ ] **Step 12: Commit**

```bash
git add -A package.json package-lock.json vitest.config.js .gitignore Claude.md scripts/lib test/unit
git commit -m "Replace old app with Node-tested OCR engine toolchain

Remove the previous implementation (OpenCV-backed wrapper, coi-serviceworker,
WASM copy script) and set up Vitest plus readers for the character lists
embedded in ONNX metadata and official inference.yml files.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Check `git status` afterwards: the deletions from Step 1 are part of this commit, and only the untracked `image.png` remains.

---

### Task 2: Model catalogue, fetcher, and model smoke tests

**Files:**
- Create: `scripts/models.config.js`, `scripts/lib/model-files.js`, `scripts/lib/ort-node.js`, `scripts/fetch-models.js`
- Test: `test/integration/models.test.js`

**Interfaces:**
- Consumes: `charsetFromOnnx`, `charsetFromInferenceYaml` (Task 1)
- Produces:
  - `DET_MODELS[id] = { url, sha256, size, params: { thresh, boxThresh, unclipRatio, maxCandidates } }`
  - `REC_MODELS[id] = { url, sha256, size, charset: { from, count, url?, sha256? } }`
  - `DEFAULT_CONFIG = { det, rec, longSide }`
  - Model ids: `'v4' | 'v5' | 'v6-tiny' | 'v6-small'`
  - `loadDet(id) → { bytes: Buffer, params }`, `loadRec(id) → { bytes: Buffer, charset: string[] }`
  - `ort` (configured onnxruntime-web module)

- [ ] **Step 1: Write `scripts/models.config.js`**

Sources and values were verified during planning: SHA-256 from the hosts' LFS metadata and re-checked after download; thresholds copied from each model's official `inference.yml`; charset counts = recognizer output classes − 2.

```js
// Candidate OCR models, pinned by immutable URL (tag or commit) and SHA-256.
// Detector params are copied from each model's official PaddleOCR inference.yml (spec §6.2).

const MS = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx';
const HF = 'https://huggingface.co/PaddlePaddle';
const V6_TINY_DET = `${HF}/PP-OCRv6_tiny_det_onnx/resolve/2ba1506c0380b8f0b03dd142459aac66d4421f6c`;
const V6_SMALL_DET = `${HF}/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62`;
const V6_TINY_REC = `${HF}/PP-OCRv6_tiny_rec_onnx/resolve/2612ab37152ae0a677521bae4e1e3d4fb4cf7c30`;
const V6_SMALL_REC = `${HF}/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513`;

const V4V5_DET_PARAMS = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, maxCandidates: 1000 };

export const DET_MODELS = {
  v4: {
    url: `${MS}/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx`,
    sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    size: 4745517,
    params: V4V5_DET_PARAMS,
  },
  v5: {
    url: `${MS}/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx`,
    sha256: '4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae',
    size: 4819576,
    params: V4V5_DET_PARAMS,
  },
  'v6-tiny': {
    url: `${V6_TINY_DET}/inference.onnx`,
    sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8',
    size: 1780590,
    params: { thresh: 0.2, boxThresh: 0.4, unclipRatio: 1.4, maxCandidates: 3000 },
  },
  'v6-small': {
    url: `${V6_SMALL_DET}/inference.onnx`,
    sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
    size: 9880512,
    params: { thresh: 0.2, boxThresh: 0.45, unclipRatio: 1.4, maxCandidates: 3000 },
  },
};

export const REC_MODELS = {
  v4: {
    url: `${MS}/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx`,
    sha256: '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    size: 10857958,
    charset: { from: 'onnx-metadata', count: 6623 },
  },
  v5: {
    url: `${MS}/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx`,
    sha256: '5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5',
    size: 16631306,
    charset: { from: 'onnx-metadata', count: 18383 },
  },
  'v6-tiny': {
    url: `${V6_TINY_REC}/inference.onnx`,
    sha256: '9ef676d6ed3c88256a2d92c640c44f25b0c40947e111b14b8be8f594091563e6',
    size: 4462639,
    charset: {
      from: 'inference-yml',
      url: `${V6_TINY_REC}/inference.yml`,
      sha256: '66170210bad538e83fff3c4a3867e547d6bf20b50d64b20347c4b913f3034ea1',
      count: 6904,
    },
  },
  'v6-small': {
    url: `${V6_SMALL_REC}/inference.onnx`,
    sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    size: 21159378,
    charset: {
      from: 'inference-yml',
      url: `${V6_SMALL_REC}/inference.yml`,
      sha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
      count: 18708,
    },
  },
};

// The configuration the app ships. Replaced with the benchmark winner in Task 9.
export const DEFAULT_CONFIG = { det: 'v4', rec: 'v4', longSide: 960 };
```

- [ ] **Step 2: Write `scripts/lib/model-files.js`**

```js
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DET_MODELS } from '../models.config.js';

// Layout of models/ (gitignored), written by scripts/fetch-models.js.
export const MODELS_DIR = fileURLToPath(new URL('../../models/', import.meta.url));
export const detFile = (id) => `${MODELS_DIR}det-${id}.onnx`;
export const recFile = (id) => `${MODELS_DIR}rec-${id}.onnx`;
export const charsetFile = (id) => `${MODELS_DIR}rec-${id}.charset.json`;

function need(path) {
  if (!existsSync(path)) throw new Error(`${path} is missing. Run: npm run fetch-models`);
  return path;
}

export function loadDet(id) {
  return { bytes: readFileSync(need(detFile(id))), params: DET_MODELS[id].params };
}

export function loadRec(id) {
  return {
    bytes: readFileSync(need(recFile(id))),
    charset: JSON.parse(readFileSync(need(charsetFile(id)), 'utf8')),
  };
}
```

- [ ] **Step 3: Write `scripts/lib/ort-node.js`**

```js
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web/wasm';

// Same runtime and setup the browser worker uses: the plain WASM build, handed its
// binary directly (no fetching), single-threaded.
const require = createRequire(import.meta.url);
ort.env.wasm.wasmBinary = readFileSync(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
ort.env.wasm.numThreads = 1;

export { ort };
```

- [ ] **Step 4: Write the failing smoke test `test/integration/models.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { DET_MODELS, REC_MODELS } from '../../scripts/models.config.js';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { ort } from '../../scripts/lib/ort-node.js';

const zeros = (dims) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b)), dims);

async function runOnce(bytes, dims) {
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  try {
    const out = await session.run({ [session.inputNames[0]]: zeros(dims) });
    return out[session.outputNames[0]];
  } finally {
    await session.release();
  }
}

describe.each(Object.keys(DET_MODELS))('detector %s', (id) => {
  it('outputs a 1-channel probability map at input resolution', async () => {
    const out = await runOnce(loadDet(id).bytes, [1, 3, 64, 96]);
    expect(out.dims).toEqual([1, 1, 64, 96]);
  });
});

describe.each(Object.keys(REC_MODELS))('recognizer %s', (id) => {
  it('has blank + charset + space output classes and width/8 timesteps', async () => {
    const { bytes, charset } = loadRec(id);
    expect(charset).toHaveLength(REC_MODELS[id].charset.count);
    const out = await runOnce(bytes, [2, 3, 48, 328]);
    expect(out.dims).toEqual([2, 41, charset.length + 2]);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run test/integration/models.test.js`
Expected: FAIL. 8 tests fail with `…/models/det-v4.onnx is missing. Run: npm run fetch-models` (and the matching rec message).

- [ ] **Step 6: Write `scripts/fetch-models.js`**

```js
// Downloads the candidate OCR models from their pinned URLs, verifies SHA-256, and writes
//   models/det-<id>.onnx, models/rec-<id>.onnx, models/rec-<id>.charset.json
// Usage: node scripts/fetch-models.js [det:<id>|rec:<id> ...]   (no arguments = all candidates)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DET_MODELS, REC_MODELS } from './models.config.js';
import { MODELS_DIR, charsetFile, detFile, recFile } from './lib/model-files.js';
import { charsetFromOnnx } from './lib/onnx-meta.js';
import { charsetFromInferenceYaml } from './lib/yaml-charset.js';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url, expectedSha) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const actual = sha256(buf);
      if (actual !== expectedSha) throw new Error(`sha256 ${actual}, expected ${expectedSha}`);
      return buf;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      console.warn(`  retry ${attempt}: ${err.message}`);
    }
  }
}

async function fetchVerified(path, url, sha) {
  if (existsSync(path) && sha256(readFileSync(path)) === sha) {
    console.log(`ok     ${path}`);
    return readFileSync(path);
  }
  console.log(`fetch  ${url}`);
  const buf = await download(url, sha);
  writeFileSync(path, buf);
  return buf;
}

async function extractCharset(id, model, spec) {
  const charset =
    spec.from === 'onnx-metadata'
      ? charsetFromOnnx(model)
      : charsetFromInferenceYaml(
          (await fetchVerified(`${MODELS_DIR}rec-${id}.inference.yml`, spec.url, spec.sha256)).toString('utf8'),
        );
  if (charset.length !== spec.count) throw new Error(`rec-${id}: ${charset.length} characters, expected ${spec.count}`);
  writeFileSync(charsetFile(id), JSON.stringify(charset));
  console.log(`chars  rec-${id}: ${charset.length}`);
}

const wanted = process.argv.slice(2);
const want = (kind, id) => wanted.length === 0 || wanted.includes(`${kind}:${id}`);
mkdirSync(MODELS_DIR, { recursive: true });

for (const [id, m] of Object.entries(DET_MODELS)) {
  if (want('det', id)) await fetchVerified(detFile(id), m.url, m.sha256);
}
for (const [id, m] of Object.entries(REC_MODELS)) {
  if (want('rec', id)) await extractCharset(id, await fetchVerified(recFile(id), m.url, m.sha256), m.charset);
}
```

- [ ] **Step 7: Download the models (~75MB)**

Run: `NODE_USE_ENV_PROXY=1 npm run fetch-models`
Expected: 10 `fetch` lines (8 models + 2 `inference.yml`), then:

```
chars  rec-v4: 6623
chars  rec-v5: 18383
chars  rec-v6-tiny: 6904
chars  rec-v6-small: 18708
```

A second run prints only `ok` lines. If a host is unreachable, report it and stop; don't substitute other URLs (the checksums pin these exact files).

- [ ] **Step 8: Run the smoke test and confirm it passes**

Run: `npx vitest run test/integration/models.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add scripts/models.config.js scripts/lib/model-files.js scripts/lib/ort-node.js scripts/fetch-models.js test/integration/models.test.js
git commit -m "Add pinned OCR model catalogue, fetcher, and model smoke tests

Four PaddleOCR det/rec candidates (v4, v5 mobile; v6 tiny, small) pinned by
URL and SHA-256, official detector thresholds, and character lists extracted
from ONNX metadata or inference.yml.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Image operations

**Files:**
- Create: `src/ocr/image.js`
- Test: `test/unit/image.test.js`

**Interfaces:**
- Produces: `createImage(w, h) → image`, `resizeBilinear(image, w, h) → image`, `warpFrame(image, frame) → image` where `frame = { origin: [x,y], r: [dx,dy], a: [dx,dy], width, height }` and output pixel (x, y) samples source point `origin + x·r + y·a`.

- [ ] **Step 1: Write the failing test `test/unit/image.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { createImage, resizeBilinear, warpFrame } from '../../src/ocr/image.js';

// Image whose red channel holds the given values (row-major), alpha 255.
function fromRed(width, height, values) {
  const img = createImage(width, height);
  values.forEach((v, i) => {
    img.data[i * 4] = v;
    img.data[i * 4 + 3] = 255;
  });
  return img;
}
const red = (img) => Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4]);

describe('resizeBilinear', () => {
  it('keeps a constant image constant', () => {
    const out = resizeBilinear(fromRed(3, 2, [90, 90, 90, 90, 90, 90]), 7, 5);
    expect(new Set(red(out))).toEqual(new Set([90]));
  });

  it('averages neighbouring pairs when halving (half-pixel centres)', () => {
    expect(red(resizeBilinear(fromRed(4, 1, [0, 100, 200, 250]), 2, 1))).toEqual([50, 225]);
  });

  it('returns the requested size', () => {
    const out = resizeBilinear(fromRed(4, 4, new Array(16).fill(1)), 3, 9);
    expect([out.width, out.height, out.data.length]).toEqual([3, 9, 3 * 9 * 4]);
  });
});

describe('warpFrame', () => {
  const src = fromRed(3, 2, [10, 20, 30, 40, 50, 60]);

  it('copies the image with an identity frame', () => {
    const out = warpFrame(src, { origin: [0, 0], r: [1, 0], a: [0, 1], width: 3, height: 2 });
    expect(red(out)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('rotates 90° counter-clockwise with origin at the top-right corner', () => {
    // out(x, y) = src(2 - y, x): the top row of the result is the source's right column.
    const out = warpFrame(src, { origin: [2, 0], r: [0, 1], a: [-1, 0], width: 2, height: 3 });
    expect(red(out)).toEqual([30, 60, 20, 50, 10, 40]);
  });

  it('interpolates between pixels and replicates edges', () => {
    const out = warpFrame(src, { origin: [0.5, 0], r: [1, 0], a: [0, 1], width: 3, height: 1 });
    expect(red(out)).toEqual([15, 25, 30]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/image.test.js`
Expected: FAIL. `../../src/ocr/image.js` cannot be resolved.

- [ ] **Step 3: Implement `src/ocr/image.js`**

```js
// Pure-JS operations on RGBA images { data: Uint8ClampedArray, width, height }.
// No DOM, so the same code runs in a Worker and in Node.

export function createImage(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

// Bilinear resize with half-pixel centres (cv2.resize INTER_LINEAR convention).
export function resizeBilinear(src, dstWidth, dstHeight) {
  const { data: s, width: sw, height: sh } = src;
  const out = createImage(dstWidth, dstHeight);
  const d = out.data;
  const xRatio = sw / dstWidth;
  const yRatio = sh / dstHeight;
  for (let y = 0; y < dstHeight; y++) {
    const sy = Math.max(0, (y + 0.5) * yRatio - 0.5);
    const y0 = Math.min(Math.floor(sy), sh - 1);
    const y1 = Math.min(y0 + 1, sh - 1);
    const fy = sy - y0;
    for (let x = 0; x < dstWidth; x++) {
      const sx = Math.max(0, (x + 0.5) * xRatio - 0.5);
      const x0 = Math.min(Math.floor(sx), sw - 1);
      const x1 = Math.min(x0 + 1, sw - 1);
      const fx = sx - x0;
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * dstWidth + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c] + (s[i01 + c] - s[i00 + c]) * fx;
        const bottom = s[i10 + c] + (s[i11 + c] - s[i10 + c]) * fx;
        d[o + c] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}

// Samples an upright image from a parallelogram of `src`:
// output pixel (x, y) reads source point origin + x*r + y*a (bilinear, edges replicated;
// pixel centres at integer coordinates, as in cv2.warpPerspective).
// frame: { origin: [x, y], r: [dx, dy], a: [dx, dy], width, height }
export function warpFrame(src, frame) {
  const { data: s, width: sw, height: sh } = src;
  const { origin, r, a, width, height } = frame;
  const out = createImage(width, height);
  const d = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(Math.max(origin[0] + x * r[0] + y * a[0], 0), sw - 1);
      const sy = Math.min(Math.max(origin[1] + x * r[1] + y * a[1], 0), sh - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = s[i00 + c] + (s[i01 + c] - s[i00 + c]) * fx;
        const bottom = s[i10 + c] + (s[i11 + c] - s[i10 + c]) * fx;
        d[o + c] = top + (bottom - top) * fy;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/image.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ocr/image.js test/unit/image.test.js
git commit -m "Add DOM-free RGBA resize and parallelogram warp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Detection geometry (no OpenCV)

**Files:**
- Create: `src/ocr/geometry.js`
- Test: `test/unit/geometry.test.js`

**Interfaces:**
- Produces (a *rect* is `{ center: [x,y], u: [x,y], v: [x,y], halfU, halfV }`, with u ⟂ v unit vectors):
  - `connectedComponents(mask: Uint8Array, w, h) → Int32Array[]` (8-connected; pixel index = y·w + x)
  - `rowExtremes(pixels, w) → [x,y][]`
  - `convexHull(points) → [x,y][]`
  - `minAreaRect(hull) → rect | null`
  - `shortSide(rect) → number`
  - `expandRect(rect, ratio) → rect`
  - `rectCorners(rect) → [x,y][4]`
  - `orderQuad(points) → [tl, tr, br, bl]`
  - `rectMeanScore(prob: Float32Array, w, h, rect) → number`

- [ ] **Step 1: Write the failing test `test/unit/geometry.test.js`**

```js
import { describe, expect, it } from 'vitest';
import {
  connectedComponents,
  convexHull,
  expandRect,
  minAreaRect,
  orderQuad,
  rectCorners,
  rectMeanScore,
  rowExtremes,
  shortSide,
} from '../../src/ocr/geometry.js';

// Builds a mask from rows of '#' (on) and '.' (off).
function mask(rows) {
  const width = rows[0].length;
  return { width, height: rows.length, data: Uint8Array.from(rows.join(''), (c) => (c === '#' ? 1 : 0)) };
}
const sortedPoints = (pts) => [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
const closeTo = (pts, expected) =>
  sortedPoints(pts).forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], 6);
    expect(p[1]).toBeCloseTo(expected[i][1], 6);
  });

describe('connectedComponents', () => {
  it('separates blobs and joins diagonal neighbours (8-connectivity)', () => {
    const m = mask(['##..#', '.#..#', '..#..', '.....', '#....']);
    const comps = connectedComponents(m.data, m.width, m.height).map((c) => [...c].sort((a, b) => a - b));
    expect(comps).toEqual([[0, 1, 6, 12], [4, 9], [20]]);
  });
});

describe('rowExtremes + convexHull', () => {
  it('reduces a filled rectangle to its 4 corners', () => {
    const m = mask(['.....', '.###.', '.###.', '.###.']);
    const [pixels] = connectedComponents(m.data, m.width, m.height);
    expect(sortedPoints(convexHull(rowExtremes(pixels, m.width)))).toEqual([
      [1, 1],
      [1, 3],
      [3, 1],
      [3, 3],
    ]);
  });

  it('drops interior and collinear points', () => {
    const hull = convexHull([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(sortedPoints(hull)).toEqual([
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
    ]);
  });
});

describe('minAreaRect', () => {
  it('fits an axis-aligned rectangle exactly', () => {
    const rect = minAreaRect([
      [10, 20],
      [40, 20],
      [40, 30],
      [10, 30],
    ]);
    expect(rect.center[0]).toBeCloseTo(25);
    expect(rect.center[1]).toBeCloseTo(25);
    expect([2 * rect.halfU, 2 * rect.halfV].sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it('finds the rotated rectangle around a tilted box', () => {
    // 20 x 4 box rotated 30° around (50, 50).
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const pts = [
      [-10, -2],
      [10, -2],
      [10, 2],
      [-10, 2],
    ].map(([x, y]) => [50 + x * c - y * s, 50 + x * s + y * c]);
    const rect = minAreaRect(convexHull(pts));
    expect(shortSide(rect)).toBeCloseTo(4, 6);
    expect(2 * Math.max(rect.halfU, rect.halfV)).toBeCloseTo(20, 6);
    closeTo(rectCorners(rect), sortedPoints(pts));
  });

  it('returns null for degenerate hulls', () => {
    expect(
      minAreaRect([
        [0, 0],
        [5, 5],
      ]),
    ).toBeNull();
  });
});

describe('expandRect', () => {
  it('grows every side by area * ratio / perimeter', () => {
    const rect = { center: [0, 0], u: [1, 0], v: [0, 1], halfU: 15, halfV: 5 }; // 30 x 10
    const out = expandRect(rect, 1.5); // d = 300 * 1.5 / 80 = 5.625
    expect(out.halfU).toBeCloseTo(15 + 5.625);
    expect(out.halfV).toBeCloseTo(5 + 5.625);
  });
});

describe('orderQuad', () => {
  it('orders as top-left, top-right, bottom-right, bottom-left', () => {
    expect(
      orderQuad([
        [9, 9],
        [0, 0],
        [0, 9],
        [9, 0],
      ]),
    ).toEqual([
      [0, 0],
      [9, 0],
      [9, 9],
      [0, 9],
    ]);
  });
});

describe('rectMeanScore', () => {
  it('averages the probability map inside the rect only', () => {
    const width = 6;
    const height = 4;
    const prob = new Float32Array(width * height);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) prob[y * width + x] = 0.9;
    const inside = { center: [2, 1.5], u: [1, 0], v: [0, 1], halfU: 1, halfV: 0.5 };
    expect(rectMeanScore(prob, width, height, inside)).toBeCloseTo(0.9, 6);
    const wider = { ...inside, center: [3, 1.5], halfU: 2 }; // x = 1..5, two columns are 0
    expect(rectMeanScore(prob, width, height, wider)).toBeCloseTo(0.54, 6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/geometry.test.js`
Expected: FAIL. `../../src/ocr/geometry.js` cannot be resolved.

- [ ] **Step 3: Implement `src/ocr/geometry.js`**

```js
// Geometry for DB text-detection postprocessing. Reproduces what PaddleOCR's DBPostProcess
// gets from OpenCV (findContours, minAreaRect) and pyclipper (unclip), without either.
//
// A rect is { center: [x, y], u: [x, y], v: [x, y], halfU, halfV } where u and v are
// orthonormal axes: the four corners are center ± halfU·u ± halfV·v.

// 8-connected components of a binary mask (OpenCV findContours treats foreground as
// 8-connected). Returns one Int32Array of pixel indices (y * width + x) per component.
export function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const pixels = [];
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      pixels.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !visited[q]) {
            visited[q] = 1;
            stack[sp++] = q;
          }
        }
      }
    }
    components.push(Int32Array.from(pixels));
  }
  return components;
}

// The leftmost and rightmost pixel of each row: the convex hull of these equals the hull
// of the whole component, at a fraction of the points.
export function rowExtremes(pixels, width) {
  const rows = new Map();
  for (const p of pixels) {
    const x = p % width;
    const y = (p - x) / width;
    const row = rows.get(y);
    if (!row) rows.set(y, [x, x]);
    else {
      if (x < row[0]) row[0] = x;
      if (x > row[1]) row[1] = x;
    }
  }
  const points = [];
  for (const [y, [x0, x1]] of rows) {
    points.push([x0, y]);
    if (x1 !== x0) points.push([x1, y]);
  }
  return points;
}

// Andrew's monotone chain; drops duplicate and collinear points.
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Minimum-area enclosing rectangle (rotating calipers: one side lies on a hull edge).
// Returns null for degenerate hulls (fewer than 3 points).
export function minAreaRect(hull) {
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) continue;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [px, py] of hull) {
      const pu = px * ux + py * uy;
      const pv = px * vx + py * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, ux, uy, vx, vy, minU, maxU, minV, maxV };
  }
  const cu = (best.minU + best.maxU) / 2;
  const cv = (best.minV + best.maxV) / 2;
  return {
    center: [cu * best.ux + cv * best.vx, cu * best.uy + cv * best.vy],
    u: [best.ux, best.uy],
    v: [best.vx, best.vy],
    halfU: (best.maxU - best.minU) / 2,
    halfV: (best.maxV - best.minV) / 2,
  };
}

export const shortSide = (rect) => 2 * Math.min(rect.halfU, rect.halfV);

// PaddleOCR's unclip: offset the box outward by d = area * ratio / perimeter.
// For a rectangle the offset shape's min-area rect is exactly each side grown by d.
export function expandRect(rect, ratio) {
  const w = 2 * rect.halfU;
  const h = 2 * rect.halfV;
  const perimeter = 2 * (w + h);
  const d = perimeter > 0 ? (w * h * ratio) / perimeter : 0;
  return { ...rect, halfU: rect.halfU + d, halfV: rect.halfV + d };
}

export function rectCorners({ center: [cx, cy], u: [ux, uy], v: [vx, vy], halfU, halfV }) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([su, sv]) => [cx + su * halfU * ux + sv * halfV * vx, cy + su * halfU * uy + sv * halfV * vy]);
}

// [top-left, top-right, bottom-right, bottom-left], as PaddleOCR's get_mini_boxes orders them:
// the two leftmost points become TL/BL by y, the two rightmost TR/BR by y.
export function orderQuad(points) {
  const byX = [...points].sort((p, q) => p[0] - q[0]);
  const [tl, bl] = byX.slice(0, 2).sort((p, q) => p[1] - q[1]);
  const [tr, br] = byX.slice(2).sort((p, q) => p[1] - q[1]);
  return [tl, tr, br, bl];
}

// Mean of `prob` over the pixels inside the rect (PaddleOCR's box_score_fast).
export function rectMeanScore(prob, width, height, rect) {
  const corners = rectCorners(rect);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const {
    center: [cx, cy],
    u: [ux, uy],
    v: [vx, vy],
  } = rect;
  const limU = rect.halfU + 0.5;
  const limV = rect.halfV + 0.5;
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(dx * ux + dy * uy) <= limU && Math.abs(dx * vx + dy * vy) <= limV) {
        sum += prob[y * width + x];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/geometry.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ocr/geometry.js test/unit/geometry.test.js
git commit -m "Add DB postprocess geometry without OpenCV or clipper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Text detection (input tensor + DB postprocess)

**Files:**
- Create: `src/ocr/detect.js`
- Test: `test/unit/detect.test.js`

**Interfaces:**
- Consumes: `resizeBilinear` (Task 3); everything in `geometry.js` (Task 4)
- Produces:
  - `detInputSize(w, h, longSide) → { width, height }`
  - `toDetInput(image, w, h) → Float32Array` (NCHW, planes B, G, R)
  - `dbPostprocess(prob, w, h, params, target: { width, height }) → [{ quad, score }]`, sorted top-to-bottom then left-to-right, with quads in `target` pixels

- [ ] **Step 1: Write the failing test `test/unit/detect.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { dbPostprocess, detInputSize, toDetInput } from '../../src/ocr/detect.js';
import { createImage } from '../../src/ocr/image.js';

const PARAMS = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, maxCandidates: 1000 };

// Probability map with value `p` inside each [x0, y0, x1, y1] (inclusive) block.
function probMap(width, height, blocks) {
  const prob = new Float32Array(width * height);
  for (const [x0, y0, x1, y1, p] of blocks) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) prob[y * width + x] = p;
  }
  return prob;
}

describe('detInputSize', () => {
  it('scales the long side to the target and rounds both sides to multiples of 32', () => {
    expect(detInputSize(1479, 883, 960)).toEqual({ width: 960, height: 576 });
    expect(detInputSize(1080, 1920, 960)).toEqual({ width: 544, height: 960 });
  });

  it('upscales small inputs and never goes below 32', () => {
    expect(detInputSize(400, 10, 960)).toEqual({ width: 960, height: 32 });
  });
});

describe('toDetInput', () => {
  it('writes B, G, R planes normalised with PaddleOCR det mean/std', () => {
    const img = createImage(1, 1);
    img.data.set([255, 0, 51, 255]); // R=255 G=0 B=51
    const out = toDetInput(img, 1, 1);
    expect(out[0]).toBeCloseTo((51 / 255 - 0.485) / 0.229, 5); // B plane
    expect(out[1]).toBeCloseTo((0 - 0.456) / 0.224, 5); // G plane
    expect(out[2]).toBeCloseTo((1 - 0.406) / 0.225, 5); // R plane
  });

  it('resizes to the requested size', () => {
    expect(toDetInput(createImage(10, 10), 32, 64)).toHaveLength(3 * 32 * 64);
  });
});

describe('dbPostprocess', () => {
  it('turns a confident text blob into an expanded quad scaled to the target', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 19, 0.9]]); // 30 x 10 blob
    const boxes = dbPostprocess(prob, 64, 32, PARAMS, { width: 128, height: 64 });
    expect(boxes).toHaveLength(1);
    // Hull spans x 10..39, y 10..19 → rect 29 x 9; d = 29*9*1.5/76 ≈ 5.15
    // → x 4.85..44.15, y 4.85..24.15 → ×2 and rounded.
    expect(boxes[0].quad).toEqual([
      [10, 10],
      [88, 10],
      [88, 48],
      [10, 48],
    ]);
    expect(boxes[0].score).toBeCloseTo(0.9, 5);
  });

  it('drops blobs whose mean score is below boxThresh', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 19, 0.5]]);
    expect(dbPostprocess(prob, 64, 32, PARAMS, { width: 64, height: 32 })).toEqual([]);
  });

  it('drops blobs thinner than 3 pixels', () => {
    const prob = probMap(64, 32, [[10, 10, 39, 11, 0.9]]); // 2 rows tall
    expect(dbPostprocess(prob, 64, 32, PARAMS, { width: 64, height: 32 })).toEqual([]);
  });

  it('returns boxes top-to-bottom, then left-to-right', () => {
    const prob = probMap(64, 40, [
      [40, 2, 60, 8, 0.9],
      [2, 2, 20, 8, 0.9],
      [2, 25, 30, 33, 0.9],
    ]);
    const boxes = dbPostprocess(prob, 64, 40, PARAMS, { width: 64, height: 40 });
    expect(boxes.map((b) => b.quad[0][0] < 32 && b.quad[0][1] < 20)).toEqual([true, false, false]);
    expect(boxes[2].quad[0][1]).toBeGreaterThan(15);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/detect.test.js`
Expected: FAIL. `../../src/ocr/detect.js` cannot be resolved.

- [ ] **Step 3: Implement `src/ocr/detect.js`**

```js
import {
  connectedComponents,
  convexHull,
  expandRect,
  minAreaRect,
  orderQuad,
  rectCorners,
  rectMeanScore,
  rowExtremes,
  shortSide,
} from './geometry.js';
import { resizeBilinear } from './image.js';

// PaddleOCR det NormalizeImage values, applied in plane order to a BGR image.
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Detector input size: long side scaled to `longSide`, each side rounded to a multiple of 32.
export function detInputSize(width, height, longSide) {
  const ratio = longSide / Math.max(width, height);
  return {
    width: Math.max(32, Math.round((width * ratio) / 32) * 32),
    height: Math.max(32, Math.round((height * ratio) / 32) * 32),
  };
}

// RGBA image → NCHW Float32Array with planes B, G, R (PaddleOCR decodes images as BGR).
export function toDetInput(image, width, height) {
  const src = image.width === width && image.height === height ? image : resizeBilinear(image, width, height);
  const d = src.data;
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (d[p + 2] / 255 - DET_MEAN[0]) / DET_STD[0];
    out[plane + i] = (d[p + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
    out[2 * plane + i] = (d[p] / 255 - DET_MEAN[2]) / DET_STD[2];
  }
  return out;
}

// DB postprocess: detector probability map (width x height) → text boxes in the
// coordinates of `target` ({ width, height }, the image that was resized for detection).
// params: { thresh, boxThresh, unclipRatio, maxCandidates } from the model's official config.
// Returns [{ quad: [tl, tr, br, bl], score }] sorted top-to-bottom, then left-to-right.
export function dbPostprocess(prob, width, height, params, target) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = prob[i] > params.thresh ? 1 : 0;
  const sx = target.width / width;
  const sy = target.height / height;
  const boxes = [];
  for (const pixels of connectedComponents(mask, width, height).slice(0, params.maxCandidates)) {
    const rect = minAreaRect(convexHull(rowExtremes(pixels, width)));
    if (!rect || shortSide(rect) < 3) continue;
    const score = rectMeanScore(prob, width, height, rect);
    if (score < params.boxThresh) continue;
    const expanded = expandRect(rect, params.unclipRatio);
    if (shortSide(expanded) < 5) continue;
    const quad = orderQuad(rectCorners(expanded)).map(([x, y]) => [
      clamp(Math.round(x * sx), 0, target.width),
      clamp(Math.round(y * sy), 0, target.height),
    ]);
    boxes.push({ quad, score });
  }
  return boxes.sort((a, b) => a.quad[0][1] - b.quad[0][1] || a.quad[0][0] - b.quad[0][0]);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/detect.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ocr/detect.js test/unit/detect.test.js
git commit -m "Add detector input preparation and DB postprocess

Normalization and box filtering follow PaddleOCR's official configs
(the old wrapper skipped normalization and used a 0.03 threshold).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Recognition (crop, tensor, CTC decode, character positions)

**Files:**
- Create: `src/ocr/recognize.js`
- Test: `test/unit/recognize.test.js`

**Interfaces:**
- Consumes: `resizeBilinear`, `warpFrame` (Task 3)
- Produces:
  - `REC_HEIGHT = 48`
  - `cropLine(image, quad) → { image, frame, vertical }`
  - `frameQuad(frame, x0, x1) → quad` (source coordinates of crop columns x0..x1)
  - `buildRecBatch(crops: image[]) → { data: Float32Array, dims: [N,3,48,W], widths: number[] }`
  - `ctcDecode(probs, item, T, C, charset) → { text, score, chars: [{ ch, t0, t1, prob }] }`
  - `charSpans(chars, T, batchWidth, resizedWidth, cropWidth) → [x0, x1][]`

- [ ] **Step 1: Write the failing test `test/unit/recognize.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { createImage } from '../../src/ocr/image.js';
import { buildRecBatch, charSpans, cropLine, ctcDecode, frameQuad } from '../../src/ocr/recognize.js';

// Softmax-like output for one item: at each timestep the given class gets probability p.
function probsFor(classes, C, p = 0.9) {
  const out = new Float32Array(classes.length * C);
  classes.forEach((k, t) => {
    out.fill((1 - p) / (C - 1), t * C, (t + 1) * C);
    out[t * C + k] = p;
  });
  return out;
}

describe('cropLine', () => {
  it('crops a horizontal box upright with a frame that maps back to the source', () => {
    const img = createImage(100, 50);
    const quad = [
      [10, 5],
      [70, 5],
      [70, 25],
      [10, 25],
    ];
    const { image, frame, vertical } = cropLine(img, quad);
    expect(vertical).toBe(false);
    expect([image.width, image.height]).toEqual([60, 20]);
    expect(frameQuad(frame, 0, 60)).toEqual(quad);
  });

  it('rotates tall boxes counter-clockwise so reading runs top to bottom', () => {
    const img = createImage(100, 100);
    const quad = [
      [40, 10],
      [60, 10],
      [60, 90],
      [40, 90],
    ]; // 20 wide, 80 tall
    const { image, frame, vertical } = cropLine(img, quad);
    expect(vertical).toBe(true);
    expect([image.width, image.height]).toEqual([80, 20]);
    // The first 10 crop columns are the top 10 source rows of the column.
    const [tl, tr, br, bl] = frameQuad(frame, 0, 10);
    expect([tl, tr, br, bl]).toEqual([
      [60, 10],
      [60, 20],
      [40, 20],
      [40, 10],
    ]);
  });
});

describe('buildRecBatch', () => {
  it('uses width 320 for short crops and normalises to [-1, 1] in BGR order', () => {
    const crop = createImage(24, 48);
    for (let i = 0; i < crop.data.length; i += 4) crop.data.set([255, 0, 0, 255], i); // pure red
    const { data, dims, widths } = buildRecBatch([crop]);
    expect(dims).toEqual([1, 3, 48, 320]);
    expect(widths).toEqual([24]);
    const plane = 48 * 320;
    expect([data[0], data[plane], data[2 * plane]]).toEqual([-1, -1, 1]); // B, G, R at (0, 0)
    expect(data[30]).toBe(0); // right padding
  });

  it('sizes the batch to the widest crop, rounded up to a multiple of 8', () => {
    const { dims, widths } = buildRecBatch([createImage(100, 10), createImage(30, 30)]);
    expect(widths).toEqual([480, 48]);
    expect(dims).toEqual([2, 3, 48, 480]);
    expect(buildRecBatch([createImage(101, 10)]).dims[3]).toBe(488); // 484.8 → 485 → 488
  });
});

describe('ctcDecode', () => {
  const charset = ['你', '好', '世'];
  const C = charset.length + 2; // blank + charset + space

  it('collapses repeats, drops blanks, and keeps blank-separated repeats', () => {
    // 你 你 _ 好 _ 好 space 世
    const probs = probsFor([1, 1, 0, 2, 0, 2, 4, 3], C);
    const { text, chars, score } = ctcDecode(probs, 0, 8, C, charset);
    expect(text).toBe('你好好 世');
    expect(chars.map((c) => [c.t0, c.t1])).toEqual([
      [0, 1],
      [3, 3],
      [5, 5],
      [6, 6],
      [7, 7],
    ]);
    expect(score).toBeCloseTo(0.9, 5);
  });

  it('reads the requested batch item', () => {
    const probs = new Float32Array([...probsFor([1, 0], C), ...probsFor([3, 0], C)]);
    expect(ctcDecode(probs, 1, 2, C, charset).text).toBe('世');
  });

  it('returns an empty line with score 0 when everything is blank', () => {
    expect(ctcDecode(probsFor([0, 0, 0], C), 0, 3, C, charset)).toEqual({ text: '', score: 0, chars: [] });
  });
});

describe('charSpans', () => {
  it('centres characters on their timesteps and splits halfway between neighbours', () => {
    // T = 40 over a 320-wide batch: 8 px per timestep. Resized crop 160 wide = crop 80 wide.
    const chars = [
      { t0: 2, t1: 2 },
      { t0: 6, t1: 8 },
      { t0: 12, t1: 12 },
    ];
    // centres in resized px: 20, 60, 100 → crop px: 10, 30, 50
    expect(charSpans(chars, 40, 320, 160, 80)).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
    ]);
  });

  it('gives a lone character the whole crop', () => {
    expect(charSpans([{ t0: 3, t1: 3 }], 40, 320, 100, 50)).toEqual([[0, 50]]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/recognize.test.js`
Expected: FAIL. `../../src/ocr/recognize.js` cannot be resolved.

- [ ] **Step 3: Implement `src/ocr/recognize.js`**

```js
import { resizeBilinear, warpFrame } from './image.js';

export const REC_HEIGHT = 48;
const MIN_BATCH_WIDTH = 320;
const MAX_BATCH_WIDTH = 3200;

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// Straightens a detected quad [tl, tr, br, bl] into an upright crop. Quads at least 1.5x
// taller than wide are read as vertical text and rotated 90° counter-clockwise, as
// PaddleOCR's get_rotate_crop_image does. `frame` maps crop pixel (x, y) to the source
// point origin + x*r + y*a, so positions in the crop can be mapped back.
export function cropLine(image, quad) {
  const [tl, tr, br, bl] = quad;
  const w = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
  const h = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))));
  const vertical = h >= 1.5 * w;
  const frame = vertical
    ? {
        origin: tr,
        r: [(bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h],
        a: [(tl[0] - tr[0]) / w, (tl[1] - tr[1]) / w],
        width: h,
        height: w,
      }
    : {
        origin: tl,
        r: [(tr[0] - tl[0]) / w, (tr[1] - tl[1]) / w],
        a: [(bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h],
        width: w,
        height: h,
      };
  return { image: warpFrame(image, frame), frame, vertical };
}

// Source-space quad [tl, tr, br, bl] (in reading orientation) of crop columns x0..x1.
export function frameQuad(frame, x0, x1) {
  const {
    origin: [ox, oy],
    r: [rx, ry],
    a: [ax, ay],
    height,
  } = frame;
  const at = (x, y) => [ox + x * rx + y * ax, oy + x * ry + y * ay];
  return [at(x0, 0), at(x1, 0), at(x1, height), at(x0, height)];
}

// Packs crops into one NCHW batch of height 48. Batch width = widest aspect ratio in the
// batch (at least 320, rounded up to a multiple of 8 so each output timestep covers exactly
// 8 pixels); each crop is resized to height 48 keeping its ratio and zero-padded on the right.
// Pixels are normalised (x/255 - 0.5) / 0.5 in B, G, R plane order.
export function buildRecBatch(crops) {
  // Multiply before dividing: 48 * (320 / 48) is 320.00000000000006 in floating point.
  let widest = 0;
  for (const c of crops) widest = Math.max(widest, (REC_HEIGHT * c.width) / c.height);
  const batchWidth = Math.min(MAX_BATCH_WIDTH, Math.max(MIN_BATCH_WIDTH, Math.ceil(widest / 8) * 8));
  const plane = REC_HEIGHT * batchWidth;
  const data = new Float32Array(crops.length * 3 * plane);
  const widths = crops.map((crop, n) => {
    const w = Math.max(1, Math.min(batchWidth, Math.ceil((REC_HEIGHT * crop.width) / crop.height)));
    const resized = resizeBilinear(crop, w, REC_HEIGHT);
    const base = n * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const o = base + y * batchWidth + x;
        data[o] = resized.data[p + 2] / 127.5 - 1;
        data[o + plane] = resized.data[p + 1] / 127.5 - 1;
        data[o + 2 * plane] = resized.data[p] / 127.5 - 1;
      }
    }
    return w;
  });
  return { data, dims: [crops.length, 3, REC_HEIGHT, batchWidth], widths };
}

// Greedy CTC decode of batch item `item` from softmax output probs [N, T, C].
// Class 0 is blank, class k (1..charset.length) is charset[k-1], the last class is a space.
// Each character records the timesteps it spans (t0..t1) and its first-timestep probability,
// which PaddleOCR averages into the line confidence.
export function ctcDecode(probs, item, T, C, charset) {
  const chars = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    const row = (item * T + t) * C;
    let best = 0;
    let bestP = probs[row];
    for (let k = 1; k < C; k++) {
      if (probs[row + k] > bestP) {
        bestP = probs[row + k];
        best = k;
      }
    }
    if (best !== 0) {
      if (best === prev) chars[chars.length - 1].t1 = t;
      else chars.push({ ch: best <= charset.length ? charset[best - 1] : ' ', t0: t, t1: t, prob: bestP });
    }
    prev = best;
  }
  const score = chars.length ? chars.reduce((sum, c) => sum + c.prob, 0) / chars.length : 0;
  return { text: chars.map((c) => c.ch).join(''), score, chars };
}

// Horizontal extent [x0, x1] of each decoded character, in crop pixels. Timestep t is
// centred at (t + 0.5) * batchWidth / T in the resized crop (resizedWidth wide); a character
// sits at the centre of its timesteps, and neighbours meet halfway between centres.
export function charSpans(chars, T, batchWidth, resizedWidth, cropWidth) {
  const scale = (batchWidth / T) * (cropWidth / resizedWidth);
  const centers = chars.map((c) => ((c.t0 + c.t1) / 2 + 0.5) * scale);
  const last = centers.length - 1;
  return centers.map((c, i) => {
    const left = i > 0 ? (centers[i - 1] + c) / 2 : last > 0 ? c - (centers[1] - c) / 2 : 0;
    const right = i < last ? (c + centers[i + 1]) / 2 : last > 0 ? c + (c - centers[i - 1]) / 2 : cropWidth;
    return [Math.max(0, left), Math.min(cropWidth, right)];
  });
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/recognize.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ocr/recognize.js test/unit/recognize.test.js
git commit -m "Add line cropping, recognizer input, CTC decode, and character spans

Character positions come from CTC timesteps instead of assumed widths.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end pipeline, fixture, metrics, and baseline golden test

**Files:**
- Move: `image.png` → `test/fixtures/menu-kkm.png` (untracked today; becomes tracked)
- Create: `src/ocr/pipeline.js`, `scripts/lib/png.js`, `scripts/lib/metrics.js`, `test/fixtures/labels.json`
- Test: `test/unit/metrics.test.js`, `test/integration/pipeline.test.js`

**Interfaces:**
- Consumes: `detect.js` (Task 5), `recognize.js` (Task 6), `loadDet`/`loadRec`/`ort` (Task 2)
- Produces:
  - `createOcr({ ort, det, rec, charset, detParams, dropScore = 0.5 }) → Promise<{ scan(image, { longSide = 960 }) → Promise<{ lines, timings }>, warmup(), release() }>`; `timings = { prep, det, post, crop, rec, total }` in ms
  - `loadPng(path | URL) → image`
  - `levenshtein(a, b)`, `cjkOnly(text)`, `scoreRequired(required: string[], lines: {text}[]) → { results: [{ label, text, cer, exact }], exact, meanCer }`
  - `labels.json` shape: `{ [fixture]: { description, required: string[], pinyin: { [dish]: "space separated syllables" } } }`

- [ ] **Step 1: Move the fixture and write the labels**

```bash
mkdir -p test/fixtures && mv image.png test/fixtures/menu-kkm.png
```

`test/fixtures/labels.json` (the pinyin is pinyin-pro 3.28.1's output, checked against the dish names):

```json
{
  "menu-kkm.png": {
    "description": "Hawker stall menu board (KKM): printed simplified Chinese dish names over food photos, English under each.",
    "required": [
      "鲍贝鱿鱼可口面",
      "阿公可口面",
      "海鲜可口面",
      "鲍鱼美味可口面",
      "美味可口面",
      "辣椒可口面",
      "海鲜伊面",
      "猪肉米粉",
      "猪肉面线",
      "面粉粿",
      "特制生面",
      "海鲜生面"
    ],
    "pinyin": {
      "鲍贝鱿鱼可口面": "bào bèi yóu yú kě kǒu miàn",
      "阿公可口面": "ā gōng kě kǒu miàn",
      "海鲜可口面": "hǎi xiān kě kǒu miàn",
      "鲍鱼美味可口面": "bào yú měi wèi kě kǒu miàn",
      "美味可口面": "měi wèi kě kǒu miàn",
      "辣椒可口面": "là jiāo kě kǒu miàn",
      "海鲜伊面": "hǎi xiān yī miàn",
      "猪肉米粉": "zhū ròu mǐ fěn",
      "猪肉面线": "zhū ròu miàn xiàn",
      "面粉粿": "miàn fěn guǒ",
      "特制生面": "tè zhì shēng miàn",
      "海鲜生面": "hǎi xiān shēng miàn"
    }
  }
}
```

- [ ] **Step 2: Write the failing metrics test `test/unit/metrics.test.js`**

```js
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
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run test/unit/metrics.test.js`
Expected: FAIL. `../../scripts/lib/metrics.js` cannot be resolved.

- [ ] **Step 4: Implement `scripts/lib/metrics.js`**

```js
const CJK = /[一-鿿]/;

export function levenshtein(a, b) {
  const s = [...a];
  const t = [...b];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

export const cjkOnly = (text) => [...text].filter((c) => CJK.test(c)).join('');

// Scores OCR output against labels that must be read. Each label is matched to the line
// whose CJK characters have the lowest character error rate (CER) against it; unmatched
// labels score CER 1. Extra lines are not penalised.
export function scoreRequired(required, lines) {
  const candidates = lines.map((l) => cjkOnly(l.text)).filter(Boolean);
  const results = required.map((label) => {
    let best = { cer: 1, text: '' };
    for (const text of candidates) {
      const cer = levenshtein(label, text) / [...label].length;
      if (cer < best.cer) best = { cer, text };
    }
    return { label, text: best.text, cer: best.cer, exact: best.text === label };
  });
  return {
    results,
    exact: results.filter((r) => r.exact).length,
    meanCer: results.reduce((sum, r) => sum + r.cer, 0) / results.length,
  };
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run test/unit/metrics.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing golden test `test/integration/pipeline.test.js`**

```js
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { createOcr } from '../../src/ocr/pipeline.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const NAME = 'menu-kkm.png';

// Baseline: the PP-OCRv4 pair. A correct pipeline reads 10 of the 12 dish names with it
// (measured while planning: it misses 海鲜可口面 and reads 面粉粿 as 面粉颗).
describe('pipeline on the menu fixture (v4 baseline)', () => {
  let ocr;
  let result;

  beforeAll(async () => {
    const det = loadDet('v4');
    const rec = loadRec('v4');
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    await ocr.warmup();
    result = await ocr.scan(loadPng(new URL(NAME, FIXTURES)));
  });
  afterAll(() => ocr?.release());

  it('reads at least 10 of the 12 dish names exactly', () => {
    const score = scoreRequired(labels[NAME].required, result.lines);
    expect(score.exact, JSON.stringify(score.results, null, 1)).toBeGreaterThanOrEqual(10);
  });

  it('reports a timing for every stage', () => {
    for (const stage of ['prep', 'det', 'post', 'crop', 'rec', 'total']) {
      expect(result.timings[stage], stage).toBeGreaterThanOrEqual(0);
    }
  });

  it('places character quads inside their line, in reading order', () => {
    for (const line of result.lines) {
      const xs = line.quad.map((p) => p[0]);
      const ys = line.quad.map((p) => p[1]);
      const inside = ([x, y]) =>
        x >= Math.min(...xs) - 2 && x <= Math.max(...xs) + 2 && y >= Math.min(...ys) - 2 && y <= Math.max(...ys) + 2;
      const [tl, tr, , bl] = line.quad;
      const axis = line.vertical ? [bl[0] - tl[0], bl[1] - tl[1]] : [tr[0] - tl[0], tr[1] - tl[1]];
      const along = (q) => ((q[0][0] + q[2][0]) / 2) * axis[0] + ((q[0][1] + q[2][1]) / 2) * axis[1];
      line.chars.forEach((c, k) => {
        expect(c.quad.every(inside), `${line.text}[${k}] outside its line`).toBe(true);
        if (k > 0) expect(along(c.quad), `${line.text}[${k}] out of order`).toBeGreaterThan(along(line.chars[k - 1].quad));
      });
    }
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run test/integration/pipeline.test.js`
Expected: FAIL. `../../scripts/lib/png.js` and `../../src/ocr/pipeline.js` cannot be resolved.

- [ ] **Step 8: Implement `scripts/lib/png.js`**

```js
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

// PNG file → RGBA image { data: Uint8ClampedArray, width, height } (pngjs always yields RGBA8).
export function loadPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
    width: png.width,
    height: png.height,
  };
}
```

- [ ] **Step 9: Implement `src/ocr/pipeline.js`**

```js
import { dbPostprocess, detInputSize, toDetInput } from './detect.js';
import { buildRecBatch, charSpans, cropLine, ctcDecode, frameQuad } from './recognize.js';

const SESSION_OPTIONS = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
const now = () => performance.now();

// Creates an OCR engine.
//   ort:       an onnxruntime-web module whose env is already configured (wasmBinary, numThreads)
//   det, rec:  model bytes (Uint8Array / ArrayBuffer)
//   charset:   recognizer characters (class k = charset[k-1])
//   detParams: { thresh, boxThresh, unclipRatio, maxCandidates } from scripts/models.config.js
//   dropScore: lines with lower mean confidence are discarded (PaddleOCR default 0.5)
export async function createOcr({ ort, det, rec, charset, detParams, dropScore = 0.5 }) {
  const detSession = await ort.InferenceSession.create(det, SESSION_OPTIONS);
  const recSession = await ort.InferenceSession.create(rec, SESSION_OPTIONS);

  async function runDet(input, width, height) {
    const feeds = { [detSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, height, width]) };
    const out = await detSession.run(feeds);
    return out[detSession.outputNames[0]].data;
  }

  async function runRec({ data, dims }) {
    const out = await recSession.run({ [recSession.inputNames[0]]: new ort.Tensor('float32', data, dims) });
    const tensor = out[recSession.outputNames[0]];
    const [, T, C] = tensor.dims;
    if (C !== charset.length + 2) {
      throw new Error(`Recognizer outputs ${C} classes; charset has ${charset.length} (expected charset + 2)`);
    }
    return { probs: tensor.data, T, C };
  }

  // Runs both models once on tiny inputs so the first real scan doesn't pay ORT's lazy setup.
  async function warmup() {
    await runDet(new Float32Array(3 * 32 * 32), 32, 32);
    await runRec({ data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] });
  }

  // image: RGBA { data, width, height }. Returns { lines, timings } with all coordinates in
  // image pixels. Line: { quad, vertical, score, text, chars: [{ ch, prob, quad }] }.
  async function scan(image, { longSide = 960 } = {}) {
    const timings = {};
    let t = now();
    const size = detInputSize(image.width, image.height, longSide);
    const input = toDetInput(image, size.width, size.height);
    timings.prep = now() - t;

    t = now();
    const prob = await runDet(input, size.width, size.height);
    timings.det = now() - t;

    t = now();
    const boxes = dbPostprocess(prob, size.width, size.height, detParams, image);
    timings.post = now() - t;

    t = now();
    const crops = boxes.map((b) => cropLine(image, b.quad));
    timings.crop = now() - t;

    // One line per inference: on single-threaded WASM, batching only adds padding
    // (measured 4-23% slower than batch size 1, identical accuracy).
    t = now();
    const lines = [];
    for (let i = 0; i < crops.length; i++) {
      const { image: crop, frame, vertical } = crops[i];
      const batch = buildRecBatch([crop]);
      const { probs, T, C } = await runRec(batch);
      const decoded = ctcDecode(probs, 0, T, C, charset);
      const spans = charSpans(decoded.chars, T, batch.dims[3], batch.widths[0], crop.width);
      lines.push({
        quad: boxes[i].quad,
        vertical,
        score: decoded.score,
        text: decoded.text,
        chars: decoded.chars.map((c, k) => ({ ch: c.ch, prob: c.prob, quad: frameQuad(frame, ...spans[k]) })),
      });
    }
    timings.rec = now() - t;
    timings.total = timings.prep + timings.det + timings.post + timings.crop + timings.rec;

    return { lines: lines.filter((l) => l.score >= dropScore && l.text.trim() !== ''), timings };
  }

  async function release() {
    await detSession.release();
    await recSession.release();
  }

  return { scan, warmup, release };
}
```

- [ ] **Step 10: Run the golden test and confirm it passes**

Run: `npx vitest run test/integration/pipeline.test.js`
Expected: PASS, 3 tests. If "at least 10 of 12" fails, the assertion message lists what each dish was matched to. A correct port reads 10 (planning measurement), so treat fewer as a bug in Tasks 3–6 (most likely channel order, normalization, or a threshold). Don't lower the bar.

- [ ] **Step 11: Run the whole suite**

Run: `npm test`
Expected: PASS, 9 files, 52 tests.

- [ ] **Step 12: Commit**

```bash
git add src/ocr/pipeline.js scripts/lib/png.js scripts/lib/metrics.js test/fixtures test/unit/metrics.test.js test/integration/pipeline.test.js
git commit -m "Add end-to-end OCR pipeline with menu fixture golden test

The v4 baseline reads 10 of 12 dish names on the KKM menu photo, with
per-character quads inside their lines and in reading order.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pinyin annotation

**Files:**
- Create: `src/text/annotate.js`
- Test: `test/unit/annotate.test.js`

**Interfaces:**
- Consumes: scan() line shape (Task 7)
- Produces: `isCJK(ch)`, `annotateLine(line) → { quad, vertical, score, text, tokens }`, `annotate(lines) → annotatedLine[]` (drops lines without CJK). Token = `{ text, isCJK, chars: [{ ch, pinyin: string | null, quad }] }`.

Spec §6.5: pinyin-pro's `segment()` is deliberately **not** used (it doesn't produce dictionary words). Tokens are CJK / non-CJK runs; word boundaries for tap-for-meaning come from CC-CEDICT in Plan 3.

- [ ] **Step 1: Write the failing test `test/unit/annotate.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { annotate, annotateLine } from '../../src/text/annotate.js';

// A line whose characters sit in consecutive 10px cells.
function line(text, extra = {}) {
  const chars = [...text].map((ch, i) => ({
    ch,
    prob: 0.9,
    quad: [
      [i * 10, 0],
      [i * 10 + 10, 0],
      [i * 10 + 10, 20],
      [i * 10, 20],
    ],
  }));
  return { quad: [[0, 0], [chars.length * 10, 0], [chars.length * 10, 20], [0, 20]], vertical: false, score: 0.9, text, chars, ...extra };
}
const pinyinOf = (token) => token.chars.map((c) => c.pinyin);

describe('annotateLine', () => {
  it('gives each CJK character its tone-marked pinyin and keeps its quad', () => {
    const [token] = annotateLine(line('阿公可口面')).tokens;
    expect(token.text).toBe('阿公可口面');
    expect(token.isCJK).toBe(true);
    expect(pinyinOf(token)).toEqual(['ā', 'gōng', 'kě', 'kǒu', 'miàn']);
    expect(token.chars[2].quad[0]).toEqual([20, 0]);
  });

  it('splits CJK and non-CJK runs; non-CJK characters get no pinyin', () => {
    const { tokens } = annotateLine(line('猪肉米粉 Pork'));
    expect(tokens.map((t) => [t.text, t.isCJK])).toEqual([
      ['猪肉米粉', true],
      [' Pork', false],
    ]);
    expect(pinyinOf(tokens[1])).toEqual([null, null, null, null, null]);
  });

  it('converts each run separately, so context never crosses runs', () => {
    const { tokens } = annotateLine(line('银行 行'));
    expect(pinyinOf(tokens[0])).toEqual(['yín', 'háng']);
    expect(pinyinOf(tokens[2])).toEqual(['xíng']);
  });

  it('carries the line geometry through', () => {
    const out = annotateLine(line('面', { vertical: true, score: 0.7 }));
    expect([out.vertical, out.score, out.text]).toEqual([true, 0.7, '面']);
  });
});

describe('annotate', () => {
  it('drops lines without Chinese', () => {
    expect(annotate([line('Seafood Koka Noodle'), line('海鲜伊面')]).map((l) => l.text)).toEqual(['海鲜伊面']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/annotate.test.js`
Expected: FAIL. `../../src/text/annotate.js` cannot be resolved.

- [ ] **Step 3: Implement `src/text/annotate.js`**

```js
import { pinyin } from 'pinyin-pro';

const CJK = /[一-鿿]/;
export const isCJK = (ch) => CJK.test(ch);

// Splits a recognized line into tokens: maximal runs of CJK / non-CJK characters.
// Each CJK run is converted on its own, so pinyin-pro uses word context inside the run
// (e.g. one dish name) but never across runs (e.g. two dishes on one row).
export function annotateLine(line) {
  const tokens = [];
  const { chars } = line;
  let i = 0;
  while (i < chars.length) {
    const cjk = isCJK(chars[i].ch);
    let j = i;
    while (j < chars.length && isCJK(chars[j].ch) === cjk) j++;
    const run = chars.slice(i, j);
    const text = run.map((c) => c.ch).join('');
    const readings = cjk ? pinyin(text, { type: 'array' }) : null;
    tokens.push({
      text,
      isCJK: cjk,
      chars: run.map((c, k) => ({ ch: c.ch, pinyin: cjk ? readings[k] : null, quad: c.quad })),
    });
    i = j;
  }
  return { quad: line.quad, vertical: line.vertical, score: line.score, text: line.text, tokens };
}

// Annotates OCR lines (output of scan) and drops lines with no Chinese characters.
export function annotate(lines) {
  return lines.filter((l) => l.chars.some((c) => isCJK(c.ch))).map(annotateLine);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/annotate.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/text/annotate.js test/unit/annotate.test.js
git commit -m "Add per-character pinyin annotation of OCR lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Benchmark, model decision, and acceptance test

**Files:**
- Create: `scripts/lib/choose.js`, `scripts/bench.js`, `docs/benchmarks/2026-10-02-ocr-models.md`
- Modify: `scripts/models.config.js` (`DEFAULT_CONFIG`)
- Test: `test/unit/choose.test.js`, `test/integration/acceptance.test.js`

**Interfaces:**
- Consumes: everything above
- Produces: `chooseConfig(rows) → row | null`; final `DEFAULT_CONFIG` (Plan 2 ships these models)

- [ ] **Step 1: Write the failing test `test/unit/choose.test.js`**

```js
import { describe, expect, it } from 'vitest';
import { chooseConfig } from '../../scripts/lib/choose.js';

const row = (id, downloadMB, exact, totalMs) => ({ id, downloadMB, exact, required: 12, meanCer: 0, totalMs });

describe('chooseConfig', () => {
  it('picks the smallest download among configurations that read every label', () => {
    const rows = [row('big', 31, 12, 3000), row('tiny', 6, 11, 700), row('mid', 21, 12, 2200)];
    expect(chooseConfig(rows).id).toBe('mid');
  });

  it('breaks download ties by speed', () => {
    expect(chooseConfig([row('slow', 21, 12, 2600), row('fast', 21, 12, 2200)]).id).toBe('fast');
  });

  it('returns null when nothing reads every label', () => {
    expect(chooseConfig([row('tiny', 6, 11, 700)])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run test/unit/choose.test.js`
Expected: FAIL. `../../scripts/lib/choose.js` cannot be resolved.

- [ ] **Step 3: Implement `scripts/lib/choose.js`**

```js
// Spec §6.7 selection rule, applied to benchmark rows
// { det, rec, longSide, downloadMB, exact, required, meanCer, totalMs }:
// among configurations that read every required label exactly, pick the smallest download,
// then the fastest. Returns null when no configuration reads every label.
export function chooseConfig(rows) {
  const eligible = rows.filter((r) => r.exact === r.required);
  eligible.sort((a, b) => a.downloadMB - b.downloadMB || a.totalMs - b.totalMs);
  return eligible[0] ?? null;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run test/unit/choose.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `scripts/bench.js`**

```js
// Benchmarks every detector x recognizer x detection size on the labelled fixtures.
// Usage: node scripts/bench.js [--det=v4,v6-tiny] [--rec=v5] [--long=960,1280] [--runs=3] [--json=out.json]
// Timings are from this machine's single-threaded WASM: compare rows, don't read them as phone numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createOcr } from '../src/ocr/pipeline.js';
import { chooseConfig } from './lib/choose.js';
import { scoreRequired } from './lib/metrics.js';
import { loadDet, loadRec } from './lib/model-files.js';
import { ort } from './lib/ort-node.js';
import { loadPng } from './lib/png.js';
import { DET_MODELS, REC_MODELS } from './models.config.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const list = (value, all) => (value ? value.split(',') : all);
const dets = list(args.det, Object.keys(DET_MODELS));
const recs = list(args.rec, Object.keys(REC_MODELS));
const longSides = list(args.long, ['960', '1280']).map(Number);
const runs = Number(args.runs ?? 3);

const FIXTURES = new URL('../test/fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const fixtures = Object.entries(labels).map(([name, l]) => ({ name, image: loadPng(new URL(name, FIXTURES)), required: l.required }));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (bytes) => bytes / 1e6;

const rows = [];
for (const det of dets) {
  for (const rec of recs) {
    const d = loadDet(det);
    const r = loadRec(rec);
    const ocr = await createOcr({ ort, det: d.bytes, rec: r.bytes, charset: r.charset, detParams: d.params });
    await ocr.warmup();
    for (const longSide of longSides) {
      const times = { det: [], rec: [], total: [] };
      let exact = 0;
      let required = 0;
      let cerSum = 0;
      const misses = [];
      for (const f of fixtures) {
        let result;
        for (let i = 0; i < runs; i++) {
          result = await ocr.scan(f.image, { longSide });
          for (const k of Object.keys(times)) times[k].push(result.timings[k]);
        }
        const score = scoreRequired(f.required, result.lines);
        exact += score.exact;
        required += f.required.length;
        cerSum += score.meanCer * f.required.length;
        misses.push(...score.results.filter((x) => !x.exact).map((x) => `${x.label}→${x.text || '∅'}`));
      }
      rows.push({
        det,
        rec,
        longSide,
        downloadMB: mb(DET_MODELS[det].size + REC_MODELS[rec].size),
        exact,
        required,
        meanCer: cerSum / required,
        detMs: median(times.det),
        recMs: median(times.rec),
        totalMs: median(times.total),
        misses,
      });
      console.error(`measured ${det} + ${rec} @ ${longSide}`);
    }
    await ocr.release();
  }
}

console.log('| det | rec | long side | models MB | exact | mean CER | det ms | rec ms | total ms | misses |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.det} | ${r.rec} | ${r.longSide} | ${r.downloadMB.toFixed(1)} | ${r.exact}/${r.required} | ${r.meanCer.toFixed(3)} | ` +
      `${Math.round(r.detMs)} | ${Math.round(r.recMs)} | ${Math.round(r.totalMs)} | ${r.misses.join(', ')} |`,
  );
}
const choice = chooseConfig(rows);
console.log(
  choice
    ? `\nSelection rule picks: det=${choice.det} rec=${choice.rec} longSide=${choice.longSide}`
    : '\nNo configuration read every required label exactly.',
);
if (args.json) writeFileSync(args.json, JSON.stringify({ rows, choice }, null, 2));
```

- [ ] **Step 6: Run the full benchmark (~5 minutes)**

Run: `node scripts/bench.js --json=bench-results.json 2>/dev/null | tee $TMPDIR/bench.md`
Expected: a 32-row markdown table (4 det × 4 rec × {960, 1280}), then `Selection rule picks: det=v5 rec=v5 longSide=960`. Planning measured v5 + v5 @ 960 at 12/12, ~21.5MB, ~2.1s total on the dev machine. Absolute times vary by machine; the 12/12 set shouldn't.

If the last line is `No configuration read every required label exactly.`, **stop and report the table to the user**: success criterion 5 can't be met, and that's their call, not something to work around.

- [ ] **Step 7: Record the results in `docs/benchmarks/2026-10-02-ocr-models.md`**

Fill in the bracketed values from the commands shown, and paste the table from `$TMPDIR/bench.md` verbatim:

```markdown
# OCR model benchmark (2026-10-02)

- Machine: <output of `node -p "require('os').cpus()[0].model"`>, Node <output of `node --version`>
- Runtime: onnxruntime-web 1.24.3, plain WASM, single thread (same setup as the browser worker)
- Fixture: `test/fixtures/menu-kkm.png`, 12 required dish names (`test/fixtures/labels.json`)
- Method: `node scripts/bench.js` (median of 3 scans per row)

<paste the table and the "Selection rule picks" line here>

## Decision

`DEFAULT_CONFIG = { det: '<det>', rec: '<rec>', longSide: <longSide> }`, chosen by the spec §6.7 rule
(every dish exact, then smallest download, then fastest).

Not final until measured on a phone: recognition is most of the scan time, so check spec success
criterion 4 (≤ 1.5s from freeze to pinyin) with Plan 2's debug panel. If it's too slow there, the
fallback is the fastest row that reads 11/12 (v6-tiny + v6-tiny during planning), which trades one
rare character (粿) for roughly a third of the time and download.
```

- [ ] **Step 8: Set `DEFAULT_CONFIG` to the rule's pick**

In `scripts/models.config.js` replace the last two lines with (using the values the benchmark printed):

```js
// The configuration the app ships: picked by scripts/bench.js (docs/benchmarks/2026-10-02-ocr-models.md).
export const DEFAULT_CONFIG = { det: 'v5', rec: 'v5', longSide: 960 };
```

- [ ] **Step 9: Write the acceptance test `test/integration/acceptance.test.js`**

```js
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { scoreRequired } from '../../scripts/lib/metrics.js';
import { ort } from '../../scripts/lib/ort-node.js';
import { loadPng } from '../../scripts/lib/png.js';
import { DEFAULT_CONFIG } from '../../scripts/models.config.js';
import { createOcr } from '../../src/ocr/pipeline.js';
import { annotate } from '../../src/text/annotate.js';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const labels = JSON.parse(readFileSync(new URL('labels.json', FIXTURES), 'utf8'));
const NAME = 'menu-kkm.png';
const { det: detId, rec: recId, longSide } = DEFAULT_CONFIG;

// Spec success criterion 5, checked against the configuration the app ships.
describe(`shipped config: det ${detId}, rec ${recId}, long side ${longSide}`, () => {
  let ocr;
  let lines;

  beforeAll(async () => {
    const det = loadDet(detId);
    const rec = loadRec(recId);
    ocr = await createOcr({ ort, det: det.bytes, rec: rec.bytes, charset: rec.charset, detParams: det.params });
    ({ lines } = await ocr.scan(loadPng(new URL(NAME, FIXTURES)), { longSide }));
  });
  afterAll(() => ocr?.release());

  it('reads all 12 dish names exactly', () => {
    const score = scoreRequired(labels[NAME].required, lines);
    expect(score.exact, JSON.stringify(score.results, null, 1)).toBe(labels[NAME].required.length);
  });

  it('puts the expected pinyin under every dish', () => {
    const tokens = annotate(lines).flatMap((l) => l.tokens);
    for (const [dish, expected] of Object.entries(labels[NAME].pinyin)) {
      const token = tokens.find((t) => t.text === dish);
      expect(token, `no token reads ${dish}`).toBeDefined();
      expect(token.chars.map((c) => c.pinyin).join(' '), dish).toBe(expected);
    }
  });
});
```

- [ ] **Step 10: Run the whole suite**

Run: `npm test`
Expected: PASS, 12 files, 62 tests.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/choose.js scripts/bench.js scripts/models.config.js docs/benchmarks test/unit/choose.test.js test/integration/acceptance.test.js
git commit -m "Benchmark OCR models and ship the pair that reads every dish

PP-OCRv5 mobile det + rec at 960px reads all 12 dish names on the menu
fixture with correct pinyin. Speed is to be confirmed on device (Plan 2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

- **Plan 2 (app shell):** `fetch-assets.js` (ships `DEFAULT_CONFIG`'s models plus the ORT wasm), loader + Cache API + SHA-256, worker wrapping `createOcr` + `annotate`, camera / viewer / overlay / state machine, service worker, `?det=&rec=` override plus debug panel for on-device timing, Playwright E2E, CI deploy. Write it after this plan lands, from the spec.
- **Plan 3 (meaning + toggle):** `build-dict.js`, CC-CEDICT forward-maximum-match lookup in the worker, word card, show/hide toggle.
