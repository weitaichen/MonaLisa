// T7 visual verification: drives the UI harness (fake engine/camera/store) and the real app in
// headless Chromium with an iPhone-15-Pro-like context, screenshotting every screen and state into
// tests/harness/t7/shots/. Usage: start `npx vite --port 5187 --strictPort`, then
//   node tests/harness/t7/shoot.mjs [filter-substring]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5187';
const OUT = resolve('tests/harness/t7/shots');
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ?? '';

const y4m = resolve('tests/fixtures/face.y4m');
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
if (existsSync(y4m)) args.push(`--use-file-for-fake-video-capture=${y4m}`);

const browser = await chromium.launch({ args });
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
});

const results = [];
const consoleErrors = [];

async function open(query = '', path = '/tests/harness/t7/index.html') {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${query || path}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${query || path}] PAGEERROR ${e.message}`));
  await page.goto(`${BASE}${path}${query ? `?${query}` : ''}`);
  if (path.includes('harness')) await page.waitForFunction(() => window.__harnessReady === true);
  await page.waitForTimeout(350);
  return page;
}

async function shot(page, name) {
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  results.push(name);
}

const btn = (page, name) => page.getByRole('button', { name, exact: true });

async function toLiveCamera(page) {
  await page.locator('.tile.primary').click();
  await page.getByText('點擊開啟相機').click();
  await page.waitForSelector('.shutter:not([disabled])', { timeout: 15000 });
  await page.waitForTimeout(400);
}

/** drag the slider thumb by dx px and keep holding; returns release fn */
async function dragSlider(page, dx) {
  const thumb = page.locator('.slider-thumb');
  const b = await thumb.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  return () => page.mouse.up();
}

async function tab(page, label) {
  await page.getByRole('tab', { name: label }).click();
  await page.waitForTimeout(250);
}

const scenarios = {
  async home() {
    const p = await open('assets=slow');
    await page_wait(p, 900);
    await shot(p, '01-home');
    await p.close();
    const r = await open('assets=instant');
    await page_wait(r, 500);
    await shot(r, '01b-home-engine-ready');
    await r.close();
  },
  async homeHistory() {
    const p = await open('history=7&hint=1&assets=instant');
    await page_wait(p, 3200);
    await shot(p, '02-home-history');
    await btn(p, '編輯').click();
    await shot(p, '02b-home-history-edit');
    await p.locator('.thumb-x').first().click();
    await shot(p, '02c-home-delete-confirm');
    await p.close();
  },
  async camera() {
    const p = await open('assets=instant');
    await p.locator('.tile.primary').click();
    await shot(p, '03-camera-gate');
    await p.getByText('點擊開啟相機').click();
    await p.waitForSelector('.shutter:not([disabled])', { timeout: 15000 });
    await page_wait(p, 600);
    await shot(p, '04-camera-live-skin');
    for (const [label, name] of [
      ['一鍵', '05a-camera-tab-preset'],
      ['美型', '05b-camera-tab-shape'],
      ['濾鏡', '05c-camera-tab-filter'],
      ['美妝', '05d-camera-tab-makeup'],
    ]) {
      await tab(p, label);
      await shot(p, name);
    }
    // makeup: pick a shade, switch part
    await p.getByRole('option', { name: '豆沙', exact: true }).click();
    await shot(p, '05e-camera-makeup-shade');
    await tab(p, '濾鏡');
    await p.getByRole('option', { name: '暖調', exact: true }).click();
    await shot(p, '05f-camera-filter-warm');
    // slider one-way
    await tab(p, '美膚');
    let release = await dragSlider(p, 60);
    await shot(p, '06-slider-oneway-drag');
    await release();
    await page_wait(p, 1200);
    await shot(p, '06b-slider-after-release');
    // bidirectional
    await tab(p, '美型');
    await p.getByRole('option', { name: '下巴', exact: true }).click();
    release = await dragSlider(p, -70);
    await shot(p, '07-slider-bidir-drag');
    await release();
    release = await dragSlider(p, 62);
    await shot(p, '07b-slider-bidir-snap');
    await release();
    // compare hold
    const cmp = p.locator('.cam-controls .side-btn').nth(1);
    const cb = await cmp.boundingBox();
    await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await p.mouse.down();
    await shot(p, '08-camera-compare-held');
    await p.mouse.up();
    // ratio + timer
    await p.getByRole('button', { name: /^比例/ }).click();
    await p.getByRole('button', { name: /^計時/ }).click();
    await shot(p, '08b-camera-1x1-timer3');
    await p.getByRole('button', { name: /^比例/ }).click();
    await shot(p, '08c-camera-9x16');
    await p.getByRole('button', { name: /^比例/ }).click();
    await p.getByRole('button', { name: /^計時/ }).click();
    await p.getByRole('button', { name: /^計時/ }).click();
    // collapse panel
    await p.mouse.click(196, 300);
    await page_wait(p, 400);
    await shot(p, '08d-camera-panel-collapsed');
    await p.mouse.click(196, 300);
    await page_wait(p, 400);
    // shutter → review
    await p.getByRole('button', { name: '拍照' }).click();
    await page_wait(p, 60);
    await shot(p, '09a-review-preparing');
    await page_wait(p, 900);
    await shot(p, '09-review');
    await btn(p, '儲存').click();
    await page_wait(p, 300);
    await shot(p, '09b-save-fallback');
    await btn(p, '關閉').click();
    // review → editor
    await btn(p, '編輯').click();
    await p.waitForSelector('.pill:not([disabled])', { timeout: 10000 });
    await page_wait(p, 500);
    await shot(p, '10-editor');
    await tab(p, '美膚');
    release = await dragSlider(p, 80);
    await release();
    await page_wait(p, 300);
    await shot(p, '10b-editor-after-edit-undo-enabled');
    const hold = p.getByRole('button', { name: '按住對比' });
    const hb = await hold.boundingBox();
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await p.mouse.down();
    await shot(p, '11-editor-compare-held');
    await p.mouse.up();
    await p.getByText('重置', { exact: true }).click();
    await shot(p, '12-editor-reset-confirm');
    await p.getByText('確定重置？').click();
    await btn(p, '復原').click();
    await shot(p, '12b-editor-after-reset-undo');
    await p.close();
  },
  async importEditor() {
    const p = await open('assets=instant');
    const chooser = p.waitForEvent('filechooser');
    await p.locator('.tile:not(.primary)').click();
    await (await chooser).setFiles(resolve('tests/fixtures/sample_face.png'));
    await p.waitForSelector('.pill:not([disabled])', { timeout: 10000 });
    await page_wait(p, 600);
    await shot(p, '13-editor-import');
    await tab(p, '美型');
    await shot(p, '13b-editor-import-shape');
    await btn(p, '關閉').click();
    await page_wait(p, 1000);
    await shot(p, '13c-home-after-edit');
    // second camera visit in the same session starts straight from the tile tap (no gate)
    await toLiveCamera(p);
    await btn(p, '回首頁').click();
    await page_wait(p, 300);
    await p.locator('.tile.primary').click();
    await p.waitForSelector('.shutter:not([disabled])', { timeout: 15000 });
    await page_wait(p, 500);
    await shot(p, '13d-camera-revisit-no-gate');
    await p.close();
  },
  async slowSave() {
    const p = await open('assets=instant&slowencode=1');
    await toLiveCamera(p);
    await p.getByRole('button', { name: '拍照' }).click();
    await page_wait(p, 500);
    await shot(p, '16-review-preparing');
    await page_wait(p, 4000);
    await btn(p, '編輯').click();
    await p.waitForSelector('.pill:not([disabled])', { timeout: 10000 });
    await page_wait(p, 300);
    await p.getByRole('option', { name: '美白', exact: true }).click();
    const release = await dragSlider(p, 50);
    await release();
    await btn(p, '儲存').click();
    await page_wait(p, 200);
    await shot(p, '17-editor-save-preparing');
    await p.close();
  },
  async settings() {
    const p = await open('assets=instant');
    await btn(p, '設定').click();
    await page_wait(p, 400);
    await shot(p, '14-settings');
    await p.getByText('關於與授權').click();
    await page_wait(p, 300);
    await shot(p, '15-credits');
    await p.locator('.sheet-body').evaluate((el) => (el.scrollTop = 9999));
    await shot(p, '15b-credits-bottom');
    await p.close();
  },
  async errors() {
    for (const [q, name, live] of [
      ['cam=denied&assets=instant', '20-err-camera-denied'],
      ['cam=black&assets=instant', '21-err-camera-black'],
      ['cam=notfound&assets=instant', '22-err-camera-notfound'],
      ['cam=interrupted&assets=instant', '23-err-camera-interrupted', 'interrupted'],
      ['assets=fail', '24-err-assets-fail', 'live'],
      ['assets=slow', '25-engine-loading', 'live'],
      ['tracker=fail&assets=instant', '26-basic-mode-tracker-fail', 'live'],
      ['engine=throw&assets=instant', '27-err-engine-throw', 'live'],
    ]) {
      const p = await open(q);
      await p.locator('.tile.primary').click();
      await p.getByText('點擊開啟相機').click();
      await page_wait(p, live === 'interrupted' ? 1800 : live ? 2600 : 700);
      await shot(p, name);
      if (name === '24-err-assets-fail') {
        await p.getByText('使用基本模式').click();
        await p.waitForSelector('.shutter:not([disabled])', { timeout: 10000 });
        await page_wait(p, 400);
        await shot(p, '24b-basic-mode');
      }
      await p.close();
    }
    const w = await open('webgl=0');
    await shot(w, '28-err-no-webgl2');
    await w.close();
    const h = await open('assets=fail');
    await page_wait(h, 3000);
    await shot(h, '29-home-assets-fail-chip');
    await h.close();
  },
  async realApp() {
    // the real entry with whatever the other modules currently implement
    const p = await open('', '/');
    await page_wait(p, 2500);
    await shot(p, '30-real-home');
    await p.locator('.tile.primary').click();
    await page_wait(p, 800);
    await shot(p, '31-real-camera');
    const gate = p.getByText('點擊開啟相機');
    if (await gate.count()) {
      await gate.click();
      await page_wait(p, 4000);
      await shot(p, '32-real-camera-after-gate');
    }
    console.log('real app debug state:', JSON.stringify(await p.evaluate(() => window.__meiyan)));
    if (await p.locator('.shutter:not([disabled])').count()) {
      await tab(p, '一鍵');
      await p.getByRole('option', { name: '氣色', exact: true }).click();
      await page_wait(p, 1500);
      await shot(p, '33-real-camera-preset-glow');
      await tab(p, '美型');
      await p.getByRole('option', { name: '大眼', exact: true }).click();
      const release = await dragSlider(p, 120);
      await page_wait(p, 600);
      await shot(p, '34-real-camera-bigeye-drag');
      await release();
      await p.getByRole('button', { name: '拍照' }).click();
      await page_wait(p, 2500);
      await shot(p, '35-real-review');
      await btn(p, '編輯').click();
      await p.waitForSelector('.pill:not([disabled])', { timeout: 30000 });
      await page_wait(p, 1500);
      await shot(p, '36-real-editor');
      await btn(p, '儲存').click();
      await page_wait(p, 2500);
      await shot(p, '37-real-save-fallback');
      await p.locator('.fallback .icon-btn').click();
    }
    await p.close();
    const r = await open('', '/');
    const chooser = r.waitForEvent('filechooser');
    await r.locator('.tile:not(.primary)').click();
    await (await chooser).setFiles(resolve('tests/fixtures/sample_face.png'));
    await r.waitForSelector('.pill:not([disabled])', { timeout: 60000 });
    await page_wait(r, 2000);
    await shot(r, '38-real-editor-import');
    await tab(r, '美妝');
    await r.getByRole('option', { name: '玫瑰', exact: true }).click();
    await page_wait(r, 1200);
    await shot(r, '39-real-editor-lip');
    const hold = r.getByRole('button', { name: '按住對比' });
    const hb = await hold.boundingBox();
    await r.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await r.mouse.down();
    await page_wait(r, 500);
    await shot(r, '40-real-editor-compare');
    await r.mouse.up();
    await btn(r, '關閉').click();
    await page_wait(r, 1500);
    await shot(r, '41-real-home-history');
    console.log('real editor debug state:', JSON.stringify(await r.evaluate(() => window.__meiyan)));
    await r.close();
  },
};

async function page_wait(p, ms) {
  await p.waitForTimeout(ms);
}

for (const [name, fn] of Object.entries(scenarios)) {
  if (only && !name.includes(only)) continue;
  try {
    await fn();
  } catch (e) {
    console.error(`SCENARIO ${name} FAILED:`, e.message.split('\n')[0]);
  }
}
await browser.close();
console.log('shots:', results.join(', '));
if (consoleErrors.length) console.log('console errors:\n' + consoleErrors.join('\n'));
