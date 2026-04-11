import { initCamera, stopCamera } from './camera.js';
import { renderOverlay } from './overlay.js';
import { convertPinyin } from './pinyin.js';

const video = document.getElementById('camera-video');
const canvas = document.getElementById('camera-canvas');
const ctx = canvas.getContext('2d');
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const loadingStatus = document.getElementById('loading-status');

let ocrWorker = null;
let latestResults = null;
let frozen = false;

function updateProgress(pct, status) {
  progressFill.style.width = `${pct}%`;
  loadingStatus.textContent = status;
}

async function init() {
  // Register COOP/COEP service worker
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/sw.js');
  }

  updateProgress(10, 'Starting camera...');
  await initCamera(video);

  updateProgress(30, 'Loading OCR models...');
  ocrWorker = new Worker(new URL('./ocr-worker.js', import.meta.url), { type: 'module' });

  await new Promise((resolve) => {
    ocrWorker.onmessage = (e) => {
      if (e.data.type === 'ready') {
        resolve();
      } else if (e.data.type === 'result') {
        onOCRResult(e.data.regions);
      }
    };
  });

  updateProgress(100, 'Ready');
  loadingScreen.classList.add('hidden');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  startRenderLoop();
  startOCRLoop();

  // Tap-to-freeze
  canvas.addEventListener('click', () => {
    frozen = !frozen;
  });

  // Visibility change: restart camera if needed
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !video.srcObject) {
      await initCamera(video);
    }
  });
}

function onOCRResult(regions) {
  // regions: [{ text, box: { x, y, width, height } }]
  latestResults = regions.map((r) => ({
    ...r,
    pinyin: convertPinyin(r.text),
  }));
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

let ocrFrameCount = 0;
function startOCRLoop() {
  function tick() {
    ocrFrameCount++;
    if (!frozen && ocrFrameCount % 4 === 0 && ocrWorker) {
      const bitmap = createImageBitmap(video);
      bitmap.then((bmp) => {
        ocrWorker.postMessage({ type: 'detect', bitmap: bmp }, [bmp]);
      });
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

init().catch((err) => {
  console.error('Init failed:', err);
  updateProgress(0, `Error: ${err.message}`);
});
