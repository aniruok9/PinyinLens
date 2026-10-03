// Loads the OCR assets listed in ocr/manifest.json. Each file comes from the Cache API when the
// cached copy's SHA-256 matches the manifest, otherwise from the network (byte progress, retries
// with backoff), and is verified before it is cached. Dependencies are injected for Node tests.

const CACHE_PREFIX = 'pinyinlens-assets-';

const hex = (digest) => [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function createAssetLoader({
  baseUrl,
  fetchFn = (...args) => fetch(...args),
  cacheStorage = globalThis.caches,
  subtle = globalThis.crypto.subtle,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
}) {
  const sha256 = async (buffer) => hex(await subtle.digest('SHA-256', buffer));
  const urlOf = (file) => new URL(file, baseUrl).href;

  async function loadManifest() {
    const response = await fetchFn(urlOf('manifest.json'));
    if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`);
    return response.json();
  }

  async function readCached(cache, entry) {
    const hit = await cache.match(urlOf(entry.file));
    if (!hit) return null;
    const buffer = await hit.arrayBuffer();
    if (buffer.byteLength === entry.size && (await sha256(buffer)) === entry.sha256) return buffer;
    await cache.delete(urlOf(entry.file)); // corrupt or stale: drop it and download again
    return null;
  }

  async function downloadOnce(entry, onBytes) {
    // Revalidate with the server: after a deploy changes a file under the same name, a stale
    // HTTP-cached copy would fail the checksum on every retry.
    const response = await fetchFn(urlOf(entry.file), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onBytes(received);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if ((await sha256(bytes.buffer)) !== entry.sha256) throw new Error('checksum mismatch');
    return bytes.buffer;
  }

  async function download(entry, onBytes) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await downloadOnce(entry, onBytes);
      } catch (err) {
        onBytes(0);
        if (attempt >= attempts) throw new Error(`${entry.file}: ${err.message}`);
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }

  // entries: [{ file, size, sha256 }] from the manifest. Returns Map(file → ArrayBuffer).
  // onProgress(loadedBytes, totalBytes) is called as files arrive.
  async function load(manifest, entries, onProgress = () => {}) {
    const cache = await cacheStorage.open(CACHE_PREFIX + manifest.version);
    const total = entries.reduce((sum, e) => sum + e.size, 0);
    const loaded = new Map();
    const report = () => onProgress([...loaded.values()].reduce((sum, n) => sum + n, 0), total);
    const buffers = new Map();
    for (const entry of entries) {
      let buffer = await readCached(cache, entry);
      if (!buffer) {
        buffer = await download(entry, (bytes) => {
          loaded.set(entry.file, bytes);
          report();
        });
        // The Response copies the bytes. Caching is best effort: without it (storage full, restricted
        // private mode) this visit still works and the next one downloads again.
        await cache.put(urlOf(entry.file), new Response(buffer)).catch(() => {});
      }
      loaded.set(entry.file, entry.size);
      report();
      buffers.set(entry.file, buffer);
    }
    for (const name of await cacheStorage.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_PREFIX + manifest.version) await cacheStorage.delete(name);
    }
    return buffers;
  }

  // Deletes every asset cache (used by "Reset app data").
  async function clear() {
    for (const name of await cacheStorage.keys()) {
      if (name.startsWith(CACHE_PREFIX)) await cacheStorage.delete(name);
    }
  }

  return { loadManifest, load, clear };
}
