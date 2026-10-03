import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../src/app/engine.js';

// A scripted stand-in for the OCR worker. `behaviour(message)` returns the reply to post back,
// 'hang' to never reply, or 'crash' to fire onerror.
function fakeWorkers(behaviour) {
  const spawned = [];
  const spawnWorker = () => {
    const worker = {
      terminated: false,
      messages: [],
      postMessage(message, transfer) {
        worker.messages.push({ message, transfer });
        const reply = behaviour(message, spawned.length);
        if (reply === 'hang') return;
        queueMicrotask(() => {
          if (reply === 'crash') worker.onerror({ message: 'boom', preventDefault() {} });
          else worker.onmessage({ data: { id: message.id, ...reply } });
        });
      },
      terminate() {
        worker.terminated = true;
      },
    };
    spawned.push(worker);
    return worker;
  };
  return { spawnWorker, spawned };
}

const ok = (message) => (message.type === 'init' ? { type: 'ready', ms: 5 } : { type: 'result', lines: ['L'], timings: { total: 1 } });
const image = () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 });
const loadInit = async () => ({ message: { wasm: new ArrayBuffer(1) }, transfer: [] });

describe('createEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('initialises once, then scans, transferring the image buffer', async () => {
    const { spawnWorker, spawned } = fakeWorkers(ok);
    const engine = createEngine({ spawnWorker, loadInit });
    expect(await engine.init()).toMatchObject({ type: 'ready' });
    const img = image();
    expect(await engine.scan(img)).toEqual({ lines: ['L'], timings: { total: 1 } });
    expect(spawned).toHaveLength(1);
    const scan = spawned[0].messages[1];
    expect(scan.message).toMatchObject({ type: 'scan', width: 2, height: 2 });
    expect(scan.transfer).toEqual([img.data.buffer]);
  });

  it('rejects a second request while one is in flight', async () => {
    const { spawnWorker } = fakeWorkers((m) => (m.type === 'scan' ? 'hang' : ok(m)));
    const engine = createEngine({ spawnWorker, loadInit });
    await engine.init();
    const first = engine.scan(image());
    await vi.advanceTimersByTimeAsync(0);
    await expect(engine.scan(image())).rejects.toThrow('busy');
    first.catch(() => {});
  });

  it('reports worker errors as rejections', async () => {
    const { spawnWorker } = fakeWorkers((m) => (m.type === 'scan' ? { type: 'error', message: 'bad image' } : ok(m)));
    const engine = createEngine({ spawnWorker, loadInit });
    await expect(engine.scan(image())).rejects.toThrow('bad image');
  });

  it('replaces a hung worker after the watchdog fires', async () => {
    const { spawnWorker, spawned } = fakeWorkers((m, n) => (m.type === 'scan' && n === 1 ? 'hang' : ok(m)));
    const engine = createEngine({ spawnWorker, loadInit, scanTimeoutMs: 1000 });
    const scan = expect(engine.scan(image())).rejects.toThrow('OCR timed out');
    await vi.advanceTimersByTimeAsync(1000);
    await scan;
    expect(spawned[0].terminated).toBe(true);
    expect(await engine.scan(image())).toMatchObject({ lines: ['L'] });
    expect(spawned).toHaveLength(2);
  });

  it('replaces a crashed worker', async () => {
    const { spawnWorker, spawned } = fakeWorkers((m, n) => (m.type === 'scan' && n === 1 ? 'crash' : ok(m)));
    const engine = createEngine({ spawnWorker, loadInit });
    await expect(engine.scan(image())).rejects.toThrow('boom');
    expect(await engine.scan(image())).toMatchObject({ lines: ['L'] });
    expect(spawned).toHaveLength(2);
  });

  it('lets init be retried after a failed start', async () => {
    let fail = true;
    const { spawnWorker } = fakeWorkers(ok);
    const flakyInit = async () => {
      if (fail) throw new Error('offline');
      return loadInit();
    };
    const engine = createEngine({ spawnWorker, loadInit: flakyInit });
    await expect(engine.init()).rejects.toThrow('offline');
    fail = false;
    expect(await engine.init()).toMatchObject({ type: 'ready' });
  });
});
