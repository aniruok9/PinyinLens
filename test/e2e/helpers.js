import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

// The KKM menu photo, served outside the app for ?img= runs.
export const MENU = '/e2e/menu-kkm.png';
const menuBytes = readFileSync(new URL('../fixtures/menu-kkm.png', import.meta.url));

// context.route (not page.route) also sees requests that pass through the service worker.
export const serveMenu = (context) =>
  context.route(
    (url) => url.pathname === MENU,
    (route) => route.fulfill({ body: menuBytes, contentType: 'image/png' }),
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
