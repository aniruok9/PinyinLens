# Freeze-to-Scan UX Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the continuous real-time OCR loop with a freeze-to-scan model where OCR runs once on a paused video frame.

**Architecture:** Two app states (Live/Frozen) toggled by a single button. Live state shows camera feed with pinch-to-zoom. Frozen state pauses the video, runs OCR once, renders static pinyin overlay, and enables zoom+pan. CSS `transform: scale() translate()` on the camera container handles all zoom/pan. Button sits outside the transformed container via `position: fixed`.

**Tech Stack:** Vanilla JS, Canvas API, touch events, CSS transforms. No new dependencies.

---

### Task 1: Strip old continuous OCR and render systems

**Files:**
- Modify: `src/main.js` (full rewrite)
- Delete: `src/capture.js`

This task guts `main.js` down to just init + a stub freeze/unfreeze handler. No new features yet — just removal.

- [ ] **Step 1: Rewrite `src/main.js` to remove all continuous systems**

Replace the entire contents of `src/main.js` with:

```js
import { initCamera } from './camera.js';
import { initOCR, detectText } from './ocr.js';
import { renderOverlay } from './overlay.js';
import { convertPinyin, containsChinese } from './pinyin.js';

const video = document.getElementById('camera-video');
const canvas = document.getElementById('camera-canvas');
const ctx = canvas.getContext('2d');
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const loadingStatus = document.getElementById('loading-status');

let frozen = false;

function updateProgress(pct, status) {
  progressFill.style.width = `${pct}%`;
  loadingStatus.textContent = status;
}

async function freeze() {
  if (frozen) return;
  frozen = true;
  video.pause();

  const regions = await detectText(video);
  const results = regions
    .filter((r) => containsChinese(r.text))
    .map((r) => ({
      ...r,
      pinyin: convertPinyin(r.text),
    }));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderOverlay(ctx, results);
}

function unfreeze() {
  if (!frozen) return;
  frozen = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  video.play();
}

async function init() {
  if (!crossOriginIsolated) {
    const reloadCount = parseInt(sessionStorage.getItem('coi-reload-count') || '0', 10);
    if (reloadCount < 3) {
      updateProgress(0, 'Setting up secure context...');
      sessionStorage.setItem('coi-reload-count', String(reloadCount + 1));
      const delays = [500, 1000, 2000];
      setTimeout(() => window.location.reload(), delays[reloadCount]);
      return;
    }
    updateProgress(0, 'Error: Could not enable cross-origin isolation. Try closing and reopening the tab, or clearing site data in browser settings.');
    console.error('crossOriginIsolated is false after multiple reloads — ONNX Runtime requires SharedArrayBuffer');
    return;
  }
  sessionStorage.removeItem('coi-reload-count');

  try {
    updateProgress(10, 'Starting camera...');
    await initCamera(video);
  } catch (err) {
    updateProgress(10, `Camera error: ${err.message}`);
    throw err;
  }

  try {
    updateProgress(30, 'Loading OCR models...');
    await initOCR((pct, status) => {
      updateProgress(30 + pct * 0.6, status);
    });
  } catch (err) {
    updateProgress(30, `OCR error: ${err.message}`);
    throw err;
  }

  updateProgress(100, 'Ready');
  loadingScreen.classList.add('hidden');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !video.srcObject) {
      await initCamera(video);
    }
  });
}

function resizeCanvas() {
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
}

init().catch((err) => {
  console.error('Init failed:', err);
  updateProgress(0, `Error: ${err.message}`);
});

export { freeze, unfreeze, frozen };
```

- [ ] **Step 2: Delete `src/capture.js`**

```bash
git rm src/capture.js
```

- [ ] **Step 3: Verify the app loads without errors**

Run: `npx vite dev --open`

Expected: Camera feed appears, no console errors. Tapping does nothing (no button wired yet). No OCR runs continuously — confirm no `setTimeout` or `requestAnimationFrame` loops in console/profiler.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "Strip continuous OCR loop, render loop, and fade system

Remove startOCRLoop, startRenderLoop, opacity fading, and capture.js.
Main.js now has freeze/unfreeze stubs but no UI trigger yet."
```

---

### Task 2: Add play/pause button with three visual states

**Files:**
- Modify: `index.html` (add button element + CSS)
- Modify: `src/main.js` (wire button to freeze/unfreeze)

- [ ] **Step 1: Add button HTML and CSS to `index.html`**

After the closing `</div>` of `#camera-container` (line 54) and before the `<script>` tag, add:

