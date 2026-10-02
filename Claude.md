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
