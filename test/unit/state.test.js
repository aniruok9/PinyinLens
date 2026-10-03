import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../src/app/state.js';

const run = (events, from = initialState) => events.reduce(reduce, from);
const live = run([{ type: 'start' }, { type: 'engine-ready' }]);

describe('reduce', () => {
  it('starts on the intro with the engine loading', () => {
    expect(initialState).toMatchObject({ screen: 'intro', engine: 'loading', progress: 0 });
  });

  it('tracks download progress and engine readiness independently of the screen', () => {
    const state = run([{ type: 'progress', value: 0.5 }, { type: 'start' }]);
    expect(state).toMatchObject({ screen: 'live', engine: 'loading', progress: 0.5 });
    expect(reduce(state, { type: 'engine-ready' })).toMatchObject({ engine: 'ready', progress: 1 });
  });

  it('only freezes when live and the engine is ready', () => {
    expect(run([{ type: 'start' }, { type: 'freeze' }]).screen).toBe('live');
    expect(reduce(live, { type: 'freeze' }).screen).toBe('scanning');
  });

  it('goes scanning → frozen, with a notice when nothing was found', () => {
    const scanning = reduce(live, { type: 'freeze' });
    expect(reduce(scanning, { type: 'scan-done', lineCount: 3 })).toMatchObject({ screen: 'frozen', notice: null });
    expect(reduce(scanning, { type: 'scan-done', lineCount: 0 }).notice).toMatch(/No Chinese text/);
  });

  it('returns to live with a notice when a scan fails', () => {
    const scanning = reduce(live, { type: 'freeze' });
    expect(reduce(scanning, { type: 'scan-failed' })).toMatchObject({ screen: 'live', notice: 'Scan failed. Try again.' });
  });

  it('resumes from frozen only', () => {
    const frozen = run([{ type: 'freeze' }, { type: 'scan-done', lineCount: 1 }], live);
    expect(reduce(frozen, { type: 'resume' }).screen).toBe('live');
    expect(reduce(live, { type: 'resume' })).toBe(live);
  });

  it('ignores scan results that arrive after leaving the scanning screen', () => {
    expect(reduce(live, { type: 'scan-done', lineCount: 2 })).toBe(live);
    expect(reduce(live, { type: 'scan-failed' })).toBe(live);
  });

  it('shows fatal errors, marking the engine failed for engine errors', () => {
    expect(reduce(live, { type: 'fatal', kind: 'camera', message: 'denied' })).toMatchObject({
      screen: 'error',
      engine: 'ready',
      error: { kind: 'camera', message: 'denied' },
    });
    expect(reduce(live, { type: 'fatal', kind: 'engine', message: 'x' }).engine).toBe('failed');
  });

  it('sets and clears notices', () => {
    const noted = reduce(live, { type: 'notice', message: 'hello' });
    expect(noted.notice).toBe('hello');
    expect(reduce(noted, { type: 'dismiss-notice' }).notice).toBeNull();
  });
});
