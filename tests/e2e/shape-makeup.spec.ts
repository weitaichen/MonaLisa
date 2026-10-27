// v0.4 step 5 (face-detail spec §8.3): the new warps and 左右分開 against the CPU port, the procedural makeup against its
// CPU port and its regions, and the editor / camera flows.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { adapt } from '../../src/tracking/adapter111';
import {
  closeFallback,
  debugState,
  decodeDataUrl,
  dragSlider,
  expect,
  grab,
  GROUP_FACES,
  importFixture,
  mad,
  regionDiff,
  SAMPLE_FACE,
  selectPerson,
  test,
  type Pixels,
  type Rect,
} from './fixtures';

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

const maxDiff = (a: Pixels, b: Pixels, i: number) =>
  Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));

test('PMAKEUP: GPU == CPU port for every kind and blend mode (S5 §8.3 item 2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupPin === 'function');
  const cases = await page.evaluate(() => window.runMakeupPin!());
  expect(cases).toHaveLength(14);
  expect(new Set(cases.map((c) => c.mode))).toEqual(new Set([0, 1, 2]));
  for (const c of cases) {
    console.log(`${c.name} (mode ${c.mode}): ${c.n} px, max |GPU − CPU| = ${c.maxErr255.toFixed(2)}/255, ${c.changed} px changed`);
    expect(c.maxErr255, `${c.name}: ${JSON.stringify(c.samples.slice(0, 3))}`).toBeLessThanOrEqual(2);
    expect(c.changed, c.name).toBeGreaterThan(500);
    // draw() leaves no layer's blend factors behind: blending off, (ONE, ZERO) and FUNC_ADD, as heal.ts does
    expect(c.blendAfter, c.name).toEqual([0, 1, 0, 1, 0, 0x8006]);
  }
});

test('each part changes only its region; 美瞳 stays in iris ∩ aperture and keeps the catchlight (S5 §8.3 item 3)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupRegions === 'function');
  const r = await page.evaluate(() => window.runMakeupRegions!());
  const base = decodeDataUrl(r.base);
  for (const [part, p] of Object.entries(r.parts)) {
    const img = decodeDataUrl(p.png);
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const d = maxDiff(img, base, (y * r.width + x) * 4);
        const inBox = p.boxes.some((b) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]);
        if (inBox) inside = Math.max(inside, d);
        else outside = Math.max(outside, d);
      }
    console.log(`${part}: inside ${inside}, outside ${outside}, passes ${p.passes.join(' ')}`);
    expect(outside, part).toBeLessThanOrEqual(2);
    expect(inside, part).toBeGreaterThan(8);
    for (const l of p.layers) expect(p.passes, part).toContain(`mk.${l}`);
  }
  // 美瞳, on the source with a painted catchlight disc per iris (sample_face.png has no pixel above Y 0.88): every
  // changed pixel inside the iris disc × 1.12 and within 2 px of the aperture strip; every pixel with Y > 0.88 unchanged
  const litBase = decodeDataUrl(r.catchlight.base);
  const lens = decodeDataUrl(r.catchlight.lens);
  const inPoly = (poly: number[][], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const nearPoly = (poly: number[][], x: number, y: number, tol: number) =>
    inPoly(poly, x, y) ||
    poly.some((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)));
      return Math.hypot(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - y) <= tol;
    });
  // where 美瞳 draws at full strength but for catchl: the annulus 0.4–1 r, inside the aperture
  const inLensAnnulus = (x: number, y: number) =>
    r.eyes.some((e) => {
      const rho = Math.hypot(x - e.c[0], y - e.c[1]) / e.r;
      return rho >= 0.4 && rho <= 1 && inPoly(e.strip, x, y);
    });
  let changed = 0;
  let catchPx = 0;
  let catchInLens = 0;
  let catchWorst = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const d = maxDiff(lens, litBase, i);
      const Y = (0.2126 * litBase.data[i] + 0.7152 * litBase.data[i + 1] + 0.0722 * litBase.data[i + 2]) / 255;
      if (Y > 0.88) {
        catchPx++;
        catchWorst = Math.max(catchWorst, d);
        if (inLensAnnulus(x + 0.5, y + 0.5)) catchInLens++;
        expect(d, `catchlight ${x},${y}`).toBeLessThanOrEqual(2);
      }
      if (d <= 2) continue;
      changed++;
      const ok = r.eyes.some((e) => Math.hypot(x + 0.5 - e.c[0], y + 0.5 - e.c[1]) <= 1.12 * e.r && nearPoly(e.strip, x + 0.5, y + 0.5, 2));
      expect(ok, `美瞳 pixel ${x},${y}`).toBe(true);
    }
  console.log(`美瞳: ${changed} px changed; ${catchPx} catchlight px (${catchInLens} in the annulus ∩ aperture), worst ${catchWorst}/255`);
  expect(catchPx, 'the painted catchlight reaches Y > 0.88').toBeGreaterThan(50);
  expect(catchInLens, 'the catchlight lies where 美瞳 draws').toBeGreaterThan(30);
  expect(changed).toBeGreaterThan(100);
});

