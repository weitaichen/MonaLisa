// Persons in the photo editor (S §8.4): the group fixture's faces, the primary, the cached detection, the strip, the
// face boxes, photo taps, 全部, the photo-level items, undo across persons, reopen and the seeded records.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { editFromLegacy } from '../../src/edit/legacy';
import { assignPersons } from '../../src/edit/state';
import { applyPreset, sanitizeParams } from '../../src/engine/params';
import { stableKey } from '../../src/store/undo';
import { boxCentre, debugState, expect, grab, GROUP_FACES, historyStamps, importFixture, pinch, regionDiff, seedHistory, selectPerson, test } from './fixtures';

test('a group photo: three selectable faces (D ignored), A is the primary, the cache is written', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  const d = await debugState(page);
  expect(d.persons).toBe(3);
  expect(d.selected).toBe('f0');
  expect(d.detectCalls).toBe(1);
});

test('reopening an edited group photo runs no face detector: the cache answers', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  await page.getByRole('tab', { name: '美型' }).click();
  await page.getByRole('option', { name: '大眼', exact: true }).click();
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  expect((await debugState(page)).detectCalls).toBe(calls);
});

const tab = (page: Page, name: string) => page.getByRole('tab', { name }).click();
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true }).click();
const sliderTo = async (page: Page, v: number) => {
  const s = page.getByRole('slider');
  await s.focus();
  const now = Number(await s.getAttribute('aria-valuenow'));
  for (let i = 0; i < Math.abs(v - now); i++) await page.keyboard.press(v > now ? 'ArrowRight' : 'ArrowLeft');
  await expect(s).toHaveAttribute('aria-valuenow', String(v));
};
const frame = (page: Page) => page.locator('.editor-stage .frame');
/** pixel comparisons read the photo only: the brackets change colour with the selection, toasts come and go */
const hideOverlays = (page: Page) => page.addStyleTag({ content: '.face-boxes, .toast { display: none !important; }' });

