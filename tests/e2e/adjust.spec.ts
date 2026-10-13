// 調節 and 質感 end to end (v0.4 step-2 spec §8.3): every 調節 item moves the right statistic in the editor; ⊘, ↶ and
// the dots; the colour tracks and the lead chip; 一鍵 › 質感 in the strip, in the export and after a reopen; the camera's
// 調節 tab, 暗角, CCD, moving grain, the hand-over to 編輯 and the persisted camera look.
import type { Locator, Page } from '@playwright/test';
import { debugState, decodeDataUrl, dragSlider, expect, grab, mad, meanLuma, SAMPLE_FACE, settled, shot, test, type Pixels } from './fixtures';

const luma = (p: Pixels, i: number) => 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
function sortedLumas(p: Pixels): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.data.length; i += 4) out.push(luma(p, i));
  return out.sort((a, b) => a - b);
}
function channelMeans(p: Pixels): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    r += p.data[i];
    g += p.data[i + 1];
    b += p.data[i + 2];
  }
  const n = p.data.length / 4;
  return [r / n, g / n, b / n];
}
const stats = {
  luma: (p: Pixels) => meanLuma(p),
  /** 90th − 10th percentile luma */
  spread(p: Pixels) {
    const l = sortedLumas(p);
    return l[Math.floor(l.length * 0.9)] - l[Math.floor(l.length * 0.1)];
  },
  /** 2nd percentile luma: the black level */
  black: (p: Pixels) => sortedLumas(p)[Math.floor((p.data.length / 4) * 0.02)],
  rb(p: Pixels) {
    const [r, , b] = channelMeans(p);
    return r / b;
  },
  gOverRb(p: Pixels) {
    const [r, g, b] = channelMeans(p);
    return g / (r + b);
  },
  /** mean max − min channel */
  chroma(p: Pixels) {
    let s = 0;
    for (let i = 0; i < p.data.length; i += 4) s += Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) - Math.min(p.data[i], p.data[i + 1], p.data[i + 2]);
    return s / (p.data.length / 4);
  },
  /** the two top corner patches (8 % of the width) over the centre patch; the bottom holds the editor's float buttons */
  vignette(p: Pixels) {
    const s = Math.round(p.width * 0.08);
    const at = (x: number, y: number) => meanLuma(p, { x, y, w: s, h: s });
    return (at(0, 0) + at(p.width - s, 0)) / 2 / Math.max(1, at(Math.round((p.width - s) / 2), Math.round((p.height - s) / 2)));
  },
  /** mean |L(x+1, y) − L(x, y)|: high-frequency energy */
  hf(p: Pixels) {
    let s = 0;
    let n = 0;
    for (let y = 0; y < p.height; y += 2)
      for (let x = 0; x < p.width - 1; x++) {
        const i = (y * p.width + x) * 4;
        s += Math.abs(luma(p, i + 4) - luma(p, i));
        n++;
      }
    return s / n;
  },
};
/** mean luma, before and after, of the pixels that were the brightest (q > 0) or darkest (q < 0) |q| of `before` */
function tail(before: Pixels, after: Pixels, q: number): { before: number; after: number } {
  const idx = Array.from({ length: before.data.length / 4 }, (_, k) => k).sort((a, b) => luma(before, a * 4) - luma(before, b * 4));
  const n = Math.max(1, Math.floor(idx.length * Math.abs(q)));
  const pick = q > 0 ? idx.slice(idx.length - n) : idx.slice(0, n);
  let a = 0;
  let b = 0;
  for (const k of pick) {
    a += luma(before, k * 4);
    b += luma(after, k * 4);
  }
  return { before: a / n, after: b / n };
}

async function importPhoto(page: Page): Promise<Locator> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  return page.locator('.editor-stage .frame');
}

/** 儲存 → the long-press fallback image (Chromium has no file share sheet), decoded */
async function exportPixels(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dlg = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  const img = dlg.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await dlg.getByRole('button', { name: '關閉' }).click();
  return decodeDataUrl(url);
}

