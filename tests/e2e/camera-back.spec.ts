// E4b (camera per-person spec §12.2): the landscape ten-face regression (K20), group path and option C.
import { camBox, cpuDelegate, debugState, expect, flipBack, liveGroup, open, test } from './fixtures';

/**
 * the faces composeFitWidth puts inside the 3:4 crop (x 370–910 of 1280). The scripts are untyped .mjs, imported
 * dynamically with a cast as detector.spec.ts:416 does (a static import is TS7016 under `strict`)
 */
async function facesInView(): Promise<number> {
  const { composeFitWidthBoxes } = (await import(new URL('../../scripts/gen-y4m.mjs', import.meta.url).href)) as {
    composeFitWidthBoxes(layout: unknown): { x: number; y: number; w: number; h: number }[];
  };
  const { TEN_FACES } = (await import(new URL('../../scripts/gen-group-fixture.mjs', import.meta.url).href)) as { TEN_FACES: unknown };
  return composeFitWidthBoxes(TEN_FACES).filter((b) => b.x >= 370 / 1280 && b.x + b.w <= 910 / 1280).length;
}

test('E4b back camera, the landscape ten-face clip: every face inside the visible crop found and tappable', async ({ page }) => {
  const inView = await facesInView();
  await cpuDelegate(page);
  await liveGroup(page, true); // the group path, asked for: LIVE_GROUP ships false (2026-10-22, PGN failed, §10)
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(inView);
  for (const b of (await debugState(page)).boxes) {
    const g = await camBox(page, b.id, false);
    await page.mouse.click(g.point.x, g.point.y);
    await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
  }
});

test('E4b option C (LIVE_GROUP off): ten faces, full-range VIDEO, the cadence skips', async ({ page }) => {
  await cpuDelegate(page);
  await liveGroup(page, false);
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(10);
  expect((await debugState(page)).liveDetector).toBe('full-range');
  // the cadence's k (§6.4), over tier L's floor of 2 (SwiftShader's ten faces may step the auto tier down to L, which
  // alone makes liveEvery 2)
  const over = async () => {
    const d = await debugState(page);
    return (d.liveEvery ?? 1) - (d.tier === 'L' ? 2 : 1);
  };
  await expect.poll(over, { timeout: 30_000 }).toBeGreaterThan(0);
  const d = await debugState(page);
  console.log(`E4b option C: liveEvery ${d.liveEvery}, tier ${d.tier}, fps ${d.fps.toFixed(1)}, detectMs ${d.detectMs.toFixed(1)}`);
});
