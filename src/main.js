import { initCamera } from './camera.js';
import { initOCR, detectText } from './ocr.js';
import { renderOverlay } from './overlay.js';
import { convertPinyin } from './pinyin.js';

const video = document.getElementById('camera-video');
const canvas = document.getElementById('camera-canvas');
const ctx = canvas.getContext('2d');
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const loadingStatus = document.getElementById('loading-status');

let latestResults = null;
let frozen = false;
let ocrBusy = false;

function updateProgress(pct, status) {
  progressFill.style.width = `${pct}%`;
  loadingStatus.textContent = status;
}

async function init() {
  if (!crossOriginIsolated) {
    // ONNX Runtime's WASM binary requires SharedArrayBuffer (shared WebAssembly.Memory),
    // which is only available when crossOriginIsolated is true.
    // coi-serviceworker injects COOP/COEP headers via a service worker and reloads the page,
    // but there's a race condition: on slower devices the reload can happen before the SW
    // has fully activated and claimed the page, leaving crossOriginIsolated false.
    // We must not proceed — ONNX init will hang or throw without shared memory.
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

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  startRenderLoop();
  startOCRLoop();

  canvas.addEventListener('click', () => {
    frozen = !frozen;
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !video.srcObject) {
      await initCamera(video);
    }
  });
}

function startRenderLoop() {
  function frame() {
    if (!frozen) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    if (latestResults) {
      renderOverlay(ctx, latestResults);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function startOCRLoop() {
  async function tick() {
    if (!frozen && !ocrBusy) {
      ocrBusy = true;
      try {
        const regions = await detectText(video);
        latestResults = regions.map((r) => ({
          ...r,
          pinyin: convertPinyin(r.text),
        }));
      } catch (err) {
        console.error('OCR error:', err);
      }
      ocrBusy = false;
    }
    setTimeout(tick, 200);
  }
  tick();
}

init().catch((err) => {
  console.error('Init failed:', err);
  updateProgress(0, `Error: ${err.message}`);
});
