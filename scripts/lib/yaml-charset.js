import { parse } from 'yaml';

// PaddlePaddle's official ONNX releases ship the character list in inference.yml under
// PostProcess.character_dict. The failsafe schema keeps every entry a string
// (so "1", "true" and "~" stay characters instead of becoming numbers/booleans/null).
export function charsetFromInferenceYaml(text) {
  const doc = parse(text, { schema: 'failsafe' });
  const list = doc?.PostProcess?.character_dict;
  if (!Array.isArray(list)) throw new Error('inference.yml has no PostProcess.character_dict list');
  return list.map(String);
}
