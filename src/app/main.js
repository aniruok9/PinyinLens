import { createAssetLoader } from './assets.js';
import { captureRegion, openCamera, sourceSize, trackEnded } from './camera.js';
import { createDictionaryClient } from './dictionary.js';
import { createEngine } from './engine.js';
import { bindGestures } from './gestures.js';
import { charAt } from './hittest.js';
import { drawHighlight, drawLabels, labelFont, layoutLabels, placeLabels } from './overlay.js';
import { chooseModels, readParams } from './params.js';
import { initialState, reduce } from './state.js';
import { render, renderDebug } from './ui.js';
import { clampView, cssTransform, fitScale, liveView, panBy, resizeView, visibleRegion, zoomAt } from './view.js';

// WebAssembly SIMD probe (as in wasm-feature-detect): a tiny module using one v128 instruction.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);
const MAX_LIVE_ZOOM = 10;
const MAX_FROZEN_ZOOM = 8; // × the fit of the scanned region
const NOTICE_MS = 4000;
const SWIPE_CLOSE = 40; // px down on the card's head that dismisses it
const STARTED_KEY = 'pinyinlens.started';
const HINTED_KEY = 'pinyinlens.homeScreenHint';

const byId = (id) => document.getElementById(id);
const els = {
  stage: byId('stage'),
  live: byId('live'),
  still: byId('still'),
  snapshot: byId('snapshot'),
  overlay: byId('overlay'),
  shutter: byId('shutter'),
  progress: byId('progress'),
  intro: byId('intro'),
  start: byId('start'),
  error: byId('error'),
  errorTitle: byId('error-title'),
  errorMessage: byId('error-message'),
  retry: byId('retry'),
  reset: byId('reset'),
  notice: byId('notice'),
  debug: byId('debug'),
  toggle: byId('toggle'),
  aboutButton: byId('about-button'),
  about: byId('about'),
  aboutClose: byId('about-close'),
  debugToggle: byId('debug-toggle'),
  card: byId('word-card'),
  cardHead: byId('card-head'),
  cardClose: byId('card-close'),
  cardWord: byId('card-word'),
  cardReading: byId('card-reading'),
  cardStatus: byId('card-status'),
  cardEntries: byId('card-entries'),
};

const params = readParams(location.search);
const loader = createAssetLoader({ baseUrl: new URL('ocr/', document.baseURI) });
const debug = { enabled: params.debug, version: '', models: '', initMs: null, timings: null, region: null, error: '' };
const testHook = (window.__pinyinlens = { state: initialState, lastScan: null });
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode or blocked storage: the app works without it
    }
  },
};

let state = initialState;
let engine = null;
let dictionary = null;
let source = null; // the live <video>, or the <img> under ?img=
let stream = null;
let restarting = null; // the camera re-open in flight, so overlapping triggers open it once
let viewport = { width: innerWidth, height: innerHeight };
let liveZoom = 1;
let frozen = null; // { region, view, lines, placements } while scanning or frozen
let selection = null; // the word on the card: { line, token, start, end } in frozen.lines
let lookupSeq = 0; // bumped by every tap and close, so a late dictionary reply can't reopen the card
let noticeTimer = 0;
let overlayQueued = false;

function dispatch(event) {
  const previous = state;
  state = reduce(state, event);
  testHook.state = state;
  render(els, state);
  renderDebug(els.debug, els.debugToggle, debug);
  if (state.notice && state.notice !== previous.notice) {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => dispatch({ type: 'dismiss-notice' }), NOTICE_MS);
  }
}

// ── Engine ──────────────────────────────────────────────────────────────────────────────────

async function startEngine() {
  try {
    const manifest = await loader.loadManifest();
    const models = chooseModels(params, manifest);
    debug.version = manifest.version;
    debug.models = `${models.det} + ${models.rec}`;
    if (models.rejected.length) dispatch({ type: 'notice', message: `Unknown model ignored: ${models.rejected.join(', ')}` });
    engine = createEngine({
      spawnWorker: () => new Worker(new URL('../worker/ocr.worker.js', import.meta.url), { type: 'module' }),
      loadInit: () => loadInit(manifest, models),
    });
    debug.initMs = (await engine.init()).ms;
    dispatch({ type: 'engine-ready' });
    afterFirstLoad();
    startDictionary(manifest);
  } catch (err) {
    debug.error = err.message;
    dispatch({ type: 'fatal', kind: 'engine', message: err.message });
  }
}