test.describe('group photo editing (S §8.4)', () => {
  test.beforeEach(async ({ page }) => {
    await importFixture(page, GROUP_FACES);
    await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  });

  test('brackets and the strip 全部｜1｜2｜3; no box for D', async ({ page }) => {
    await expect(page.getByRole('radiogroup', { name: '選擇人物' }).getByRole('radio')).toHaveCount(4);
    await expect(page.locator('.face-box')).toHaveCount(3);
    expect((await debugState(page)).boxes).toHaveLength(3);
    await expect(page.getByRole('radio', { name: '人物 1' })).toHaveAttribute('aria-checked', 'true');
  });

  test('a tap on face B selects 2; pinch to 3× on A, one-finger drag pans, double tap fits, a tap on B selects B', async ({ page }) => {
    const b = await boxCentre(page, 'f1');
    await page.mouse.click(b.x, b.y);
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveAttribute('aria-checked', 'true');
    await selectPerson(page, 1);
    const a = await boxCentre(page, 'f0');
    await pinch(page, a, 60, 180);
    const layer = page.locator('.editor-stage .zoom-layer');
    await expect(layer).toHaveAttribute('style', /scale\(/);
    const t0 = await layer.getAttribute('style');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 10, { steps: 6 });
    await page.mouse.up();
    expect(await layer.getAttribute('style')).not.toBe(t0);
    expect((await debugState(page)).selected).toBe('f0');
    await page.mouse.dblclick(a.x + 40, a.y + 10);
    await expect(layer).not.toHaveAttribute('style', /scale\(/);
    await page.waitForTimeout(400); // the fit animates for 240 ms: read B's box once the layer is back at zoom 1
    const b2 = await boxCentre(page, 'f1');
    await page.mouse.click(b2.x, b2.y);
    expect((await debugState(page)).selected).toBe('f1');
  });

  test('大眼 on person 2 changes only B’s region; 全部 + 瘦臉 changes A, B and C', async ({ page }) => {
    await hideOverlays(page);
    await tab(page, '美型');
    const before = await grab(frame(page));
    await selectPerson(page, 2);
    await option(page, '大眼');
    await sliderTo(page, 100);
    await page.waitForTimeout(600);
    const after = await grab(frame(page));
    const B = (await debugState(page)).boxes.find((x) => x.id === 'f1')!;
    const pad = { x: B.x - B.w * 0.6, y: B.y - B.h * 0.6, w: B.w * 2.2, h: B.h * 2.2 };
    const r = regionDiff(before, after, pad);
    expect(r.inside).toBeGreaterThan(0.2);
    expect(r.outsideMax).toBeLessThanOrEqual(1);
    await selectPerson(page, 0);
    await option(page, '瘦臉');
    await sliderTo(page, 100);
    await page.waitForTimeout(600);
    const all = await grab(frame(page));
    for (const id of ['f0', 'f1', 'f2']) {
      const f = (await debugState(page)).boxes.find((x) => x.id === id)!;
      expect(regionDiff(after, all, f).inside, id).toBeGreaterThan(0.05);
    }
  });

  test('全部 + 自然 makes person 2 自然 after 精緻; 美白 is photo-level and dims the chips', async ({ page }) => {
    await tab(page, '一鍵');
    await selectPerson(page, 2);
    await option(page, '精緻');
    await selectPerson(page, 0);
    await option(page, '自然');
    await selectPerson(page, 2);
    await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tab(page, '美膚');
    await option(page, '美白');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-label', '美白，整張照片');
    await expect(page.locator('.slider-label')).toContainText('美白 · 整張照片');
    await expect(page.getByRole('radio', { name: '人物 1' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('the first tap of a 濾鏡 tile says it applies to the whole photo (S §2.4)', async ({ page }) => {
    await tab(page, '濾鏡');
    await option(page, '暖調');
    await expect(page.locator('.toast')).toHaveText('濾鏡套用於整張照片');
  });

  test('⊘ in 美膚 with person 2 keeps 美白; ↶ restores B’s 大眼, keeps the selection and flags B; an undo of B from person 1 toasts', async ({ page }) => {
    await tab(page, '美膚');
    await option(page, '美白');
    await sliderTo(page, 80);
    // while 美白 (photo-level) is active the chips are not selectable (A11): pick person 2 on a person item
    await option(page, '磨皮');
    await selectPerson(page, 2);
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('option', { name: '原圖', exact: true }).click();
    await option(page, '美白');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '80');
    await tab(page, '美型');
    await option(page, '大眼');
    await sliderTo(page, 90);
    await page.getByRole('button', { name: '復原' }).click();
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: '人物 2' })).toHaveClass(/changed/);
    await page.getByRole('button', { name: '重做' }).click();
    await selectPerson(page, 1);
    await page.getByRole('button', { name: '復原' }).click();
    await expect(page.getByText('已復原人物 2 的變更')).toBeVisible();
  });

  test('close and reopen: the same pixels, no detector; a view without an edit keeps 最近編輯 and updatedAt', async ({ page }) => {
    await hideOverlays(page);
    await tab(page, '美型');
    await option(page, '大眼');
    await sliderTo(page, 70);
    await page.waitForTimeout(800);
    const pre = await grab(frame(page));
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
    const stamps = await historyStamps(page);
    const calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).click();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).faces).toBe(3);
    await page.waitForTimeout(1000);
    expect(regionDiff(pre, await grab(frame(page)), { x: 0, y: 0, w: 1, h: 1 }).inside).toBeLessThan(0.5);
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1);
    expect(await historyStamps(page)).toEqual(stamps);
    expect((await debugState(page)).detectCalls).toBe(calls);
  });

  test('two faces survive a WebGL context loss with the same pixels', async ({ page }) => {
    await hideOverlays(page);
    const before = await grab(frame(page));
    await page.evaluate(() => {
      const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement;
      const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
      ext.loseContext();
      setTimeout(() => ext.restoreContext(), 300);
    });
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(regionDiff(before, await grab(frame(page)), { x: 0, y: 0, w: 1, h: 1 }).inside).toBeLessThan(0.5);
  });
});

