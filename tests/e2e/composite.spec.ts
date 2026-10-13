// GPU composite == compositeCpu (v0.4 step-2 spec §8.3) on the dev-server harness page: each 調節 item at ±max,
// each 質感 look at 100, everything together, grain; neutral frames use the base program; no jump at the switch.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('composite: 調節 and 質感 on the GPU match compositeCpu; neutral frames use the base program', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`${DEV_URL}/tests/e2e/pages/composite.html`);
  await page.waitForFunction(() => typeof window.runCompositeCheck === 'function');
  const r = await page.evaluate(() => window.runCompositeCheck!());
  console.log(`renderer: ${r.renderer}`);
  for (const [name, c] of Object.entries(r.cases))
    console.log(`${name.padEnd(24)} max ${c.max} mean ${c.mean.toFixed(3)} p99.9 ${c.p999} [${c.passes.join(',')}]`);

  expect(r.glError).toBe(0);
  // neutral: step 1's base program drew (no 'adjust' pass) and the composite is the identity on its input
  expect(r.cases.neutral.passes).not.toContain('adjust');
  expect(r.cases.neutral.passes).toContain('composite');
  expect(r.cases.neutral.max).toBeLessThanOrEqual(1);

  for (const [name, c] of Object.entries(r.cases)) {
    if (name === 'neutral') continue;
    expect(c.passes, name).toContain('adjust');
    if (name.startsWith('look:') || name === 'all') {
      // GPU bilinear LUT taps use fixed-point weights (as engine.spec.ts accepts for 黑白)
      expect(c.mean, name).toBeLessThanOrEqual(1);
    } else if (name === 'adjust.grain+') {
      // cell-boundary rounding: float32 lattice coordinates can pick the neighbouring cell
      expect(c.p999, name).toBeLessThanOrEqual(1);
    } else if (name.startsWith('jump:')) {
      // +1 display unit through the 調節 program vs the neutral base render: a continuous change, no jump. The CPU
      // reference's own move at +1 unit of 亮度 is max 2, mean ≈ 0.76 on these inputs (曝光: max 1, mean ≈ 0.43), so
      // the bounds sit just above it; a one-level offset added by the program switch would push the mean past 1.
      expect(c.max, name).toBeLessThanOrEqual(2);
      expect(c.mean, name).toBeLessThanOrEqual(1);
    } else {
      expect(c.max, name).toBeLessThanOrEqual(1);
      expect(c.mean, name).toBeLessThanOrEqual(0.25);
    }
  }
});
