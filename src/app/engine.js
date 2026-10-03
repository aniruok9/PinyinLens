// Main-thread client for the OCR worker. One request at a time; a watchdog terminates a worker
// that hangs or crashes, and the next request starts a fresh one from cached assets.
//   spawnWorker(): a Worker (or anything with postMessage/terminate/onmessage/onerror)
//   loadInit(): Promise<{ message, transfer }> — the init payload (asset bytes) to send
export function createEngine({ spawnWorker, loadInit, scanTimeoutMs = 15_000, initTimeoutMs = 60_000 }) {
  let worker = null;
  let starting = null;
  let pending = null;
  let nextId = 1;

  function settle(error, value) {
    if (!pending) return;
    const { resolve, reject, timer } = pending;
    clearTimeout(timer);
    pending = null;
    if (error) reject(error);
    else resolve(value);
  }

  // The worker is unusable: drop it and fail the request in flight.
  function discard(error) {
    worker?.terminate();
    worker = null;
    starting = null;
    settle(error);
  }

  function request(message, transfer, timeoutMs) {
    if (pending) return Promise.reject(new Error('OCR engine is busy'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => discard(new Error('OCR timed out')), timeoutMs);
      pending = { id, resolve, reject, timer };
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  function spawn() {
    worker = spawnWorker();
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'error') settle(new Error(data.message));
      else settle(null, data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      discard(new Error(event.message || 'OCR worker crashed'));
    };
  }

  // Resolves with the worker's 'ready' reply. Safe to call repeatedly.
  function init() {
    if (!starting) {
      starting = (async () => {
        spawn();
        const { message, transfer } = await loadInit();
        return request({ type: 'init', ...message }, transfer, initTimeoutMs);
      })();
      starting.catch(() => discard(null));
    }
    return starting;
  }

  // image: { data: Uint8ClampedArray, width, height }. Its buffer is transferred to the worker.
  async function scan(image) {
    await init();
    const { lines, timings } = await request(
      { type: 'scan', width: image.width, height: image.height, data: image.data.buffer },
      [image.data.buffer],
      scanTimeoutMs,
    );
    return { lines, timings };
  }

  return { init, scan };
}
