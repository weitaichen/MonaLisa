// A new photo opens at 原圖 (2026-10-18, the user's 「全部都原圖，包括相機拍的」; roadmap §3.7): an import and a camera
// shot handed over from 預覽 start with no adjustment at all, whatever look the camera holds, until the user touches
// something. The first render draws the composite pass only, and the PNG export equals the source exactly (MAD 0):
// no 美顏, 調節, 質感 or 濾鏡, no segmenter (瘦臉 limit) and no 美體 model. The camera keeps its own look for its preview
// and capture, and starts at 原圖 for anyone who never saved one (a fresh install, or an upgrader who never changed it).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { debugState, dragSlider, expect, grab, hold, importFixture, mad, SAMPLE_FACE, settled, test } from './fixtures';

const SEGMENTER = /\/models\/image_segmenter\//;
const POSE_MODEL = /\/models\/pose_landmarker\//;

/** a camera look far from 原圖 in every part an edit can carry: 美顏, 美白, 銳化, 濾鏡, 調節 and 質感 */
const STYLED_LOOK = {
  photo: {
    values: { 'skin.whiten': 0.9, 'skin.sharpen': 0.6, 'filter.amount': 0.7, 'adjust.exposure': 0.8, 'adjust.vignette': 0.6 },
    filterId: 'warm',
    look: { id: 'film', amount: 0.8 },
  },
  person: { values: { 'skin.smooth': 0.9, 'skin.ruddy': 0.5, 'shape.faceSlim': 0.6, 'shape.eyeEnlarge': 0.5 } },
};

/** PNG exports (lossless), set once so a reload keeps them */
const usePng = (page: Page) =>
  page.addInitScript(() => {
    if (!localStorage.getItem('meiyan.prefs.v1')) localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ exportFormat: 'png' }));
  });

function countModels(page: Page): { segmenter: number; pose: number } {
  const n = { segmenter: 0, pose: 0 };
  page.context().on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (SEGMENTER.test(path)) n.segmenter++;
    if (POSE_MODEL.test(path)) n.pose++;
  });
  return n;
}

interface Diff {
  size: [number, number];
  ref: [number, number];
  mad: number;
  max: number;
}

/**
 * 儲存 → the long-press fallback's PNG, compared in the page with `ref`: a base64 file decoded at the export's size, or
 * the pixels stashed under window.__shotOriginal (the camera's unprocessed frame)
 */
async function exportDiff(page: Page, ref: { file: string; mime: string } | 'shot'): Promise<Diff> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dlg = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dlg).toBeVisible({ timeout: 60_000 });
  const img = dlg.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const arg = ref === 'shot' ? null : { b64: readFileSync(ref.file).toString('base64'), mime: ref.mime };
  const d = await img.evaluate(async (i: HTMLImageElement, f: { b64: string; mime: string } | null) => {
    const w = i.naturalWidth;
    const h = i.naturalHeight;
    const read = (draw: (g: CanvasRenderingContext2D) => void, cw = w, ch = h) => {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      draw(g);
      return g.getImageData(0, 0, cw, ch).data;
    };
    const a = read((g) => g.drawImage(i, 0, 0));
    let b: Uint8ClampedArray;
    let ref: [number, number];
    if (f) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      const src = await createImageBitmap(new Blob([bytes], { type: f.mime }), { imageOrientation: 'from-image' });
      ref = [src.width, src.height];
      b = read((g) => g.drawImage(src, 0, 0, w, h));
    } else {
      const s = (window as unknown as { __shotOriginal: { width: number; height: number; data: Uint8ClampedArray } }).__shotOriginal;
      ref = [s.width, s.height];
      b = s.width === w && s.height === h ? s.data : new Uint8ClampedArray(a.length);
    }
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let k = 0; k < a.length; k += 4)
      for (let ch = 0; ch < 3; ch++) {
        const dv = Math.abs(a[k + ch] - b[k + ch]);
        sum += dv;
        max = Math.max(max, dv);
        n++;
      }
    return { size: [w, h] as [number, number], ref, mad: sum / n, max };
  }, arg);
  await dlg.getByRole('button', { name: '關閉' }).click();
  return d;
}

