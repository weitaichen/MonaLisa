// The camera with three faces (S §8.4): group.y4m shows A, B and C (gen-y4m from group_faces.png), inside the 3:4
// preview: A above, B and C side by side below it (composeGroupCam).
import type { Page } from '@playwright/test';
import { debugState, expect, grab, hold, regionDiff, test } from './fixtures';

/** a camera debug box (unmirrored video UV) → client px and → a rect in fractions of the preview frame */
async function camGeom(page: Page, id: string) {
  const b = (await debugState(page)).boxes.find((x) => x.id === id)!;
  return page.evaluate((b) => {
    const c = document.querySelector('.cam-stage canvas') as HTMLCanvasElement;
    const v = document.querySelector('video') as HTMLVideoElement;
    const r = c.getBoundingClientRect();
    const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const fx = (u: number) => (r.width - v.videoWidth * s) / 2 + (1 - u) * v.videoWidth * s; // the front camera preview is mirrored
    const fy = (y: number) => (r.height - v.videoHeight * s) / 2 + y * v.videoHeight * s;
    const x0 = fx(b.x + b.w);
    const x1 = fx(b.x);
    return {
      point: { x: r.left + (x0 + x1) / 2, y: r.top + fy(b.y + b.h / 2) },
      rect: { x: x0 / r.width, y: fy(b.y) / r.height, w: (x1 - x0) / r.width, h: (fy(b.y + b.h) - fy(b.y)) / r.height },
    };
  }, b);
}
const byX = async (page: Page) => [...(await debugState(page)).boxes].sort((a, b) => b.x - a.x).map((b) => b.id); // mirrored: screen left → right

test('three faces: auto beautifies the largest; tap B; 全部套用; tap C; the hand-over selects B', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(3);
  // the face marker keeps its nodes across frames: one dot above the beautified face, the same node every frame
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
  expect(marker).toEqual({ nodes: 1, most: 1, dots: 1 });
  // a photo-level look of zero, so an unselected face is untouched pixel for pixel
  await page.getByRole('tab', { name: '美膚' }).click();
  for (const item of ['美白', '銳化']) {
    await page.getByRole('option', { name: item, exact: true }).click();
    const s = page.getByRole('slider');
    await s.focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowLeft');
  }
  const boxes = (await debugState(page)).boxes;
  const largest = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0].id;
  expect((await debugState(page)).selected).toBe(largest);
  const [B, C] = (await byX(page)).reverse().filter((id) => id !== largest); // A is the largest; B, C left to right in the scene
  const frame = page.locator('.cam-stage .frame');
  await page.addStyleTag({ content: '.cam-marker, .all-chip, .badge { display: none !important; }' });
  // tap B: B beautified, A unchanged
  const gb = await camGeom(page, B);
  await page.mouse.click(gb.point.x, gb.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(B);
  await page.waitForTimeout(500);
  const beautified = await grab(frame);
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await page.waitForTimeout(400);
  const original = await grab(frame);
  await release();
  const ga = await camGeom(page, largest === B ? C : largest);
  expect(regionDiff(original, beautified, gb.rect).inside).toBeGreaterThan(0.5);
  expect(regionDiff(original, beautified, ga.rect).inside).toBeLessThan(0.3);
  // 全部套用: every face changes; a tap on C turns it off and selects C
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  const chip = page.getByRole('button', { name: '全部套用' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  const gc = await camGeom(page, C);
  await page.mouse.click(gc.point.x, gc.point.y);
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).selected).toBe(C);
  // hand-over: B selected, shutter → 編輯 → the editor selects the person whose face holds the seed (B)
  const gb2 = await camGeom(page, B);
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