test('blink: 美瞳 and 睫毛 leave a closed-eye face unchanged; 眼影 still draws on the lid (S5 §8.3 item 4)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupBlink === 'function');
  const png = await page.evaluate(() => window.runMakeupBlink!());
  const base = decodeDataUrl(png.base);
  const worst = (name: string) => {
    const img = decodeDataUrl(png[name]);
    let m = 0;
    for (let i = 0; i < img.data.length; i += 4) m = Math.max(m, maxDiff(img, base, i));
    return m;
  };
  expect(worst('lens')).toBe(0);
  expect(worst('lashes')).toBe(0);
  expect(worst('eyeshadow')).toBeGreaterThan(8);
});

test('a lashes.png that fails to load: ready still settles, only 睫毛 is skipped (S5 §4.10, §7; Review Focus 5)', async ({ page, guard }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupLashesFail === 'function');
  const r = await page.evaluate(() => window.runMakeupLashesFail!());
  expect(r.settled, 'MakeupPass.ready settles').toBe(true);
  expect(r.meshReady, '口紅 / 腮紅 textures still load').toBe(true);
  expect(r.compiled).toBe(true);
  expect(r.layers).toContain('shadow');
  expect(r.layers).not.toContain('lashes');
  // the makeup pass logs the failed load by design (makeup.ts): that line, and the browser's own line for the failed
  // request, are the only console errors this case allows; the shared guard still checks everything else
  const expected = (t: string) => /lashes\.png failed to load; 睫毛 disabled|Failed to load resource/.test(t);
  await expect.poll(() => guard.consoleErrors.some((t) => /lashes\.png failed to load/.test(t)), 'the failure path ran').toBe(true);
  guard.consoleErrors = guard.consoleErrors.filter((t) => !expected(t));
});

test('a lashes.png that never answers does not hold back 口紅: the GPUPixel meshes draw once their own textures load', async ({ page }) => {
  // held, never fulfilled: only the page's close releases it
  await page.route('**/makeup/own/lashes.png', () => undefined);
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupLashesHung === 'function');
  const r = await page.evaluate(() => window.runMakeupLashesHung!());
  console.log(`口紅 drew after ${r.ms} ms; engine.ready settled: ${r.settled}; passes ${r.passes.join(',')}`);
  expect(r.settled, 'engine.ready still waits for lashes.png (the still-render wait)').toBe(false);
  expect(r.passes).toContain('makeup');
});

test('procedural makeup survives a lost and restored WebGL context (S5 §7; Review Focus 2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupContextLoss === 'function');
  const r = await page.evaluate(() => window.runMakeupContextLoss!());
  expect(r.restored, 'the engine left the lost state').toBe(true);
  const worst = (a: Pixels, b: Pixels) => {
    let m = 0;
    for (let i = 0; i < a.data.length; i += 4) m = Math.max(m, maxDiff(a, b, i));
    return m;
  };
  const before = decodeDataUrl(r.before);
  // 眼影 + 睫毛: the PMAKEUP program, its VBO and the lashes texture all come back; 睫毛 itself draws (not vacuous)
  const lashes = worst(before, decodeDataUrl(r.noLashes));
  const restore = worst(before, decodeDataUrl(r.after));
  console.log(`context loss: 睫毛 changes ${lashes}/255; before vs after ${restore}/255`);
  expect(lashes, '睫毛 draws before the loss').toBeGreaterThan(8);
  expect(restore).toBeLessThanOrEqual(1);
});

test('contact sheet @sheet', async ({ page }) => {
  test.skip(!process.env.SHEET, 'run with SHEET=1 and --grep @sheet to write test-results/makeup-sheet/ (not asserted, not committed)');
  test.setTimeout(600_000);
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupSheet === 'function');
  const sheet = await page.evaluate(() => window.runMakeupSheet!());
  const dir = resolve(import.meta.dirname, '../../test-results/makeup-sheet');
  mkdirSync(dir, { recursive: true });
  for (const s of sheet) writeFileSync(resolve(dir, `${s.name}.png`), Buffer.from(s.png.slice(s.png.indexOf(',') + 1), 'base64'));
  console.log(`contact sheet: ${sheet.length} images in ${dir}`);
});

