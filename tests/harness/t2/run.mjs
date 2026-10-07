// Runs the T2 harness page in headless Chromium and writes out/*.png + out/results.json.
// Expects `npx vite --port 5182 --strictPort` serving the repo root.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const url = process.env.T2_URL ?? 'http://localhost:5182/tests/harness/t2/index.html';
const outDir = new URL('./out/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__t2?.done === true, null, { timeout: 300_000 });
const r = await page.evaluate(() => window.__t2);
await browser.close();

for (const [name, dataUrl] of Object.entries(r.images)) {
  writeFileSync(new URL(`${name}.png`, outDir), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
writeFileSync(new URL('results.json', outDir), JSON.stringify({ checks: r.checks, metrics: r.metrics, error: r.error }, null, 2));
for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`);
console.log('metrics', JSON.stringify(r.metrics, null, 1));
if (r.error) console.log('ERROR', r.error);
const errs = consoleLines.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log(errs.join('\n'));
const failed = r.checks.filter((c) => !c.pass).length;
console.log(`${r.checks.length - failed}/${r.checks.length} checks passed; images: ${Object.keys(r.images).join(', ')}`);
process.exit(failed || r.error ? 1 : 0);
