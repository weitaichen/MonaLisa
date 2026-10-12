// Runs the bench 「多臉」 rows on this desktop and prints them as Markdown for spec §6.4. Tries a headed Chrome with
// the GPU first (timings), falls back to headless SwiftShader (marked "not representative").
//   node scripts/bench-multiface.mjs D B GL
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['D', 'B', 'GL'];
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
let browser;
let gpu = true;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist'] });
} catch {
  gpu = false;
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
}
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/bench.html?fixtures=1`);
  await page.waitForFunction(() => !!window.__benchMulti, null, { timeout: 120_000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });
  const rows = await page.evaluate((list) => window.__benchMulti.run(list), ids);
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n#### ${date} desktop ${gpu ? 'Chrome (GPU)' : 'Chromium SwiftShader (not representative)'} — ${renderer}\n`);
  console.log('| Row | Config | Values |\n|---|---|---|');
  for (const r of rows) console.log(`| ${r.row} | ${r.config} | ${Object.entries(r.values).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
} finally {
  await browser.close();
  await server.close();
}
