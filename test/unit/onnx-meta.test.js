import { describe, expect, it } from 'vitest';
import { charsetFromOnnx, readOnnxMetadata } from '../../scripts/lib/onnx-meta.js';

// Minimal protobuf encoder for building synthetic ONNX headers.
const varint = (n) => {
  const out = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const lenField = (field, bytes) => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
const intField = (field, n) => [...varint(field * 8), ...varint(n)];
const utf8 = (s) => [...new TextEncoder().encode(s)];
const entry = (key, value) => lenField(14, [...lenField(1, utf8(key)), ...lenField(2, utf8(value))]);

describe('readOnnxMetadata', () => {
  it('reads metadata_props and skips other fields', () => {
    const buf = Uint8Array.from([
      ...intField(1, 8), // ir_version
      ...lenField(2, utf8('pytorch')), // producer_name
      ...entry('character', 'a\nb'),
      ...lenField(7, new Array(300).fill(0)), // graph: 300-byte payload needs a 2-byte length varint
      ...entry('shape', '[3, 48, 320]'),
    ]);
    expect(readOnnxMetadata(buf)).toEqual({ character: 'a\nb', shape: '[3, 48, 320]' });
  });

  it('returns an empty object when there is no metadata', () => {
    expect(readOnnxMetadata(Uint8Array.from(intField(1, 8)))).toEqual({});
  });
});

describe('charsetFromOnnx', () => {
  it('splits the character list one entry per line, keeping space-like entries', () => {
    const buf = Uint8Array.from(entry('character', '　\n一\n乙\n'));
    expect(charsetFromOnnx(buf)).toEqual(['　', '一', '乙']);
  });

  it('throws when the model carries no character list', () => {
    expect(() => charsetFromOnnx(Uint8Array.from(entry('other', 'x')))).toThrow(/character/);
  });
});
