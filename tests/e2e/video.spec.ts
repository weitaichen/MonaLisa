// 美顏錄影 (beauty video spec §4.1, §4.2, §4.6, §5) on Chromium's fake camera and microphone: 拍照 / 錄影, the record
// and stop shutter, the locks and the badge while recording, the clip screen and its save dialog, the 60 s cap (a
// test-only shorter one), the background mid-recording, the microphone refused, unanswered or left mid-ask, 計時, a
// clip under 1 s, a recorder that stops by itself, and a browser that cannot record. The production CSP blocks fetch()
// of a blob: URL, so the clip's metadata is read from the debug state (`__meiyan.clip`, set where the camera makes the
// clip) and the <video> decoding it proves the file (task-6 ruling 1).
import { test as bare, type Page } from '@playwright/test';
import { VIDEO_MIMES, videoBitrate } from '../../src/media/recorder';
import { debugState, dragSlider, expect, groupModeButton, test, toastsSeen, watchToasts } from './fixtures';

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

/**
 * Every MediaRecorder the page makes, kept in __recorders: the app's own `new MediaRecorder` makes this subclass. An
 * init script: call before page.goto.
 */
async function keepRecorders(page: Page): Promise<void> {
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
}

/** a frame's look, for comparing what the clip shows: the luma of GRID_COLS × GRID_ROWS blocks, row-major */
const GRID_COLS = 12;
const GRID_ROWS = 16;
/** the grid rows clear of what the preview draws over the frame: the badge above, the slider row below */
const BAND = { from: 3, to: 13 };
const bandCells = (g: number[]) => g.filter((_, k) => Math.floor(k / GRID_COLS) >= BAND.from && Math.floor(k / GRID_COLS) < BAND.to);
const bandMean = (g: number[]) => bandCells(g).reduce((s, v) => s + v, 0) / bandCells(g).length;
/** the grid mirrored left ↔ right */
const mirrored = (g: number[]) => g.map((_, k) => g[Math.floor(k / GRID_COLS) * GRID_COLS + (GRID_COLS - 1 - (k % GRID_COLS))]);
/** Pearson correlation of two grids over BAND: 1 for the same picture whatever its brightness */
function bandCorr(a: number[], b: number[]): number {
  const x = bandCells(a);
  const y = bandCells(b);
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((xi, i) => {
    sxy += (xi - mx) * (y[i] - my);
    sxx += (xi - mx) ** 2;
    syy += (y[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * What the clip screen's video shows: its size, and the grids of its frames 0.3 s after its start and 0.3 s before its
 * end (the paused video sought; a same-origin blob: does not taint the canvas), and the grid of a preview screenshot
 */
async function clipContent(page: Page, previewPng: Buffer) {
  return page.locator('video[aria-label="錄影結果"]').evaluate(
    async (v: HTMLVideoElement, { b64, cols, rows }) => {
      const grid = (src: CanvasImageSource, w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(src, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        const sum = new Array<number>(cols * rows).fill(0);
        const n = new Array<number>(cols * rows).fill(0);
        for (let y = 0; y < h; y++) {
          const row = Math.min(rows - 1, Math.floor((y * rows) / h)) * cols;
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const k = row + Math.min(cols - 1, Math.floor((x * cols) / w));
            sum[k] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            n[k]++;
          }
        }
        return sum.map((s, k) => s / n[k]);
      };
      const seek = (t: number) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no seeked event at ${t} s`)), 10_000);
          v.addEventListener(
            'seeked',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          v.currentTime = t;
        });
      v.pause();
      await seek(0.3);
      const early = grid(v, v.videoWidth, v.videoHeight);
      await seek(v.duration - 0.3);
      const late = grid(v, v.videoWidth, v.videoHeight);
      const shot = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
      const preview = grid(shot, shot.width, shot.height);
      return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, early, late, preview };
    },
    { b64: previewPng.toString('base64'), cols: GRID_COLS, rows: GRID_ROWS },
  );
}

test('錄影: record about 2 s, the clip screen plays an MP4 with sound, of what the preview showed', async ({ page }) => {
  await openVideo(page);
  // the 美體 note's 匯入照片 (it opens the editor), there until the recording starts
  const importPhoto = page.getByRole('button', { name: '匯入照片', exact: true });
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(importPhoto).toBeVisible();
  await startRecording(page);
  const started = Date.now();
  // locked while recording (spec §4.1): 比例, 計時, 合照模式, 切換鏡頭, ✕, 相簿, 按住對比, the mode switch, and the 美體
  // note's 匯入照片 (the note stays)
  await expect(page.getByRole('button', { name: /^比例/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '切換鏡頭' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^計時/ })).toBeDisabled();
  await expect(groupModeButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '回首頁' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '相簿' })).toBeDisabled();
  await expect(page.locator('.cam-controls .side-btn', { hasText: '按住對比' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '拍照' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '錄影' })).toBeDisabled();
  await expect(page.getByText('美體目前僅支援照片編輯')).toBeVisible();
  await expect(importPhoto).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText(/^● \d\d:\d\d$/);

  // the beauty panel stays usable while recording, and its edits are recorded: at least 1 s as it was, then 美白 to
  // 100, then about 1 s more. The clip, checked below, must be brighter at its end than at its start
  await page.waitForTimeout(Math.max(0, 1200 - (Date.now() - started)));
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  const slider = page.getByRole('slider');
  await expect(slider).toHaveAttribute('aria-label', '美白');
  await expect(slider).toBeEnabled();
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(400);
  // the preview as the user sees it now, for the clip's end to be compared with
  const preview = await page.locator('.cam-stage .frame').screenshot({ scale: 'css' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '停止錄影' }).click();

  const clip = await clipShown(page);
  expect(clip.type).toBe('video/mp4');
  expect(clip.size).toBeGreaterThan(0);
  expect(clip.hasAudio).toBe(true);
  expect(clip.name).toMatch(CLIP_NAME);
  // spec §5: 1.5 s or more (finite: a duration MediaRecorder left unknown reads Infinity), and its sound decodes
  // (Chromium's counter; the clip plays muted, decoding all the same)
  const video = page.locator('video[aria-label="錄影結果"]');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : -1))).toBeGreaterThanOrEqual(1.5);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) => v.webkitAudioDecodedByteCount ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // what the clip shows (spec G2): the 比例 in use (3:4, the default); the edit made while recording, at its end and
  // not at its start; and the preview's picture, facing the same way (mirrorOnSave, the default on the front camera)
  const c = await clipContent(page, preview);
  const early = bandMean(c.early);
  const late = bandMean(c.late);
  const same = bandCorr(c.late, c.preview);
  const flipped = bandCorr(c.late, mirrored(c.preview));
  console.log(
    `clip ${c.width}×${c.height}, ${c.duration.toFixed(2)} s: luma ${early.toFixed(1)} → ${late.toFixed(1)}; ` +
      `vs the preview r ${same.toFixed(3)}, mirrored ${flipped.toFixed(3)}`,
  );
  expect(c.width / c.height).toBeCloseTo(3 / 4, 2);
  expect(late).toBeGreaterThan(early + 2);
  expect(same).toBeGreaterThan(0.9);
  expect(same).toBeGreaterThan(flipped + 0.05);

  // 重錄: back in 錄影, not recording, 匯入照片 is back in the 美體 note
  await page.getByRole('button', { name: '重錄' }).click();
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeVisible();
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(importPhoto).toBeVisible();
});

test('儲存 on the clip screen opens the video save dialog; a 1:1 clip is square', async ({ page }) => {
  await openVideo(page);
  // 比例 3:4 → 1:1: the clip is the preview's crop
  const ratio = page.getByRole('button', { name: /^比例/ });
  await ratio.click();
  await expect(ratio).toHaveAttribute('aria-label', '比例 1:1');
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '停止錄影' }).click();
  await clipShown(page);
  const size = await page.locator('video[aria-label="錄影結果"]').evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]);
  expect(size[0]).toBeGreaterThan(0);
  expect(size[0]).toBe(size[1]);
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

test('the background mid-recording keeps the clip; the recorder and the microphone stop within the hide itself', async ({ page }) => {
  await watchMic(page);
  await keepRecorders(page);
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  // hidden as camera.spec.ts makes it, and read in the same call: 0.5.1 ends the capture inside the visibilitychange
  // handler, and the recording and the microphone go with it there (a hidden page draws no frame, so nothing that
  // waits for one may do it: iOS can suspend the app first)
  const atHide = await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const w = window as unknown as { __micStreams: MediaStream[]; __recorders: MediaRecorder[] };
    return {
      microphone: w.__micStreams.flatMap((s) => s.getAudioTracks().map((t) => t.readyState)),
      recorders: w.__recorders.map((r) => r.state),
    };
  });
  expect(atHide).toEqual({ microphone: ['ended'], recorders: ['inactive'] });
  // the recording stops and keeps what it has (spec §4.6, G5)
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
  const tapped = Date.now();
  await shutter.click();
  // the shutter waits for the answer (aria-busy), then the recording goes ahead without sound
  await expect(shutter).toHaveAttribute('aria-busy', 'true');
  await expect(shutter).toBeDisabled();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 10_000 });
  // MIC_ANSWER_MS (3 s) after the tap: it waited, and not for the 8 s of the 錄影 tap's ask (MIC_PROMPT_MS)
  const waited = Date.now() - tapped;
  expect(waited).toBeGreaterThan(2500);
  expect(waited).toBeLessThan(6000);
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

test('a flip in 錄影 turns the microphone off; the other camera live, a record tap asks again (ruling 6)', async ({ page }) => {
  await watchMic(page);
  await openVideo(page);
  // entering 錄影 with the camera live asked: the microphone is held
  await expect.poll(() => micTracks(page)).toEqual(['live']);
  await page.getByRole('button', { name: '切換鏡頭' }).click();
  await expect.poll(() => micTracks(page)).toEqual(['ended']);
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.fps > 0;
    }, { timeout: 60_000, intervals: [250] })
    .toBe(true);
  await startRecording(page);
  expect(await micAsks(page)).toEqual(['live', 'live']);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '停止錄影' }).click();
  expect((await clipShown(page)).hasAudio).toBe(true);
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
  // the ways to the photo picker, whose pick ends the camera screen: 相簿 and the 美體 note's 匯入照片
  const album = page.getByRole('button', { name: '相簿' });
  const importPhoto = page.getByRole('button', { name: '匯入照片', exact: true });
  await page.getByRole('tab', { name: '美體' }).click();
  await expect(importPhoto).toBeVisible();

  // 拍照: cancelled, nothing taken; then a full countdown takes the shot. Its countdown leaves the picker open
  await page.getByRole('button', { name: '拍照' }).click();
  await expect(page.getByRole('button', { name: '取消倒數' })).toBeVisible();
  await expect(album).toBeEnabled();
  await expect(importPhoto).toBeVisible();
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
  // a 錄影 countdown locks the picker: it would end behind the picker sheet into a recording that a pick then drops.
  // Read once, not retried, while the countdown still runs: the recording it ends in locks them anyway
  expect(await album.isDisabled()).toBe(true);
  expect(await importPhoto.count()).toBe(0);
  expect(await page.getByRole('button', { name: '取消倒數' }).count()).toBe(1);
  // 取消倒數: no recording, no note
  await page.getByRole('button', { name: '取消倒數' }).click();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeEnabled();
  await expect(album).toBeEnabled();
  await expect(importPhoto).toBeVisible();
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
  // the recorder kept, so the test can stop it behind the camera's back (an encoder failure, the browser ending it)
  await keepRecorders(page);
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (window as unknown as { __recorders: MediaRecorder[] }).__recorders[0].stop());
  // no 停止錄影 tap: the camera stops and keeps what was recorded, as for the background
  const clip = await clipShown(page);
  expect(clip.size).toBeGreaterThan(0);
});

bare('a recorder that cannot start: 這個瀏覽器無法錄影, still in 錄影 and unlocked; the next tap records (ruling 5)', async ({ page }) => {
  // the failure's reportError is a console.error, which the fixtures' guard fails on: the console is checked here
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/^INFO: Created TensorFlow Lite XNNPACK delegate/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // the first MediaRecorder refuses, as one refusing the MIME does (NotSupportedError); the next one records
  await page.addInitScript(() => {
    const Real = window.MediaRecorder;
    const w = window as unknown as { __refusals: number };
    w.__refusals = 1;
    window.MediaRecorder = class extends Real {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        if (w.__refusals > 0) {
          w.__refusals--;
          throw new DOMException('refused by the test', 'NotSupportedError');
        }
        super(stream, options);
      }
    };
  });
  await openVideo(page);
  await watchToasts(page);
  await page.getByRole('button', { name: '開始錄影' }).click();
  await expect.poll(() => toastsSeen(page)).toEqual(['這個瀏覽器無法錄影']);
  // still 錄影, not recording, nothing locked
  await expect(page.getByRole('radio', { name: '錄影' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '開始錄影' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^比例/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: '回首頁' })).toBeEnabled();
  await expect(page.getByRole('radio', { name: '拍照' })).toBeEnabled();
  expect((await debugState(page)).lastError).toMatch(/^recorder\.start: refused by the test$/);
  // the next tap tries again
  await startRecording(page);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '停止錄影' }).click();
  expect((await clipShown(page)).size).toBeGreaterThan(0);
  // the one console.error is the failure's own report
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/^\[meiyan\] recorder\.start:/);
});

test('a stop the recorder never confirms (no onstop): busy and locked until STOP_WAIT_MS, a second tap does nothing, then the clip (ruling 15)', async ({ page }) => {
  // iOS 15 sometimes never fires onstop (spec §3): the handler recorder.ts sets is swallowed, so stop() settles only at
  // STOP_WAIT_MS (2 s), from the chunks that arrived
  await page.addInitScript(() => {
    class NoStop extends window.MediaRecorder {}
    Object.defineProperty(NoStop.prototype, 'onstop', { configurable: true, get: () => null, set: () => undefined });
    window.MediaRecorder = NoStop;
  });
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  const stop = page.getByRole('button', { name: '停止錄影' });
  const tapped = Date.now();
  await stop.click();
  // stopping: the shutter busy and disabled, the controls still locked
  await expect(stop).toHaveAttribute('aria-busy', 'true');
  await expect(stop).toBeDisabled();
  await expect(page.getByRole('button', { name: /^比例/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '回首頁' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '拍照' })).toBeDisabled();
  // a second tap does nothing: still stopping, still on the camera
  await stop.click({ force: true });
  await expect(stop).toHaveAttribute('aria-busy', 'true');
  expect((await debugState(page)).screen).toBe('camera');
  const clip = await clipShown(page);
  // the recorder's own STOP_WAIT_MS settled it, not an onstop
  expect(Date.now() - tapped).toBeGreaterThanOrEqual(1900);
  expect(clip.size).toBeGreaterThan(0);
});

test('a lost display context mid-recording keeps the clip (spec §4.6, G5)', async ({ page }) => {
  await openVideo(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  // the camera's display canvas loses its WebGL context (crop.spec.ts, editor.spec.ts do the same to the editor's)
  const lost = await page.evaluate(() => {
    const c = document.querySelector('.cam-stage canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl2') as WebGL2RenderingContext;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
    return gl.isContextLost();
  });
  expect(lost).toBe(true);
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

test('a phone-sized 1080×1440 clip records at its size with the MIME the app picks (H.264 Baseline names level 3.0)', async ({ page }) => {
  // the e2e camera gives 540×720 clips; an iPhone's 3:4 crop is 1080×1440 (recordCanvas.ts recordSize). Recorded as the
  // app records: a 2D canvas's captureStream(30), the first VIDEO_MIMES type the browser takes, the clip's bitrate
  await page.goto('/');
  const probe = await page.evaluate(
    async ({ mimes, bps }) => {
      const mime = mimes.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
      if (!mime) return { mime, error: 'no type of VIDEO_MIMES is supported' };
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1440;
      const g = canvas.getContext('2d', { alpha: false })!;
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bps, audioBitsPerSecond: 128_000 });
      const chunks: Blob[] = [];
      const errors: string[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onerror = (e) => errors.push(String((e as unknown as { error?: unknown }).error ?? e.type));
      const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
      rec.start(1000);
      // 1 s of moving frames
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const draw = () => {
          const t = performance.now() - t0;
          g.fillStyle = `hsl(${Math.round(t / 3) % 360} 60% 45%)`;
          g.fillRect(0, 0, 1080, 1440);
          g.fillStyle = '#fff';
          g.fillRect(Math.round(t / 2) % 1000, 600, 80, 240);
          if (t < 1000) requestAnimationFrame(draw);
          else done();
        };
        draw();
      });
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(blob);
      const decoded = await new Promise<string | null>((resolve) => {
        video.onloadeddata = () => resolve(null);
        video.onerror = () => resolve(`decode error ${video.error?.code}: ${video.error?.message}`);
      });
      return { mime, size: blob.size, width: video.videoWidth, height: video.videoHeight, decoded, errors };
    },
    { mimes: VIDEO_MIMES, bps: videoBitrate(1080, 1440) },
  );
  console.log(`1080×1440 probe: ${JSON.stringify(probe)}`);
  expect(probe.mime).toBe(VIDEO_MIMES[0]);
  expect(probe).toMatchObject({ decoded: null, errors: [], width: 1080, height: 1440 });
});
