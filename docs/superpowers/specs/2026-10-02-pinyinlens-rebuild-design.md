# PinyinLens Rebuild — Design Spec

**Date:** 2026-10-02
**Status:** Approved in brainstorming, pending written-spec review
**Branch:** `rebuild`

## 1. Summary

Rebuild PinyinLens from scratch as a lean PWA. The product stays the same: point the rear camera at Chinese text, tap to freeze, see tone-marked pinyin under every character. In the rebuild it loads without reloads, works on iPhone, scans in about a second, and stays correct as the code changes. The core technology choice (PaddleOCR models on ONNX Runtime Web, pinyin-pro) is kept. Everything around it is replaced: the OCR wrapper library, the cross-origin-isolation machinery, the service-worker setup, the overlay math.

## 2. Why the current implementation fails

Each of these was verified by reading the code and the built `dist/`.

| Symptom | Root cause |
|---|---|
| Multiple page refreshes to load; breaks half the time | `coi-serviceworker` and Workbox `sw.js` both register at scope `/PinyinLens/`. A scope holds one service worker, so each registration replaces the other. When Workbox wins, the COOP/COEP headers disappear, `crossOriginIsolated` goes false, coi re-registers and reloads, and `main.js` has its own 3-reload loop on top. Workbox `skipWaiting` + `clientsClaim` can also swap app code mid-session. |
| Cross-origin isolation buys nothing | `ocr.js` forces `numThreads = 1` on all WebKit and Firefox anyway, yet `main.js` refuses to start without `crossOriginIsolated`. |
| Doesn't work on Apple devices | The bundle loads the 25MB JSEP (WebGPU) ORT wasm although WebGPU is never used. `@gutenye/ocr-common` pulls in full OpenCV.js (11MB JS with base64-embedded wasm). Models (15MB) come from jsDelivr. Workbox precaches ~76MB in parallel (JSEP wasm twice, plain wasm, the OpenCV bundle, the 2.5MB `image.png` test image, `test-ocr.html`). Preprocessing builds per-pixel JS arrays (`R.push`, `[...B,...G,...R]`, `Float32Array.from`): about a million boxed numbers per frame, copied three times. |
| Slow | Detection threshold 0.03 (PaddleOCR default 0.3) and no box-score filter. The input isn't normalized as in training, and the low threshold compensates. Food textures become "text", and each one gets its own recognition run. Recognition runs line by line, sequentially, with a different tensor shape each time, on the main thread. Frames take a detour: video → canvas → JPEG q=0.6 → blob URL → `Image` decode → canvas → `getImageData` → copy → canvas resize, downsampled to 640px. |
| Pinyin misplaced | The library merges all boxes on a row into one box spanning the gaps. Pinyin is then spaced by an assumed CJK=2 / Latin=1 width model. |
| Not actually offline | Models load from jsDelivr with no runtime caching route, so they're cached only by the HTTP cache. |

## 3. Goals, constraints, non-goals

**Constraints (unchanged):** PWA hosted on GitHub Pages, zero ongoing cost, no cloud services, fully offline after first load.

**Target devices:** recent iPhone (iPhone 13+, iOS 18+: Safari and Home Screen app) and Android flagships (Chrome).

**Target content:** printed simplified Chinese on menus and signs, on busy photo backgrounds, with English mixed in (`image.png` is the canonical case).

**v1 features:**
- Live camera view with pinch-to-zoom.
- Tap shutter → freeze → OCR → pinyin overlay under each character.
- Frozen view: pinch-zoom and pan within the scanned region.
- Show/hide-pinyin toggle on the frozen view.
- Tap a character → word meaning card (CC-CEDICT).
- Tap shutter → back to live.

**Non-goals for v1:** WebGPU, multi-threaded WASM, traditional characters, handwriting, photo import, continuous/live OCR, sentence translation, native apps, upside-down text classifier.

