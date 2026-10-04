import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

// Menu photos served outside the app for ?img= runs: the KKM menu, and one with tightly spaced lines.
export const MENU = '/e2e/menu-kkm.png';
export const CROWDED_MENU = '/e2e/menu-chicken-ribs-black.png';
const photos = new Map(
  [MENU, CROWDED_MENU].map((path) => [path, readFileSync(new URL(`../fixtures/${path.split('/').pop()}`, import.meta.url))]),
);

// context.route (not page.route) also sees requests that pass through the service worker.
export const serveMenu = (context) =>
  context.route(
    (url) => photos.has(url.pathname),
    (route) => route.fulfill({ body: photos.get(new URL(route.request().url()).pathname), contentType: 'image/png' }),
  );

export const body = (page) => page.locator('body');
export const lastScan = (page) => page.evaluate(() => window.__pinyinlens.lastScan);

export async function startWhenReady(page, path) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
}

export async function freeze(page) {
  await page.getByRole('button', { name: 'Freeze and scan' }).click();
  await expect(body(page)).toHaveAttribute('data-state', 'frozen', { timeout: 30_000 });
}

// Number of painted pixels on the pinyin overlay canvas.
export const overlayInk = (page) =>
  page.evaluate(() => {
    const canvas = document.getElementById('overlay');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
    return painted;
  });

// Simulates the app going to the background and coming back.
export const backgroundAndReturn = (page) =>
  page.evaluate(() => {
    for (const visibility of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });

// Taps the centre of character `index` of the first Chinese token reading `text` in the last scan,
// mapping its quad through the frozen snapshot's on-screen box.
export async function tapChar(page, text, index) {
  const scan = await lastScan(page);
  const token = scan.lines.flatMap((l) => l.tokens).find((t) => t.text === text);
  if (!token) throw new Error(`no token reads ${text}`);
  const [q0, , q2] = token.chars[index].quad;
  const box = await page.locator('#snapshot').boundingBox();
  const scale = box.width / scan.region.width;
  await page.mouse.click(box.x + ((q0[0] + q2[0]) / 2) * scale, box.y + ((q0[1] + q2[1]) / 2) * scale);
}
