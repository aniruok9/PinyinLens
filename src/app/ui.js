// Renders app state into the static DOM of index.html (spec §7.5, §8).

const ERRORS = {
  unsupported: {
    title: "This browser can't run PinyinLens",
    hint: 'It needs WebAssembly SIMD: Safari 16.4 or later on iPhone, or a recent Chrome, Edge or Firefox.',
  },
  camera: {
    title: 'Camera unavailable',
    hint: 'Allow camera access: on iPhone, Settings › Safari › Camera; in Chrome, tap the lock icon › Permissions › Camera.',
  },
  engine: {
    title: "Couldn't load the reading engine",
    hint: 'Check your connection and try again. If it keeps failing, reset the app data.',
  },
};

const SHUTTER_LABELS = { loading: 'Loading reading engine', freeze: 'Freeze and scan', busy: 'Scanning', resume: 'Back to camera' };
const RING = 2 * Math.PI * 32; // circumference of the shutter's progress ring (r = 32)

export function render(els, state) {
  document.body.dataset.state = state.screen;
  document.body.dataset.engine = state.engine;
  document.body.dataset.dict = state.dict;
  els.intro.hidden = state.screen !== 'intro';
  els.error.hidden = state.screen !== 'error';
  if (state.error) {
    const copy = ERRORS[state.error.kind];
    els.errorTitle.textContent = copy.title;
    els.errorMessage.textContent = state.error.message ? `${copy.hint} (${state.error.message})` : copy.hint;
    els.retry.hidden = state.error.kind === 'unsupported';
    els.reset.hidden = state.error.kind !== 'engine';
  }
  const mode =
    state.screen === 'scanning' ? 'busy' : state.screen === 'frozen' ? 'resume' : state.engine === 'ready' ? 'freeze' : 'loading';
  els.shutter.hidden = !['live', 'scanning', 'frozen'].includes(state.screen);
  els.shutter.dataset.mode = mode;
  els.shutter.disabled = mode === 'loading' || mode === 'busy';
  els.shutter.setAttribute('aria-label', SHUTTER_LABELS[mode]);
  els.progress.style.strokeDashoffset = String(RING * (1 - state.progress));
  els.notice.hidden = !state.notice;
  els.notice.textContent = state.notice ?? '';
  els.toggle.hidden = state.screen !== 'frozen';
  els.back.hidden = state.screen !== 'live' && state.screen !== 'frozen';
  els.toggle.setAttribute('aria-label', state.pinyinVisible ? 'Hide pinyin' : 'Show pinyin');
  els.toggle.toggleAttribute('data-off', !state.pinyinVisible);
  renderCard(els, state.card, state.dict);
  if (state.about && !els.about.open) els.about.showModal();
  else if (!state.about && els.about.open) els.about.close();
}

// The word card (spec §7.4): the tapped word straight away, its dictionary entries when they arrive.
function renderCard(els, card, dict) {
  els.card.hidden = !card;
  if (!card) return;
  els.cardWord.textContent = card.word;
  els.cardReading.textContent = card.reading;
  els.cardStatus.textContent = card.error
    ? `Dictionary unavailable (${card.error})`
    : !card.entries
      ? dict === 'ready'
        ? ''
        : 'Dictionary loading…'
      : card.entries.length
        ? ''
        : 'Not in the dictionary.';
  // An entry's pinyin is shown only when it isn't the reading above (e.g. 行 read xíng, not háng).
  const plain = (pinyin) => pinyin.toLowerCase().replace(/\s+/g, '');
  els.cardEntries.replaceChildren(
    ...(card.entries ?? []).map(({ pinyin, glosses }) => {
      const item = document.createElement('li');
      if (plain(pinyin) !== plain(card.reading)) {
        const reading = document.createElement('span');
        reading.className = 'pinyin';
        reading.textContent = pinyin;
        item.append(reading);
      }
      item.append(glosses.join(' / '));
      return item;
    }),
  );
}

// The debug panel (spec §8; ?debug, or the About sheet's button): what to screenshot when
// something misbehaves on a phone.
export function renderDebug(element, toggle, debug) {
  toggle.textContent = debug.enabled ? 'Hide debug info' : 'Show debug info';
  element.hidden = !debug.enabled;
  if (!debug.enabled) return;
  const ms = (value) => (value == null ? '–' : `${Math.round(value)} ms`);
  const t = debug.timings ?? {};
  const region = debug.region ? `${debug.region.width}×${debug.region.height}` : '–';
  element.textContent = [
    `assets ${debug.version || '–'} · models ${debug.models || '–'}`,
    `engine start ${ms(debug.initMs)}`,
    `last scan ${region}: ${ms(t.total)} (det ${ms(t.det)}, rec ${ms(t.rec)}, post ${ms(t.post)})`,
    `last error ${debug.error || '–'}`,
    navigator.userAgent,
  ].join('\n');
}