**Success criteria:**
1. Zero automatic page reloads on any load path, asserted in E2E tests.
2. Works end-to-end on a recent iPhone (Safari and Home Screen) and an Android flagship (device checklist, §9.5).
3. Repeat visit: ready to scan in ≤ 2s, with zero network requests (airplane mode works).
4. Freeze → pinyin rendered in ≤ 1.5s for an `image.png`-class scene on those phones.
5. At least 90% of the labelled Chinese phrases across the fixture set (`test/fixtures/labels.json`: 104 phrases on 6 user-supplied menu photos) are read exactly by the shipped models, and every KKM dish name that is read exactly gets the expected pinyin under the correct characters. *(Revised 2026-10-03, by user decision: the original criterion, all 12 KKM dish names exact, was fitted to one photo. On all six menus, the fast PP-OCRv6-tiny pair reads 93% of phrases and is ~3× faster than the v5 pair that passed the old criterion, which reads 91%. The user chose speed; v6-tiny misreads a few rare characters such as 粿 and 嬷.)*

## 4. Architecture

```
MAIN THREAD (UI only, never blocks)            WORKER (all heavy work)
┌────────────────────────────────────┐          ┌──────────────────────────────┐
│ app.js     state machine           │  pixels  │ worker.js   message protocol │
│ camera.js  stream + frame grab     │ ───────► │ ocr/*       det, rec, crops  │
│ viewer.js  zoom/pan + coord math   │ ◄─────── │ text/*      pinyin, dict     │
│ overlay.js draw pinyin, hit-test   │  tokens  │                              │
│ loader.js  assets, cache, progress │          │                              │
└────────────────────────────────────┘          └──────────────────────────────┘
```

**Principles:**
- **One state machine** (`app.js`) owns all transitions: `loading → live → scanning → frozen`, plus `error`. It's written as a pure reducer plus an effects layer, so every transition is unit-testable.
- **The frozen frame is a snapshot canvas**, not a paused `<video>`. The frozen view is independent of the camera stream, and tap coordinates map onto a canvas of known size.
- **The worker side is pure JS with no DOM.** Resize, crop and warp are done in JS on typed arrays. The same code runs in Node for tests and benchmarks.
- **Camera constraint:** `facingMode: 'environment'` (preferred, not `exact`), ideal 1920×1080. The `<video>` has `playsinline autoplay muted`.
- **Dev/test hook:** `?img=<path>` substitutes a still image for the camera through the same flow.

### 4.1 Worker message protocol

| Main → Worker | Worker → Main |
|---|---|
| `init { ortWasm, det, rec, keys }` (ArrayBuffers, transferred) | `ready { warmupMs }` or `error` |
| `scan { id, width, height, data }` (RGBA buffer, transferred) | `result { id, lines, timings }` or `error { id, message }` |
| `loadDict { bytes }` | `dictReady` |
| `lookup { id, lineIndex, charIndex }` | `entries { id, word, span, entries }` |

The worker keeps the last scan's `lines` so that `lookup` can resolve indices. A new `scan` replaces them.

### 4.2 Result data model (coordinates in snapshot pixels)

```js
Line  = { quad: [[x,y]×4], vertical: bool, score: number, tokens: Token[] }
Token = { text: string, isCJK: bool, chars: Char[] }      // a contiguous CJK run, or a non-CJK run
Char  = { ch: string, pinyin: string | null, quad: [[x,y]×4] }
```

Line and char quads share one convention: `[start-top, end-top, end-bottom, start-bottom]`, where start→end is the reading direction and "top" is the cropped line's top edge. Horizontal lines are image TL,TR,BR,BL, and the overlay places pinyin along quad[3]→quad[2]. For vertical lines (crop rotated 90° CCW) quad[0]→quad[1] runs down the column's right edge; "to the right" of the column is that edge.

## 5. Loading & caching

