import { test as bare, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { debugState, decodeDataUrl, dragSlider, expect, grab, hold, importFixture, mad, SAMPLE_FACE, settled, shot, test, type Pixels } from './fixtures';

/** A face-free photo: a soft grey gradient. */
function noFacePng(width = 600, height = 800): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = 90 + Math.round((70 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 6;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test('import → editor: face detected, slider, undo/redo, hold-to-compare, save, history', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);

  const save = page.getByRole('button', { name: '儲存' });
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  expect((await debugState(page)).face).toBe(true);
  await expect(page.getByText('未偵測到臉部')).toHaveCount(0);
  const undo = page.getByRole('button', { name: '復原' });
  const redo = page.getByRole('button', { name: '重做' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const frame = page.locator('.editor-stage .frame');
  const e0 = await settled(frame);
  await shot(page, '10-editor-import');

  // slider: 美白 to 100 visibly changes the photo
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  const e1 = await settled(frame);
  await shot(page, '11-editor-whiten-100');
  const edit = mad(e0, e1);
  expect(edit).toBeGreaterThan(2);

  // undo → back to the import look; redo → the edit again
  await expect(undo).toBeEnabled();
  await undo.click();
  const e2 = await settled(frame);
  expect(mad(e0, e2)).toBeLessThan(0.5);
  await expect(page.getByRole('slider')).not.toHaveAttribute('aria-valuenow', '100');
  await expect(redo).toBeEnabled();
  await redo.click();
  const e3 = await settled(frame);
  expect(mad(e1, e3)).toBeLessThan(0.5);
  await expect(redo).toBeDisabled();

  // hold-to-compare shows the original, labelled 原圖; release restores the edit
  const release = await hold(page, page.getByRole('button', { name: '按住對比' }));
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();
  const held = await settled(frame);
  await shot(page, '12-editor-compare-held');
  await release();
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toHaveCount(0);
  const e4 = await settled(frame);
  expect(mad(e3, e4)).toBeLessThan(0.5);
  expect(mad(held, e3)).toBeGreaterThan(2);

  // keyboard / VoiceOver activation (a click with no pointer events) toggles compare; leaving the button ends it
  const compareBtn = page.getByRole('button', { name: '按住對比' });
  const origLabel = page.locator('.corner-label', { hasText: '原圖' });
  await compareBtn.focus();
  await page.keyboard.press('Space');
  await expect(origLabel).toBeVisible();
  await expect(compareBtn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(origLabel).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(origLabel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(origLabel).toHaveCount(0);
  await expect(compareBtn).toHaveAttribute('aria-pressed', 'false');
  await settled(frame);

  // the compare view really is the unprocessed photo: it matches the 原圖 preset render
  await page.getByRole('tab', { name: '一鍵' }).click();
  await page.getByRole('option', { name: '原圖', exact: true }).click();
  const orig = await settled(frame);
  // middle band only: the 原圖 label (top-left) and the held button (bottom) differ by design
  const band = { x: 0, y: Math.round(held.height * 0.15), w: held.width, h: Math.round(held.height * 0.65) };
  const cmp = mad(held, orig, band);
  console.log(`editor: edit ${edit.toFixed(2)}, compare-vs-原圖 ${cmp.toFixed(3)} (0..255, overlay-free band)`);
  expect(cmp).toBeLessThan(0.5);
  await undo.click(); // back to the whitened edit
  await settled(frame);

  // 儲存: Chromium has no file share sheet → long-press fallback with the full-resolution JPEG
  await save.click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  await expect(fallback.getByText('長按圖片 → 儲存到照片')).toBeVisible();
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1000);
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(1500);
  await shot(page, '13-editor-save-fallback');
  await fallback.getByRole('button', { name: '關閉' }).click();

  // autosaved to 最近編輯
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await shot(page, '14-home-history');

  // reopening the entry restores its params (the whitened edit)
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');

  // an edit followed by ✕ inside the 400 ms autosave debounce is still saved (flushed on close)
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '98');
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1);
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '98');
});

test('no face in the photo: 美型 / 美妝 are dimmed with a note and no slider; 美膚 stays available', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'no_face.png', mimeType: 'image/png', buffer: noFacePng() });

  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  expect((await debugState(page)).face).toBe(false);
  // a healthy tracker that found nothing: the definite "no face" answer (toast + panel note)
  await expect(page.getByText('未偵測到臉部，僅套用美膚與濾鏡')).toBeVisible();

  const note = page.getByRole('note');
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await tab('美型').click();
  await expect(note).toHaveText('未偵測到臉部，臉型與美妝不會套用');
  const options = page.getByRole('option');
  expect(await options.count()).toBeGreaterThan(0);
  for (const o of await options.all()) await expect(o).toHaveAttribute('aria-disabled', 'true');
  await expect(tab('美型')).toHaveClass(/\bunavailable\b/);
  await expect(tab('美妝')).toHaveClass(/\bunavailable\b/);
  await expect(tab('美膚')).not.toHaveClass(/\bunavailable\b/);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await shot(page, '15-editor-no-face-shape');

  await tab('美膚').click();
  await expect(note).toHaveCount(0);
  for (const o of await options.all()) await expect(o).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('slider')).toHaveCount(1);
});

