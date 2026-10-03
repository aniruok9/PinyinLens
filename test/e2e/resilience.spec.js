import { expect, test } from '@playwright/test';
import { MENU, backgroundAndReturn, body, freeze, overlayInk, serveMenu, startWhenReady } from './helpers.js';

// Failure paths and lifecycle events a phone user will meet (plan "Review Focus").

test.beforeEach(({ context }) => serveMenu(context));

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
  const liveTracks = () =>
    page.evaluate(() => document.getElementById('live').srcObject.getVideoTracks().map((t) => t.readyState));
  await page.evaluate(() => document.getElementById('live').srcObject.getTracks().forEach((t) => t.stop()));
  expect(await liveTracks()).toEqual(['ended']);
  await backgroundAndReturn(page);
  await expect.poll(liveTracks).toEqual(['live']);
  await freeze(page);
});
