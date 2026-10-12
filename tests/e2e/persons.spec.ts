// Persons in the photo editor (S §8.4): the group fixture's faces, the primary, the cached detection.
import { debugState, expect, GROUP_FACES, importFixture, test } from './fixtures';

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
