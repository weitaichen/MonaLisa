// E1–E3 (camera per-person spec §12.2) on group.y4m: A above, B and C side by side below (composeGroupCam), front camera.
import type { Page } from '@playwright/test';
import { armShotOriginal, camBox, capturedRegions, capturedVsOriginal, debugState, dragSlider, expect, grab, hold, mad, regionDiff, selectPerson, test } from './fixtures';

/** Home → 拍攝 → the live camera with A, B and C found, and the overlays a frame grab would catch hidden (E3 shows the 全部套用 chip again to press it) */
async function openCamera(page: Page): Promise<{ A: string; B: string; C: string }> {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(3);
  // .corner-label: 按住對比's 「原圖」 tag, drawn over the frame only while held
  await page.addStyleTag({ content: '.cam-marker, .all-chip, .badge, .toast, .corner-label { display: none !important; }' });
  const boxes = (await debugState(page)).boxes;
  const A = [...boxes].sort((a, b) => a.y - b.y)[0].id;
  const [B, C] = boxes.filter((b) => b.id !== A).sort((a, b) => a.x - b.x).map((b) => b.id); // B left of C in the unmirrored frame (x 505 vs 782 px)
  return { A, B, C };
}
const tap = async (page: Page, id: string) => {
  const g = await camBox(page, id);
  await page.mouse.click(g.point.x, g.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(id);
};
const preset = async (page: Page, name: string) => {
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
};
/**
 * 一鍵 › 自然 on the target, then its photo part (美白, 銳化: the whole frame) back to 0, so an untouched face stays 原圖
 * pixel for pixel (camera-group.spec.ts does the same). 自然's 濾鏡 is 'none'; 精緻 would set 'soft' on the frame
 */
async function natural(page: Page): Promise<void> {
  await preset(page, '自然');
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  for (const item of ['美白', '銳化']) {
    await page.getByRole('option', { name: item, exact: true }).click();
    await page.getByRole('slider').focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowLeft');
  }
}
/** the preview's change against 按住對比 inside each face's box */
async function changed(page: Page, ids: string[]): Promise<number[]> {
  const frame = page.locator('.cam-stage .frame');
  await page.waitForTimeout(500);
  const now = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const held = await grab(frame);
  await release();
  return Promise.all(ids.map(async (id) => regionDiff(held, now, (await camBox(page, id)).rect).inside));
}

test('E1 fresh camera = original: composite only, the preview equals 按住對比, the capture the frame handed to 編輯', async ({ page }) => {
  test.setTimeout(240_000);
  await armShotOriginal(page);
  await openCamera(page);
  await page.waitForTimeout(1000);
  expect((await debugState(page)).passes).toEqual(['composite']);
  const frame = page.locator('.cam-stage .frame');
  const shown = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const held = await grab(frame);
  await release();
  const preview = mad(shown, held);
  console.log(`E1 preview vs 按住對比: MAD ${preview}`);
  expect(preview).toBeLessThanOrEqual(0.5);
  await page.evaluate(() => ((window as unknown as { __armOriginal: boolean }).__armOriginal = true));
  await page.getByRole('button', { name: '拍照' }).click();
  const d = await capturedVsOriginal(page);
  console.log(`E1 capture vs the unprocessed frame: ${JSON.stringify(d)}`);
  expect(d.same).toBe(true);
  expect(d.mad).toBeLessThanOrEqual(1);
});

test('E2 per person: B adjusted, then C; each keeps its result; the capture and 編輯 carry B and C, A stays 原圖', async ({ page }) => {
  test.setTimeout(300_000);
  await armShotOriginal(page);
  const { A, B, C } = await openCamera(page);
  await tap(page, B);
  await natural(page);
  await page.getByRole('tab', { name: '美型', exact: true }).click();
  await page.getByRole('option', { name: '大眼', exact: true }).click();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  await tap(page, C);
  const [b1, c1, a1] = await changed(page, [B, C, A]);
  console.log(`E2 after B: B ${b1}, C ${c1}, A ${a1}`);
  expect(b1).toBeGreaterThan(0.5);
  expect([c1, a1].every((v) => v < 0.3)).toBe(true);
  await natural(page);
  const [b2, c2, a2] = await changed(page, [B, C, A]);
  console.log(`E2 after C: B ${b2}, C ${c2}, A ${a2}`);
  expect([b2 > 0.5, c2 > 0.5, a2 < 0.3]).toEqual([true, true, true]);
  const persons = new Map((await debugState(page)).boxes.map((x) => [x.id, x.edited]));
  expect([persons.get(A), persons.get(B), persons.get(C)]).toEqual([false, true, true]);
  // capture (U3): 預覽 shows B and C adjusted and A at 原圖, against the unprocessed frame handed to 編輯; each face's
  // preview rect is its rect in the shot (the preview's crop, mirrored as the preview)
  const rects = await Promise.all([B, C, A].map(async (id) => (await camBox(page, id)).rect));
  await page.evaluate(() => ((window as unknown as { __armOriginal: boolean }).__armOriginal = true));
  await page.getByRole('button', { name: '拍照' }).click();
  const shot = await capturedRegions(page, rects);
  console.log(`E2 capture vs the unprocessed frame: ${JSON.stringify(shot)} (B, C, A)`);
  expect(shot.same).toBe(true);
  const [b3, c3, a3] = shot.mads;
  expect([b3 > 0.5, c3 > 0.5, a3 >= 0 && a3 < 0.3]).toEqual([true, true, true]);
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(3);
  const ed = (await debugState(page)).boxes;
  const eA = [...ed].sort((a, b) => a.y - b.y)[0];
  // saved mirrored (mirrorOnSave, front camera): B, left of C on the unmirrored frame, is right of C in the photo
  const [eC, eB] = ed.filter((b) => b !== eA).sort((a, b) => a.x - b.x);
  // the camera's target (C) names the primary through the seed, and the editor selects it
  await expect.poll(async () => (await debugState(page)).selected).toBe(eC.id);
  /**
   * a person's value of one item: the item first (a person item, so the 人物 chips stay selectable, S A11), then the
   * person; face ids f0… follow the display order, as the 人物 n chips do
   */
  const value = async (face: { id: string }, tab: string, item: string) => {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.getByRole('option', { name: item, exact: true }).click();
    await selectPerson(page, Number(face.id.slice(1)) + 1);
    await expect.poll(async () => (await debugState(page)).selected).toBe(face.id);
    return Number(await page.getByRole('slider').getAttribute('aria-valuenow'));
  };
  expect(await value(eB, '美型', '大眼')).toBe(100);
  const c = await value(eC, '美型', '大眼'); // 自然's 大眼: C's camera value, not B's
  expect(c > 0 && c < 100).toBe(true);
  expect(await value(eA, '美膚', '磨皮')).toBe(0); // A: 原圖
  // nobody the camera edited was dropped
  await expect(page.getByText(/未帶入相機效果/)).toHaveCount(0);
  // a shot with nothing set opening at 原圖 (export MAD 0) is original.spec.ts's nothing-set camera test
});

test('E3 全部套用: on copies the target to all three; a slider writes all; a tap on A turns it off and selects A; nobody reverts', async ({ page }) => {
  test.setTimeout(240_000);
  const { A, B, C } = await openCamera(page);
  await tap(page, B);
  // 自然 with its photo part at 0: before 全部套用 only B differs from 按住對比, so A's and C's change below is the copy
  await natural(page);
  const [b0, a0, c0] = await changed(page, [B, A, C]);
  console.log(`E3 before 全部套用: B ${b0}, A ${a0}, C ${c0}`);
  expect([b0 > 0.5, a0 < 0.3, c0 < 0.3]).toEqual([true, true, true]);
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  const chip = page.getByRole('button', { name: '全部套用' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  expect((await debugState(page)).boxes.every((x) => x.edited)).toBe(true);
  const on = await changed(page, [A, B, C]);
  console.log(`E3 全部套用 on: A ${on[0]}, B ${on[1]}, C ${on[2]}`);
  expect(on.every((v) => v > 0.5)).toBe(true);
  // a slider writes everyone in view: 磨皮 to 100
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  expect((await debugState(page)).boxes.every((x) => x.edited)).toBe(true);
  // a tap on A turns 全部套用 off and selects A, whose 磨皮 the slider wrote; C got it too
  const g = await camBox(page, A);
  await page.mouse.click(g.point.x, g.point.y);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).selected).toBe(A);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  await tap(page, C);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  // off reverts nobody
  const off = await changed(page, [A, B, C]);
  console.log(`E3 全部套用 off: A ${off[0]}, B ${off[1]}, C ${off[2]}`);
  expect(off.every((v) => v > 0.5)).toBe(true);
  expect((await debugState(page)).boxes.every((x) => x.edited)).toBe(true);
});
