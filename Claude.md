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

Source for pre-converted ONNX models: `monkt/paddleocr-onnx` on HuggingFace. Use `@gutenye/ocr-browser` as the wrapper library — clean API returning `{ text, score, frame: { top, left, width, height } }`, handles the full PaddleOCR pre/post-processing pipeline (DB post-processing, CTC decoding, dictionary lookup). Avoids ~300–500 lines of custom pipeline code. If it fails in a Web Worker context, fall back to raw `onnxruntime-web` using its source as reference. Avoid `client-side-ocr` — OpenCV.js dependency adds ~8MB of unnecessary bloat.

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
- **Busy flag in worker:** Drop incoming frames while the previous inference is still running. PaddleOCR detection takes 100–300ms and recognition 200–500ms on mobile WASM — sending frames every 4th rAF (~15fps) would queue up faster than they complete.
- Preprocess frames before OCR: grayscale, contrast boost, adaptive thresholding (~5ms on canvas, major accuracy improvement).
- Temporal smoothing: if same bounding box persists across 2–3 frames, lock it and skip re-recognition until camera moves significantly. Eliminates flicker.
- Tap-to-freeze: user taps screen to pause on a still frame, OCR runs at higher resolution for difficult scenes. This is the reliability escape hatch.

### Progressive Enhancement (no OS branching)

```
if (navigator.gpu && !isSafari)  → ONNX WebGPU backend (10-20x faster, Android Chrome today)
else if (WASM SIMD)              → ONNX WASM SIMD backend (iOS Safari 16.4+, all modern browsers)
else                             → ONNX plain WASM backend (fallback)
```

One codebase, capability detection only. Future iOS WebGPU support works automatically.
**Safari/WebKit caveat:** ONNX Runtime Web JSEP/WebGPU on Safari causes CPU spikes to 400%+ and memory growth to 1GB+ (see onnxruntime#26827). Force WASM SIMD backend on Safari until resolved.

### GitHub Pages Hosting

- 100MB per-file limit, 1GB total site limit, 100GB/month bandwidth (soft). Models fit easily.
- GitHub Pages CANNOT set COOP/COEP security headers needed for SharedArrayBuffer (multi-threaded WASM).
- **Workaround:** Use `coi-serviceworker` (loaded as a separate script before the app) to inject `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin`. It handles the first-load reload automatically (SW isn't active on first visit, so a reload is required for `crossOriginIsolated` to become `true`).
- Use `credentialless` instead of `require-corp` for COEP — it's more permissive with cross-origin fetches (model files from HuggingFace/CDN won't be blocked).
- If models exceed limits in future, host on GitHub Releases or jsDelivr (free for GitHub assets).
- Set `base: '/PinyinLens/'` in Vite config for project-site deployment (not root user site). All paths must be relative or use the base prefix.
- Add `.nojekyll` file to root — GitHub Pages runs Jekyll by default, which can interfere with files starting with underscores in Vite's build output.

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
- **Coordinate mapping required:** CSS `object-fit: cover` crops the canvas display, so OCR bounding boxes (in video pixel space) must be transformed to account for the offset/scale between canvas internal resolution and displayed region. Use `contain` instead of `cover` to avoid cropping, or compute the crop offset and apply it to all bounding box coordinates.
- Pinyin rendered below each detected text bounding box in a semi-transparent background strip for readability

## Future Extension: Translation

pinyin-pro returns segmented words. To add English translation below pinyin:

1. Bundle CC-CEDICT dictionary (~4MB, free, CC-BY-SA license)
2. After pinyin conversion, look up each segmented word in CC-CEDICT
3. Render: Chinese text (detected) → pinyin below → short English gloss below pinyin
4. Architecture already supports this — it's one additional lookup step after pinyin conversion

## Service Worker Architecture

Two separate service workers with different concerns:

1. **`coi-serviceworker`** — Loaded as a script tag before the app. Injects COOP/COEP headers and handles the first-load reload. This is a standalone dependency, not custom code.
2. **Workbox SW (via `vite-plugin-pwa`)** — Handles precaching of app shell and model files. Uses `generateSW` strategy since all caching logic is declarative. Does NOT inject COOP/COEP headers (that's coi-serviceworker's job).

These do NOT conflict because `coi-serviceworker` registers at the app's scope and rewrites response headers, while Workbox manages cache storage. However, if they do conflict, switch `vite-plugin-pwa` to `injectManifest` and merge the COOP/COEP logic into one SW.

## Implementation Order

### Phase 1: Infrastructure Foundation
1. Fix service worker setup (coi-serviceworker + Workbox)
2. Set Vite `base` path, fix absolute paths, add `.nojekyll`
3. Deploy minimal build to GitHub Pages — verify `crossOriginIsolated === true`

### Phase 2: OCR Pipeline (hardest part)
4. Get `@gutenye/ocr-browser` loading in the Web Worker with a test image
5. Model loading with progress tracking (fetch + ReadableStream) + IndexedDB persistence
6. Wire up bitmap transfer, implement busy flag to prevent request queuing

### Phase 3: Camera & Rendering
7. Camera stream lifecycle + iOS visibility change restart
8. Coordinate mapping between OCR output and canvas display
9. Temporal smoothing (bounding box persistence, flicker elimination)

### Phase 4: Polish & UX
10. Tap-to-freeze with high-res OCR pass
11. Pinch-to-zoom (CSS transform + native zoom constraint)
12. Photo capture and share
13. Offline testing and cache verification

### Phase 5: Performance Hardening
14. Backend selection with Safari JSEP workaround
15. Low-end device testing (older iPhones, budget Android)
16. Memory profiling and tuning

## File Structure

```
/
├── index.html
├── manifest.json
├── .nojekyll                 # Prevents GitHub Pages Jekyll processing
├── public/
│   └── coi-serviceworker.min.js  # COOP/COEP header injection + auto-reload
├── src/
│   ├── main.js               # Entry: camera setup, UI, render loop, OCR scheduling
│   ├── ocr.js                # @gutenye/ocr-browser wrapper, model loading
│   ├── pinyin.js             # pinyin-pro wrapper
│   ├── camera.js             # getUserMedia, stream lifecycle
│   ├── overlay.js            # Canvas rendering, bounding box → pinyin positioning
│   └── capture.js            # Photo save / share functionality
├── models/                   # (gitignored, models fetched at runtime from HuggingFace)
├── vite.config.js
└── package.json
```

**Note:** OCR runs on the main thread using `@gutenye/ocr-browser` (not in a Web Worker) because the library depends on DOM APIs (`document.createElement('canvas')`, `new Image()`). ONNX Runtime's WASM inference still runs in background threads via SharedArrayBuffer. If main-thread jank is observed, migrate to raw `onnxruntime-web` in a Web Worker.
