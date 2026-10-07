// T8 harness: drive bench.html in headless Chromium with a fake camera fed from tests/fixtures/face.y4m.
// Usage (vite must be serving the repo on :5188):  node tests/harness/t8/run-bench.mjs [seconds] [outDir]
// Prints a JSON report: __meiyan snapshots over time, HUD text, console errors; saves screenshots.
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const seconds = Number(process.argv[2] ?? 12);
const outDir = resolve(process.argv[3] ?? 'tests/harness/t8/out');
mkdirSync(outDir, { recursive: true });
const y4m = resolve('tests/fixtures/face.y4m');
if (!existsSync(y4m)) throw new Error(`missing ${y4m}`);

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, permissions: ['camera'] });
const page = await context.newPage();
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

await page.goto('http://localhost:5188/bench.html', { waitUntil: 'load' });
await page.getByRole('button', { name: '開始' }).click();

const timeline = [];
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({ ...(window.__meiyan ?? {}) }));
  const gate = await page.locator('.gate .note').textContent().catch(() => '');
  timeline.push({ t: Math.round((Date.now() - t0) / 1000), ...s, gate });
}

const hud = await page.locator('.hud pre').first().textContent();
const hudErr = await page.locator('.hud pre.err').textContent();
await page.screenshot({ path: resolve(outDir, 'bench-live.png') });

// exercise the controls once: capture test, landmarks overlay, tier switch, compare
await page.getByRole('button', { name: '擷取測試' }).click();
await page.waitForTimeout(1500);
const captureNote = await page.locator('.panel .note').textContent();
await page.getByRole('button', { name: '特徵點' }).click();
await page.getByRole('button', { name: 'L', exact: true }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(outDir, 'bench-landmarks-L.png') });
const afterL = await page.evaluate(() => ({ ...(window.__meiyan ?? {}) }));

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas.view');
  return c ? { width: c.width, height: c.height } : null;
});

// canvas pixels: read back via a 2D copy (preserveDrawingBuffer is false, so copy right after a frame)
const pixelStats = await page.evaluate(
  () =>
    new Promise((res) => {
      const c = document.querySelector('canvas.view');
      const v = document.querySelector('video');
      const go = () => {
        const tmp = document.createElement('canvas');
        tmp.width = 64;
        tmp.height = 64;
        const g = tmp.getContext('2d');
        g.drawImage(c, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        let max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l;
          max = Math.max(max, l);
        }
        res({ meanLuma: sum / (d.length / 4), maxLuma: max });
      };
      if (v && v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => setTimeout(go, 0));
      else go();
    }),
);

console.log(
  JSON.stringify(
    {
      timeline,
      hud,
      hudErr,
      captureNote,
      afterL,
      canvasInfo,
      pixelStats,
      errors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror'),
      warnings: consoleMsgs.filter((m) => m.type === 'warning').slice(0, 20),
      logCount: consoleMsgs.length,
    },
    null,
    2,
  ),
);
await browser.close();
