# Beauty Video Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the camera's beautified live preview as an MP4 with microphone sound, review it, and save it through the share sheet (v0.7.0).

**Architecture:**
- After each beautified preview draw, the live loop copies the visible crop into a fixed-size 2D recording canvas, mirrored as a saved photo would be.
- That canvas's `captureStream(30)`, together with an optional microphone track, feeds a `MediaRecorder` that writes H.264/AAC MP4 (WebM where MP4 is unavailable).
- A new `clip` screen plays the result and saves it with the existing `saveFile` share path.

**Tech Stack:** TypeScript, Preact, WebGL2 engine (existing), MediaRecorder, `HTMLCanvasElement.captureStream`, getUserMedia (audio), Vitest (fake timers), Playwright (Chromium with fake camera and microphone).

**Spec:** `docs/superpowers/specs/2026-10-29-beauty-video-design.md`. Read it first; section numbers below refer to it.

## Global Constraints
- Branch `feat/beauty-video`. Version **0.7.0** (Task 7). No new npm dependencies.
- MIME order, exactly:
  1. `video/mp4;codecs=avc1.42E01E,mp4a.40.2`
  2. `video/mp4;codecs=avc1,mp4a.40.2`
  3. `video/mp4`
  4. `video/webm;codecs=vp8,opus`
  5. `video/webm`
- Timing constants:
  - `MAX_CLIP_MS = 60_000`, `MIN_CLIP_MS = 1_000`, `STOP_WAIT_MS = 2_000`, timeslice `1000`.
  - `MIC_ANSWER_MS = 3_000` (at a record tap), `MIC_PROMPT_MS = 8_000` (entering 錄影).
- Encoding:
  - Output size: short edge ≤ 1080, long edge ≤ 1920, never upscaled, even width and height.
  - `videoBitsPerSecond` = round(w × h × 30 × 0.1), clamped to [2_000_000, 6_000_000]; `audioBitsPerSecond = 128_000`.
- File name `meiyan-YYYYMMDD-HHMMSS.mp4` or `.webm` (local time, like photos). File type `video/mp4` or `video/webm`, without codecs.
- UI copy, verbatim:
  - Mode switch 「拍照」「錄影」.
  - Shutter aria-labels 「開始錄影」, 「停止錄影」, and 「取消倒數」 while counting.
  - Toasts 「已錄滿 60 秒」, 「錄影時間太短」, 「無法使用麥克風，影片將沒有聲音」, 「這個瀏覽器無法錄影」.
  - Clip screen title 「預覽」, video aria-label 「錄影結果」, buttons 「重錄」 and 「儲存」.
  - Save dialog aria-label 「儲存影片」, link 「下載影片」, hint 「點「下載影片」，再到「檔案」App 存到照片」.
- The microphone request never goes out while the camera's own request is out (`camera.snapshot.state !== 'live'`, spec §4.2). Every getUserMedia for audio is `{ audio: true, video: false }`.
- Don't touch `cameraConstraints` (camera.ts): the camera stays `audio: false`.

