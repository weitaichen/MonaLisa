// The tiled full-resolution export must equal one untiled render of the same V (S §8.2): windows, aprons, the
// fullShortEdge kernels and the global-V grain / vignette make every tile seamless.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('a TILE = 256 export equals the untiled render (warps, 磨皮, lip, body field, 顆粒, 暗角, 膠片) at three geometries', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/export.html`);
  await page.waitForFunction(() => typeof window.runExportTiles === 'function');
  const res = await page.evaluate(() => window.runExportTiles!());
  expect(res.map((r) => r.name)).toEqual([
    'identity',
    'quarter 1 + flip',
    'θ 12° + crop',
    '601×799 identity',
    'step 5 identity',
    'step 5 quarter 1 + flip',
    'step 5 θ 12° + crop',
    'strokes + 90° turn',
    'everything',
  ]);
  for (const r of res) {
    console.log(`${r.name}: ${r.w}×${r.h}, ${r.tiles} tiles, max channel diff ${r.maxDiff}/255, glError ${r.glError}`);
    expect(r.glError, r.name).toBe(0);
    expect(r.tiles, r.name).toBeGreaterThan(1);
    // 1/255 is the fp32 coordinate rounding of a pixel copy (S §1.3). 601 × 799: the ¼-res grids (S §4.4 grid note).
    // θ 12°: every V pixel is an off-centre bilinear tap, so that rounding flips B by 1 LSB all over and the 膠片 curve
    // with 顆粒's mid-tone weight lifts a rare one to 2/255 (one channel of one interior pixel on SwiftShader), not a seam.
    // step 5 quarter 1 + flip (every makeup part and new warp on): the same 膠片 lift, at one interior pixel (B, 44 px
    // from the nearest tile edge on SwiftShader); ≤ 1/255 with the look off, and with only the makeup or only the warps.
    // everything (the 0.4.0 release gate, θ 12° after a 旋轉): the same lift, one channel of one interior pixel (B, 73 px
    // from the nearest tile edge on SwiftShader); θ 12° after a 旋轉 with 膠片 alone shows it too, and the case is
    // ≤ 1/255 without the 調節 curve or without face B (every feature still moves thousands of pixels).
    const lifted = ['601', 'θ', 'step 5 quarter', 'everything'].some((p) => r.name.startsWith(p));
    expect(r.maxDiff, r.name).toBeLessThanOrEqual(lifted ? 2 : 1);
  }
});

// skin-cleanup spec §8.2 case 5 at full resolution (v0.4 cleanup): the decode is 2× the working bitmap the tone field
// is built from, so the heal's radius and donor (fractions of the O short edge) scale through uWin / uSrcPx to decode px,
// the field is sampled by O, and 白牙's lip guard runs at decode resolution.
test('a TILE = 256 export of a 2× decode with spots, 膚質 and 白牙 equals the untiled render; the heal and lip guard scale', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/export.html`);
  await page.waitForFunction(() => typeof window.runExportFullRes === 'function');
  const r = await page.evaluate(() => window.runExportFullRes!());
  console.log(`${r.name}: ${r.w}×${r.h} from a ${r.working.w}×${r.working.h} working image, ${r.tiles} tiles, max channel diff ${r.maxDiff}/255, pixels off by any LSB within 4 px of a tile line ${(r.lsbNear * 100).toFixed(3)} %, ≥ 32 px away ${(r.lsbFar * 100).toFixed(3)} %`);
  console.log(`heal ${r.heal.map((h) => `r ${h.rPx.toFixed(1)} px reach ${h.reach.toFixed(1)} px`).join(", ")}; 白牙 lifts ${r.teethLifted} tooth pixels, lip ring max ${r.lipRingMax}/255; tone moves ${r.toneMoved} px`);
  expect(r.glError).toBe(0);
  expect([r.w, r.h, r.working.w, r.working.h]).toEqual([1600, 1200, 800, 600]);
  expect(r.tiles).toBeGreaterThan(1);
  // S §8.2 case 5: within 1/255; and no seam: the 1-LSB rounding differences are no denser at the tile lines than inside
  expect(r.maxDiff).toBeLessThanOrEqual(1);
  expect(r.lsbNear).toBeLessThanOrEqual(1.5 * r.lsbFar + 1e-4);
  // the heal works in decode px: each spot moves pixels out to its quad (1.1 r, α = 0 there) and not past it; at working
  // px (half) the reach would end near 0.55 r
  for (const h of r.heal) {
    expect(h.reach).toBeGreaterThanOrEqual(0.8 * h.rPx);
    expect(h.reach).toBeLessThanOrEqual(1.1 * h.rPx + 1);
  }
  // 白牙 acts on the teeth at decode resolution, and the lip guard keeps the lip ring 1–4 px outside the inner lip still
  expect(r.teethLifted).toBeGreaterThan(100);
  expect(r.lipRingMax).toBeLessThanOrEqual(2);
  expect(r.toneMoved).toBeGreaterThan(10_000);
});
