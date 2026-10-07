// T8 harness runner for still.html (vite must serve the repo on :5188).
// Usage: node tests/harness/t8/run-still.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const outDir = resolve(process.argv[2] ?? 'tests/harness/t8/out');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 520 } })).newPage();
const logs = [];
page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e) }));

await page.goto('http://localhost:5188/tests/harness/t8/still.html');
await page.waitForFunction(() => window.__t8?.done === true, null, { timeout: 90000 });
await page.screenshot({ path: resolve(outDir, 'still-compare.png') });
await page.evaluate(() => window.dispatchEvent(new Event('t8-release')));
await page.waitForFunction(() => window.__t8?.afterDisposeOk === true || window.__t8?.error, null, { timeout: 10000 });
const result = await page.evaluate(() => window.__t8);
console.log(
  JSON.stringify(
    { result, errors: logs.filter((m) => m.type === 'error' || m.type === 'pageerror') },
    null,
    2,
  ),
);
await browser.close();