```html
<button id="shutter-btn" type="button" aria-label="Pause camera">
  <svg id="shutter-icon-pause" viewBox="0 0 24 24" width="32" height="32" fill="white">
    <rect x="6" y="4" width="4" height="16" rx="1"/>
    <rect x="14" y="4" width="4" height="16" rx="1"/>
  </svg>
  <svg id="shutter-icon-play" class="hidden" viewBox="0 0 24 24" width="32" height="32" fill="white">
    <polygon points="6,4 20,12 6,20"/>
  </svg>
  <div id="shutter-spinner" class="hidden"></div>
</button>
```

Add these CSS rules inside the existing `<style>` block, before `.hidden`:

```css
#shutter-btn {
  position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
  z-index: 50; width: 64px; height: 64px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.2); border: 3px solid rgba(255, 255, 255, 0.8);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
#shutter-btn:active { background: rgba(255, 255, 255, 0.4); }
#shutter-btn[disabled] { opacity: 0.5; pointer-events: none; }
#shutter-spinner {
  width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.3);
  border-top-color: white; border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Wire button to freeze/unfreeze in `src/main.js`**

Add at the top of `main.js`, after the existing element lookups:

```js
const shutterBtn = document.getElementById('shutter-btn');
const iconPause = document.getElementById('shutter-icon-pause');
const iconPlay = document.getElementById('shutter-icon-play');
const spinner = document.getElementById('shutter-spinner');
```

Add this function after `unfreeze()`:

```js
function setButtonState(state) {
  iconPause.classList.toggle('hidden', state !== 'live');
  iconPlay.classList.toggle('hidden', state !== 'frozen');
  spinner.classList.toggle('hidden', state !== 'loading');
  shutterBtn.disabled = state === 'loading';
  shutterBtn.ariaLabel = state === 'live' ? 'Pause camera' : 'Resume camera';
}
```

Update `freeze()` to show loading/frozen states:

```js
async function freeze() {
  if (frozen) return;
  frozen = true;
  video.pause();
  setButtonState('loading');

  try {
    const regions = await detectText(video);
    const results = regions
      .filter((r) => containsChinese(r.text))
      .map((r) => ({
        ...r,
        pinyin: convertPinyin(r.text),
      }));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderOverlay(ctx, results);
  } catch (err) {
    console.error('OCR error:', err);
  }

  setButtonState('frozen');
}
```

Update `unfreeze()` to reset button:

```js
function unfreeze() {
  if (!frozen) return;
  frozen = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  video.play();
  setButtonState('live');
}
```

Add click handler inside `init()`, after the `resizeCanvas()` + resize listener block:

```js
shutterBtn.addEventListener('click', () => {
  if (frozen) {
    unfreeze();
  } else {
    freeze();
  }
});
```

- [ ] **Step 3: Test the button**

Run: `npx vite dev --open`

Test flow:
1. App loads → button shows pause icon at bottom center
2. Press button → video freezes, spinner appears briefly, then pinyin overlay renders, button shows play icon
3. Press button again → overlay clears, video resumes, button shows pause icon
4. During OCR processing (spinner state), button is disabled (can't double-tap)

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.js
git commit -m "Add play/pause shutter button with loading state

Fixed-position button at bottom center toggles freeze/unfreeze.
Three visual states: pause icon (live), spinner (processing), play icon (frozen)."
```

---

### Task 3: Remove font size caps from overlay

**Files:**
- Modify: `src/overlay.js:7`

- [ ] **Step 1: Update font size calculation**

In `src/overlay.js`, replace line 7:

```js
const fontSize = Math.max(12, Math.min(box.height * 0.6, 32));
```

with:

```js
const fontSize = box.height * 0.6;
```

- [ ] **Step 2: Test with varied text sizes**

Run: `npx vite dev --open`

Point camera at Chinese text of different sizes (large signage vs small print). Freeze and verify:
- Large text → large pinyin
- Small text → small pinyin, proportional to the Chinese characters
- No pinyin is clamped to 12px or 32px

- [ ] **Step 3: Commit**

```bash
git add src/overlay.js
git commit -m "Scale pinyin font size proportionally to detected text height

Remove min/max caps so pinyin matches the visual size of the Chinese text."
```

---

### Task 4: Create zoom gesture handler

**Files:**
- Create: `src/zoom.js`

- [ ] **Step 1: Create `src/zoom.js`**

```js
export function initZoom(container) {
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let zoomFloor = 1;
  let panEnabled = false;

  // Pinch state
  let startDist = 0;
  let startScale = 1;

  // Pan state
  let startPanX = 0;
  let startPanY = 0;
  let startTouchX = 0;
  let startTouchY = 0;

  function applyTransform() {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function fingerDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      startDist = fingerDist(e.touches[0], e.touches[1]);
      startScale = scale;
    } else if (e.touches.length === 1 && panEnabled) {
      startTouchX = e.touches[0].clientX;
      startTouchY = e.touches[0].clientY;
      startPanX = panX;
      startPanY = panY;
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = fingerDist(e.touches[0], e.touches[1]);
      const newScale = startScale * (dist / startDist);
      scale = Math.max(zoomFloor, newScale);
      applyTransform();
    } else if (e.touches.length === 1 && panEnabled) {
      e.preventDefault();
      panX = startPanX + (e.touches[0].clientX - startTouchX);
      panY = startPanY + (e.touches[0].clientY - startTouchY);
      applyTransform();
    }
  }, { passive: false });

  return {
    lockFloor() {
      zoomFloor = scale;
      panEnabled = true;
    },

    reset() {
      scale = 1;
      panX = 0;
      panY = 0;
      zoomFloor = 1;
      panEnabled = false;
      applyTransform();
    },
  };
}
```

