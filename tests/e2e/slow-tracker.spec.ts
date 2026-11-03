// 0.5.1 (roadmap §15): a face-tracker build past TRACKER_BUILD_TIMEOUT_MS (20 s) hands the UI 基本模式 and goes on; the
// tracker it brings later takes the 基本模式 bundle's place: the camera finds the face, and an editor opened meanwhile
// detects its photo then (once nothing is busy). MediaPipe's own wasm request is held (the engine download's warm-up of
// the same file goes through). page.route needs the service worker out of the way, and the timeout itself is reported as
// a console error: the fixtures' guard would fail on it, so these check the console themselves (as detector.spec.ts).
import { test as bare, type Page } from '@playwright/test';
import { debugState, dragSlider, expect, grab, hold, mad, SAMPLE_FACE, settled } from './fixtures';

/** console errors other than the timeout's own report; `release` lets MediaPipe's wasm request through */
async function holdTracker(page: Page): Promise<{ errors: string[]; release: () => void; wasm: () => number }> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/^\[meiyan\] createTracker:/.test(text) || /^INFO: Created TensorFlow Lite XNNPACK delegate/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let wasm = 0;
  await page.route('**/vision_wasm_internal.wasm', async (route) => {
    // the first request is the engine download's warm-up; MediaPipe's own (the tracker build) waits until released
    if (++wasm > 1) await held;
    await route.continue();
  });
  return { errors, release, wasm: () => wasm };
}

/** import the sample face from Home; the editor opens in 基本模式 once the tracker build timed out */
async function openInBasicMode(page: Page): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);
  await expect(page.getByText('正在啟動臉部偵測…')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
}