/** the 儲存 fallback's JPEG, decoded at a quarter of its size (enough to tell a look apart) */
async function savedPhoto(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = Math.round(i.naturalWidth / 4);
    c.height = Math.round(i.naturalHeight / 4);
    c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
  await fallback.getByRole('button', { name: '關閉' }).click();
  await expect(fallback).toHaveCount(0);
  return decodeDataUrl(url);
}

// the failed LUT request prints the browser's own "Failed to load resource" line: no shared console guard here, and
// no service worker in between, so page.route sees the LUT request
bare.describe('a 質感 whose LUT failed', () => {
  bare.use({ serviceWorkers: 'block' });

  bare('re-tapping it once it can load redraws the preview and 儲存 exports it (step-2 spec §2.4, §7)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const FILM = /\/luts\/looks\/look_film\.png$/;
    await page.route(FILM, (r) => r.abort());
    await importFixture(page, SAMPLE_FACE);
    const frame: Locator = page.locator('.editor-stage .frame');
    await settled(frame);

    await page.getByRole('tab', { name: '一鍵' }).click();
    await page.getByRole('button', { name: '質感', exact: true }).click();
    const film = page.getByRole('option', { name: '膠片', exact: true });
    await film.click();
    const notice = page.locator('.toast', { hasText: '無法載入「膠片」質感，請稍後再試' });
    await expect(notice).toBeVisible();
    await expect(film).toHaveAttribute('aria-selected', 'true');
    // (the toast sits over the stage: the frames are compared without it)
    await expect(notice).toHaveCount(0, { timeout: 10_000 });
    const without = await settled(frame);
    // the share cache (and autosave) for this edit, made without the look
    const savedWithout = await savedPhoto(page);
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
    expect(mad(without, await settled(frame)), 'nothing redraws the failed look by itself').toBeLessThan(0.5);

    // back online: the re-tap retries the load; the preview and the next 儲存 carry the look
    await page.unroute(FILM);
    const loaded = page.waitForResponse(FILM);
    await film.click();
    expect((await loaded).ok()).toBe(true);
    let preview = 0;
    for (let i = 0; i < 20 && preview <= 1; i++) {
      await page.waitForTimeout(250);
      preview = mad(without, await grab(frame));
    }
    const withLook = await settled(frame);
    preview = mad(without, withLook);
    const savedWith = await savedPhoto(page);
    const saved = mad(savedWithout, savedWith);
    console.log(`look retry: preview mad ${preview.toFixed(2)}, saved photo mad ${saved.toFixed(2)} (0..255)`);
    expect(preview, 'the preview redrew with the look').toBeGreaterThan(1);
    expect(saved, '儲存 re-encoded with the look instead of handing over the look-less file').toBeGreaterThan(1);
    expect(pageErrors).toEqual([]);
  });
});
