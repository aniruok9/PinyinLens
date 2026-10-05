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

describe('reduce: meaning card, pinyin toggle, About, dictionary', () => {
  const frozen = run([{ type: 'freeze' }, { type: 'scan-done', lineCount: 1 }], live);
  const card = { word: '可口', reading: 'kě kǒu', entries: null, error: null };

  it('starts with pinyin shown, no card, About closed, dictionary loading', () => {
    expect(initialState).toMatchObject({ pinyinVisible: true, card: null, about: false, dict: 'loading' });
  });

  it('shows the word card only on a frozen scan, and closes it on resume', () => {
    expect(reduce(live, { type: 'show-card', card }).card).toBeNull();
    const shown = reduce(frozen, { type: 'show-card', card });
    expect(shown.card).toEqual(card);
    expect(reduce(shown, { type: 'close-card' }).card).toBeNull();
    expect(reduce(shown, { type: 'resume' })).toMatchObject({ screen: 'live', card: null });
  });

  it('toggles pinyin visibility, and the choice survives resume', () => {
    const hidden = reduce(frozen, { type: 'toggle-pinyin' });
    expect(hidden.pinyinVisible).toBe(false);
    expect(reduce(hidden, { type: 'resume' }).pinyinVisible).toBe(false);
    expect(reduce(hidden, { type: 'toggle-pinyin' }).pinyinVisible).toBe(true);
  });

  it('opens and closes the About sheet', () => {
    const open = reduce(live, { type: 'open-about' });
    expect(open.about).toBe(true);
    expect(reduce(open, { type: 'close-about' }).about).toBe(false);
  });

  it('tracks the dictionary status', () => {
    expect(reduce(live, { type: 'dict-ready' }).dict).toBe('ready');
    expect(reduce(live, { type: 'dict-failed' }).dict).toBe('failed');
  });
});

describe('reduce: back to start', () => {
  const frozen = run([{ type: 'freeze' }, { type: 'scan-done', lineCount: 1 }], live);

  it('returns from the live camera or a frozen scan to the title, dropping the card and notice', () => {
    expect(reduce(live, { type: 'back' })).toMatchObject({ screen: 'intro', engine: 'ready' });
    const withCard = run([{ type: 'show-card', card: { word: '面' } }, { type: 'notice', message: 'hi' }], frozen);
    expect(reduce(withCard, { type: 'back' })).toMatchObject({ screen: 'intro', card: null, notice: null });
    expect(reduce(reduce(withCard, { type: 'back' }), { type: 'start' }).screen).toBe('live');
  });

  it('is ignored while a scan runs, and on the title or error screens', () => {
    const scanning = reduce(live, { type: 'freeze' });
    expect(reduce(scanning, { type: 'back' })).toBe(scanning);
    expect(reduce(initialState, { type: 'back' })).toBe(initialState);
    const failed = reduce(live, { type: 'fatal', kind: 'camera', message: 'x' });
    expect(reduce(failed, { type: 'back' })).toBe(failed);
  });
});
