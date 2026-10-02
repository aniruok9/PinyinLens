import { describe, expect, it } from 'vitest';
import { charsetFromInferenceYaml } from '../../scripts/lib/yaml-charset.js';

const YML = `Global:
  model_name: PP-OCRv6_tiny_rec
Hpi:
  backend_configs:
    paddle_infer:
      trt_dynamic_shapes: &id001
        x:
        - - 1
          - 3
    tensorrt:
      dynamic_shapes: *id001
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '!'
  - 1
  - true
  - '~'
  - 中
  - ｜
`;

describe('charsetFromInferenceYaml', () => {
  it('returns every character_dict entry as a string', () => {
    expect(charsetFromInferenceYaml(YML)).toEqual(['!', '1', 'true', '~', '中', '｜']);
  });

  it('throws when the file has no character_dict', () => {
    expect(() => charsetFromInferenceYaml('PostProcess:\n  name: DBPostProcess\n')).toThrow(/character_dict/);
  });
});
