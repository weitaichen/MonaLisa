// The tiled full-resolution export must equal one untiled render of the same V (S §8.2): windows, aprons, the
// fullShortEdge kernels and the global-V grain / vignette make every tile seamless.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
/**
 * The tile cases granted crop spec §8.2's one accepted exception, by name: the 膠片 lift of a 1-LSB resample flip
 * under off-centre bilinear taps, measured at one pixel each on SwiftShader. Every other case holds the 1/255 contract
 * with no pixel above it, including the ones that have off-centre taps but no lifted pixel (quarter 1 + flip, step 5
 * θ 12° + crop, strokes + 90° turn; push-brush spec §8.3 test 9 promises 1/255 for the last).
 */
const LIFTED_CASES = ['θ 12° + crop', 'step 5 quarter 1 + flip', 'everything'];
/** the frame not divisible by 4: its ¼-res grids may reach 2/255 anywhere (S §4.4 grid note), with the same count bound */
const GRID_CASES = ['601×799 identity'];
/** the accepted 2/255 pixels of a LIFTED_CASES or GRID_CASES case: a handful, never a seam */
const MAX_LIFTED = 3;

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
  // the harness returns a summary of the pixels above 1/255 (count, nearest distance to a tile line, the few nearest),
  // so a regression that moves the whole frame fails these assertions instead of exhausting the worker's memory
  const over1Text = (r: (typeof res)[number]) =>
    `${r.over1Count}${r.over1MinLine === null ? '' : `, nearest a tile line ${r.over1MinLine} px`} [${r.over1Nearest.map((p) => `(${p.x}, ${p.y}) ${p.d}/255 ${p.line} px`).join(', ')}${r.over1Count > r.over1Nearest.length ? ', …' : ''}]`;
  for (const r of res) {
    console.log(`${r.name}: ${r.w}×${r.h}, ${r.tiles} tiles, max channel diff ${r.maxDiff}/255, glError ${r.glError}, apron ${r.apron} px; > 1/255: ${over1Text(r)}`);
  }
  for (const r of res) {
    expect(r.glError, r.name).toBe(0);
    expect(r.tiles, r.name).toBeGreaterThan(1);
    // The contract (roadmap §8.4, crop spec §8.2, face-detail spec §8.3 #9, push-brush spec §8.3 test 9) is 1/255, the
    // fp32 coordinate rounding of a pixel copy (S §1.3).
    const lifted = LIFTED_CASES.includes(r.name);
    if (!lifted && !GRID_CASES.includes(r.name)) {
      expect(r.maxDiff, `${r.name}: max channel diff; > 1/255: ${over1Text(r)}`).toBeLessThanOrEqual(1);
      continue;
    }
    // Crop spec §8.2's one accepted exception (LIFTED_CASES): under off-centre bilinear taps (θ 12°, a warped quarter
    // turn) that rounding flips B by 1 LSB all over, and the 膠片 curve with 顆粒's mid-tone weight lifts a rare one to
    // 2/255 (on SwiftShader: one channel of one interior pixel in θ 12° + crop, 30 px from the nearest tile line; step 5
    // quarter 1 + flip, 44 px; everything, the 0.4.0 release gate, 72 px; each ≤ 1/255 with the look off). A seam puts
    // its pixels on the tile lines; these are isolated and interior, so a case may have at most MAX_LIFTED of them, each
    // at least one apron from every tile line. GRID_CASES may reach 2/255 anywhere, with the same count bound.
    expect(r.maxDiff, `${r.name}: max channel diff; > 1/255: ${over1Text(r)}`).toBeLessThanOrEqual(2);
    expect(r.over1Count, `${r.name}: pixels above 1/255: ${over1Text(r)}`).toBeLessThanOrEqual(MAX_LIFTED);
    if (lifted && r.over1MinLine !== null) expect(r.over1MinLine, `${r.name}: a pixel above 1/255 within an apron of a tile line: ${over1Text(r)}`).toBeGreaterThanOrEqual(r.apron);
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
