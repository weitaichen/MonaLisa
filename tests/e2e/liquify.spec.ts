// 推臉筆 (push-brush spec §8.3) against the production build: one finger pushes, 恢復 restores, ↶ ↷, persistence,
// two-finger gestures, the 美型 entry and 全部清除, photos without a face or with a person, and the export rules.
// Distances are measured on element screenshots (CSS px × dpr 3) of synthetic photos (fixtures.ts linePng, emptyPng).
import type { Page } from '@playwright/test';
import { brushDrag, expect, LINE, linePng, liquifyState, mad, settled, test, type Pixels } from './fixtures';

const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });

async function openPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Select 推臉筆 in a tab and wait until the hint pill has gone (it floats over the frame). The pill mounts in an effect
 * after the brush bar, so it is first awaited: a count of 0 right after the bar shows can be the pill not there yet.
 */
async function enterBrush(page: Page, tab: '美型' | '美體'): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
}

/** The column (grab px) with the lowest mean luma over rows y0…y1, searched within columns x0…x1. */
function darkestColumn(p: Pixels, [y0, y1]: [number, number], [x0, x1]: [number, number]): number {
  let best = x0;
  let bestV = Infinity;
  for (let x = Math.max(0, x0); x <= Math.min(p.width - 1, x1); x++) {
    let s = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * p.width + x) * 4;
      s += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    }
    if (s < bestV) {
      bestV = s;
      best = x;
    }
  }
  return best;
}

/** Client point of a photo pixel (identity geometry, zoom 1), and grab px per CSS px. */
async function photoToClient(page: Page, size: { width: number; height: number }) {
  const box = (await page.locator('.editor-stage .frame').boundingBox())!;
  return {
    box,
    at: (px: number, py: number) => ({ x: box.x + (px / size.width) * box.width, y: box.y + (py / size.height) * box.height }),
  };
}

const strokes = async (page: Page) => (await liquifyState(page))?.strokes ?? -1;

test('美體 › 推臉筆: one finger moves the line under the brush, nothing far away; one stroke is one ↶ step', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const frame = page.locator('.editor-stage .frame');
  await enterBrush(page, '美體');
  await expect.poll(() => strokes(page)).toBe(0);
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, LINE);
  const k = before.width / box.width;
  const yPhoto = 450;
  const start = at(LINE.x, yPhoto);
  await brushDrag(page, start, { x: start.x + 24, y: start.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const row = Math.round((yPhoto / LINE.height) * before.height);
  const band: [number, number] = [row - 6, row + 6];
  const x0 = darkestColumn(before, band, [0, before.width - 1]);
  const x1 = darkestColumn(after, band, [x0 - Math.round(4 * k), x0 + Math.round(40 * k)]);
  const ratio = (x1 - x0) / (24 * k);
  console.log(`推臉筆: the line moved ${((x1 - x0) / k).toFixed(1)} CSS px for a 24 px drag (${ratio.toFixed(2)}×)`);
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  expect(ratio).toBeLessThanOrEqual(0.85);
  // more than two brush radii away (bottom-left corner) nothing changed
  const far = { x: 0, y: Math.round(before.height * 0.8), w: Math.round(before.width * 0.3), h: Math.round(before.height * 0.2) - 1 };
  expect(mad(before, after, far)).toBeLessThan(0.5);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  expect(mad(before, await settled(frame))).toBeLessThanOrEqual(0.5);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  expect(mad(after, await settled(frame))).toBeLessThanOrEqual(0.5);
});

test('美體 › 推臉筆: a strip item tapped while a finger draws commits the stroke first, and its edit keeps the stroke', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  await expect.poll(() => strokes(page)).toBe(0);
  const clear = page.getByRole('button', { name: '全部清除' });
  await expect(clear).toBeDisabled();
  const { at } = await photoToClient(page, LINE);
  const start = at(LINE.x, 450);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + 3 * i, start.y);
  // a second finger on 背景保護 while the first one draws (a DOM click: the mouse button is still down on the photo).
  // The item's edit was computed from the state without the live stroke
  await option(page, '背景保護').evaluate((el: HTMLElement) => el.click());
  await page.mouse.move(start.x + 40, start.y); // the stroke was committed: the rest of the drag draws nothing
  await page.mouse.up();
  await expect(clear).toBeEnabled();
  await expect.poll(() => strokes(page)).toBe(1);
  // two undo steps: the 背景保護 toggle (the stroke stays), then the stroke
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
});
