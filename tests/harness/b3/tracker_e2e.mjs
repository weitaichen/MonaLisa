// node tests/harness/b3/tracker_e2e.mjs [port]  (vite on 5403 must be running; GPU_ARGS env adds Chromium flags)
// Asserts createBodyTracker behaviour with the real model and dumps the two-person result for overlay.mjs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = process.argv[2] ?? '5403';
const browser = await chromium.launch({ args: (process.env.GPU_ARGS ?? '').split(' ').filter(Boolean) });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('INFO:')) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/tests/harness/b3/tracker.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
const r = await page.evaluate(() => window.e2e());

const vis = (d) => d.points.filter((_, i) => i % 4 === 3);
const maxDiff = (a, b) => Math.max(...a.points.map((v, i) => (i % 4 < 2 ? Math.abs(v - b.points[i]) : 0)));
const cov = (m) => m.data.filter((v) => v >= 128).length / m.data.length;
const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push(`PASS ${name}`);
  } catch (e) {
    checks.push(`FAIL ${name}: ${e.message}`);
  }
};

check('delegate resolves to GPU (masks)', () => assert.equal(r.delegate, 'GPU'));
check('model progress reported', () => assert.ok(r.progressEvents >= 2));
check('base: 33 points, all visible, size = image, 1 person', () => {
  assert.equal(r.base.points.length, 132);
  assert.deepEqual([r.base.width, r.base.height], [638, 1000]);
  assert.ok(Math.min(...vis(r.base)) > 0.6, `min vis ${Math.min(...vis(r.base))}`);
  assert.equal(r.base.people, 1);
});
check('base mask 163x256 with plausible coverage', () => {
  assert.deepEqual([r.base.mask.width, r.base.mask.height], [163, 256]);
  const c = cov(r.base.mask);
  assert.ok(c > 0.12 && c < 0.3, `coverage ${c}`);
});
check('upscaled 4x: size = original, landmarks within 1 % of the base', () => {
  assert.deepEqual([r.upscaled.width, r.upscaled.height], [2552, 4000]);
  assert.ok(maxDiff(r.upscaled, r.base) < 0.01, `max diff ${maxDiff(r.upscaled, r.base)}`);
});
check('two people: people = 2, the larger more central one is selected with its own mask', () => {
  assert.equal(r.two.people, 2);
  const hipX = (r.two.points[23 * 4] + r.two.points[24 * 4]) / 2;
  assert.ok(hipX > 0.25 && hipX < 0.45, `hip x ${hipX}`);
  const m = r.two.mask;
  let left = 0;
  for (let y = 0; y < m.height; y++) for (let x = Math.ceil(m.width * 0.6); x < m.width; x++) if (m.data[y * m.width + x] >= 128) left++;
  assert.ok(left < 20, `mask texels on the bystander ${left}`);
});
check('empty scene -> null', () => assert.equal(r.empty, null));
check('yoga: 33 visible, mask 256x171', () => {
  assert.ok(Math.min(...vis(r.yoga)) > 0.6);
  assert.deepEqual([r.yoga.mask.width, r.yoga.mask.height], [256, 171]);
});
check('VIDEO on the same instance tracks the subject', () => {
  assert.ok(r.video.every((v) => v && v.people === 1));
  assert.ok(r.video.every((v) => maxDiff(v, r.base) < 0.02), r.video.map((v) => maxDiff(v, r.base).toFixed(4)).join(','));
});
check('IMAGE again after VIDEO matches the first detection', () =>
  assert.ok(maxDiff(r.back, r.base) < 1e-4, `${maxDiff(r.back, r.base)}`),
);
check('no console errors', () => assert.deepEqual(errors, []));

console.log(`createMs ${r.createMs.toFixed(0)}`);
console.log(checks.join('\n'));
const out = resolve(root, 'tests/harness/b3/out');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'two.png'), Buffer.from(r.pairPng.split(',')[1], 'base64'));
writeFileSync(
  resolve(out, 'two.json'),
  JSON.stringify({
    source: 'tests/harness/b3/out/two.png',
    delegate: r.delegate,
    people: r.two.people,
    points: r.two.points,
    mask: { width: r.two.mask.width, height: r.two.mask.height, data: Buffer.from(r.two.mask.data).toString('base64') },
  }),
);
await browser.close();
if (checks.some((c) => c.startsWith('FAIL'))) process.exit(1);