// Reads the model files (Cache API first, network once) into the worker's init message.
async function loadInit(manifest, { det, rec }) {
  const detEntry = manifest.det[det];
  const recEntry = manifest.rec[rec];
  const files = await loader.load(manifest, [manifest.ort, detEntry, recEntry, recEntry.charset], (loaded, total) => {
    if (state.engine === 'loading') dispatch({ type: 'progress', value: loaded / total });
  });
  const message = {
    wasm: files.get(manifest.ort.file),
    det: files.get(detEntry.file),
    rec: files.get(recEntry.file),
    charset: JSON.parse(new TextDecoder().decode(files.get(recEntry.charset.file))),
    detParams: detEntry.params,
    longSide: manifest.default.longSide,
  };
  return { message, transfer: [message.wasm, message.det, message.rec] };
}

// The dictionary loads after the engine, so it never slows the first scan. A failed load is
// retried by the next lookup.
function startDictionary(manifest) {
  dictionary = createDictionaryClient({
    spawnWorker: () => new Worker(new URL('../worker/dict.worker.js', import.meta.url), { type: 'module' }),
    loadBytes: async () => (await loader.load(manifest, [manifest.dict])).get(manifest.dict.file),
  });
  dictionary.load().then(
    () => dispatch({ type: 'dict-ready' }),
    (err) => {
      debug.error = `dictionary: ${err.message}`;
      dispatch({ type: 'dict-failed' });
    },
  );
}

function afterFirstLoad() {
  navigator.storage?.persist?.().catch(() => {});
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (iOS && !standalone && !storage.get(HINTED_KEY)) {
    storage.set(HINTED_KEY, '1');
    dispatch({ type: 'notice', message: 'Tip: Share › Add to Home Screen keeps PinyinLens available offline.' });
  }
}

// ── Camera and live view ────────────────────────────────────────────────────────────────────

async function startCamera() {
  try {
    if (params.img) {
      els.still.src = params.img;
      await els.still.decode();
      source = els.still;
    } else {
      els.live.hidden = false; // iOS won't start playing a hidden video
      stream = await openCamera(els.live);
      watchTrack(stream);
      source = els.live;
    }
    storage.set(STARTED_KEY, '1');
    source.hidden = false;
    dispatch({ type: 'start' });
    layoutLive();
  } catch (err) {
    dispatch({ type: 'fatal', kind: 'camera', message: err.message });
  }
}

function restartCamera() {
  restarting ??= openCamera(els.live)
    .then((opened) => {
      stream = opened;
      watchTrack(opened);
      layoutLive();
    })
    .catch((err) => dispatch({ type: 'fatal', kind: 'camera', message: err.message }))
    .finally(() => {
      restarting = null;
    });
  return restarting;
}

// The OS can end the camera track while the app is open (a call, another app taking the camera):
// reopen it straight away when live; when frozen, resume() reopens it.
function watchTrack(watched) {
  for (const track of watched.getVideoTracks()) {
    track.addEventListener('ended', () => {
      if (stream === watched && state.screen === 'live' && document.visibilityState === 'visible') restartCamera();
    });
  }
}

function place(element, { width, height }, view) {
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.transform = cssTransform(view);
}

function currentLiveView() {
  const size = sourceSize(source);
  return { size, view: liveView(size.width, size.height, innerWidth, innerHeight, liveZoom) };
}

function layoutLive() {
  if (!source || frozen) return;
  const { size, view } = currentLiveView();
  if (size.width) place(source, size, view);
}

// ── Freeze, scan, resume ────────────────────────────────────────────────────────────────────

const maxFrozenScale = (region) => fitScale(region.width, region.height, innerWidth, innerHeight) * MAX_FROZEN_ZOOM;