- [ ] **Step 2: Verify file created**

```bash
ls -la src/zoom.js
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add src/zoom.js
git commit -m "Add pinch-to-zoom and drag-to-pan gesture handler

Supports zoom floor (can't zoom out past freeze level) and
toggling pan on/off for live vs frozen states."
```

---

### Task 5: Wire zoom into main.js and integrate with freeze/unfreeze

**Files:**
- Modify: `src/main.js`
- Modify: `index.html` (CSS tweak for transform-origin)

- [ ] **Step 1: Add transform-origin CSS**

In `index.html`, update the `#camera-container` rule. Add `transform-origin: center center;` to the existing declaration:

```css
#camera-container {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: #000; transform-origin: center center;
}
```

- [ ] **Step 2: Import and initialize zoom in `src/main.js`**

Add import at top of `main.js`:

```js
import { initZoom } from './zoom.js';
```

Add element lookup (with the other element lookups near the top):

```js
const container = document.getElementById('camera-container');
```

Inside `init()`, after the `resizeCanvas()` + resize listener block, and before the `shutterBtn.addEventListener` line, add:

```js
const zoom = initZoom(container);
```

- [ ] **Step 3: Integrate zoom with freeze/unfreeze**

Update `freeze()` — after `video.pause()` and before `setButtonState('loading')`, add:

```js
zoom.lockFloor();
```

Update `unfreeze()` — after `ctx.clearRect(...)` and before `video.play()`, add:

```js
zoom.reset();
```

- [ ] **Step 4: Test zoom behavior**

Run: `npx vite dev --open`

Test (best on mobile or using Chrome DevTools touch emulation):
1. **Live state:** pinch to zoom in on the feed. Zoom works. Single-finger drag does nothing (no pan).
2. **Freeze:** press pause while zoomed in. OCR runs, pinyin appears. Zoom level stays the same.
3. **Frozen state:** pinch to zoom in further — works. Try to zoom out past the freeze-time level — blocked (scale floors at freeze-time value). Single-finger drag to pan — works.
4. **Unfreeze:** press play. Zoom resets to 1x, pan resets. Feed resumes full frame.

- [ ] **Step 5: Commit**

```bash
git add src/main.js index.html
git commit -m "Wire pinch-to-zoom and pan into freeze/unfreeze flow

Zoom works in both live and frozen states. Zoom floor locks on freeze
so user can't zoom out past the captured frame. Pan enabled only when frozen.
Everything resets to 1x on unfreeze."
```

---

### Task 6: Prevent touch-action conflicts and handle edge cases

**Files:**
- Modify: `index.html` (CSS)
- Modify: `src/zoom.js`

- [ ] **Step 1: Set `touch-action: none` on the camera container**

In `index.html`, update the `#camera-container` CSS rule to add `touch-action: none;`:

```css
#camera-container {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  background: #000; transform-origin: center center; touch-action: none;
}
```

This prevents the browser's default pinch-to-zoom and scroll gestures from interfering with our custom touch handlers.

- [ ] **Step 2: Handle the case where a pinch gesture ends with one finger still down**

In `src/zoom.js`, add a `touchend` listener after the `touchmove` listener:

```js
container.addEventListener('touchend', (e) => {
  // When pinch ends (going from 2 fingers to 1), reset single-finger
  // tracking so the remaining finger doesn't cause a pan jump.
  if (e.touches.length === 1 && panEnabled) {
    startTouchX = e.touches[0].clientX;
    startTouchY = e.touches[0].clientY;
    startPanX = panX;
    startPanY = panY;
  }
});
```

- [ ] **Step 3: Test edge cases**

Run: `npx vite dev --open`

Test:
1. Browser doesn't zoom or scroll when pinching on the camera feed
2. Pinch to zoom, lift one finger, keep other finger down and drag — no pan jump
3. Button at bottom is still tappable and not affected by zooming

- [ ] **Step 4: Commit**

```bash
git add index.html src/zoom.js
git commit -m "Prevent browser default touch gestures and fix pinch-to-pan transition

Set touch-action: none on container. Reset pan tracking when going
from two fingers to one to prevent jump on finger lift."
```
