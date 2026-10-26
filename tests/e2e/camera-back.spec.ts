// E4b (camera per-person spec §12.2): the landscape ten-face regression (K20), 合照模式 on (the group path) and off
// (option C, the default, K22).
import { camBox, cpuDelegate, debugState, expect, flipBack, groupModeButton, open, setGroupMode, test } from './fixtures';

type Box = { x: number; y: number; w: number; h: number };
/**
 * the faces composeFitWidth puts wholly inside the 3:4 crop (x 370–910 of 1280), and those at least partly inside it.
 * The scripts are untyped .mjs, imported dynamically with a cast as detector.spec.ts:416 does (a static import is TS7016
 * under `strict`)
 */
async function facesInView(): Promise<{ whole: Box[]; partly: Box[] }> {
  const { composeFitWidthBoxes } = (await import(new URL('../../scripts/gen-y4m.mjs', import.meta.url).href)) as {
    composeFitWidthBoxes(layout: unknown): Box[];
  };
  const { TEN_FACES } = (await import(new URL('../../scripts/gen-group-fixture.mjs', import.meta.url).href)) as { TEN_FACES: unknown };
  const boxes = composeFitWidthBoxes(TEN_FACES);
  const [x0, x1] = [370 / 1280, 910 / 1280];
  return { whole: boxes.filter((b) => b.x >= x0 && b.x + b.w <= x1), partly: boxes.filter((b) => b.x < x1 && b.x + b.w > x0) };
}

test('E4b back camera, 合照模式 on, the landscape ten-face clip: every face inside the visible crop found and tappable', async ({ page }) => {
  // the faces wholly inside the crop are found; one the crop's edge cuts may be too (the whole view starts it, round-1
  // review C6: the clip's x 771–918 face is cut by 8 px), never one wholly outside
  const { whole, partly } = await facesInView();
  await cpuDelegate(page);
  await open(page);
  await setGroupMode(page, true);
  await flipBack(page);
  /** the tracked box's centre lies in the clip's face box */
  const holds = (b: Box, t: Box) => t.x + t.w / 2 >= b.x && t.x + t.w / 2 <= b.x + b.w && t.y + t.h / 2 >= b.y && t.y + t.h / 2 <= b.y + b.h;
  const found = async () => {
    const shown = (await debugState(page)).boxes;
    return whole.filter((b) => shown.some((t) => holds(b, t))).length;
  };
  await expect.poll(found, { timeout: 30_000 }).toBe(whole.length);
  // one face, one track (round-2 review D13: a count bound let two tracks on one face pass, the round-1 C5 defect):
  // sampled over 2 s, every tracked box is on a face at least partly inside, each such face holds one tracked centre at
  // most, and each face wholly inside exactly one
  for (let i = 0; i < 10; i++) {
    const shown = (await debugState(page)).boxes;
    expect(shown.every((t) => partly.some((b) => holds(b, t)))).toBe(true);
    const tracksOn = partly.map((b) => shown.filter((t) => holds(b, t)).length);
    // a face wholly inside: 1; one the crop's edge cuts: 0 or 1
    expect(tracksOn).toEqual(partly.map((b, j) => (whole.includes(b) ? 1 : Math.min(1, tracksOn[j]))));
    await page.waitForTimeout(200);
  }
  for (const b of (await debugState(page)).boxes) {
    const g = await camBox(page, b.id, false);
    await page.mouse.click(g.point.x, g.point.y);
    await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
  }
});

test('E4b option C (合照模式 off, the default): ten faces, full-range VIDEO, the cadence skips', async ({ page }) => {
  await cpuDelegate(page);
  await open(page);
  await expect(groupModeButton(page)).toHaveAttribute('aria-pressed', 'false');
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
