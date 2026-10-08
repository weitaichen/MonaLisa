// B5 editor-integration check against the real app (dev server, real engine, real PoseLandmarker):
//   node tests/harness/b5/run.mjs [baseUrl]      (serve first: npx vite --config tests/harness/b5/vite.config.mjs --port 5405 --strictPort)
// Imports tests/fixtures/fullbody.jpg, opens 美體 (model download progress → ready), drives 細腰 / 長腿 / 增高 /
// 背景保護, exports via 儲存, closes, reopens from 最近編輯 and asserts no pose-model request the second time.
// Writes screenshots + summary.json to tests/harness/b5/shots/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const BASE = process.argv[2] ?? 'http://localhost:5405';
const OUT = resolve(import.meta.dirname, 'shots');
const PHOTO = resolve(import.meta.dirname, '../../fixtures', process.env.B5_PHOTO ?? 'fullbody.jpg');
mkdirSync(OUT, { recursive: true });

const summary = { checks: [], consoleErrors: [], poseRequests: [], foreign: [] };
const check = (name, ok, detail = '') => {
  summary.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const decode = (buf) => {
  const p = PNG.sync.read(buf);
  return { w: p.width, h: p.height, d: p.data };
};
/** mean |ΔRGB| over a rect given in fractions of the image */
function mad(a, b, r = { x: 0, y: 0, w: 1, h: 1 }) {
  if (a.w !== b.w || a.h !== b.h) return Infinity;
  const x0 = Math.floor(r.x * a.w);
  const y0 = Math.floor(r.y * a.h);
  const x1 = Math.floor((r.x + r.w) * a.w);
  const y1 = Math.floor((r.y + r.h) * a.h);
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 4;
      s += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]);
      n += 3;
    }
  }
  return s / Math.max(1, n);
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  locale: 'zh-TW',
  colorScheme: 'dark',
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/XNNPACK delegate/.test(m.text())) summary.consoleErrors.push(m.text());
});
page.on('pageerror', (e) => summary.consoleErrors.push(`pageerror: ${e.message}`));
let phase = 'first';
context.on('request', (r) => {
  const u = new URL(r.url());
  if (/pose_landmarker/.test(u.pathname)) summary.poseRequests.push({ phase, url: u.pathname });
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) summary.foreign.push(r.url());
});

const frame = page.locator('.editor-stage .frame');
const shotFrame = async (name) => decode(await frame.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled' }));
const shotPage = (name) => page.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled' });
async function settledFrame(name) {
  let prev = decode(await frame.screenshot());
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const cur = decode(await frame.screenshot());
    if (mad(prev, cur) < 0.3) break;
    prev = cur;
  }
  return shotFrame(name);
}
async function dragSlider(dx) {
  const thumb = page.locator('.slider-thumb').first();
  const b = await thumb.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y);
  await page.mouse.up();
}
const option = (name) => page.getByRole('option', { name, exact: true });
/** pick a strip item and let the slider re-key before a drag (a drag in the same frame is reset by it) */
const pick = async (name) => {
  await option(name).click();
  await page.waitForTimeout(250);
};
const dumpHistory = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('meiyan');
        r.onsuccess = () => {
          const g = r.result.transaction('edits').objectStore('edits').getAll();
          g.onsuccess = () =>
            res(
              g.result.map((e) => ({
                band: e.params.heightBand,
                waist: e.params.values['body.waist'],
                legs: e.params.values['body.legs'],
                body: e.body === undefined ? 'absent' : e.body === null ? 'none' : `${e.body.people} person, mask ${e.body.mask ? `${e.body.mask.width}×${e.body.mask.height}` : 'null'}`,
              })),
            );
        };
      }),
  );
const disabled = async (name) => (await option(name).getAttribute('aria-disabled')) === 'true';

