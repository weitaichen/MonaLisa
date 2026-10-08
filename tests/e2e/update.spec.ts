// 有新版本 prompt, end to end with two real builds: build A (package.json's version) and build B
// (MEIYAN_VERSION = A's patch + 1) are built once into their own dirs; a "deploy" copies one of them into the
// dir served by this spec's own `vite preview` (not dist/, not port 4173). The page installs A's service
// worker, B is deployed, and the app's own check (visibilitychange) must find it. The waiting worker is
// offered only on 首頁 / 設定 (never in the editor or the camera), 稍後 hides it until the next launch, and
// 更新 reloads into B — also in the first session (uncontrolled at load) — which then says 已更新至 once, as
// does a cold launch that picks up a waiting worker without 更新.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { CHECK_GAP_MS } from '../../src/ui/updateModel';
import { displayVersion } from '../../src/version';
import { debugState, expect, SAMPLE_FACE, shot, test } from './fixtures';

const root = resolve(import.meta.dirname, '../..');
/** served by this spec's preview server */
const OUT = resolve(root, 'dist-e2e-update');
const BUILD_A = resolve(root, 'dist-e2e-update-a');
const BUILD_B = resolve(root, 'dist-e2e-update-b');
const PORT = 4183;
const URL_A = `http://127.0.0.1:${PORT}/`;
const VITE = resolve(root, 'node_modules/vite/bin/vite.js');

const A = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;
const B = A.replace(/\d+$/, (p) => String(Number(p) + 1));

function build(version: string | null, outDir: string): void {
  const env = { ...process.env };
  delete env.MEIYAN_VERSION;
  if (version) env.MEIYAN_VERSION = version;
  execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
}

/** Replace the served files with one build, like a deploy (the other build's hashed assets are gone). */
function deploy(from: string): void {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f), { recursive: true, force: true });
  cpSync(from, OUT, { recursive: true });
}

let server: ChildProcess | null = null;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`${URL_A}version.json`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`update e2e server on :${PORT} did not start`);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  build(null, BUILD_A);
  build(B, BUILD_B);
  deploy(BUILD_A);
  server = spawn(process.execPath, [VITE, 'preview', '--outDir', OUT, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  });
  await waitForServer();
});

test.afterAll(() => {
  server?.kill();
  server = null;
});

const banner = (page: Page) => page.locator('.update-card');
const toastEl = (page: Page) => page.locator('.toast');

async function footerVersion(page: Page): Promise<string> {
  await page.getByRole('button', { name: '設定' }).click();
  const sheet = page.getByRole('dialog', { name: '設定' });
  await expect(sheet).toBeVisible();
  const text = (await sheet.locator('.sheet-foot').textContent()) ?? '';
  await sheet.getByRole('button', { name: '完成' }).click();
  await expect(sheet).toHaveCount(0);
  return text;
}

const hasWaiting = (page: Page) => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

/**
 * What the app does when it comes back to the foreground (ui/update.ts onRegisteredSW): a visibilitychange,
 * with the clock past CHECK_GAP_MS since register() so the app's own shouldCheck gate lets the check through.
 */
async function appCheck(page: Page): Promise<void> {
  await page.evaluate((gap) => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + gap + 1_000;
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Date.now = real;
    }
  }, CHECK_GAP_MS);
}

/** A fresh install of build A: the first session starts uncontrolled and is claimed once A's worker is ready. */
async function installA(page: Page): Promise<void> {
  deploy(BUILD_A);
  await page.addInitScript(() => {
    (window as unknown as { controlledAtLoad: boolean }).controlledAtLoad = !!navigator.serviceWorker?.controller;
  });
  await page.goto(URL_A);
  // clientsClaim: A's worker takes this first session over once installed (precache complete)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { controlledAtLoad: boolean }).controlledAtLoad)).toBe(false);
  // a fresh install announces nothing
  await expect(toastEl(page)).toHaveCount(0);
  expect(await footerVersion(page)).toBe(`MonaLisa 美顏 · ${displayVersion(A)}`);
  await expect(banner(page)).toHaveCount(0);
}

