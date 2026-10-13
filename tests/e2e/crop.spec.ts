// 裁切／旋轉／翻轉 and full-resolution export in the app (S §8.2). Imports go through the file chooser like a user's.
import type { Page } from '@playwright/test';
import { debugState, expect, SAMPLE_FACE, test } from './fixtures';

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
