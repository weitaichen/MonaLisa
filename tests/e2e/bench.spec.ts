import { debugState, expect, shot, test } from './fixtures';

test('bench.html: 開始 → live engine + tracker + camera with fps and face', async ({ page }) => {
  await page.goto('/bench.html');
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const d = await debugState(page);
  expect(d.lastError).toBeNull();
  expect(d.detectMs).toBeGreaterThan(0);
  expect(d.renderMs).toBeGreaterThan(0);
  await shot(page, '40-bench-live');
});

test('bench.html: 多臉 section keeps its own classes (the 美體偵測 / gate-progress harness locators stay unique)', async ({ page }) => {
  await page.goto('/bench.html');
  await expect(page.locator('.multi-bench')).toHaveCount(1);
  await expect(page.locator('.multi-bench h3')).toHaveText('多臉');
  // tests/harness/b3/bench.mjs reads page.locator('.body-bench') (the 美體偵測 box, mounted only once a body bench
  // runs, so none yet); tests/harness/t8/run-bench.mjs reads '.gate .note' (gateProgress alone)
  await expect(page.locator('.body-bench')).toHaveCount(0);
  await expect(page.locator('.gate .note')).toHaveCount(1);
});
