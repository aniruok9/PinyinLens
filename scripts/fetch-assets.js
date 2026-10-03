// Build step: copies the shipped OCR assets into public/ocr/ and writes public/ocr/manifest.json
// (file names, sizes, SHA-256, detector params, default config) for the browser's asset loader.
// Run after `npm run fetch-models`. Usage: node scripts/fetch-assets.js
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { charsetFile, detFile, recFile } from './lib/model-files.js';
import { DEFAULT_CONFIG, DET_MODELS, SHIPPED } from './models.config.js';

const OUT = fileURLToPath(new URL('../public/ocr/', import.meta.url));
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (!SHIPPED.det.includes(DEFAULT_CONFIG.det) || !SHIPPED.rec.includes(DEFAULT_CONFIG.rec)) {
  throw new Error('DEFAULT_CONFIG models must be listed in SHIPPED');
}

// Copies one file into OUT and describes it for the manifest.
function put(source, file) {
  const bytes = readFileSync(source);
  writeFileSync(OUT + file, bytes);
  return { file, size: bytes.length, sha256: sha256(bytes) };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = {
  ort: put(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'),
  det: Object.fromEntries(
    SHIPPED.det.map((id) => [id, { ...put(detFile(id), `det-${id}.onnx`), params: DET_MODELS[id].params }]),
  ),
  rec: Object.fromEntries(
    SHIPPED.rec.map((id) => [
      id,
      { ...put(recFile(id), `rec-${id}.onnx`), charset: put(charsetFile(id), `rec-${id}.charset.json`) },
    ]),
  ),
  default: DEFAULT_CONFIG,
};
// The cache name derives from this, so any asset change starts a fresh cache.
manifest.version = sha256(JSON.stringify(manifest)).slice(0, 12);

writeFileSync(OUT + 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${OUT}manifest.json (version ${manifest.version})`);
