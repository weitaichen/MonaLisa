// B2 harness driver: `node tests/harness/b2/run.mjs` starts its own Vite on :5402 (no HMR), runs window.runB2() in
// headless Chromium and writes PNGs + results.json to tests/harness/b2/out/. Exit code 1 when any check fails.
// (baseline/ is no longer generated: check 1 is reported SKIP since RenderInput v0.4, and a generated copy of the v0.3 engine
// would fail `npm run typecheck`; make-baseline.mjs stays for checking out an older tree.)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

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
  for (const c of r.checks) console.log(`${c.skipped ? 'SKIP' : c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n      ${c.detail}`);
  for (const e of r.errors) console.log(`ERROR ${e}`);
  console.log(`GL console warnings: ${glWarnings.length ? glWarnings.join('\n') : 'none'}`);
  console.log(`console errors: ${unexpected.length ? unexpected.join('\n') : 'none'}`);
  const failed = r.checks.filter((c) => !c.ok).length + r.errors.length + glWarnings.length + unexpected.length;
  // a skipped check is neither passed nor failed: it stays out of the count and is named after it
  const ran = r.checks.filter((c) => !c.skipped);
  const skipped = r.checks.filter((c) => c.skipped).map((c) => c.name.split(' ')[0]);
  console.log(`\n${ran.length - ran.filter((c) => !c.ok).length}/${ran.length} checks passed${skipped.length ? `, ${skipped.length} skipped (${skipped.join(' ')})` : ''}`);
  code = failed ? 1 : 0;
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
