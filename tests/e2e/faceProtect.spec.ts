// 瘦臉 background limit (reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②): the face contour warps (瘦臉 / V臉 / 窄臉 / 下巴 /
// 額頭) are bounded by a person mask, so the wall beside a cheek no longer swims.
//  1. dev page: RESHAPE_FS with the limit == the CPU port (reshapeCpu.ts); eye / nose / mouth pixels and a neutral-
//     contour frame are bit-identical with and without it; the real engine on the synthetic cheek-against-a-wall
//     portrait moves the wall beside the cheek less and the wall farther out not at all.
//  2. app: a real portrait standing against a striped wall (sample_face with everything outside the face oval
//     replaced by the wall) imported into the editor, 瘦臉 + V臉 + 窄臉 at max. Once with the segmenter model blocked
//     (the editor falls back to today's unlimited warp: also the "never break the editor" path) and once normally (the
//     selfie segmenter loads on demand, once, and only after the first contour drag): the wall beside the cheek moves less with the limit, the far wall not
//     at all, the eyes / nose / mouth are identical, and at neutral contour sliders both renders are identical.
//  3. persisted with the edit: the 自然 default alone (import, autosave, reopen) never requests the segmenter; a 瘦臉
//     drag (no 美體) autosaves the limit with its mask, and a reopen from 最近編輯 on a fresh page exports the same
//     limited photo with no segmenter model / chunk request; a contour edit flushed by ✕ while the WebGL context is lost
//     (no thumbnail) still records the request.
import { readFileSync } from 'node:fs';
import { test as bare, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { adapt } from '../../src/tracking/adapter111';
import { debugState, decodePng, dragSlider, expect, grab, SAMPLE_FACE, settled, shot, test, type Pixels, type Rect } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
const SEGMENTER = /\/models\/image_segmenter\//;

// the blocked-model run needs page.route to see the model request: no service worker in between
test.use({ serviceWorkers: 'block' });
bare.use({ serviceWorkers: 'block' });

test('face protect: GPU == CPU port, features and neutral frames untouched, the wall moves less (engine)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/faceProtect.html`);
  await page.waitForFunction(() => typeof window.runFaceProtectPin === 'function');
  const pin = await page.evaluate(() => window.runFaceProtectPin!());
  expect(pin.pins).toHaveLength(3);
  for (const c of pin.pins) {
    console.log(
      `${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, ${c.limited} limited, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px; ` +
        `feature px ${c.featurePx}, changed ${c.featureDiff}`,
    );
    expect(c.n, c.name).toBeGreaterThan(30_000);
    expect(c.moved, c.name).toBeGreaterThan(1_000);
    expect(c.maxErrPx, c.name).toBeLessThan(0.05);
    if (!c.name.includes('body')) {
      expect(c.featurePx, c.name).toBeGreaterThan(200);
      expect(c.featureDiff, `${c.name}: eye / nose / mouth pixels the limit changed`).toBe(0);
    }
  }
  // the limit acts on the cheek-against-a-wall portrait (not vacuous)
  expect(pin.pins[0].limited).toBeGreaterThan(1_000);
  console.log(`neutral contour (nose / mouth / eyes at max): ${pin.neutralDiff} of ${pin.neutralPx} px differ`);
  expect(pin.neutralDiff).toBe(0);

  const eng = await page.evaluate(() => window.runFaceProtectEngine!());
  console.log(
    `engine: wall 0.2–0.38 FW out mad ${eng.wallMadFree.toFixed(2)} → ${eng.wallMadLimited.toFixed(2)}, ` +
      `wall 0.38–0.45 FW out max ${eng.farMaxFree} → ${eng.farMaxLimited}, neutral max ${eng.neutralMaxDiff}, ` +
      `gl errors ${eng.glErrors.join(',')}, passes ${eng.passes.join(',')}`,
  );
  expect(eng.glErrors.every((e) => e === 0)).toBe(true);
  expect(eng.passes).toContain('reshape');
  expect(eng.wallMadFree).toBeGreaterThan(1);
  // the cheek itself still moves the nearest wall about as much (Δ⊥): the limit acts from a short way out
  expect(eng.wallMadLimited).toBeLessThan(0.75 * eng.wallMadFree);
  expect(eng.farMaxFree).toBeGreaterThan(10);
  expect(eng.farMaxLimited).toBe(0);
  expect(eng.neutralMaxDiff).toBe(0);
});

// ───────────────────────── app ─────────────────────────

