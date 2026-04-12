# Pinyin Lens

A Progressive Web App that reads Chinese text through your phone's camera and overlays hanyu pinyin (with tone marks like `nǐ hǎo`) on top of each character. Point, freeze, scan.

**Live demo:** https://aniruok9.github.io/PinyinLens/

## Features

- **Freeze-to-scan UX** — Live viewfinder with a single shutter button. Tap to freeze the frame, OCR runs once, pinyin appears as a static overlay. Tap again to resume.
- **Per-character pinyin** — Each Chinese character gets its own pinyin syllable rendered directly below it. Handles polyphonic characters via word-level context.
- **Grid-aware** — Restaurant menus and similar grid layouts: text groups separated by whitespace are converted independently, so `宫保鸡丁 阿公可口面` renders as two distinct dishes instead of one run-on phrase.
- **Pinch & pan** — Pinch-to-zoom on the live feed; pinch + drag on the frozen frame like a photo viewer. Zoom floor on the frozen state is the zoom level at freeze time.
- **Fully offline** — ~20MB of models + runtime cached on first load. Works in airplane mode after that.
- **Zero backend** — Everything runs in the browser. Static site on GitHub Pages, no API keys, no tracking.

## How it works

| Stage | Tech |
|---|---|
| Camera | `getUserMedia` with `facingMode: environment`, native FPS live feed |
| OCR | PaddleOCR (PP-OCRv3 detection + PP-OCRv4 recognition) via [`@gutenye/ocr-browser`](https://github.com/gutenye/ocr) on top of ONNX Runtime Web |
| Pinyin | [`pinyin-pro`](https://github.com/zh-lx/pinyin-pro) — MaxProbability word segmentation with polyphonic disambiguation |
| Rendering | Canvas 2D overlay aligned to the video's `object-fit: contain` box |
| Hosting | GitHub Pages + `coi-serviceworker` to enable `SharedArrayBuffer` (required by ONNX multi-threaded WASM) |

No Web Worker for OCR — the library touches DOM APIs, so it runs on the main thread. ONNX inference itself uses background WASM threads via `SharedArrayBuffer`.

## Local development

```bash
npm install
npm run dev         # Vite dev server
npm run build       # production build to dist/
npm run preview     # serve the production build locally
```

The dev server may fail to load ONNX WASM helper imports from `public/` in some Vite configurations. If you hit `Failed to load /ort-wasm-simd-threaded.jsep.mjs`, use `npm run build && npm run preview` instead.

`postinstall` runs `scripts/copy-wasm.js` to copy ONNX Runtime WASM artifacts into `public/`.

## Browser support

- **Android Chrome** — full support including WebGPU backend (future-enabled).
- **iOS Safari 16.4+** — WASM SIMD backend. WebGPU is force-disabled (ONNX Runtime JSEP causes CPU/memory spikes on Safari; see onnxruntime#26827).
- **Firefox** — forced to single-threaded WASM (Firefox `crossOriginIsolated` behavior is inconsistent on Android).
- **Desktop browsers** — work fine; need an attached camera or they'll report "Requested device not found".

## Project structure

```
src/
  main.js       # camera setup, freeze/unfreeze flow, UI wiring
  camera.js     # getUserMedia + stream lifecycle + iOS visibilitychange recovery
  ocr.js        # @gutenye/ocr-browser wrapper + model loading with progress
  pinyin.js     # splitAndConvert(): CJK-run segmentation + weighted positioning
  overlay.js    # canvas rendering, per-character pinyin placement
  zoom.js       # pinch-to-zoom + drag-to-pan gesture handler
public/
  coi-serviceworker.min.js   # COOP/COEP header injection for SharedArrayBuffer
  ort-wasm-*                 # ONNX Runtime WASM artifacts (copied by postinstall)
```

See [`Claude.md`](./Claude.md) for the full architecture spec and rationale behind key technical decisions.

## License

MIT.
