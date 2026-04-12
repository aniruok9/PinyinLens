# Claude.md — Chinese Pinyin Camera PWA

## Project Overview

A Progressive Web App that uses the phone's rear camera to detect Chinese text and overlay hanyu pinyin (with tone mark diacritics like nǐ hǎo) below each detected text region. The user views a live camera feed, then presses a button to freeze the frame — OCR runs on the frozen frame and pinyin appears as a static overlay. Pressing the button again returns to the live feed. Hosted on GitHub Pages. Zero cloud dependencies, zero ongoing costs, fully offline after first load.

## Architecture

Single-codebase PWA. No OS-specific branches — use runtime feature detection throughout.

**Build:** Vite + vite-plugin-wasm + vite-plugin-top-level-await + vite-plugin-pwa
**UI:** Vanilla JS (no framework). DOM complexity is minimal — a video element, a canvas overlay, and a loading screen.
**OCR Engine:** ONNX Runtime Web running PaddleOCR models in a Web Worker
**Pinyin:** pinyin-pro (handles segmentation + polyphonic disambiguation + tone marks in one library)
**Rendering:** Canvas API compositing video frames + pinyin annotations

## Data Flow

1. `getUserMedia({ video: { facingMode: 'environment' } })` → rear camera at native FPS
2. User sees live feed with pinch-to-zoom (digital, CSS transform). No OCR runs during live feed.
3. User presses pause button → `video.pause()` freezes the frame
4. Frozen frame is downsampled → PP-OCRv4 detection → bounding boxes → recognition → Chinese text strings
5. `pinyin-pro` conversion → canvas overlay renders pinyin below each detected region (once, static)
6. User can pinch-to-zoom and drag-to-pan the frozen frame + overlay (zoom floor = zoom level at freeze time)
7. User presses play button → clear overlay, reset zoom to 1x, `video.play()` resumes live feed

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

### Zoom & Pan

- Pinch-to-zoom via CSS `transform: scale()` on `#camera-container` with touch event handlers tracking two-finger distance.
- **Live state:** pinch-to-zoom enabled, no panning, zoom origin is screen center.
- **Frozen state:** pinch-to-zoom + drag-to-pan enabled (photo viewer behavior). Zoom floor = zoom level at moment of freeze — user cannot zoom out beyond the level they froze at.
- **Unfreeze:** reset to `scale(1) translate(0,0)`.
- Focus: No tap-to-focus. Both platforms handle continuous autofocus on rear cameras automatically.

### OCR Strategy

- **No continuous OCR.** OCR runs exactly once per freeze, on the paused video frame. No polling loop, no busy flag, no temporal smoothing needed.
- On freeze: single `detectText(video)` call → filter for Chinese text → `pinyin-pro` conversion → render overlay once.
- Show a loading indicator on the play/pause button while OCR is processing.
- Preprocess frames before OCR: grayscale, contrast boost, adaptive thresholding (~5ms on canvas, major accuracy improvement).

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
// Per-character array for positioned rendering
pinyin('宫保鸡丁', { type: 'array' }); // → ['gōng', 'bǎo', 'jī', 'dīng']
```

- Built-in word segmentation (MaxProbability algorithm)
- Handles polyphonic characters (多音字) from word context: 行 → háng or xíng depending on surrounding words
- 99.846% accuracy, 6ms for 5,000 characters
- ~929KB base + ~600KB modern dictionary

### Per-Group Splitting for Grid Layouts

PaddleOCR often groups an entire row of text into one detection region (e.g., a restaurant menu row: `"宫保鸡丁 阿公可口面 海鲜可口面"`). Passing this to pinyin-pro as one string would produce one long pinyin overlay and could cause incorrect polyphonic readings due to false cross-word context.

**Solution:** `splitAndConvert()` in `pinyin.js`:
1. Extract contiguous CJK runs via regex (`[\u4e00-\u9fff]+`)
2. Convert each CJK group to pinyin independently (correct polyphonic context per dish/phrase)
3. Compute weighted character positions (CJK=2 units, Latin=1 unit) for accurate overlay placement
4. Render pinyin per-character, centered under each Chinese character in `overlay.js`

## UI

- **Play/pause button:** Single toggle button, fixed at bottom-center (camera shutter position). Not affected by zoom/pan transforms. Shows pause icon in live state, play icon in frozen state. Shows loading indicator (spinner/pulse) while OCR processes.
- **No photo capture.** Frozen frame is ephemeral — gone when user presses play. No save to gallery.

## Rendering Approach

- Single `<canvas>` element overlaying the `<video>`, both using `object-fit: contain` and matching dimensions.
- **No render loop.** Overlay is drawn once after OCR completes on a frozen frame. No `requestAnimationFrame` loop needed.
- Pinyin font size scales proportionally to the detected text's bounding box height — no arbitrary min/max caps. Small Chinese text gets small pinyin, large text gets large pinyin.
- Pinyin rendered below each detected text bounding box in a semi-transparent background strip for readability.
- Overlay cleared on unfreeze.

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

### Phase 1: Core Pivot
1. Rip out continuous OCR loop, render loop, fade/opacity system
2. Add play/pause button UI with toggle state and loading indicator
3. Wire freeze flow: pause video → run OCR once → render overlay
4. Wire unfreeze flow: clear overlay → reset zoom → resume video

### Phase 2: Zoom & Pan
5. Pinch-to-zoom on live feed (CSS transform, center origin)
6. Carry zoom level into frozen state as zoom floor
7. Add drag-to-pan in frozen state
8. Reset to 1x on unfreeze

### Phase 3: Overlay Polish
9. Scale pinyin font size proportionally to bounding box height (remove caps)
10. Coordinate mapping between OCR output and canvas display

### Phase 4: Offline & Caching
11. Offline testing and cache verification
12. Model persistence in IndexedDB

### Phase 5: Performance Hardening
13. Backend selection with Safari JSEP workaround
14. Low-end device testing (older iPhones, budget Android)
15. Memory profiling and tuning

## File Structure

```
/
├── index.html
├── manifest.json
├── .nojekyll                 # Prevents GitHub Pages Jekyll processing
├── public/
│   └── coi-serviceworker.min.js  # COOP/COEP header injection + auto-reload
├── src/
│   ├── main.js               # Entry: camera setup, UI, freeze/unfreeze flow
│   ├── ocr.js                # @gutenye/ocr-browser wrapper, model loading
│   ├── pinyin.js             # pinyin-pro wrapper
│   ├── camera.js             # getUserMedia, stream lifecycle
│   ├── overlay.js            # Canvas rendering, bounding box → pinyin positioning
│   └── zoom.js               # Pinch-to-zoom and drag-to-pan gesture handling
├── models/                   # (gitignored, models fetched at runtime from HuggingFace)
├── vite.config.js
└── package.json
```

**Note:** OCR runs on the main thread using `@gutenye/ocr-browser` (not in a Web Worker) because the library depends on DOM APIs (`document.createElement('canvas')`, `new Image()`). ONNX Runtime's WASM inference still runs in background threads via SharedArrayBuffer. If main-thread jank is observed, migrate to raw `onnxruntime-web` in a Web Worker.
