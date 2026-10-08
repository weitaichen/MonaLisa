// B4 visual + interaction check of the 美體 tab. Usage:
//   npx vite --config tests/harness/b4/vite.config.mjs --port 5404 --strictPort
//   node tests/harness/b4/shoot.mjs [filter-substring]
// Screenshots land in tests/harness/b4/shots/ (393×852 and 375×667, DPR 2); assertions print PASS/FAIL.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5404/tests/harness/b4/index.html';
const OUT = resolve('tests/harness/b4/shots');
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ?? '';

const browser = await chromium.launch();
const results = [];
const errors = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

async function open(s, size = { width: 393, height: 852 }) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${s}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${s}] PAGEERROR ${e.message}`));
  await page.goto(`${BASE}?s=${s}`);
  await page.waitForFunction(() => window.__harnessReady === true);
  await page.waitForTimeout(400);
  return { page, close: () => context.close() };
}
const shot = (page, name) => page.screenshot({ path: resolve(OUT, `${name}.png`) });
const item = (page, label) => page.locator('.strip .item', { has: page.locator('.item-label', { hasText: new RegExp(`^${label}$`) }) });

const steps = {
  async 'tabs-fit-375'() {
    for (const size of [
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      const { page, close } = await open('ready', size);
      const r = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabs .tab')];
        return tabs.map((t) => {
          const lb = t.querySelector('.tab-label').getBoundingClientRect();
          const tb = t.getBoundingClientRect();
          return { text: t.textContent, w: tb.width, label: lb.width, fits: lb.left >= tb.left - 0.5 && lb.right <= tb.right + 0.5 };
        });
      });
      check(`six tabs fit at ${size.width}`, r.length === 6 && r.every((t) => t.fits), JSON.stringify(r.map((t) => `${t.text}:${t.w.toFixed(0)}/${t.label.toFixed(0)}`)));
      if (size.width === 375) await shot(page, 'b01-ready-375x667');
      await close();
    }
  },
  async loading() {
    const { page, close } = await open('loading');
    const note = await page.locator('.body-note-text').textContent();
    check('loading note shows download %', note.includes('下載美體模型 42%'), note);
    const disabled = await page.locator('.strip .item.disabled').count();
    check('loading: 10 sliders disabled', disabled === 10, String(disabled));
    check('loading: no slider', (await page.locator('.editor-panel .slider-row.empty').count()) === 1);
    await shot(page, 'b02-loading-42');
    await item(page, '細腰').click({ force: true }); // aria-disabled: still tappable, it explains why
    await page.waitForTimeout(250);
    const t = await page.locator('.toast').innerText();
    check('tap disabled while loading → reason toast', t.includes('美體偵測完成後即可調整'), t);
    await shot(page, 'b03-loading-tap-disabled');
    await close();
  },
  async detecting() {
    const { page, close } = await open('detecting');
    await page.waitForTimeout(300);
    await shot(page, 'b04-detecting');
    await close();
  },
  async ready() {
    const { page, close } = await open('ready');
    check('ready: no disabled except face-gated head/neck', (await page.locator('.strip .item.disabled').count()) === 2);
    check('ready: slider bound to 細腰', (await page.locator('.slider-label').innerText()) === '細腰');
    check('ready: 美體 tab dot', (await page.locator('.tab.active .tab-dot').count()) === 1);
    await shot(page, 'b05-ready-waist');
    // the strip scrolled to the end shows 天鵝頸 / 小頭 dimmed + 背景保護
    await page.locator('.strip').evaluate((s) => (s.scrollLeft = s.scrollWidth));
    await page.waitForTimeout(150);
    await item(page, '小頭').click({ force: true });
    await page.waitForTimeout(250);
    const t = await page.locator('.toast').innerText();
    check('face-gated 小頭 → reason toast', t.includes('需要偵測到臉部'), t);
    await shot(page, 'b06-ready-strip-end-toast');
    await close();
  },
  async hip() {
    const { page, close } = await open('hip');
    const v = await page.locator('.slider-value').innerText();
    check('美臀 centre-zero slider shows +12', v === '+12', v);
    check('美臀 slider has centre tick', (await page.locator('.slider-tick').count()) === 1);
    await shot(page, 'b07-hip-bidirectional');
    await close();
  },
  async gated() {
    const { page, close } = await open('gated');
    await item(page, '長腿').click({ force: true });
    await page.waitForTimeout(250);
    const t = await page.locator('.toast').innerText();
    check('portrait: 長腿 disabled with its reason', t === '拍攝全身照可使用長腿／瘦腿', t);
    check('portrait: selection unchanged', (await page.evaluate(() => window.__h.sel.body)) === 'body.arms');
    await shot(page, 'b08-gated-legs-toast');
    await close();
  },
  async people2() {
    const { page, close } = await open('people2');
    const note = await page.locator('.body-note-text').textContent();
    check('≥ 2 people hint', note.includes('僅調整畫面中央的主要人物'), note);
    await shot(page, 'b09-people2');
    await close();
  },
  async height() {
    const { page, close } = await open('height');
    check('增高 overlay up', (await page.locator('.hband').count()) === 1);
    check('增高 slider', (await page.locator('.slider-label').innerText()) === '增高');
    await shot(page, 'b10-height-idle');
    // drag the lower line up by 10 % of the photo
    const box = await page.locator('.hband').boundingBox();
    const line = await page.locator('.hband-line.bottom .hband-grip').boundingBox();
    const y0 = line.y + line.height / 2;
    const x0 = line.x + line.width / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x0, y0 - (box.height * 0.1 * i) / 8);
    await page.waitForTimeout(80);
    await shot(page, 'b11-height-dragging');
    await page.mouse.up();
    await page.waitForTimeout(150);
    const h = await page.evaluate(() => ({ band: window.__h.params.heightBand, commits: window.__h.commits }));
    check('drag lower line → band bottom ≈ 0.74, one commit', h.band && Math.abs(h.band.bottom - 0.74) < 0.012 && h.band.top === 0.5 && h.commits === 1, JSON.stringify(h));
    // raise the amount with the slider
    const sl = await page.locator('.editor-panel .slider').boundingBox();
    await page.mouse.move(sl.x + 4, sl.y + sl.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sl.x + 4 + (sl.width * 0.75 * i) / 10, sl.y + sl.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const h2 = await page.evaluate(() => window.__h.params.heightBand);
    check('slider sets the band amount, band kept', h2 && h2.amount > 0.6 && Math.abs(h2.bottom - h.band.bottom) < 1e-9, JSON.stringify(h2));
    // the lower line now marks the stretched band in the photo
    const lines = await page.evaluate(() => {
      const r = document.querySelector('.hband').getBoundingClientRect();
      const y = (sel) => (document.querySelector(sel).getBoundingClientRect().top + 22 - r.top) / r.height;
      return { top: y('.hband-line.top'), bottom: y('.hband-line.bottom') };
    });
    const exp = 0.5 + (h2.bottom - 0.5) * (1 + 0.15 * h2.amount);
    check('lower line drawn at the stretched edge', Math.abs(lines.bottom - exp) < 0.004 && Math.abs(lines.top - 0.5) < 0.004, JSON.stringify({ lines, exp }));
    await shot(page, 'b12-height-stretched');
    // keyboard: ArrowUp on the top line moves it 1 % and commits
    await page.locator('.hband-line.top').focus();
    await page.keyboard.press('ArrowUp');
    const h3 = await page.evaluate(() => window.__h.params.heightBand);
    check('keyboard moves the top line', Math.abs(h3.top - 0.49) < 1e-6, JSON.stringify(h3));
    await close();
  },
  async heightOn() {
    const { page, close } = await open('heightOn', { width: 375, height: 667 });
    await shot(page, 'b13-height-on-375x667');
    await close();
  },
  async protect() {
    const { page, close } = await open('ready');
    await page.locator('.strip').evaluate((s) => (s.scrollLeft = s.scrollWidth));
    await page.waitForTimeout(150);
    check('背景保護 on by default', (await item(page, '背景保護').getAttribute('aria-pressed')) === 'true');
    await shot(page, 'b14-protect-on');
    await item(page, '背景保護').click();
    await page.waitForTimeout(250);
    const t = await page.locator('.toast').innerText();
    check('背景保護 off → explanatory toast', t.includes('背景可能彎曲'), t);
    check('背景保護 off state', (await page.evaluate(() => window.__h.params.bodyProtect)) === false);
    await shot(page, 'b15-protect-off');
    await close();
  },
  async none() {
    const { page, close } = await open('none');
    const note = await page.locator('.body-note-text').textContent();
    check('no person note', note.includes('未偵測到人物，仍可使用手動增高'), note);
    await shot(page, 'b16-none');
    await item(page, '增高').click();
    await page.waitForTimeout(200);
    check('增高 usable without a person', (await page.locator('.hband').count()) === 1);
    await shot(page, 'b17-none-height');
    await close();
  },
  async error() {
    const { page, close } = await open('error');
    await shot(page, 'b18-error-retry');
    await page.locator('.body-note-action').click();
    check('重試 calls retry', (await page.evaluate(() => window.__h.retries)) === 1);
    await close();
  },
  async camera() {
    for (const size of [
      { width: 393, height: 852 },
      { width: 375, height: 667 },
    ]) {
      const { page, close } = await open('camera', size);
      const note = await page.locator('.body-note-text').textContent();
      check(`camera ${size.width}: unsupported note`, note.includes('美體目前僅支援照片編輯'), note);
      check(`camera ${size.width}: all items off`, (await page.locator('.strip .item:not(.disabled)').count()) === 0);
      check(`camera ${size.width}: tab dimmed`, (await page.locator('.tab.active.unavailable').count()) === 1);
      await shot(page, `b19-camera-${size.width}x${size.height}`);
      if (size.width === 393) {
        await item(page, '增高').click({ force: true });
        await page.waitForTimeout(250);
        check('camera: tap → photo-only toast', (await page.locator('.toast').innerText()).includes('僅支援照片編輯'));
        check('camera: no band overlay', (await page.locator('.hband').count()) === 0);
        await page.locator('.body-note-action').click();
        check('camera: 匯入照片 runs the import', (await page.evaluate(() => window.__h.imports)) === 1);
        await shot(page, 'b20-camera-tap');
      }
      await close();
    }
  },
  async cameraSkin() {
    const { page, close } = await open('cameraSkin', { width: 375, height: 667 });
    await shot(page, 'b21-camera-skin-375x667');
    await close();
  },
  async icons() {
    const { page, close } = await open('ready');
    await page.evaluate(() => {
      const names = ['legs', 'bodySlim', 'waist', 'whr', 'hip', 'legSlim', 'arms', 'shoulder', 'neck', 'head', 'height', 'protect', 'protectOff'];
      const strip = document.querySelector('.strip');
      const tiles = [...strip.querySelectorAll('.item-tile svg')];
      const src = new Map();
      for (const t of tiles) src.set(t.innerHTML, t);
      const sheet = document.createElement('div');
      sheet.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;display:flex;flex-wrap:wrap;gap:18px;padding:24px;align-content:flex-start';
      document.body.append(sheet);
      return names.length;
    });
    // render the icon sheet through the live strip tiles (big) by cloning
    await page.evaluate(() => {
      const sheet = document.body.lastElementChild;
      for (const el of document.querySelectorAll('.strip .item')) {
        const svg = el.querySelector('svg')?.cloneNode(true);
        if (!svg) continue;
        svg.setAttribute('width', '72');
        svg.setAttribute('height', '72');
        const box = document.createElement('div');
        box.style.cssText = 'width:96px;display:flex;flex-direction:column;align-items:center;gap:6px;color:#d1d1d6;font-size:12px';
        box.append(svg, el.querySelector('.item-label').textContent);
        sheet.append(box);
      }
    });
    await shot(page, 'b22-icons-big');
    await close();
  },
};

for (const [name, fn] of Object.entries(steps)) {
  if (only && !name.includes(only)) continue;
  try {
    await fn();
  } catch (e) {
    check(`${name} threw`, false, String(e?.message ?? e));
  }
}
await browser.close();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
