// 美體 (body research report §「MonaLisa 的落地設計」, plan Phase 2): the photo-editor body tab against the production
// build with the real PoseLandmarker on SwiftShader. Full-body fixture → 美體 tab → model progress → sliders;
// 細腰 changes the torso while the far background stays identical under 背景保護; 長腿 stretches below the hips;
// 腰臀比; manual 增高 overlay; reopening from 最近編輯 uses the cached detection (no pose-model request). Plus the
// portrait gating, manual 增高 without a person, and the camera's note. The shared guard fails every test on
// console errors and non-localhost requests.
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { dragSlider, expect, grab, mad, SAMPLE_FACE, settled, shot, test, type Pixels, type Rect } from './fixtures';

const FULLBODY = resolve(import.meta.dirname, '../fixtures/fullbody.jpg');
const LEGS_REASON = '拍攝全身照可使用長腿／瘦腿';
const TORSO_REASON = '需要拍到肩膀到臀部，才能使用瘦身／細腰／腰臀比／美臀';
const ARMS_REASON = '手臂不完整或被遮擋，無法使用瘦手臂';
const SHOULDER_REASON = '肩膀不在畫面內或被遮擋，無法使用直角肩';
const POSE_MODEL = /\/models\/pose_landmarker\//;

/** A rect given in fractions of the image → pixels. */
function frac(p: Pixels, r: { x: number; y: number; w: number; h: number }): Rect {
  return {
    x: Math.round(r.x * p.width),
    y: Math.round(r.y * p.height),
    w: Math.round(r.w * p.width),
    h: Math.round(r.h * p.height),
  };
}

/** Largest per-channel difference inside a rect (0 = identical). */
function maxDiff(a: Pixels, b: Pixels, r: Rect): number {
  let m = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]));
    }
  }
  return m;
}

/** A person-free photo: a soft gradient with a straight dark line (a floor edge for 增高 to move). */
function emptyPng(width = 600, height = 900): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = y > 640 && y < 660 ? 40 : 120 + Math.round((80 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 4;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function importPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  // the import toast (e.g. 未偵測到臉部…) floats over the frame and its shadow reaches the far corners: let it go
  // before any frame grab is used as the reference
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}

const option = (page: Page, name: string): Locator => page.getByRole('option', { name, exact: true });

/** Pick a strip item and let the floating slider re-key before dragging it. */
async function pick(page: Page, name: string): Promise<void> {
  await option(page, name).click();
  await expect(option(page, name)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(250);
}

/** The floating slider of the selected item (the 增高 band lines are sliders too). */
const floatSlider = (page: Page): Locator => page.locator('.slider-row [role="slider"]');

async function sliderToMax(page: Page): Promise<void> {
  await dragSlider(page, 400);
  await expect(floatSlider(page)).toHaveAttribute('aria-valuenow', '100');
}

/** The reason every detection-gated 美體 item carries while the pose model downloads / detects. */
const DETECTING_REASON = '美體偵測完成後即可調整';

/**
 * Record every 美體 progress note the strip shows (they can flash by in well under a second once the model
 * is in the HTTP cache): a MutationObserver in the page keeps their texts in window.__bodyNotes.
 */
async function watchBodyNotes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __bodyNotes?: string[] };
    const seen: string[] = (w.__bodyNotes = []);
    const scan = () => {
      for (const el of document.querySelectorAll('.body-note.progress')) {
        const t = (el.textContent ?? '').trim();
        if (t && seen[seen.length - 1] !== t) seen.push(t);
      }
    };
    scan();
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

const bodyNotesSeen = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __bodyNotes?: string[] }).__bodyNotes ?? []);

/**
 * Wait until the 美體 detection settled: no progress note and no item still gated on the detection (the
 * sliders either unlock or carry their per-region reason).
 */
async function bodyReady(page: Page): Promise<void> {
  await expect(page.locator('.body-note.progress')).toHaveCount(0, { timeout: 150_000 });
  await expect(page.locator(`[role="option"][aria-description="${DETECTING_REASON}"]`)).toHaveCount(0, { timeout: 150_000 });
}

