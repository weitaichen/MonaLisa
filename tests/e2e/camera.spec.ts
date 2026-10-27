import type { Page } from '@playwright/test';
import { debugState, dragSlider, expect, grab, hold, mad, meanLuma, shot, test } from './fixtures';

test('camera: gate → live beautified preview with face → panel → slider → shutter → review', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  const gate = page.getByRole('button', { name: '點擊開啟相機' });
  await expect(gate).toBeVisible();
  await shot(page, '02-camera-gate');
  await gate.click();

  // live: stream running, engine + tracker up, face found, frames flowing
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0 && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const live = await debugState(page);
  expect(live.delegate === 'GPU' || live.delegate === 'CPU').toBe(true);
  expect(live.lastError).toBeNull();
  const shutter = page.getByRole('button', { name: '拍照' });
  await expect(shutter).toBeEnabled();
  await expect(page.getByText('未偵測到臉部')).toHaveCount(0);
  await shot(page, '03-camera-live');

  // panel tabs switch
  for (const label of ['一鍵', '美型', '濾鏡', '美妝', '美膚']) {
    const tab = page.getByRole('tab', { name: label });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    if (label === '美型') await expect(page.getByRole('option', { name: '大眼', exact: true })).toBeVisible();
    if (label === '濾鏡') await expect(page.getByRole('option', { name: '暖調', exact: true })).toBeVisible();
    if (label === '美妝') await expect(page.getByRole('option', { name: '原色', exact: true }).first()).toBeVisible();
  }
  await page.getByRole('tab', { name: '美型' }).click();
  await shot(page, '04-camera-tab-shape');
  await page.getByRole('tab', { name: '美膚' }).click();

  // slider changes a param: visible pixel change in the live preview, well above frame-to-frame jitter
  const frame = page.locator('.cam-stage .frame');
  await page.getByRole('option', { name: '美白', exact: true }).click();
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-label', '美白');
  const before = Number(await slider.getAttribute('aria-valuenow'));
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  expect(before).toBeLessThan(100);
  await page.waitForTimeout(800);
  const b = await grab(frame, '05-camera-whiten-100');
  const change = mad(a1, b);
  console.log(`live preview: jitter ${jitter.toFixed(2)}, whiten ${before}→100 change ${change.toFixed(2)} (0..255)`);
  expect(change).toBeGreaterThan(Math.max(2, 4 * jitter));
  expect(meanLuma(b)).toBeGreaterThan(meanLuma(a1));
  // persisted live look (debounced 300 ms)
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? '{}').photo?.values?.['skin.whiten']))
    .toBe(1);

  // hold-to-compare shows the unprocessed frame
  const release = await hold(page, page.locator('.cam-controls .side-btn', { hasText: '按住對比' }));
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();
  await page.waitForTimeout(500);
  const held = await grab(frame, '06-camera-compare-held');
  await release();
  expect(mad(held, b)).toBeGreaterThan(2);

  // tapping the preview collapses the panel; a visible 美顏 control brings it back
  await frame.click({ position: { x: 24, y: 64 } });
  await expect(page.locator('.panel.collapsed')).toHaveCount(1);
  const reopen = page.locator('.panel-reopen');
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.locator('.panel.collapsed')).toHaveCount(0);
  await expect(reopen).toHaveCount(0);
  await expect(page.getByRole('slider')).toBeVisible();

  // shutter → review with the captured image
  await page.waitForTimeout(500);
  await shutter.click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await expect(page.locator('canvas[aria-label="拍攝結果"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '儲存' })).toBeVisible({ timeout: 30_000 });
  const info = await page.locator('canvas[aria-label="拍攝結果"]').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { w: c.width, h: c.height, luma: sum / (d.length / 4) };
  });
  expect(info).not.toBeNull();
  // 1280×720 fake camera, centre-cropped to the default 3:4 frame
  expect(info!.h).toBe(720);
  expect(info!.w / info!.h).toBeCloseTo(3 / 4, 2);
  expect(info!.luma).toBeGreaterThan(20);
  await shot(page, '07-review');

  // review → editor on the unprocessed capture
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 30_000 });
  await shot(page, '08-review-to-editor');
});

