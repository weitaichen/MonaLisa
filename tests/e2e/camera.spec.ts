import { debugState, dragSlider, expect, grab, hold, mad, meanLuma, shot, test } from './fixtures';

test('camera: gate → live beautified preview with face → panel → slider → shutter → review', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  const gate = page.getByRole('button', { name: '點擊開啟相機' });
  await expect(gate).toBeVisible();
  await shot(page, '02-camera-gate');
  await gate.click();

  // live: stream running, engine + tracker up, face found, frames flowing
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0 && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const live = await debugState(page);
  expect(live.delegate === 'GPU' || live.delegate === 'CPU').toBe(true);
  expect(live.lastError).toBeNull();
  const shutter = page.getByRole('button', { name: '拍照' });
  await expect(shutter).toBeEnabled();
  await expect(page.getByText('未偵測到臉部')).toHaveCount(0);
  await shot(page, '03-camera-live');

  // panel tabs switch
  for (const label of ['一鍵', '美型', '濾鏡', '美妝', '美膚']) {
    const tab = page.getByRole('tab', { name: label });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    if (label === '美型') await expect(page.getByRole('option', { name: '大眼', exact: true })).toBeVisible();
    if (label === '濾鏡') await expect(page.getByRole('option', { name: '暖調', exact: true })).toBeVisible();
    if (label === '美妝') await expect(page.getByRole('option', { name: '原色', exact: true }).first()).toBeVisible();
  }
  await page.getByRole('tab', { name: '美型' }).click();
  await shot(page, '04-camera-tab-shape');
  await page.getByRole('tab', { name: '美膚' }).click();

  // slider changes a param: visible pixel change in the live preview, well above frame-to-frame jitter
  const frame = page.locator('.cam-stage .frame');
  await page.getByRole('option', { name: '美白', exact: true }).click();
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-label', '美白');
  const before = Number(await slider.getAttribute('aria-valuenow'));
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  expect(before).toBeLessThan(100);
  await page.waitForTimeout(800);
  const b = await grab(frame, '05-camera-whiten-100');
  const change = mad(a1, b);
  console.log(`live preview: jitter ${jitter.toFixed(2)}, whiten ${before}→100 change ${change.toFixed(2)} (0..255)`);
  expect(change).toBeGreaterThan(Math.max(2, 4 * jitter));
  expect(meanLuma(b)).toBeGreaterThan(meanLuma(a1));
  // persisted live look (debounced 300 ms)
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.params.v1') ?? '{}').values?.['skin.whiten']))
    .toBe(1);

  // hold-to-compare shows the unprocessed frame
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();
  await page.waitForTimeout(500);
  const held = await grab(frame, '06-camera-compare-held');
  await release();
  expect(mad(held, b)).toBeGreaterThan(2);

  // tapping the preview collapses the panel; a visible 美顏 control brings it back
  await frame.click({ position: { x: 24, y: 64 } });
  await expect(page.locator('.panel.collapsed')).toHaveCount(1);
  const reopen = page.locator('.panel-reopen');
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.locator('.panel.collapsed')).toHaveCount(0);
  await expect(reopen).toHaveCount(0);
  await expect(page.getByRole('slider')).toBeVisible();

  // shutter → review with the captured image
  await page.waitForTimeout(500);
  await shutter.click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await expect(page.locator('canvas[aria-label="拍攝結果"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '儲存' })).toBeVisible({ timeout: 30_000 });
  const info = await page.locator('canvas[aria-label="拍攝結果"]').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { w: c.width, h: c.height, luma: sum / (d.length / 4) };
  });
  expect(info).not.toBeNull();
  // 1280×720 fake camera, centre-cropped to the default 3:4 frame
  expect(info!.h).toBe(720);
  expect(info!.w / info!.h).toBeCloseTo(3 / 4, 2);
  expect(info!.luma).toBeGreaterThan(20);
  await shot(page, '07-review');

  // review → editor on the unprocessed capture
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 30_000 });
  await shot(page, '08-review-to-editor');
});