**Service worker (one, vite-plugin-pwa, `generateSW`):**
- Precaches the app shell only: HTML, JS including the worker chunk and pinyin-pro, the ORT `.mjs` glue, icons. Budget ≤ 1.5MB.
- Update behavior: no `skipWaiting`, no `clientsClaim`, no update prompt UI. A new SW installs, waits, and takes over on the next cold launch, so app code is never swapped under a running session. Configure vite-plugin-pwa however it takes to get this behavior.
- No coi-serviceworker. No COOP/COEP. No `crossOriginIsolated` checks anywhere.

**Large assets go through `loader.js`, in this order:**

| Asset | Approx. size |
|---|---|
| ORT plain WASM (`ort-wasm-simd-threaded.wasm`, single-threaded use) | 12MB |
| Detection model (per benchmark, §6.7) | 1.8–9.9MB |
| Recognition model (per benchmark, §6.7) | 4.5–21MB |
| Recognition character list (JSON; extracted at build time from the model's ONNX metadata or its official `inference.yml`) | ~100–300KB |
| CC-CEDICT, preprocessed compact format; loaded in the background after the engine is ready | 2–4MB |

For each asset:
1. Look up the Cache API entry in cache `assets-<manifestHash>`. If it's present, verify SHA-256 against the build-time manifest. A mismatch deletes the entry and falls through to step 2.
2. Fetch with a streaming reader, counting bytes against the manifest size for the progress bar. Verify SHA-256, then `cache.put`. Retry 3× with backoff, then show a Retry button. Files already completed are kept, so interrupted first loads resume at file granularity.
3. Hand the bytes to the worker as transferred ArrayBuffers. ORT gets `env.wasm.wasmBinary` and `InferenceSession.create(bytes)`, so it never fetches anything itself.

Old `assets-*` caches are deleted after a new manifest loads successfully.

**Asset sourcing:**
- `scripts/fetch-assets.js` (part of `npm run build`, after `npm run fetch-models` has downloaded and verified the pinned models) copies the shipped models and the ORT wasm into `public/ocr/` and writes `public/ocr/manifest.json` (`file`, `size`, `sha256` per asset, detector params, default config). Assets are served same-origin from GitHub Pages and kept out of git.
- Models: HuggingFace URLs pinned to a commit revision.
- CC-CEDICT: a snapshot mirrored as a GitHub Release asset of this repo, converted by `scripts/build-dict.js` into a compact format: simplified headword → [tone-marked pinyin, first 3 glosses].

**Startup sequence:**
1. Feature check: WASM SIMD (validate a tiny SIMD module) and module workers. If either fails, show the "unsupported browser" screen.
2. First visit: an intro card explains the one-time ~30MB download. The Start button requests the camera.
3. The live view starts immediately. The shutter shows a progress ring while assets load, and becomes active when the worker reports `ready` (warm-up inference included).
4. After the first successful load: call `navigator.storage.persist()`. On iOS, if not in standalone mode, show a one-time "Add to Home Screen" hint, because Safari may evict storage for sites not on the Home Screen after 7 days without a visit.

No IndexedDB "backup": it shares the Cache API's quota and eviction rules, so it adds nothing.

## 6. OCR pipeline (worker)

```
snapshot RGBA ─► detect ─► DB postprocess ─► crop & straighten ─► batched recognize ─► CTC decode ─► annotate
```

### 6.1 Detection (`ocr/detect.js`)
- Input: the RGBA region that was visible at freeze time (§7.1). Resize so the long side is 960 (benchmark: 960 vs 1280). Round each dimension to the nearest multiple of 32 (as PaddleOCR's DetResizeForTest does).
- Normalize exactly as PaddleOCR does: BGR channel order, `(x/255 − mean)/std` with mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`. Fill a `Float32Array` (NCHW) in one pass.
- No grayscale, contrast or binarization preprocessing.

### 6.2 DB postprocess (`ocr/geometry.js`, no OpenCV, no clipper)

Parameters come from each model's official config, not one global set:

| Detector | thresh | box_thresh | unclip_ratio | max_candidates |
|---|---|---|---|---|
| PP-OCRv4 / v5 mobile | 0.3 | 0.6 | 1.5 | 1000 |
| PP-OCRv6 tiny | 0.2 | 0.4 | 1.4 | 3000 |
| PP-OCRv6 small | 0.2 | 0.45 | 1.4 | 3000 |

- Binarize the probability map at `thresh`.
- 8-connected component labeling on a `Uint8Array` (iterative flood fill; this matches OpenCV `findContours`).
- Per component:
  - Convex hull (from each row's leftmost and rightmost pixel) → minimum-area rectangle (rotating calipers). Drop if the short side **< 3**.
  - Score = mean probability inside that rectangle (PaddleOCR's `box_score_fast`). Drop if **< box_thresh**.
  - Expand by `d = area × unclip_ratio / perimeter` (for a rectangle, PaddleOCR's polygon offset is exactly "grow each side by d"). Drop if the short side **< 5**.
- Map the rectangles back to snapshot coordinates. Cap at `max_candidates`.

### 6.3 Crop (`ocr/image.js`)
- Bilinear-sample each rectangle into an upright crop (an affine warp along the rectangle's axes).
- If crop height ≥ 1.5 × width, rotate 90° and mark the line `vertical` (PaddleOCR's `get_rotate_crop_image` rule).
- Keep each crop's transform so positions can be mapped back to snapshot space.

### 6.4 Recognition (`ocr/recognize.js`)
- Resize each crop to height 48, keeping its aspect ratio. Normalize `(x/255 − 0.5)/0.5`, BGR.
- **One line per inference**, zero-padded on the right to max(320, its own width), rounded up to a multiple of 8. Measured during planning on `image.png`:
  - PaddleOCR's sorted batches of 6 were 4–23% slower on single-threaded WASM, with identical accuracy. Batching only adds padding when there's no parallelism.
  - Dropping the 320px minimum was ~33% faster but cost accuracy (v5 misread 粿; v6-small read 鲜 as 鮮). The models are trained on 320-wide inputs, so the minimum stays.
- **CTC decode:** argmax per timestep, collapse repeats, drop blanks (index 0). Character `i` maps to `dict[i−1]`, with a space appended to the dictionary. Each emitted character records the timesteps where it fired.
- **Character positions:** each timestep covers `paddedWidth / T` pixels of the resized crop. A character's x-range runs from the midpoint with its left neighbour's centre to the midpoint with its right neighbour's centre, clamped to the crop. This range is mapped through the resize scale and the crop transform to a snapshot-space quad. (Same idea as PaddleOCR's `return_word_box`.)
- Line score = mean max-probability of the emitted characters. Drop lines **< 0.5**.
- **No row merging:** each detected box is its own line.

### 6.5 Annotation (`text/annotate.js`)
- Split the line's characters into CJK runs (`[一-鿿]`) and non-CJK runs. Each run becomes one token.
- Each CJK run is converted on its own with `pinyin(run, { type: 'array' })`, which uses word context inside the run but none across runs, giving per-character tone-marked pinyin. Non-CJK runs get `pinyin: null`.
- Lines without CJK are dropped from the result.
- pinyin-pro's `segment()` is **not** used for word boundaries: verified during planning, it only groups words with special readings (e.g. 银行) and returns 鱿鱼 and 可口 as single characters. Word boundaries for tap-for-meaning come from CC-CEDICT instead (§7.4).

### 6.6 Performance tactics
- Typed arrays only. (Buffer reuse across scans was considered and dropped: planning measured all JS preparation at ~15ms of a ~2s scan, so inference is the only cost worth attacking.)
- One warm-up inference (det and rec on tiny inputs) right after session creation.
- ORT session options: `executionProviders: ['wasm']`, `numThreads: 1`, graph optimization `all`.
- Each scan returns `timings` (`prep`, `det`, `post`, `crop`, `rec`, `total`) for the debug panel and the benchmark. Peak memory is measured on device (Plan 2 debug panel); Node's numbers say nothing about Safari.

### 6.7 Decided by benchmark (`npm run bench`), not by guessing

Candidates. Detectors and recognizers are benchmarked in every combination, all verified to run in ONNX Runtime Web during planning:

| ID | Det size | Rec size | Rec classes | Source |
|---|---|---|---|---|
| v4 (mobile) | 4.7MB | 10.9MB | 6,623 + 2 | RapidOCR ModelScope, tag `v3.9.2` |
| v5 (mobile) | 4.8MB | 16.6MB | 18,383 + 2 | RapidOCR ModelScope, tag `v3.9.2` |
| v6-tiny | 1.8MB | 4.5MB | 6,904 + 2 | PaddlePaddle official ONNX on HuggingFace, pinned commit |
| v6-small | 9.9MB | 21.2MB | 18,708 + 2 | PaddlePaddle official ONNX on HuggingFace, pinned commit |

PaddlePaddle's published printed-Chinese recognition accuracy: v5 mobile 86.0, v6-tiny 86.7, v6-small 90.5.

Also compared:
- Detection long side: 960 vs 1280.
- (Deferred: int8 quantization. Measure only if the chosen fp32 pair is over ~20MB.)

**Rule:** among configurations that read at least 90% of all labelled phrases exactly (success criterion 5), pick the fastest, then the smallest model download. Labels match anywhere inside a recognized line, so one line holding several dishes (辣椒板面 / 幼面 / 面粉粿) scores each of them. (History: Plan 1 first picked the smallest download among configurations reading all 12 KKM dishes, then the fastest such configuration (v5 + v5). The rule was rebased on all six fixtures on 2026-10-03.) Also verify whether GitHub Pages serves `.wasm` compressed, since that affects the first-visit download estimate.

**Planning measurements** (prototype of this pipeline, `image.png`, single-threaded WASM on the dev machine):

| det + rec | dishes exact | models | total |
|---|---|---|---|
| v5 + v5 | 12/12 | 21.5MB | 2.1s |
| v6-tiny + v6-small | 12/12 | 22.9MB | 2.7s |
| v6-tiny + v6-tiny | 11/12 (粿→棵) | 6.2MB | 0.75s |
| v4 + v4 | 10/12 | 15.6MB | 2.2s |

- Detection at 1280 added time and no accuracy.
- On this one photo the rule picked **v5 + v5**.

**Six-fixture measurements** (2026-10-03, 104 labelled phrases, 960px, same machine; time is the sum over six menus):

| det + rec | phrases exact | models | total for 6 menus |
|---|---|---|---|
| v6-tiny + v6-tiny | 97/104 (93%) | 6.2MB | 6.5s |
| v5 + v6-tiny | 97/104 | 9.3MB | 7.5s |
| v5 + v5 | 95/104 (91%) | 21.5MB | 20.2s |
| v6-tiny + v6-small | 100/104 | 22.9MB | 25.1s |
| v6-small + v6-small | 101/104 (97%) | 31.0MB | 25.5s |

- **Shipping v6-tiny + v6-tiny** (user decision 2026-10-03: speed over the last ~4% of accuracy).
- Recognition dominates scan time on busy menus. v6-small can still be compared on device with Plan 2's `?det=&rec=` override.

## 7. UI & rendering

### 7.1 Freeze and the scanned region
- On freeze, the region of the video visible at the current zoom (in source pixels) is drawn into the snapshot canvas. Its RGBA data goes to the worker.
- Zooming in on the live view raises effective OCR resolution: the visible region gets the detector's full 960px.
- The frozen view shows that scanned region. Zoom floor = the fit-to-screen view of that region. Pan is clamped so the viewport never leaves it.
- Unfreeze: release the snapshot (canvas width set to 0, reused next time), reset zoom to 1×, resume live.

### 7.2 Overlay (`overlay.js`)
- A screen-space canvas at `devicePixelRatio`, redrawn whenever the view transform changes. Redraws are throttled to one per animation frame during gestures. There's no constant redraw loop.
- Per CJK character: font size = 45% of the character's quad height on screen, shrunk to fit 90% of its width. No min/max caps.
- Pinyin is drawn on a semi-transparent dark strip: below the character for horizontal lines, to the right for vertical lines.
- Highlight: the tapped word's character quads are outlined.

### 7.3 Gestures (`viewer.js`, Pointer Events)
- Live: pinch zooms around the screen centre, 1×–10×. No pan.
- Frozen: pinch zooms around the focal point between the fingers, and one-finger drag pans (clamped per §7.1).
- A tap is movement < 10px and duration < 300ms. Only taps trigger hit-testing.
- Desktop testing: mouse drag pans, wheel zooms.
- `viewer.js` exposes pure functions for the transform, its inverse and clamping, all unit-tested.

### 7.4 Tap for meaning
- Hit-test: inverse-transform the tap point to snapshot space and find the character quad containing it. The word is found by segmenting that character's CJK run with CC-CEDICT forward maximum matching and taking the segment that contains the character.
- Worker lookup:
  1. The whole word in CC-CEDICT.
  2. Otherwise, a greedy longest-match split of the word, each part with its entries (e.g. 可口面 → 可口 *tasty* + 面 *noodles*).
  3. Characters with several readings list every entry, with the reading that matches pinyin-pro's choice first.
- A bottom card shows the characters (large), pinyin, and up to 3 glosses per entry. It's dismissed by tapping outside it or swiping down.
- If CC-CEDICT hasn't loaded yet, the card says "Dictionary loading…" and fills in when it's ready.
- An About sheet carries the CC-CEDICT (CC-BY-SA 4.0) attribution.

### 7.5 Controls
- **Shutter** (bottom centre, outside all transforms): progress ring (loading) → pause icon (live) → spinner (scanning) → play icon (frozen).
- **Show/hide toggle** (bottom right, frozen only): an eye icon that hides pinyin and highlights.
- "No Chinese text found, try moving closer" toast if a scan returns no lines. The view stays frozen.
- All controls respect `env(safe-area-inset-*)`. Buttons have `aria-label`s, and the card is real DOM.

## 8. Errors & lifecycle

Every state has an exit. No error ever requires the user to clear site data manually.

| Failure | UI | Recovery |
|---|---|---|
| Camera denied / unavailable | Instructions for iOS Settings › Safari › Camera and Chrome site settings | "Try again" button |
| No WASM SIMD / module workers | "Browser not supported" + minimum versions | — (detected before any download) |
| Download failure | "Download interrupted, retrying" | 3 retries with backoff → Retry button; completed files kept |
| Checksum mismatch | none | Delete + re-download once, then the error screen |
| Engine init failure | Error + **Reset app data** | Delete all caches, unregister the SW, reload once |
| Scan throws | Toast "Scan failed, try again" | Back to live |
| Worker crash / hang | Toast | 15s watchdog terminates it and respawns from cached bytes (no network) |

**Camera lifecycle:**
- One MediaStream.
- On `visibilitychange → visible`, and on the track's `ended` event: if the track's `readyState === 'ended'`, re-acquire. Otherwise leave it alone.
- The frozen state survives backgrounding (the snapshot doesn't depend on the stream). The camera is re-acquired, if needed, when the user taps play.

**Memory:**
- ORT sessions are created once.
- One snapshot canvas is reused.
- Peak worker memory is measured on device and shown in the debug panel.

**Debug panel** (`?debug`, or long-press About): backend, last scan's per-stage timings, per-asset cache status, app and model versions, last error. This is how on-device problems get reported back.

**Not yet built (after Plan 2, 2026-10-04):** while a download retries, the shutter's progress ring simply waits (no "Download interrupted, retrying" text); after the retries the error card appears as specified. The debug panel shows versions, models, engine start time, last-scan timings and the last error, but not yet the backend, per-asset cache status or peak memory, and it opens with `?debug` only (long-press About comes with Plan 3's About sheet).

## 9. Testing

Layers 1–4 run in GitHub Actions on every push. Deployment requires all of them to pass.

1. **Unit (Vitest, Node):** convex hull, min-area rectangle, unclip, crop transform and inverse, CTC decode and character positions, CJK splitting, annotation, dictionary longest-match, viewer transform/inverse/clamp, the `app.js` reducer (every transition, including error states), loader verify-and-retry logic (fetch and Cache API mocked).
2. **Pipeline golden (Node, onnxruntime-web WASM build):**
   - *(The RapidOCR reference oracle from the brainstorm was dropped during planning. RapidOCR's current defaults differ from PaddleOCR's official configs, e.g. det normalization and unclip 1.6 vs 1.5, so it isn't a faithful reference. This environment also has no pip. Ground truth tests the outcome that matters, and unit tests pin each algorithm to PaddleOCR's definitions.)*
   - Structural checks on real output: character quads ordered along the reading direction and inside their line quad.
   - vs **hand-labelled ground truth** (`test/fixtures/labels.json`): the KKM photo plus 5 more menu photos supplied by the user (104 phrases). Labels match anywhere inside a line; the shipped models must read ≥ 90% exactly, and the expected pinyin is checked for every KKM dish they read.
3. **Benchmark (`npm run bench`):** a per-variant table of stage timings, exact matches, CER and model download size. Node timings are relative; phone timings come from the debug panel.
4. **E2E (Playwright, Chromium + WebKit, production build):**
   - `?img=fixture` → shutter → tokens rendered (asserted via a `data-state` attribute and a test-only result hook).
   - Tap a character → card appears.
   - Toggle hides the overlay.
   - Offline reload still scans.
   - A corrupted cached model is recovered automatically.
   - Exactly one navigation per load (no reloads).
   - *(Plan 2 runs Chromium only. A WebKit project is deferred: no WebKit build could run in the build sandbox to verify it, and Linux WebKit isn't iOS Safari. iPhone is covered by the on-device checklist.)*
5. **On-device checklist (manual, acceptance gate):** on a recent iPhone (Safari + Home Screen app) and an Android flagship (Chrome):
   - First visit, and an offline repeat visit.
   - Scan `image.png` shown on a monitor, and a real menu.
   - Background/foreground while frozen, and rotation.
   - Tap words, toggle the overlay.
   - Record debug-panel timings against success criteria 3–4.

## 10. File structure

```
index.html
public/icons/
src/
  app/               # main thread
    main.js          # boot, engine, camera, freeze/resume, overlay, lifecycle wiring
    state.js         # state machine (pure reducer)
    assets.js        # manifest, Cache API, SHA-256, progress, retry
    engine.js        # OCR worker client: one request at a time, watchdog, respawn
    camera.js        # stream lifecycle, region capture
    view.js          # zoom/pan math (pure)
    gestures.js      # pointer pinch/drag, wheel zoom
    overlay.js       # screen-space pinyin layout and drawing
    params.js        # ?img / ?det / ?rec / ?debug
    ui.js            # render state into the DOM, debug panel
    style.css
  worker/            # core.js (message protocol, Node-testable), ocr.worker.js (entry)
  ocr/               # image.js, detect.js, geometry.js, recognize.js, pipeline.js
  text/              # annotate.js (dict.js arrives with Plan 3)
scripts/
  models.config.js   # candidate models: pinned URLs, sha256, official params
  fetch-models.js    # download + verify models, extract character lists
  fetch-assets.js    # build-time: shipped models + ORT wasm → public/ocr/ + manifest.json
  build-dict.js      # CC-CEDICT → compact format
  bench.js
test/
  unit/  golden/  e2e/
  fixtures/          # image.png + more photos, labels.json, reference/
vite.config.js
package.json
```

**Removed:** `@gutenye/ocr-browser` (and with it OpenCV.js), `coi-serviceworker`, `vite-plugin-wasm`, `vite-plugin-top-level-await`, `scripts/copy-wasm.js`, `public/ort-wasm-*`, `public/image.png`, `test-ocr.html`.

**Rewritten:** `CLAUDE.md` (the current one states false things, e.g. that the two service workers don't conflict) and `README.md`.
