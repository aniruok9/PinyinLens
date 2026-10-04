import { describe, expect, it } from 'vitest';
import { createDictionaryClient } from '../../src/app/dictionary.js';

// A stand-in dictionary worker: replies to 'load' and echoes lookups; `crashOn` fires onerror.
function fakeWorkers({ crashOn } = {}) {
  const spawned = [];
  const spawnWorker = () => {
    const worker = {
      messages: [],
      terminated: false,
      postMessage(message, transfer) {
        worker.messages.push({ message, transfer });
        queueMicrotask(() => {
          if (message.type === crashOn) return worker.onerror({ message: 'boom', preventDefault() {} });
          const reply =
            message.type === 'load'
              ? { type: 'ready', words: 3 }
              : { type: 'result', result: { word: message.run.slice(message.index, message.index + 1), entries: [] } };
          worker.onmessage({ data: { id: message.id, ...reply } });
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

describe('createDictionaryClient', () => {
  it('loads once, transferring the dictionary bytes, then answers lookups', async () => {
    const { spawnWorker, spawned } = fakeWorkers();
    const bytes = new ArrayBuffer(8);
    let loads = 0;
    const client = createDictionaryClient({ spawnWorker, loadBytes: async () => (loads++, bytes) });
    const [a, b] = await Promise.all([client.lookup('可口', 0, []), client.lookup('可口', 1, [])]);
    expect([a.word, b.word]).toEqual(['可', '口']);
    expect(loads).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].messages[0]).toMatchObject({ message: { type: 'load', bytes }, transfer: [bytes] });
  });

  it('retries the load on the next lookup when the first one fails', async () => {
    const { spawnWorker, spawned } = fakeWorkers();
    let fail = true;
    const client = createDictionaryClient({
      spawnWorker,
      loadBytes: async () => {
        if (fail) throw new Error('offline');
        return new ArrayBuffer(1);
      },
    });
    await expect(client.lookup('面', 0, [])).rejects.toThrow('offline');
    expect(spawned[0].terminated).toBe(true);
    fail = false;
    expect((await client.lookup('面', 0, [])).word).toBe('面');
  });

  it('rejects pending lookups when the worker crashes, and starts a fresh worker next time', async () => {
    const workers = fakeWorkers({ crashOn: 'lookup' });
    const client = createDictionaryClient({ spawnWorker: workers.spawnWorker, loadBytes: async () => new ArrayBuffer(1) });
    await expect(client.lookup('面', 0, [])).rejects.toThrow('boom');
    expect(workers.spawned[0].terminated).toBe(true);
    await expect(client.lookup('面', 0, [])).rejects.toThrow('boom');
    expect(workers.spawned).toHaveLength(2);
  });
});
