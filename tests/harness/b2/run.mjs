// B2 harness driver: `node tests/harness/b2/run.mjs` regenerates baseline/ from the pre-美體 commit, starts its
// own Vite on :5402 (no HMR), runs window.runB2() in headless Chromium and writes PNGs + results.json
// to tests/harness/b2/out/. Exit code 1 when any check fails.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });
execFileSync(process.execPath, [join(here, 'make-baseline.mjs')], { stdio: 'inherit' });

const server = await createServer({ configFile: join(here, 'vite.config.mjs'), server: { port: 5402, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let code = 1;
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  const consoleLines = [];
  page.on('console', (m) => {
    consoleLines.push(`[${m.type()}] ${m.text()}`);
    if (process.env.B2_VERBOSE) console.log(`  [page ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
  await page.goto('http://localhost:5402/tests/harness/b2/index.html');
  await page.waitForFunction(() => typeof window.runB2 === 'function', null, { timeout: 60_000 });
  page.setDefaultTimeout(600_000);
  const r = await page.evaluate(() => window.runB2());
  for (const [k, v] of Object.entries(r.shots)) writeFileSync(join(outDir, `${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  // SwiftShader's 'GPU stall due to ReadPixels' performance note is expected (every check reads back)
  const glWarnings = consoleLines.filter((l) => /WebGL|GL_INVALID|RENDER WARNING/i.test(l) && !/GPU stall due to ReadPixels/.test(l));
  const unexpected = consoleLines.filter((l) => /^\[(error|pageerror)\]/.test(l));
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ renderer: r.renderer, checks: r.checks, errors: r.errors, timings: r.timings, glWarnings, console: consoleLines }, null, 2));
  console.log(`renderer: ${r.renderer}`);
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`);
  for (const e of r.errors) console.log(`ERROR ${e}`);
  console.log(`GL console warnings: ${glWarnings.length ? glWarnings.join('\n') : 'none'}`);
  console.log(`console errors: ${unexpected.length ? unexpected.join('\n') : 'none'}`);
  const failed = r.checks.filter((c) => !c.ok).length + r.errors.length + glWarnings.length + unexpected.length;
  console.log(`\n${r.checks.length - r.checks.filter((c) => !c.ok).length}/${r.checks.length} checks passed`);
  code = failed ? 1 : 0;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
