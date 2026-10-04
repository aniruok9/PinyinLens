# PinyinLens

Point your phone's camera at Chinese text, tap to freeze, and read it with tone-marked pinyin under every character.
Everything runs on the phone: no server, no account, and it works offline after the first visit.

**Live:** https://aniruok9.github.io/PinyinLens/

## Using it

1. Open the link on your phone and tap **Start camera**. The first visit downloads the reading engine once (up to 20 MB).
2. Aim at a menu or sign. Pinch to zoom in on small text: the scan uses only what's on screen, so zooming in helps.
3. Tap the shutter to freeze and scan. Pinch and drag to look around; tap again to go back to the camera.
4. Tap a character for its word's meaning. The eye button hides the pinyin; the **i** button shows credits.

On iPhone, Share › Add to Home Screen keeps the app and its engine available offline.

Add `?debug` to the URL (or tap **i** › Show debug info) for a panel with timings and versions. `?det=v6-small&rec=v6-small` tries the larger,
slower, more accurate models.

## How it works

| Stage | Code |
|---|---|
| Camera, zoom, freeze | `src/app/` (`camera.js`, `view.js`, `gestures.js`, `main.js`) |
| Text detection and recognition | PaddleOCR PP-OCRv6-tiny models on ONNX Runtime Web (WASM, one thread) in a Web Worker: `src/worker/`, `src/ocr/` |
| Pinyin | pinyin-pro, per run of Chinese characters: `src/text/annotate.js` |
| Overlay | screen-space canvas, redrawn on zoom so it stays sharp: `src/app/overlay.js` |
| Word meanings | CC-CEDICT (`data/cedict/`), compacted at build time (`scripts/lib/cedict.js`); words found by forward maximum matching in a second worker: `src/text/dict.js`, `src/worker/dict-core.js`, `src/app/dictionary.js`, `src/app/hittest.js` |
| Offline | one service worker for the app shell (vite-plugin-pwa); models and dictionary in the Cache API, SHA-256 verified: `src/app/assets.js` |

Design and decisions: `docs/superpowers/specs/2026-10-02-pinyinlens-rebuild-design.md`.
Model comparison: `docs/benchmarks/2026-10-03-ocr-models.md`.

## Development

```bash
npm install
npm run fetch-models              # pinned models into models/ (~75 MB, once)
npm test                          # unit + integration tests (real models, in Node)
npm run dev                       # http://localhost:5173/PinyinLens/ (add ?img=<url> to scan a photo)
npm run build && npm run test:e2e # production build + Playwright tests
npm run bench                     # compare models on test/fixtures
```

Pushing to `main` runs all tests and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## License

MIT. OCR models: PaddleOCR (Apache-2.0), via PaddlePaddle and RapidOCR releases.
Dictionary: [CC-CEDICT](https://cc-cedict.org/wiki/) (CC BY-SA 4.0), see `data/cedict/README.md`.
