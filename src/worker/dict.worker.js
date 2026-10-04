import { createDictionary } from '../text/dict.js';
import { createDictCore } from './dict-core.js';

const handle = createDictCore({ createDictionary });

self.onmessage = async ({ data }) => {
  self.postMessage(await handle(data));
};
