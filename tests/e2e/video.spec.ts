// 美顏錄影 (beauty video spec §4.1, §4.2, §4.6, §5) on Chromium's fake camera and microphone: 拍照 / 錄影, the record
// and stop shutter, the locks and the badge while recording, the clip screen and its save dialog, the 60 s cap (a
// test-only shorter one), the background mid-recording, the microphone refused, unanswered or left mid-ask, 計時, a
// clip under 1 s, a recorder that stops by itself, and a browser that cannot record. The production CSP blocks fetch()
// of a blob: URL, so the clip's metadata is read from the debug state (`__meiyan.clip`, set where the camera makes the
// clip) and the <video> decoding it proves the file (task-6 ruling 1).
import type { Page } from '@playwright/test';
import { debugState, expect, groupModeButton, test, toastsSeen, watchToasts } from './fixtures';

const CLIP_NAME = /^meiyan-\d{8}-\d{6}\.mp4$/;

/** the camera screen live with a face and frames flowing (the flow camera.spec.ts runs), then 錄影 */
async function openVideo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await liveWithFace(page);
  await pickVideo(page);
}

async function liveWithFace(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0 && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
}

/** 錄影 in the 拍照 / 錄影 switch (a radiogroup above the shutter row) */
async function pickVideo(page: Page): Promise<void> {
  const video = page.getByRole('radio', { name: '錄影' });
  await expect(video).toBeEnabled();
  await video.click();
  await expect(video).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeVisible();
}

/** 開始錄影; the badge counts while it records */
async function startRecording(page: Page): Promise<void> {
  await page.getByRole('button', { name: '開始錄影' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
}

/** 開始錄影 and 停止錄影 within the same second, in the page (two Playwright clicks can take longer than that here) */
const quickClip = (page: Page) =>
  page.evaluate(async () => {
    const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    button('開始錄影')!.click();
    for (let i = 0; i < 200 && !button('停止錄影'); i++) await new Promise((r) => setTimeout(r, 5));
    button('停止錄影')!.click();
  });

/** the clip screen open on a clip that decodes; the clip the camera made (DebugState.clip) */
async function clipShown(page: Page): Promise<NonNullable<Awaited<ReturnType<typeof debugState>>['clip']>> {
  await expect.poll(async () => (await debugState(page)).screen, { timeout: 30_000 }).toBe('clip');
  const video = page.locator('video[aria-label="錄影結果"]');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  const clip = (await debugState(page)).clip;
  expect(clip, '__meiyan.clip').toBeTruthy();
  return clip!;
}

/** what iOS does when the user swipes home: the page turns hidden (and back), as camera.spec.ts */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

/**
 * Every audio-only getUserMedia (the microphone, src/media/mic.ts): the camera's state when it was asked (the debug
 * state), and the streams it answered; `refuse` rejects each with NotAllowedError instead. The camera's own requests
 * (audio: false) pass through. An init script: call before page.goto.
 */
async function watchMic(page: Page, refuse = false): Promise<void> {
  await page.addInitScript((refuse: boolean) => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const w = window as unknown as { __micAsks: string[]; __micStreams: MediaStream[] };
    w.__micAsks = [];
    w.__micStreams = [];
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (!c?.audio || c.video) return real(c);
      w.__micAsks.push(window.__meiyan?.cameraState ?? 'none');
      if (refuse) throw new DOMException('denied', 'NotAllowedError');
      const s = await real(c);
      w.__micStreams.push(s);
      return s;
    };
  }, refuse);
}
/**
 * The microphone's prompt left up: every audio-only getUserMedia waits until `__answerMic()` (then answers it, the
 * streams kept as watchMic does). Counted in __micAsks. An init script: call before page.goto.
 */
async function holdMic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    const w = window as unknown as { __micAsks: string[]; __micStreams: MediaStream[]; __answerMic?: () => void };
    w.__micAsks = [];
    w.__micStreams = [];
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      if (!c?.audio || c.video) return real(c);
      w.__micAsks.push(window.__meiyan?.cameraState ?? 'none');
      return new Promise<MediaStream>((resolve, reject) => {
        w.__answerMic = () =>
          void real(c).then((s) => {
            w.__micStreams.push(s);
            resolve(s);
          }, reject);
      });
    };
  });
}
const answerMic = (page: Page) => page.evaluate(() => (window as unknown as { __answerMic: () => void }).__answerMic());
const micAsks = (page: Page) => page.evaluate(() => (window as unknown as { __micAsks: string[] }).__micAsks);
/** the readyState of every microphone track the page was given */
const micTracks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __micStreams: MediaStream[] }).__micStreams.flatMap((s) => s.getAudioTracks().map((t) => t.readyState)));

