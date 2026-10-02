// Downloads the candidate OCR models from their pinned URLs, verifies SHA-256, and writes
//   models/det-<id>.onnx, models/rec-<id>.onnx, models/rec-<id>.charset.json
// Usage: node scripts/fetch-models.js [det:<id>|rec:<id> ...]   (no arguments = all candidates)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DET_MODELS, REC_MODELS } from './models.config.js';
import { MODELS_DIR, charsetFile, detFile, recFile } from './lib/model-files.js';
import { charsetFromOnnx } from './lib/onnx-meta.js';
import { charsetFromInferenceYaml } from './lib/yaml-charset.js';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url, expectedSha) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const actual = sha256(buf);
      if (actual !== expectedSha) throw new Error(`sha256 ${actual}, expected ${expectedSha}`);
      return buf;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      console.warn(`  retry ${attempt}: ${err.message}`);
    }
  }
}

async function fetchVerified(path, url, sha) {
  if (existsSync(path) && sha256(readFileSync(path)) === sha) {
    console.log(`ok     ${path}`);
    return readFileSync(path);
  }
  console.log(`fetch  ${url}`);
  const buf = await download(url, sha);
  writeFileSync(path, buf);
  return buf;
}

async function extractCharset(id, model, spec) {
  const charset =
    spec.from === 'onnx-metadata'
      ? charsetFromOnnx(model)
      : charsetFromInferenceYaml(
          (await fetchVerified(`${MODELS_DIR}rec-${id}.inference.yml`, spec.url, spec.sha256)).toString('utf8'),
        );
  if (charset.length !== spec.count) throw new Error(`rec-${id}: ${charset.length} characters, expected ${spec.count}`);
  writeFileSync(charsetFile(id), JSON.stringify(charset));
  console.log(`chars  rec-${id}: ${charset.length}`);
}

const wanted = process.argv.slice(2);
const want = (kind, id) => wanted.length === 0 || wanted.includes(`${kind}:${id}`);
mkdirSync(MODELS_DIR, { recursive: true });

for (const [id, m] of Object.entries(DET_MODELS)) {
  if (want('det', id)) await fetchVerified(detFile(id), m.url, m.sha256);
}
for (const [id, m] of Object.entries(REC_MODELS)) {
  if (want('rec', id)) await extractCharset(id, await fetchVerified(recFile(id), m.url, m.sha256), m.charset);
}