/** lossless exports, at the working size, so pixel regions compare exactly */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ exportFormat: 'png', exportSize: 'standard' })));
});

/** step 3's exportFile flow (the 儲存 pill; a slow export's second tap shares, S3 §4.6), returning the exported pixels */
async function exportPng(page: Page): Promise<Pixels> {
  await page.locator('.topbar .pill').click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  const shareAgain = page.locator('.topbar .pill', { hasText: '分享' });
  await expect(fallback.or(shareAgain)).toBeVisible({ timeout: 300_000 });
  if (!(await fallback.isVisible())) await shareAgain.click();
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await closeFallback(page);
  return decodeDataUrl(url);
}

const lm = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
const P = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height).pts111;
const patch = (i: number): Rect => ({ x: Math.round(P[i * 2] * lm.width) - 15, y: Math.round(P[i * 2 + 1] * lm.height) - 15, w: 30, h: 30 });
const meanPatch = (a: Pixels, b: Pixels, ids: number[]) => ids.reduce((s, i) => s + mad(a, b, patch(i)), 0) / ids.length;
/** face B of group_faces.png from the fixture's landmarks: the middle face by nose tip (p46) x */
const glm = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/group_faces.landmarks.json'), 'utf8')) as { width: number; height: number; faces: number[][] };
const PB = glm.faces.map((f) => adapt({ points: new Float32Array(f) }, glm.width, glm.height).pts111).sort((a, b) => a[46 * 2] - b[46 * 2])[1];
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
/** a strip item by its label; a split item's accessible name may carry its 「左右」 badge while 左右分開 is on */
const optionNamed = (page: Page, name: string) => page.getByRole('option', { name: new RegExp(`^${name}(\\s*左右)?$`) });
const option = (page: Page, name: string) => optionNamed(page, name).click();
/** the debug face boxes left to right (the cache order is MediaPipe's; persons are numbered left to right) */
const boxesLtr = async (page: Page) => [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x);
/** how far the change b0 → b1 is from the change a0 → a1 inside r (fractions of the image): Σ|Δa − Δb| / Σ|Δa| */
const changeErr = (a0: Pixels, a1: Pixels, b0: Pixels, b1: Pixels, r: Rect) => {
  const x0 = Math.round(r.x * a0.width);
  const y0 = Math.round(r.y * a0.height);
  const x1 = x0 + Math.round(r.w * a0.width);
  const y1 = y0 + Math.round(r.h * a0.height);
  let off = 0;
  let sum = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      for (let c = 0, i = (y * a0.width + x) * 4; c < 3; c++, i++) {
        const da = a1.data[i] - a0.data[i];
        off += Math.abs(da - (b1.data[i] - b0.data[i]));
        sum += Math.abs(da);
      }
  return off / sum;
};

test('左右分開: 左 moves only the screen-left cheek; 翻轉 swaps the chips; ↶ of the toggle restores one value (S5 §8.3 item 5)', async ({ page }) => {
  await importFixture(page, SAMPLE_FACE);
  await tab(page, '美型');
  await option(page, '瘦臉');
  await dragSlider(page, -400);
  const both0 = await exportPng(page);
  await option(page, '左右分開');
  await expect(page.getByText('已開啟左右分開：左、右以螢幕上看到的方向為準')).toBeVisible();
  const chips = page.getByRole('radiogroup', { name: '瘦臉：左右' });
  await expect(chips).toBeVisible();
  await expect(chips.getByRole('radio', { name: '左' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.item', { hasText: '瘦臉' }).getByText('左右')).toBeVisible();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider', { name: '瘦臉（左）' })).toHaveAttribute('aria-valuenow', '100');
  const left100 = await exportPng(page);
  const left = meanPatch(both0, left100, [3, 7, 10]);
  const right = meanPatch(both0, left100, [29, 25, 22]);
  console.log(`左右分開: screen-left cheek ${left.toFixed(2)}, screen-right ${right.toFixed(2)}`);
  expect(left).toBeGreaterThan(2);
  expect(right).toBeLessThan(0.25 * left);

  // 翻轉: stored values stay, labels follow the screen
  await tab(page, '裁切');
  await option(page, '翻轉');
  await tab(page, '美型');
  await option(page, '瘦臉');
  await expect(page.getByRole('slider', { name: '瘦臉（左）' })).toHaveAttribute('aria-valuenow', '0');
  await chips.getByRole('radio', { name: '右' }).click();
  await expect(page.getByRole('slider', { name: '瘦臉（右）' })).toHaveAttribute('aria-valuenow', '100');

  // ↶ flip, ↶ drag, ↶ toggle: one value again, no chips, no badges
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '復原' }).click();
  await option(page, '瘦臉');
  await expect(page.getByRole('radiogroup', { name: '瘦臉：左右' })).toHaveCount(0);
  await expect(page.locator('.item', { hasText: '瘦臉' }).getByText('左右')).toHaveCount(0);
});

