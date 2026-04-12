# Freeze-to-Scan UX Pivot

## Problem

Real-time OCR on a live camera feed has unacceptable latency (500ms-1.5s+ per update). Previous optimizations (busy flags, frame skipping, opacity fading of stale results) could not overcome the fundamental cost of running PaddleOCR inference on every Nth frame via WASM. The result is pinyin overlays that lag behind camera movement, flicker, and feel unreliable.

## Solution

Stop fighting the latency. Redesign the UX so OCR only runs on demand: the user freezes the frame, OCR processes once, and pinyin appears as a static overlay on the still image.

## App States

Two states, toggled by a single button:

### Live State (default)
- Camera feed playing at native FPS
- No OCR running, no overlay visible
- Pinch-to-zoom enabled (digital zoom via CSS transform, center origin)
- No drag-to-pan
- Button shows pause icon

### Frozen State
- Video paused (`video.pause()`)
- OCR runs once on the frozen frame
- Pinyin overlay renders on canvas (static, no animation, no fading)
- Button shows loading indicator while OCR processes, then play icon when done
- Pinch-to-zoom enabled with zoom floor = zoom level at freeze time (cannot zoom out beyond freeze level)
- Drag-to-pan enabled (photo viewer behavior)
- No photo save — frame is ephemeral, gone on unfreeze

### State Transitions

**Live -> Frozen (user presses pause):**
1. `video.pause()`
2. Record current zoom level as zoom floor
3. Show loading indicator on button
4. Run `detectText(video)` once
5. Filter results for Chinese text, convert to pinyin
6. Render overlay on canvas
7. Switch button to play icon
8. Enable drag-to-pan

**Frozen -> Live (user presses play):**
1. Clear canvas overlay
2. Reset CSS transform to `scale(1) translate(0,0)`
3. `video.play()`
4. Switch button to pause icon
5. Disable drag-to-pan

## Play/Pause Button

- Fixed position at bottom-center of screen (camera shutter button location)
- Not affected by zoom/pan transforms (sits outside or above the transformed container)
- Three visual states: pause icon (live), spinner (OCR processing), play icon (frozen+ready)
- Non-interactive during OCR processing (prevent double-tap issues)

## Zoom & Pan

Touch gesture handling on `#camera-container` via `touchstart`/`touchmove`/`touchend`:

- **Pinch-to-zoom**: Track two-finger distance delta, apply as CSS `transform: scale(s)` on the container (which holds both video and canvas)
- **Live state**: zoom enabled, no pan, zoom origin = screen center
- **Frozen state**: zoom enabled (floor = freeze-time zoom level), pan enabled via single-finger drag applied as CSS `translate(x, y)`
- **Unfreeze**: reset to `scale(1) translate(0,0)`

The button element must be positioned outside the transformed container (or use `position: fixed`) so it stays static.

## Overlay Rendering

- Single render after OCR completes — no `requestAnimationFrame` loop
- Pinyin font size = proportional to detected text bounding box height, no min/max caps
- Semi-transparent black background strip below each bounding box
- White bold text, system font

## What Gets Removed

- `startOCRLoop()` — the `setTimeout(tick, 50)` polling mechanism
- `startRenderLoop()` — the `requestAnimationFrame` continuous repaint
- `RESULTS_FADE_START` / `RESULTS_FADE_END` constants
- Opacity/timestamp fading system (`resultsTimestamp`, `ctx.globalAlpha` logic)
- `ocrBusy` flag (no concurrent OCR concern with single-shot)
- `capture.js` (no photo save feature)

## What Gets Added

- `zoom.js` — pinch-to-zoom and drag-to-pan gesture handler
- Play/pause button in `index.html` with CSS for fixed positioning and states
- Freeze/unfreeze orchestration in `main.js`

## Files Changed

| File | Change |
|------|--------|
| `src/main.js` | Gut and rewrite: remove loops, add freeze/unfreeze flow |
| `src/overlay.js` | Remove font size caps, keep rest |
| `src/zoom.js` | New: gesture handling for zoom and pan |
| `src/capture.js` | Delete |
| `index.html` | Add play/pause button element and styles |
| `CLAUDE.md` | Updated (already done) |