type V2 = [number, number];
const landmarks = JSON.parse(readFileSync(new URL('../fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const face = adapt({ points: new Float32Array(landmarks.points) }, landmarks.width, landmarks.height);
const P = face.pts111;
const pt = (i: number): V2 => [P[i * 2], P[i * 2 + 1]];
/** face width in px of the 1000×1500 photo */
const FW = Math.hypot((P[0] - P[64]) * landmarks.width, (P[1] - P[65]) * landmarks.height);

function inOval(u: number, v: number): boolean {
  const o = face.oval;
  const n = o.length / 2;
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (o[i * 2 + 1] > v !== o[j * 2 + 1] > v && u < ((o[j * 2] - o[i * 2]) * (v - o[i * 2 + 1])) / (o[j * 2 + 1] - o[i * 2 + 1]) + o[i * 2]) {
      c = !c;
    }
  }
  return c;
}

/**
 * sample_face with everything outside the face oval and a neck-and-shoulders silhouette below the chin replaced by a
 * blue-grey wall with dark lines: a short-haired portrait against a wall (the selfie segmenter reads it cleanly; a
 * floating head on a skin-toned wall it does not)
 */
function wallPortrait(): Buffer {
  const png = PNG.sync.read(readFileSync(SAMPLE_FACE));
  const { width: w, height: h } = png;
  const chin = pt(16);
  const neckHalf = 0.2 * (FW / w);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const body = v > chin[1] - 0.05 && Math.abs(u - chin[0]) < neckHalf + Math.max(0, v - chin[1] - 0.06) * 3;
      if (inOval(u, v) || body) continue;
      const i = (y * w + x) * 4;
      const c = x % 40 < 6 || y % 90 < 5 ? [40, 45, 60] : [150, 168, 190];
      png.data.set([c[0], c[1], c[2], 255], i);
    }
  return PNG.sync.write(png);
}

/** pixel rect of the frame grab from photo-UV bounds */
function uvRect(p: Pixels, u0: number, v0: number, u1: number, v1: number): Rect {
  const x = Math.round(Math.min(u0, u1) * p.width);
  const y = Math.round(Math.min(v0, v1) * p.height);
  return { x, y, w: Math.max(1, Math.round(Math.abs(u1 - u0) * p.width)), h: Math.max(1, Math.round(Math.abs(v1 - v0) * p.height)) };
}

/** mean and max |ΔRGB| inside rects */
function diff(a: Pixels, b: Pixels, rects: Rect[]): { mad: number; max: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let s = 0;
  let n = 0;
  let m = 0;
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * a.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(a.data[i + c] - b.data[i + c]);
          s += d;
          m = Math.max(m, d);
          n++;
        }
      }
  return { mad: s / Math.max(1, n), max: m };
}

const fwU = FW / landmarks.width;
const fwV = FW / landmarks.height;
/** wall beside the cheeks: d0..d1 face widths outside contour points 7 / 25, ±0.12 FW high */
function wallRects(p: Pixels, d0: number, d1: number): Rect[] {
  const [l, r] = [pt(7), pt(25)];
  return [
    uvRect(p, l[0] - d1 * fwU, l[1] - 0.12 * fwV, l[0] - d0 * fwU, l[1] + 0.12 * fwV),
    uvRect(p, r[0] + d0 * fwU, r[1] - 0.12 * fwV, r[0] + d1 * fwU, r[1] + 0.12 * fwV),
  ];
}
/** max |ΔRGB| inside the eye / nose / lip outlines (MediaPipe indices), shrunk by 3 px: the frame grab is the canvas
 * scaled by CSS, so a pixel on an outline also shows its neighbour */
