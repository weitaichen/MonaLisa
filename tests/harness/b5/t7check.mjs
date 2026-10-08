// Smoke check that the T7 fake deps (tests/harness/t7/fakes.ts) still drive the editor's 美體 tab.
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const BASE = process.argv[2] ?? 'http://localhost:5405';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
for (const pose of ['', 'none']) {
  await page.goto(`${BASE}/tests/harness/t7/index.html?assets=instant${pose ? `&pose=${pose}` : ''}`);
  await page.waitForFunction(() => window.__harnessReady);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(resolve(import.meta.dirname, '../../fixtures/fullbody.jpg'));
  await page.getByRole('tab', { name: '美體' }).click();
  await page.waitForFunction(() => !document.querySelector('.body-note.progress'), null, { timeout: 30_000 });
  await page.waitForTimeout(300);
  const note = await page.locator('.body-note').textContent().catch(() => null);
  const slim = await page.getByRole('option', { name: '瘦身', exact: true }).getAttribute('aria-disabled');
  console.log(`pose=${pose || 'fixture'}: note=${note} 瘦身 disabled=${slim}`);
  await page.screenshot({ path: resolve(import.meta.dirname, `shots/t7-${pose || 'fixture'}.png`) });
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