test('左右分開 on the mirrored face B of group_faces.png still moves its screen-left cheek', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  await selectPerson(page, 2);
  await tab(page, '美型');
  await option(page, '瘦臉');
  const before = await exportPng(page);
  await option(page, '左右分開');
  await dragSlider(page, 400);
  const after = await exportPng(page);
  // the cheek contour patches, as on sample_face.png (20 px: B is about 200 px wide); 左 is the side whose eye has the
  // smaller screen x (S5 §2.2). Not the halves of B's box: they also take in the nose, mouth and chin, which a one-sided
  // 瘦臉 moves too (the chin anchor is shared, SLIM_SIDE .5), and B's nose lies right of its box centre
  const leftEye = PB[74 * 2] < PB[77 * 2];
  const patchB = (i: number): Rect => ({ x: Math.round(PB[i * 2] * after.width) - 10, y: Math.round(PB[i * 2 + 1] * after.height) - 10, w: 20, h: 20 });
  const meanB = (ids: number[]) => ids.reduce((s, i) => s + mad(before, after, patchB(i)), 0) / ids.length;
  const l = meanB(leftEye ? [3, 7, 10] : [29, 25, 22]);
  const r = meanB(leftEye ? [29, 25, 22] : [3, 7, 10]);
  console.log(`face B: screen-left cheek ${l.toFixed(2)}, screen-right ${r.toFixed(2)}`);
  expect(l).toBeGreaterThan(2);
  expect(l).toBeGreaterThan(3 * r);
});

test('per person: 眼影 on person 2 only, 眉毛 under 全部 on everyone; reopen restores them with no detection (S5 §8.3 item 6)', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  const base = await exportPng(page);
  const boxes = await boxesLtr(page); // [A, B, C] = persons 1, 2, 3
  await selectPerson(page, 2);
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眼影');
  await option(page, '大地');
  await tab(page, '美型');
  await option(page, '左右分開');
  const shadow = await exportPng(page);
  /** a face box padded by 15 % on each side, in fractions of the image (regionDiff's unit) */
  const padded = (k: number): Rect => {
    const b = boxes[k];
    return { x: b.x - 0.15 * b.w, y: b.y - 0.15 * b.h, w: 1.3 * b.w, h: 1.3 * b.h };
  };
  const onB = regionDiff(base, shadow, padded(1));
  console.log(`眼影 on person 2: inside ${onB.inside.toFixed(3)}, outside max ${onB.outsideMax}`);
  expect(onB.outsideMax, '眼影 on person 2 changes nothing outside face B').toBeLessThanOrEqual(2);
  // the lids of a 200 px face at the pick default 0.45, averaged over the padded box: measured 0.10
  expect(onB.inside).toBeGreaterThan(0.05);

  await selectPerson(page, 0); // 全部
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眉毛');
  await option(page, '自然黑');
  const brows = await exportPng(page);
  for (const k of [0, 1, 2]) {
    const d = regionDiff(shadow, brows, padded(k)).inside;
    console.log(`眉毛 under 全部: face ${k + 1} inside ${d.toFixed(3)}`);
    expect(d, `face ${k + 1}`).toBeGreaterThan(0.1);
  }

  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(calls);
  await selectPerson(page, 2);
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眼影');
  await expect(optionNamed(page, '大地')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '美型');
  await option(page, '瘦臉');
  await expect(page.getByRole('radiogroup', { name: '瘦臉：左右' })).toBeVisible();
  await selectPerson(page, 0);
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眉毛');
  await expect(optionNamed(page, '自然黑')).toHaveAttribute('aria-selected', 'true');
  const reopened = await exportPng(page);
  // 最近編輯 keeps the original as a JPEG (q 0.9, adjust.spec.ts), so the reopened photo is not the imported PNG and
  // `reopened` is not `brows` (mean ≈ 0.6 apart): compare the makeup itself, i.e. what 卸妝 under 全部 takes off the
  // reopened edit against what 眼影 and 眉毛 put on before closing, pixel by pixel, face by face. Measured: 11–15 % off
  // (the JPEG under the multiply); a lost 眼影 on face 2 would be 26 % off, a lost 眉毛 75–100 %
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '卸妝');
  const bare = await exportPng(page);
  for (const k of [0, 1, 2]) {
    const err = changeErr(base, brows, bare, reopened, padded(k));
    console.log(`reopen: face ${k + 1} makeup change off by ${(100 * err).toFixed(1)} %`);
    expect(err, `face ${k + 1}`).toBeLessThan(0.2);
  }
});