test('new version: offered on 首頁 / 設定 only, 稍後 until next launch, 更新 reloads into it', async ({ page }) => {
  test.setTimeout(360_000);
  expect(B).not.toBe(A);

  // ── build A, served with the production headers (version.json / sw.js not cacheable) ──
  deploy(BUILD_A);
  const v = await page.request.get(`${URL_A}version.json`);
  expect(await v.json()).toEqual({ version: A });
  expect(v.headers()['cache-control']).toBe('no-cache');
  expect((await page.request.get(`${URL_A}sw.js`)).headers()['cache-control']).toBe('public, max-age=0, must-revalidate');

  await installA(page);

  // ── into the editor (engine loaded, so nothing is downloading when the files are swapped) ──
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  expect((await debugState(page)).screen).toBe('editor');

  // ── deploy B while the user edits; the open app finds it when it comes back to the foreground ──
  deploy(BUILD_B);
  expect(await (await page.request.get(`${URL_A}version.json`)).json()).toEqual({ version: B });
  expect(await hasWaiting(page)).toBe(false);
  await appCheck(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 60_000 });
  await expect.poll(async () => (await debugState(page)).update).toBe('available');
  // detected, but an edit is never interrupted
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByText(/有新版本/)).toHaveCount(0);

  // back on 首頁 → offered, naming the new version
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).locator('b')).toHaveText(`有新版本 ${displayVersion(B)}`);
  await expect(banner(page)).toContainText(`目前 ${displayVersion(A)}`);
  await expect(page.locator('.update-live.home')).toHaveAttribute('aria-live', 'polite');
  // ≥ 44pt targets
  for (const name of ['更新', '稍後']) {
    const box = await banner(page).getByRole('button', { name }).boundingBox();
    expect(box && box.height >= 44 && box.width >= 44, `${name} target ${JSON.stringify(box)}`).toBe(true);
  }
  await shot(page, 'u01-update-banner-home');

  // ── the camera never shows it either (live preview running) ──
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  await expect(banner(page)).toHaveCount(0);
  await expect(page.getByText(/有新版本/)).toHaveCount(0);
  await page.getByRole('button', { name: '回首頁' }).click();
  await expect(banner(page)).toBeVisible();

  // ── 設定 shows it too (and the floating one hides under the sheet) ──
  await page.getByRole('button', { name: '設定' }).click();
  const sheet = page.getByRole('dialog', { name: '設定' });
  await expect(sheet.locator('.update-card')).toBeVisible();
  await expect(banner(page)).toHaveCount(1);
  await expect(sheet.locator('.sheet-foot')).toHaveText(`MonaLisa 美顏 · ${displayVersion(A)}`);
  await shot(page, 'u02-update-banner-settings');

  // 稍後 → gone for this session, in 設定 and on 首頁
  await sheet.getByRole('button', { name: '稍後' }).click();
  await expect(banner(page)).toHaveCount(0);
  await sheet.getByRole('button', { name: '完成' }).click();
  await expect(banner(page)).toHaveCount(0);

  // next launch: still waiting (skipWaiting is off) → offered again
  await page.reload();
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
  await expect(banner(page).locator('b')).toHaveText(`有新版本 ${displayVersion(B)}`);
  await expect(toastEl(page)).toHaveCount(0); // still A: nothing to announce
  expect(await footerVersion(page)).toBe(`MonaLisa 美顏 · ${displayVersion(A)}`);

  // ── 更新 → the screen is covered until the reload (no way into the camera on A's code under B's worker) ──
  // hold the hand-over to the waiting worker for a moment so the covered state can be looked at
  await page.evaluate(() => {
    const post = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (this: ServiceWorker, ...args: unknown[]) {
      window.setTimeout(() => (post as (...a: unknown[]) => void).apply(this, args), 2_000);
    };
  });
  const reloaded = page.waitForEvent('load', { timeout: 30_000 });
  await banner(page).getByRole('button', { name: '更新' }).click();
  const cover = page.locator('.status.scrim', { hasText: '正在更新…' });
  await expect(cover).toBeVisible();
  const tile = await page.getByRole('button', { name: /拍攝/ }).boundingBox();
  expect(tile).not.toBeNull();
  const covered = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.status.scrim'),
    { x: tile!.x + tile!.width / 2, y: tile!.y + tile!.height / 2 },
  );
  expect(covered, 'the 拍攝 tile is covered while updating').toBe(true);
  // ── …then the waiting worker takes over and the page reloads into B, which says so once ──
  await reloaded;
  await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(toastEl(page)).toHaveText(`已更新至 ${displayVersion(B)}`);
  expect(await footerVersion(page)).toBe(`MonaLisa 美顏 · ${displayVersion(B)}`);
  await expect(banner(page)).toHaveCount(0);
  expect(await hasWaiting(page)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByRole('button', { name: '設定' })).toBeVisible();
  await expect(toastEl(page)).toHaveCount(0);
});

