// B5 stress look: every available 美體 slider at max (美臀 at +50), 背景保護 on and off, exported at full
// resolution through 儲存 → tests/harness/b5/shots/max-protect-{on,off}.jpg (+ the unedited export).
//   node tests/harness/b5/max.mjs [baseUrl]   (B5_PHOTO=fullbody_yoga.jpg for the second fixture)
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5405';
const OUT = resolve(import.meta.dirname, 'shots');
const NAME = process.env.B5_PHOTO ?? 'fullbody.jpg';
const PHOTO = resolve(import.meta.dirname, '../../fixtures', NAME);
const TAG = NAME.replace(/\.\w+$/, '');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'zh-TW', colorScheme: 'dark' });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/XNNPACK delegate/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE);
const chooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /匯入照片/ }).click();
await (await chooser).setFiles(PHOTO);
await page.waitForFunction(() => !document.querySelector('.topbar .pill[disabled]'), null, { timeout: 120_000 });

async function exportTo(file) {
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '儲存' }).click();
  const img = page.locator('.fallback img');
  await img.waitFor({ timeout: 60_000 });
  const b64 = await img.evaluate(async (el) => {
    const b = new Uint8Array(await (await fetch(el.src)).arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  writeFileSync(resolve(OUT, file), Buffer.from(b64, 'base64'));
  await page.getByRole('dialog', { name: '儲存照片' }).getByRole('button', { name: '關閉' }).click();
}

await exportTo(`max-${TAG}-none.jpg`);
await page.getByRole('tab', { name: '美體' }).click();
const option = (n) => page.getByRole('option', { name: n, exact: true });
for (let t0 = Date.now(); Date.now() - t0 < 120_000; ) {
  if (!(await page.locator('.body-note.progress').count())) break;
  await page.waitForTimeout(200);
}
const used = [];
for (const n of ['長腿', '瘦身', '細腰', '腰臀比', '美臀', '瘦腿', '瘦手臂', '直角肩', '天鵝頸', '小頭']) {
  if ((await option(n).getAttribute('aria-disabled')) === 'true') continue;
  await option(n).click();
  await page.waitForTimeout(250);
  const b = await page.locator('.slider-thumb').first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + b.width / 2 + (400 * i) / 20, b.y + b.height / 2);
  await page.mouse.up();
  used.push(`${n}=${await page.locator('[role=slider]').first().getAttribute('aria-valuenow')}`);
}
console.log('sliders', used.join(' '));
await exportTo(`max-${TAG}-protect-on.jpg`);
await option('背景保護').click();
await exportTo(`max-${TAG}-protect-off.jpg`);
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await browser.close();
