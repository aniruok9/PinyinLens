// App state machine (spec §4, §8): a pure reducer. Effects (camera, engine, drawing) live in main.js.
//   screen: 'intro' | 'live' | 'scanning' | 'frozen' | 'error'
//   engine: 'loading' | 'ready' | 'failed'
//   progress: 0..1 of the first-run asset download
//   error: { kind: 'unsupported' | 'camera' | 'engine', message } when screen is 'error'
//   notice: a short message for the toast, or null
//   pinyinVisible: the overlay's show/hide toggle (kept across scans)
//   card: the word card on a frozen scan: { word, reading, entries (null while looking up), error }, or null
//   about: whether the About sheet is open
//   dict: 'loading' | 'ready' | 'failed' — the background CC-CEDICT load
export const initialState = {
  screen: 'intro',
  engine: 'loading',
  progress: 0,
  error: null,
  notice: null,
  pinyinVisible: true,
  card: null,
  about: false,
  dict: 'loading',
};

export function reduce(state, event) {
  switch (event.type) {
    case 'start':
      return state.screen === 'intro' ? { ...state, screen: 'live' } : state;
    case 'progress':
      return { ...state, progress: event.value };
    case 'engine-ready':
      return { ...state, engine: 'ready', progress: 1 };
    case 'fatal':
      return {
        ...state,
        screen: 'error',
        engine: event.kind === 'engine' ? 'failed' : state.engine,
        error: { kind: event.kind, message: event.message },
      };
    case 'freeze':
      return state.screen === 'live' && state.engine === 'ready' ? { ...state, screen: 'scanning', notice: null } : state;
    case 'scan-done':
      if (state.screen !== 'scanning') return state;
      return { ...state, screen: 'frozen', notice: event.lineCount ? null : 'No Chinese text found. Try moving closer.' };
    case 'scan-failed':
      return state.screen === 'scanning' ? { ...state, screen: 'live', notice: 'Scan failed. Try again.' } : state;
    case 'resume':
      return state.screen === 'frozen' ? { ...state, screen: 'live', notice: null, card: null } : state;
    case 'show-card':
      return state.screen === 'frozen' ? { ...state, card: event.card } : state;
    case 'close-card':
      return { ...state, card: null };
    case 'toggle-pinyin':
      return { ...state, pinyinVisible: !state.pinyinVisible };
    case 'open-about':
      return { ...state, about: true };
    case 'close-about':
      return { ...state, about: false };
    case 'dict-ready':
      return { ...state, dict: 'ready' };
    case 'dict-failed':
      return { ...state, dict: 'failed' };
    case 'notice':
      return { ...state, notice: event.message };
    case 'dismiss-notice':
      return { ...state, notice: null };
    default:
      return state;
  }
}
