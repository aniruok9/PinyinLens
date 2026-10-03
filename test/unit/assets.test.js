import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAssetLoader } from '../../src/app/assets.js';

const BASE = 'https://example.test/app/ocr/';
const bytes = (text) => new TextEncoder().encode(text);
const sha = (data) => createHash('sha256').update(data).digest('hex');
const entry = (file, text) => ({ file, size: bytes(text).length, sha256: sha(bytes(text)) });

// In-memory CacheStorage with just the methods the loader uses.
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (url) => (store.has(url) ? new Response(store.get(url).slice()) : undefined),
        put: async (url, response) => void store.set(url, new Uint8Array(await response.arrayBuffer())),
        delete: async (url) => store.delete(url),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  };
}

// fetch stand-in serving `files` (name → text); `failures` makes the next N requests for a file fail.
function fakeFetch(files, failures = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    const name = String(url).slice(BASE.length);
    calls.push(name);
    if (failures[name] > 0) {
      failures[name]--;
      return new Response('nope', { status: 503 });
    }
    return name in files ? new Response(bytes(files[name])) : new Response('missing', { status: 404 });
  };
  return { fetchFn, calls };
}

const loader = (fetchFn, cacheStorage) =>
  createAssetLoader({ baseUrl: BASE, fetchFn, cacheStorage, subtle: webcrypto.subtle, sleep: async () => {} });
const text = (buffer) => new TextDecoder().decode(buffer);

describe('createAssetLoader', () => {
  const files = { 'a.bin': 'alpha', 'b.bin': 'bravo!' };
  const manifest = { version: 'v1' };
  const entries = [entry('a.bin', 'alpha'), entry('b.bin', 'bravo!')];

  it('downloads, verifies, caches, and reports byte progress', async () => {
    const { fetchFn } = fakeFetch(files);
    const caches = fakeCaches();
    const progress = [];
    const out = await loader(fetchFn, caches).load(manifest, entries, (loaded, total) => progress.push([loaded, total]));
    expect(text(out.get('a.bin'))).toBe('alpha');
    expect(text(out.get('b.bin'))).toBe('bravo!');
    expect(progress.at(-1)).toEqual([11, 11]);
    expect([...caches.stores.get('pinyinlens-assets-v1').keys()]).toEqual([BASE + 'a.bin', BASE + 'b.bin']);
  });

  it('serves verified files from the cache without touching the network', async () => {
    const caches = fakeCaches();
    await loader(fakeFetch(files).fetchFn, caches).load(manifest, entries);
    const { fetchFn, calls } = fakeFetch({});
    const out = await loader(fetchFn, caches).load(manifest, entries);
    expect(calls).toEqual([]);
    expect(text(out.get('b.bin'))).toBe('bravo!');
  });

  it('replaces a corrupted cached file with a fresh download', async () => {
    const caches = fakeCaches();
    await loader(fakeFetch(files).fetchFn, caches).load(manifest, entries);
    caches.stores.get('pinyinlens-assets-v1').set(BASE + 'a.bin', bytes('alphX'));
    const { fetchFn, calls } = fakeFetch(files);
    const out = await loader(fetchFn, caches).load(manifest, entries);
    expect(calls).toEqual(['a.bin']);
    expect(text(out.get('a.bin'))).toBe('alpha');
  });

  it('retries failed downloads, then gives up with the file name', async () => {
    const flaky = fakeFetch(files, { 'a.bin': 2 });
    const out = await loader(flaky.fetchFn, fakeCaches()).load(manifest, entries);
    expect(text(out.get('a.bin'))).toBe('alpha');
    expect(flaky.calls.filter((c) => c === 'a.bin')).toHaveLength(3);

    const broken = fakeFetch(files, { 'a.bin': 3 });
    await expect(loader(broken.fetchFn, fakeCaches()).load(manifest, entries)).rejects.toThrow('a.bin: HTTP 503');
  });

  it('rejects a download whose checksum does not match', async () => {
    const { fetchFn } = fakeFetch({ ...files, 'a.bin': 'tampered' });
    await expect(loader(fetchFn, fakeCaches()).load(manifest, entries)).rejects.toThrow('a.bin: checksum mismatch');
  });

  it('deletes asset caches from older manifests, and clear() deletes them all', async () => {
    const caches = fakeCaches();
    await caches.open('pinyinlens-assets-old');
    await caches.open('unrelated');
    const assets = loader(fakeFetch(files).fetchFn, caches);
    await assets.load(manifest, entries);
    expect([...caches.stores.keys()]).toEqual(['unrelated', 'pinyinlens-assets-v1']);
    await assets.clear();
    expect([...caches.stores.keys()]).toEqual(['unrelated']);
  });

  it('loads the manifest from the base URL', async () => {
    const { fetchFn } = fakeFetch({ 'manifest.json': '{"version":"v9"}' });
    expect(await loader(fetchFn, fakeCaches()).loadManifest()).toEqual({ version: 'v9' });
  });
});
