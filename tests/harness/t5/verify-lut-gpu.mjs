// T5 harness: prove the LUT PNGs + 64³ lookup behave identically on a real WebGL2 path.
//  1. identity LUT (built by gen-luts' buildLut, written to tests/harness/t5/identity_lut.png,
//     never shipped): the GPU must reproduce every one of the 256³ inputs (max diff ≤ 1, report exact count).
//  2. every shipped LUT: GPU output on sampled colours vs the Node lookup64() of the same PNG.
// Starts vite on the T5 port (5185) and stops it afterwards.
// Usage: node tests/harness/t5/verify-lut-gpu.mjs
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { FILTER_IDS, LUT_DIM, buildLut, encodePng, identity, lookup64 } from '../../../scripts/gen-luts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const PORT = 5185;

writeFileSync(join(here, 'identity_lut.png'), encodePng(buildLut(identity), LUT_DIM, LUT_DIM));

const vite = spawn(`npx vite --port ${PORT} --strictPort`, { cwd: root, shell: true, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite did not start')), 60000);
  vite.stdout.on('data', (d) => {
    if (String(d).includes(`${PORT}`)) {
      clearTimeout(t);
      resolve();
    }
  });
  vite.on('exit', (c) => reject(new Error(`vite exited ${c}`)));
});

let failed = false;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/tests/harness/t5/lut-gpu.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });

  const STEP = 97;
  const id = await page.evaluate((s) => window.runLut('/tests/harness/t5/identity_lut.png', s), STEP);
  console.log(`renderer: ${id.renderer}`);
  console.log(
    `identity LUT on GPU over 256³ colours: glError ${id.glError}, max |out−in| ${id.maxDiffVsInput}, channels differing ${id.mismatches} / ${256 ** 3 * 3}`,
  );
  if (id.glError !== 0 || id.maxDiffVsInput > 1) failed = true;

  for (const fid of FILTER_IDS) {
    const r = await page.evaluate(([u, s]) => window.runLut(u, s), [`/luts/filters/${fid}.png`, STEP]);
    const lut = PNG.sync.read(readFileSync(join(root, 'public', 'luts', 'filters', `${fid}.png`)));
    const buf = Buffer.from(r.samples, 'base64');
    let max = 0;
    let sum = 0;
    const t = [0, 0, 0];
    const n = buf.length / 6;
    for (let k = 0; k < n; k++) {
      const o = k * 6;
      lookup64(lut.data, buf[o] / 255, buf[o + 1] / 255, buf[o + 2] / 255, t);
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(Math.round(t[c] * 255) - buf[o + 3 + c]);
        sum += d;
        if (d > max) max = d;
      }
    }
    console.log(`${fid.padEnd(9)} GPU vs Node lookup64 on ${n} colours: max ${max}, mean ${(sum / (n * 3)).toFixed(4)}, glError ${r.glError}`);
    if (r.glError !== 0 || max > 1) failed = true;
  }
} finally {
  await browser.close();
  // npx runs vite under a shell: kill the whole tree, or it keeps the port (and this process) alive
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F']);
  else vite.kill('SIGTERM');
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
