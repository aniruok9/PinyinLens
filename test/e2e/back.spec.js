import { expect, test } from '@playwright/test';
import { MENU, body, freeze, overlayInk, serveMenu, startWhenReady, tapChar } from './helpers.js';

test.beforeEach(({ context }) => serveMenu(context));

const back = (page) => page.getByRole('button', { name: 'Back to start' });
const start = (page) => page.getByRole('button', { name: 'Start camera' });
// Every camera track the page has been given, live or not, as readyStates.
const allTracks = (page) => page.evaluate(() => window.streams.flatMap((s) => s.getTracks()).map((t) => t.readyState));

// Records every stream getUserMedia hands out; with `slowReopen`, reopens take half a second.
const recordStreams = (page, { slowReopen = false } = {}) =>
  page.addInitScript((slow) => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.streams = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      window.streams.push(stream);
      if (slow && window.streams.length > 1) await new Promise((resolve) => setTimeout(resolve, 500));
      return stream;
    };
  }, slowReopen);

test('Back to start turns the camera off and shows the title; Start turns it back on', async ({ page }) => {
  await recordStreams(page);
  await startWhenReady(page, './');
  await expect(back(page)).toBeVisible();
  await back(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'intro');
  await expect(start(page)).toBeVisible();
  await expect(back(page)).toBeHidden();
  expect(await allTracks(page)).toEqual(['ended']);
  expect(await page.evaluate(() => document.getElementById('live').srcObject)).toBeNull();

  await start(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  expect(await allTracks(page)).toEqual(['ended', 'live']);
  await freeze(page); // the reopened camera scans
});

test('Back from a frozen scan drops the scan, its pinyin and the word card', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await freeze(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#word-card')).toBeVisible();
  await back(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'intro');
  await expect(page.locator('#word-card')).toBeHidden();
  await expect(page.locator('#snapshot')).toBeHidden();
  await expect.poll(() => overlayInk(page)).toBe(0);

  await start(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  await freeze(page);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
});

test('a camera reopen still under way when Back is pressed is closed when it lands', async ({ page }) => {
  await recordStreams(page, { slowReopen: true });
  await startWhenReady(page, './');
  await page.evaluate(() => {
    const [track] = document.getElementById('live').srcObject.getVideoTracks();
    track.stop();
    track.dispatchEvent(new Event('ended')); // the OS took the camera: the app reopens it
  });
  await back(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'intro');
  await expect.poll(() => allTracks(page)).toEqual(['ended', 'ended']); // the reopen landed, and was closed
  expect(await page.evaluate(() => document.getElementById('live').srcObject)).toBeNull();

  await start(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  expect(await allTracks(page)).toEqual(['ended', 'ended', 'live']);
});

// Like iOS Safari, never start playing a hidden <video> (the promise stays pending).
const noHiddenPlay = (page) =>
  page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function playIfVisible() {
      return this.hidden ? new Promise(() => {}) : play.call(this);
    };
  });

test('on a browser that will not play hidden video, Back during a camera reopen still turns it off', async ({ page }) => {
  await recordStreams(page, { slowReopen: true });
  await noHiddenPlay(page);
  await startWhenReady(page, './');
  await page.evaluate(() => {
    const [track] = document.getElementById('live').srcObject.getVideoTracks();
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await back(page).click();
  await expect.poll(() => allTracks(page)).toEqual(['ended', 'ended']);
  await start(page).click();
  await expect(body(page)).toHaveAttribute('data-state', 'live');
});

test('a camera that will not play is turned off behind the error card', async ({ page }) => {
  await recordStreams(page);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Playback refused', 'NotAllowedError'));
  });
  await page.goto('./');
  await start(page).click();
  await expect(page.getByRole('heading', { name: 'Camera unavailable' })).toBeVisible();
  expect(await allTracks(page)).toEqual(['ended']);
});

test('tapping Start twice opens the camera once, so Back turns it off', async ({ page }) => {
  await recordStreams(page);
  await page.goto('./');
  await page.evaluate(() => {
    const button = document.getElementById('start');
    button.click();
    button.click();
  });
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  expect(await allTracks(page)).toEqual(['live']);
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
  await back(page).click();
  expect(await allTracks(page)).toEqual(['ended']);
});