test('before the stream is live (the gate), 一鍵 presets are off with the note and a tap saves nothing; live with a face they apply whole (round-1 review C4)', async ({ page }) => {
  const presetLink = () => page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? '{}').photo?.presetLink?.id ?? null);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  const gate = page.getByRole('button', { name: '點擊開啟相機' });
  await expect(gate).toBeVisible();
  await page.getByRole('tab', { name: '一鍵' }).click();
  const natural = page.getByRole('option', { name: '自然', exact: true });
  await expect(natural).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.strip-note', { hasText: '開啟相機並對準人臉後即可調整' })).toBeVisible();
  // a disabled item stays tappable (aria-disabled): the tap shows the reason and changes nothing
  await natural.click({ force: true });
  await page.waitForTimeout(800);
  expect(await presetLink()).toBeNull();
  // photo items stay usable before the stream too
  await page.getByRole('tab', { name: '濾鏡' }).click();
  await expect(page.getByRole('option', { name: '暖調', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await gate.click();
  await expect.poll(async () => (await debugState(page)).face, { timeout: 90_000, intervals: [500] }).toBe(true);
  await page.getByRole('tab', { name: '一鍵' }).click();
  await expect(natural).not.toHaveAttribute('aria-disabled', 'true');
  await natural.click();
  await expect.poll(presetLink).toBe('natural');
  await expect.poll(async () => (await debugState(page)).boxes?.some((b) => b.edited) ?? false).toBe(true);
});

test('A1: a lone selfie stays on the solo path: one short-range VIDEO pass on every frame', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).face, { timeout: 90_000, intervals: [500] }).toBe(true);
  for (let i = 0; i < 20; i++) {
    const d = await debugState(page);
    expect(d).toMatchObject({ livePath: 'solo', liveDetector: 'short-range' });
    // every frame, tier L every second (§6.4 effectiveEvery): SwiftShader's slow frames may step the auto tier down to
    // L, which alone gives 2 (round-1 review C23). At most: the frame that steps down publishes tier L with the k it
    // used, 1, so a check for exactly 2 there could fail on a frame that did as A1 says
    expect(d.liveEvery, `tier ${d.tier}`).toBeLessThanOrEqual(d.tier === 'L' ? 2 : 1);
    await page.waitForTimeout(250);
  }
});

/** what iOS does when the user swipes home: the page turns hidden (and back) */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

/** the camera controller's hidden <video>: its stream's video track states ([] = no stream attached) */
const captureTracks = (page: Page) =>
  page.evaluate(() => {
    const s = document.querySelector('video')?.srcObject as MediaStream | null | undefined;
    return s ? s.getVideoTracks().map((t) => t.readyState) : [];
  });

const liveWithFrames = async (page: Page) => {
  const d = await debugState(page);
  return d.cameraState === 'live' && d.fps > 0;
};

test('camera: the background stops the capture, a quick return restarts it by itself (0.5.1)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(() => liveWithFrames(page), { timeout: 90_000, intervals: [500] }).toBe(true);
  expect(await captureTracks(page)).toEqual(['live']);

  await setVisibility(page, 'hidden');
  await expect.poll(async () => (await debugState(page)).cameraState).toBe('interrupted');
  expect(await captureTracks(page)).toEqual([]); // nothing captures in the background

  await setVisibility(page, 'visible');
  await expect.poll(() => liveWithFrames(page), { timeout: 30_000, intervals: [250] }).toBe(true);
  expect(await captureTracks(page)).toEqual(['live']);
  await expect(page.getByText('相機已暫停')).toHaveCount(0);
  expect((await debugState(page)).lastError).toBeNull();
});

test('camera: a getUserMedia that does not answer shows 相機還沒有回應 under the spinner; its late answer goes live (0.5.1)', async ({ page }) => {
  // the first request is held until __answerGum(): WebKit can leave one unanswered
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const w = window as unknown as { __gumCalls: number; __answerGum?: () => void };
    w.__gumCalls = 0;
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      w.__gumCalls++;
      const answer = real(c);
      if (w.__gumCalls > 1) return answer;
      return new Promise<MediaStream>((resolve, reject) => {
        w.__answerGum = () => void answer.then(resolve, reject);
      });
    };
  });
  const gumCalls = () => page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls);

  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect(page.getByText('正在開啟相機…')).toBeVisible();
  // ANSWER_TIMEOUT_MS (8 s) later: still waiting, the permission prompt named first, no 重試 (it would wait for the same request)
  await expect(page.getByText('相機還沒有回應')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/請點「允許」/)).toBeVisible();
  await expect(page.getByText('錯誤代碼：noanswer')).toBeVisible();
  await expect(page.locator('.status .spinner')).toBeVisible();
  await expect(page.getByRole('button', { name: '重試' })).toHaveCount(0);
  expect((await debugState(page)).cameraState).toBe('starting');

  // back home and in again (點擊開啟相機): no second request queued behind the unanswered one
  await page.getByRole('button', { name: '回首頁' }).click();
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  expect(await gumCalls()).toBe(1);

  await page.evaluate(() => (window as unknown as { __answerGum: () => void }).__answerGum());
  await expect.poll(() => liveWithFrames(page), { timeout: 90_000, intervals: [500] }).toBe(true);
  expect(await gumCalls()).toBe(1);
  await expect(page.getByText('相機還沒有回應')).toHaveCount(0);
});

