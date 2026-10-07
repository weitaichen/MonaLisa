import { expect, shot, test } from './fixtures';

test('home renders, prefetches the engine and registers the service worker', async ({ page, guard }) => {
  await page.goto('/');
  await expect(page.getByText('MonaLisa', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /拍攝/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
  await expect(page.getByText('還沒有編輯紀錄')).toBeVisible();
  await expect(page.getByText('所有影像處理都在你的裝置上完成，照片不會上傳。').first()).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await shot(page, '01-home');

  // the engine download starts on the first idle moment and completes from localhost only
  await expect.poll(() => guard.requests.some((u) => u.includes('/models/face_landmarker/')), { timeout: 15_000 }).toBe(true);
  await expect(page.getByText('美顏引擎已就緒')).toBeVisible({ timeout: 60_000 });
  await shot(page, '01b-home-engine-ready');

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, active: !!reg.active };
  });
  expect(sw.active).toBe(true);
  expect(new URL(sw.scope).pathname).toBe('/');
  const debug = await page.evaluate(() => window.__meiyan);
  expect(debug?.screen).toBe('home');
  expect(debug?.lastError).toBeNull();

  // portrait-only layout: a landscape phone gets the rotate hint over the app (RB §4), portrait never does
  const hint = page.locator('.rotate-hint');
  await expect(hint).toBeHidden();
  await page.setViewportSize({ width: 852, height: 393 });
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('請將手機轉為直向使用');
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(hint).toBeHidden();
});
