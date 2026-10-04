import { withReplies } from './replies.js';

// The dictionary worker's message handler, kept apart from `self` so Node tests can drive it.
//   { type: 'load', id, bytes }                 → { type: 'ready', id, words }
//   { type: 'lookup', id, run, index, readings } → { type: 'result', id, result: { word, start, end, entries } }
export function createDictCore({ createDictionary }) {
  let dictionary = null;

  async function handle(message) {
    if (message.type === 'load') {
      dictionary = createDictionary(new TextDecoder().decode(message.bytes));
      return { type: 'ready', words: dictionary.size };
    }
    if (message.type === 'lookup') {
      if (!dictionary) throw new Error('Dictionary not loaded');
      return { type: 'result', result: dictionary.lookup(message.run, message.index, message.readings) };
    }
    throw new Error(`Unknown message type: ${message.type}`);
  }

  return withReplies(handle);
}
