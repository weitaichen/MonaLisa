// T8 harness phase 2: bench controls against the real modules — 全部 mode, hold-to-compare,
// camera interruption → 恢復相機, delegate restart. vite must serve the repo on :5188.
// Usage: node tests/harness/t8/run-bench2.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const outDir = resolve(process.argv[2] ?? 'tests/harness/t8/out');
mkdirSync(outDir, { recursive: true });
const y4m = resolve('tests/fixtures/face.y4m');

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['camera'] })).newPage();
const logs = [];
page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e) }));
const dbg = () => page.evaluate(() => ({ ...(window.__meiyan ?? {}) }));
const out = {};

await page.goto('http://localhost:5188/bench.html');
await page.getByRole('button', { name: '開始' }).click();
await page.waitForFunction(() => window.__meiyan?.face === true, null, { timeout: 60000 });
await page.getByRole('button', { name: 'M', exact: true }).click();

await page.getByRole('button', { name: '全部' }).click();
await page.waitForTimeout(2500);
out.all = await dbg();
await page.screenshot({ path: resolve(outDir, 'bench-all.png') });

const cmp = page.getByRole('button', { name: '按住對比' });
const box = await cmp.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(outDir, 'bench-compare.png') });
await page.mouse.up();

// simulate returning from the background with a dead track (track.stop() fires no 'ended' in Chrome):
// the camera's foreground health check (≈800 ms) → 'interrupted' → loop pauses
await page.evaluate(() => {
  document.querySelector('video')?.srcObject?.getVideoTracks()[0]?.stop();
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(2000);
out.interrupted = await dbg();
out.resumeVisible = await page.getByRole('button', { name: '恢復相機' }).isVisible();
await page.getByRole('button', { name: '恢復相機' }).click();
await page.waitForFunction(() => window.__meiyan?.cameraState === 'live' && window.__meiyan?.fps > 0, null, {
  timeout: 20000,
});
await page.waitForTimeout(2000);
out.resumed = await dbg();

await page.getByRole('button', { name: '改用 CPU 重啟' }).click();
await page.waitForFunction(() => window.__meiyan?.delegate === 'CPU', null, { timeout: 60000 });
await page.waitForTimeout(3000);
out.cpu = await dbg();
out.note = await page.locator('.panel .note').textContent();

await page.getByRole('button', { name: '靜態圖片測試' }).click();
await page.waitForTimeout(1500);
out.stillNote = await page.locator('.panel .note').textContent();

await page.getByRole('button', { name: '複製結果' }).click();
await page.waitForTimeout(500);
out.copyNote = await page.locator('.panel .note').textContent();
out.copyAreaVisible = await page.locator('textarea').isVisible();
out.copyText = out.copyAreaVisible ? (await page.locator('textarea').inputValue()).split('\n').slice(0, 14) : null;

out.errors = logs.filter((m) => m.type === 'error' || m.type === 'pageerror');
console.log(JSON.stringify(out, null, 2));
await browser.close();