function featureDiff(a: Pixels, b: Pixels): { eyesNose: number; lips: number; px: number } {
  const outlines = [
    [33, 160, 158, 133, 153, 144],
    [362, 385, 387, 263, 373, 380],
    [168, 193, 98, 2, 327, 417],
    [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  ].map((ids) => ids.map((i): V2 => [landmarks.points[i * 3] * a.width, landmarks.points[i * 3 + 1] * a.height]));
  const maxes: number[] = [];
  let px = 0;
  for (const poly of outlines) {
    let max = 0;
    const c = poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length], [0, 0]);
    const shrunk = poly.map((q): V2 => {
      const d = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
      const k = Math.max(0, d - 3) / d;
      return [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k];
    });
    const xs = shrunk.map((q) => q[0]);
    const ys = shrunk.map((q) => q[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        let inside = false;
        for (let i = 0, j = shrunk.length - 1; i < shrunk.length; j = i++) {
          const [xi, yi] = shrunk[i];
          const [xj, yj] = shrunk[j];
          if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (!inside) continue;
        px++;
        const i = (y * a.width + x) * 4;
        for (let ch = 0; ch < 3; ch++) max = Math.max(max, Math.abs(a.data[i + ch] - b.data[i + ch]));
      }
    maxes.push(max);
  }
  return { eyesNose: Math.max(maxes[0], maxes[1], maxes[2]), lips: maxes[3], px };
}

interface Run {
  neutral: Pixels;
  max: Pixels;
  segmenterRequests: number;
  glMessages: string[];
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BENIGN = /^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/;

async function editorRun(page: Page, tag: string, blocked: boolean): Promise<Run> {
  // fixtures.ts's guard, minus the one console line a blocked request prints by design
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' || BENIGN.test(m.text())) return;
    if (blocked && /Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol !== 'data:' && u.protocol !== 'blob:' && !LOCAL_HOSTS.has(u.hostname)) foreign.push(r.url());
  });
  let segmenterRequests = 0;
  page.on('request', (r) => {
    if (SEGMENTER.test(new URL(r.url()).pathname)) segmenterRequests++;
  });
  const glMessages: string[] = [];
  page.on('console', (m) => {
    if (/GL_INVALID|GL_OUT_OF_MEMORY|WebGL: /.test(m.text())) glMessages.push(m.text());
  });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'wall_portrait.png', mimeType: 'image/png', buffer: wallPortrait() });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  const option = (name: string) => page.getByRole('option', { name, exact: true });
  // 自然 (the default) already draws 瘦臉 / V臉, but only the user's own contour slider edit may load the segmenter
  // (K2: no model download and no warp changing by itself after a mere import)
  await page.waitForTimeout(2500);
  expect(segmenterRequests, `${tag}: no segmenter request before a contour slider is touched`).toBe(0);

  const frame = page.locator('.editor-stage .frame');
  await tab('一鍵').click();
  await option('原圖').click();
  const neutral = await settled(frame);
  await tab('美型').click();
  for (const name of ['瘦臉', 'V臉', '窄臉']) {
    await option(name).click();
    await expect(option(name)).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(250);
    await dragSlider(page, 400);
    await expect(page.locator('.slider-row [role="slider"]')).toHaveAttribute('aria-valuenow', '100');
    // the first contour drag asks for the segmenter
    if (name === '瘦臉') await expect.poll(() => segmenterRequests, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    // the before / after review frame: 瘦臉 + V臉 at max
    if (name === 'V臉') {
      await page.waitForTimeout(1500);
      await settled(frame);
      await grab(frame, `fp-${tag}-slim-v-max`);
    }
  }
  // the segmentation (when it runs) lands asynchronously: give it time, then wait for the frame to settle
  await page.waitForTimeout(1500);
  const max = await settled(frame);
  await grab(frame, `fp-${tag}-max`);
  await shot(page, `fp-${tag}-editor`);
  expect(errors, `${tag}: console errors`).toEqual([]);
  expect(foreign, `${tag}: requests to non-localhost origins`).toEqual([]);
  return { neutral, max, segmenterRequests, glMessages };
}

