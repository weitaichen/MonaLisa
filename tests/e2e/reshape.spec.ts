// The CPU port of the reshape shader (src/engine/passes/reshapeCpu.ts), which the straightness ratchet measures 瘦臉
// with, must be the shader: render RESHAPE_FS on a coordinate texture and compare it with the port at every pixel.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('reshape CPU port == RESHAPE_FS (contour warps, every face warp, body field as the outer map)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePin === 'function');
  const cases = await page.evaluate(() => window.runReshapePin!());
  expect(cases).toHaveLength(3);
  for (const c of cases) {
    console.log(`${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
    expect(c.n, c.name).toBeGreaterThan(30_000);
    expect(c.moved, c.name).toBeGreaterThan(1_000);
    // px of the 200×300 render: float32 shader math and filtering vs the float64 port
    expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
  }
});