// ── 1. import the full-body photo ──
await page.goto(BASE);
const chooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /匯入照片/ }).click();
await (await chooser).setFiles(PHOTO);
const save = page.getByRole('button', { name: '儲存' });
await save.waitFor({ state: 'visible', timeout: 120_000 });
await page.waitForFunction(() => !document.querySelector('.topbar .pill[disabled]'), null, { timeout: 120_000 });
check('pose model not loaded before the 美體 tab', summary.poseRequests.length === 0, `${summary.poseRequests.length} requests`);
const before = await settledFrame('01-import');

// ── 2. open 美體: progress, then ready ──
await page.getByRole('tab', { name: '美體' }).click();
let sawProgress = false;
const t0 = Date.now();
for (;;) {
  const note = await page.locator('.body-note').textContent().catch(() => null);
  if (note && /下載美體模型|正在偵測人物|準備偵測/.test(note)) {
    if (!sawProgress) await shotPage('02-body-loading');
    sawProgress = true;
  }
  if (!(await disabled('瘦身'))) break;
  if (Date.now() - t0 > 120_000) break;
  await page.waitForTimeout(150);
}
check('model progress / detecting note shown', sawProgress);
check('瘦身 enabled after detection', !(await disabled('瘦身')), `${Date.now() - t0} ms`);
summary.items = {};
for (const n of ['長腿', '瘦身', '細腰', '腰臀比', '美臀', '瘦腿', '瘦手臂', '直角肩', '天鵝頸', '小頭', '增高', '背景保護']) {
  summary.items[n] = {
    disabled: await disabled(n),
    reason: await option(n).getAttribute('aria-description'),
  };
}
console.log('items', JSON.stringify(summary.items));
await shotPage('03-body-ready');

// ── 3. 細腰 max ──
await pick('細腰');
await dragSlider(400);
const waist = await settledFrame('04-waist-max');
const torso = { x: 0.3, y: 0.35, w: 0.4, h: 0.2 };
// far background, clear of the toast (top centre) and the floating buttons (bottom corners)
const corners = [
  { x: 0, y: 0.12, w: 0.12, h: 0.2 },
  { x: 0.88, y: 0.12, w: 0.12, h: 0.2 },
];
check('細腰 max changes the torso band', mad(before, waist, torso) > 0.5, `mad ${mad(before, waist, torso).toFixed(2)}`);
const cornerMad = Math.max(...corners.map((c) => mad(before, waist, c)));
check('far background corners unchanged (背景保護 on)', cornerMad < 0.5, `mad ${cornerMad.toFixed(3)}`);

// ── 4. 長腿 max (on top) ──
let legsFrame = null;
const legsOrWaist = () => legsFrame ?? waist;
await pick('長腿');
if (!(await disabled('長腿'))) {
  await dragSlider(400);
  const legs = await settledFrame('05-legs-max');
  legsFrame = legs;
  const below = { x: 0.2, y: 0.6, w: 0.6, h: 0.3 };
  check('長腿 changes pixels below the hips', mad(waist, legs, below) > 0.5, `mad ${mad(waist, legs, below).toFixed(2)}`);
}

// ── 5. hold-to-compare shows the original ──
const cmp = page.getByRole('button', { name: '按住對比' });
const cb = await cmp.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.mouse.down();
await page.waitForTimeout(500);
const held = await shotFrame('06-compare-held');
await page.mouse.up();
const body = { x: 0.2, y: 0.3, w: 0.6, h: 0.6 };
const edited = await settledFrame('06b-after-compare');
// the original has neither the skin defaults nor the body edit
check('按住對比 shows the original, release restores the edit', mad(held, edited, body) > 1 && mad(edited, legsOrWaist(), body) < 0.5, `held↔edit ${mad(held, edited, body).toFixed(2)}`);

// ── 6. 背景保護 off → on ──
await option('背景保護').click();
const unprotected = await settledFrame('07-protect-off');
await option('背景保護').click();
const reprotected = await settledFrame('08-protect-on');
summary.protectOffDelta = mad(reprotected, unprotected);