## Review Focus
1. **Record tapped while the first-use microphone prompt is still up.** The recording starts within `MIC_ANSWER_MS`, silently, with the toast; no hang, no second prompt. Test: Task 2, "a record-time ask that does not answer in MIC_ANSWER_MS gives no tracks; a late answer is kept while the mic is held".
2. **A loop restart mid-recording** (0.5.1's late tracker adopted, a bundle change). The recording continues on the new loop: the sink is re-attached, not lost. Test: Task 6 e2e "a live-loop restart mid-recording keeps recording" (in slow-tracker.spec.ts).
3. **The tier stepping down mid-recording** (the display canvas shrinks). The clip's size stays fixed, and frames are scaled into it. Test: Task 3, "frame() scales a smaller source into the fixed canvas".
4. **The app hidden mid-recording** (`onstop` delayed while suspended). The clip is kept and shown on return. Tests: Task 1, "stop() resolves from the chunks after STOP_WAIT_MS when onstop never fires"; Task 6 e2e "the background mid-recording keeps the clip".
5. **Leaving the clip screen.** The object URL is revoked and nothing keeps the Blob alive. Test: Task 5, "the clip screen revokes its URL on unmount".

---

### Task 1: Recorder core and video file naming

**Files:**
- Create: `src/media/recorder.ts`, `src/media/recorder.test.ts`
- Modify: `src/media/exporter.ts` (date-stamped name helper), `src/media/exporter.test.ts`

**Interfaces:**
- Produces:
  - `export const VIDEO_MIMES: readonly string[]` (the order above).
  - `export const MAX_CLIP_MS = 60_000; MIN_CLIP_MS = 1_000; STOP_WAIT_MS = 2_000;`.
  - `export function pickVideoMime(isSupported: (type: string) => boolean): string | null` (the first supported, else null).
  - `export function videoBitrate(width: number, height: number): number`.
  - `export interface ClipResult { blob: Blob; mime: string; durationMs: number; hasAudio: boolean }`.
  - `export interface ClipRecorder { stop(): Promise<ClipResult> }`.
  - `export interface RecorderEnv { MediaRecorder: { new (s: MediaStream, o: MediaRecorderOptions): MediaRecorder }; now(): number; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }`.
  - `export function startClipRecorder(stream: MediaStream, mime: string, env: RecorderEnv): ClipRecorder`.
  - `export function clipFile(r: ClipResult, d?: Date): File`.
  - exporter.ts: `export function stampedName(ext: string, d?: Date): string` (`meiyan-YYYYMMDD-HHMMSS.<ext>`); `outputFileName` uses it, unchanged in behaviour.

- [ ] **Step 1: Write the failing tests** in `src/media/recorder.test.ts`:
  - `pickVideoMime` returns `video/mp4;codecs=avc1.42E01E,mp4a.40.2` when everything is supported.
  - It returns `video/mp4` when only `video/mp4` and the WebM types are supported.
  - It returns `video/webm;codecs=vp8,opus` when no MP4 is supported, and null when nothing is.
  - `videoBitrate(1080, 1440)` = 4_665_600; `videoBitrate(320, 240)` = 2_000_000; `videoBitrate(1080, 1920)` = 6_000_000.
  - A `FakeRecorder` (records `start(timeslice)`, emits `dataavailable` on demand, `onstop` on demand, `mimeType` from options):
    - `startClipRecorder` calls `start(1000)` with `{ mimeType, videoBitsPerSecond: videoBitrate(w, h), audioBitsPerSecond: 128_000 }` (w and h from the stream's video track settings, 1280×720 in the fake).
    - `stop()` resolves after `onstop` with a Blob of every non-empty chunk, `mime` without codecs (`video/mp4`), `durationMs` = now at stop minus now at start, and `hasAudio` = the stream had an audio track.
    - "stop() resolves from the chunks after STOP_WAIT_MS when onstop never fires".
    - "an error event stops the recorder and stop() still resolves with the chunks".
    - A second `stop()` returns the same promise.
- [ ] **Step 2: Test `stampedName` in `src/media/exporter.test.ts`:** `stampedName('mp4', new Date(2026, 9, 29, 8, 5, 3))` = `meiyan-20261029-080503.mp4`. Add `clipFile` to recorder.test: name `.mp4` and type `video/mp4` for an mp4 result; `.webm` and `video/webm` for a webm one.
- [ ] **Step 3: Run** `npx vitest run src/media/recorder.test.ts src/media/exporter.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `recorder.ts`.
  - The size comes from `stream.getVideoTracks()[0]?.getSettings()` (width, height; default 1280×720 when absent).
  - `stop()`: calls `recorder.stop()` unless its state is `inactive`; resolves on `onstop`, or on the `STOP_WAIT_MS` timer, whichever is first.
  - Move the date formatting from `outputFileName` into `stampedName`.
- [ ] **Step 5: Run** the same command. Expected: PASS. Then `npx tsc --noEmit`, clean.
- [ ] **Step 6: Commit** `feat(video): recorder core and video file names`.

### Task 2: The microphone

**Files:**
- Create: `src/media/mic.ts`, `src/media/mic.test.ts`

**Interfaces:**
- Produces:
  - `export const MIC_ANSWER_MS = 3_000; export const MIC_PROMPT_MS = 8_000;`.
  - `export type MicState = 'idle' | 'asking' | 'on' | 'off'`.
  - `export interface Mic { readonly state: MicState; tracks(): MediaStreamTrack[]; ensure(timeoutMs: number): Promise<MediaStreamTrack[]>; release(): void }`.
  - `export function createMic(md: Pick<MediaDevices, 'getUserMedia'> | undefined, timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }): Mic`.
- Semantics:
  - `ensure` calls getUserMedia **synchronously** (inside the caller's tap) when not `on` and no request is out. It joins a request already out.
  - It resolves the live audio tracks, or `[]` on refusal, on no `md`, or after `timeoutMs` without an answer.
  - A late answer is kept (state `on`) unless `release()` came in between; then its tracks are stopped.
  - `release()` stops the tracks, bumps a generation and goes `idle`.
  - A refusal sets `off`; the next `ensure` asks again.

- [ ] **Step 1: Write the failing tests** (Vitest fake timers, a held getUserMedia like camera.test's `heldGetUserMedia`):
  - "granted: ensure resolves the audio tracks and the state is on", asked with `{ audio: true, video: false }`.
  - "refused or missing: [] and off".
  - "a record-time ask that does not answer in MIC_ANSWER_MS gives no tracks; a late answer is kept while the mic is held".
  - "a late answer after release() is stopped".
  - "two ensure() calls share one request".
  - "release() stops the tracks".
- [ ] **Step 2: Run** `npx vitest run src/media/mic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `mic.ts`.
- [ ] **Step 4: Run** it again, expect PASS; then `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(video): microphone with a bounded request`.

### Task 3: The recording canvas

**Files:**
- Create: `src/media/recordCanvas.ts`, `src/media/recordCanvas.test.ts`

**Interfaces:**
- Consumes: `UvRect` from `src/types.ts`.
- Produces:
  - `export function recordSize(cropW: number, cropH: number): { width: number; height: number }` (the global size rule).
  - `export interface RecordSink { frame(src: CanvasImageSource & { width: number; height: number }, crop: UvRect, flipX: boolean): void }`.
  - `export interface RecordCanvas { sink: RecordSink; stream: MediaStream; width: number; height: number; release(): void }`.
  - `export function createRecordCanvas(width: number, height: number, doc?: Document): RecordCanvas`.
- Behaviour:
  - A detached `<canvas>`, 2D context `{ alpha: false }`, `stream = canvas.captureStream(30)`.
  - `frame` draws the crop (UV × the source's pixel size) into the whole canvas, `imageSmoothingEnabled` on, horizontally flipped when `flipX` (`setTransform(-1, 0, 0, 1, width, 0)`, reset after).
  - `release()` stops the stream's tracks and sets the canvas to 0 × 0.

- [ ] **Step 1: Write the failing tests**, with a fake document whose canvas records `drawImage` and `setTransform` calls:
  - `recordSize(1080, 1440)` → 1080×1440; `recordSize(1080, 1920)` → 1080×1920; `recordSize(2160, 2880)` → 1080×1440.
  - `recordSize(721, 961)` → 720×960 (even, not upscaled); `recordSize(1440, 1440)` → 1080×1080.
  - "frame() draws the crop of the source into the whole canvas": a 1080×1920 source, crop `{ x: 0, y: 0.125, w: 1, h: 0.75 }`, gives `drawImage(src, 0, 240, 1080, 1440, 0, 0, W, H)`.
  - "frame() mirrors when flipX": `setTransform(-1, 0, 0, 1, W, 0)` before the draw and `setTransform(1, 0, 0, 1, 0, 0)` after.
  - "frame() scales a smaller source into the fixed canvas": a 540×960 source, same crop → `drawImage(src, 0, 120, 540, 720, 0, 0, W, H)`, with W×H unchanged.
  - "release() stops the stream and frees the canvas".
- [ ] **Step 2: Run** `npx vitest run src/media/recordCanvas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `recordCanvas.ts`.
- [ ] **Step 4: Run**, expect PASS; then `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(video): fixed-size recording canvas`.

### Task 4: The live loop feeds the recording

**Files:**
- Modify: `src/app/live.ts` (the `LiveLoop` interface at :73-97; `step()` around the `draw()` call at :388; the loop object near `setCompare` at :829-833).
- Test: `src/app/live.test.ts`

**Interfaces:**
- Consumes: `RecordSink` (Task 3).
- Produces: `LiveLoop.setRecordSink(sink: RecordSink | null): void`.
- Behaviour:
  - After a beautified `draw()` in `step()` (never while `compare`), call `sink.frame(engine.canvas, deps.getFrame?.() ?? { x: 0, y: 0, w: 1, h: 1 }, camera.snapshot.facing === 'user' && !deps.getPrefs().mirrorOnSave)`.
  - A throw from the sink is reported once (`reportError`) and the sink is dropped; the preview never breaks.

- [ ] **Step 1: Write the failing tests** in live.test.ts (use `setup()`):
  - "setRecordSink: each frame after a beautified draw reaches the sink with the frame crop": a fake sink records calls; after `vi.advanceTimersByTime(33 * 5)` it has about 5 calls, each with `getFrame()`'s rect and the engine canvas.
  - "flipX only on the front camera with mirrorOnSave off": the cases facing 'user' with mirrorOnSave false → true; facing 'user' with true → false; facing 'environment' → false.
  - "no frame reaches the sink while 按住對比 holds; setRecordSink(null) stops it".
  - "a sink that throws is dropped, the preview goes on".
- [ ] **Step 2: Run** `npx vitest run src/app/live.test.ts -t setRecordSink`. Expected: FAIL.
- [ ] **Step 3: Implement**, adding the method to the loop object and the call after `draw()` in `step()`.
- [ ] **Step 4: Run** `npx vitest run src/app/live.test.ts`, all PASS; then `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(video): the live loop feeds a recording sink`.

### Task 5: Clip screen and the video save dialog

**Files:**
- Create: `src/ui/screens/ClipReview.tsx`, `src/ui/clipReview.test.ts` (or extend `src/ui/ui.test.ts`)
- Modify:
  - `src/ui/state.ts`: `Clip`, the `clip` screen, `cameraMode`, `saveFallbackKind`.
  - `src/ui/app.tsx`: route; the video branch of `SaveFallback`.
  - `src/ui/theme.css`: `.clip-stage video`, and the fallback video, reusing `.review-stage` / `.review-bar` styles.

**Interfaces:**
- Produces:
  - `export interface Clip { file: File; url: string; durationMs: number; hasAudio: boolean }`.
  - `Screen` adds `{ name: 'clip'; clip: Clip }`.
  - `AppState.cameraMode: 'photo' | 'video'` (default `'photo'`, in memory only).
  - `AppState.saveFallbackKind: 'image' | 'video'`, set by `showSaveFallback(file)` from `file.type.startsWith('video/')`.
  - `ClipReview({ clip }: { clip: Clip })`.
- Behaviour (spec §4.5):
  - The page holds `<video src={clip.url} playsInline loop autoPlay muted controls aria-label="錄影結果">` and the buttons 「重錄」 (`go({ name: 'camera' })`, haptic) and 「儲存」.
  - 儲存: `deps.saveFile(clip.file)` with no await before it; 'shared' → `toast('完成')`; 'fallback' or a rejection → `showSaveFallback(clip.file)` (a rejection also does `reportError`). Review.tsx's `save` is the model.
  - Unmount → `URL.revokeObjectURL(clip.url)`.
  - SaveFallback with kind 'video': aria-label 「儲存影片」, `<video src controls playsInline data-name>`, an `<a href={url} download={name}>` 「下載影片」 and the hint copy; kind 'image' is unchanged.

- [ ] **Step 1: Write the failing tests** (preact render as the existing ui tests do; check ui.test.ts for the harness, else test the pure parts):
  - "showSaveFallback sets the video kind for a video file and the image kind for a photo".
  - "the clip screen saves through saveFile inside the tap": the stubbed `deps.saveFile` is called synchronously on click.
  - "the clip screen revokes its URL on unmount".
- [ ] **Step 2: Run** them, expect FAIL.
- [ ] **Step 3: Implement** state, ClipReview, the app route `{screen.name === 'clip' && <ClipReview key={screen.clip.url} clip={screen.clip} />}`, SaveFallback and CSS.
- [ ] **Step 4: Run** `npx vitest run src/ui` and `npx tsc --noEmit`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat(video): clip review screen and video save dialog`.

### Task 6: Camera: the 錄影 mode and the recording flow

**Files:**
- Modify:
  - `src/ui/screens/Camera.tsx`: the mode switch; the shutter in 錄影; the record flow, the microphone and the interruptions; locked controls; the REC badge.
  - `src/ui/theme.css`: `.mode-switch`, `.shutter.rec` / `.shutter.recording`, `.rec-badge`.
  - `vercel.json`: `Permissions-Policy` becomes `camera=(self), microphone=(self)`.
- Test: `tests/e2e/video.spec.ts` (new).

**Interfaces:**
- Consumes: Tasks 1–5.
- Test-only hook: `(globalThis as { __meiyanClipCapMs?: number }).__meiyanClipCapMs ?? MAX_CLIP_MS`, read when a recording starts.

**Behaviour** (spec §4.1, §4.2, §4.6):
- **The mode switch** (`role="radiogroup"`, two `role="radio"` buttons with `aria-checked`) sits above `.cam-controls`.
  - 錄影 needs a MIME: `pickVideoMime((t) => MediaRecorder?.isTypeSupported?.(t) ?? false)`; null → 「這個瀏覽器無法錄影」 and stay on 拍照.
  - Entering 錄影 calls `mic.ensure(MIC_PROMPT_MS)` synchronously in the tap, only when `snap.state === 'live'`.
  - Leaving 錄影 calls `mic.release()`.
- **Shutter in 錄影:** a tap while recording stops. Otherwise: with a timer, the existing countdown, then start; with none, start now.
- **Start:**
  1. Ask for the microphone: `mic.ensure(MIC_ANSWER_MS)`, called synchronously in the tap.
  2. Size the clip: `recordSize(cropPx)`, where cropPx is `normalizedCropRect(video.videoWidth, video.videoHeight, RATIO_VALUE[ratio])` times `engine.canvas.width/height`.
  3. Build the recording: `createRecordCanvas`, a `MediaStream` of its video track plus the mic tracks, `startClipRecorder`, then `loop.setRecordSink(rc.sink)`.
  4. Start the clock: an elapsed ticker every 250 ms for the badge, and auto-stop at the cap with 「已錄滿 60 秒」.
  5. With no mic tracks, show the microphone toast once per camera mount.
- **Stop:**
  - `setRecordSink(null)`, `await recorder.stop()`, then `rc.release()`.
  - Under `MIN_CLIP_MS` → 「錄影時間太短」. Otherwise → `go({ name: 'clip', clip: { file: clipFile(r), url: URL.createObjectURL(file), durationMs, hasAudio } })`.
- **Interruptions:**
  - `ready` going false (hidden, not live, lost) while recording stops and keeps the clip.
  - The live-loop effect re-attaches `rec.current.rc.sink` to every new loop.
  - Unmount stops (keeping nothing) and releases the mic.
- **Locked while recording:** 比例, 計時, 合照模式, 切換鏡頭, ✕, 相簿, 按住對比 and the mode switch (`disabled`).
- **The badge:** `<div class="rec-badge" role="timer">● mm:ss</div>` inside `.frame` while recording.

**Steps:**
- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/video.spec.ts` (fixtures `test`, `debugState`, `expect` from `./fixtures`; the camera flow as camera.spec.ts starts it):
  - "錄影: record about 2 s, the clip screen plays an MP4 with sound":
    1. Tap 錄影, wait for live with a face.
    2. Tap 「開始錄影」. The badge shows; 比例 and 切換鏡頭 are disabled.
    3. Wait 2200 ms, tap 「停止錄影」. `screen === 'clip'`.
    4. The `video[aria-label="錄影結果"]` has `videoWidth > 0` once loaded.
    5. Its src blob has type `video/mp4`, read via `fetch(src).then(r => r.blob())` in the page.
  - "儲存 on the clip screen opens the video save dialog": the dialog 「儲存影片」 holds a video with `data-name` matching `/^meiyan-\d{8}-\d{6}\.mp4$/`.
  - "the cap stops the recording by itself": `addInitScript` sets `__meiyanClipCapMs = 2500`; record; the clip screen appears without a stop tap.
  - "the background mid-recording keeps the clip": record 1500 ms, then `setVisibility('hidden')` (as camera.spec.ts), then `'visible'` → `screen === 'clip'`.
  - "a refused microphone records silently with a note": `addInitScript` makes `getUserMedia` reject `NotAllowedError` for audio-only constraints → toast 「無法使用麥克風，影片將沒有聲音」 → the clip screen.
  - In `tests/e2e/slow-tracker.spec.ts` (its `holdTracker` and `bare` setup), "a live-loop restart mid-recording keeps recording":
    1. The camera times out to 基本模式.
    2. Tap 錄影, then 「開始錄影」, and wait 1000 ms.
    3. Release the tracker (the adoption restarts the loop) and wait for the 「臉部偵測已啟動」 toast.
    4. Wait 1000 ms more, then 「停止錄影」.
    5. `screen === 'clip'` and the video has `videoWidth > 0`.
- [ ] **Step 2: Build and run:** `npm run build`, then `npx playwright test tests/e2e/video.spec.ts --project=chromium`. Expected: FAIL.
- [ ] **Step 3: Implement** the Camera.tsx changes, CSS and vercel.json.
- [ ] **Step 4: Run** `npx tsc --noEmit`, `npx vitest run`, `npm run build`, then the video spec plus `tests/e2e/camera.spec.ts`. Expected: all PASS (the photo flow unchanged).
- [ ] **Step 5: Commit** `feat(video): 錄影 mode in the camera`.

### Task 7: Release 0.7.0

**Files:**
- Modify:
  - `package.json` and `package-lock.json` (0.7.0).
  - `src/ui/updateModel.test.ts`.
  - `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (new §17).
  - The spec (a "As built" note where reality differed).

- [ ] **Step 1: Tests** in updateModel.test.ts:
  - "names 0.7.0 as v0.7 (beauty video spec §4.7)": `bannerTitle(available({ next: '0.7.0' }))` = 「有新版本 v0.7」.
  - "after the 0.7.0 update": `updatedNotice('0.6.0', '0.7.0', true)` = 「已更新至 v0.7」.
- [ ] **Step 2: Bump** to 0.7.0 with `npm version 0.7.0 --no-git-tag-version`. Write §17 「Release notes: v0.7 (0.7.0, 2026-10-29)」 with 繁體中文, English and Compatibility parts, laid out as §16. Compatibility: no stored data changes; the 錄影 mode is not persisted; `microphone=(self)` added; no iPhone numbers yet.
- [ ] **Step 3: Run** `npx vitest run src/ui/updateModel.test.ts`, then the full gate: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npx playwright test`. Expected: PASS (the opt-in @bench / @sheet skipped).
- [ ] **Step 4: Commit** `v0.7.0: beauty video recording`.