function setFrozenView(view) {
  const { region } = frozen;
  frozen.view = clampView(view, region.width, region.height, innerWidth, innerHeight, maxFrozenScale(region));
  place(els.snapshot, region, frozen.view);
  queueOverlay();
}

async function freeze() {
  const ready = () => state.screen === 'live' && state.engine === 'ready';
  if (!ready()) return;
  // A camera that was just (re)opened has no frame for a moment: wait for one rather than drop the tap.
  if (source === els.live && els.live.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise((resolve) => els.live.addEventListener('loadeddata', resolve, { once: true }));
    if (!ready()) return; // another tap got there first
  }
  const { size, view } = currentLiveView();
  if (!size.width) return;
  // Scan only what is on screen: zooming in gives small text the detector's full resolution.
  const region = visibleRegion(view, size.width, size.height, innerWidth, innerHeight);
  const image = captureRegion(source, region, els.snapshot);
  if (source === els.live) els.live.pause();
  frozen = { region, view: null, lines: [], placements: [] };
  setFrozenView({ scale: 0, tx: 0, ty: 0 }); // clamps to fit: looks exactly like the live view did
  els.snapshot.hidden = false;
  source.hidden = true;
  dispatch({ type: 'freeze' });
  try {
    const { lines, timings } = await engine.scan(image);
    frozen.lines = lines;
    frozen.placements = placeLabels(lines, measure, region); // once per scan: labels then hold still while zooming
    debug.timings = timings;
    debug.region = region;
    testHook.lastScan = { lines, timings, region, placements: frozen.placements };
    dispatch({ type: 'scan-done', lineCount: lines.length });
    queueOverlay();
  } catch (err) {
    debug.error = err.message;
    dispatch({ type: 'scan-failed' });
    resume();
  }
}

function resume() {
  frozen = null;
  selection = null;
  lookupSeq++;
  els.snapshot.hidden = true;
  els.snapshot.width = 0; // releases the snapshot's memory (iOS caps total canvas memory)
  els.snapshot.height = 0;
  queueOverlay();
  liveZoom = 1;
  source.hidden = false;
  layoutLive();
  if (source !== els.live) return;
  if (trackEnded(stream)) restartCamera();
  else els.live.play().catch(() => {});
}

// ── Overlay ─────────────────────────────────────────────────────────────────────────────────

function queueOverlay() {
  if (overlayQueued) return;
  overlayQueued = true;
  requestAnimationFrame(() => {
    overlayQueued = false;
    drawOverlay();
  });
}

// Label text width, measured with the overlay's own canvas.
const overlayContext = els.overlay.getContext('2d');
function measure(text, size) {
  overlayContext.font = labelFont(size);
  return overlayContext.measureText(text).width;
}

function drawOverlay() {
  const dpr = devicePixelRatio || 1;
  const canvas = els.overlay;
  canvas.width = Math.round(innerWidth * dpr); // also clears it
  canvas.height = Math.round(innerHeight * dpr);
  if (!frozen?.lines.length || !state.pinyinVisible) return;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const labels = layoutLabels(frozen.lines, frozen.view, measure, frozen.placements);
  testHook.labels = labels;
  drawLabels(ctx, labels);
  if (selection) {
    const { line, token, start, end } = selection;
    const chars = frozen.lines[line].tokens[token].chars.slice(start, end);
    drawHighlight(ctx, chars.map((c) => c.quad), frozen.view);
  }
}

// ── Tap for meaning ─────────────────────────────────────────────────────────────────────────

// A tap on the frozen view: the word under it goes on the card; a tap away from the text closes it.
async function showMeaning(x, y) {
  const hit = charAt(frozen.lines, frozen.view, x, y);
  if (!hit) return closeCard();
  const seq = ++lookupSeq;
  const { chars } = frozen.lines[hit.line].tokens[hit.token];
  const readings = chars.map((c) => c.pinyin ?? '');
  const show = (start, end, entries, error = null) => {
    selection = { line: hit.line, token: hit.token, start, end };
    const word = chars.slice(start, end);
    const reading = readings.slice(start, end).filter(Boolean).join(' ');
    dispatch({ type: 'show-card', card: { word: word.map((c) => c.ch).join(''), reading, entries, error } });
    queueOverlay();
  };
  show(hit.char, hit.char + 1, null); // the character alone until the dictionary finds its word
  try {
    const result = await dictionary.lookup(chars.map((c) => c.ch).join(''), hit.char, readings);
    if (seq !== lookupSeq) return;
    if (state.dict !== 'ready') dispatch({ type: 'dict-ready' });
    show(result.start, result.end, result.entries);
  } catch (err) {
    if (seq !== lookupSeq) return;
    debug.error = `dictionary: ${err.message}`;
    show(hit.char, hit.char + 1, null, err.message);
  }
}