// ── 7. 增高 tool: overlay + amount ──
await pick('增高');
check('增高 overlay shown', (await page.locator('.hband').count()) === 1);
await dragSlider(400);
await settledFrame('09-height-max');
await shotPage('10-height-page');

// ── 8. undo / redo ──
const undo = page.getByRole('button', { name: '復原' });
await undo.click();
const undone = await settledFrame('11-undo');
await page.getByRole('button', { name: '重做' }).click();
await settledFrame('12-redo');
await pick('細腰'); // the 增高 overlay off, for the comparison after reopening
const redone = await settledFrame('12b-final');
summary.undoDelta = mad(undone, reprotected);

// below the toasts and above the floating buttons
const clear = { x: 0, y: 0.12, w: 1, h: 0.78 };

// ── 9. export (儲存 → fallback sheet with the full-res JPEG) ──
await page.waitForTimeout(800);
await save.click();
const img = page.locator('.fallback img');
await img.waitFor({ timeout: 60_000 });
const exported = await img.evaluate(async (el) => {
  const r = await fetch(el.src);
  const b = new Uint8Array(await r.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { b64: btoa(s), w: el.naturalWidth, h: el.naturalHeight };
});
writeFileSync(resolve(OUT, '13-export.jpg'), Buffer.from(exported.b64, 'base64'));
check('export written', exported.w > 0, `${exported.w}×${exported.h}`);
// preview = export: the JPEG scaled to the on-screen frame size
const scaled = await img.evaluate(
  (el, size) => {
    const c = document.createElement('canvas');
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(el, 0, 0, size.w, size.h);
    return c.toDataURL('image/png');
  },
  { w: redone.w, h: redone.h },
);
const exp = decode(Buffer.from(scaled.slice(scaled.indexOf(',') + 1), 'base64'));
check(
  'export matches the preview',
  mad(exp, redone, clear) < 3 && mad(exp, before, clear) > 5,
  `export↔preview ${mad(exp, redone, clear).toFixed(2)}, export↔unedited ${mad(exp, before, clear).toFixed(2)}`,
);
await page.getByRole('dialog', { name: '儲存照片' }).getByRole('button', { name: '關閉' }).click();

// ── 10. close, reopen from 最近編輯: cached detection, no pose model request ──
await page.waitForTimeout(1200); // debounce + history write
summary.historyBeforeClose = await dumpHistory();
await page.getByRole('button', { name: '關閉' }).first().click();
await page.getByRole('button', { name: /開啟編輯/ }).first().waitFor({ timeout: 20_000 });
await shotPage('14-home');
summary.historyAfterClose = await dumpHistory();
console.log('history', JSON.stringify(summary.historyAfterClose));
phase = 'reopen';
// a fresh page load: nothing in memory, the pose model memo is gone
await page.reload();
await page.getByRole('button', { name: /開啟編輯/ }).first().click();
await page.waitForFunction(() => !document.querySelector('.topbar .pill[disabled]'), null, { timeout: 120_000 });
await page.getByRole('tab', { name: '美體' }).click();
await page.waitForTimeout(1500);
const reopened = await settledFrame('15-reopened');
check('reopened: sliders ready without detection', !(await disabled('瘦身')));
check('reopened: no pose-model request', !summary.poseRequests.some((r) => r.phase === 'reopen'), JSON.stringify(summary.poseRequests));
check(
  'reopened render matches the edit (JPEG round trip)',
  mad(reopened, redone, clear) < 2 && mad(redone, before, clear) > 5,
  `reopen ${mad(reopened, redone, clear).toFixed(2)} vs edit ${mad(redone, before, clear).toFixed(2)}`,
);
await shotPage('16-reopened-page');

check('no console errors', summary.consoleErrors.length === 0, summary.consoleErrors.slice(0, 5).join(' | '));
check('no foreign requests', summary.foreign.length === 0, summary.foreign.join(' '));
writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
await browser.close();
process.exit(summary.checks.every((c) => c.ok) ? 0 : 1);