test('美妝 flow in the editor: part list, 眼影 大地, ↶, 卸妝 (S5 §8.3 item 7)', async ({ page }) => {
  await importFixture(page, SAMPLE_FACE);
  await tab(page, '美妝');
  const lead = page.getByRole('button', { name: '切換部位（目前：口紅）' });
  await expect(lead).toBeVisible();
  await expect(page.getByRole('option', { name: '原色', exact: true })).toBeVisible();
  await lead.click();
  for (const p of ['口紅', '腮紅', '眉毛', '眼影', '眼線', '睫毛', '臥蠶', '修容', '高光', '美瞳']) await expect(page.getByRole('option', { name: p, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '卸妝', exact: true })).toBeVisible();
  await option(page, '眼影');
  await option(page, '大地');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-label', '眼影');
  await expect(page.getByRole('option', { name: '大地', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '復原' }).click();
  await expect(page.getByRole('option', { name: '無', exact: true })).toHaveAttribute('aria-selected', 'true');
  await option(page, '大地');
  await page.getByRole('button', { name: '切換部位（目前：眼影）' }).click();
  await option(page, '睫毛');
  await option(page, '自然');
  await page.getByRole('button', { name: '切換部位（目前：睫毛）' }).click();
  await expect(page.locator('.item.has-value', { hasText: '眼影' })).toHaveCount(1);
  await option(page, '卸妝');
  await expect(page.locator('.item.has-value')).toHaveCount(0);
});

test('美妝 and 左右分開 in the camera (S5 §2.5, §8.3 item 7)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const frame = page.locator('.cam-stage .frame');
  // the look this check was tuned on: 自然, which the camera started with until it started at 原圖 on a fresh install
  // (2026-10-18). 美瞳 冰藍 moves the eye band by ≈ 1.9 over 自然 and by ≈ 0.6 over 原圖 (measured), too close to the
  // 0.5 floor
  await tab(page, '一鍵');
  await option(page, '自然');
  await expect(optionNamed(page, '自然')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(500);
  await tab(page, '美妝');
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);
  // the face's eye band in the screenshot: the unmirrored video box, mirrored for the front camera, through `cover`
  const box = (await debugState(page)).boxes[0];
  const v = await page.evaluate(() => {
    const el = document.querySelector('video')!;
    return { w: el.videoWidth, h: el.videoHeight };
  });
  const fb = (await frame.boundingBox())!;
  const s = Math.max(fb.width / v.w, fb.height / v.h);
  const ox = (fb.width - v.w * s) / 2;
  const oy = (fb.height - v.h * s) / 2;
  const dpr = a1.width / fb.width;
  const u0 = 1 - (box.x + box.w);
  const band: Rect = {
    x: Math.round((ox + u0 * v.w * s) * dpr),
    y: Math.round((oy + (box.y + 0.25 * box.h) * v.h * s) * dpr),
    w: Math.round(box.w * v.w * s * dpr),
    h: Math.round(0.25 * box.h * v.h * s * dpr),
  };
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '美瞳');
  await option(page, '冰藍');
  await page.waitForTimeout(800);
  const b = await grab(frame);
  const change = mad(a1, b, band);
  console.log(`camera 美瞳: eye band change ${change.toFixed(2)}, jitter ${jitter.toFixed(2)}`);
  expect(change).toBeGreaterThan(Math.max(0.5, 4 * jitter));

  await tab(page, '美型');
  await option(page, '左右分開');
  await option(page, '大眼');
  const chips = page.getByRole('radiogroup', { name: '大眼：左右' });
  await expect(chips).toBeVisible();
  await chips.getByRole('radio', { name: '右' }).click();
  await expect(chips.getByRole('radio', { name: '右' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.panel.collapsed')).toHaveCount(0);
});