const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test('editor: every 調節 item, ⊘ / ↶ / dots, 質感 in the strip and the export, everything back after a reopen', async ({ page }) => {
  test.setTimeout(300_000);
  const frame = await importPhoto(page);
  const undo = page.getByRole('button', { name: '復原' });
  const slider = page.getByRole('slider');

  await tab(page, '調節').click();
  await expect(tab(page, '調節')).toHaveAttribute('aria-selected', 'true');
  for (const label of ['原圖', '亮度', '曝光', '對比', '高光', '陰影', '色溫', '色調', '飽和', '鮮艷度', '褪色', '顆粒', '暗角'])
    await expect(option(page, label)).toBeVisible();
  const e0 = await settled(frame);

  // [label, one-way?, check(before, after)]
  const cases: [string, boolean, (a: Pixels, b: Pixels) => void][] = [
    ['亮度', false, (a, b) => expect(stats.luma(b)).toBeGreaterThan(stats.luma(a) + 5)],
    ['曝光', false, (a, b) => expect(stats.luma(b)).toBeGreaterThan(stats.luma(a) + 5)],
    ['對比', false, (a, b) => expect(stats.spread(b)).toBeGreaterThan(stats.spread(a) + 3)],
    ['高光', false, (a, b) => {
      const t = tail(a, b, 0.1);
      expect(t.after).toBeGreaterThan(t.before + 2);
    }],
    ['陰影', false, (a, b) => {
      const t = tail(a, b, -0.5);
      expect(t.after).toBeGreaterThan(t.before + 2);
    }],
    ['色溫', false, (a, b) => expect(stats.rb(b)).toBeGreaterThan(stats.rb(a) * 1.03)],
    ['色調', false, (a, b) => expect(stats.gOverRb(b)).toBeLessThan(stats.gOverRb(a) * 0.98)],
    ['飽和', false, (a, b) => expect(stats.chroma(b)).toBeGreaterThan(stats.chroma(a) * 1.15)],
    ['鮮艷度', false, (a, b) => expect(stats.chroma(b)).toBeGreaterThan(stats.chroma(a) * 1.05)],
    ['褪色', true, (a, b) => expect(stats.black(b)).toBeGreaterThan(stats.black(a) + 10)],
    ['顆粒', true, (a, b) => expect(stats.hf(b)).toBeGreaterThan(stats.hf(a) * 1.2)],
    ['暗角', true, (a, b) => expect(stats.vignette(b)).toBeLessThan(stats.vignette(a) * 0.85)],
  ];
  for (const [label, oneWay, check] of cases) {
    await option(page, label).click();
    await expect(slider).toHaveAttribute('aria-label', label);
    await dragSlider(page, oneWay ? 400 : 300);
    await expect(slider).toHaveAttribute('aria-valuenow', oneWay ? '100' : '50');
    if (label === '色溫') await expect(page.locator('.slider-track.track-temperature')).toBeVisible();
    if (label === '褪色') await expect(page.locator('.slider-def')).toHaveCount(0);
    const e1 = await settled(frame);
    check(e0, e1);
    await undo.click();
    expect(mad(e0, await settled(frame)), `${label} undone`).toBeLessThan(0.5);
  }

  // dots, ⊘ resets all twelve in one step, ↶ brings them back
  await option(page, '亮度').click();
  await dragSlider(page, 300);
  await option(page, '暗角').click();
  await dragSlider(page, 400);
  const styled = await settled(frame);
  await expect(option(page, '亮度')).toHaveClass(/\bhas-value\b/);
  await expect(option(page, '暗角')).toHaveClass(/\bhas-value\b/);
  await expect(tab(page, '調節').locator('.tab-dot')).toHaveCount(1);
  await shot(page, '60-editor-adjust');
  await option(page, '原圖').click();
  await expect(page.locator('.strip .item.has-value')).toHaveCount(0);
  await expect(tab(page, '調節').locator('.tab-dot')).toHaveCount(0);
  expect(mad(e0, await settled(frame))).toBeLessThan(0.5);
  await undo.click();
  expect(mad(styled, await settled(frame))).toBeLessThan(0.5);
  await undo.click();
  await undo.click();
  await settled(frame);

  // 一鍵 › 質感
  await tab(page, '一鍵').click();
  await expect(option(page, '自然')).toBeVisible(); // 美顏 is the default part
  await page.getByRole('button', { name: '質感', exact: true }).click();
  for (const label of ['無', '膠片', 'CCD', '直閃', '藍調', '電影感']) await expect(option(page, label)).toBeVisible();
  await expect(option(page, '無')).toHaveAttribute('aria-selected', 'true');
  await expect(slider).toHaveCount(0);
  const plain = await exportPixels(page);
  await option(page, '膠片').click();
  await expect(slider).toHaveAttribute('aria-label', '程度');
  await expect(slider).toHaveAttribute('aria-valuenow', '80');
  await expect(tab(page, '一鍵').locator('.tab-dot')).toHaveCount(1);
  const filmFrame = await settled(frame);
  expect(mad(e0, filmFrame)).toBeGreaterThan(2);
  await shot(page, '61-editor-look-film');
  const filmExport = await exportPixels(page);
  expect(mad(plain, filmExport)).toBeGreaterThan(2);
  await option(page, '無').click();
  await expect(slider).toHaveCount(0);
  expect(mad(e0, await settled(frame))).toBeLessThan(0.5);

  // the look again (程度 from 無 → 80), 程度 → 70, 曝光 +50, then the 調節 lead chip
  await option(page, '膠片').click();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '70');
  await tab(page, '調節').click();
  await expect(page.locator('.lead-chip')).toHaveText('質感：膠片');
  await option(page, '曝光').click();
  await dragSlider(page, 300);
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await page.locator('.lead-chip').click();
  await expect(tab(page, '一鍵')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '質感', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await settled(frame);

  // close (autosave flush) and reopen from 最近編輯: the look, its 程度 and the 調節 values are back
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await tab(page, '一鍵').click();
  if ((await page.getByRole('button', { name: '質感', exact: true }).getAttribute('aria-pressed')) !== 'true')
    await page.getByRole('button', { name: '質感', exact: true }).click();
  await expect(option(page, '膠片')).toHaveAttribute('aria-selected', 'true');
  await expect(slider).toHaveAttribute('aria-valuenow', '70');
  await tab(page, '調節').click();
  await option(page, '曝光').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  // 最近編輯 keeps the original as a JPEG (q 0.9), so the reopened photo is not the imported PNG: on sample_face.png the
  // round trip alone moves the frame by mean ≈ 1.0 (no 調節, no 質感) and ≈ 1.2 here. A lost 膠片 would move it by ≈ 10,
  // a lost 曝光 by ≈ 21.
  expect(mad(before, await settled(frame)), 'the reopened edit draws the same 質感 and 調節').toBeLessThan(2);
});

