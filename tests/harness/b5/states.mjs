// B5 美體 states against the real app: portrait (legs gated), no person (manual 增高 only), download failure →
// 重試. Run with the B5 dev server up (see run.mjs). Screenshots → tests/harness/b5/shots/states-*.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const BASE = process.argv[2] ?? 'http://localhost:5405';
const OUT = resolve(import.meta.dirname, 'shots');
const FIX = resolve(import.meta.dirname, '../../fixtures');
mkdirSync(OUT, { recursive: true });

let failed = false;
const check = (name, ok, detail = '') => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** a person-free photo: soft grey gradient with a straight dark line */
function emptyPng() {
  const png = new PNG({ width: 600, height: 900 });
  for (let y = 0; y < 900; y++) {
    for (let x = 0; x < 600; x++) {
      const i = (y * 600 + x) * 4;
      const v = y > 640 && y < 660 ? 40 : 120 + Math.round((80 * (x + y)) / 1500);
      png.data.set([v, v, v + 4, 255], i);
    }
  }
  const p = resolve(OUT, 'empty.png');
  writeFileSync(p, PNG.sync.write(png));
  return p;
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(photo, { failPose = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'zh-TW', colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/XNNPACK delegate/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const gate = { fail: failPose };
  await context.route(/pose_landmarker_full\.task/, (route) => (gate.fail ? route.abort('failed') : route.continue()));
  await page.goto(BASE);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(photo);
  await page.waitForFunction(() => !document.querySelector('.topbar .pill[disabled]'), null, { timeout: 120_000 });
  await page.getByRole('tab', { name: '美體' }).click();
  return { context, page, errors, gate };
}
const option = (page, name) => page.getByRole('option', { name, exact: true });
async function waitNote(page, re, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await page.locator('.body-note').textContent().catch(() => null);
    if (t && re.test(t)) return t;
    await page.waitForTimeout(200);
  }
  return null;
}
async function waitReady(page, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.locator('.body-note.progress').count();
    if (!busy) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// ── portrait: a person, but no legs in frame ──
{
  const { context, page, errors } = await open(resolve(FIX, 'sample_face.png'));
  await waitReady(page);
  await page.waitForTimeout(500);
  const legs = await option(page, '長腿').getAttribute('aria-description');
  const legsOff = (await option(page, '長腿').getAttribute('aria-disabled')) === 'true';
  check('portrait: 長腿 disabled with a reason', legsOff && !!legs, legs ?? '');
  const states = {};
  for (const n of ['瘦身', '細腰', '瘦手臂', '直角肩', '天鵝頸', '小頭', '增高']) {
    states[n] = (await option(page, n).getAttribute('aria-disabled')) === 'true' ? (await option(page, n).getAttribute('aria-description')) : 'on';
  }
  console.log('portrait items', JSON.stringify(states));
  await page.screenshot({ path: resolve(OUT, 'states-portrait.png') });
  check('portrait: no console errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ── no person: only manual 增高 ──
{
  const { context, page, errors } = await open(emptyPng());
  const note = await waitNote(page, /未偵測到人物/);
  check('no person: note shown', !!note, note ?? '');
  check('no person: 瘦身 disabled', (await option(page, '瘦身').getAttribute('aria-disabled')) === 'true');
  check('no person: 增高 usable', (await option(page, '增高').getAttribute('aria-disabled')) !== 'true');
  await option(page, '增高').click();
  await page.waitForTimeout(300);
  const before = await page.locator('.editor-stage canvas').screenshot();
  const thumb = page.locator('.slider-thumb').first();
  const b = await thumb.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(b.x + 2 + (400 * i) / 24, b.y + b.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const after = await page.locator('.editor-stage canvas').screenshot();
  check('no person: manual 增高 changes the photo', Buffer.compare(before, after) !== 0);
  await page.screenshot({ path: resolve(OUT, 'states-noperson-height.png') });
  check('no person: no console errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ── download failure → 重試 ──
{
  const { context, page, errors, gate } = await open(resolve(FIX, 'fullbody.jpg'), { failPose: true });
  const note = await waitNote(page, /失敗/);
  check('download failure: error note', !!note, note ?? '');
  await page.screenshot({ path: resolve(OUT, 'states-error.png') });
  const retry = page.getByRole('button', { name: '重試' });
  check('download failure: 重試 offered', (await retry.count()) === 1);
  gate.fail = false;
  await retry.click();
  await waitReady(page);
  await page.waitForTimeout(500);
  check('重試 → sliders ready', (await option(page, '瘦身').getAttribute('aria-disabled')) !== 'true');
  // the failed fetch is logged by the browser itself; anything else is ours
  const ours = errors.filter((e) => !/Failed to load resource|ERR_FAILED|Failed to fetch/.test(e));
  check('download failure: no other console errors', ours.length === 0, ours.join(' | '));
  await context.close();
}

// ── slow network: the strip shows 下載美體模型 n% while the pose model downloads ──
{
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'zh-TW', colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(BASE);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(resolve(FIX, 'fullbody.jpg'));
  await page.waitForFunction(() => !document.querySelector('.topbar .pill[disabled]'), null, { timeout: 120_000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // ≈ 4 Mbit/s: the 9.4 MB model takes ~20 s
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 500_000, uploadThroughput: 500_000 });
  await page.getByRole('tab', { name: '美體' }).click();
  const seen = new Set();
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const t = await page.locator('.body-note').textContent().catch(() => null);
    if (!t) break;
    seen.add(t.replace(/\d+%/, 'n%'));
    if (!shot && /下載美體模型 [1-9]\d?%/.test(t)) {
      await page.screenshot({ path: resolve(OUT, 'states-downloading.png') });
      shot = true;
    }
    await page.waitForTimeout(250);
  }
  console.log('notes seen', JSON.stringify([...seen]));
  check('slow network: 下載美體模型 n% shown', [...seen].some((t) => t.startsWith('下載美體模型')));
  await context.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
