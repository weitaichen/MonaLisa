// Drives bench.html's 美體偵測 section in headless Chromium against a running vite (port 5403 by default):
// picks a fixture photo, waits for all 8 configurations, prints the table and the 複製結果 text, saves a screenshot.
//   npx vite --port 5403 --strictPort --host 127.0.0.1  &&  node tests/harness/b3/bench.mjs [photo] [port]
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const photo = resolve(root, process.argv[2] ?? 'tests/fixtures/fullbody.jpg');
const port = process.argv[3] ?? '5403';
const out = resolve(root, 'tests/harness/b3/out');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: (process.env.GPU_ARGS ?? '').split(' ').filter(Boolean) });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${port}` });
const page = await ctx.newPage();
const errors = [];
const external = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('INFO:')) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.protocol !== 'blob:' && u.protocol !== 'data:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') external.push(r.url());
});
await page.goto(`http://127.0.0.1:${port}/bench.html`);
const inputs = page.locator('input[type=file]');
await inputs.nth(1).setInputFiles(photo); // [0] = 靜態圖片測試, [1] = 美體偵測
const t0 = Date.now();
await page.locator('.body-bench button', { hasText: '複製結果' }).waitFor({ state: 'visible', timeout: 240_000 });
console.log(`body bench finished in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(await page.locator('.body-bench').innerText());
await page.screenshot({ path: resolve(out, 'bench_body.png'), fullPage: true });
await page.locator('.body-bench button', { hasText: '複製結果' }).click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `clipboard failed: ${e}`));
console.log('--- 複製結果 ---\n' + clip);
console.log('--- console errors ---\n' + (errors.join('\n') || '(none)'));
console.log('--- non-localhost requests ---\n' + (external.join('\n') || '(none)'));
await browser.close();
