// Records the v0.3 parity goldens (RM §8.3): tests/e2e/pages/parity.html rendered by headless Chromium with the same
// SwiftShader flags as the e2e suite, served by a Vite dev server on a free port. Run on 892ea61 only.
//   node scripts/record-parity.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'fixtures', 'parity-v03');
const ARGS = ['--enable-unsafe-swiftshader'];

async function launch() {
  try {
    return await chromium.launch({ args: ARGS });
  } catch (e) {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const revs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const rev of revs.reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p = join(base, rev, exe);
        if (existsSync(p)) return chromium.launch({ executablePath: p, args: ARGS });
      }
    }
    throw e;
  }
}

// configFile false: no preact / PWA plugins, so the dependency scan crawls only the parity page (not index.html)
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  optimizeDeps: { entries: ['tests/e2e/pages/parity.html'] },
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/tests/e2e/pages/parity.html`);
  await page.waitForFunction(() => typeof window.runParity === 'function', null, { timeout: 60_000 });
  const r = await page.evaluate(() => window.runParity());
  mkdirSync(out, { recursive: true });
  for (const [name, url] of Object.entries(r.png)) {
    writeFileSync(join(out, `${name}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(`wrote tests/fixtures/parity-v03/${name}.png`);
  }
  console.log(`renderer: ${r.renderer}`);
} finally {
  await browser.close();
  await server.close();
}