test('full-body photo: 美體 progress → sliders; 細腰 / 長腿 / 腰臀比 / 增高; reopen without the pose model', async ({ page, context }) => {
  test.setTimeout(360_000);
  const poseRequests: { phase: string; url: string }[] = [];
  let phase = 'import';
  context.on('request', (r) => {
    if (POSE_MODEL.test(new URL(r.url()).pathname)) poseRequests.push({ phase, url: r.url() });
  });

  await importPhoto(page, FULLBODY);
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  await grab(frame, 'b01-fullbody-before');
  expect(poseRequests, 'the pose model loads only when 美體 is first used').toEqual([]);

  // ── 美體 tab: download / detection progress, then the sliders unlock ──
  phase = 'detect';
  const tab = page.getByRole('tab', { name: '美體' });
  await watchBodyNotes(page);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  // the note may already be gone by the next poll (model in the HTTP cache): screenshot it only if still up
  const loading = page.locator('.body-note.progress');
  if (await loading.isVisible()) await shot(page, 'b02-body-loading');
  await bodyReady(page);
  const notes = await bodyNotesSeen(page);
  console.log(`body: progress notes seen: ${notes.join(' → ')}`);
  expect(notes.some((t) => /下載美體模型|正在偵測人物/.test(t)), `progress notes ${JSON.stringify(notes)}`).toBe(true);
  // the pose model was actually fetched for this detection (the progress was real, not a cached result)
  await expect.poll(() => poseRequests.filter((r) => r.phase === 'detect').length).toBeGreaterThanOrEqual(1);
  for (const n of ['瘦身', '細腰', '腰臀比', '美臀', '長腿', '瘦腿', '瘦手臂']) {
    await expect(option(page, n), n).not.toHaveAttribute('aria-disabled', 'true');
  }
  // the photo's face is masked: head / neck stay off with the face reason (no fold-prone guess)
  await expect(option(page, '小頭')).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'b03-body-ready');

  // ── 細腰 max: the torso band changes, the far background corners stay identical (背景保護 on) ──
  await expect(option(page, '背景保護')).toHaveAttribute('aria-pressed', 'true');
  await pick(page, '細腰');
  await sliderToMax(page);
  const waist = await settled(frame);
  await grab(frame, 'b04-fullbody-waist-max');
  // waist search band: 0.35–0.75 L above the hip line (fixture: shoulders y ≈ 0.27, hips y ≈ 0.51, x 0.40–0.63)
  const torso = frac(before, { x: 0.3, y: 0.33, w: 0.4, h: 0.17 });
  const corners = [
    frac(before, { x: 0, y: 0.03, w: 0.12, h: 0.25 }),
    frac(before, { x: 0.88, y: 0.03, w: 0.12, h: 0.25 }),
  ];
  const torsoMad = mad(before, waist, torso);
  const cornerMax = Math.max(...corners.map((c) => maxDiff(before, waist, c)));
  console.log(`body: 細腰 torso mad ${torsoMad.toFixed(2)}, far-corner max |Δ| ${cornerMax}`);
  expect(torsoMad).toBeGreaterThan(0.5);
  expect(cornerMax).toBe(0);

  // ── 長腿 max on top: everything below the hips moves, the head and shoulders do not ──
  await pick(page, '長腿');
  await sliderToMax(page);
  const legs = await settled(frame);
  await grab(frame, 'b05-fullbody-legs-max');
  const below = frac(before, { x: 0.2, y: 0.6, w: 0.6, h: 0.3 });
  const above = frac(before, { x: 0.3, y: 0.08, w: 0.4, h: 0.15 });
  console.log(`body: 長腿 below-hips mad ${mad(waist, legs, below).toFixed(2)}, head mad ${mad(waist, legs, above).toFixed(3)}`);
  expect(mad(waist, legs, below)).toBeGreaterThan(0.5);
  expect(mad(waist, legs, above)).toBeLessThan(0.1);

  // undo both → back to the unedited photo
  const undo = page.getByRole('button', { name: '復原' });
  await undo.click();
  await undo.click();
  expect(mad(before, await settled(frame))).toBeLessThan(0.3);

  // ── 腰臀比 max: waist in, hips out ──
  await pick(page, '腰臀比');
  await sliderToMax(page);
  const whr = await settled(frame);
  await grab(frame, 'b06-fullbody-whr-max');
  // the torso the detection drives (the reopen check below compares it too)
  const whrRect = frac(before, { x: 0.25, y: 0.33, w: 0.5, h: 0.3 });
  expect(mad(before, whr, whrRect)).toBeGreaterThan(0.3);
  expect(Math.max(...corners.map((c) => maxDiff(before, whr, c)))).toBe(0);

  // ── 增高: the band overlay; its lower line follows the stretched rows ──
  await pick(page, '增高');
  const lines = page.locator('.hband-line');
  await expect(lines).toHaveCount(2);
  const top0 = Number(await lines.nth(0).getAttribute('aria-valuenow'));
  const bottom0 = Number(await lines.nth(1).getAttribute('aria-valuenow'));
  await dragSlider(page, 400);
  await expect.poll(async () => Number(await lines.nth(1).getAttribute('aria-valuenow'))).toBeGreaterThan(bottom0);
  const len = (bottom0 - top0) / 100;
  const S = 1 + Math.min(0.15, 0.08 / len);
  const want = Math.round(top0 + (bottom0 - top0) * S);
  expect(Math.abs(Number(await lines.nth(1).getAttribute('aria-valuenow')) - want)).toBeLessThanOrEqual(2);
  const height = await settled(frame);
  await shot(page, 'b07-height-band');
  expect(mad(whr, height)).toBeGreaterThan(0.3);
  await pick(page, '腰臀比'); // overlay off for the comparison after reopening
  const edited = await settled(frame);
  await grab(frame, 'b07b-fullbody-edited');

  // ── close; reload (no memo); reopen from 最近編輯: cached detection, no pose-model request ──
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await page.reload();
  phase = 'reopen';
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 }); // the 未偵測到臉部 toast covers the frame top
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(option(page, '瘦身')).not.toHaveAttribute('aria-disabled', 'true', { timeout: 10_000 });
  await expect(page.locator('.body-note.progress')).toHaveCount(0);
  await pick(page, '腰臀比');
  await expect(floatSlider(page)).toHaveAttribute('aria-valuenow', '100');
  const reopened = await settled(frame);
  await grab(frame, 'b08-fullbody-reopened');
  const clear = frac(before, { x: 0, y: 0.03, w: 1, h: 0.85 });
  console.log(
    `body: reopen vs edit mad ${mad(reopened, edited, clear).toFixed(2)} (edit vs original ${mad(edited, before, clear).toFixed(2)}), ` +
      `torso ${mad(reopened, edited, whrRect).toFixed(2)} (腰臀比 alone ${mad(whr, before, whrRect).toFixed(2)})`,
  );
  // the reopened photo is the history original (JPEG round trip) with the same edit. The whole frame is dominated
  // by the 增高 stretch, which needs no detection: the torso, where the cached detection drives 腰臀比, must match too
  // (measured ≈ 0.7 against ≈ 6.5 for the whole 腰臀比 effect there)
  expect(mad(reopened, edited, clear)).toBeLessThan(2);
  expect(mad(reopened, edited, whrRect)).toBeLessThan(2);
  expect(poseRequests.filter((r) => r.phase === 'reopen'), 'pose-model requests after reopening').toEqual([]);
});

