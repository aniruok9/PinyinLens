import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DET_MODELS } from '../models.config.js';

// Layout of models/ (gitignored), written by scripts/fetch-models.js.
export const MODELS_DIR = fileURLToPath(new URL('../../models/', import.meta.url));
export const detFile = (id) => `${MODELS_DIR}det-${id}.onnx`;
export const recFile = (id) => `${MODELS_DIR}rec-${id}.onnx`;
export const charsetFile = (id) => `${MODELS_DIR}rec-${id}.charset.json`;

function need(path) {
  if (!existsSync(path)) throw new Error(`${path} is missing. Run: npm run fetch-models`);
  return path;
}

export function loadDet(id) {
  return { bytes: readFileSync(need(detFile(id))), params: DET_MODELS[id].params };
}

export function loadRec(id) {
  return {
    bytes: readFileSync(need(recFile(id))),
    charset: JSON.parse(readFileSync(need(charsetFile(id)), 'utf8')),
  };
}
