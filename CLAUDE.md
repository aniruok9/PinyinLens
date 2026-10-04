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
- `data/cedict/` is a vendored CC-CEDICT snapshot (CC BY-SA 4.0). Replacing it means updating its README and the
  About sheet's attribution in `index.html`.
- ONNX Runtime is imported from `onnxruntime-web/wasm` and always given `env.wasm.wasmBinary`.
- One service worker only (vite-plugin-pwa), no `skipWaiting`/`clientsClaim`.

## Commands
- `npm test`: unit + integration tests (integration needs `npm run fetch-models` first)
- `npm run fetch-models`: download pinned models into `models/` (gitignored), verify SHA-256
- `npm run dev`: dev server at http://localhost:5173/PinyinLens/ (`?img=<url>` scans a still image, `?debug` shows timings)
- `npm run build`: publish shipped models and the compacted dictionary to `public/ocr/` (gitignored) and build `dist/`
- `npm run test:e2e`: Playwright against the build (run `npm run build` first)
- `npm run bench`: model benchmark on `test/fixtures` (labels in `test/fixtures/labels.json`)

## Environment notes
- npm's default cache may be read-only in the sandbox: `npm_config_cache=$TMPDIR/npm-cache npm install`.
- Behind the sandbox proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1`.
- Model hosts: `www.modelscope.cn`, `huggingface.co`, `*.hf.co`.
- If Playwright's Chromium can't start (missing system libraries), point `PW_CHROMIUM_PATH` at a working
  Chromium and `LD_LIBRARY_PATH` at extracted libs; the config already passes `--no-proxy-server`.
