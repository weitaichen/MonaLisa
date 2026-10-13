// 裁切／旋轉／翻轉 and full-resolution export in the app (S §8.2). Imports go through the file chooser like a user's.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { closeFallback, debugState, expect, exportFile, makeJpeg, readHistory, SAMPLE_FACE, test } from './fixtures';

async function importInto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
}

const frameAspect = (page: Page) =>
  page.locator('.editor-stage .frame').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width / r.height;
  });

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });
/** the slider row's slider (the 增高 band lines are role="slider" too, as in body.spec.ts) */
const rowSlider = (page: Page) => page.locator('.slider-row [role="slider"]');

test('裁切 is the 8th tab: 1:1 crops the frame, ↶ ↷ step it, 還原 restores and is dimmed at identity', async ({ page }) => {
  await importInto(page, SAMPLE_FACE);
  await expect(page.getByRole('tab')).toHaveCount(8);
  await expect(page.getByRole('tab').last()).toHaveText('裁切');
  expect(await frameAspect(page)).toBeCloseTo(1000 / 1500, 2);

  await tab(page, '裁切').click();
  await expect(page.locator('.editor-stage .frame.crop-mode')).toHaveCount(1);
  await expect(page.getByRole('group', { name: '裁切框' })).toBeVisible();
  await expect(option(page, '自由')).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, '還原')).toHaveAttribute('aria-disabled', 'true');
  const slider = page.getByRole('slider', { name: '拉直' });
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await expect(slider).toHaveAttribute('aria-valuetext', '0°');

  await option(page, '1:1').click();
  await expect(option(page, '1:1')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '美膚').click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1, 2);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1000 / 1500, 2);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1, 2);

  await tab(page, '裁切').click();
  await expect(option(page, '1:1')).toHaveAttribute('aria-selected', 'true'); // derived from the crop
  await expect(option(page, '還原')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '還原').click();
  await tab(page, '美膚').click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1000 / 1500, 2);
  expect((await debugState(page)).lastError).toBeNull();
});

// S §2.1: the inset keeps a handle on the photo's edge reachable, and 重置 / 按住對比 stay in this mode, so the
// pills must not sit over a corner's 44 × 44 hit target (portrait photos fill the stage height)
for (const [name, file] of [
  ['sample_face', SAMPLE_FACE],
  ['fullbody', 'tests/fixtures/fullbody.jpg'],
] as const) {
  test(`裁切 on ${name}: every corner handle's whole hit target is the handle, not a tool pill`, async ({ page }) => {
    await importInto(page, file);
    await tab(page, '裁切').click();
    await expect(page.getByRole('group', { name: '裁切框' })).toBeVisible();
    await expect(page.getByRole('button', { name: '按住對比' })).toBeVisible(); // the tools stay (S §2.1)
    for (const label of ['左上角', '右上角', '左下角', '右下角']) {
      const hits = await page.getByRole('button', { name: label, exact: true }).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const pts: [number, number][] = [
          [r.left + r.width / 2, r.top + r.height / 2],
          [r.left + 2, r.top + 2],
          [r.right - 2, r.top + 2],
          [r.left + 2, r.bottom - 2],
          [r.right - 2, r.bottom - 2],
        ];
        return pts.map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit === el ? 'self' : (hit?.closest('button')?.textContent?.trim() || hit?.className || String(hit));
        });
      });
      expect(hits, label).toEqual(['self', 'self', 'self', 'self', 'self']);
    }
  });
}

test('增高 lines stay on their rows after 翻轉 and are removed by 旋轉 with a toast', async ({ page }) => {
  await importInto(page, 'tests/fixtures/fullbody.jpg');
  await tab(page, '美體').click();
  await option(page, '增高').click();
  const top = page.locator('.hband-line.top');
  await expect(top).toBeVisible();
  const y0 = (await top.boundingBox())!.y;
  await rowSlider(page).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await expect(rowSlider(page)).toHaveAttribute('aria-valuenow', '20');
  await tab(page, '裁切').click();
  await option(page, '翻轉').click();
  await tab(page, '美體').click();
  await option(page, '增高').click();
  await expect.poll(async () => Math.abs((await top.boundingBox())!.y - y0)).toBeLessThan(1.5);
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await expect(page.getByText('旋轉後已移除增高')).toBeVisible();
  await tab(page, '美體').click();
  await option(page, '增高').click();
  await expect(rowSlider(page)).toHaveAttribute('aria-valuenow', '0');
});

