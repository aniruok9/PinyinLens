import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as ort from 'onnxruntime-web/wasm';

// Same runtime and setup the browser worker uses: the plain WASM build, handed its
// binary directly (no fetching), single-threaded.
const require = createRequire(import.meta.url);
ort.env.wasm.wasmBinary = readFileSync(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
ort.env.wasm.numThreads = 1;

export { ort };