test('camera: 調節 tab, 暗角, CCD, moving grain; shot → 編輯 keeps them; the camera look persists', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0 && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const frame = page.locator('.cam-stage .frame');
  const slider = page.getByRole('slider');
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);

  await tab(page, '調節').click();
  await expect(tab(page, '調節')).toHaveAttribute('aria-selected', 'true');
  await option(page, '暗角').click();
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(800);
  const vig = await grab(frame, '62-camera-vignette');
  console.log(`camera: jitter ${jitter.toFixed(2)}, vignette ratio ${stats.vignette(a1).toFixed(3)} → ${stats.vignette(vig).toFixed(3)}`);
  expect(stats.vignette(vig)).toBeLessThan(stats.vignette(a1) * 0.85);

  await tab(page, '一鍵').click();
  await page.getByRole('button', { name: '質感', exact: true }).click();
  await option(page, 'CCD').click();
  await page.waitForTimeout(800);
  const ccd = await grab(frame, '63-camera-ccd');
  expect(mad(vig, ccd)).toBeGreaterThan(Math.max(2, 4 * jitter));

  // grain moves in the preview: frame-to-frame difference well above the camera's own jitter
  await tab(page, '調節').click();
  await option(page, '顆粒').click();
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(500);
  const g1 = await grab(frame);
  await page.waitForTimeout(300);
  const g2 = await grab(frame);
  expect(mad(g1, g2)).toBeGreaterThan(Math.max(1.5, 3 * jitter));

  // shutter → review → 編輯: the editor opens with the same look and values
  await page.waitForTimeout(400); // the persisted look is debounced 300 ms
  await page.getByRole('button', { name: '拍照' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 30_000 });
  await tab(page, '調節').click();
  await option(page, '暗角').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await option(page, '顆粒').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await tab(page, '一鍵').click();
  if ((await page.getByRole('button', { name: '質感', exact: true }).getAttribute('aria-pressed')) !== 'true')
    await page.getByRole('button', { name: '質感', exact: true }).click();
  await expect(option(page, 'CCD')).toHaveAttribute('aria-selected', 'true');

  // after a reload the camera look (meiyan.look.v1) still holds 調節 and 質感
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? 'null'));
  expect(stored?.photo?.values?.['adjust.vignette']).toBe(1);
  expect(stored?.photo?.values?.['adjust.grain']).toBe(1);
  expect(stored?.photo?.look?.id).toBe('ccd');
});