test('錄影: record about 2 s, the clip screen plays an MP4 with sound', async ({ page }) => {
  await openVideo(page);
  await startRecording(page);
  // locked while recording (spec §4.1): 比例, 計時, 合照模式, 切換鏡頭, ✕, 相簿, 按住對比 and the mode switch
  await expect(page.getByRole('button', { name: /^比例/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '切換鏡頭' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^計時/ })).toBeDisabled();
  await expect(groupModeButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '回首頁' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '相簿' })).toBeDisabled();
  await expect(page.locator('.cam-controls .side-btn', { hasText: '按住對比' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '拍照' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '錄影' })).toBeDisabled();
  await expect(page.getByRole('timer')).toHaveText(/^● \d\d:\d\d$/);
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: '停止錄影' }).click();

  const clip = await clipShown(page);
  expect(clip.type).toBe('video/mp4');
  expect(clip.size).toBeGreaterThan(0);
  expect(clip.hasAudio).toBe(true);
  expect(clip.name).toMatch(CLIP_NAME);
  // spec §5: 1.5 s or more, and its sound decodes (Chromium's counter; the clip plays muted, decoding all the same)
  const video = page.locator('video[aria-label="錄影結果"]');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThanOrEqual(1.5);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) => v.webkitAudioDecodedByteCount ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(0);
});

test('儲存 on the clip screen opens the video save dialog', async ({ page }) => {
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '停止錄影' }).click();
  await clipShown(page);
  // Chromium has no share sheet: 儲存 opens the save dialog (Task 5), on a video
  await page.getByRole('button', { name: '儲存' }).click();
  const dialog = page.getByRole('dialog', { name: '儲存影片' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('video')).toHaveAttribute('data-name', CLIP_NAME);
  await expect(dialog.getByRole('link', { name: '下載影片' })).toHaveAttribute('download', CLIP_NAME);
});

test('the cap stops the recording by itself', async ({ page }) => {
  // the test-only cap (read when a recording starts): 2.5 s instead of MAX_CLIP_MS
  await page.addInitScript(() => ((window as unknown as { __meiyanClipCapMs: number }).__meiyanClipCapMs = 2500));
  await openVideo(page);
  await watchToasts(page);
  await startRecording(page);
  // no stop tap
  const clip = await clipShown(page);
  expect(clip.size).toBeGreaterThan(0);
  expect(await toastsSeen(page)).toContain('已錄滿 60 秒');
});

test('the background mid-recording keeps the clip', async ({ page }) => {
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await setVisibility(page, 'hidden');
  // 0.5.1 stops the capture in the background: the recording stops and keeps what it has (spec §4.6, G5)
  await expect.poll(async () => (await debugState(page)).cameraState).toBe('interrupted');
  await setVisibility(page, 'visible');
  const clip = await clipShown(page);
  expect(clip.size).toBeGreaterThan(0);
  expect(clip.name).toMatch(CLIP_NAME);
});

test('a refused microphone records silently with a note', async ({ page }) => {
  await watchMic(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  // 錄影 picked at the gate: the camera's own request is not out yet, so nothing is asked until the record tap (§4.2)
  await pickVideo(page);
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await liveWithFace(page);
  await watchToasts(page);
  expect(await micAsks(page)).toEqual([]);

  // a first clip under 1 s (discarded) and a second one: the note shows once per camera visit
  await quickClip(page);
  await expect.poll(() => toastsSeen(page)).toEqual(['無法使用麥克風，影片將沒有聲音', '錄影時間太短']);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '停止錄影' }).click();
  const clip = await clipShown(page);
  expect(clip.hasAudio).toBe(false);
  expect(clip.size).toBeGreaterThan(0);
  expect((await toastsSeen(page)).filter((t) => t === '無法使用麥克風，影片將沒有聲音')).toHaveLength(1);
  // each record tap asked (a refused microphone is asked again), and only while the camera was live (§4.2, 0.5.1)
  expect(await micAsks(page)).toEqual(['live', 'live']);
});

test('a clip under 1 s is discarded with 錄影時間太短: still in 錄影 with the microphone held; 拍照 turns it off', async ({ page }) => {
  await watchMic(page);
  await openVideo(page);
  // entering 錄影 with the camera live asks once (§4.2)
  await expect.poll(() => micTracks(page)).toEqual(['live']);
  await watchToasts(page);
  await quickClip(page);
  await expect.poll(() => toastsSeen(page)).toEqual(['錄影時間太短']);
  expect((await debugState(page)).screen).toBe('camera');
  // the controls are back, the shutter records again, and the microphone is still held: not asked again
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^比例/ })).toBeEnabled();
  await expect(page.getByRole('radio', { name: '拍照' })).toBeEnabled();
  expect(await micTracks(page)).toEqual(['live']);
  expect(await micAsks(page)).toEqual(['live']);

  // leaving 錄影 turns the microphone off (the anti-goal: no orange indicator outside 錄影); 拍照 is the photo shutter again
  await page.getByRole('radio', { name: '拍照' }).click();
  await expect.poll(() => micTracks(page)).toEqual(['ended']);
  await expect(page.getByRole('button', { name: '拍照' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '開始錄影' })).toHaveCount(0);
});