bare.describe('a slow face-tracker build (0.5.1)', () => {
  bare.use({ serviceWorkers: 'block' });

  bare('times out to 基本模式; the tracker that lands later is adopted and the open photo is detected', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await openInBasicMode(page);
    await page.getByRole('tab', { name: '美型' }).click();
    await expect(page.getByText('基本模式不支援臉型與美妝')).toBeVisible({ timeout: 30_000 });
    expect(t.wasm()).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).faces).toBe(0);

    t.release();
    // the late tracker takes the 基本模式 bundle's place: the editor binds again and detects the photo
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000, intervals: [500] }).toBe(1);
    await expect(page.getByText('基本模式不支援臉型與美妝')).toHaveCount(0);
    await expect(page.getByText('未偵測到臉部，臉型與美妝不會套用')).toHaveCount(0);
    const d = await debugState(page);
    expect(d.delegate === 'GPU' || d.delegate === 'CPU').toBe(true);
    expect(d.persons).toBe(1);
    expect(t.errors).toEqual([]);
  });

  bare('an editor in the middle of a slider drag when the tracker lands binds it only once the drag ends', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await openInBasicMode(page);
    await page.getByRole('tab', { name: '美膚' }).click();
    await page.getByRole('option', { name: '美白', exact: true }).click();
    const box = (await page.getByRole('slider').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, y, { steps: 4 });

    t.release();
    // adopted (the delegate is known again) while the drag holds: the photo is not detected under the finger
    await expect.poll(async () => (await debugState(page)).delegate, { timeout: 90_000, intervals: [250] }).not.toBeNull();
    await page.waitForTimeout(1500);
    expect((await debugState(page)).faces).toBe(0);

    await page.mouse.up();
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000, intervals: [250] }).toBe(1);
    expect(t.errors).toEqual([]);
  });

  bare('按住對比 held when the tracker lands: the photo bound again under the finger still shows the original', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await openInBasicMode(page);
    const frame = page.locator('.editor-stage .frame');
    await page.getByRole('tab', { name: '美膚' }).click();
    await page.getByRole('option', { name: '美白', exact: true }).click();
    await dragSlider(page, 400);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    const edited = await settled(frame);

    const release = await hold(page, page.getByRole('button', { name: '按住對比' }));
    await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();
    const original = await settled(frame);
    // the middle band: the 原圖 label (top-left) and the held button (bottom) differ by design
    const band = { x: 0, y: Math.round(original.height * 0.15), w: original.width, h: Math.round(original.height * 0.65) };
    expect(mad(edited, original, band)).toBeGreaterThan(2);

    t.release();
    // adopted and bound again while the hold is down (a hold is not busy): the new session takes the hold
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000, intervals: [500] }).toBe(1);
    expect(mad(await settled(frame), original, band)).toBeLessThan(0.5);
    await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();

    await release();
    await expect(page.locator('.corner-label', { hasText: '原圖' })).toHaveCount(0);
    expect(mad(await settled(frame), original, band)).toBeGreaterThan(2);
    expect(t.errors).toEqual([]);
  });

  bare('the camera runs in 基本模式 after the timeout, then the late tracker finds the face (「臉部偵測已啟動」)', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    await expect(page.getByText('正在啟動臉部偵測…')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.toast', { hasText: '臉部偵測啟動較慢' })).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => {
        const d = await debugState(page);
        return d.cameraState === 'live' && d.fps > 0;
      }, { timeout: 30_000, intervals: [250] })
      .toBe(true);
    expect((await debugState(page)).face).toBe(false);

    t.release();
    await expect(page.locator('.toast', { hasText: '臉部偵測已啟動' })).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await debugState(page)).face, { timeout: 60_000, intervals: [250] }).toBe(true);
    expect(t.errors).toEqual([]);
  });

  bare('a 磨皮 set in 基本模式 goes on to the faces when the tracker lands, as 全部套用 (round-7 review J1)', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    await expect(page.locator('.toast', { hasText: '臉部偵測啟動較慢' })).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => {
        const d = await debugState(page);
        return d.cameraState === 'live' && d.fps > 0;
      }, { timeout: 30_000, intervals: [250] })
      .toBe(true);
    // 基本模式: the panel edits the all-skin person
    await page.getByRole('tab', { name: '美膚' }).click();
    await page.getByRole('option', { name: '磨皮', exact: true }).click();
    await dragSlider(page, 400);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');

    t.release();
    await expect(page.locator('.toast', { hasText: '臉部偵測已啟動' })).toBeVisible({ timeout: 90_000 });
    // the face gets it, 全部套用 says so, and the panel shows it on the face
    await expect.poll(async () => (await debugState(page)).boxes?.some((b) => b.edited) ?? false, { timeout: 60_000, intervals: [250] }).toBe(true);
    await expect(page.locator('.all-chip')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    expect(t.errors).toEqual([]);
  });

  bare('按住對比 held in the camera when the tracker lands: the preview restarted under the finger still shows the original', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    const slow = page.locator('.toast', { hasText: '臉部偵測啟動較慢' });
    await expect(slow).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => {
        const d = await debugState(page);
        return d.cameraState === 'live' && d.fps > 0;
      }, { timeout: 30_000, intervals: [250] })
      .toBe(true);
    await page.getByRole('tab', { name: '美膚' }).click();
    await page.getByRole('option', { name: '美白', exact: true }).click();
    await dragSlider(page, 400);
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    await expect(slow).toHaveCount(0, { timeout: 10_000 });

    const frame = page.locator('.cam-stage .frame');
    const label = page.locator('.corner-label', { hasText: '原圖' });
    const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
    await expect(label).toBeVisible();
    await page.waitForTimeout(500);
    const original = await grab(frame);
    // the middle band: the 原圖 label (top-left) differs by design
    const band = { x: 0, y: Math.round(original.height * 0.15), w: original.width, h: Math.round(original.height * 0.65) };

    t.release();
    // adopted: the live loop restarts with the new bundle within one render, and takes the hold
    const started = page.locator('.toast', { hasText: '臉部偵測已啟動' });
    await expect(started).toBeVisible({ timeout: 90_000 });
    await expect(started).toHaveCount(0, { timeout: 10_000 });
    await expect(label).toBeVisible();
    expect(mad(await grab(frame), original, band)).toBeLessThan(1);

    await release();
    await expect(label).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(mad(await grab(frame), original, band)).toBeGreaterThan(2);
    expect(t.errors).toEqual([]);
  });

  bare('a live-loop restart mid-recording keeps recording (beauty video spec §4.3)', async ({ page }) => {
    bare.setTimeout(240_000);
    const t = await holdTracker(page);
    // the frames copied into the recording canvas (the one canvas captureStream is called on, recordCanvas.ts): a loop
    // restarted without the sink would leave the clip frozen, yet decodable. The cap moves out of a slow adoption's way
    await page.addInitScript(() => {
      const w = window as unknown as { __recFrames: number; __meiyanClipCapMs: number };
      w.__recFrames = 0;
      w.__meiyanClipCapMs = 600_000;
      const capture = HTMLCanvasElement.prototype.captureStream;
      HTMLCanvasElement.prototype.captureStream = function (this: HTMLCanvasElement, fps?: number) {
        const g = this.getContext('2d') as (CanvasRenderingContext2D & { drawImage: (...a: unknown[]) => void }) | null;
        if (g) {
          const draw = g.drawImage.bind(g) as (...a: unknown[]) => void;
          g.drawImage = (...a: unknown[]) => {
            w.__recFrames++;
            draw(...a);
          };
        }
        return capture.call(this, fps);
      };
    });
    const frames = () => page.evaluate(() => (window as unknown as { __recFrames: number }).__recFrames);
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    await expect(page.locator('.toast', { hasText: '臉部偵測啟動較慢' })).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => {
        const d = await debugState(page);
        return d.cameraState === 'live' && d.fps > 0;
      }, { timeout: 30_000, intervals: [250] })
      .toBe(true);

    // 基本模式 records too
    await page.getByRole('radio', { name: '錄影' }).click();
    await page.getByRole('button', { name: '開始錄影' }).click();
    const badge = page.getByRole('timer');
    await expect(badge).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await frames()).toBeGreaterThan(0);

    t.release();
    // adopted: the live loop restarts with the new bundle within one render, and the new loop feeds the same recording
    const started = page.locator('.toast', { hasText: '臉部偵測已啟動' });
    await expect(started).toBeVisible({ timeout: 90_000 });
    const atRestart = await frames();
    await expect.poll(frames, { timeout: 10_000 }).toBeGreaterThan(atRestart + 5);
    await expect(badge).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '停止錄影' }).click();

    await expect.poll(async () => (await debugState(page)).screen, { timeout: 30_000 }).toBe('clip');
    const video = page.locator('video[aria-label="錄影結果"]');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(t.errors).toEqual([]);
  });
});