function closeCard() {
  lookupSeq++;
  selection = null;
  if (state.card) dispatch({ type: 'close-card' });
  queueOverlay();
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────

els.start.addEventListener('click', startCamera);
els.shutter.addEventListener('click', () => {
  if (state.screen === 'live') freeze();
  else if (state.screen === 'frozen') {
    dispatch({ type: 'resume' });
    resume();
  }
});
els.toggle.addEventListener('click', () => {
  dispatch({ type: 'toggle-pinyin' });
  queueOverlay();
});
els.aboutButton.addEventListener('click', () => dispatch({ type: 'open-about' }));
els.aboutClose.addEventListener('click', () => dispatch({ type: 'close-about' }));
els.about.addEventListener('close', () => state.about && dispatch({ type: 'close-about' })); // Escape key
els.debugToggle.addEventListener('click', () => {
  debug.enabled = !debug.enabled;
  renderDebug(els.debug, els.debugToggle, debug);
});
els.cardClose.addEventListener('click', closeCard);
let swipeFrom = null;
els.cardHead.addEventListener('pointerdown', (event) => {
  swipeFrom = event.clientY;
});
// On window: a mouse isn't captured, so its release can land anywhere.
addEventListener('pointerup', (event) => {
  if (swipeFrom !== null && event.clientY - swipeFrom > SWIPE_CLOSE) closeCard();
  swipeFrom = null;
});
addEventListener('pointercancel', () => {
  swipeFrom = null;
});
els.retry.addEventListener('click', () => location.reload());
els.reset.addEventListener('click', async () => {
  await loader.clear().catch(() => {});
  for (const registration of (await navigator.serviceWorker?.getRegistrations()) ?? []) await registration.unregister();
  try {
    localStorage.removeItem(STARTED_KEY);
    localStorage.removeItem(HINTED_KEY);
  } catch {
    // nothing stored
  }
  location.reload();
});

bindGestures(els.stage, {
  onPinch(factor, x, y) {
    if (state.screen === 'live') {
      liveZoom = Math.min(MAX_LIVE_ZOOM, Math.max(1, liveZoom * factor));
      layoutLive();
    } else if (frozen) setFrozenView(zoomAt(frozen.view, factor, x, y));
  },
  onDrag(dx, dy) {
    if (frozen) setFrozenView(panBy(frozen.view, dx, dy));
  },
  onTap(x, y) {
    if (state.screen === 'frozen') showMeaning(x, y);
  },
});

els.live.addEventListener('loadedmetadata', layoutLive);
els.live.addEventListener('resize', layoutLive); // camera frames change shape when the phone rotates
addEventListener('resize', () => {
  const previous = viewport;
  viewport = { width: innerWidth, height: innerHeight };
  if (!frozen) layoutLive();
  else {
    const { width, height } = frozen.region;
    setFrozenView(resizeView(frozen.view, width, height, previous.width, previous.height, viewport.width, viewport.height));
  }
});
document.addEventListener('visibilitychange', () => {
  // A frozen scan survives backgrounding; the camera is re-acquired when the user resumes.
  if (document.visibilityState !== 'visible' || source !== els.live || state.screen !== 'live') return;
  if (trackEnded(stream)) restartCamera();
  else els.live.play().catch(() => {});
});

render(els, state);
renderDebug(els.debug, els.debugToggle, debug);
if (!WebAssembly.validate(SIMD_PROBE)) {
  dispatch({ type: 'fatal', kind: 'unsupported', message: '' });
} else {
  startEngine();
  if (storage.get(STARTED_KEY)) startCamera();
}