test('portrait: torso / arm / leg sliders are disabled with their reasons; tapping shows it', async ({ page }) => {
  test.setTimeout(240_000);
  await importPhoto(page, SAMPLE_FACE);
  await page.getByRole('tab', { name: '美體' }).click();
  await bodyReady(page);
  // head-and-shoulders: no hips / knees / ankles / wrists in frame → each slider carries its region's reason.
  // The shoulders are under the hair at the frame edge: 直角肩 would lift the jaw instead, so it is off too.
  const gated: [string, string][] = [
    ['直角肩', SHOULDER_REASON],
    ['瘦身', TORSO_REASON],
    ['細腰', TORSO_REASON],
    ['腰臀比', TORSO_REASON],
    ['美臀', TORSO_REASON],
    ['瘦手臂', ARMS_REASON],
    ['長腿', LEGS_REASON],
    ['瘦腿', LEGS_REASON],
  ];
  for (const [n, why] of gated) {
    await expect(option(page, n), n).toHaveAttribute('aria-disabled', 'true');
    await expect(option(page, n), n).toHaveAttribute('aria-description', why);
  }
  // the manual band needs no detection
  await expect(option(page, '增高')).not.toHaveAttribute('aria-disabled', 'true');

  // a disabled item stays tappable (aria-disabled, not the disabled attribute): a real tap shows the reason
  // as a toast and selects nothing. Playwright refuses to click aria-disabled controls → force the tap.
  const selected = page.locator('[role="option"][aria-selected="true"] .item-label');
  const selectedBefore = await selected.allTextContents();
  const legs = option(page, '長腿');
  await legs.click({ force: true });
  const toastEl = page.locator('.toast');
  await expect(toastEl).toHaveText(LEGS_REASON);
  await expect(legs).not.toHaveAttribute('aria-selected', 'true');
  expect(await selected.allTextContents()).toEqual(selectedBefore);
  await shot(page, 'b09-portrait-legs-disabled');
  await option(page, '細腰').click({ force: true });
  await expect(toastEl).toHaveText(TORSO_REASON);
  await shot(page, 'b09b-portrait-torso-disabled');
});

test('no person: the note, and manual 增高 still stretches the photo', async ({ page }) => {
  test.setTimeout(240_000);
  await importPhoto(page, { name: 'empty.png', mimeType: 'image/png', buffer: emptyPng() });
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(page.locator('.body-note')).toContainText('未偵測到人物，仍可使用手動增高', { timeout: 150_000 });
  await expect(option(page, '瘦身')).toHaveAttribute('aria-disabled', 'true');
  await expect(option(page, '增高')).not.toHaveAttribute('aria-disabled', 'true');
  const frame = page.locator('.editor-stage .frame');
  await pick(page, '增高');
  await expect(page.locator('.hband-line')).toHaveCount(2);
  const b0 = await settled(frame);
  await dragSlider(page, 400);
  const b1 = await settled(frame);
  await shot(page, 'b10-noperson-height');
  expect(mad(b0, b1)).toBeGreaterThan(0.3);
});

test('camera: the 美體 tab says photo editing only and offers 匯入照片', async ({ page, context }) => {
  const poseRequests: string[] = [];
  context.on('request', (r) => {
    if (POSE_MODEL.test(new URL(r.url()).pathname)) poseRequests.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect(page.getByRole('button', { name: '拍照' })).toBeEnabled({ timeout: 90_000 });
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(page.locator('.body-note')).toContainText('美體目前僅支援照片編輯');
  await expect(page.locator('.body-note').getByRole('button', { name: '匯入照片' })).toBeVisible();
  await expect(option(page, '長腿')).toHaveAttribute('aria-disabled', 'true');
  await expect(option(page, '增高')).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'b11-camera-body-note');
  expect(poseRequests).toEqual([]);
});