/** the 一鍵 strip shows 原圖 selected and no 程度 slider; no tab carries a dot; 美膚 › 磨皮 reads 0 */
async function expectOriginalPanel(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await expect(page.getByRole('option', { name: '原圖', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('[role=tab] .tab-dot')).toHaveCount(0);
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
}

test('an import opens at 原圖 whatever the camera look holds: composite only, no model, the PNG export equals the source (MAD 0)', async ({ page }) => {
  test.setTimeout(240_000);
  const models = countModels(page);
  await usePng(page);
  await page.addInitScript((look) => {
    if (!localStorage.getItem('meiyan.look.v1')) localStorage.setItem('meiyan.look.v1', JSON.stringify(look));
  }, STYLED_LOOK);
  await importFixture(page, SAMPLE_FACE);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(1);
  await settled(page.locator('.editor-stage .frame'));
  await page.waitForTimeout(2500);
  expect((await debugState(page)).passes).toEqual(['composite']);
  expect(models, 'no segmenter and no 美體 model on import').toEqual({ segmenter: 0, pose: 0 });
  const d = await exportDiff(page, { file: SAMPLE_FACE, mime: 'image/png' });
  console.log(`import vs source: ${JSON.stringify(d)}`);
  expect(d.size).toEqual(d.ref);
  expect(d.mad).toBe(0);
  expect(d.max).toBe(0);
  await expectOriginalPanel(page);
  expect(models).toEqual({ segmenter: 0, pose: 0 });
});

test('重置 returns to 原圖, the state a new photo opens with: composite only again, the PNG export equals the source (MAD 0)', async ({ page }) => {
  test.setTimeout(240_000);
  await usePng(page);
  await importFixture(page, SAMPLE_FACE);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(1);
  const frame = page.locator('.editor-stage .frame');
  await settled(frame);
  // the user touches something: 一鍵 › 自然 (美顏, 美型 and 調節 values)
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await debugState(page)).passes.length, { timeout: 30_000 }).toBeGreaterThan(1);
  // 重置 (inline confirm) goes back to 原圖, not to 自然
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.getByRole('button', { name: /^確定重置/ }).click();
  await expect.poll(async () => (await debugState(page)).passes, { timeout: 30_000 }).toEqual(['composite']);
  await settled(frame);
  await page.waitForTimeout(1500);
  const d = await exportDiff(page, { file: SAMPLE_FACE, mime: 'image/png' });
  console.log(`重置 vs source: ${JSON.stringify(d)}`);
  expect(d.size).toEqual(d.ref);
  expect(d.mad).toBe(0);
  expect(d.max).toBe(0);
  await expectOriginalPanel(page);
});

