// v0.4 step 5 (face-detail spec §8.3): the new warps and 左右分開 against the CPU port, the procedural makeup against its
// CPU port and its regions, and the editor / camera flows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDataUrl, expect, test, type Pixels } from './fixtures';

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
  // 美瞳: every changed pixel inside the iris disc × 1.12 and within 2 px of the aperture strip; catchlight unchanged
  const lens = decodeDataUrl(r.parts.lens.png);
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
  let changed = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const d = maxDiff(lens, base, i);
      const Y = (0.2126 * base.data[i] + 0.7152 * base.data[i + 1] + 0.0722 * base.data[i + 2]) / 255;
      if (Y > 0.88) expect(d, `catchlight ${x},${y}`).toBeLessThanOrEqual(2);
      if (d <= 2) continue;
      changed++;
      const ok = r.eyes.some((e) => Math.hypot(x + 0.5 - e.c[0], y + 0.5 - e.c[1]) <= 1.12 * e.r && nearPoly(e.strip, x + 0.5, y + 0.5, 2));
      expect(ok, `美瞳 pixel ${x},${y}`).toBe(true);
    }
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

test('procedural makeup survives a lost and restored WebGL context (S5 §7; Review Focus 2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupContextLoss === 'function');
  const r = await page.evaluate(() => window.runMakeupContextLoss!());
  expect(r.restored, 'the engine left the lost state').toBe(true);
  const a = decodeDataUrl(r.before);
  const b = decodeDataUrl(r.after);
  let m = 0;
  for (let i = 0; i < a.data.length; i += 4) m = Math.max(m, maxDiff(a, b, i));
  expect(m).toBeLessThanOrEqual(1);
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