test('record tapped while the microphone prompt is still up: silent within MIC_ANSWER_MS with the note, no second ask (plan Review Focus #1)', async ({ page }) => {
  await holdMic(page);
  await openVideo(page);
  await watchToasts(page);
  const shutter = page.getByRole('button', { name: '開始錄影' });
  await shutter.click();
  // the shutter waits for the answer (aria-busy), then the recording goes ahead without sound
  await expect(shutter).toHaveAttribute('aria-busy', 'true');
  await expect(shutter).toBeDisabled();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 10_000 });
  expect(await toastsSeen(page)).toEqual(['無法使用麥克風，影片將沒有聲音']);
  // the record tap joined the request the 錄影 tap left out: one ask
  expect(await micAsks(page)).toEqual(['live']);
  await answerMic(page);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '停止錄影' }).click();
  const clip = await clipShown(page);
  expect(clip.hasAudio).toBe(false);
  // the late answer was held while in 錄影; the clip screen is no camera: the microphone is off (spec §4.2)
  await expect.poll(() => micTracks(page)).toEqual(['ended']);
});

test('leaving 錄影 with the microphone still asked: no note, 切換鏡頭 waits for the answer, which is turned off (rulings 3, 4, 6)', async ({ page }) => {
  await holdMic(page);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await liveWithFace(page);
  await watchToasts(page);
  const flip = page.getByRole('button', { name: '切換鏡頭' });
  await expect(flip).toBeEnabled();
  await pickVideo(page);
  // WebKit answers getUserMedia one at a time: a camera request now would queue behind the microphone's
  await expect(flip).toBeDisabled();
  await page.getByRole('radio', { name: '拍照' }).click();
  await expect(page.getByRole('button', { name: '拍照' })).toBeEnabled();
  await expect(flip).toBeDisabled();
  await answerMic(page);
  await expect(flip).toBeEnabled();
  await expect.poll(() => micTracks(page)).toEqual(['ended']);
  expect(await toastsSeen(page)).toEqual([]);
  expect((await debugState(page)).screen).toBe('camera');
});

test('計時: the photo countdown still takes the shot; in 錄影 the microphone is asked at the tap, 取消倒數 drops the start, a full countdown records (ruling 8)', async ({ page }) => {
  test.setTimeout(180_000);
  // refused: every record tap asks again, so the ask is seen at the tap itself
  await watchMic(page, true);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await liveWithFace(page);
  const timer = page.getByRole('button', { name: /^計時/ });
  await timer.click();
  await expect(timer).toHaveAttribute('aria-label', '計時 3 秒');

  // 拍照: cancelled, nothing taken; then a full countdown takes the shot
  await page.getByRole('button', { name: '拍照' }).click();
  await page.getByRole('button', { name: '取消倒數' }).click();
  await expect(page.getByRole('button', { name: '拍照' })).toBeEnabled();
  await page.waitForTimeout(3500);
  expect((await debugState(page)).screen).toBe('camera');
  await page.getByRole('button', { name: '拍照' }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await expect.poll(async () => (await debugState(page)).screen, { timeout: 15_000 }).toBe('review');

  // 錄影, back from 重拍 (the camera kept running): the record tap asks before its countdown
  await page.getByRole('button', { name: '重拍' }).click();
  await liveWithFace(page);
  await pickVideo(page);
  await watchToasts(page);
  const asked = (await micAsks(page)).length;
  await page.getByRole('button', { name: '開始錄影' }).click();
  await expect(page.getByRole('button', { name: '取消倒數' })).toBeVisible();
  expect(await micAsks(page)).toHaveLength(asked + 1);
  // 取消倒數: no recording, no note
  await page.getByRole('button', { name: '取消倒數' }).click();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeEnabled();
  expect(await toastsSeen(page)).toEqual([]);
  // a full countdown, then the recording
  await page.getByRole('button', { name: '開始錄影' }).click();
  await expect(page.locator('.countdown')).toBeVisible();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 10_000 });
  expect(await toastsSeen(page)).toEqual(['無法使用麥克風，影片將沒有聲音']);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '停止錄影' }).click();
  expect((await clipShown(page)).hasAudio).toBe(false);
});

test('a recorder that stops by itself keeps the clip (ruling 14)', async ({ page }) => {
  // every MediaRecorder the page makes, so the test can stop one behind the camera's back (an encoder failure, the
  // browser ending it)
  await page.addInitScript(() => {
    const Real = window.MediaRecorder;
    const w = window as unknown as { __recorders: MediaRecorder[] };
    w.__recorders = [];
    window.MediaRecorder = class extends Real {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        w.__recorders.push(this);
      }
    };
  });
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { __recorders: MediaRecorder[] }).__recorders[0].stop());
  // no 停止錄影 tap: the camera stops and keeps what was recorded, as for the background
  const clip = await clipShown(page);
  expect(clip.size).toBeGreaterThan(0);
});

test('a browser that cannot record says 這個瀏覽器無法錄影 and stays on 拍照', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { MediaRecorder?: unknown }).MediaRecorder;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await watchToasts(page);
  await page.getByRole('radio', { name: '錄影' }).click();
  await expect.poll(() => toastsSeen(page)).toContain('這個瀏覽器無法錄影');
  await expect(page.getByRole('radio', { name: '拍照' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: '錄影' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: '開始錄影' })).toHaveCount(0);
});
