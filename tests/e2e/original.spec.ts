// A new photo opens at 原圖 (2026-10-18, the user's 「全部都原圖，包括相機拍的」; roadmap §3.7): an import, whatever look
// the camera holds, and a camera shot with nothing set start with no adjustment at all until the user touches something.
// The first render draws the composite pass only, and the PNG export equals the source exactly (MAD 0): no 美顏, 調節,
// 質感 or 濾鏡, no segmenter (瘦臉 limit) and no 美體 model. A shot with a camera look opens with it (camera per-person
// spec U6, §3.8; changed on purpose, §12.2). The camera keeps its own photo look for its preview and capture (its person
// part is not applied, K15), and starts at 原圖 for anyone who never saved one (a fresh install, or an upgrader).
import type { Page } from '@playwright/test';
import { armShotOriginal, capturedVsOriginal, debugState, dragSlider, expect, exportDiff, grab, hold, importFixture, mad, SAMPLE_FACE, settled, test } from './fixtures';

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

/** Home → 拍攝 → the live camera with the face found */
async function openCamera(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
}

/** 拍照 with the unprocessed frame armed → 預覽; returns the capture against that frame (same size, MAD) */
async function shootArmed(page: Page): Promise<{ same: boolean; mad: number }> {
  await page.evaluate(() => ((window as unknown as { __armOriginal: boolean }).__armOriginal = true));
  await page.getByRole('button', { name: '拍照' }).click();
  return capturedVsOriginal(page);
}

/** 預覽 → 編輯, the photo's face found and drawn */
async function openEditor(page: Page): Promise<void> {
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(1);
  await settled(page.locator('.editor-stage .frame'));
}

// changed on purpose (camera per-person spec §12.2, U6): the camera test is split. A shot with nothing set still opens
// at 原圖; one with a camera look opens with it; the person part of a stored look is not applied (K15)
test('an upgrader without a saved camera look starts the camera at 原圖; a shot with nothing set opens in 編輯 at 原圖: composite only, the PNG export equals the unprocessed frame (MAD 0)', async ({ page }) => {
  test.setTimeout(300_000);
  const models = countModels(page);
  await usePng(page);
  // a 0.4.0 upgrader who never changed the camera: the version that ran here and its settings, but no saved camera look
  // (0.3 wrote meiyan.params.v1 only from the camera's own edits, 0.4.0 never wrote its default 自然)
  await page.addInitScript(() => {
    if (!localStorage.getItem('meiyan.version.v1')) localStorage.setItem('meiyan.version.v1', JSON.stringify('0.4.0'));
  });
  await armShotOriginal(page);
  await openCamera(page);
  // nobody saved a camera look on this profile, so the camera starts at 原圖: the upgrader's default 自然 is not kept
  // (2026-10-18, 「全部都原圖」; a fresh install likewise), and loading it wrote nothing
  expect(
    await page.evaluate(() => [localStorage.getItem('meiyan.look.v1'), localStorage.getItem('meiyan.params.v1'), localStorage.getItem('meiyan.prefs.v1') !== null]),
  ).toEqual([null, null, true]);
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await expect(page.getByRole('option', { name: '原圖', exact: true })).toHaveAttribute('aria-selected', 'true');
  // a fresh camera draws the composite pass alone (A3)
  await page.waitForTimeout(800);
  expect((await debugState(page)).passes).toEqual(['composite']);
  // nothing set: the shot hands nothing over (handOverOf: null) and 編輯 opens at 原圖, nothing applied on load
  const captured = await shootArmed(page);
  console.log(`captured (nothing set) vs unprocessed frame: ${JSON.stringify(captured)}`);
  expect(captured.same).toBe(true);
  await openEditor(page);
  await page.waitForTimeout(2500);
  expect((await debugState(page)).passes).toEqual(['composite']);
  const d = await exportDiff(page, 'shot');
  console.log(`hand-over (nothing set) vs unprocessed frame: ${JSON.stringify(d)}`);
  expect(d.size).toEqual(d.ref);
  expect(d.mad).toBe(0);
  expect(d.max).toBe(0);
  await expectOriginalPanel(page);
  expect(models, 'no segmenter and no 美體 model on the hand-over').toEqual({ segmenter: 0, pose: 0 });
});

test('a shot with a camera look opens in 編輯 with it (U6): the photo look from the first frame, the face takes its camera person’s params', async ({ page }) => {
  test.setTimeout(300_000);
  await armShotOriginal(page);
  await openCamera(page);
  // a camera look the user set: 自然 on the face and 美白 100 on the frame. meiyan.look.v1 saves the photo look
  // (debounced 300 ms); its person part stays 原圖, the face's 自然 lives in the camera session (K15)
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
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
  // the face's 磨皮 as 自然 set it in the camera
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  const smooth = await page.getByRole('slider').getAttribute('aria-valuenow');
  expect(Number(smooth), '自然 sets 磨皮').toBeGreaterThan(0);
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
  const captured = await shootArmed(page);
  console.log(`captured vs unprocessed frame: ${JSON.stringify(captured)}`);
  expect(captured.same).toBe(true);
  expect(captured.mad, 'the capture is drawn with the camera look').toBeGreaterThan(2);

  // 編輯: the camera's photo look from the first frame, and the first answer gives the face's person the camera params
  await openEditor(page);
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  await expect(page.getByRole('slider'), 'the face keeps the camera 磨皮').toHaveAttribute('aria-valuenow', smooth!, { timeout: 30_000 });
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await expect(page.getByRole('slider'), 'the photo keeps the camera 美白').toHaveAttribute('aria-valuenow', '100');
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await debugState(page)).passes.some((p) => p !== 'composite'), { timeout: 30_000 }).toBe(true);
  // the face was found, so nobody was dropped
  await expect(page.getByText(/未帶入相機效果/)).toHaveCount(0);
});

test('a stored camera look after a reload: its photo part draws the camera, its person part is not applied (K15)', async ({ page }) => {
  test.setTimeout(240_000);
  // the look a previous run saved, 美顏 and 美型 in its person part (0.5 applied it to the camera's face)
  await page.addInitScript((look) => {
    if (!localStorage.getItem('meiyan.look.v1')) localStorage.setItem('meiyan.look.v1', JSON.stringify(look));
  }, STYLED_LOOK);
  await openCamera(page);
  // the photo part (調節 among it) draws the live frame …
  await expect.poll(async () => (await debugState(page)).passes, { timeout: 30_000 }).toContain('adjust');
  // … and no face pass ever runs: the stored 磨皮, 紅潤, 瘦臉 and 大眼 are not the face's (the face is 原圖, weight 0)
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    for (const p of (await debugState(page)).passes) seen.add(p);
    await page.waitForTimeout(250);
  }
  console.log(`live passes with a stored look: ${[...seen].join(', ')}`);
  for (const pass of ['mask', 'makeup', 'reshape']) expect(seen.has(pass), `the live frame runs no ${pass} pass`).toBe(false);
});