test('an upgrader without a saved camera look starts the camera at 原圖; a camera shot opens in 編輯 at 原圖: the camera look still draws the preview and the capture, the PNG export equals the unprocessed frame (MAD 0)', async ({ page }) => {
  test.setTimeout(300_000);
  const models = countModels(page);
  await usePng(page);
  // a 0.4.0 upgrader who never changed the camera: the version that ran here and its settings, but no saved camera look
  // (0.3 wrote meiyan.params.v1 only from the camera's own edits, 0.4.0 never wrote its default 自然)
  await page.addInitScript(() => {
    if (!localStorage.getItem('meiyan.version.v1')) localStorage.setItem('meiyan.version.v1', JSON.stringify('0.4.0'));
  });
  // the unprocessed frame the camera hands to 編輯 (grabOriginalFrame: createImageBitmap of a 2D canvas), copied while armed
  await page.addInitScript(() => {
    const w = window as unknown as { __armOriginal?: boolean; __shotOriginal?: { width: number; height: number; data: Uint8ClampedArray } };
    const make = window.createImageBitmap.bind(window) as (...a: unknown[]) => Promise<ImageBitmap>;
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = (src: unknown, ...rest: unknown[]) => {
      if (w.__armOriginal && src instanceof HTMLCanvasElement) {
        const g = src.getContext('2d')!;
        w.__shotOriginal = { width: src.width, height: src.height, data: g.getImageData(0, 0, src.width, src.height).data };
        w.__armOriginal = false;
      }
      return make(src, ...rest);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  // nobody saved a camera look on this profile, so the camera starts at 原圖: the upgrader's default 自然 is not kept
  // (2026-10-18, 「全部都原圖」; a fresh install likewise), and loading it wrote nothing
  expect(
    await page.evaluate(() => [localStorage.getItem('meiyan.look.v1'), localStorage.getItem('meiyan.params.v1'), localStorage.getItem('meiyan.prefs.v1') !== null]),
  ).toEqual([null, null, true]);
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await expect(page.getByRole('option', { name: '原圖', exact: true })).toHaveAttribute('aria-selected', 'true');
  // a camera look the user set: 自然 on the face and 美白 100 on the frame. meiyan.look.v1 saves the photo look
  // (debounced 300 ms); its person part stays 原圖, the face's 自然 lives in the camera session (K15)
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const l = JSON.parse(localStorage.getItem('meiyan.look.v1') ?? '{}');
        return [l.photo?.values?.['skin.whiten'] ?? null, l.person?.preset?.id ?? null];
      }),
    )
    .toEqual([1, 'original']);
  // it draws the live preview
  const frame = page.locator('.cam-stage .frame');
  await page.waitForTimeout(800);
  const styled = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(500);
  const held = await grab(frame);
  await release();
  expect(mad(styled, held), 'the camera look draws the preview').toBeGreaterThan(2);
  // … and the capture: 預覽 shows the processed shot, unlike the frame handed to 編輯
  await page.waitForTimeout(500);
  await page.evaluate(() => ((window as unknown as { __armOriginal: boolean }).__armOriginal = true));
  await page.getByRole('button', { name: '拍照' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __shotOriginal?: unknown }).__shotOriginal)).toBe(true);
  const captured = await page.locator('canvas[aria-label="拍攝結果"]').evaluate((c: HTMLCanvasElement) => {
    const s = (window as unknown as { __shotOriginal: { width: number; height: number; data: Uint8ClampedArray } }).__shotOriginal;
    const a = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    if (c.width !== s.width || c.height !== s.height) return { same: false, mad: -1 };
    let sum = 0;
    for (let k = 0; k < a.length; k += 4) for (let ch = 0; ch < 3; ch++) sum += Math.abs(a[k + ch] - s.data[k + ch]);
    return { same: true, mad: sum / ((a.length / 4) * 3) };
  });
  console.log(`captured vs unprocessed frame: ${JSON.stringify(captured)}`);
  expect(captured.same).toBe(true);
  expect(captured.mad, 'the capture is drawn with the camera look').toBeGreaterThan(2);

  // 編輯: the shot opens at 原圖, nothing applied on load
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(1);
  await settled(page.locator('.editor-stage .frame'));
  await page.waitForTimeout(2500);
  expect((await debugState(page)).passes).toEqual(['composite']);
  const d = await exportDiff(page, 'shot');
  console.log(`hand-over vs unprocessed frame: ${JSON.stringify(d)}`);
  expect(d.size).toEqual(d.ref);
  expect(d.mad).toBe(0);
  expect(d.max).toBe(0);
  await expectOriginalPanel(page);
  expect(models, 'no segmenter and no 美體 model on the hand-over').toEqual({ segmenter: 0, pose: 0 });
  // the photo look is still the user's; the person part is stored as 原圖 (K15)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? 'null'));
  expect(stored?.photo?.values?.['skin.whiten']).toBe(1);
  expect(stored?.person?.preset?.id).toBe('original');
});