test('camera: a stream that never shows a frame (WK 252465) is stopped and asked for again by itself (0.5.1)', async ({ page }) => {
  // the first answer is a stream with no frame ever: a canvas captured at 0 fps that is never asked for one
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const w = window as unknown as { __gumCalls: number; __deadTrack?: MediaStreamTrack };
    w.__gumCalls = 0;
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (++w.__gumCalls > 1) return real(c);
      const s = document.createElement('canvas').captureStream(0);
      w.__deadTrack = s.getVideoTracks()[0];
      return s;
    };
  });
  const probe = () =>
    page.evaluate(() => {
      const w = window as unknown as { __gumCalls: number; __deadTrack?: MediaStreamTrack };
      return { calls: w.__gumCalls, dead: w.__deadTrack?.readyState ?? null };
    });

  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect(page.getByText('正在開啟相機…')).toBeVisible();
  expect(await probe()).toEqual({ calls: 1, dead: 'live' });
  // FRAME_TIMEOUT_MS (5 s) + REACQUIRE_DELAY_MS later: the dead stream stopped, a second request, live
  await expect.poll(() => liveWithFrames(page), { timeout: 60_000, intervals: [500] }).toBe(true);
  expect(await probe()).toEqual({ calls: 2, dead: 'ended' });
  expect(await captureTracks(page)).toEqual(['live']);
  await expect(page.getByText('收不到相機畫面')).toHaveCount(0);
});

/** a Home Screen app (platform.ts isStandalone): its camera cards carry the close-the-app and Safari steps */
const asHomeScreenApp = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }));

/**
 * The whole card can be read on a small screen: its first line is not cut off, and scrolling the card itself (a wheel
 * over it, as a finger would; the stage around it cannot scroll) brings its last line, the buttons, fully into view.
 */
async function cardReadable(page: Page): Promise<void> {
  const card = page.locator('.status');
  // it does not fit (else this proves nothing)
  expect(await card.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(card.locator(':scope > :first-child')).toBeInViewport({ ratio: 1 });
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect(card.locator(':scope > :last-child')).toBeInViewport({ ratio: 1 });
}

test.describe('the long camera cards on a small iPhone (SE: 375×667, less its 20 px status bar)', () => {
  test.use({ viewport: { width: 375, height: 647 } });

  test('收不到相機畫面 scrolls, nothing cut off; a short card stays centred (0.5.1)', async ({ page }) => {
    await asHomeScreenApp(page);
    // every answer is a stream with no frame ever: the one asked for again shows none either
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => document.createElement('canvas').captureStream(0);
    });
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    const gate = page.getByRole('button', { name: '點擊開啟相機' });
    await expect(gate).toBeVisible();
    // the gate fits: as far from the top of the stage as from its bottom
    const fit = await page.locator('.status').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = el.firstElementChild!.getBoundingClientRect().top - r.top;
      const bottom = r.bottom - el.lastElementChild!.getBoundingClientRect().bottom;
      return { top, bottom, scrolls: el.scrollHeight > el.clientHeight };
    });
    expect(fit.scrolls).toBe(false);
    expect(Math.abs(fit.top - fit.bottom)).toBeLessThan(2);

    await gate.click();
    await expect(page.getByText('收不到相機畫面')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/App 切換器/)).toBeVisible();
    await cardReadable(page);
    await expect(page.getByRole('button', { name: '改用匯入照片' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: '重試' })).toBeInViewport({ ratio: 1 });
  });

  test('相機還沒有回應 scrolls under its spinner, nothing cut off (0.5.1)', async ({ page }) => {
    await asHomeScreenApp(page);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>(() => {});
    });
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    await expect(page.getByText('相機還沒有回應')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/App 切換器/)).toBeVisible();
    await cardReadable(page);
    await expect(page.getByRole('button', { name: '改用匯入照片' })).toBeInViewport({ ratio: 1 });
  });
});
