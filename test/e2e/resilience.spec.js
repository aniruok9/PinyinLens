import { expect, test } from '@playwright/test';
import { MENU, backgroundAndReturn, body, freeze, overlayInk, serveMenu, startWhenReady } from './helpers.js';

// Failure paths and lifecycle events a phone user will meet (plan "Review Focus").

test.beforeEach(({ context }) => serveMenu(context));

const liveTracks = (page) => () =>
  page.evaluate(() => document.getElementById('live').srcObject.getVideoTracks().map((t) => t.readyState));

test('explains how to allow the camera when access is denied', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Start camera' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Camera unavailable');
  await expect(alert).toContainText('Settings › Safari › Camera');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset app data' })).toBeHidden();
});

test('shows a retryable error when the models cannot be downloaded', async ({ page, context }) => {
  const models = (url) => url.pathname.endsWith('.onnx');
  await context.route(models, (route) => route.abort());
  await page.goto(`./?img=${MENU}`);
  await expect(page.getByRole('alert')).toContainText("Couldn't load the reading engine", { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Reset app data' })).toBeVisible();

  await context.unroute(models);
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
});

test('keeps the frozen scan and its pinyin when the screen rotates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startWhenReady(page, `./?img=${MENU}`);
  await freeze(page);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(500);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(body(page)).toHaveAttribute('data-state', 'frozen');
  // Re-fitted to the landscape screen: the snapshot exactly fills its height.
  await expect.poll(async () => (await page.locator('#snapshot').boundingBox()).height).toBeCloseTo(390, 0);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(500);

  // And back to portrait: re-fitted again, the whole width on screen, not stuck zoomed in.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.locator('#snapshot').boundingBox()).width).toBeCloseTo(390, 0);
  await expect.poll(async () => (await page.locator('#snapshot').boundingBox()).x).toBeCloseTo(0, 0);
});

test('re-lays out the live camera when the video frame changes shape on rotation', async ({ page }) => {
  await startWhenReady(page, './');
  await page.evaluate(() => {
    const video = document.getElementById('live');
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 480 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 640 });
    video.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#live')).toHaveCSS('width', '480px');
});

test('ignores extra shutter taps while a scan is running', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await page.evaluate(() => {
    const shutter = document.getElementById('shutter');
    shutter.click();
    shutter.click();
    shutter.click();
  });
  await expect(body(page)).toHaveAttribute('data-state', 'frozen', { timeout: 30_000 });
  await expect(page.locator('#notice')).toBeHidden();
});

test('keeps a frozen scan when the app returns from the background', async ({ page }) => {
  await startWhenReady(page, './');
  await freeze(page);
  await backgroundAndReturn(page);
  await expect(body(page)).toHaveAttribute('data-state', 'frozen');
});

test('reopens the camera when the system ended it in the background', async ({ page }) => {
  await startWhenReady(page, './');
  await page.evaluate(() => document.getElementById('live').srcObject.getTracks().forEach((t) => t.stop()));
  expect(await liveTracks(page)()).toEqual(['ended']);
  await backgroundAndReturn(page);
  await expect.poll(liveTracks(page)).toEqual(['live']);
  await freeze(page);
});

test('a tap while a reopened camera has no frame yet still freezes and scans', async ({ page }) => {
  await startWhenReady(page, './');
  await page.evaluate(async () => {
    const video = document.getElementById('live');
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true }); // like a reopen: no frame yet
    document.getElementById('shutter').click();
  });
  await expect(body(page)).toHaveAttribute('data-state', 'frozen', { timeout: 30_000 });
});

test('reopens the camera when its track ends while the app is open', async ({ page }) => {
  await startWhenReady(page, './');
  await page.evaluate(() => {
    const [track] = document.getElementById('live').srcObject.getVideoTracks();
    track.stop();
    track.dispatchEvent(new Event('ended')); // what the OS does when another app takes the camera
  });
  await expect.poll(liveTracks(page)).toEqual(['live']);
});

test('opens the camera only once when it returns from the background twice quickly', async ({ page }) => {
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.cameraOpens = 0;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      window.cameraOpens++;
      return getUserMedia(constraints);
    };
  });
  await startWhenReady(page, './');
  await page.evaluate(() => document.getElementById('live').srcObject.getTracks().forEach((t) => t.stop()));
  await backgroundAndReturn(page);
  await backgroundAndReturn(page);
  await expect.poll(liveTracks(page)).toEqual(['live']);
  expect(await page.evaluate(() => window.cameraOpens)).toBe(2); // the first start plus one reopen
});

test('makes the camera video visible before playing it (iOS does not play hidden video)', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    window.hiddenPlays = 0;
    HTMLMediaElement.prototype.play = function playVisible() {
      if (this.hidden) window.hiddenPlays++;
      return play.call(this);
    };
  });
  await startWhenReady(page, './');
  expect(await page.evaluate(() => window.hiddenPlays)).toBe(0);
});
