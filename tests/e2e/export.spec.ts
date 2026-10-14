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
    const lifted = ['601', 'θ', 'step 5 quarter'].some((p) => r.name.startsWith(p));
    expect(r.maxDiff, r.name).toBeLessThanOrEqual(lifted ? 2 : 1);
  }
});
