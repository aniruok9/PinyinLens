import { expect, test } from '@playwright/test';
import { MENU, body, freeze, overlayInk, serveMenu, startWhenReady, tapChar } from './helpers.js';

test.beforeEach(({ context }) => serveMenu(context));

const card = (page) => page.locator('#word-card');

async function scanMenu(page) {
  await startWhenReady(page, `./?img=${MENU}`);
  await freeze(page);
}

test('tapping a character shows its word, reading and meaning', async ({ page }) => {
  await scanMenu(page);
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await tapChar(page, '阿公可口面', 3);
  await expect(card(page)).toBeVisible();
  await expect(page.locator('#card-word')).toHaveText('可口');
  await expect(page.locator('#card-reading')).toHaveText('kě kǒu');
  await expect(page.locator('#card-entries')).toContainText('tasty');
  await expect(page.locator('#card-entries .pinyin')).toHaveCount(0); // same reading as above: not repeated
});

test('tapping away from the text, or the close button, closes the card', async ({ page }) => {
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 0);
  await expect(card(page)).toBeVisible();
  const box = await page.locator('#snapshot').boundingBox();
  await page.mouse.click(box.x + 4, box.y + 4); // corner of the photo: no text there
  await expect(card(page)).toBeHidden();

  await tapChar(page, '阿公可口面', 0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toBeHidden();
});

test('says the dictionary is loading until it arrives', async ({ page, context }) => {
  let release;
  const arrived = new Promise((resolve) => (release = resolve));
  await context.route(
    (url) => url.pathname.endsWith('/cedict.tsv'),
    async (route) => {
      await arrived;
      await route.continue();
    },
  );
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-status')).toHaveText('Dictionary loading…');
  release();
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
});

test('the eye button hides and shows the pinyin', async ({ page }) => {
  await scanMenu(page);
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Hide pinyin' }).click();
  await expect.poll(() => overlayInk(page)).toBe(0);
  await page.getByRole('button', { name: 'Show pinyin' }).click();
  await expect.poll(() => overlayInk(page)).toBeGreaterThan(1000);
});

test('About credits the dictionary and can show debug info', async ({ page }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await page.getByRole('button', { name: 'About PinyinLens' }).click();
  const about = page.getByRole('dialog', { name: 'About PinyinLens' });
  await expect(about).toContainText('CC-CEDICT');
  await expect(about.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
    'href',
    'https://creativecommons.org/licenses/by-sa/4.0/',
  );
  await about.getByRole('button', { name: 'Show debug info' }).click();
  await expect(page.locator('#debug')).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
});

test('meanings work offline on a repeat visit', async ({ page, context }) => {
  await startWhenReady(page, `./?img=${MENU}`);
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(body(page)).toHaveAttribute('data-engine', 'ready', { timeout: 60_000 });
  await freeze(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
});

test('swiping the card down closes it', async ({ page }) => {
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 0);
  const head = await page.locator('#card-word').boundingBox();
  await page.mouse.move(head.x + 4, head.y + 4);
  await page.mouse.down();
  await page.mouse.move(head.x + 4, head.y + 84, { steps: 5 });
  await page.mouse.up();
  await expect(card(page)).toBeHidden();
});

test('a card closed while the dictionary loads stays closed when it arrives', async ({ page, context }) => {
  let release;
  const arrived = new Promise((resolve) => (release = resolve));
  await context.route(
    (url) => url.pathname.endsWith('/cedict.tsv'),
    async (route) => {
      await arrived;
      await route.continue();
    },
  );
  await scanMenu(page);
  await tapChar(page, '阿公可口面', 3);
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  release();
  await expect(body(page)).toHaveAttribute('data-dict', 'ready', { timeout: 30_000 });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200))); // let any late reply land
  await expect(card(page)).toBeHidden();
});

test('a dictionary that failed to load says so, and the next tap tries again', async ({ page, context }) => {
  const dictRoute = (url) => url.pathname.endsWith('/cedict.tsv');
  await context.route(dictRoute, (route) => route.abort());
  await scanMenu(page);
  await expect(body(page)).toHaveAttribute('data-dict', 'failed', { timeout: 30_000 });
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-status')).toContainText('Dictionary unavailable', { timeout: 30_000 });
  await context.unroute(dictRoute);
  await tapChar(page, '阿公可口面', 3);
  await expect(page.locator('#card-entries')).toContainText('tasty', { timeout: 30_000 });
  await expect(body(page)).toHaveAttribute('data-dict', 'ready');
});
