// Real app, WebGL context loss while the camera is live (spec §8, RB §3 Fallbacks 5). Three scenarios,
// each in a fresh page, each asserted (exit code 1 on any FAIL):
//   display  WEBGL_lose_context on the display canvas → "lost" overlay → restoreContext → overlay clears,
//            frames and face detection resume.
//   tracker  WEBGL_lose_context on the tracker's own OffscreenCanvas context (MediaPipe GPU graph): the
//            tracker detects the loss, replaces its instance and window.__meiyan.face is true again ≤10 s.
//   both     lose the tracker AND the display context, restore only the display: the display recovers
//            through the engine, the tracker through its own rebuild.
// Usage: serve the app (e.g. `npx vite --port 5187` or `npx vite preview --port 5187`), then
//   node tests/harness/t7/contextloss.mjs [display|tracker|both ...]      (T7_URL overrides the URL)
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const APP = process.env.T7_URL ?? 'http://localhost:5187/';
const RECOVER_MS = 10_000;
const wanted = process.argv.slice(2);
const scenarios = wanted.length ? wanted : ['display', 'tracker', 'both'];

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${resolve('tests/fixtures/face.y4m')}`,
    '--enable-unsafe-swiftshader',
  ],
});

/** MediaPipe's wasm prints INFO lines through console.error (same list as tests/e2e/fixtures.ts) */
const BENIGN_CONSOLE = [/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/];

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function openLiveCamera() {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: 'zh-TW',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN_CONSOLE.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // capture every WebGL context created on an OffscreenCanvas (the tracker's MediaPipe graph);
  // the display canvas is an HTMLCanvasElement, so it is not in this list
  await page.addInitScript(() => {
    window.__trackerCtxs = [];
    if (typeof OffscreenCanvas === 'undefined') return;
    const proto = OffscreenCanvas.prototype;
    const orig = proto.getContext;
    proto.getContext = function (...a) {
      const c = orig.apply(this, a);
      if (c && typeof a[0] === 'string' && a[0].startsWith('webgl') && !window.__trackerCtxs.includes(c)) {
        window.__trackerCtxs.push(c);
      }
      return c;
    };
  });
  await page.goto(APP);
  await page.locator('.tile.primary').click();
  await page.getByText('點擊開啟相機').click();
  await page.waitForSelector('.shutter:not([disabled])', { timeout: 90_000 });
  await waitFor(page, (d) => d?.face === true && d.fps > 0, 90_000);
  return { ctx, page, errors };
}

/** Poll window.__meiyan until pred holds; returns ms waited or -1 on timeout. */
async function waitFor(page, pred, timeout = RECOVER_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const d = await page.evaluate(() => window.__meiyan ?? null);
    if (pred(d)) return Date.now() - t0;
    await page.waitForTimeout(100);
  }
  return -1;
}

/** Sample whether the given text shows up within `ms` (the recovery badge can be brief). */
async function sawText(page, text, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.getByText(text).count()) > 0) return true;
    await page.waitForTimeout(50);
  }
  return false;
}

const loseDisplay = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.display-canvas');
    window.__lc = c.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.__lc.loseContext();
  });

const loseTracker = (page) =>
  page.evaluate(() => {
    const live = window.__trackerCtxs.filter((c) => !c.isContextLost());
    for (const c of live) c.getExtension('WEBGL_lose_context')?.loseContext();
    return live.length;
  });

async function display() {
  const { ctx, page, errors } = await openLiveCamera();
  await loseDisplay(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/harness/t7/shots/42-real-context-lost.png' });
  check('display: lost overlay shown', (await page.getByText('正在恢復畫面…').count()) > 0);
  await page.evaluate(() => window.__lc.restoreContext());
  const ms = await waitFor(page, (d) => d?.face === true && d.fps > 0);
  check('display: overlay clears after restore', (await page.getByText('正在恢復畫面…').count()) === 0);
  check('display: face + frames resume', ms >= 0, `${ms} ms`);
  await page.screenshot({ path: 'tests/harness/t7/shots/43-real-context-restored.png' });
  check('display: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function tracker() {
  const { ctx, page, errors } = await openLiveCamera();
  const before = await page.evaluate(() => window.__meiyan.delegate);
  if (before !== 'GPU') {
    console.log(`SKIP  tracker: delegate is ${before}; only the GPU graph owns a WebGL context`);
    await ctx.close();
    return;
  }
  const n = await loseTracker(page);
  check('tracker: a live tracker context was captured and lost', n > 0, `${n} context(s)`);
  const badge = sawText(page, '臉部偵測重新啟動中', 3000);
  const gone = await waitFor(page, (d) => d?.face === false, 3000);
  const back = await waitFor(page, (d) => d?.face === true && d.fps > 0);
  console.log(`      face false after ${gone} ms, recovery badge seen: ${await badge}`);
  check('tracker: face detection comes back by itself', back >= 0, `${back} ms after loss`);
  const d = await page.evaluate(() => window.__meiyan);
  check('tracker: delegate published', d.delegate === 'GPU' || d.delegate === 'CPU', String(d.delegate));
  check('tracker: recovery badge cleared', (await page.getByText('臉部偵測重新啟動中').count()) === 0);
  check('tracker: display untouched', (await page.getByText('正在恢復畫面…').count()) === 0);
  await page.screenshot({ path: 'tests/harness/t7/shots/44-real-tracker-context-restored.png' });
  check('tracker: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function both() {
  const { ctx, page, errors } = await openLiveCamera();
  const gpu = (await page.evaluate(() => window.__meiyan.delegate)) === 'GPU';
  const n = gpu ? await loseTracker(page) : 0;
  await loseDisplay(page);
  await page.waitForTimeout(800);
  check('both: lost overlay shown', (await page.getByText('正在恢復畫面…').count()) > 0, `${n} tracker context(s) lost`);
  await page.evaluate(() => window.__lc.restoreContext()); // the display only; the tracker rebuilds itself
  const ms = await waitFor(page, (d) => d?.face === true && d.fps > 0);
  check('both: overlay clears after the display restore', (await page.getByText('正在恢復畫面…').count()) === 0);
  check('both: face + frames resume', ms >= 0, `${ms} ms after display restore`);
  await page.screenshot({ path: 'tests/harness/t7/shots/45-real-both-contexts-restored.png' });
  check('both: no console errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

const runs = { display, tracker, both };
for (const s of scenarios) {
  if (!runs[s]) throw new Error(`unknown scenario ${s} (display | tracker | both)`);
  console.log(`── ${s}`);
  await runs[s]();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : 'all PASS');
process.exit(failures ? 1 : 0);
