import { expect, test } from '@playwright/test';
import { labelBox } from '../../src/app/overlay.js';
import { CROWDED_MENU, MENU, body, freeze, lastScan, overlayInk, serveMenu, startWhenReady } from './helpers.js';

test.beforeEach(({ context }) => serveMenu(context));

test('scans a still image and draws pinyin under the dishes', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}&debug`);
  await expect(page.locator('#debug')).toContainText('models v6-tiny + v6-tiny');
  await freeze(page);

  const scan = await lastScan(page);
  const token = scan.lines.flatMap((l) => l.tokens).find((t) => t.text === '阿公可口面');
  expect(token.chars.map((c) => c.pinyin)).toEqual(['ā', 'gōng', 'kě', 'kǒu', 'miàn']);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);

  await page.getByRole('button', { name: 'Back to camera' }).click();
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  await expect.poll(() => overlayInk(page)).toBe(0);
});

test('on a crowded menu, labels move, shrink or are outlined instead of covering other lines', async ({ page }) => {
  await startWhenReady(page, `./?img=${CROWDED_MENU}`);
  await freeze(page);
  const { placements } = await lastScan(page);
  expect(placements.some((p) => p.halo)).toBe(true);
  expect(placements.some((p) => !p.halo && (p.side === 'before' || p.scale < 1))).toBe(true);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
  // What was drawn follows the placements, and no label strip lies off the photo.
  const drawn = await page.evaluate(() => window.__pinyinlens.labels);
  expect(drawn.some((label) => label.halo)).toBe(true);
  const photo = await page.locator('#snapshot').boundingBox();
  const offPhoto = drawn
    .filter((label) => !label.halo)
    .map(labelBox)
    .filter((b) => b.x0 < photo.x - 0.5 || b.y0 < photo.y - 0.5 || b.x1 > photo.x + photo.width + 0.5 || b.y1 > photo.y + photo.height + 0.5);
  expect(offPhoto).toEqual([]);
});

test('zooming in scans only the visible region', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  const { width, height } = page.viewportSize();
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.wheel(0, -400); // about 3.8x
  await freeze(page);
  const { region } = await lastScan(page);
  expect(region.width).toBeLessThan(1479 / 3);
  expect(region.height).toBeLessThan(883 / 3);
});

test('scans the live camera, and says so when there is no Chinese', async ({ page }) => {
  await startWhenReady(page, './');
  await freeze(page);
  await expect(page.locator('#notice')).toHaveText('No Chinese text found. Try moving closer.');
});

test('loads without reloading and keeps working offline', async ({ page, context }) => {
  const navigations = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await startWhenReady(page, './');
  expect(navigations).toHaveLength(1);
  await page.evaluate(() => navigator.serviceWorker.ready);

  await context.setOffline(true);
  await page.reload();
  // Repeat visit: no intro, camera starts by itself, models come from the cache.
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
  await expect(body(page)).toHaveAttribute('data-state', 'live');
  await freeze(page);
});

test('recovers from a corrupted cached model', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith('pinyinlens-assets-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (request.url.endsWith('.onnx')) await cache.put(request, new Response('garbage'));
      }
    }
  });

  const downloads = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.onnx')) downloads.push(request.url());
  });
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
  expect(downloads.length).toBeGreaterThanOrEqual(2);
  await freeze(page);
  expect((await lastScan(page)).lines.length).toBeGreaterThan(5);
});