test('first session (uncontrolled at load): 更新 reloads straight into the new version', async ({ page }) => {
  test.setTimeout(180_000);
  await installA(page);

  deploy(BUILD_B);
  await appCheck(page);
  await expect(banner(page)).toBeVisible({ timeout: 60_000 });
  await expect(banner(page).locator('b')).toHaveText(`有新版本 ${displayVersion(B)}`);

  // registerSW reloads by itself only for a page controlled at load: here the reload must come from
  // update.ts's own controllerchange listener, well before its 6 s fallback
  const clicked = Date.now();
  const reloaded = page.waitForEvent('load', { timeout: 5_000 });
  await banner(page).getByRole('button', { name: '更新' }).click();
  await reloaded;
  console.log(`[update] first session: 更新 → reload in ${Date.now() - clicked} ms`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(toastEl(page)).toHaveText(`已更新至 ${displayVersion(B)}`);
  expect(await footerVersion(page)).toBe(`MonaLisa 美顏 · ${displayVersion(B)}`);
  await expect(banner(page)).toHaveCount(0);
  expect(await hasWaiting(page)).toBe(false);
});

test('from a version without the banner (0.1): the next cold launch runs the new one and says 已更新至', async ({ page, context }) => {
  test.setTimeout(180_000);
  await installA(page);
  // 0.1 recorded no version: make A look like it
  await page.evaluate(() => localStorage.removeItem('meiyan.version.v1'));

  const workersOfA = new Set(context.serviceWorkers());
  deploy(BUILD_B);
  await appCheck(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 60_000 });
  /** B's own state, read inside B (a worker's view of its registration can lag: A's still says "no waiting") */
  const stateOfB = async (): Promise<string | null> => {
    for (const w of context.serviceWorkers()) {
      if (workersOfA.has(w)) continue;
      try {
        return await w.evaluate(() => (self as unknown as { serviceWorker: ServiceWorker }).serviceWorker.state);
      } catch {
        // stopped meanwhile
      }
    }
    return null;
  };
  await expect.poll(stateOfB, { timeout: 30_000 }).toBe('installed');

  // 更新 is never tapped: the app is closed and launched again, with no window left on A
  await page.close();
  // with the last window gone the waiting worker activates (asynchronously; a real relaunch comes later still)
  await expect.poll(stateOfB, { timeout: 30_000 }).toBe('activated');
  const next = await context.newPage();
  await next.goto(URL_A);
  await next.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(toastEl(next)).toHaveText(`已更新至 ${displayVersion(B)}`);
  expect(await footerVersion(next)).toBe(`MonaLisa 美顏 · ${displayVersion(B)}`);
  await expect(banner(next)).toHaveCount(0);
  await next.close();
});
