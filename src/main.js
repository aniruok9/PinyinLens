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
