// The CPU port of the reshape shader (src/engine/passes/reshapeCpu.ts), which the straightness ratchet measures 瘦臉
// with, must be the shader: render RESHAPE_FS on a coordinate texture and compare it with the port at every pixel.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

// the one-face pins run on both face-table carriers: the UBO ships on GPUs, while the app on this SwiftShader e2e
// renders with the texture (faceTableCarrier.ts, S §6.4 2026-10-18)
for (const carrier of ['texture', 'ubo'] as const) {
  test(`reshape CPU port == RESHAPE_FS (contour warps, every face warp, body field as the outer map), ${carrier}`, async ({ page }) => {
    await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
    await page.waitForFunction(() => typeof window.runReshapePin === 'function');
    const cases = await page.evaluate((k) => window.runReshapePin!(k), carrier);
    expect(cases).toHaveLength(3);
    for (const c of cases) {
      console.log(`${c.name} (${carrier}): ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.n, c.name).toBeGreaterThan(30_000);
      expect(c.moved, c.name).toBeGreaterThan(1_000);
      // px of the 200×300 render: float32 shader math and filtering vs the float64 port
      expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
    }
  });
}

test('reshape CPU port == RESHAPE_FS with N faces and caps, up to ten faces, both face-table carriers (S §8.2, §6.7)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinMulti === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapePinMulti!(c), carrier);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.moved, c.name).toBeGreaterThan(300);
      expect(c.maxErrPx, c.name).toBeLessThan(0.05);
    }
    // the last cases list ten faces, the face cap: the GPU draws every row of the table, as the port does, and the
    // tenth row alone warps where the port says (a shorter table or loop would leave it unwarped)
    expect(cases.map((c) => c.name)).toEqual([
      `two faces, every warp (${carrier})`,
      `capped pair, one neutral (${carrier})`,
      `obstacle bounds the cap (${carrier})`,
      `10 faces of 10, every warp, capped (${carrier})`,
      `10 faces of 10, only the tenth warps (${carrier})`,
    ]);
  }
});

test("the UBO carrier's face table is 10 × 96 vec4 = 15,360 B as the driver lays it out (std140), within MAX_UNIFORM_BLOCK_SIZE (S §6.7)", async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.reshapeUboLayout === 'function');
  const l = await page.evaluate(() => window.reshapeUboLayout!());
  console.log(`FaceTab: ${JSON.stringify(l)}`);
  expect(l.dataSize).toBe(15_360);
  expect(l.arrayStride).toBe(16);
  expect(l.arraySize).toBe(960);
  // WebGL2 guarantees 16,384 B; the context may offer more
  expect(l.maxBlockSize).toBeGreaterThanOrEqual(16_384);
  expect(l.dataSize).toBeLessThanOrEqual(16_384);
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

for (const carrier of ['texture', 'ubo'] as const) {
  test(`reshape CPU port == RESHAPE_FS under geometry and windows (uGeo, uTile, uWin), ${carrier}`, async ({ page }) => {
    await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
    await page.waitForFunction(() => typeof window.runReshapePinView === 'function');
    const cases = await page.evaluate((k) => window.runReshapePinView!(k), carrier);
    expect(cases.map((c) => c.name)).toEqual(['quarter 1 + flip', 'θ 12° + crop', 'tile in a window']);
    for (const c of cases) {
      console.log(`${c.name} (${carrier}): ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.n, c.name).toBeGreaterThan(5_000);
      expect(c.moved, c.name).toBeGreaterThan(1_000);
      expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
    }
  });

  test(`reshape CPU port == RESHAPE_FS with a 推臉筆 field as the outermost map (push + half restore, body, contour), ${carrier}`, async ({ page }) => {
    await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
    await page.waitForFunction(() => typeof window.runReshapePinLiquify === 'function');
    const [c] = await page.evaluate((k) => window.runReshapePinLiquify!(k), carrier);
    console.log(`${c.name} (${carrier}): ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
    expect(c.n).toBeGreaterThan(30_000);
    expect(c.moved).toBeGreaterThan(1_000);
    expect(c.maxErrPx, JSON.stringify(c.samples.slice(0, 4))).toBeLessThan(0.05);
  });
}
