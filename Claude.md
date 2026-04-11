# Claude.md — Chinese Pinyin Camera PWA

## Project Overview

A Progressive Web App that uses the phone's rear camera to detect Chinese text in real-time and overlay hanyu pinyin (with tone mark diacritics like nǐ hǎo) below each detected text region. Hosted on GitHub Pages. Zero cloud dependencies, zero ongoing costs, fully offline after first load.

## Architecture

Single-codebase PWA. No OS-specific branches — use runtime feature detection throughout.

**Build:** Vite + vite-plugin-wasm + vite-plugin-top-level-await + vite-plugin-pwa
**UI:** Vanilla JS (no framework). DOM complexity is minimal — a video element, a canvas overlay, and a loading screen.
**OCR Engine:** ONNX Runtime Web running PaddleOCR models in a Web Worker
**Pinyin:** pinyin-pro (handles segmentation + polyphonic disambiguation + tone marks in one library)
**Rendering:** Canvas API compositing video frames + pinyin annotations

## Data Flow

1. `getUserMedia({ video: { facingMode: 'environment' } })` → rear camera at native FPS
2. `requestVideoFrameCallback` captures every 3rd–5th frame
3. `createImageBitmap` → transfer to Web Worker (zero-copy)
4. Worker downsamples to 640×480 → PP-OCRv3 detection (2.3MB model) → bounding boxes
5. Crop detected regions → PP-OCRv4 recognition (10MB model) → Chinese text strings
6. Post results to main thread → `pinyin-pro` conversion → canvas overlay render
7. Live video stays at full FPS; pinyin annotations update every ~500ms–1.5s

## Models & Assets (~20MB total first load)

- PP-OCRv3 detection: ~2.3MB (run frequently for bounding boxes)
- ch_PP-OCRv4 recognition: ~10MB (run on detected regions only)
- ONNX Runtime WASM: ~8MB
- pinyin-pro + modern dictionary: ~1.5MB

Source for pre-converted ONNX models: `monkt/paddleocr-onnx` on HuggingFace. Wrapper libraries to evaluate: `@gutenye/ocr-browser` (clean API, returns `{ text, score, frame: { top, left, width, height } }`) or `client-side-ocr` (has OpenCV.js preprocessing and Web Worker support built in).

## Key Technical Decisions

### Camera (getUserMedia)

- Use `facingMode: 'environment'` as preference, NOT `{ exact: 'environment' }` (hard fails on some devices)
- Video element MUST have `playsinline`, `autoplay`, `muted` attributes (iOS forces fullscreen without `playsinline`)
- Keep ONE global MediaStream alive. Never call getUserMedia again after setup.
- Listen for `visibilitychange` to restart stream after background/foreground transitions (iOS kills streams in background)
- ImageCapture API is NOT supported on Safari. Use `ctx.drawImage(videoElement, 0, 0)` for frame capture.

### Zoom & Focus

- Pinch-to-zoom: CSS `transform: scale()` with touch event handlers tracking pinch distance. Additionally check `MediaTrackCapabilities.zoom` — if available (Android), use native constraint for smoother zoom.
- Focus: No code needed. Both platforms handle continuous autofocus on rear cameras automatically.

### OCR Performance Strategy

- Never run OCR at camera FPS. Detection runs every 3rd–5th frame; recognition runs only on detected regions.
- Preprocess frames before OCR: grayscale, contrast boost, adaptive thresholding (~5ms on canvas, major accuracy improvement).
- Temporal smoothing: if same bounding box persists across 2–3 frames, lock it and skip re-recognition until camera moves significantly. Eliminates flicker.
- Tap-to-freeze: user taps screen to pause on a still frame, OCR runs at higher resolution for difficult scenes. This is the reliability escape hatch.

### Progressive Enhancement (no OS branching)

```
if (navigator.gpu)        → ONNX WebGPU backend (10-20x faster, Android Chrome today)
else if (WASM SIMD)       → ONNX WASM SIMD backend (iOS Safari 16.4+, all modern browsers)
else                      → ONNX plain WASM backend (fallback)
```

One codebase, capability detection only. Future iOS WebGPU support works automatically.

### GitHub Pages Hosting

- 100MB per-file limit, 1GB total site limit, 100GB/month bandwidth (soft). Models fit easily.
- GitHub Pages CANNOT set COOP/COEP security headers needed for SharedArrayBuffer (multi-threaded WASM).
- **Workaround:** Service worker intercepts all responses, injects `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`. ~15 lines of code, deployed once.
- If models exceed limits in future, host on GitHub Releases or jsDelivr (free for GitHub assets).

### Offline & Caching

- Service worker (via vite-plugin-pwa / Workbox) with CacheFirst policy for model files.
- Set `maximumFileSizeToCacheInBytes` to ≥60MB in Workbox config (default 2MB would skip models).
- Also persist models in IndexedDB as backup (iOS can evict service worker caches under storage pressure).
- On repeat visits: check IndexedDB first → skip network entirely → 1–2 second load.

### First Load UX

- Dedicated loading screen with progress bar. Download models sequentially.
- Cache each model as it downloads. If interrupted, resume from where it left off on next visit.

## Pinyin Conversion

```js
import { pinyin } from 'pinyin-pro';
// Returns tone-marked diacritics by default
pinyin('我今天很开心'); // → 'wǒ jīn tiān hěn kāi xīn'
```

- Built-in word segmentation (MaxProbability algorithm)
- Handles polyphonic characters (多音字) from word context: 行 → háng or xíng depending on surrounding words
- 99.846% accuracy, 6ms for 5,000 characters
- ~929KB base + ~600KB modern dictionary

## Photo Capture with Overlay

- Composite current video frame + pinyin overlay onto offscreen canvas
- `canvas.toBlob('image/png')` → trigger download OR use `navigator.share({ files: [...] })` for native share sheet (Messages, WhatsApp, etc.)
- Share API works on both iOS Safari and Android Chrome

## Rendering Approach

- Single `<canvas>` element sized to match `video.videoWidth × video.videoHeight`
- Each frame: `ctx.drawImage(video, 0, 0)` then `ctx.fillText()` for each pinyin annotation
- OCR bounding boxes map 1:1 to canvas coordinates (no transform math needed)
- CSS handles display scaling to fit screen
- Pinyin rendered below each detected text bounding box in a semi-transparent background strip for readability

## Future Extension: Translation

pinyin-pro returns segmented words. To add English translation below pinyin:

1. Bundle CC-CEDICT dictionary (~4MB, free, CC-BY-SA license)
2. After pinyin conversion, look up each segmented word in CC-CEDICT
3. Render: Chinese text (detected) → pinyin below → short English gloss below pinyin
4. Architecture already supports this — it's one additional lookup step after pinyin conversion

## File Structure

```
/
├── index.html
├── manifest.json
├── sw.js                    # Service worker (COOP/COEP headers + caching)
├── src/
│   ├── main.js              # Entry: camera setup, UI, render loop
│   ├── ocr-worker.js        # Web Worker: ONNX inference pipeline
│   ├── pinyin.js             # pinyin-pro wrapper
│   ├── camera.js             # getUserMedia, stream lifecycle, zoom gestures
│   ├── overlay.js            # Canvas rendering, bounding box → pinyin positioning
│   └── capture.js            # Photo save / share functionality
├── models/                   # PaddleOCR ONNX models (gitignored, fetched at runtime or bundled)
│   ├── det.onnx
│   └── rec.onnx
├── vite.config.js
└── package.json
```