test('旋轉 turns the canvas the short way over 240 ms; nothing animates under prefers-reduced-motion', async ({ page }) => {
  await importInto(page, SAMPLE_FACE);
  await tab(page, '裁切').click();
  /** every inline transform / transition the canvas host gets from now on */
  const watch = () =>
    page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.editor-stage .canvas-host')!;
      const w = window as unknown as { __turns: { transform: string; transition: string }[] };
      w.__turns = [];
      new MutationObserver(() => w.__turns.push({ transform: host.style.transform, transition: host.style.transition })).observe(host, {
        attributes: true,
        attributeFilter: ['style'],
      });
    });
  const turns = () => page.evaluate(() => (window as unknown as { __turns: { transform: string; transition: string }[] }).__turns);
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  await watch();
  for (let i = 0; i < 3; i++) await option(page, '旋轉').click();
  await page.waitForTimeout(600);
  const seen = await turns();
  expect(seen.some((s) => s.transition.includes(EASE))).toBe(true);
  // unwrapped toward the previous angle: 0 → −90 → −180 → −270, never a 270° spin back
  expect(seen.at(-1)!.transform).toContain('rotate(-270deg)');
  expect(seen.at(-1)!.transition).not.toContain(EASE); // the 240 ms window has passed
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watch();
  await option(page, '翻轉').click();
  await page.waitForTimeout(600);
  const reduced = await turns();
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced.every((s) => !s.transition.includes(EASE))).toBe(true);
});

/** sample_face.png turned 90° clockwise (a sideways photo) */
function sidewaysFace(): Buffer {
  const src = PNG.sync.read(readFileSync(SAMPLE_FACE));
  const out = new PNG({ width: src.height, height: src.width });
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = (x * out.width + (out.width - 1 - y)) * 4;
      src.data.copy(out.data, d, s, s + 4);
    }
  return PNG.sync.write(out);
}

test('a sideways photo: 旋轉 and 翻轉 run no detector; leaving 裁切 scans the new up-frame once', async ({ page }) => {
  await importInto(page, { name: 'sideways.png', mimeType: 'image/png', buffer: sidewaysFace() });
  const before = await debugState(page);
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await option(page, '翻轉').click();
  await option(page, '翻轉').click();
  expect((await debugState(page)).detectCalls).toBe(before.detectCalls);
  await tab(page, '美膚').click();
  if (before.faces === 0) {
    await expect.poll(async () => (await debugState(page)).detectCalls).toBe(before.detectCalls + 1);
    await expect.poll(async () => (await debugState(page)).faces).toBe(1);
  } else {
    await page.waitForTimeout(1500);
    expect((await debugState(page)).detectCalls).toBe(before.detectCalls);
  }
});

/** a face-free grey gradient (as persons.spec.ts / editor.spec.ts noFacePng) */
function noFacePng(): Buffer {
  const png = new PNG({ width: 600, height: 800 });
  for (let i = 0; i < 600 * 800; i++) {
    const v = 90 + Math.round((70 * ((i % 600) + Math.floor(i / 600))) / 1400);
    png.data.set([v, v, v + 6, 255], i * 4);
  }
  return PNG.sync.write(png);
}

