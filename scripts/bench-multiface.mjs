// Runs the bench 「多臉」 rows on this desktop and prints them as Markdown for spec §6.4. Tries a headed Chrome with
// the GPU first (timings), falls back to headless SwiftShader (marked "not representative").
//   node scripts/bench-multiface.mjs D B GL
//   node scripts/bench-multiface.mjs --video tests/fixtures/group.y4m L   (the camera rows L, J, J2 read a fake camera fed by a y4m)
//   node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m L    (one face in view: L gives PL2; group.y4m gives PL1)
// The camera per-person rows (spec 2026-10-19 §10, §12.4):
//   node scripts/bench-multiface.mjs --video tests/fixtures/group10.y4m LFC   (option C at 10 faces: each delegate's longest_ms bounds its PGN)
//   node scripts/bench-multiface.mjs --upright --option-c GPU=<ms>,CPU=<ms> --video tests/fixtures/upright_far10.y4m LF   (PGN)
//     GPU= the longest_ms of LFC's GPU row (config "GPU back option C …"), CPU= that of its CPU row
//   node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m LF       (PLB: one face, back camera)
//   node scripts/bench-multiface.mjs --upright --video tests/fixtures/selfie_group.y4m GS   (PGS)
//   node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m WB       (PWB: run it alone, on a fresh page)
//   node scripts/bench-multiface.mjs --video tests/fixtures/tile_face.y4m JG  (PJ1G jitter, whole and tile; made by gen-y4m.mjs --layout tile_face)
//   node scripts/bench-multiface.mjs --video tests/fixtures/group_pan.y4m JG  (PJ1G lag)
// --upright: the camera rows ask for 1080 × 1920 (a portrait clip is otherwise centre-cropped to landscape);
// --option-c GPU=<ms>,CPU=<ms>: PGN's longest-frame bound per delegate, LFC's row on the same delegate (report.ts
// parseOptionC; `:` for `=`, one delegate may be left out, a bare <ms> bounds both; a delegate without one: not judged).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { parseOptionC } from '../src/bench/report.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** flags followed by a value; they and their values are not row ids */
const VALUED = new Set(['--video', '--option-c']);
const valueOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const video = valueOf('--video') ? resolve(root, valueOf('--video')) : null;
const optionC = process.argv.includes('--option-c') ? parseOptionC(valueOf('--option-c') ?? '') : null;
if (process.argv.includes('--option-c') && !optionC) {
  console.error(`--option-c needs GPU=<ms>,CPU=<ms> (row LFC's longest_ms on each delegate; one may be left out) or one <ms> for both, got ${valueOf('--option-c')}`);
  process.exit(2);
}
/** [delegate, ms] per bound given */
const bounds = Object.entries(optionC ?? {});
const upright = process.argv.includes('--upright');
const args = process.argv.slice(2).filter((a, i, all) => !VALUED.has(a) && !VALUED.has(all[i - 1]) && a !== '--upright');
const fakeCam = video ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + video] : [];
const ids = args.length ? args : ['D', 'B', 'GL'];
const query = ['fixtures=1', ...(upright ? ['upright=1'] : []), ...(bounds.length ? [`optionC=${encodeURIComponent(bounds.map(([d, ms]) => `${d}:${ms}`).join(','))}`] : [])].join('&');
const server = await createServer({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
let browser;
let gpu = true;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist', ...fakeCam] });
} catch {
  gpu = false;
  browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', ...fakeCam] });
}
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/bench.html?${query}`);
  await page.waitForFunction(() => !!window.__benchMulti, null, { timeout: 120_000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });
  const rows = await page.evaluate((list) => window.__benchMulti.run(list), ids);
  const date = new Date().toISOString().slice(0, 10);
  const extra = [video ? `video ${process.argv[process.argv.indexOf('--video') + 1]}` : null, upright ? 'upright 1080×1920' : null, bounds.length ? `option C bound ${bounds.map(([d, ms]) => `${d} ${ms} ms`).join(', ')}` : null].filter(Boolean);
  console.log(`\n#### ${date} desktop ${gpu ? 'Chrome (GPU)' : 'Chromium SwiftShader (not representative)'} — ${renderer}${extra.length ? ` (${extra.join(', ')})` : ''}\n`);
  console.log('| Row | Config | Values |\n|---|---|---|');
  for (const r of rows) console.log(`| ${r.row} | ${r.config} | ${Object.entries(r.values).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
} finally {
  await browser.close();
  await server.close();
}
