import { describe, expect, it } from 'vitest';
import { DET_MODELS, REC_MODELS } from '../../scripts/models.config.js';
import { loadDet, loadRec } from '../../scripts/lib/model-files.js';
import { ort } from '../../scripts/lib/ort-node.js';

const zeros = (dims) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b)), dims);

async function runOnce(bytes, dims) {
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  try {
    const out = await session.run({ [session.inputNames[0]]: zeros(dims) });
    return out[session.outputNames[0]];
  } finally {
    await session.release();
  }
}

describe.each(Object.keys(DET_MODELS))('detector %s', (id) => {
  it('outputs a 1-channel probability map at input resolution', async () => {
    const out = await runOnce(loadDet(id).bytes, [1, 3, 64, 96]);
    expect(out.dims).toEqual([1, 1, 64, 96]);
  });
});

describe.each(Object.keys(REC_MODELS))('recognizer %s', (id) => {
  it('has blank + charset + space output classes and width/8 timesteps', async () => {
    const { bytes, charset } = loadRec(id);
    expect(charset).toHaveLength(REC_MODELS[id].charset.count);
    const out = await runOnce(bytes, [2, 3, 48, 328]);
    expect(out.dims).toEqual([2, 41, charset.length + 2]);
  });
});
