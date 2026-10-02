// Reads ModelProto.metadata_props from an ONNX file without a protobuf library.
// ONNX: ModelProto field 14 = repeated StringStringEntryProto { key = 1; value = 2 }.

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [result, pos];
}

// Yields the length-delimited fields of one protobuf message; skips the others.
function* lengthDelimitedFields(buf, start, end) {
  let pos = start;
  while (pos < end) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) [, pos] = readVarint(buf, pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      yield { field, start: pos, end: pos + len };
      pos += len;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
}

export function readOnnxMetadata(buf) {
  const decoder = new TextDecoder();
  const meta = {};
  for (const f of lengthDelimitedFields(buf, 0, buf.length)) {
    if (f.field !== 14) continue;
    let key = '';
    let value = '';
    for (const e of lengthDelimitedFields(buf, f.start, f.end)) {
      const text = decoder.decode(buf.subarray(e.start, e.end));
      if (e.field === 1) key = text;
      else if (e.field === 2) value = text;
    }
    meta[key] = value;
  }
  return meta;
}

// RapidOCR-converted PaddleOCR recognizers store their character list, one per line,
// under the "character" metadata key.
export function charsetFromOnnx(buf) {
  const { character } = readOnnxMetadata(buf);
  if (!character) throw new Error('ONNX model has no "character" metadata');
  const chars = character.split('\n');
  if (chars[chars.length - 1] === '') chars.pop();
  return chars;
}