test('a seeded v0.3 record opens with its look on A only', async ({ page }) => {
  await page.goto('/');
  // a lip on (0.3) with the 豆沙 shade: with lip at 0 the strip would show 無 whatever the shade
  const glow = { values: { 'makeup.lip': 0.3, 'makeup.blush': 0.3 }, filterId: 'none', lipShade: 'bean', blushShade: 'peach', presetId: 'glow', presetAmount: 1, bodyProtect: true, heightBand: null };
  await seedHistory(page, { id: 'v1-group', createdAt: 1, updatedAt: 1, width: 1800, height: 1200, params: glow }, { original: GROUP_FACES });
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000 }).toBe(3);
  await page.getByRole('tab', { name: '美妝' }).click();
  await expect(page.getByRole('option', { name: '豆沙', exact: true })).toHaveAttribute('aria-selected', 'true');
  await selectPerson(page, 2);
  await expect(page.getByRole('option', { name: '無', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('a no-face photo reopens with detectCalls unchanged and no toast', async ({ page }) => {
  // a face-free grey gradient (as editor.spec.ts:5 noFacePng)
  const png = new PNG({ width: 600, height: 800 });
  for (let i = 0; i < 600 * 800; i++) {
    const v = 90 + Math.round((70 * ((i % 600) + Math.floor(i / 600))) / 1400);
    png.data.set([v, v, v + 6, 255], i * 4);
  }
  const file = test.info().outputPath('noface.png');
  writeFileSync(file, PNG.sync.write(png));
  await importFixture(page, file);
  await page.waitForTimeout(3500); // the first open's 「未偵測到臉部」 toast is gone
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(calls);
  await expect(page.locator('.toast')).toHaveCount(0);
});

test('a body-only person: the no-face note on 美型, 磨皮 / 紅潤 disabled per item on 美膚 (seeded cache)', async ({ page }) => {
  await page.goto('/');
  const j = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/group_faces.landmarks.json'), 'utf8')) as { width: number; height: number; faces: number[][] };
  const bbox = (lm: number[]) => {
    const xs = lm.filter((_, i) => i % 3 === 0);
    const ys = lm.filter((_, i) => i % 3 === 1);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const faces = j.faces
    .map((lm) => ({ lm, box: bbox(lm) }))
    .filter((f) => f.box.w * j.width >= 0.03 * j.height)
    .sort((a, b) => a.box.x - b.box.x)
    .map((f, i) => ({ id: `f${i}`, lm: f.lm, box: f.box }));
  // a standing pose at the right edge, all points visible: it pairs with no face, so it is a body-only person
  const pose = Array.from({ length: 132 }, (_, k) => [0.96 + (Math.floor(k / 4) % 2 ? 0.02 : -0.02), 0.1 + (0.8 * Math.floor(k / 4)) / 32, 0, 0.99][k % 4]);
  const ids = [...faces.map((f) => f.id), 'b0'];
  const params = sanitizeParams(applyPreset('natural', 1));
  const edit = assignPersons(editFromLegacy(params, { primaryInit: true }), ids, 'f0');
  const detect = {
    v: 1,
    width: j.width,
    height: j.height,
    faceScans: [{ quarter: 0, flipH: false }],
    faces,
    obstacles: [],
    bodies: [{ id: 'b0', pose: { points: pose }, mask: null, score: 0.1 }],
    bodiesComplete: true,
    persons: ids.map((id) => ({ id, face: id === 'b0' ? null : id, body: id === 'b0' ? 'b0' : null })),
    primary: 'f0',
    dropped: { tooSmall: 0, overCap: 0 },
  };
  const typed: Record<string, 'f32'> = { 'detect.bodies.0.pose.points': 'f32' };
  faces.forEach((_, i) => (typed[`detect.faces.${i}.lm`] = 'f32'));
  await seedHistory(page, { id: 'v2-bodyonly', createdAt: 1, updatedAt: 1, width: j.width, height: j.height, params, schema: 2, edit, paramsKey: stableKey(params), detect }, { original: GROUP_FACES }, typed);
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(0);
  await page.getByRole('radio', { name: `人物 ${ids.length}（未偵測到臉部）` }).click();
  await page.getByRole('tab', { name: '美型' }).click();
  await expect(page.getByText('這位人物未偵測到臉部，臉部效果不適用')).toBeVisible();
  await page.getByRole('tab', { name: '美膚' }).click();
  await expect(page.getByRole('option', { name: '磨皮', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('option', { name: '美白', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
});