// (the shared guard would fail the blocked run on the browser's own "Failed to load resource" line: editorRun guards)
bare('face protect in the editor: a portrait against a wall, with the segmenter blocked vs on demand', async ({ page, context }) => {
  bare.setTimeout(300_000);
  // today's warp: the model request fails, the editor keeps the unlimited contour warps
  await page.route(SEGMENTER, (r) => r.abort());
  const free = await editorRun(page, 'free', true);
  await page.unroute(SEGMENTER);

  const page2 = await context.newPage();
  const lim = await editorRun(page2, 'limited', false);

  const near = (p: Pixels) => wallRects(p, 0.02, 0.15);
  const far = (p: Pixels) => wallRects(p, 0.34, 0.45);
  const nearFree = diff(free.neutral, free.max, near(free.max));
  const nearLim = diff(lim.neutral, lim.max, near(lim.max));
  const farFree = diff(free.neutral, free.max, far(free.max));
  const farLim = diff(lim.neutral, lim.max, far(lim.max));
  const feats = featureDiff(free.max, lim.max);
  const neutralSame = diff(free.neutral, lim.neutral, [{ x: 0, y: 0, w: lim.neutral.width, h: lim.neutral.height }]);
  console.log(
    `app: wall 0.02–0.15 FW beside the cheek mad ${nearFree.mad.toFixed(2)} → ${nearLim.mad.toFixed(2)}; ` +
      `0.34–0.45 FW max ${farFree.max} → ${farLim.max}; eyes+nose / lips max |Δ| ${feats.eyesNose} / ${feats.lips} over ${feats.px} px; neutral frames max |Δ| ${neutralSame.max}; ` +
      `segmenter requests ${free.segmenterRequests} (blocked) / ${lim.segmenterRequests}`,
  );
  expect(lim.segmenterRequests, 'one segmenter model download per session').toBe(1);
  expect(nearFree.mad, 'the unlimited 瘦臉 moves the wall (the comparison is not vacuous)').toBeGreaterThan(1);
  expect(nearLim.mad).toBeLessThan(0.95 * nearFree.mad);
  expect(farFree.max).toBeGreaterThan(10);
  expect(farLim.max).toBeLessThanOrEqual(2);
  expect(feats.px).toBeGreaterThan(5_000);
  expect(feats.eyesNose, 'eyes / nose identical with and without the limit').toBe(0);
  // this face is turned: its far mouth corner sits close to the cheek line against the wall, where the budget can start
  // to bind at max 瘦臉 + V臉 + 窄臉 (the exact identity is checked on the GPU in the first test)
  expect(feats.lips, 'lips identical with and without the limit (±1 level at the far corner)').toBeLessThanOrEqual(1);
  expect(neutralSame.max, 'neutral contour sliders: identical with and without the limit').toBe(0);
  expect([...free.glMessages, ...lim.glMessages], 'GL errors').toEqual([]);
  await page2.close();
});

// ───────────────────────── persisted with the edit (HistoryEntry.faceProtect / faceMask) ─────────────────────────

/** the lazily imported segmenter chunk (what ensureFaceSegmenter loads after the model) */
const SEGMENTER_CHUNK = /\/assets\/segmenter-[^/]*\.js$/;

interface EntryInfo {
  faceProtect: boolean;
  /** the saved segmenter mask's size, absent when none */
  mask?: [number, number];
}

/** 最近編輯 as stored (IndexedDB meiyan / edits), read without creating the database before the app does */
async function entries(page: Page): Promise<EntryInfo[]> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'meiyan')) return [];
    return new Promise<EntryInfo[]>((resolve, reject) => {
      const open = indexedDB.open('meiyan');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('edits')) {
          db.close();
          return resolve([]);
        }
        const all = db.transaction('edits', 'readonly').objectStore('edits').getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => {
          db.close();
          resolve(
            (all.result as { faceProtect?: boolean; faceMask?: { width: number; height: number } }[]).map((e) => ({
              faceProtect: e.faceProtect === true,
              ...(e.faceMask ? { mask: [e.faceMask.width, e.faceMask.height] as [number, number] } : {}),
            })),
          );
        };
      };
    });
  });
}

/** 儲存 → the long-press fallback's full-resolution JPEG, decoded (losslessly re-encoded as PNG) in the page */
async function saveExport(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dlg = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  const img = dlg.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const png = await img.evaluate(async (i: HTMLImageElement) => {
    await i.decode();
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await dlg.getByRole('button', { name: '關閉' }).click();
  await expect(dlg).toHaveCount(0);
  return decodePng(Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
}

async function importWallPortrait(page: Page): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'wall_portrait.png', mimeType: 'image/png', buffer: wallPortrait() });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}

async function closeAndReopen(page: Page): Promise<void> {
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  // a fresh page: no segmenter instance, no model memo (whatever the reopen needs, it would fetch again)
  await page.reload();
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await debugState(page)).face).toBe(true);
}

function countSegmenter(page: Page): { model: number; chunk: number } {
  const n = { model: 0, chunk: 0 };
  page.context().on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (SEGMENTER.test(path)) n.model++;
    if (SEGMENTER_CHUNK.test(path)) n.chunk++;
  });
  return n;
}

