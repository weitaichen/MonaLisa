// T7 audits: (1) every interactive element's hit box ≥ 44×44 CSS px on each screen;
// (2) layout under simulated iPhone safe-area insets (59 top / 34 bottom) — screenshots.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5187/tests/harness/t7/index.html';
const y4m = resolve('tests/fixtures/face.y4m');
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
if (existsSync(y4m)) args.push(`--use-file-for-fake-video-capture=${y4m}`);
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark' });
const INSETS = ':root{--sat:59px !important;--sab:34px !important}';

async function audit(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="slider"], input:not([type="file"]):not([type="checkbox"])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
      if (r.width < 43.5 || r.height < 43.5)
        out.push(`${el.className || el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 12)}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
    }
    return out;
  });
  console.log(`${label}: ${small.length ? 'SMALL → ' + small.join(' | ') : 'all ≥ 44'}`);
}

const page = await ctx.newPage();
await page.goto(`${BASE}?assets=instant&history=4&hint=1`);
await page.waitForFunction(() => window.__harnessReady === true);
await page.waitForTimeout(2500);
await audit(page, 'home');
await page.getByRole('button', { name: '編輯', exact: true }).click();
await page.locator('.thumb-x').first().click();
await audit(page, 'home-delete-confirm');
await page.getByRole('button', { name: '取消', exact: true }).click();
await page.getByRole('button', { name: '完成', exact: true }).click();
await page.addStyleTag({ content: INSETS });
await page.screenshot({ path: 'tests/harness/t7/shots/50-insets-home.png' });
await page.getByRole('button', { name: '設定', exact: true }).click();
await page.waitForTimeout(400);
await audit(page, 'settings');
await page.screenshot({ path: 'tests/harness/t7/shots/51-insets-settings.png' });
await page.getByRole('button', { name: '完成', exact: true }).click();
await page.locator('.tile.primary').click();
await page.getByText('點擊開啟相機').click();
await page.waitForSelector('.shutter:not([disabled])');
await page.waitForTimeout(500);
for (const t of ['一鍵', '美膚', '美型', '濾鏡', '美妝']) {
  await page.getByRole('tab', { name: t }).click();
  await audit(page, `camera/${t}`);
}
await page.screenshot({ path: 'tests/harness/t7/shots/52-insets-camera.png' });
await page.getByRole('button', { name: '拍照' }).click();
await page.waitForTimeout(800);
await audit(page, 'review');
await page.screenshot({ path: 'tests/harness/t7/shots/53-insets-review.png' });
await page.getByRole('button', { name: '編輯', exact: true }).click();
await page.waitForSelector('.pill:not([disabled])');
await page.waitForTimeout(500);
await audit(page, 'editor');
await page.screenshot({ path: 'tests/harness/t7/shots/54-insets-editor.png' });
await browser.close();
