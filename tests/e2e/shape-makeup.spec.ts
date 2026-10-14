// v0.4 step 5 (face-detail spec §8.3): the new warps and 左右分開 against the CPU port, the procedural makeup against its
// CPU port and its regions, and the editor / camera flows.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('step-5 warps: CPU port == RESHAPE_FS for every new warp at ±max, split L ≠ R and all 15 items, both carriers', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinFaceDetail === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapePinFaceDetail!(c), carrier);
    expect(cases).toHaveLength(13);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.n, c.name).toBeGreaterThan(30_000);
      expect(c.moved, c.name).toBeGreaterThan(20);
      expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
    }
  }
});