test('face protect: the 自然 default alone, autosaved and reopened, never requests the segmenter', async ({ page }) => {
  test.setTimeout(240_000);
  const seg = countSegmenter(page);
  await importWallPortrait(page);
  // the default (瘦臉 / V臉 on) autosaves unlimited: no flag, no mask
  await expect.poll(() => entries(page), { timeout: 30_000 }).toEqual([{ faceProtect: false }]);
  await page.waitForTimeout(2500);
  expect(seg, 'no segmenter request on import').toEqual({ model: 0, chunk: 0 });
  await closeAndReopen(page);
  await page.waitForTimeout(2500);
  await settled(page.locator('.editor-stage .frame'));
  expect(await entries(page)).toEqual([{ faceProtect: false }]);
  expect(seg, 'no segmenter request on reopening an entry saved unlimited').toEqual({ model: 0, chunk: 0 });
});

test('face protect: persisted with the edit, a reopen exports the same limited photo without the segmenter', async ({ page }) => {
  test.setTimeout(300_000);
  const seg = countSegmenter(page);
  await importWallPortrait(page);
  // 瘦臉 (no 美體 run): the contour drag requests the limit, the segmenter loads once
  const slim = page.getByRole('option', { name: '瘦臉', exact: true });
  await page.getByRole('tab', { name: '美型', exact: true }).click();
  await slim.click();
  await expect(slim).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(250);
  await dragSlider(page, 400);
  await expect(page.locator('.slider-row [role="slider"]')).toHaveAttribute('aria-valuenow', '100');
  // the limit landed and was autosaved with its mask
  const limited = [{ faceProtect: true, mask: [expect.any(Number), expect.any(Number)] }];
  await expect.poll(() => entries(page), { timeout: 60_000 }).toEqual(limited);
  expect(seg.model, 'one segmenter model download').toBe(1);
  await settled(page.locator('.editor-stage .frame'));
  const first = await saveExport(page);
  const loaded = { ...seg };

  // reopen from 最近編輯 (fresh page), 儲存 without editing: the saved limit, rebuilt from the saved mask
  await page.route(SEGMENTER, (r) => r.abort()); // were the model needed, the limit could not come back
  await closeAndReopen(page);
  await settled(page.locator('.editor-stage .frame'));
  const again = await saveExport(page);
  await page.waitForTimeout(1500);
  expect(seg, 'no segmenter model / chunk request after reopening').toEqual(loaded);
  expect(await entries(page)).toEqual(limited);

  expect([again.width, again.height]).toEqual([first.width, first.height]);
  const all = diff(first, again, [{ x: 0, y: 0, w: first.width, h: first.height }]);
  const near = diff(first, again, wallRects(first, 0.02, 0.15));
  console.log(
    `reopen export vs first: whole mad ${all.mad.toFixed(3)} max ${all.max}; ` +
      `wall beside the cheek mad ${near.mad.toFixed(3)} max ${near.max}; segmenter requests ${JSON.stringify(seg)}`,
  );
  // the reopened photo is the history original (a JPEG round trip, the face re-detected on it), drawn with the same
  // edit and the same limit. Measured: this round trip ≈ 1.6 whole / ≈ 2.4 beside the cheek (the striped wall's sharp
  // lines shift a little with the re-detected landmarks: an unlimited edit round-trips the same way), while a reopen
  // that lost the limit is ≈ 7.2 whole / ≈ 28 beside the cheek
  expect(all.mad).toBeLessThan(3);
  expect(near.mad, 'the wall beside the cheek: the same limited warp').toBeLessThan(5);
});

test('face protect: a contour edit flushed while the WebGL context is lost keeps the request (M2)', async ({ page }) => {
  test.setTimeout(240_000);
  await importWallPortrait(page);
  // the import autosave: the 自然 default, never requested
  await expect.poll(() => entries(page), { timeout: 30_000 }).toEqual([{ faceProtect: false }]);
  const slim = page.getByRole('option', { name: '瘦臉', exact: true });
  await page.getByRole('tab', { name: '美型', exact: true }).click();
  await slim.click();
  await expect(slim).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(250);
  // the drag requests the limit; before its debounced autosave runs, the display context is lost (GPU reset, iOS
  // memory pressure): the autosave pauses, and ✕ flushes the params without a thumbnail (no GL to draw one)
  await dragSlider(page, 400);
  const lostIt = await page.evaluate(() => {
    const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement | null;
    const gl = c?.getContext('webgl2') ?? null;
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  expect(lostIt, 'the display canvas lost its context').toBe(true);
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeDisabled({ timeout: 10_000 }); // lost: nothing to export
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  // the flushed params carry the request: a reopen draws them with the limit the user saw them with
  await expect.poll(async () => (await entries(page)).map((e) => e.faceProtect), { timeout: 15_000 }).toEqual([true]);
});
