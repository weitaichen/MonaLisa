# Beauty video recording (v0.7) — design

Date: 2026-10-29. Branch `feat/beauty-video`, from `feat/meiyan-pwa` at 9c3f1bb (v0.6.0, 0.5.1 merged in).

The user asked for 「加入美顏錄影功能」 and skipped the questions (「直接開始做」). Every decision below is the builder's call unless marked as the user's; each can be overridden.

## 1. Intent

The camera already shows a live, beautified preview (per-person beauty, filters, 調節, 質感). Today it can only take a photo of it. v0.7 lets the user **record that preview as a video with sound** and save it to Photos, as easily as a photo.

Success: in the Home Screen app on an iPhone, the user switches to 錄影, taps record, talks for some seconds, taps stop, watches the clip, and saves it with 儲存. The clip shows exactly what the preview showed: the same beauty, framing (比例) and mirroring as a photo would have.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. A 拍照 / 錄影 mode switch by the shutter. In 錄影 the shutter starts and stops a recording.
- G2. WYSIWYG: the clip is the beautified preview.
  - Cropped to the chosen 比例.
  - Mirrored as a saved photo is (`prefs.mirrorOnSave` on the front camera).
  - Every person's beauty as drawn live, and edits made while recording are recorded too.
- G3. Sound from the microphone. If the microphone is refused, missing or does not answer, the clip is recorded silently and the user is told once.
- G4. Saved as MP4 (H.264 + AAC) where the browser can (iPhone Safari, current Chromium). Elsewhere WebM. Saving goes through the share sheet, like photos (iOS: 「儲存影片」).
- G5. Never lose a recording to an interruption. The app going to the background, the camera being interrupted, a display-context loss and the length cap each stop the recording and keep what was recorded.

**Non-goals (v0.7)**
- Editing a video after recording, or opening it in 編輯.
- Pause and resume; recording longer than 60 s.
- Choosing the video resolution, frame rate or format; an unbeautified "original" video.
- Recording from the 編輯 screen.

**Anti-goals** (failure even if it technically works)
- A clip whose framing, mirroring or beauty differs from the preview the user saw.
- A recording that silently fails, or loses everything because the user switched apps.
- Breaking the photo flow, or the camera start robustness of 0.5.1. For example, the microphone request must never block or queue in front of the camera's request.
- A microphone left on, with iOS's orange indicator, after leaving 錄影 or the camera.

## 3. Constraints and facts (verified 2026-10-29)

- **The display canvas holds the whole video frame**, sized by the processing tier (short edge 1080 / 720 / 540, `TIER_SHORT_EDGE`). The 比例 crop is CSS only (`object-fit: cover` in `.frame`).
  - The front-camera mirror is drawn into the pixels (`present.ts`).
  - The canvas can change size when the auto tier steps.
  - It is replaced after a context loss (`recoverEngine`).
  - `preserveDrawingBuffer` is false.
  - So the clip cannot be a plain `captureStream()` of the display canvas: wrong framing, a resolution that changes mid-clip, and possibly 按住對比 frames.
- **Playwright's Chromium**, probed 2026-10-29:
  - `video/mp4;codecs=avc1.42E01E,mp4a.40.2` records H.264 (`avc1.42001f`) plus AAC with the fake microphone.
  - A plain `video/mp4` records **VP9 in MP4**, which iPhone Photos cannot play. The MIME choice must name H.264 first.
- **WebKit** (webkit.org/blog/11353):
  - MediaRecorder supports MP4 with H.264 and AAC, and `isTypeSupported` should be used.
  - canvas `captureStream` on WebGL had a black-frame bug, fixed in 2021 (bugs 230613, 170325).
  - Recording from a Home Screen web app has a reported failure on a later launch, tied to getUserMedia in standalone mode (Apple forums 797987). It is the same family as the 0.5.1 camera hang, so every microphone request is bounded by a timeout.
- **iOS 15** sometimes never fires `onstop` (Apple forums 694207). Use a timeslice and a stop timeout that assembles the chunks received.
- **Headers:**
  - CSP `media-src 'self' blob: mediastream:` already allows blob playback.
  - `Permissions-Policy: camera=(self)` leaves the microphone at its default (`self`); v0.7 lists `microphone=(self)` explicitly.

## 4. Design

