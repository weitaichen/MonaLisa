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

test('reshape CPU port == RESHAPE_FS with N faces and caps, both face-table carriers (S §8.2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinMulti === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapePinMulti!(c), carrier);
    expect(cases).toHaveLength(3);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.moved, c.name).toBeGreaterThan(300);
      expect(c.maxErrPx, c.name).toBeLessThan(0.05);
    }
  }
});

test('the step-5 read gate (uDetail) changes no output bit: gated == every face block read, both carriers', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapeDetailGate === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapeDetailGate!(c), carrier);
    expect(cases).toHaveLength(6);
    for (const c of cases) {
      console.log(`${c.name}: ${c.moved} px moved > 1 px, ${c.diff} output floats differ`);
      expect(c.moved, c.name).toBeGreaterThan(300);
      expect(c.diff, c.name).toBe(0);
    }
  }
});

test('reshape CPU port == RESHAPE_FS under geometry and windows (uGeo, uTile, uWin)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinView === 'function');
  const cases = await page.evaluate(() => window.runReshapePinView!());
  expect(cases.map((c) => c.name)).toEqual(['quarter 1 + flip', 'θ 12° + crop', 'tile in a window']);
  for (const c of cases) {
    console.log(`${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
    expect(c.n, c.name).toBeGreaterThan(5_000);
    expect(c.moved, c.name).toBeGreaterThan(1_000);
    expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
  }
});

test('reshape CPU port == RESHAPE_FS with a 推臉筆 field as the outermost map (push + half restore, body, contour)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinLiquify === 'function');
  const [c] = await page.evaluate(() => window.runReshapePinLiquify!());
  console.log(`${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
  expect(c.n).toBeGreaterThan(30_000);
  expect(c.moved).toBeGreaterThan(1_000);
  expect(c.maxErrPx, JSON.stringify(c.samples.slice(0, 4))).toBeLessThan(0.05);
});
