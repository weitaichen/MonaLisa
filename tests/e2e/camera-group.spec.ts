// The camera with three faces (S §8.4): group.y4m shows A, B and C (gen-y4m from group_faces.png), inside the 3:4
// preview: A above, B and C side by side below it (composeGroupCam).
import type { Page } from '@playwright/test';
import { camBox, debugState, expect, grab, hold, regionDiff, test } from './fixtures';

/** every toast text shown from now on (the camera hint lasts 3.2 s, the 3-face poll can outlive it) */
const watchToasts = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const scan = () => {
      for (const el of document.querySelectorAll('.toast')) {
        const t = (el.textContent ?? '').trim();
        if (t && w.__toasts.at(-1) !== t) w.__toasts.push(t);
      }
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
const toastsSeen = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
const byX = async (page: Page) => [...(await debugState(page)).boxes].sort((a, b) => b.x - a.x).map((b) => b.id); // mirrored: screen left → right

/** a photo-level look of zero (美白, 銳化 to 0), so an untouched face is untouched pixel for pixel */
async function zeroPhotoLook(page: Page) {
  await page.getByRole('tab', { name: '美膚' }).click();
  for (const item of ['美白', '銳化']) {
    await page.getByRole('option', { name: item, exact: true }).click();
    const s = page.getByRole('slider');
    await s.focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowLeft');
  }
}

// camera per-person spec §12.2 (changed on purpose): every face renders its own person's params, 全部套用 copies
test('three faces, one person at a time: 自然 edits and pins the largest (A); tap B and edit B: A keeps its result, C stays 原圖; 全部套用 copies B to everyone; a tap on C turns it off, nobody reverts; the hand-over selects B', async ({ page }) => {
  await page.goto('/');
  await watchToasts(page);
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(3);
  // the first time ≥ 2 faces are shown: the one-time hint (§3.1)
  await expect.poll(() => toastsSeen(page)).toContain('點選畫面中的臉，可個別調整');
  // 美膚 › 磨皮 is a person item: the marker is not dimmed
  await expect(page.locator('.cam-marker')).toHaveAttribute('class', 'cam-marker');
  // the face marker keeps its nodes across frames: one dot above the target's face and one bracket per face (§3.1,
  // K12), the same nodes every frame
  const marker = await page.evaluate(async () => {
    const m = document.querySelector('.cam-marker')!;
    const seen = new Set<Element>();
    let most = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      Array.from(m.children).forEach((c) => seen.add(c));
      most = Math.max(most, m.children.length);
    }
    const dots = Array.from(m.querySelectorAll<HTMLElement>('.cam-dot')).filter((d) => d.style.display !== 'none');
    return { nodes: seen.size, most, dots: dots.length };
  });
  expect(marker).toEqual({ nodes: 4, most: 4, dots: 1 });
  // the camera starts at 原圖 (2026-10-18); 一鍵 › 自然 edits the auto target, the largest face (A), and pins it (K9)
  await page.getByRole('tab', { name: '一鍵' }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
  // the preset's photo part goes to the whole frame: zero it
  await zeroPhotoLook(page);
  // 美膚 › 銳化 is photo-level: brackets and dot dim to 30 % (S A11)
  await expect(page.locator('.cam-marker')).toHaveAttribute('class', 'cam-marker dim');
  const boxes = (await debugState(page)).boxes;
  const largest = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0].id;
  expect((await debugState(page)).selected).toBe(largest);
  const [B, C] = (await byX(page)).reverse().filter((id) => id !== largest); // A is the largest; B, C left to right in the scene
  const frame = page.locator('.cam-stage .frame');
  await page.addStyleTag({ content: '.cam-marker, .all-chip, .badge { display: none !important; }' });
  // tap B: B selected, and 原圖 until edited (the panel reads B); 一鍵 › 自然 on B, whose photo part re-applies 美白 /
  // 銳化 to the whole frame, so they go back to 0
  const gb = await camBox(page, B);
  await page.mouse.click(gb.point.x, gb.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(B);
  await page.getByRole('tab', { name: '一鍵' }).click();
  await expect(page.getByRole('option', { name: '原圖', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
  await zeroPhotoLook(page);
  await page.waitForTimeout(500);
  const beautified = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const original = await grab(frame);
  await release();
  const ga = await camBox(page, largest);
  const gc = await camBox(page, C);
  expect(regionDiff(original, beautified, gb.rect).inside, 'B adjusted').toBeGreaterThan(0.5);
  expect(regionDiff(original, beautified, ga.rect).inside, 'A keeps its result (U3)').toBeGreaterThan(0.5);
  expect(regionDiff(original, beautified, gc.rect).inside, 'C untouched').toBeLessThan(0.3);
  // 全部套用 copies B's params to everyone in view (K10): C now differs too (group.y4m's frames are identical, so the
  // compare frame above stays the original)
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  const chip = page.getByRole('button', { name: '全部套用' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  await page.waitForTimeout(500);
  expect(regionDiff(original, await grab(frame), gc.rect).inside, '全部套用 copies B to C').toBeGreaterThan(0.5);
  // a tap on C turns it off and selects C; nobody reverts
  await page.mouse.click(gc.point.x, gc.point.y);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).selected).toBe(C);
  await page.waitForTimeout(500);
  expect(regionDiff(original, await grab(frame), gc.rect).inside, 'C keeps the copy').toBeGreaterThan(0.5);
  // hand-over: B selected, shutter → 編輯 → the editor selects the person whose face holds the seed (B)
  const gb2 = await camBox(page, B);
  await page.mouse.click(gb2.point.x, gb2.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(B);
  await page.getByRole('button', { name: '拍照' }).click();
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const d = await debugState(page);
  // the shot is the preview's 3:4 crop, mirrored as the preview (mirrorOnSave), so B's face is where gb2.rect was
  const bx = gb2.rect.x + gb2.rect.w / 2;
  const by = gb2.rect.y + gb2.rect.h / 2;
  const dist = (b: { x: number; y: number; w: number; h: number }) => Math.hypot(b.x + b.w / 2 - bx, b.y + b.h / 2 - by);
  const atB = [...d.boxes].sort((a, b) => dist(a) - dist(b))[0].id;
  expect(d.selected).toBe(atB);
});

test('bench: live fps with three faces and every 美妝 part on (S5 §6.2 row 4) @bench', async ({ page }) => {
  test.skip(!process.env.BENCH, 'run with BENCH=1 npx playwright test --project chromium-group --grep @bench');
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000 }).toBe(3);
  // as the 全部套用 case above does: the chip waits for ChipGate's debounce
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  await page.getByRole('button', { name: '全部套用' }).click();
  await page.getByRole('tab', { name: '美妝', exact: true }).click();
  for (const [part, first] of [
    ['口紅', '玫瑰'],
    ['腮紅', '蜜桃'],
    ['眉毛', '自然黑'],
    ['眼影', '大地'],
    ['眼線', '黑'],
    ['睫毛', '自然'],
    ['臥蠶', '自然'],
    ['修容', '自然'],
    ['高光', '自然'],
    ['美瞳', '冰藍'],
  ] as const) {
    await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
    await page.getByRole('option', { name: part, exact: true }).click();
    await page.getByRole('option', { name: first, exact: true }).click();
  }
  await page.waitForTimeout(10_000);
  console.log(`step5 live fps, 3 faces, every makeup part: ${(await debugState(page)).fps.toFixed(1)}`);
});
