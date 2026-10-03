// App state machine (spec §4, §8): a pure reducer. Effects (camera, engine, drawing) live in main.js.
//   screen: 'intro' | 'live' | 'scanning' | 'frozen' | 'error'
//   engine: 'loading' | 'ready' | 'failed'
//   progress: 0..1 of the first-run asset download
//   error: { kind: 'unsupported' | 'camera' | 'engine', message } when screen is 'error'
//   notice: a short message for the toast, or null
export const initialState = { screen: 'intro', engine: 'loading', progress: 0, error: null, notice: null };

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
      return state.screen === 'frozen' ? { ...state, screen: 'live', notice: null } : state;
    case 'notice':
      return { ...state, notice: event.message };
    case 'dismiss-notice':
      return { ...state, notice: null };
    default:
      return state;
  }
}