test('nobody found upright: each new up-frame is scanned once on leaving 裁切; 翻轉, scanned up-frames and ↶ run no detector', async ({ page }) => {
  await importInto(page, { name: 'noface.png', mimeType: 'image/png', buffer: noFacePng() });
  const before = await debugState(page);
  expect(before.faces).toBe(0);
  const calls = async () => (await debugState(page)).detectCalls;
  // whether 正在重新偵測臉部… showed at any point (it may be up for well under a poll interval)
  await page.evaluate(() => {
    const w = window as unknown as { __scanSeen: boolean };
    w.__scanSeen = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes('正在重新偵測臉部…')) w.__scanSeen = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const ready = () => expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });

  // 旋轉 → up-frame 3: nothing in 裁切, one scan on leaving
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await page.waitForTimeout(300);
  expect(await calls()).toBe(before.detectCalls);
  await tab(page, '美膚').click();
  await expect.poll(calls).toBe(before.detectCalls + 1);
  expect(await page.evaluate(() => (window as unknown as { __scanSeen: boolean }).__scanSeen)).toBe(true);
  await ready();
  expect((await debugState(page)).faces).toBe(0);

  // 翻轉 keeps the up-frame; one more 旋轉 is upright again (scanned when the photo opened): no scan
  await tab(page, '裁切').click();
  await option(page, '翻轉').click();
  await option(page, '旋轉').click();
  await tab(page, '美膚').click();
  await page.waitForTimeout(1000);
  expect(await calls()).toBe(before.detectCalls + 1);

  // a new up-frame (1), turned and mirrored back and forth in 裁切: one scan on leaving
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await option(page, '翻轉').click();
  await option(page, '翻轉').click();
  await page.waitForTimeout(300);
  expect(await calls()).toBe(before.detectCalls + 1);
  await tab(page, '美膚').click();
  await expect.poll(calls).toBe(before.detectCalls + 2);
  await ready();

  // ↶ through every step back to the photo as opened: every up-frame on the way was scanned
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '復原' }).click();
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
  await page.waitForTimeout(1000);
  expect(await calls()).toBe(before.detectCalls + 2);
  expect((await debugState(page)).lastError).toBeNull();
});

test('a larger picked photo is kept in 最近編輯 with its size; a reopen still has it', async ({ page }) => {
  await page.goto('/');
  const jpeg = await makeJpeg(page, 3000, 4000);
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const rows = await readHistory(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].sourceSize).toBe(jpeg.length);
  expect([rows[0].sourceWidth, rows[0].sourceHeight]).toEqual([3000, 4000]);
});

const knob = (page: Page, value: object) => page.evaluate((v) => localStorage.setItem('meiyan.debug.export.v1', JSON.stringify(v)), value);

/** every toast text shown from now on (a toast lasts 4 s, and an export on SwiftShader can outlive it) */
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

test('原始解析度: a tiled export keeps the picked size; 標準 is the working size; a failure falls back once', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  const full = await exportFile(page);
  expect([full.width, full.height, full.type]).toEqual([2400, 3200, 'image/jpeg']);
  expect((await debugState(page)).export).toMatchObject({ mode: 'tiled', width: 2400, height: 3200 });
  await closeFallback(page);

  // slowMs makes the fallback finish after the 4 s window, so its file is delivered through the 「分享」 pill
  await knob(page, { failAt: 'tile', slowMs: 4500 });
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight'); // an edit: the cached file no longer matches
  await watchToasts(page);
  // a fallback slower than 4 s ends in 「分享」: exportFile's second tap must then share that file (Review Focus 5)
  const fell = await exportFile(page);
  expect(await toastsSeen(page)).toContain('已改用標準解析度輸出');
  expect([fell.width, fell.height]).toEqual([1536, 2048]);
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).toBeNull();
});

test('a slow tiled export turns the pill into 分享; the second tap shares', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await knob(page, { slowMs: 4500, tile: 2048 });
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  await page.locator('.topbar .pill').click();
  await expect(page.locator('.topbar .pill', { hasText: '分享' })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('已準備好，點一下分享')).toBeVisible();
  await page.locator('.topbar .pill', { hasText: '分享' }).click();
  await expect(page.getByRole('dialog', { name: '儲存照片' })).toBeVisible();
});

test('going to the background mid-export aborts it, frees it and says so on return', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await knob(page, { slowMs: 4500, tile: 2048 });
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  await page.locator('.topbar .pill').click();
  await expect(page.getByText('正在輸出原始解析度…')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).not.toBeNull();
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).toBeNull();
  await expect(page.locator('.topbar .pill')).toHaveText('儲存');
  expect((await debugState(page)).export).toBeNull();
  await setVisibility('visible');
  await expect(page.getByText('輸出已中斷，請再按一次「儲存」')).toBeVisible();
});