### 4.1 Mode and controls (Camera.tsx)
- A two-option switch 「拍照」「錄影」 sits above the shutter, a radiogroup like the iOS camera. It starts on 拍照 and is kept in app state, in memory only, as 比例 and 計時 are. (As built: the row costs the preview 32 px of height. The switch is also locked during a 計時 countdown, as 切換鏡頭 already is: the countdown ends in the mode it began in, a photo or a recording as the tap decided, and a switch meanwhile would leave the screen showing the other mode.)
- **In 錄影:**
  - The shutter is red. aria-label 「開始錄影」; while recording, a red square, 「停止錄影」.
  - The 計時 self-timer counts down before the recording starts, reusing the photo countdown.
- **While recording:**
  - A red dot and the elapsed time 「● 00:12」 show over the frame. (As built: at the top centre, as the iOS camera's timer; the status badges (基本模式 and the others) move below it while it shows.)
  - Locked: 比例, 計時, 合照模式, 切換鏡頭, 相簿, 按住對比, ✕ and the mode switch. (As built: the locks also hold while a recording starts (the microphone wait of at most 3 s after the tap) and while it stops (until the clip is handed out), and the shutter is busy then. The list gains the 美體 note's 「匯入照片」, which is hidden while recording because it leaves the camera and would end the recording unkept, and the camera cards' 「改用匯入照片」, since a card (a failed restart, say) can show while a recording stops. These ways to the photo picker (相簿 and the two imports) are also locked during a 錄影 countdown, which would otherwise end behind the picker into a recording that a pick then drops; the photo countdown leaves them as they were.)
  - The beauty panel stays usable; its edits are recorded.
- **Limits:**
  - At 60 s the recording stops by itself with 「已錄滿 60 秒」.
  - A clip under 1 s is discarded with 「錄影時間太短」. (As built: a recording of 1 s or more that produced no data, or one the recorder ended by itself with no data, says 「這個瀏覽器無法錄影」 instead of opening an empty clip screen.)

### 4.2 The microphone (src/media/mic.ts)
- **When it is asked for:**
  - On entering 錄影, inside that tap, so the iOS prompt comes with the user's intent.
  - Again on a record tap if it is not held, for example after a return from the background.
- **One request at a time, bounded:**
  - `getUserMedia({ audio: true, video: false })`, with echo cancellation and noise suppression on (browser defaults).
  - It is not asked while the camera's own request is out (`snapshot.state !== 'live'`): the camera gets the WebKit queue first (0.5.1).
  - Entering 錄影 sends the request and does not wait for it. A record tap with no answer yet waits up to `MIC_ANSWER_MS` = 3 s, then records without sound. (As built, replacing "8 s on entering 錄影": `MIC_PROMPT_MS` = 8 s bounds only the 錄影 tap's own call, whose answer nothing waits for; the request itself stays out until iOS answers.)
  - A late answer is kept while the microphone is held, so the next recording in 錄影 has sound without asking again; `release()` stops it. (As built, replacing "stopped, not kept": a slow answer leaves the microphone on, with iOS's indicator, until one of the releases below; the anti-goal is a microphone left on after leaving 錄影 or the camera, which those releases still end. An answer that comes after a `release()` that nobody has asked again since is stopped.)
  - A request that is out locks 切換鏡頭, in both modes. (As built, the 0.5.1 lesson: WebKit answers `getUserMedia` one request at a time, so the other camera's request would queue behind it. "Out" is `Mic.state` 'asking', which stays so after a `release()` until the request settles, because a `getUserMedia` cannot be cancelled. A request that is never answered keeps 切換鏡頭 locked for the page's life; that is accepted, as the lesser evil against a flip queued behind it. There is one microphone per page, `getMic()` beside `getCamera()` in `services.ts`, not one per camera visit, so a request a visit left out still locks the next.)
- **Released** on leaving 錄影, leaving the camera, the app hiding, a flip (the camera restarts, and the microphone is asked again at the next record tap) and the camera leaving 'live'.
- **When the clip is silent** (denied, missing, no answer), say so once per camera visit: 「無法使用麥克風，影片將沒有聲音」.

### 4.3 The recording canvas (live loop hook)
- `LiveLoop.setRecordSink(sink | null)`: right after each beautified `draw()`, in the same task (the WebGL drawing buffer is still valid), the loop calls `sink.frame(engine.canvas, crop, unmirror)`.
  - `crop` is `normalizedCropRect(videoW, videoH, ratio)` in source UV (0..1). (As built: the display canvas holds the whole frame at any tier, so a UV rectangle does not depend on the tier's size; the sink multiplies it by the source's own width and height.)
  - `unmirror` is `facing === 'user' && !prefs.mirrorOnSave`, since the preview is always mirrored on the front camera.
  - 按住對比 frames never reach the sink; the hold is locked while recording anyway.
- **The sink** (`src/media/recordCanvas.ts`) is a detached 2D `<canvas>` (`alpha: false`), fixed at the start:
  - The crop's pixel size, scaled so the short edge is at most 1080 and the long edge at most 1920, with even dimensions (H.264).
  - Each frame is `drawImage`d into it, scaled, and flipped when `unmirror`.
  - Its `captureStream(30)` is the clip's video track.
  - A tier step or a loop restart changes nothing for the encoder.
- **A loop restart** (a bundle change, such as 0.5.1's late tracker being adopted) re-attaches the sink to the new loop, so the recording goes on with a short gap.

### 4.4 The recorder (src/media/recorder.ts)
- **MIME choice** (`pickVideoMime`), the first that `MediaRecorder.isTypeSupported` accepts:
  1. `video/mp4;codecs=avc1.42E01E,mp4a.40.2`
  2. `video/mp4;codecs=avc1,mp4a.40.2`
  3. `video/mp4` (Safari's plain MP4 is H.264 + AAC; on Chromium it would be VP9, which is why it is not first)
  4. `video/webm;codecs=vp8,opus`
  5. `video/webm`

  None: tapping 錄影 says 「這個瀏覽器無法錄影」 and stays on 拍照.
- **Bitrate:** `videoBitsPerSecond` ≈ 0.1 bit per pixel per frame at 30 fps, between 2 and 6 Mbps; `audioBitsPerSecond` 128 kbps. (As built: for the clip's own size, the recording canvas's, which the camera passes to `startClipRecorder`; the canvas track's settings are not read.)
- **Lifecycle:** `start(1000)` (one-second chunks).
  - `stop()` resolves with `{ blob, mime, durationMs, hasAudio }` on `onstop`.
  - Or after `STOP_WAIT_MS` = 2 s it assembles what arrived (the iOS 15 `onstop` bug).
  - An `error` event stops it and keeps the chunks.
- **The file:** `meiyan-YYYYMMDD-HHMMSS.mp4` or `.webm` (the photo naming), type from the recorder's MIME without codecs.

### 4.5 Clip review (new screen `clip`)
- Screen `{ name: 'clip'; clip: Clip }`, where `Clip = { file: File; url: string; durationMs: number; hasAudio: boolean }`.
- The page:
  - `<video src=url playsinline loop autoplay muted controls>`; autoplay needs muted, and the controls unmute.
  - The bar holds 「重錄」 (back to the camera, in 錄影) and 「儲存」.
  - No 編輯.
- **儲存:** `saveFile(file)` inside the tap (share sheet).
  - 'shared' → 「完成」.
  - 'fallback' → the save dialog with a `<video>` instead of an `<img>`, the hint 「點「下載影片」，再到「檔案」App 存到照片」 and a `<a download>` 「下載影片」 link, with the photo dialog's second line 「這個瀏覽器無法直接開啟分享選單」. (As built: the hint quotes the link's label and names the Files app.)
- The object URL is revoked when the clip screen goes.

### 4.6 Interruptions (G5)
Stop and keep what was recorded:
- the app hidden (0.5.1 stops the camera then; as built, the recording and the microphone stop inside that same call, not after the next frame, which a hidden page never draws, so neither captures on into a suspension);
- the camera leaving 'live';
- a display-context loss;
- the recorder ending by itself (an encoder error, or the browser stopping it);
- the 60 s cap.

Then open the clip screen (≥ 1 s) or discard (< 1 s). The tap that stops is the normal path; ✕ is locked while recording. (As built: from the first stop until the clip is handed out, the controls stay locked and the shutter is busy, since the recorder's last chunk can take up to `STOP_WAIT_MS`; a second stop does nothing.)

### 4.7 Release
- Version 0.7.0, 「有新版本 v0.7」.
- Release notes in roadmap §17 (繁中, English, Compatibility).
- No stored data changes; the 錄影 mode is not persisted.

## 5. Testing
- **Unit:**
  - `pickVideoMime` order (H.264 first, VP9-in-MP4 avoided); bitrate and output size (even, capped).
  - The recorder lifecycle with a fake MediaRecorder: chunks, `onstop`, the stop timeout, an error, the duration.
  - The microphone: granted, denied, no answer (timeout), late answer kept while held, stopped on release, released.
  - The sink: crop and unmirror math, fixed size across a source size change.
  - The live loop calls the sink after a beautified draw only (not compare), and re-attachment.
  - `outputFileName` for video.
- **e2e** (Chromium fake camera and microphone):
  - Record about 2 s: the clip screen plays a `video/mp4` of 1.5 s or more, with an audio track. (As built: the clip's type, size, name and audio are read from the debug field `__meiyan.clip`, since the production CSP (`connect-src 'self'`) blocks a fetch of a blob: URL; the `<video>`'s `videoWidth` shows the file decodes.)
  - What the clip shows (as built): drawn from the clip screen's `<video>` into a canvas, its frames have the 比例 in use (3:4, and 1:1 in a second run), an edit made while recording (brighter at the end than at the start), and the preview's picture facing the same way (closer to the preview than to its mirror image). A probe also records a 1080×1440 canvas with the picked MIME: Chromium records and decodes it at that size.
  - 儲存 gives the fallback dialog with a video.
  - The locked controls while recording; the 60 s cap (a test-only shorter cap through a debug hook).
  - The background (visibility hidden) mid-recording keeps the clip; a silent clip when the microphone is refused. (As built: the recorder is inactive and the microphone track ended within the hide's own call.)
- **Device checks** (no automation possible; they need the preview deploy after the push):
  - The iOS share sheet offers 「儲存影片」, and H.264 + AAC plays in Photos: only the phone can say what Photos accepts.
  - The microphone prompt on entering 錄影, and a record tap's 3 s wait for an answer still out: the prompt's timing was never measured on iOS.
  - The orange microphone indicator goes off after leaving 錄影, hiding the app, a flip, and on the clip screen: the anti-goal, and only iOS shows the indicator.
  - Recording from the Home Screen app twice across a relaunch, on WebKit's 2D-canvas `captureStream` + MediaRecorder MP4 in standalone mode: a failure on a later launch is reported (§3).
  - The copy's cost per frame on a phone: it is kept out of the tier's render sample, but a copy slower than a frame still lowers the quality tier through skipped frames.
  - 切換鏡頭 locked while a microphone request is out has no ceiling: a request iOS never answers locks it for the page's life, and camera.ts's own restart after the background can still queue behind a stuck microphone request.
  - A 9:16 clip fits the clip screen and the save dialog (`min-height: 0`, measured in Chromium only), and a real 1080-wide clip fits across.
  - The clip autoplays muted and inline, and `<a download>` of a blob works in the Home Screen app: iOS decides both.
  - A microphone grant does not mute the camera: camera.ts treats a mute longer than `MUTE_GRACE_MS` (800 ms) as a dead track and ends the stream as 'interrupted'. If iOS mutes the camera track while it grants the microphone, entering 錄影 would show 相機已暫停, and a record tap after 重錄 or a flip (which asks again) would stop its own recording. The camera is already live when the first request is answered, and only an iPhone shows whether its stream then pauses or mutes.
  - `onstop` after a return from the background: iOS may suspend timers while hidden, and the clip screen opens on the return.
  - The 32 px mode row's 44 px targets under a finger, and the REC badge and the toasts with the real safe areas: Chromium's touch emulation has no real finger and no safe areas.
  - ✕ → home → reopen the camera while a microphone request is stuck: the camera's own start can queue behind it (0.5.1's 「相機還沒有回應」 hint is the fallback).
  - After 重錄 the microphone is released: if iOS asks again at the first record tap, the answer has only 3 s (`MIC_ANSWER_MS`), so that clip may be silent, with the note.
  - The clip has real, moving frames: WebKit's capture of a canvas that is in no document is unverified (Chromium records one). If the clip is black or frozen, the known fix is to attach the canvas offscreen in the document.
  - Lip-sync, with a clap: frames are stamped when they are copied, after the beauty pipeline, and the sound when it is captured, so the sound may lead the picture.
  - On the clip screen the sound plays from the loudspeaker at full volume, right after the microphone was released: the audio route and volume after a capture are iOS's to decide, and Chromium has no loudspeaker to show it.
  - A 1080×1440 clip (an iPhone's 3:4) plays in Photos: `avc1.42E01E` names H.264 Baseline level 3.0, and a phone's clip exceeds that level's frame-size limit. Chromium records and decodes that size with it (the e2e probe); what WebKit writes and Photos accepts only the phone shows.
  - A trip to the background while the microphone prompt is up: the camera restarts by itself on the return, and its request can queue behind the prompt's (WebKit answers one at a time), so check that the camera comes back and the prompt's answer still lands.

## 6. Left to the builder
Exact CSS, the switch's look, test names, the debug hook's shape, and whether `Clip` carries a poster frame.
