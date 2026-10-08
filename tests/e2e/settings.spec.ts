import { expect, shot, test } from './fixtures';

test('settings toggles persist across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  const sheet = page.getByRole('dialog', { name: '設定' });
  await expect(sheet).toBeVisible();
  // aria-modal: focus starts inside the dialog
  await expect(sheet).toBeFocused();
  await shot(page, '20-settings');

  const mirror = sheet.getByRole('switch', { name: /儲存時鏡像/ });
  const landmarks = sheet.getByRole('switch', { name: /顯示臉部特徵點/ });
  const match = sheet.getByRole('switch', { name: /對齊 GPUPixel/ });
  const tier = sheet.getByRole('radiogroup', { name: '畫質' });

  // defaults
  await expect(mirror).toHaveAttribute('aria-checked', 'true');
  await expect(landmarks).toHaveAttribute('aria-checked', 'false');
  await expect(match).toHaveAttribute('aria-checked', 'false');
  await expect(tier.getByRole('radio', { name: '自動' })).toHaveAttribute('aria-checked', 'true');

  await mirror.click();
  await landmarks.click();
  await tier.getByRole('radio', { name: '中' }).click();
  await expect(mirror).toHaveAttribute('aria-checked', 'false');
  await expect(landmarks).toHaveAttribute('aria-checked', 'true');
  await expect(tier.getByRole('radio', { name: '中' })).toHaveAttribute('aria-checked', 'true');
  await shot(page, '21-settings-changed');

  await page.reload();
  await page.getByRole('button', { name: '設定' }).click();
  const after = page.getByRole('dialog', { name: '設定' });
  await expect(after.getByRole('switch', { name: /儲存時鏡像/ })).toHaveAttribute('aria-checked', 'false');
  await expect(after.getByRole('switch', { name: /顯示臉部特徵點/ })).toHaveAttribute('aria-checked', 'true');
  await expect(after.getByRole('switch', { name: /對齊 GPUPixel/ })).toHaveAttribute('aria-checked', 'false');
  await expect(after.getByRole('radiogroup', { name: '畫質' }).getByRole('radio', { name: '中' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.prefs.v1') ?? 'null'));
  expect(stored).toMatchObject({ mirrorOnSave: false, showLandmarks: true, tier: 'M', matchGpupixel: false });
});

test('credits list GPUPixel and MediaPipe; privacy statement shown', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('button', { name: /關於與授權/ }).click();
  const credits = page.getByRole('dialog', { name: '關於與授權' });
  await expect(credits).toBeVisible();
  // each entry: name + licence badge
  const names = credits.locator('.credit-name');
  await expect(names.filter({ hasText: /^GPUPixel\s*Apache-2\.0$/ })).toBeVisible();
  await expect(names.filter({ hasText: /^MediaPipe .*Apache-2\.0$/ })).toBeVisible();
  await expect(names.filter({ hasText: /^GPUImage\s*BSD-3-Clause$/ })).toBeVisible();
  await expect(names.filter({ hasText: /^Workbox\s*MIT$/ })).toBeVisible();
  await expect(credits.getByText(/未使用其任何程式碼或素材/)).toBeVisible();
  // the credits page opens at the top and has focus, whatever the settings page was scrolled to
  await expect(credits).toBeFocused();
  expect(await credits.locator('.sheet-body').evaluate((el) => el.scrollTop)).toBe(0);
  await shot(page, '22-credits');

  // the full license texts ship in the app (expandable) and on the site (/licenses/*.txt)
  const gpuimage = credits.locator('.credit', { has: page.locator('.credit-name', { hasText: /^GPUImage\s*BSD/ }) });
  await gpuimage.getByText('授權條款全文').click();
  await expect(gpuimage.locator('pre')).toContainText('ARE DISCLAIMED');
  const mediapipe = credits.locator('.credit', { has: page.locator('.credit-name', { hasText: /^MediaPipe/ }) });
  await mediapipe.getByText('授權條款全文').click();
  await expect(mediapipe.locator('pre')).toContainText(/Apache License\s+Version 2\.0/);
  await expect(mediapipe.locator('.credit-body')).toContainText('Pose Landmarker');
  for (const [file, needle] of [
    ['GPUPixel-Apache-2.0.txt', 'Apache License'],
    ['GPUImage-BSD-3-Clause.txt', 'THIS SOFTWARE IS PROVIDED'],
    ['Preact-MIT.txt', 'Permission is hereby granted'],
    ['NOTICE.txt', 'lip_mask.png'],
    ['NOTICE.txt', '/models/pose_landmarker/'],
  ]) {
    const res = await page.request.get(`/licenses/${file}`);
    expect(res.status(), file).toBe(200);
    expect(await res.text()).toContain(needle);
  }

  await credits.getByRole('button', { name: '返回設定' }).click();
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  // Escape closes the sheet and focus returns to the gear that opened it
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '設定' })).toBeFocused();
});
