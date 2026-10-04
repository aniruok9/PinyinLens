// Main-thread client for the dictionary worker (spec §7.4). Loads the compact CC-CEDICT once,
// then answers lookups; several may be in flight, matched to replies by id. A failed load or a
// crashed worker is dropped, and the next lookup starts over.
//   spawnWorker(): a Worker (or anything with postMessage/terminate/onmessage/onerror)
//   loadBytes(): Promise<ArrayBuffer> — the dictionary file (transferred to the worker)
export function createDictionaryClient({ spawnWorker, loadBytes }) {
  let worker = null;
  let loading = null;
  let nextId = 1;
  const pending = new Map();

  function reset(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    loading = null;
  }

  function request(message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  function load() {
    if (!loading) {
      loading = (async () => {
        worker = spawnWorker();
        worker.onmessage = ({ data }) => {
          const waiter = pending.get(data.id);
          if (!waiter) return;
          pending.delete(data.id);
          if (data.type === 'error') waiter.reject(new Error(data.message));
          else waiter.resolve(data);
        };
        worker.onerror = (event) => {
          event.preventDefault?.();
          reset(new Error(event.message || 'Dictionary worker crashed'));
        };
        const bytes = await loadBytes();
        return request({ type: 'load', bytes }, [bytes]);
      })();
      loading.catch((err) => reset(err));
    }
    return loading;
  }

  // The word containing run[index], with its entries: { word, start, end, entries }.
  async function lookup(run, index, readings) {
    await load();
    return (await request({ type: 'lookup', run, index, readings })).result;
  }

  return { load, lookup };
}
