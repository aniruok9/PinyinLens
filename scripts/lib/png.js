import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

// PNG file → RGBA image { data: Uint8ClampedArray, width, height } (pngjs always yields RGBA8).
export function loadPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
    width: png.width,
    height: png.height,
  };
}
