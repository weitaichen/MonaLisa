# Mona Misa 美顏 v0.6: 相機逐人美顏 (per-person beauty in the live camera) design

## 摘要（繁體中文）

1. 相機合照裡，偵測到的每一張臉都能點選；滑桿只調整選取的那個人，換去調別人時，先前調好的人在預覽中保持調好的樣子，沒調過的人維持原圖；什麼都沒設定的相機與原圖完全相同。
2. 每個人的設定跟著那個人：移動、交換位置、短暫被擋住都不會跑掉；離開畫面後 4 秒內從原處附近回來仍是同一人，超過就是新的人（原圖）。不做人臉辨識，逐人設定只存在這次開啟相機期間，濾鏡、調節、質感、美白、銳化仍是整張照片共用並照舊記住。
3. 拍照後預覽與照片裡每個人都是調好的樣子；相機有設定美顏時按「編輯」，修圖會替每個人帶入各自的相機效果並可繼續調整；相機沒有任何設定時、以及匯入的照片，仍從原圖開始。
4. 偵測：前鏡頭單人自拍維持原本的偵測方式（不變慢）；合照（後鏡頭一律如此，前鏡頭在畫面出現第二張臉時切換）改用「合照偵測」：把畫面分成幾塊放大來找臉，直立拿手機時後鏡頭找得到約 3 公尺遠、約畫面長邊 3% 的小臉，前鏡頭找得到後排約畫面長邊 5% 的臉，最多 10 張；人多時預覽自動降低臉部更新頻率，讓預覽平均維持每秒 24 格左右以上。若合照偵測在桌機上達不到流暢度或找臉的門檻，就退回單次全畫面偵測（後鏡頭約長邊 9%、前鏡頭約 12% 以上的臉），並在發布說明寫明（§6.6、§16）。**2026-10-22 桌機量測：流暢度門檻沒過，這一版已退回單次全畫面偵測（§10、§16 第 1 項）。同日你決定：相機加「合照模式」按鈕，預設關閉（K22、§3.13）。關閉時照退回的做法，單人自拍維持原本的順暢；打開時前後鏡頭都用合照偵測，遠處、小的臉也能點選，但人多時預覽較不順。開關會記住；切換時每個人的設定都保留。**
5. 「全部套用」會把選取者的設定複製給畫面中所有人並同時調整；畫面中每張臉有淡淡的框可點，選取的人上方有圓點；一次只調一個人，不需要記住誰是誰。

- **Date:** 2026-10-19
- **Status:** the user's decisions are §0.1 (binding); Claude's calls are §0.2 (the user approved the ones marked "shown", and asked for the rest to be decided with the most sensible default and recorded here). The plan and the build follow this spec without further questions (§15). The builder check of 2026-10-19 added K17–K21 (§0.2); K17 is a call only the user could make, decided by default and listed for them in §16 「待使用者確認的決定」. After the desktop gates (2026-10-22: PGN failed, §10) the user settled it with K22 (§0.2): a 「合照模式」 toggle, off by default, which also replaces K18.
- **Contract:** [v0.4 roadmap and architecture contract](2026-10-12-v04-roadmap.md) (**RM**) and the step-1 spec [選臉／選人](2026-10-12-face-person-select-design.md) (**S**). §0.3 lists every decision of RM and S this spec replaces.
- **Anchors:** `file:line` at `4728133` (0.5.0, branch `feat/meiyan-pwa`).
- **Measurements:** §6.1, run for this spec on the workspace desktop (no iPhone numbers exist yet; RM §12 applies: the defaults below ship until they do).

---

## 0. Inputs

### 0.1 The user's decisions (binding)

| # | Decision | The user's words |
|---|---|---|
| U1 | Every face in view in the live camera is tappable, far and small faces included (in ordinary group shots, upright: K17, §6.6) | 「所有人的臉都要可以點選」 |
| U2 | The sliders adjust only the selected person: one person is edited at a time | 「一次只需要美化一張臉即可」 |
| U3 | After editing person 1 and moving on to person 2, person 1 keeps showing their result in the preview; the captured photo shows everyone as adjusted | 「第一人是剛剛調好美顏的樣子」 |
| U4 | A person never tapped stays 原圖. A fresh camera (nothing set) looks exactly like the original | — |
| U5 | A person's settings follow them while they stay in view (moving, swapping places, brief occlusion). Leaving the frame and coming back from nearby within a few seconds is the same person; gone longer → a new person at 原圖. No face-recognition model | 「做第一種」 |
| U6 | With beauty set in the camera, 編輯 opens the editor with each person keeping their camera result, ready to keep editing. Camera with nothing set → the editor opens at 原圖. Imported photos still always open at 原圖 | 「相機有設定美顏時，按編輯進修圖，應該要保留剛剛調好的效果」 |
| U7 | Build it, then run the advance Codex review, then push | 「沒問題，開始寫，做完後跑advance codex review再push」 |

### 0.2 Claude's calls

Shown to the user, who answered 「沒問題」:

| # | Call |
|---|---|
| K1 | 「全部套用」 stays: it applies the selected person's settings to everyone in view (§3.4) |
| K2 | 濾鏡, 調節 and 質感 stay photo-level (whole frame, shared); so do the other items the editor treats as photo-level, 美白, 銳化 and 濾鏡強度 (§3.5) |
| K3 | With many people the preview may lower its face-update rate to stay smooth (§6.4) |
| K4 | Per-person settings live only while the camera is open, cleared when the camera closes, since nobody is recognised (§9) |

Decided here with the most sensible default (U7):

| # | Call | Where |
|---|---|---|
| K5 | The front camera's solo path keeps BlazeFace short-range in VIDEO mode (the v0.5 selfie path, PL2). Group scenes run the group path of K17 (§6.6): the back camera always, on BlazeFace full-range; the front camera once a second face is found, on short-range. Up to `MAX_EDIT_FACES` = 10 faces, and the solo path's count never changes within a stream. Revised by the builder check: as first written, the back camera ran full-range VIDEO over the whole frame, which is now the fallback (§6.3) | §6.3, §6.6 |
| K6 | The detection cadence: every frame with one face (never slower than v0.5); with ≥ 2 faces, the fewest skipped detections that keep the preview at ≥ 24 fps on average, at most 5 frames between detections (face updates ≥ 5 Hz) | §6.4 |
| K7 | Re-identification after leaving: within 4 s of last being seen, centre within 1.5 face widths of where they left, face width within ×1.5; two candidates about as near (within ×1.25) → nobody: a new person at 原圖 | §7.4 |
| K8 | The grace clock runs on live camera time only (Review, the editor and an interruption pause it), but more than 60 s without a live frame forgets everyone who is not in view. A flip (front ↔ back) and ✕ end the camera session | §7.5, §9 |
| K9 | Selection: the largest face is the target until the first edit, which pins it; a pinned person who leaves hands the target back to the largest face, and gets it back on re-identification if nobody was tapped or edited meanwhile | §3.2, §7.6 |
| K10 | 「全部套用」 is a toggle with copy semantics: turning it on copies the selected person's settings to everyone in view; while on, every slider and preset writes to everyone in view and a face entering the view gets the same settings; turning it off leaves everyone as they are | §3.4 |
| K11 | With a working tracker and no face shown, person items are disabled with 「未偵測到臉部，對準人臉後即可調整」; photo items stay. 基本模式 (no tracker) keeps v0.5's all-skin 磨皮／紅潤 through a session-only "ambient" person | §3.6 |
| K12 | Faint corner brackets mark every shown face while ≥ 2 faces are shown and 全部套用 is off; the 6 px accent dot marks the selected one; a one-time hint 「點選畫面中的臉，可個別調整」 | §3.1 |
| K13 | The shutter forces a fresh detection on the captured frame when the last one is older than that frame, so the photo's faces are drawn on their own landmarks | §3.7 |
| K14 | The hand-over matches each camera person to the editor's faces by box IoU, then by padded centre; a camera person whose face the editor does not find is dropped (never given to another face) with a notice; every handed-over person the full-range pass misses is retried first (§5.4: zoomed, K21; or S §6.5's short-range pass for a large face) | §3.8, §5.4 |
| K15 | `meiyan.look.v1` keeps only its photo part in use: `person` is no longer read and is written as 原圖 | §9 |
| K16 | Ships as 0.6.0 with release notes in RM §15 | §13 |

Decided after the builder check (2026-10-19). The check found that K5 as first written narrowed U1 to "every face one detection pass finds", a narrowing the user never saw, and that in ordinary group shots held upright most faces fall under that pass's floor (§6.1 readings):

| # | Call | Where |
|---|---|---|
| K17 | **(Claude's call — user may revisit; §16.)** U1 is not narrowed. v0.6 is built to find the faces of ordinary group shots held upright: on the back camera every face down to `LIVE_FACE_FLOOR.environment` = 3 % of the stream frame's long edge (about 58 px on the 1080 × 1920 upright stream, a face about 3 m away), in front-camera group scenes down to `LIVE_FACE_FLOOR.user` = 5 % (a back row about 2 m from the front camera), up to 10 faces. It does so with the **group path** (§6.6): IMAGE-mode detections on the visible frame and on zoomed tiles of it, on the one FaceLandmarker instance, main thread, with the preview smoothness rule of K3/K6. It ships when its desktop gates pass (§10: PGR, PGN, PJ1G); if any fails after the fixes the plan allows, `LIVE_GROUP = false` ships instead (one VIDEO pass over the whole frame per facing, K5 as first written: back ≥ ~9 %, front ≥ ~12 % of the long edge), the floors go in the release notes, and §16 tells the user which gate failed. **Settled by K22 (the user, 2026-10-22):** PGN failed (§10); instead of one path for everyone, the group path runs while the user's 合照模式 is on, and option C while it is off (the default) | §2, §6.6, §10 |
| K18 | **(Claude's call — user may revisit; §16.)** The front camera's solo path never scans for small faces: the group path starts when the solo detector finds a second face (≥ ~12 %, anyone at arm's length beside the user), not on a tap, and returns to the solo path after `LIVE_SOLO_AFTER_MS` = 5 s with at most one face. A tap on a solo selfie collapses the panel (`cameraTapAction`), and starting the group path there would cost every such tap a graph rebuild (125–240 ms on the desktop GPU, §6.1) and the next 5 s of the solo path (A1). So a selfie with only far people behind the user finds them once someone nearer joins, or on the back camera. **Replaced by K22 (2026-10-22):** the front camera's path is the user's 合照模式, not the face count: on, the group path from the stream's first frame (no wait for a second face); off, the solo path throughout. `LIVE_SOLO_AFTER_MS` is removed | §6.6 |
| K19 | (Answered by the code and the docs, not a call.) Floors are stated against the upright frame: MediaPipe fits the whole image, aspect kept, into the detector's square input, so a floor is a fraction of the image's long edge, and a row of people across an upright 1080 × 1920 frame is 0.56× as large to the detector as across a landscape one (§6.1 readings) | §6.1 |
| K20 | (Claude's call) Fixtures: upright, shoulder-spaced clips (centres 2.7 face widths apart) for the group path's gates and E4; `group10.y4m` (landscape, cells 1.3 face widths) stays as the 10-face landscape regression only | §12 |
| K21 | (Claude's call) The editor's hand-over retry is zoomed: a camera person no full-range face matches gets one detection on a crop of the photo around their box, so a small face the camera handed over is found in the photo (the editor's own pass has the same ~9 % floor) | §5.4 |

Decided by the user after the desktop gates (2026-10-22, binding). The plan's Task 16 measured PGN failing on both delegates (§6.1 plan measurements, §10), so the 0.6.0 build of that day shipped `LIVE_GROUP = false`; §16 item 1 asked the user for the next step:

| # | Call | Where |
|---|---|---|
| K22 | **The user's decision:** instead of choosing one path for everyone, the camera gets a **「合照模式」** toggle. **Off** (the default, and for every install whose saved prefs predate it): every stream runs one VIDEO pass over the whole frame on its facing's detector, the solo path, as the first 0.6.0 build (`LIVE_GROUP = false`) did: on the front camera v0.5's selfie path (A1, PL2 unchanged, its smoothness kept), on the back camera option C (faces from about 12 % / 9 % of the long edge). **On:** both cameras run the group path (§6.6) from the stream's first frame, so the far and small faces of upright group shots are found and tappable (K17's floors: back camera 3 %, front-camera group scenes 5 %); the front camera uses it at once instead of waiting for K18's second face; the preview may be less smooth with many people (PGN's numbers, §10). Claude's calls, stated to the user with the decision: a toggle labelled 「合照模式」 in the camera UI, default off; the first time it is turned on, one toast 「遠處的人也能點選，人多時預覽可能較不順」; the choice remembered across launches as a camera setting (`meiyan.prefs.v1`, like the other camera settings); ≥ 2 faces shown while it is off → a one-time hint that 合照模式 lets far people be selected; toggling keeps every person's settings (tracks and persons survive the path switch: no one's result lost or swapped); a 44 pt target, 繁體中文 copy, `aria-pressed`. Made while building (Claude's): the chip sits in the top bar beside 比例 and 計時 (§3.13); the hint reads 「開啟合照模式，遠處的人也能點選」 and follows the tap hint of §3.1, and is not shown once the mode was turned on here; the chip is hidden in 基本模式 (no tracker, no path to pick); a start straight on the front camera with the mode on warms the group path's graph behind the spinner, as the back camera's start does (§6.3); the build constant `LIVE_GROUP`, K18's `LIVE_SOLO_AFTER_MS` and the e2e knob `meiyan.debug.live.v1` are removed (the e2e taps the toggle, §12.2) | §3.13, §6.3, §6.6, §9, §10, §16 |

### 0.3 Decisions of RM and S this spec replaces

| Where | Was | Now |
|---|---|---|
| S §0.1 row *Camera*; RM §2.4 last bullet; S §1.2 item 4 | "no per-face settings in the camera"; "one look for every face" | Per-person settings (U2–U5) |
| S §0.1 row *Out of scope* | "per-person camera settings" out of scope | In scope; per-person filters stay out (§2) |
| RM §3.7 *Render* | "each tracked face gets `look.person` if it is selected or 全部套用 is on" | Each tracked face renders its own person's params; untouched faces render 原圖 (§8) |
| RM §3.7 *Hand-over*, S §3.4 C2, `importEdit` (`migrate.ts:120-127`) for shots | A camera shot opens at 原圖 (2026-10-18, 「全部都原圖，包括相機拍的」) | A shot with beauty set opens with each person's camera result (U6); a shot with nothing set, and every import, still opens at 原圖 |
| S §3.5, `limits.ts:177` | `MAX_LIVE_FACES = 3` | 10 (§6.3) |
| S §3.4 T5 (live crops rejected) | The camera detects in VIDEO mode on the whole frame | Group scenes detect in IMAGE mode on fixed views of the visible frame (§6.6); the solo selfie keeps VIDEO (A1). T5's reasons were a crop that moves with the face (it defeats the smoothing) and a `drawImage` per frame; the views are fixed in the frame, and the copy is accepted (the CPU path makes one per frame today, `tracker.ts:105`) |
| S §1.2 item 3, §2.5 | 全部套用: everyone shares the one look while on | Copy semantics (K10) |
| RM §3.7 first bullet, `settings.ts:47-78` | `meiyan.look.v1` holds the camera's person look and photo look | Only the photo look is used (K15) |

---

## 1. Intent and why

v0.5 gives the camera **one** look: `liveFrame` draws every shown track with `look.person` (`live.ts:91-102`), and only the beautified track's eased weight is non-zero (`faceTracks.ts:199-203`), so in a group shot one person, or (under 全部套用) everyone identically, is beautified. The user wants to treat a group shot the way the editor treats a group photo since v0.4: pick a person, adjust them, move to the next, and see everyone keep their own result, then take the picture and keep editing the same people. Three things in v0.5 stand in the way:

1. **Only three faces are tracked, and only large ones are found.** `LIVE_DETECT_FACES = MAX_LIVE_FACES = 3` (`limits.ts:177, 186`), and the camera runs BlazeFace short-range (`tracker.ts:404`: the photo bundle only in IMAGE mode), which finds a face from about 12 % of the frame's long edge (§6.1). A group of four, or anyone a few metres away, cannot be tapped.
2. **There is one look.** `AppState.look` (`ui/state.ts:72-73`) is one `CameraLook` (`types.ts:287-290`); the panel edits it through the one-person lens `lensFor(cameraEdit(look), {person: 'live'}, …)` (`Camera.tsx:78-80`, `edit/state.ts:114-116`).
3. **The editor forgets the camera.** Review's 編輯 opens `importEdit()` (`Review.tsx:87-96`), 原圖 for everyone; only the selected face's seed travels (`ui/state.ts:26-27`).

Identity is the hard part, and the user chose the simple kind (U5: 「做第一種」): no recognition, only geometry over time. The design therefore never guesses: when it cannot tell two people apart, the person who might be someone else starts at 原圖. Losing a setting is the safe failure; giving one person another's settings is not allowed (§2.3).

## 2. Goals, non-goals, anti-goals

### 2.1 Goals

- G1: every face in view down to the floor of K17 (back camera 3 %, front-camera group scenes 5 % of the stream frame's long edge), up to 10, is found and then tappable and selectable (U1), on both cameras, with the phone held upright, while 合照模式 is on (K22); with it off (the default), down to option C's floors (back about 9 %, front about 12 %); any smaller face the detection happens to find is tappable too.
- G2: one person is edited at a time; everyone keeps their own result in the preview and the capture (U2, U3).
- G3: untouched people and a fresh camera are 原圖, at no render cost (U4).
- G4: settings follow people through motion, swaps, brief occlusion and short absences; long absences reset (U5).
- G5: 編輯 continues from the camera result per person (U6).
- G6: ordinary group shots work held upright (K17): three people shoulder to shoulder across the frame (about 6–7 % of the long edge), a back-camera group 2–3 m away (about 3.5–5.5 %), the back row of a group selfie (about 6–10 %). The group path (§6.6), with 合照模式 on (K22), finds them; one detection pass over the frame does not (§6.1 readings; option C found 0 of `upright_far10`'s ten 3–4 % faces, §10).

### 2.2 Non-goals

- Face recognition or any appearance model: identity is geometry and time only (U5).
- Persistence of per-person settings beyond the camera session (K4): no person is remembered across ✕, a flip, 60 s without live frames, or an app restart.
- Per-person 濾鏡, 調節, 質感, 美白, 銳化 or 濾鏡強度 (K2): they stay photo-level, as in the editor (`lens.ts:117`, scope `photo` in `engine/params.ts`).
- More than 10 tracked faces; a notice when there are more (the VIDEO graph stops detecting once it tracks `numFaces` faces, so the camera cannot know).
- A guarantee for faces under K17's floor (3 % of the long edge on the back camera, 5 % in front-camera group scenes) with 合照模式 on, and, with it off (the default, K22), for faces under option C's floors (about 9 % on the back camera, 12 % on the front: the solo path keeps v0.5's one pass).
- 美體 in the camera, ↶／↷ and 重置 in the camera (none exist today; §3.10).
- Detection off the main thread (a Worker): not in this step; PLN's fallback (§6.2 F, §10).

### 2.3 Anti-goals (must never happen)

- A1: **the single-face selfie preview gets slower or less smooth than v0.5.** Measured as S §6.3 PL2 (one face in view: detection p50 at the shipped `numFaces` minus p50 at `numFaces` 1 ≤ 5 ms) on the front camera's solo path, plus: with one face, the detection runs every frame (no cadence) and the render input equals v0.5's for the same params. With 合照模式 off (the default, K22) a solo selfie never leaves the solo path, whatever the face count. §6.1: front `numFaces` 10 costs what v0.5's 3 costs (14.1 vs 14.2 ms GPU, 14.1 vs 14.3 ms CPU). With 合照模式 on the user has chosen the group path for every scene on both cameras, a lone selfie included: A1 is the off state's guarantee, not the on state's (a lone face then costs one whole-view IMAGE call per frame, p50 18.3 ms GPU, 22.1 ms CPU on the short-range detector, row L of §6.1's plan measurements; the back camera's lone face 23.3 / 22.6 ms with the render, PLB).
- A2: **one person's settings are applied to another person.** Every ambiguous case resolves to a new person at 原圖 (§7). The residual case the user accepted with U5, someone else entering where a person left within 4 s, is §14 R3.
- A3: **a fresh camera differs from the original.** With no person edited and the photo look neutral, the frame plan is the composite pass only, the same plan a face-free v0.5 frame at 原圖 runs (`pipeline.ts:203-231`), so the preview equals 按住對比's original render of the same frame and the capture is drawn by the composite pass alone (§12.2 E1).

---

## 3. User-visible behaviour

### 3.1 Faces, taps, marker

- **Brackets** (K12): while ≥ 2 faces are shown and 全部套用 is off, every shown face (found, or held for `LOST_HOLD_MS` after a miss) carries faint corner brackets, the editor's bracket shape at 40 % opacity, drawn by `CameraFaceMarker` (DOM, `pointer-events: none`, never in the capture, `CameraFaceMarker.tsx:1-4`). The selected face has the 6 px accent dot above it (today's dot, `CameraFaceMarker.tsx:100`). While the active panel item is photo-level, brackets and dot dim to 30 % (S A11's rule).
- **Hint:** the first time ≥ 2 faces are shown, a toast 「點選畫面中的臉，可個別調整」 (3.2 s), once per install (key `meiyan.hint.camPersons.v1`, a UI flag, not a setting). With 合照模式 off, the 合照模式 hint follows it (§3.13).
- **Tap** (`cameraTapAction`, `faceTracks.ts:267-275`, unchanged rules): fewer than 2 shown faces → the panel collapse toggles (as today, `camera.spec.ts` keeps passing); 全部套用 on and a face hit → 全部套用 off, that face selected; a face hit that is not the pinned selection (the auto target included) → select it (haptic, the 800 ms accent ring); the pinned face or no face → collapse toggles. Hit-testing grows each box to 44 pt (C1, `faceTracks.ts:239-254`, `coverTapUv` `:278-291`), so a face at the back camera's floor (3 % of the 1920 px long edge, 58 px, about 21 pt on a 393 pt-wide upright preview of the 1080 px width) is tappable. Shoulder to shoulder (centres 2.7 face widths apart, about 57 pt at the floor) the grown boxes do not overlap; in two close rows they can, and the nearest centre wins (`hitTest`, unchanged).
- VoiceOver users still cannot pick a face (S §2.5); they edit the auto target, or everyone through 全部套用.

### 3.2 What the sliders edit

- The **target** is one person: the pinned selection, else the auto target, the largest shown face with S A7's hysteresis (`faceTracks.ts:183-198`). The **first edit** made while the selection is auto pins the auto target (K9), so a face that later grows larger never takes the sliders over silently.
- The panel shows the target's values. Changing the target re-reads every slider and strip; it is no edit.
- A drag keeps the target it started with until it commits, even if the dot moves meanwhile (the person keeps receiving the writes, also while held or away).
- Under 全部套用 the target is everyone in view (§3.4).
- With ≥ 2 shown faces, photo-level items read 「{label} · 整張照片」 on the slider row (aria 「{label}，整張照片」), the editor's A9 label, and the strip's ⊘ follows the editor's ≥ 2-persons rule: it resets the target's items of that tab only, and the tab's photo items too only under 全部套用 or with < 2 faces shown (RM §2.1, `lens.ts:119-120`). Person items' aria reads 「{label}，選取的人物」 (全部套用: 「{label}，全部」).
- 一鍵 presets behave as in the editor with one person selected: the preset's person part goes to the target, its photo part (美白, 銳化, 濾鏡強度 and the photo's preset link, `PRESET_PHOTO_IDS`, `edit/state.ts:39`) to the whole frame.

### 3.3 Who shows what

| Person | Preview and capture |
|---|---|
| Never edited (the auto target before its first edit included) | 原圖: listed for the caps at weight 0, no face pass runs for them (§8) |
| Edited, in view | Their own params; the weight eases in over `FACE_EASE_MS` (150 ms) when they appear (`liveCore.ts:6`) |
| Edited, missing ≤ `LOST_HOLD_MS` (1 s) | Eases out over 150 ms, back in when found (v0.5's hold, `faceTracks.ts:162`) |
| Edited, away (not in view, ≤ 4 s since last seen) | Not drawn; the params wait for re-identification (§7.4) |
| Everyone in view, 全部套用 on | The same params, copied (§3.4) |
| A person whose params are edited back to neutral (一鍵 › 原圖, every ⊘) | Counts as never edited again: 原圖 at no cost |

A person is **edited** when their params differ from `neutralPerson()` (`edit/state.ts:55`) by `editKey`-style comparison.

### 3.4 全部套用 (K10)

- The chip, its 300 / 1200 ms gate (`ChipGate`, `faceTracks.ts:300-323`), its place and `aria-pressed` stay (`Camera.tsx:406-419`).
- **On:** the selected person's params (the target's; 原圖 if never edited) are copied to every person in view (found or held). The lead is that person.
- **While on:** every edit writes the resulting params to every person in view; a face that enters the view (a new person, or a re-identified one) receives the current shared params; the dot is hidden (as today, `CameraFaceMarker.tsx:100`); brackets are hidden.
- **Off** (the chip, or a tap on a face, which also selects it): everyone keeps the params they have; nobody reverts. Further edits go to the selected person only.
- `AppState.cameraAll` (`ui/state.ts:84-85`) still drives it; it now resets to off when the camera session ends (§9), not only at app start.

### 3.5 Photo-level items (K2)

濾鏡 and 濾鏡強度, 調節 (all twelve), 一鍵 › 質感, 美白 and 銳化 apply to the whole frame whoever is selected, as photo items do in the editor (`PHOTO_IDS`, `edit/state.ts:34`). They persist in `meiyan.look.v1` as today (§9). 美體's photo items stay off (the 美體 tab keeps its note, `Camera.tsx:33-36`).

### 3.6 No face shown, 基本模式 (K11)

- **Tracker working, no face shown** (none found and none held): person items (美膚 磨皮／紅潤, 美型, 美妝, 一鍵's preset part) are disabled with the strip note 「未偵測到臉部，對準人臉後即可調整」; photo items stay editable. The existing 「未偵測到臉部」 badge keeps its 1.2 s debounce (`Camera.tsx:127-137`). Nothing global is drawn for persons (no all-skin 磨皮), so no effect vanishes when a face appears.
- **基本模式** (`tracker` null, `live.ts:49-50`): no face is ever tracked. The panel edits a session-only **ambient** person whose 磨皮／紅潤 act on all skin through `globalSkin`, exactly v0.5's no-face path (`live.ts:99`, A2); face tabs keep the 基本模式 note (`Camera.tsx:319-320`). The ambient person is cleared with the session like any person.

### 3.7 Capture and Review

- The shutter (`Camera.tsx:200-251`) renders the frame with every shown face at its own params (K13: when the last detection is older than the frame being captured, i.e. the cadence or tier L skipped this frame, the capture first runs one detection on that frame and feeds the tracks with it). Review shows that image (`Review.tsx:18-24`); 儲存 is unchanged.
- The shot also carries the **hand-over** (§5.3): the photo look and, for each edited person in the picture, their box in the saved image and their params.
- 重拍 returns to the same camera session: the people are re-identified where they stand (§7.5).

### 3.8 編輯 (U6, K14)

- **Nothing set** (no edited person in the picture, the photo look equal to `neutralPhoto()` (`edit/state.ts:81`) by `editKey`-style comparison, no edited ambient person): exactly today, `importEdit()` and the seed (`Review.tsx:87-96`); the shot opens at 原圖.
- **Beauty set:** the editor opens with the camera's photo look from the first frame, and at the photo's first face answer each person found is given the params of the camera person whose face it is (§5.4). The selected camera person's face is the primary and is selected (today's seed rule, `migrate.ts:251-263`); under 全部套用 the primary is chosen by score (seed `'all'`, as today). A person the editor finds and the camera did not edit starts at 原圖. A camera person whose face the editor does not find (after the retries of §5.4) is dropped, never given to another face, and a toast says 「{n} 位人物在照片中未偵測到臉部，未帶入相機效果」 (3.2 s).
- A shot saved mirrored (`mirrorOnSave` on the front camera, `Camera.tsx:235`) hands over mirrored boxes and each person's 左右分開 values swapped (`mirrorSides`, restored from `03698fc`, removed in `4728133`), so the same cheek stays adjusted.
- The editor then behaves as for any photo: every person is editable, 重置 returns to 原圖 (`edit/state.ts:172-180`), the entry autosaves.

### 3.9 Imports

Unchanged: `importEdit()` for every import, from Home and from the camera's 相簿 (`Camera.tsx:486-489`, `flows.ts:44`), whatever the camera holds.

### 3.10 ⊘, 一鍵 › 原圖, no ↶

The camera has no ↶／↷ and no 重置 (the editor's topbar holds them); it keeps the strip's ⊘ 原圖 per tab (`panelModel.ts:430-438`, rule in §3.2) and 一鍵 › 原圖 (the preset `original` on the target, its photo part on the frame). Nothing new is added.

### 3.11 The camera session

One session holds the persons, their params, the selection and the away pool (§5.1). It starts the first time the camera screen shows after it was closed, and it ends on ✕ (`Camera.tsx:194-198`), on a flip (another camera, another scene) and on an app reload. Review, 編輯 and 相簿 do not end it, nor does an interruption (相機已暫停); but after more than 60 s without a live frame, nobody out of view can be re-identified any more (K8), which in practice starts everyone over.

### 3.12 Copy (new strings)

| Where | Text |
|---|---|
| Camera hint toast (once) | 點選畫面中的臉，可個別調整 |
| Camera panel note, tracker on, no face | 未偵測到臉部，對準人臉後即可調整 |
| Camera slider aria, person item | {label}，選取的人物 |
| Editor toast after a hand-over that lost persons | {n} 位人物在照片中未偵測到臉部，未帶入相機效果 |
| Camera top-bar toggle (K22) | 合照模式 |
| Camera toast, 合照模式 turned on the first time (once) | 遠處的人也能點選，人多時預覽可能較不順 |
| Camera hint toast, ≥ 2 faces with 合照模式 off (once) | 開啟合照模式，遠處的人也能點選 |

### 3.13 合照模式 (K22)

- **The toggle:** a chip 「合照模式」 in the camera's top bar, after 比例 and 計時 (`Camera.tsx`, the `chip-btn` style: a 30 px pill in a 44 × 44 pt hit area). A toggle button: `aria-pressed` true or false, the accent colour while on (as 計時 when set). Hidden in 基本模式, where no face is tracked.
- **Off** (the default; prefs saved before the field existed read as off): every stream runs the solo path, one VIDEO pass over the whole frame (§6.3): the front camera exactly as before (A1), the back camera option C. Faces from about 12 % (front) and 9 % (back) of the long edge are found, up to 10.
- **On:** both cameras run the group path (§6.6) from the stream's first frame, so faces down to K17's floors are found and tappable. The preview may be less smooth with many people (PGN: ten far faces 19.8 / 21.2 fps, each refreshed 1.2 / 2.4 times a second, a longest frame of 250 / 217 ms on the desktop GPU / CPU, §10), and a lone face also runs the group path.
- **Toggling** takes effect on the live stream's next frame (`live.ts` reads `prefs.groupMode` every frame, `liveRoute`, `syncPath`): every track carries over, so every person keeps their params, the selection, 全部套用 and the panel's values; nobody's result is lost or given to someone else. It costs one graph rebuild on a live frame (a mode switch, §6.6). It neither ends the camera session nor touches the photo look.
- **Remembered:** `groupMode` in `meiyan.prefs.v1`, saved by `setPrefs` at once, so it survives a reload, the app closing and an update (§9).
- **Toasts:** the first time it is turned on, 「遠處的人也能點選，人多時預覽可能較不順」 (3.2 s, once per install, `meiyan.hint.groupModeOn.v1`). The first time ≥ 2 faces are shown with it off, 「開啟合照模式，遠處的人也能點選」 (3.2 s, once per install, `meiyan.hint.groupMode.v1`), shown 3.4 s after the tap hint of §3.1 when that one shows on the same visit, and dropped if the mode is turned on or the camera left meanwhile; never once the mode was turned on here. Both, like §3.1's, are shown only where storage keeps the flag.

---

## 4. Current behaviour (v0.5, grounded)

| Topic | Today | Anchor |
|---|---|---|
| Tracked faces | `numFaces` 3 in VIDEO on the camera bundle (short-range); every instance and replacement is built at `LIVE_DETECT_FACES` | `limits.ts:177-186`; `tracker.ts:246-256, 319-323, 404, 448` |
| Detection cadence | Every frame; tier L every second frame | `live.ts:176-183`; `liveCore.ts:140-143` |
| Track lifecycle | Dedupe (IoU > 0.6), greedy IoU ≥ 0.3 then centre ≤ 0.5 box widths, "one track, one face" for a lone track, new tracks up to 3, drop after `LOST_HOLD_MS` | `faceTracks.ts:94-162` |
| Selection | `'auto'` (largest, A7) or a pinned track; a dropped pinned track → auto | `faceTracks.ts:163, 183-199, 230-232` |
| Render input | Every shown track with `look.person`; weight eases toward `present && (all ‖ target)`; `globalSkin` from `look.person` at `1 − anyFace` | `live.ts:91-102`; `faceTracks.ts:199-205` |
| Panel | One-person lens over `cameraEdit(look)` (person `live`); edits go to `setLook` | `Camera.tsx:75-80`; `edit/state.ts:114-120`; `lens.ts:90` |
| 全部套用 | `AppState.cameraAll`, false at app start, kept across Review and retakes; a tap on a face turns it off | `ui/state.ts:84-85, 108`; `Camera.tsx:304-312, 406-419` |
| Marker | Dot above the beautified face while ≥ 2 tracks and 全部套用 off; 800 ms ring | `CameraFaceMarker.tsx:71-128` |
| Capture | `renderToImageData` with the current views; seed = the beautified track's raw box centre, `'all'`, or null | `live.ts:387-406`; `Camera.tsx:211-251`; `imaging.ts:79-85` |
| 編輯 | `importEdit()` + seed: opens at 原圖, the seed names the primary | `Review.tsx:87-96`; `migrate.ts:120-127, 251-263` |
| Seed retry | Full-range missing the seed's face → one short-range pass, faces holding the seed added | `still.ts:501-541` |
| Persistence | `meiyan.look.v1` = `{photo, person}`, debounced 300 ms, flushed on hide | `settings.ts:47-78`; `ui/state.ts:116-134` |
| Session reset | `resetSession` (start, resume, flip, resolution) and `pause` clear the tracks and the selection | `live.ts:233-253` |
| Stream lifetime | Only ✕ stops the camera stream (`stopCamera`); Review and the editor leave it running | `Camera.tsx:194-198`; `services.ts:681-687` |
| Engine skip rules | Faces at weight 0 drive no face pass; a neutral listed face still bounds caps and writes 0 into the skin mask | `pipeline.ts:179-231`; `types.ts:599-605` |

---

## 5. Data model

### 5.1 The camera session (`src/app/livePersons.ts`, new, pure)

```ts
export type LivePersonId = number; // per session, counting up from 1; debug id `c{n}`

interface LivePerson {
  id: LivePersonId;
  /** null = never edited (原圖); set → `edited` until written back to neutral */
  params: PersonParams | null;
}

interface AwayEntry {
  person: LivePersonId;
  /** the track's last shown box (unmirrored video UV) and its time on the session clock */
  box: Rect;
  lastSeen: number;
}

class LivePersons {
  // params
  params(id): PersonParams | null;
  write(ids: readonly LivePersonId[], p: PersonParams): void; // neutral p → params null
  // tracks ↔ persons (§7.4)
  claim(box: Rect, aspect: number, now: number): LivePersonId; // re-identified or new
  release(id: LivePersonId, box: Rect, now: number): void;     // a dropped track: to the away pool when edited or remembered (§7.6)
  // selection (§7.6) and 全部套用 (§3.4)
  selection(): 'auto' | LivePersonId;
  pin(id): void;
  autoTarget(id: LivePersonId | null): void; // fed every frame by FaceTracks' A7 pick
  target(): LivePersonId | null;
  setAll(on: boolean, inView: readonly LivePersonId[]): void; // on: copy the target's params to inView
  joined(id): void;                                           // a person entering while all is on gets the shared params
  // clock (§7.5)
  pause(now: number): void;
  resume(now: number): void;
  clear(): void;
  readonly version: number; // bumps on every change (the UI store reads it)
  /** 基本模式 only (§3.6) */
  ambient: PersonParams;
}
```

- One instance per camera session lives in `src/ui/cameraSession.ts` (new): `cameraSession()` returns it, creating it when the camera screen mounts without one; `endCameraSession()` clears it on ✕ and on a flip, and sets `cameraAll` off. The live loop gets it through `LiveDeps.persons`, so a loop rebuilt on `[ctrl, bundle, live]` (`Camera.tsx:121-168`) keeps everyone.
- Only edited persons, and a pinned selection that left (§7.6), enter the away pool; at most `MAX_LIVE_FACES` entries, the oldest evicted.

### 5.2 Tracks (`src/app/faceTracks.ts`)

`Track` gains `person: LivePersonId` (from `claim` when the track starts, kept for the track's life) and a velocity (§7.2). `LiveTrackView` gains `person`, `edited` and `selected` (replacing `beautified`). The selection state moves to `LivePersons`; `FaceTracks.step` still computes the A7 auto pick and passes it to `autoTarget`. `MAX_LIVE_FACES` bounds the tracks (§6.3); when full, a new detection evicts the oldest held track early (its person goes away as on a normal drop).

### 5.3 The hand-over (`Shot` and `EditorSource`)

```ts
/** camera → editor (U6): the camera's result in the saved image's space */
export interface CameraHandOver {
  /** the camera's photo look (meiyan.look.v1's photo): the edit's photo */
  photo: PhotoParams;
  /** each edited person in the picture: box in the saved image's UV (cropped to the ratio, mirrored as saved), params
   * (左右分開 sides swapped when saved mirrored) */
  persons: readonly { box: Rect; params: PersonParams }[];
  /** 基本模式: the all-skin person (§3.6), else null */
  ambient: PersonParams | null;
}
```

- `Shot` (`ui/state.ts:19-28`) gains `handOver: CameraHandOver | null`: null when nothing is set (§3.8), so 編輯 keeps today's path. `faceSeed` stays (it names the primary).
- `LiveLoop.capture()` (`live.ts:387-406`) returns `persons: {rawBox, params}[]` (unmirrored video UV; persons in view, found or held, edited only) beside `{image, seed}`; `Camera.tsx` maps each box with a new `shotBox(box, vw, vh, ratio, mirrored)` beside `shotSeed` (`imaging.ts:79-85`: the same crop, `x' = 1 − x' − w'` when mirrored, not clamped) and applies `mirrorSides` to the params when mirrored.
- `EditorSource` (`ui/state.ts:30-59`) gains `handOver: CameraHandOver['persons'] | null`, a one-shot input of the photo's first answer like `faceSeed`; `freshSource` (`flows.ts:18-20`) takes it.
- The edit Review opens with is `handOverEdit(h) = { v: 2, photo: sanitizePhoto(h.photo), persons: { p0: h.ambient ?? neutralPerson() }, template: neutralPerson(), primaryInit: null }` (`src/edit/migrate.ts`, beside `importEdit`).

### 5.4 Camera persons → editor persons (`firstAnswer`)

`AnswerInput` (`migrate.ts:129-150`) gains `handOver?: readonly {box, params}[] | null` (first answer only, as `faceSeed`, `Editor.tsx:822-834`). After the cache's persons are assigned (`migrate.ts:278-293`):

1. **Match** (`matchHandOver(handOver, cache.faces)`, pure, `src/detect/persons.ts`): pairs by box IoU ≥ 0.3, largest first (both are `ovalBox` boxes in the photo's UV, `faces.ts:116`, `faceTracks.ts:91`); the rest by the padded-centre rule of `seedPrimary` (`persons.ts:114-126`, `SEED_BOX_PAD`), nearest first; one to one. A face beyond the editor's cap (an obstacle) matches nothing.
2. **Assign:** each matched face's person takes the camera params (`withPersons`). Exception: when `p0` differs from the template (the user edited before the first answer, possible only while the detection waited, S §6.5), the primary keeps `p0` as today (`assignPersons`, `edit/state.ts:135-149`), so no edit is lost.
3. **Unmatched camera persons** are dropped; `Answer` gains `handOverMissed: number` for the toast (§3.8).
4. **No face at all** in the answer: nobody is matched, every camera person counts as missed; `p0` stays as the edit opened (原圖, or the ambient person in 基本模式).
5. The rebase applies to the current edit and every undo state, as every answer's does.

**The retries** (`still.ts:501-541`) take `seeds`: the faceSeed point and every hand-over box. A seed is missed when its centre lies in no padded full-range face box (`SEED_BOX_PAD`).

- **Zoomed retry** (K21, Claude's call): the camera finds faces down to 3 % of its frame's long edge (K17), the editor's one full-range pass only from about 9 % of the photo's (the same detector, §6.1), so a far person the camera handed over would be dropped. Each missed hand-over box gets one full-range IMAGE detection on a crop of the working image centred on the box, side `min(long edge, box width / HANDOVER_ZOOM_FACE)`, `HANDOVER_ZOOM_FACE` = 0.25 (the face a quarter of the crop, far over the floor), moved inside the image. Its faces are mapped back to the photo's UV (x, y by the crop's offset and scale, z by the crop's width over the image's), and the one whose padded box holds the seed's centre joins through `prepareWith`, under `prepareFaces`' rules (`MIN_FACE_FRAC`, the cap, display order) like any face.
- **Short-range retry** (S §6.5, as today): the faceSeed, and a hand-over box whose crop would be the whole image (a box over a quarter of the long edge: a large face full-range missed, such as a close-up or one cut by the edge), take one shared short-range pass; it adds the faces that hold any of those seeds.
- **Cost:** nothing when full-range finds every camera person. Else one inference per missed person on a crop no larger than the working image, with no rebuild (the editor's graph is already IMAGE full-range), plus at most one short-range pass (134 ms D3D11 / 33 ms CPU with its rebuild, S §6.5). A seed still missed after its retry is dropped and counted for the toast (§3.8).

---

## 6. Tracking design

### 6.1 Measurements (2026-10-19, this session)

Workspace desktop: Windows 11 Pro, Intel Core i7-14700, Intel UHD 770 (ANGLE D3D11), headed Chrome with the GPU, the app's camera bundle and the assembled photo bundle (`withFaceDetector`) in one FaceLandmarker driven as `tracker.ts` drives it (`setOptions` switching mode, count and bundle in place; the CPU delegate on a canvas copy as `copyFrame`). Chrome's fake camera plays a static 1280 × 720 clip at 30 fps; each row is 1.5 s warm-up, then `detectForVideo` (or `detect`) timed for 3 s. Clips from repo-owned images only: `face.y4m` and `group.y4m` (the e2e clips), and scratch clips composed from `sample_face.png`, `small_faces.jpg` and `ten_faces.jpg` (§12.3). p50 ms; faces = faces returned.

| Clip (faces, size as % of the frame's long edge) | Config | GPU p50 | CPU p50 | Faces GPU / CPU |
|---|---|---|---|---|
| `face.y4m` (1, 29 %) | short n1 | 10.8 | 12.5 | 1 / 1 |
| | short n3 (v0.5) | 14.2 | 14.3 | 1 / 1 |
| | **short n10** | **14.1** (14.7 rerun) | **14.1** (14.2) | 1 / 1 |
| | full n10 | 18.6 | 18.7 | 1 / 1 |
| close-up 36 % / 44 % wide | short n10 | 15.1 / 15.3 | 14.5 / 20.5 | 1 / 1 |
| | full n10 | 19.8 / 18.9 | 19.0 / 19.2 | 1 / 1 |
| square frame, face 70 % wide | short n10 / full n10 | 14.7 / 20.0 | 12.9 / 17.6 | 1 / 1 both |
| square frame, face overflowing the frame (93 %, 100 % wide) | short n10 | 14.3 / 14.7 | 14.2 / 13.5 | 1 / 1 |
| | full n10 | — | — | **0 / 0** |
| square frame, face overflowing further | short n10, full n10 | — | — | 0 / 0 both |
| `group.y4m` (3, 13–17 %) | short n3 | 24.3 | 27.9 | 3 / 3 |
| | short n10 | 31.5 (27.3) | 29.7 (30.1) | 3 / 3 |
| | full n10 | 28.2 | 33.8 | 3 / 3 |
| `ten_faces.jpg` fit to width (10, 9–13 %) | short n10 | 27.6 (31.7) | 22.0 (21.7) | **3 / 2** |
| | **full n10** | **64.1** (p95 75.7) | **82.0** (p95 86.7) | **10 / 10** |
| `small_faces.jpg` fit to height (7, 4.5–10.5 %) | short n10 | 15.2 | 6.2 | 0 / 0 |
| | full n10 (VIDEO) | 21.6 | 26.3 | 2 / 2 (the 9.4 % and 10.5 % faces) |
| | full n10 IMAGE on a 1280 / 640 copy | 28.5 / 30.0 | 26.9 / 26.3 | 2 / 2 |

The square-frame rows came out of Chrome centre-cropping 720 × 1280 portrait clips to 720 × 720 for the 1280 × 720 request; sizes are given against that frame. Switch costs (the first call after a `setOptions`): a bundle, mode or count switch 125–240 ms GPU, 13–44 ms CPU; the **first full-range inference of the browser session** 1,105–1,287 ms GPU (the program compile S §6.5 measured for photos), 26–96 ms CPU. A periodic rescan cycle (VIDEO short n10 → IMAGE full n10 on a 640 copy → VIDEO), four cycles: GPU `setOptions` 11–15 ms + first IMAGE 165–173 ms + `setOptions` 11–12 ms + first VIDEO 124–141 ms = **about 320–340 ms of main-thread block per cycle**; CPU about 70 ms. The VIDEO graph restarts its tracking after each cycle.

Readings:
- `numFaces` 10 costs a lone face what v0.5's 3 costs on the short-range detector (A1 holds): in VIDEO mode the detector runs on every call while fewer than `numFaces` faces are tracked, at 3 as at 10 (`limits.ts:178-185`).
- Each tracked face adds a landmark inference, about 6–7 ms GPU and 7–8 ms CPU here; 10 faces cost one call 64 / 82 ms, more than two camera frames, on the main thread (MediaPipe's calls are synchronous).
- Short-range finds faces from about 12 % of the long edge (3 of 10 at 9–13 %, none at ≤ 10.5 %); full-range from about 9 % (10 of 10 at 9–13 %, 2 of 7 at 4.5–10.5 %). Full-range costs a lone face +4.4 ms per frame (PL2 Δ 7.8 ms GPU, 6.2 ms CPU: over the 5 ms limit) and misses a face overflowing the frame, which short-range keeps.
- A full-range IMAGE pass on the same frame finds no more than VIDEO does (the detector sees the same relative size), and a periodic switch costs a visible ~1/3 s freeze per cycle on the GPU delegate.
- **Upright frames (builder check; K19).** Every clip above is landscape 1280 × 720, but the floors carry over by the long edge: MediaPipe fits the whole image, aspect kept, into the detector's square input (128 px short-range, 192 px full-range), so what counts is a face's width over the image's long edge. On the iPhone the stream held upright is 1080 × 1920 (adjust spec `2026-10-12-adjust-and-looks-design.md`, edge cases: the three ratios keep its full short edge), and the camera offers only upright frames (3:4, 1:1, 9:16, `ui/state.ts:11-14`), so a row of people across the width is 1080 / 1920 = 0.56× as large to the detector as the same row across a landscape frame. Worked cases, upright:
  - three people shoulder to shoulder across the width (centres about 2.7 face widths apart): faces about 12 % of the width, **6–7 % of the long edge**, under full-range's ~9 %;
  - a back-camera group 2–3 m away (26 mm-equivalent lens, about 42° across the upright width of the 16:9 stream): **about 3.5–5.5 %**;
  - the back row of a group selfie 1–1.5 m from the front camera: **about 6–10 %**, under short-range's ~12 %.
  So one pass over the frame finds close-ups and two or three people pressed together, not ordinary group shots. `ten_faces.jpg` (cells 1.3 face widths wide, faces 9–13 % of a landscape long edge) is tighter and larger than any of these, which is why E4 as first written would have passed (K20). K17 is the answer.
- The floors are soft: near one, a shift of 0.01 moves a face's score by 0.1–0.3 (BlazeFace's anchor grid; S's `small_faces.jpg` fixture row). That photo's layout, tuned to score, is found down to 6 % in IMAGE mode, while the untuned clip made from it misses its 7.9 % face. The group path sizes its tiles from the floors with margin (`DETECTOR_FLOOR` 11 % short-range, 8 % full-range, §6.6), and its fixtures place faces at seeded random sub-pixel offsets so no gate rides on the grid (§12.3).

#### Plan measurements (2026-10-22, the same desktop)

The plan's Task 16, on the machine above (Windows 11 Pro, i7-14700, Intel UHD 770 with ANGLE D3D11): `scripts/bench-multiface.mjs` in headed Chrome with the GPU (the bench page runs the app's live loop, tracker and engine from `src/`), Playwright for E4, Node 24.13.0 for PB. Another session's .NET build and tests loaded the CPU in bursts (up to about 20 of the 28 threads for 5–20 s, every minute or two). A logger recorded the other processes' CPU every 5 s, and every row below comes from a run without a burst unless it is marked *loaded*. Clips as §12.3; `tile_face.y4m` and `group_pan.y4m` regenerated by the plan's commands (byte-identical to the copies on disk).

- **PB** (`BENCH=1 npx vitest run src/app/faceTracks.bench.test.ts --silent=false`): 10 faces jittered ±0.002, 50 warm-up and 1000 timed `detect` + `step` calls on an edited session: mean 0.39, 0.38 and 0.41 ms (0.51 in the first run). Limit 1 ms.
- **E4** (PGR): every group-path test passed 3 of 3 per fixture and delegate. CPU (`--repeat-each 3`; SwiftShader renders, MediaPipe on CPU): 12 of 12. GPU (`PGR_DELEGATE=auto … --headed`; a probe of the same setup read `delegate: 'GPU'` and ANGLE UHD 770): 12 of 12. Option C on `upright_far10` found **0** faces in each of the 6 runs. The selfie logged `group` only: the solo path finds both near faces on its first call, before the first sample.
- **LFC** (option C, `group10.y4m`, 1280 × 720, 10 faces): GPU 22.3 fps, longest frame **166.8 ms**, max gap 133.6 ms, k 6, slowest face 3.8 Hz, detection p50 111.6 ms, render p50 0.7 ms, tier M; CPU 21.8 fps, **150.1 ms**, 133.6 ms, k 6, 3.7 Hz, 123.5 ms, 0.7 ms, tier L. A first run, before the logger started: GPU 20.9 fps, 216.9 ms, 3.5 Hz, 128.8 ms; CPU 22.3 fps, 150.1 ms, 3.8 Hz, 126.7 ms. Each delegate's longest frame of the logged quiet run is its PGN bound (the first run's GPU 216.9 ms would only have loosened it).
- **LF, PGN** (the group path, back camera, `upright_far10.y4m` at 1080 × 1920, ten faces at 3–4 %; the cycle is the whole view, `t0,1` and `t1,1` (the left and right tiles of the middle tile row, which hold the two face rows, about half the faces each); ten faces tracked, so no scans):

  | Run | Delegate | fps | Longest ms | Max gap ms | k | Slowest face Hz | Detect p50 ms | Render p50 ms | Tier | PGN |
  |---|---|---|---|---|---|---|---|---|---|---|
  | defaults | GPU | 19.8 | 250.2 | 233.1 | 6 | 1.2 | 151.3 | 1.1 | L | fail |
  | | CPU | 21.2 | 216.9 | 199.8 | 6 | 2.4 | 123.3 | 0.9 | L | fail |
  | defaults, *loaded* | GPU | 18.2 | 317.1 | 266.4 | 6 | 1.1 | 159.9 | 1.3 | L | fail |
  | | CPU | 20.7 | 233.6 | 199.8 | 6 | 2.4 | 129.4 | 0.9 | L | fail |
  | `LIVE_SCAN_EVERY` 8 | GPU | 21.6 | 267.1 | 233.8 | 6 | 1.3 | 117.2 | 0.9 | L | fail |
  | | CPU | 21.4 | 200.2 | 166.5 | 6 | 2.4 | 128.5 | 0.9 | L | fail |
  | `LIVE_MAX_DETECT_EVERY` 12 | GPU | 21.7 | 322.9 | 267.2 | 12 | 0.7 | 196.8 | 1.0 | M | fail |
  | | CPU | 20.7 | 383.8 | 367.4 | 12 | 1.2 | 222.2 | 1.0 | M | fail |

- **LF, PLB** (one face, back camera, group path, `face.y4m`): GPU 26.8 fps, k 1, the face refreshed at 20.2 Hz, whole-view call p50 22.9 ms + render p50 0.4 ms = **23.3 ms**; CPU 29.2 fps, 22 Hz, 22.2 + 0.4 = **22.6 ms**. Limit 33 ms. (The GPU window held one 750.8 ms frame, the CPU window's longest was 233.6 ms.)
- **JG, PJ1G** (RMS in px at 1080 px, the app's group-path smoother against MediaPipe's numFaces-1 VIDEO smoothing on the same frames). Jitter, `tile_face.y4m`, three runs (each overlapped a burst, the first a short one), each kind with frames > 0 (24–54): GPU whole 0.3 / 0.3, 0.3 / 0.3, 0.3 / 0.2 (app / MediaPipe), pass 3 of 3; GPU tile `t1,0` 0.3 / 0.3, 0.3 / 0.3, 0.2 / 0.2, pass 3 of 3; CPU whole 0.4 / 0.2 (**fail**: just over max(0.4, 1.25 × MediaPipe), shown rounded), 0.3 / 0.3, 0.4 / 0.2, pass 2 of 3; CPU tile `t1,0` 0.3 / 0.2, 0.3 / 0.2, 0.3 / 0.3, pass 3 of 3. Lag, `group_pan.y4m`: GPU whole 5.3 ms against MediaPipe's 13.9, GPU tile 3.8 against 11.1, CPU whole 4.9 against 13.2, CPU tile 6.0 against 18.6; all pass.
- **GS, PGS** (front camera, `selfie_group.y4m` upright): one move, solo → group at 2.1 s, five faces; the longest frame within ±1 s of it **183.5 ms** GPU, **50.2 ms** CPU (limit 250). The longest frame of the whole run: 483.9 ms GPU, 66.8 ms CPU.
- **WB, PWB** (`face.y4m`, two runs, each on a fresh page): GPU cold flip, `warm('IMAGE', 'photo')` 1196.5 / 1146.1 ms (the full-range compile, behind the spinner), first frame **74.5 / 70.1 ms** after `live` (its detection 28.4 / 32.0 ms); warm flip, `warm` 187.9 / 212.7 ms, first frame 70.5 / 63.1 ms. CPU cold flip, `warm` 78.9 / 43.2 ms, first frame **55.1 / 32.8 ms**; warm flip, `warm` 75.9 / 33.2 ms, first frame 870.9 / 59.2 ms (the 870.9 ms did not repeat). Limit 300 ms. A third run after `LIVE_GROUP = false` (option C's flip, `warm('VIDEO', 'photo')`, the release's path): GPU cold `warm` 1145.3 ms, first frame **73.0 ms**; warm 179.7 ms, 58.8 ms; CPU cold 45.6 ms, **37.7 ms**; warm 35.5 ms, 60.9 ms.
- **L** (`face.y4m`, one face, VIDEO, p50 / p95 ms; the second of five runs, the first without a burst): camera (short-range) numFaces 1, 3, 10: GPU 11.1 / 13.5, 15.5 / 18.4, 15.4 / 17.5; CPU 12.5 / 14.3, 14.2 / 16.0, 14.5 / 15.7. Photo (full-range): GPU 11.2 / 14.0, 20.4 / 23.9, 20.6 / 23.6; CPU 12.4 / 17.4, 19.2 / 22.8, 19.0 / 23.6. Switch: GPU 147–192 ms (1,144.8 ms into the photo bundle: the full-range compile), CPU 31–44 ms. The group path's calls, p50 / p95 (the copy 0.3–0.7 ms; a burst fell on these rows): GPU photo whole view (540 × 720) 19.3 / 24.0, photo tile `t0,0` (480 × 480) 31.2 / 45.6, camera whole 18.3 / 54.1, camera tile (540 × 540) 16.6 / 39.7; CPU 25.3 / 38.5, 18.0 / 40.7, 22.1 / 76.4, 12.9 / 15.2. **PL2** (camera detector, numFaces 10 minus 1, limit 5 ms), five runs: GPU Δp50 5.1 (*loaded*: a burst over its camera rows), **4.3**, 7.3, 7.0 and 5.2 ms: **pass 1 of 5**; CPU 2.3, **2.0**, 5.0, 4.5 and 2.0 ms: pass 5 of 5. In the third and fourth runs every row was 20–60 % slower (numFaces 1: GPU 15.3 and 13.2 ms against 11.1, CPU 20.0 and 19.7 against 12.5) with no burst logged; the cause was not found (one GPU sample, between runs, had `strwinclt` and `TokenTrainer` at 4–7 % of the 3D engine). A1's own comparison, numFaces 10 against v0.5's 3 on the same run: GPU +1.2, −0.1, +0.7, +0.7, −0.7 ms; CPU +0.8, +0.3, +0.3, +0.4, −0.1 ms. v0.5's numFaces 3 against 1 was itself 3.9, 4.4, 6.6, 6.3 and 5.9 ms on the GPU (3.4 ms on 2026-10-19, the table above).

Readings:
- **PGN fails on both delegates, and no constant this row allows can recover it.** The group path's preview averaged 19.8 fps (GPU) and 21.2 fps (CPU), under 24; the slowest face was refreshed at 1.2 and 2.4 Hz, under 5; and its longest frame (250.2 and 216.9 ms) was longer than option C's (166.8 and 150.1 ms). §6.4 assumed two or three faces per call (D ≈ 32 ms). On `upright_far10` the whole view, a 960 × 1280 copy of the 3:4 crop, finds all ten 3–4 % faces, so each cycle runs about 20 landmark inferences: ten in the whole view and about five in each tile. One call then costs 120–150 ms, and k stays at `LIVE_MAX_DETECT_EVERY`. The faces need 5 Hz each, and each face is refreshed by two of the three calls in a cycle, so that takes about 7.5 calls a second, about a second of main-thread work per second. §10's fixes cannot change this: scans do not run at ten faces, so `LIVE_SCAN_EVERY` is a no-op there (8: the same numbers); a larger k cap (`LIVE_MAX_DETECT_EVERY` 12) did not raise the fps (21.7 / 20.7) and halved the face rate; a smaller one would lower the fps. So `LIVE_GROUP = false` ships (K17's fallback, §10, §16 item 1).
- A landmark inference in the live loop costs about 11–12 ms per face here (option C's ten faces 112–124 ms), not §6.1's isolated 6–7 ms: the render and the camera share the main thread and the GPU.
- The other desktop gates hold: PGR and PJ1G (CPU whole view 2 of 3); so do PLB, PGS, PWB and PB.
- **PL2 fails on the GPU in 4 of 5 runs** (5.2 ms on the last quiet run, against 3.3 ms on 2026-10-19), and passes on the CPU in 5 of 5. The single-face selfie is not slower than v0.5 (A1): numFaces 10 costs what v0.5's 3 costs, within ±1.2 ms in every run, and the excess over PL2's limit is numFaces 3's own cost over numFaces 1, which v0.5 shipped with. PL2 is not a desktop gate. It is judged on the slowest iPhone (§10), and its fallback (`MAX_LIVE_FACES = 1`, the v0.3 camera with per-person settings off) is left to that measurement and the user (§16 item 1).

### 6.2 Options

| Option | Recall | Lone selfie (A1) | Many faces | Verdict |
|---|---|---|---|---|
| A. VIDEO short-range, `numFaces` 10, both cameras | ≥ ~12 % | = v0.5 | 3 of 10 at 9–13 % | Misses U1's far faces |
| B. VIDEO full-range, `numFaces` 10, both cameras | ≥ ~9 % | +4.4 ms, PL2 fails; overflowing close-ups lost | 10 of 10 at 9–13 % | Breaks A1 |
| C. A on the front camera, B on the back camera | front ≥ ~12 %, back ≥ ~9 % | = v0.5 (front) | back 10 of 10 | Chosen as first written; then K17's fallback; **since K22 the path while 合照模式 is off** (the default): it misses ordinary upright group shots (§6.1 readings) |
| D. A + a periodic full-range IMAGE rescan on a downscaled frame | no gain on the same frame (2 of 7 either way) | +320–340 ms freeze per cycle (GPU) | the VIDEO graph cannot track what IMAGE found: found faces would hold one landmark set per cycle | Rejected |
| E. IMAGE-mode tracking on a crop per face (zoom finds faces < 9 %) | best | every IMAGE call pays the detector and the GPU round trip, 15.6 ms GPU (5.8 ms CPU) with no face found, so a crop per face multiplies a cost VIDEO pays once per frame; IMAGE landmarks come without VIDEO's landmark-based tracking (PJ1 risk); a crop is a `drawImage` per call on the GPU path (S T5 rejected crops) | bounded per call, but about one face refreshed per frame | Rejected; its tiled form, with fixed views, is H |
| F. Detection in a Worker (the one instance moves there) | as C | unchanged if the render waits for its own frame's answer | preview stays at full rate, landmarks lag | Not now: `detectImage` must become async (`still.ts:516`, `Editor.tsx:783-848`), a separate project. The fallback for PLN (§10) |
| G. Cadence only (detect every k frames) | — | — | amortizes, cannot shorten one 64–82 ms call | Used inside C and H (§6.4) |
| **H. The group path: A for the solo selfie; group scenes in IMAGE mode on fixed views of the visible frame, the whole frame and a grid of zoomed tiles, one view per call** (§6.6) | by tile size: back ≥ 3 %, front groups ≥ 5 % | = v0.5 (the solo path is A, K18) | each call refreshes the faces in its view and finds new ones there; the cost spreads over frames instead of one long call | **Chosen (K17)**, behind its desktop gates (§10); PGN failed, so since K22 it runs while the user's 合照模式 is on |

E's cost argument is weaker than its row reads: VIDEO pays the same detector while it tracks fewer than `numFaces` faces, which in the camera is nearly always (15.2 ms GPU, 6.2 ms CPU on `small_faces` with no face found, against IMAGE's 15.6 / 5.8). What E's row rightly rejects is a crop **per face** (a detector pass per person) and a crop that **moves** with a face (S T5). H uses neither: its views are fixed in the frame and hold many faces each. It keeps E's real cost, IMAGE landmarks without VIDEO's landmark-based tracking, and measures it (PJ1G, §10).

### 6.3 Decision (K5, K17)

- **Paths (K22):** the user's 合照模式 (`Prefs.groupMode`, off by default, §3.13) picks the path: `liveRoute(facing, groupMode)` (`live.ts`), read on every frame. **Off:** every stream runs the **solo path**, VIDEO mode on the whole frame, every frame, on its facing's detector: v0.5's selfie path on the front camera (A1) and option C on the back camera (§6.2). **On:** both cameras run the **group path** (§6.6) from the stream's first frame. A toggle moves the live stream to the other path on its next frame (§6.6, *Moving between the paths*). History: as first built, the front camera moved to the group path on a second face and back after `LIVE_SOLO_AFTER_MS` with at most one face (K18), the back camera ran it from its first frame, and the build constant `LIVE_GROUP` turned it off; PGN failed on the desktop (§6.1 plan measurements, §10), the build of 2026-10-22 shipped `LIVE_GROUP = false` with the group path behind the e2e knob `meiyan.debug.live.v1 { group: true }`, and the user then chose the toggle (K22), which replaces the constant, K18's rule and the knob.
- **Detector per facing:** `LIVE_DETECTOR: Record<Facing, 'camera' | 'photo'> = { user: 'camera', environment: 'photo' }` (`limits.ts`), the bundle of both paths of that facing. The front camera's group path stays on short-range so that starting it in the middle of a selfie costs a mode switch only: no bundle switch, and never the full-range compile (1.1–1.3 s on the desktop GPU) on a live frame; its tiles are sized for short-range's floor (§6.6). The live loop fixes the detector when a stream session starts (`resetSession`, `live.ts:233-244`): `'photo'` only when `tracker.photoDetector === 'full-range'` then, else `'camera'` (the back camera's group path then runs short-range tiles, sized for that floor), so a detector download landing mid-stream never rebuilds the graph under the preview (it is used from the next flip).
- **Count:** `MAX_LIVE_FACES = MAX_EDIT_FACES` (10) and `LIVE_DETECT_FACES = MAX_LIVE_FACES` (`limits.ts:177, 186`) for the VIDEO graph, never changed within a stream. The group path's IMAGE calls use `EDIT_DETECT_FACES` (12, the editor's count): a view holding an eleventh face still returns ten, and from the back camera the editor's first detection needs no rebuild at all (same mode, bundle and count). The render list fits (`MAX_RENDER_FACES` 10, `limits.ts:167`): present edited tracks first, then present, then held, cut at 10. `MAX_LIVE_FACES = 1` keeps meaning "選臉 hidden, smoother bypassed, no group path" (`faceTracks.ts:150, 176-178`).
- **Tracker** (`tracker.ts`): the solo path and the fallback call `detectVideo(video, ts, {maxFaces, detector})`; `setMode` takes the photo bundle in VIDEO when asked (`tracker.ts:404` today allows it only in IMAGE), which only the fallback uses. The group path calls the existing synchronous `detectImage(view, {maxFaces: EDIT_DETECT_FACES, detector})`, whose `ImageInput` gains `OffscreenCanvas` (`tracker.ts:56`; the CPU path already hands one to `detectForVideo`). (As built, a deviation recorded 2026-10-22: the group path calls `detectView(view, {maxFaces, detector})`, `detectImage` behind the live path's guards. `detectImage` answers `[]`, "no face", for an instance being replaced or held by the rebuild throttle, and A5 needs a null there, "no answer", so that the tracks, persons and pin are held: Review Focus #4.) A replacement instance still starts on the camera bundle (`:319-323`) and the next call switches. New `warm(mode, detector)` (the first draft's `warmVideo`, generalized): switches the graph to that mode, count and bundle and runs one call on a 64 × 64 blank `OffscreenCanvas`, so the full-range compile (once per browser session) lands while the flip's new stream starts behind the 「正在開啟相機…」 spinner (`Camera.tsx:348-349`) instead of on the first live frame. `Camera.tsx`'s `flip` warms the graph `liveRoute` names for the new facing right after `ctrl.flip()`: with 合照模式 off `warm('VIDEO', 'photo')` to the back camera and `warm('VIDEO', 'camera')` to the front, with it on `warm('IMAGE', …)` on the same detectors; a start straight on the back camera calls it in `start`, and so does a start on the front camera with 合照模式 on (`warmsOnStart`, `ui/groupMode.ts`; off, the front camera starts as in v0.5). A toggle of 合照模式 is not warmed: it is one rebuild on a live frame (a mode switch on the same bundle, 125–240 ms desktop GPU, §6.1; the front camera's solo → group move measured 183.5 ms GPU, 50.2 ms CPU as PGS, §10; the back camera's not measured).
- **One instance:** unchanged (`tracker.ts:3-6`). The camera ↔ editor switch stays one rebuild on the same instance: from the front camera a bundle switch (with a mode switch from its solo path); from the back camera's group path, none.

### 6.4 Per-frame budget and the degradation rule (K3, K6)

Budget at 30 fps (`camera.ts:22`): T = 33.3 ms per camera frame for detection, render and bookkeeping on the main thread.

- **One face (or none):** the detection runs on every frame (tier L: every second, `liveCore.ts:140-143`, unchanged). This is v0.5's path exactly (A1).
- **Two or more tracked faces:** the loop detects every k-th frame, `k = clamp(⌈(D + R − T) / (T_min − T)⌉, 1, LIVE_MAX_DETECT_EVERY)`, where D is the detection EMA per call (`detectEma`, `live.ts:112`), R the render EMA (`renderEma`), T the camera's own frame interval (the EMA of the intervals between non-detecting frames, starting at 1000 / 30), `T_min = max(1000 / LIVE_MIN_FPS, 1.25 T)`, `LIVE_MIN_FPS = 24`, `LIVE_MAX_DETECT_EVERY = 6` (face updates ≥ 5 Hz at 30 fps). A k that rises applies after it held 500 ms, one that falls after 1500 ms; `resetSession` sets k = 1. Tier L doubles it: `k_eff = max(k, tier === 'L' ? 2 : 1)`.
  - Rationale: k detections amortize one call over k frames; a call longer than a frame still drops frames, and the rule only bounds how often. Average frame time `(D + R + (k − 1) T) / k ≤ T_min` gives the formula.
  - Desktop, derived from §6.1 (R ≈ 5 ms, the UHD 770's camera frame, adjust spec §6.2): front, 3 faces, D ≈ 27–32 → k = 1 (about 27–30 fps, as v0.5); back, 10 faces, GPU D ≈ 64 → k = 5 (face updates 6 Hz, about 24.7 fps average, one ~69 ms frame per cycle); CPU D ≈ 82 → k = 6 (5 Hz, about 23.7 fps). Bench row LF measures the real numbers (§12.4).
- **On the group path** (§6.6) a detection is one IMAGE call on one view, D is the EMA of those calls, and the same rule picks k (one face or none: every frame, as above; the back camera's lone face is PLB). Each call pays only for the faces in its view, so the cost spreads over frames. Desktop estimate from §6.1 for ten far faces over four tiles, two or three per call: D ≈ 15.6 + 2.5 × 6.5 ≈ 32 ms GPU → k = 1 (about 27 fps), each face refreshed once per cycle of about four calls (about 7 Hz), where C's single 64 ms call needed k = 5 (6 Hz, one ~69 ms frame per cycle). An estimate, measured as PGN (§10).
- **Between detections** the tracks hold their last landmarks (as tier L does today); the smoother is fed only on detecting frames with dt = the time since the track's previous detection (S T4), so any k works.
- **Auto-tier** (`liveCore.ts:8-16, 122-131`): on a detecting frame with k > 1 the sample is `R + D / k` and the skipped-frames charge does not apply (the drop is the detection's, which a lower render tier cannot fix); non-detecting frames are sampled as today.
- **Capture** (K13) costs one detection when the last one is older than the captured frame: ≤ D, once per shot.
- `LiveStats` and the debug state report k (`liveEvery`) and the detector (`liveDetector`).

### 6.5 Bookkeeping cost

Matching, re-identification and the smoother at 10 faces (478 × 3 One-Euro filters per face, `oneEuro.ts`) must stay ≤ 1 ms per detection on the desktop (S §6.1 had ≤ 0.3 ms at 3 faces); a unit benchmark pins it (§12.1).

### 6.6 The group path (K17, K22)

The scope (U1 not narrowed, the floors) is K17; it runs while the user's 合照模式 is on (K22, §3.13). The mechanism below is Claude's call; the plan may change any number in it with a measurement, committed with the numbers in `limits.ts` (S §6.4).

**Views.** In the stream frame's pixels, inside the **visible crop**: the ratio crop the preview shows and the shutter saves (the crop of `shotSeed`, `imaging.ts:79-85`). A face outside it is not in view.

- The **whole view**: the visible crop, copied at most `LIVE_VIEW_MAX_EDGE` = 1280 px on its long edge.
- The **tiles**: squares of side `LIVE_FACE_FLOOR[facing] / DETECTOR_FLOOR[detector]` × the stream frame's long edge (no larger than the crop's short side), in a grid spread evenly over the crop so that neighbours overlap by at least `DETECTOR_FLOOR[detector]` × the crop's long edge (a face too large to sit whole in some tile is one the whole view finds), copied at native size: the detector scales every view to its own input, so a tile needs no upscaling. `LIVE_FACE_FLOOR = { user: 0.05, environment: 0.03 }`, `DETECTOR_FLOOR = { camera: 0.11, photo: 0.08 }` (§6.1's ~12 % and ~9 %, with margin).
- On the 1080 × 1920 upright stream: back camera (full-range, floor 3 %): 720 px tiles, 2 × 3 on 3:4, 2 × 4 on 9:16, 2 × 2 on 1:1. Front camera (short-range, floor 5 %): 873 px tiles, 2 × 2 on 3:4 and 1:1, 2 × 3 on 9:16. Any other stream (a desktop webcam, the e2e's fake camera) uses the same fractions.

**Assignment.** A track is **large** when its box width is at least 1.25 × `DETECTOR_FLOOR` × the crop's long edge, else **small**. A large track is refreshed by the whole view, a small one by the tile that holds its predicted box whole with the nearest centre.

**Schedule.** The group path cycles through its **refresh views**: the whole view, then each tile that holds a small track, in raster order. Every `LIVE_SCAN_EVERY` = 4th call is a **scan** instead: the next tile in raster order that is not a refresh view in this cycle. The whole view is in every cycle, so a new large face is found within one; a new small face within one sweep of the scans (8 tiles at most, so at most 32 calls, about 1.1 s at 30 calls per second). No scans run while 10 faces are tracked. Examples: a group selfie of two or three near faces runs the whole view three calls in four; ten far faces over four tiles run a cycle of five views.

**Mapping and matching.** A call's faces are mapped from the view to stream UV (x and y by the view's offset and scale, z by the view's width over the frame's) and matched as §7.3 against the predicted boxes of the tracks the view holds whole. A face cut by a tile's edge is ignored in that tile unless it matches a track (the overlapping tile holds it whole). Any call's faces refresh every track they match, wherever that track is assigned. A track is **missed** only by a call whose view holds its predicted box whole and finds no face for it; for every other track the call is no event: it neither misses nor ages it, and the hold (`LOST_HOLD_MS`), the velocity (§7.2) and the smoother (dt since the track's own last refresh, S T4) count from the track's own refreshes. New faces start tracks and `claim` persons (§7.3 item 5). (As built, the plan's Task 14 fix, recorded 2026-10-22: a view matches the tracks whose predicted box it holds whole **once the box is clipped to the visible crop**, `viewScope` in `liveViews.ts`. For the whole view that is every track partly in view; a tile also matches a box cut by the crop's edge where that edge is its own, and a box cut by a tile's edge inside the crop stays the neighbouring tile's. What a view can miss is unchanged. Without the clip, a face that stopped just inside the crop's edge, or a face cut by the frame's edge whose prediction jittered past it, was matched by no view and started a new person on every whole-view call: `group_move`'s swap, `detector.spec.ts` D2.)

**Copies.** Each call copies its view from the video with a 2D `drawImage` of the view's rect into one reused `OffscreenCanvas` per size (`HTMLCanvasElement` where `OffscreenCanvas` 2D is missing), on both delegates; the CPU path already copies every frame (`copyFrame`, `tracker.ts:105`). Nothing is mirrored: detection stays in unmirrored video UV.

**Moving between the paths (合照模式 toggled, K22).** On either camera, the first frame after a toggle runs the path it picks (`syncPath`, `live.ts`) and detects (the cadence's count restarts): solo → group, the first call is the whole view; group → solo, the VIDEO graph finds the faces again on its first call (a held track is continued, §7.3 item 4). The tracks carry over both ways (their boxes are already in stream UV), so every person keeps their params, the selection and 全部套用 (`live.test.ts`, E4c). Each move costs one rebuild on a live frame, a mode switch on the same bundle (PGS, §10). A flip and ✕ end the session as before. (Until K22 the front camera moved on the solo path's first frame that found a second face in view and back after `LIVE_SOLO_AFTER_MS` = 5000 ms with at most one track shown, K18; that rule and its constant are removed.)

**Capture (K13).** The shutter's forced detection runs every refresh view of the current cycle on the captured frame (no scans), so every face is drawn on its own landmarks: at most one cycle of calls, once per shot.

**Debug.** `liveDetector` stays (`'short-range'` / `'full-range'`); new `livePath` (`'solo'` / `'group'`) and `liveViews` (the cycle, as `whole` and `t{col},{row}`); each debug box gains `view`, the view that last refreshed it.

**Off by default (K22).** PGN failed on the desktop (§6.1 plan measurements, §10), so the group path runs only while the user has 合照模式 on; off, every stream runs option C (§6.2, §6.3), the solo path's VIDEO code with the facing's bundle. (The 0.6.0 build of 2026-10-22 shipped this off for everyone as `LIVE_GROUP = false`, the group path reachable only through the e2e knob `meiyan.debug.live.v1 { group: true }`; K22 removed both: the user's toggle decides, and the e2e taps it, §12.2.)

---

## 7. Identity

### 7.1 Principles

Geometry and time only (U5). Every ambiguity resolves to a new person at 原圖 (A2). A person exists as long as their track lives, plus the away grace.

### 7.2 Prediction

Each track keeps a box-centre velocity, an EMA over detections (τ = 200 ms) of Δcentre / Δt. On a detecting frame each track's box is predicted by `velocity × (now − lastSeen)`, at most one box width from where it was. Held tracks are matched at their predicted boxes, so a face that passes behind another and reappears on the far side meets its own track (a swap).

### 7.3 Matching (replaces `faceTracks.ts:103-142`)

1. Dedupe as today (IoU > 0.6, keep the one on a track, else the larger, `:94-102`).
2. Greedy box IoU ≥ 0.3 against predicted boxes, then nearest centre within 0.5 predicted box widths (today's two rules).
3. **Size gate:** a pair whose box width differs from the predicted box by more than ×1.5 (`TRACK_SIZE_JUMP`) is refused: a face that suddenly doubles is someone stepping in front.
4. **Continuation:** an unmatched detection may continue a **held** track (missing ≤ `LOST_HOLD_MS`) that passes the re-identification gates of §7.4 against its predicted box; this replaces the "one track, one face" rule (`:135-142`), whose job (a lone selfie through a brisk pan) the predicted box and the gates do, without its blind spot (any face anywhere continued a lone track).
5. Unmatched detections start tracks, largest first, and each asks `claim` for its person (§7.4).
6. A track missing longer than `LOST_HOLD_MS` is dropped and its person `release`d. On the group path a track is matched only against the faces of calls whose view holds it, and missed only by those calls (§6.6).

### 7.4 Re-identification (K7)

`claim(box, aspect, now)` looks for an away person (and §7.3 item 4 for a held track) such that:

- the time since they were last seen is ≤ `REID_GRACE_MS` = 4000 ms (the 1 s hold included), on the session clock (§7.5);
- the new box centre is within `REID_DIST` = 1.5 × their last box width of their last centre (frame pixels: x scaled by the aspect);
- the new box width is within ×`REID_SIZE` = 1.5 of their last;
- no other candidate passing the gates is within `REID_AMBIGUITY` = 1.25 × the best distance (then nobody is claimed).

The nearest such person is claimed (removed from the pool); else a new person (原圖). A face entering where a person left, within 4 s and at a similar size, therefore takes their settings: this is the behaviour U5 asked for ("coming back from nearby within a few seconds still counts as the same person"), and the residual risk is §14 R3.

### 7.5 The session clock (K8)

- The away pool ages on live camera time: `pause(now)` when the loop pauses or stops (`live.ts:246-253`, `stop`), `resume(now)` on the next live frame shifts every `lastSeen` by the paused span, as A5 does for a tracker that cannot answer (`faceTracks.ts:81-87`). Review, the editor, 相機已暫停 and a lost engine therefore cost no grace.
- A paused span longer than `LIVE_IDLE_MAX_MS` = 60 s clears the pool and the remembered selection (`resume` does it).
- On loop stop and pause, every track is released into the pool with its last box (today they are dropped, `live.ts:236, 249`), so 重拍 and 恢復相機 re-identify the people in place.
- Null answers keep their A5 behaviour (no aging, no drop).
- A flip, ✕ and a reload end the session (`endCameraSession`): the scene is another one.

### 7.6 Selection and identity

- `selection: 'auto' | LivePersonId`; `target()` = the pinned person if in view (found or held), else the auto person, else null (no face shown).
- The first edit with `selection === 'auto'` pins the auto person (K9).
- A pinned person whose track is dropped: the selection returns to auto and remembers the person (`returnTo`); if they are claimed again before a tap, an edit or the pool clearing, the selection returns to them.
- 全部套用's lead is the target at the moment it was turned on; it does not move while on.
- `LiveStats.gpLeftOnLeft` (`live.ts:299-301`) follows the target's track (today the beautified one), so the 左／右 chips stay right for the person being edited.

---

## 8. Rendering

- `liveFrame(views, anyFace, photo, persons)` (`live.ts:91-102`): every view with `weight > 0 || presence > 0`, in the order of §6.3, each as `{face, weight, person: persons.params(v.person) ?? neutral, protect: null, presence}`. The weight easer's target becomes `present && edited(person)` (`faceTracks.ts:201`); the presence easer is unchanged (the caps, S A3).
- Untouched faces are listed at weight 0: they bound their neighbours' caps (with presence, so a face entering never pops a neighbour's warp) and write 0 into the skin mask, and they start no pass: `planFrame` runs the mask, makeup and reshape passes only for faces at weight > 0 (`pipeline.ts:203-231`). With nobody edited, the plan is the composite pass with the photo look, the plan of a v0.5 frame at 原圖 (A3). Listing them as `obstacles` instead (`types.ts:604-605`) was rejected: obstacles carry no presence, so a cap would jump in one frame.
- `globalSkin`: `{ambient smooth, rosy, weight: 1 − anyFace}` (`live.ts:99`); the ambient person is 原圖 except in 基本模式 (§3.6), so with a tracker no global skin is ever drawn.
- Per-person params go through the existing N-face path (the face table in a UBO, `limits.ts:204-210`; per-face makeup and caps), the path the editor runs at 10 faces (S §6.7: reshape 4.3–6.0 ms at 2048 on the desktop GPU); camera frames are smaller (tier H ≤ the 1080p stream).
- 按住對比 is unchanged (`renderOriginal`, `live.ts:220`).

---

## 9. Persistence

- **`meiyan.look.v1` today** (`settings.ts:47-78`): `{photo: PhotoParams, person: PersonParams}`. `photo` holds the photo items (美白, 銳化, 濾鏡強度, 長腿 and the twelve 調節 values), `filterId`, `look` (質感), the preset link and the rest of `PhotoParams` (neutral geometry, no spots, no strokes: the camera has none, `settings.ts:49-56`); `person` holds the one camera person look (磨皮, 紅潤, 美型, 美妝, shades, 左右分開, preset). Written debounced 300 ms by `setLook` and flushed on `visibilitychange: hidden` and `pagehide` (`ui/state.ts:116-140`); migrated once from `meiyan.params.v1` (`settings.ts:66-74`).
- **From 0.6.0** (K15): `photo` is read and written as today; `person` is no longer read, and every save writes it as `neutralPerson()`. `AppState.look.person` stays neutral; `cameraEdit` (`edit/state.ts:114-116`) builds the panel's edit from `look.photo` and the target's params. A 0.5 user's saved person look is therefore not applied after the update (release note, §13): it is a per-person setting, and K4 keeps those in the session.
- **Session-only** (§3.11): persons, params, selection, the away pool, the ambient person, `cameraAll`.
- New UI flags: `meiyan.hint.camPersons.v1` (§3.1), and for 合照模式 (K22, §3.13) `meiyan.hint.groupModeOn.v1` (its first-on toast) and `meiyan.hint.groupMode.v1` (its hint). 合照模式 itself is a camera setting: the field `groupMode` in `meiyan.prefs.v1` (`Prefs`; `sanitizePrefs` keeps a boolean, else off, so prefs saved by 0.5 or by the first 0.6.0 build open with it off), written with the other prefs by `setPrefs` and kept across launches. No key is renamed or removed; `hasSavedSettings` (`settings.ts`) is unchanged. The e2e knob `meiyan.debug.live.v1` is no longer read (K22).
- A rollback to 0.5 reads `meiyan.look.v1` as before: faces start at 原圖 (the neutral `person`) unless 0.6 never saved the look.

---

## 10. Performance budgets, thresholds and fallbacks

Defaults ship until the iPhone rows exist (RM §12). Each row is applied to the slowest iPhone measured; a change is one line in `limits.ts`, committed with the numbers (S §6.4).

The rows marked **desktop gate** are different: they decide K17 before the push, on the workspace desktop (§6.1's machine) and in CI. When one fails, the plan first tries the fixes the row names. If it still fails, `LIVE_GROUP = false` ships (option C), the floors of the fallback go in the release notes, and §16 says which gate failed and by how much. An iPhone measurement is not a push gate (builder check). iPhone numbers need the preview deploy, which comes after the push the user asked for (U7), so §16 asks the user to try an upright group shot on the phone. (PGN failed, and the user settled what follows with K22: no single path for everyone; the group path behind 合照模式, off by default. The rows below keep the gate wording they were judged by.)

| ID | Measured (bench, §12.4) | Keep the default if | Fallback |
|---|---|---|---|
| PL2 | Front camera solo path, one face: p50 at `numFaces` 10 minus p50 at 1 | ≤ 5 ms (desktop: 3.3 GPU, 1.6 CPU) | As S §6.3: `MAX_LIVE_FACES = 1` (v0.3 camera, per-person off) |
| PGR | **Desktop gate.** Recall: on each upright fixture (§12.3: `upright_row3`, `upright_far10`, `selfie_group` on the front camera), every face found, with its box hit-testing to itself, within 2 s of the first live frame; CPU delegate in CI, GPU on the desktop | 3 of 3 runs per fixture and delegate | Within the plan: tile size (`DETECTOR_FLOOR` margin), the schedule. Then `LIVE_GROUP = false` |
| PGN | **Desktop gate.** Row LF on `upright_far10` (10 faces at 3–4 %), desktop GPU and CPU: preview fps (average), each face's refresh rate, the longest frame | ≥ 24 fps average, every face ≥ 5 Hz, longest frame no longer than option C's at 10 faces on the same machine (row LF run with `LIVE_GROUP = false` on `group10.y4m`) | Within the plan: `LIVE_SCAN_EVERY`, cadence constants. Then `LIVE_GROUP = false` |
| PJ1G | **Desktop gate.** Jitter and lag (S rows J, J2) on the group path: a still face refreshed by the whole view, and one refreshed by a tile | S §6.3's limits | Within the plan: a group-path smoother constant (`ONE_EURO_GROUP`, minCutoff and beta). Then `LIVE_GROUP = false` |
| PGS | The front camera's move between its paths (§6.6): the longest frame around the rebuild, desktop GPU | ≤ 250 ms (the measured rebuilds are 125–240 ms) | No line: report it, and in §16 if over |
| PLB | Back camera, one face, group path: the whole-view call's p50 + the live render | ≤ 33 ms (desktop: about 18.6–20 + R, §6.1's full-range rows) | `LIVE_DETECTOR.environment = 'camera'` (short-range tiles, sized for its floor) |
| PLN | Back camera, 10 far faces (`upright_far10.y4m`, or the same layout on a second screen): row LF's preview fps and per-face refresh rate, on the iPhone | ≥ 24 fps average and ≥ 5 Hz | No `limits.ts` line: the user's call with the number (the cap of all faces is theirs, U1): (a) off-main-thread detection (§6.2 F, its own spec), (b) `MAX_LIVE_FACES = 6` |
| PJ1, PJ2 | Jitter and lag (S rows J, J2) on the solo path at `numFaces` 10 | S §6.3's limits | S §6.3's (minCutoff, beta; then `MAX_LIVE_FACES = 1`) |
| PWB | First back-camera frame after a flip, cold (`warm('IMAGE', 'photo')` hides the compile) | ≤ 300 ms after `live` | No line: report; the warm-up moved the compile into the flip, the alternative is the hitch on the first frame |
| PM1c | Kill test (S §6.3 PM1) with the back camera open (the photo bundle in IMAGE mode, the editor's graph: the after-a-photo heap, 45.3 MB GPU / 54.3 MB CPU, S §6.5) | 3 of 3 | `LIVE_DETECTOR.environment = 'camera'` |
| PB | Matching + re-id + smoother, 10 faces, unit bench | ≤ 1 ms per detection (desktop Node) | Profile; no limit changes |

PL2F (the first draft's full-range front solo path) is dropped: the front camera's group scenes reach back rows through tiles (K17, K18), and the solo path stays on short-range (A1).

**Outcomes on the desktop (2026-10-22, the plan's Task 16; every number in §6.1's plan measurements):**

| ID | Outcome |
|---|---|
| PGR | **Pass.** Every E4 group-path test 3 of 3 per fixture (`upright_row3`, `upright_far10`, `selfie_group`) on CPU and on the GPU |
| PGN | **Fail**, on both delegates and in every run. GPU: 19.8 fps (limit 24), slowest face 1.2 Hz (limit 5), longest frame 250.2 ms against option C's 166.8 ms. CPU: 21.2 fps, 2.4 Hz, 216.9 ms against 150.1 ms. The fixes this row allows, one at a time: `LIVE_SCAN_EVERY` 8 (21.6 / 21.4 fps, 1.3 / 2.4 Hz, 267.1 / 200.2 ms) and the cadence cap `LIVE_MAX_DETECT_EVERY` 12 (21.7 / 20.7 fps, 0.7 / 1.2 Hz, 322.9 / 383.8 ms): still failing. So the group path does not run by default: the build of 2026-10-22 shipped `LIVE_GROUP = false` (K17's fallback, §16 item 1), and the user then chose 合照模式 (K22): off by default, the group path while on, at these numbers |
| PJ1G | **Pass.** Jitter, a still face (`tile_face.y4m`): the whole view and the tile `t1,0` passed 3 of 3 on the GPU and the CPU tile 3 of 3; the CPU whole view passed 2 of 3, and its failing run was just over the limit (0.4 px shown rounded, MediaPipe 0.2). Lag (`group_pan.y4m`): 3.8–6.0 ms against MediaPipe's 11.1–18.6 ms |
| PLB | **Pass.** 23.3 ms GPU, 22.6 ms CPU (limit 33). Read from row LF (the whole-view call's p50 plus the render's), since PLB needs the live render, which row L does not run |
| PGS | 183.5 ms GPU, 50.2 ms CPU (under 250) |
| PWB | Group path: 74.5 / 70.1 ms GPU cold (two runs), 55.1 / 32.8 ms CPU. Option C, as shipped: 73.0 ms GPU, 37.7 ms CPU. All under 300; the cold compile (1.1–1.2 s) ran in `warm`, behind the spinner |
| PL2 | Not a desktop gate. **GPU: fail, pass 1 of 5 runs** (Δp50 4.3 ms on the pass, 5.2 ms on the last quiet run, 5.1–7.3 ms on the others; limit 5); **CPU: pass 5 of 5** (2.0–5.0 ms). A1 holds: numFaces 10 against v0.5's 3 is −0.7 to +1.2 ms on the GPU and −0.1 to +0.8 ms on the CPU. The excess is numFaces 3's own cost over 1 (3.9–6.6 ms on the GPU), which v0.5 shipped with. No limit changed here: the fallback (`MAX_LIVE_FACES = 1`) waits for the iPhone row |
| PB | **Pass.** 0.38–0.41 ms per detection (0.51 in the first run; limit 1) |

**The trade 合照模式 makes (K22), from these desktop numbers.** *Off* (the default): the front camera's solo selfie is v0.5's path (PL2 above, A1); the back camera runs option C: ten faces at 9–13 % (`group10`) 22.3 / 21.8 fps, the slowest face 3.8 / 3.7 Hz, a longest frame of 166.8 / 150.1 ms (row LFC, GPU / CPU), and **0** of `upright_far10`'s ten 3–4 % faces (E4); faces from about 9 % (back) and 12 % (front) of the long edge. *On*: every face of the three upright fixtures found within 2 s on both delegates (PGR), jitter and lag within S's limits (PJ1G), and ten 3–4 % faces at 19.8 / 21.2 fps, the slowest face refreshed 1.2 / 2.4 times a second and a longest frame of 250.2 / 216.9 ms (PGN, the failed gate: that is the less smooth preview the toggle's toast names); a lone face runs the group path too, 23.3 / 22.6 ms per frame on the back camera (PLB) and a whole-view call of 18.3 / 22.1 ms p50 on the front (row L), inside the 33 ms frame but not v0.5's selfie path; PWB's group-path flip 74.5 / 55.1 ms. Each toggle: one rebuild on a live frame (the front camera's move, PGS: 183.5 / 50.2 ms; the back camera's not measured). So with the mode off the release is what PL2, PB, LFC and PWB's third run describe, and with it on what PGR, PGN, PJ1G, PLB, PGS and PWB's first two runs describe. The e2e of K22 (CPU, SwiftShader, `camera-groups.spec.ts`): turned on mid-stream, the ten far faces were all found 290 and 393 ms after the tap on the back camera (two runs), and the selfie's five 622 and 839 ms after it on the front. The iPhone rows (PLN, PM1c, and PL2 / PJ1 / PJ2 on the phone) need the preview deploy after the push and were not measured (RM §12; §16's closing paragraph).

---

## 11. Edge cases

| Case | Behaviour |
|---|---|
| Lone selfie, brisk pan or blink | Held 1 s, predicted, continued by the gates (§7.3 item 4); weight eases out and in as v0.5 |
| Two people swap places | Tracks follow (IoU on predicted boxes); one passing behind the other is held and re-matched on the far side (§7.2) |
| A hand or a passer-by covers a face ≤ 4 s | Held, then away; re-identified when uncovered (§7.4) |
| Someone steps in front, much larger | The size gate refuses the match (§7.3 item 3): a new person at 原圖; the covered person is held, then away |
| A leaves, B enters at A's place within 4 s, similar size | B takes A's settings (U5's grace; §14 R3) |
| Two people leave, one returns between their spots | Both pass the gates at similar distances → ambiguity → a new person at 原圖 |
| More than 10 people | 10 tracked (MediaPipe's choice); the others are neither found nor tappable; no notice |
| Faces below K17's floor | Tracked and tappable when a tile's detection happens to find them; not guaranteed (§2.2) |
| 合照模式 toggled mid-stream (either camera) | The other path from the next frame (K22, §6.6): one rebuild frame (PGS); the tracks carry over, nobody's params change, the selection and 全部套用 stay |
| 合照模式 off, a second face appears in a selfie | The solo path stays (K22); the one-time hint 「開啟合照模式，遠處的人也能點選」 (§3.13) |
| Front camera, 合照模式 off: only far people behind the user | Not found under about 12 % of the long edge; found with 合照模式 on (down to 5 %), or on the back camera with it on |
| A small face moving across tiles | Refreshed by whichever call's view holds it whole (the tiles overlap by more than any small face); missed only when its own view finds nothing (§6.6) |
| A back-camera face overflowing the frame | Full-range misses it (§6.1), and the group path's IMAGE calls keep no VIDEO tracking to hold it: not tracked (R9) |
| The detector download not in yet on the back camera | Short-range for that stream (合照模式 on: its tiles, sized for its floor; off: one short-range VIDEO pass), §6.3; full-range from the next flip |
| A drag while its person leaves | Writes go on to that person (§3.2) |
| No face shown | Person items disabled (§3.6); photo items work |
| 全部套用 on, someone new enters | They receive the shared params (§3.4) |
| 全部套用 on, a tap on a face | Off; that face selected; nobody reverts |
| Flip front ↔ back | Session ends: everyone 原圖, 全部套用 off; the new facing's path and detector, warmed behind the spinner (§6.3) |
| Ratio change | Nothing about persons changes (boxes are in video UV) |
| Resolution change (stream renegotiated) | `resetSession`: tracks released to the pool and re-identified (video UV is resolution-free) |
| Interrupted (相機已暫停) ≤ 60 s, resumed | Paused clock: re-identified in place |
| Review ≤ 60 s → 重拍 | Same; > 60 s → everyone out of view forgotten |
| Tracker lost / rebuild throttled | A5: no aging, no drop, selection kept |
| Engine context lost | The loop pauses (`live.ts:156-159`): tracks released, clock paused |
| Shutter under cadence / tier L | Forced detection on the captured frame (K13); on the group path, every refresh view of the cycle (§6.6) |
| A camera person smaller than the editor's one-pass floor | Found by the zoomed retry (K21, §5.4); dropped with the toast only if that misses too |
| Capture with a person held (missing) | Drawn at its eased weight and last landmarks, as v0.5; handed over if edited |
| Mirrored save | Boxes mirrored, 左右分開 swapped (§3.8) |
| A camera person cut off by the ratio crop | Its box lies partly outside the photo; the editor may not find it → retry → else dropped with the toast |
| Editor detection waits (detector download ≤ 3 s) and the user edits meanwhile | Those edits go to `p0` → the primary keeps them; others get their camera params (§5.4 item 2) |
| Editor finds no face | Nobody gets camera params; the photo look stays; toast with n |
| 基本模式 shot → 編輯 | `p0` = the ambient person (all skin), as the capture |
| 編輯 → back to the camera ≤ 60 s | The session is still there: people re-identified where they stand |
| Rollback to 0.5 | §9 |

---

## 12. Testing

Every fixture is synthesized from repo-owned images (`sample_face.png` and the group fixtures `scripts/gen-group-fixture.mjs` builds from it, LICENSES/NOTICE.txt). **Never** the user's private group photo or anything derived from it.

### 12.1 Unit (Vitest)

- `livePersons.test.ts` (new): claim/release; every gate of §7.4 at its boundary (3999 / 4001 ms, 1.49 / 1.51 widths, ×1.49 / ×1.51, ambiguity 1.24 / 1.26); the pool cap and eviction; `write` with neutral params clears `edited`; the session clock (pause/resume shift, > 60 s clears pool and `returnTo`); selection: auto, first-edit pin, tap pin, `returnTo` restore and its cancel by a tap or an edit; 全部套用 copy on, join, write-all, off without revert; `clear`.
- `faceTracks.test.ts`: velocity prediction and its one-width clamp; a synthetic swap with a 300 ms occlusion keeps both persons; the size gate; held-track continuation replaces the one-track rule (a lone track continued across a 0.8-width jump within the gates, not across the frame); 10 tracks and early eviction of the oldest held track; release on drop and on `reset`; the existing dedupe, A5 and A7 tests keep passing.
- `liveCore.test.ts`: the cadence function at the §6.4 examples (k = 1 at one face whatever D; 5 and 6 at the desktop numbers; T_min with a slow camera); the hysteresis; tier L doubling; the amortized auto-tier sample.
- `live.test.ts`: `liveFrame` per person (weights, neutral at weight 0, order and cut at 10, ambient only in 基本模式); the detector fixed per stream session; capture's forced detection and its `persons`; pause/stop release into the pool; one face → detection on every frame (A1).
- `tracker.test.ts`: `detectVideo` with `detector: 'photo'` switches the bundle in VIDEO once; `warm(mode, detector)` for both modes; `detectImage` takes an `OffscreenCanvas`; a replacement returns to the camera bundle and the next call switches back.
- `liveViews.test.ts` (new, §6.6): the tile grid per facing, detector, ratio and stream size (the §6.6 counts on 1080 × 1920; the e2e's 1280 × 720), neighbours overlapping by at least `DETECTOR_FLOOR` × the crop's long edge, tiles inside the crop; large / small assignment at the 1.25 boundary and a small track's tile (holds it whole, nearest centre); the schedule (the whole view in every cycle, a scan every 4th call in raster order skipping refresh views, no scans at 10 tracks); view → UV mapping of x, y and z; a track missed only by a call whose view holds it whole, and neither missed nor aged by others.
- `live.test.ts` (group path, K22): `liveRoute` by mode and facing; with 合照模式 on the back camera starts on the group path and so does the front camera (one face included, and it stays there); with it off option C runs on both facings, a second face never moves the front camera, and one face detects every frame on the solo path (A1); toggling mid-stream on either facing moves the path on the next frame both ways and keeps every track's person, the edited person's params, the untouched person 原圖 and the selection; the capture's forced detection runs every refresh view of the cycle.
- `migrate.test.ts`: `handOverEdit`; `firstAnswer` with `handOver`: IoU match, padded-centre fallback, one to one, the primary from the seed, `p0` edited → the primary keeps `p0`, unmatched count, no-face answer, obstacles never matched, rebase over undo states.
- `persons.test.ts`: `matchHandOver` tie-breaks.
- `still.test.ts`: the zoomed retry runs once per missed hand-over box, on a crop of side `box width / 0.25` moved inside the image, maps its faces back (x, y, z), and joins the one holding the box's centre through `prepareWith`; a box over a quarter of the long edge and the faceSeed share one short-range pass; nothing runs when every seed is found; a seed missed by its retry is counted.
- `imaging.frame.test.ts`: `shotBox` crop and mirror, unclamped.
- `sides.test.ts`: `mirrorSides` swaps exactly the six split ids and is an involution (restored test).
- `settings.test.ts`: `loadLook` ignores `person`; `saveLook` writes it neutral; `groupMode` (K22) is off by default, off for prefs saved without it and for a wrongly typed value, and round-trips; its two flags are true once per install, the hint never after the first turn-on, both false where storage drops writes.
- `groupMode.test.ts` (new, K22): the copy; a tap flips the mode, the first turn-on returns the toast once, turning it off none; the ≥ 2-faces hints in order (the tap hint, then the 合照模式 hint only with the mode off); `warmsOnStart`.
- `panelModel.test.ts` / `lens.test.ts`: the camera's ≥ 2-faces labels and aria (§3.2); ⊘ with ≥ 2 faces leaves photo items, under 全部套用 resets them.
- A bookkeeping benchmark (PB): 10 faces, 1000 detections, ≤ 1 ms each on the desktop.

### 12.2 E2E (Playwright, Chromium)

New Playwright projects, one per clip (as `chromium-group`, `playwright.config.ts:51-64`). The 10-face tests and the upright group tests set `meiyan.prefs.v1 {delegate: 'CPU'}` in an init script (SwiftShader's GPU path would run 10 landmark inferences far slower).

- **E1 fresh camera = original** (`camera-persons.spec.ts`, `group.y4m`, whose frames are identical): three faces shown, nothing set: `__meiyan.passes` is composite only; the preview grabbed with and without 按住對比 differs by MAD ≤ 0.5 (both are WebGL renders of the same frame); the capture against the frame handed to 編輯 (the `original.spec.ts:156-230` harness) differs by no more than the build measures for that pair at 原圖 (a WebGL upload against a 2D-canvas copy of the video; recorded in the test, expected ≤ 1).
- **E2 per person** (same file): tap B, 自然 + 大眼; tap C: B's region still differs from 按住對比 (regionDiff > 0.5), C's and A's do not; edit C; capture: Review shows B and C adjusted, A not; 編輯: the persons at B's and C's faces carry their params (their sliders read the camera values when selected), A's person is 原圖, the selected person is C; a shot with nothing set opens at 原圖 (export MAD 0, as `original.spec.ts`).
- **E3 全部套用** (same file): on copies the target's params to all three; a slider writes all three; a tap on A turns it off and selects A; nobody reverts.
- **E4 ordinary group shots, upright** (`camera-groups.spec.ts`, the upright clips of §12.3; gate PGR, K20). An init script asks `getUserMedia` for 1080 × 1920, since Chrome's fake camera otherwise centre-crops a portrait clip to the request's aspect (§6.1). Back camera on `upright_row3` and `upright_far10`: `livePath` is `'group'`, `liveDetector` full-range, every face found within 2 s, every box hit-tests to itself and selects (debug `selected`), the preview keeps drawing (fps > 0). Front camera on `selfie_group`: `'group'` from the toggle on, all five faces within 2 s of it (until K22: `'solo'` until the second near face, then `'group'`). Front camera on `face.y4m`: `'solo'` throughout (A1). With 合照模式 off, `upright_far10` records how many faces option C finds, the number §16 and the release notes quote (2026-10-22: 0, in each of six runs, §6.1 plan measurements). Since K22 the group-path tests turn it on as the user does, a tap on 「合照模式」 (`fixtures.ts` `setGroupMode`), before the flip so PGR's 2 s count from the back camera's first frame; the option-C tests leave it off (the default). (Before K22 they asked through the e2e knob `meiyan.debug.live.v1 { group }`, now removed.)
- **E4c 合照模式** (`camera-groups.spec.ts`, K22): off (the default): on `upright_far10` the back camera shows only option C's faces (fewer than 10: 0, every box the VIDEO pass's), and on `selfie_group` the front camera stays on the solo path with its two near faces and shows the tap hint, then 「開啟合照模式，遠處的人也能點選」. On: the toggle is a button of at least 44 × 44 pt with `aria-pressed`; its first turn-on shows 「遠處的人也能點選，人多時預覽可能較不順」, a later one does not; turned on mid-stream, `upright_far10`'s ten faces are found and tappable on the back camera within 3 s of the tap and `selfie_group`'s five on the front within 2 s; on `upright_row3` with the middle person edited (一鍵 › 自然), turning it off and on again keeps every face's person and edited flag, the selection and the panel's preset; after a reload the camera opens with it on and runs the group path from its first frame.
- **E4b landscape regression** (`camera-back.spec.ts`, `group10.y4m`): flip to the back camera, faces reach 10 and hit-test to themselves (the cap, on the group path, 合照模式 on); with 合照模式 off, the first draft's E4 (full-range VIDEO, 10 faces, `liveEvery` > 1). (As built, a deviation recorded 2026-10-22: on the group path the test expects the faces inside the visible crop, 3 of the 10, not 10. The 3:4 crop of the 1280-wide frame shows x 370–910 only, and the group path tracks faces in view only, §6.6. Option C's test still expects all 10.)
- **E5 identity** (`camera-identity.spec.ts`, `group_move.y4m`): edit C; C leaves 1.5 s and returns near: same person id, still edited; B and C swap with an occlusion: each id follows its face; C leaves 6 s and returns: a new person, 原圖, B unchanged. The clip loops, so the test syncs on the face count and the debug ids, not on time.
- **Changed on purpose:** `camera-group.spec.ts` (every face renders its own params; 全部套用 copy semantics; `selected` follows persons); `original.spec.ts` (a shot with a camera look opens with it; nothing set still opens at 原圖; the reload test: the person part of `meiyan.look.v1` is not applied); `adjust.spec.ts`'s camera test (a shot with the camera's 調節 and 質感 set opens in 編輯 with them, U6, §3.8; added 2026-10-20); `camera.spec.ts` stays green (one face: unchanged).

### 12.3 Clips

Generated by `scripts/gen-y4m.mjs` in `tests/e2e/global-setup.ts` (gitignored, rebuilt when stale, `global-setup.ts:12-30`). `composeFitWidth` reads PNG only (`gen-y4m.mjs:182`); the generator gains a JPEG decode (as `gen-group-fixture.mjs` does through Chromium) or reads a PNG intermediate.

| Clip | From | Layout | Measured |
|---|---|---|---|
| `group10.y4m` | `ten_faces.jpg` | `composeFitWidth`: 1280 × 720, faces 9–13 % of the width, 30 static frames. Cells 1.3 face widths wide: tighter and larger than ordinary group shots, so a landscape regression only (K20) | short-range 2–3 faces, full-range 10 (§6.1) |
| `upright_row3.y4m` | `sample_face.png` cells (as `gen-group-fixture.mjs` builds them) | 1080 × 1920, 8 static frames: three faces at 6.5 % of the long edge (125 px) in a row across the width at mid-height, centres 2.7 face widths apart (shoulder to shoulder), seeded random sub-pixel offsets (§6.1, the anchor grid) | the builder check's case; to measure when built: one full-range pass over the frame expected to miss them. Measured (the plan's Task 14, 2026-10-20): option C's full-range VIDEO pass found all three; the group path finds them too |
| `upright_far10.y4m` | as above | 1080 × 1920, 8 static frames: ten faces at 3–4 % (58–77 px) in two rows of five, centres 2.7 face widths apart, rows 1.6 face heights apart, seeded offsets | a back-camera group about 3 m away; gates PGR and PGN. Measured (2026-10-22): the group path 10 of 10, its whole view alone 10 of 10 (Task 14); option C 0 |
| `selfie_group.y4m` | as above | 1080 × 1920, 8 static frames: two faces at 14 % and 16 % side by side in the lower half, three at 6–8 % in a row behind them, centres 2.7 widths apart within a row, seeded offsets | a group selfie: the solo path finds the two near faces, the group path the back row |

The upright clips are about 25 MB each at 1080 × 1920 (gitignored, rebuilt when stale). If CI time or disk demands it, 720 × 1280 keeps every fraction (faces then 38 px and up).
| `group_move.y4m` | `group_faces.png` (A, B, C tiles, `composeGroupCam`) | 640 × 360, 16 s at 30 fps, ±0.5 px noise per frame: 0–3 s still; 3–4.5 s C removed; 4.5–7 s C back, +0.2 face widths; 7–8.5 s B and C swap at 1 FW/s, C passing behind B (fully hidden ~0.3 s); 8.5–10 s still; 10–16 s C removed (6 s > the grace). **As built (a deviation recorded 2026-10-22): 18 s, returning to its first frame** (`gen-y4m.mjs` `moveAt`): 0–2 s still; 2–3.5 s C away; 3.5–5.5 s C back at +0.2 of its face width; 5.5–7 s B and C swap (about 1.1 C face widths a second, C behind B, hidden about 0.3 s); 7–8.5 s still; 8.5–10 s they swap back; 10–11 s still; 11–16.5 s C away (5.5 s, over the grace); 16.5–18 s still. The 16 s clip ended with B where C starts, so its loop seam would hand B's track to C | three faces found in the still phases on CPU and SwiftShader (E5, the plan's Task 14) |
| `tile_face.y4m` | `sample_face.png` | **Added (a deviation recorded 2026-10-22: row JG's still clip, a clip of its own):** 1280 × 720, 60 frames: one face at 14 % of the long edge (179 px), over short-range's floor and whole in one tile of the back camera's layout for either detector (full-range `t1,0`, short-range `t2,1`), seeded sub-pixel shifts and ±2 levels of noise per frame (as `group_noise.y4m`). `gen-y4m.mjs --layout tile_face`, gitignored, made by no setup. On `group_noise.y4m` no tile holds the face that MediaPipe's numFaces-1 graph follows, so the tile kind of PJ1G got no frames there | PJ1G's jitter, whole view and tile (§6.1 plan measurements: 24–54 frames per kind) |

### 12.4 Bench rows (`src/bench/multiFace.ts`, `bench/report.ts`)

- **L** extended: counts 1, 3 and 10 × detectors camera and photo × delegates GPU and CPU (`rowL`, `multiFace.ts:574-655`), with the verdict PL2; plus the group path's call p50 per view kind (the whole view, a tile) for both detectors and delegates, with the verdict PLB.
- **LF** (new): the live loop as the app runs it (the same tracker, the path, the cadence, every shown face edited with 磨皮, 大眼, 瘦臉 and 口紅) for 10 s: preview fps, the longest frame and the max gap between presented frames, k, each face's refresh rate, `liveViews`. Desktop: `node scripts/bench-multiface.mjs --video tests/fixtures/upright_far10.y4m LF` (gate PGN), and on `group10.y4m` with the group path off (row LFC, PGN's comparison); phone: the `upright_far10` layout on a second screen, back camera, phone upright. Gives PGN and PLN.
- **GS** (new): the front camera's move between its paths on `selfie_group.y4m`: the longest frame around each rebuild (PGS). Measured on K18's move (2026-10-22); since K22 the bench runs one loop with 合照模式 off for 2 s, then on, the toggle's move.
- **WB** (new): the first live frame after a flip to the back camera, cold and warm (PWB).
- The `@bench` e2e of `camera-group.spec.ts:103` adds a 10-face variant on `group10.y4m`. (As built, a deviation recorded 2026-10-22: the variant runs on `upright_far10.y4m`, in `camera-groups.spec.ts`, tagged `@far10 @bench`. On the group path `group10`'s 3:4 crop shows only 3 of its 10 faces, see E4b.)
- **JG** (as built): jitter on `tile_face.y4m` (§12.3), lag on `group_pan.y4m`; **LFC**: row LF with `group: false` on `group10.y4m`, the option-C comparison above.

---

## 13. Files

| File | Change |
|---|---|
| `src/config/limits.ts` | `MAX_LIVE_FACES` 10; `LIVE_DETECTOR`; `REID_GRACE_MS`, `REID_DIST`, `REID_SIZE`, `REID_AMBIGUITY`, `TRACK_SIZE_JUMP`, `LIVE_IDLE_MAX_MS`, `LIVE_MIN_FPS`, `LIVE_MAX_DETECT_EVERY`; the group path's `LIVE_FACE_FLOOR`, `DETECTOR_FLOOR`, `LIVE_SCAN_EVERY`, `LIVE_VIEW_MAX_EDGE` (`LIVE_GROUP` and `LIVE_SOLO_AFTER_MS` were built and are removed by K22) (and `ONE_EURO_GROUP` if PJ1G needs it); `HANDOVER_ZOOM_FACE` (doc comments cite §6.1, §6.6) |
| `src/app/liveViews.ts` (new, pure) | §6.6: the views of a crop, assignment, the schedule, view → UV mapping |
| `src/app/livePersons.ts` (new) | §5.1, §7.4–7.6 |
| `src/app/faceTracks.ts` | §5.2, §7.2–7.3; `cameraTapAction` reads pinned person selection |
| `src/app/liveCore.ts` | cadence, amortized auto-tier sample |
| `src/app/live.ts` | `LiveDeps.persons`, `getPhoto`; detector per stream session; the solo and group paths and the moves between them (§6.6); the view copies; cadence; `liveFrame`; capture `persons` and forced detection; release on pause/stop; stats and debug |
| `src/tracking/tracker.ts`, `src/types.ts`, `src/app/debug.ts` | `detectVideo` `detector`; `detectImage` takes `OffscreenCanvas`; `warm(mode, detector)`; `CameraHandOver`; `DebugState`: `boxes[]` gain `person` (`c{n}`), `edited` and `view`; `selected` stays the target's track id (`t{n}`), `'all'` under 全部套用, null with no face shown (as `live.ts:319-324`); new `liveEvery` (k), `liveDetector` (`'short-range'` / `'full-range'`), `livePath` and `liveViews` |
| `src/ui/cameraSession.ts` (new) | the session instance, `endCameraSession` |
| `src/ui/screens/Camera.tsx` | lens over the target; writes with the drag-start target; 全部套用 copy; no-face note; hint; flip/start warm-up; `Shot.handOver`; session end on ✕ and flip; the 「合照模式」 chip and its toasts (K22) |
| `src/ui/groupMode.ts` (new, pure) | K22: the toggle's copy, `toggleGroupMode`, `groupSceneHints`, `warmsOnStart` |
| `src/ui/components/CameraFaceMarker.tsx` | brackets per face (node per track id, styles written on change), dot on the target, dimming |
| `src/ui/screens/Review.tsx`, `src/ui/state.ts`, `src/ui/flows.ts`, `src/ui/imaging.ts` | §5.3 |
| `src/edit/migrate.ts`, `src/detect/persons.ts`, `src/app/still.ts`, `src/ui/screens/Editor.tsx` | §5.4 (the zoomed retry, K21); the toast |
| `src/edit/sides.ts` | `mirrorSides` restored |
| `src/edit/lens.ts`, `src/ui/panelModel.ts`, `src/edit/state.ts` | camera ≥ 2-faces labels and ⊘ (a `LensOptions` flag); `cameraEdit(photo, person)` |
| `src/store/settings.ts`, `src/types.ts` | §9; `Prefs.groupMode` and the 合照模式 flags (K22) |
| `src/bench/multiFace.ts`, `src/bench/report.ts`, `scripts/gen-y4m.mjs`, `tests/e2e/global-setup.ts`, `playwright.config.ts` | §12, including the upright clips and their projects (`camera-groups.spec.ts`) |
| `docs/superpowers/specs/2026-10-12-v04-roadmap.md` | §2.4 and §3.7 point here; §15 release notes 0.6.0 (zh + en), including: 0.5's saved camera person look is no longer applied; group shots held upright find faces down to K17's floors (or, if `LIVE_GROUP = false` shipped, the fallback's floors, stated plainly); the front camera's solo selfie path is unchanged; far people behind a solo selfie are found once someone nearer joins (K18). Since K22: 合照模式, what each state finds and what it trades |
| `docs/superpowers/specs/2026-10-12-face-person-select-design.md` | §0.1 camera row, §1.2 and §2.5 note the supersession |
| `package.json` | 0.6.0 |

---

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The iPhone's per-face landmark cost makes 10-face previews judder (desktop: one VIDEO call at 10 faces 64 / 82 ms; the group path spreads it over its views, about 32 ms per call, §6.4) | The cadence keeps the average ≥ 24 fps; PLN measures it and hands the user the choice (Worker or a lower cap) |
| R2 | Front-camera group selfies miss back rows under ~12 % of the long edge (the builder check: about 6–10 % upright) | 合照模式 on: the group path's tiles from the first frame (K17, K22). Off (the default): back rows under ~12 % are not found, and the one-time hint points to the toggle (§3.13) |
| R3 | Someone entering where a person left within 4 s takes their settings (the U5 grace, no recognition) | Size gate, ambiguity refusal, the short grace; documented in the release notes |
| R4 | MediaPipe's ROI drifting from one face to an adjacent one during overlap | Matching is geometric on our side (predicted boxes, size gate); a drift that lands on another face's predicted box goes to that face's track |
| R5 | The full-range compile (1.1–1.3 s desktop GPU) on the first back-camera use | Warm-up during the flip's stream start (§6.3); PWB |
| R6 | Memory with the photo bundle in VIDEO on SE-class phones | PM1c; fallback to short-range on the back camera |
| R7 | The editor's re-detected landmarks differ slightly from the camera's, so the editor's first render is not pixel-identical to the capture | Same params, same engine; the e2e asserts regions, not pixels |
| R8 | 0.5 selfie users lose their saved camera face look on update (K4, K15) | Release note; the photo look (濾鏡, 調節, 質感, 美白, 銳化) is kept |
| R9 | Back-camera close-ups that overflow the frame are not acquired, and on the group path no VIDEO tracking holds one found earlier | Measured (§6.1); documented; rare on the back camera (a face filling the frame is a selfie's case, and the front camera's solo path keeps short-range VIDEO) |
| R10 | IMAGE landmarks on the group path jitter more than VIDEO's landmark-based tracking | PJ1G, a group-path smoother constant (§10): passed with none |
| R11 | The group path does not hold its desktop gates, and U1 is narrowed after all | The fallback is option C, built and tested; the release notes give the floors, §16 tells the user, who decides the next step (a Worker, §6.2 F, or accepting the floors). **Happened** (PGN, §10). The user chose 合照模式 (K22): U1 holds for upright group shots with it on, at PGN's smoothness; off, option C's floors. A Worker (§6.2 F) remains the way to make the on state smooth |
| R12 | A toggle of 合照模式 shows one 125–240 ms hitch (the mode switch on a live frame); until K22, the front camera's automatic move on a second face did | Once per tap, at the user's own choice; PGS measured the front camera's move at 183.5 ms GPU, 50.2 ms CPU |

## 15. Open questions

None that blocks the build. Every point the user did not decide is a Claude's call in §0.2, made from their stated rules (U1–U6) and the anti-goals. K17 and K18 change what gets built and only the user could have settled them; U7 said not to stop, so they were decided with the default closest to what the user said and are listed for the user in §16. The later decisions are the user's with the numbers, as PD3 and PC1 were in S §6.3: PLN's (§10) with the iPhone rows, and, if a desktop gate fails, what follows the fallback (R11). PGN failed, and the user settled K17 with K22 on 2026-10-22 (a 「合照模式」 toggle), which also replaces K18.

## 16. 待使用者確認的決定

你說「開始寫」不必停下來問，所以下面這幾件只有你能決定的事，我先選了最接近你說法的做法，照著做下去。不同意的話告訴我，就改。

1. **「所有人的臉都要可以點選」也包含一般距離的合照（K17）**
   - **我的決定：** 不縮小這個要求。手機直立拍時，後鏡頭要找得到約畫面長邊 3% 的臉（大約 3 公尺遠），前鏡頭合照要找得到後排約 5% 的臉（大約 2 公尺），最多 10 人。
   - **為什麼：** 原本的設計只把整個畫面偵測一次。直立拍時，後鏡頭只找得到約長邊 9% 以上的臉，前鏡頭約 12% 以上。三個人肩並肩、後鏡頭 2–3 公尺的一般合照、自拍的後排，大多點不到。
   - **怎麼做：** 拍合照時把畫面分成幾塊放大來找臉（合照偵測），預覽仍保持順暢。人多時臉部效果更新會慢一點，這是你之前已經同意的。
   - **代價：** 工作量比原本多一大塊。預覽裡的臉部效果可能比原本的做法稍微抖一點、跟得慢一點，這些都會量測並設門檻。
   - **達不到門檻時：** 如果桌機上的找臉、流暢度、抖動任何一項沒過，就退回原本只偵測一次的做法，發布說明寫清楚多小的臉找得到，並在這一節記下沒過的門檻和數字。下一步由你決定，例如把偵測移到背景執行緒（另一個專案），或接受這個限制。
   - **你若只需要近距離合照：** 跟我說一聲，就改回只偵測一次的做法，工作量小很多。
   - **桌機量測結果（2026-10-22）：流暢度（PGN）沒過，所以這一版退回只偵測一次的做法（`LIVE_GROUP = false`）。**
     - 沒過的門檻：後鏡頭 10 個小臉（各約長邊 3–4%）時，預覽平均每秒 19.8 格（GPU）、21.2 格（CPU），門檻 24 格；最慢的那張臉每秒只更新 1.2 次（GPU）、2.4 次（CPU），門檻 5 次；最長的一格卡 250 毫秒（GPU）、217 毫秒（CPU），比只偵測一次的做法還久（167、150 毫秒）。計畫允許的兩種調整（掃描頻率、偵測間隔上限）都試過，仍然沒過。
     - 原因：合照偵測在整個畫面上就找到全部 10 張臉，所以每次偵測都要算 5–10 張臉的特徵點（每次約 120–150 毫秒）。要讓每張臉每秒更新 5 次，主執行緒每秒要花約 1 秒在偵測上，調參數救不回來。
     - 其他桌機門檻都過了：找臉（PGR，三種合照每種 3 次全對，CPU、GPU 都是）、抖動與延遲（PJ1G）。也就是說，合照偵測找得到小臉，只是在主執行緒上太慢。
     - 單人自拍（PL2，不是桌機門檻）：跟 v0.5 一樣快（追蹤 10 張臉和 v0.5 的 3 張臉相差不到 1.2 毫秒）。但若照 PL2 的定義跟「只追蹤 1 張臉」比，GPU 5 次裡有 4 次超過 5 毫秒（多 5.1–7.3 毫秒），CPU 5 次都過。超出的部分是 v0.5 本來就有的成本（追蹤 3 張臉比 1 張多 3.9–6.6 毫秒）。這次沒有改設定；要不要退回只追蹤 1 張臉（相機就不能逐人美顏），等 iPhone 實測後由你決定。
     - 這一版實際找得到的臉：手機直立時，後鏡頭約畫面長邊 9% 以上，前鏡頭約 12% 以上，最多 10 人。三個人肩並肩這種較近的合照找得到；後鏡頭 2–3 公尺外的一群人（約 3.5–5.5%）、自拍的後排（約 6–10%）大多點不到。測試畫面上 10 張 3–4% 的遠臉，只偵測一次的做法一張都沒找到。發布說明會照實寫。
     - 合照偵測的程式還在，也有測試，只是預設關閉。下一步由你決定：(a) 把偵測移到背景執行緒（另一個專案，§6.2 F），預覽就不會被偵測拖慢，之後再開啟合照偵測；(b) 接受目前的限制。
   - **你的決定（2026-10-22）：不替所有人選一種做法，相機加「合照模式」按鈕（K22、§3.13）。** 照你的決定做好了：
     - 按鈕：相機上方「比例」「計時」旁邊的「合照模式」，預設關閉，打開時字變成強調色。點擊範圍 44 pt，讀螢幕會說出開或關。基本模式（沒有臉部偵測）不顯示。
     - 關閉（預設）：跟目前這一版一樣，只偵測一次整個畫面。前鏡頭單人自拍的順暢度完全不變；後鏡頭約長邊 9% 以上、前鏡頭約 12% 以上的臉找得到，測試畫面上 10 張 3–4% 的遠臉一張都找不到。
     - 打開：前後鏡頭都用合照偵測，前鏡頭不用等第二張臉，一打開就用。後鏡頭約 3%、前鏡頭合照約 5% 的臉也能點選（桌機上三種測試合照的臉全部找到）。代價就是上面沒過的流暢度：10 張遠臉時預覽每秒約 20–21 格、每張臉每秒更新 1.2–2.4 次、偶爾卡 0.2–0.25 秒。只有一個人時也用合照偵測（桌機每格約 19–23 毫秒，仍在每秒 30 格以內，但不是原本單人自拍的做法）。
     - 第一次打開時顯示一次「遠處的人也能點選，人多時預覽可能較不順」。關閉時畫面第一次出現兩張以上的臉，在「點選畫面中的臉，可個別調整」之後提示一次「開啟合照模式，遠處的人也能點選」；打開過之後就不再提示。
     - 開或關會記住，下次開 App 照舊；以前存的設定沒有這一項，就當作關閉。
     - 拍攝中切換：每個人的設定、選取的人、全部套用都保留，不會不見，也不會換到別人身上。切換的那一下預覽會頓一下（前鏡頭桌機量到 GPU 約 0.18 秒、CPU 約 0.05 秒；後鏡頭沒量）。
     - 要讓打開時也順，下一步仍是 (a)：把偵測移到背景執行緒（另一個專案，§6.2 F）。

2. **前鏡頭：畫面出現第二張較近的臉，才開始找遠處的臉（K18）**
   - **我的決定：** 單人自拍的速度和順暢度完全不變。朋友靠過來、畫面出現第二張臉時，才切換到合照偵測，切換時預覽會頓一下（桌機約 0.1–0.25 秒）。只剩一個人 5 秒後切回單人模式。
   - **代價：** 如果只有你在鏡頭前，其他人都站在後面很遠，要等有人靠近才會找到他們，或改用後鏡頭拍。
   - **你若希望前鏡頭隨時都找遠處的臉：** 單人自拍會變慢（每格約多 4–5 毫秒，超過原本單人自拍的標準），或每隔幾秒頓一下。請告訴我要選哪一種。
   - **已由「合照模式」取代（K22，2026-10-22）：** 前鏡頭不再看第二張臉自動切換。合照模式打開，就一直用合照偵測（單人自拍也是）；關閉，就一直是原本單人自拍的偵測方式。

另外，在 iPhone 上實測不是 push 的條件：iPhone 的數字要等 push 後的預覽版才量得到（RM §12）。push 之後，請手機直立各拍一次：後鏡頭站在 2–3 公尺外拍一群人，前鏡頭三人以上自拍，「合照模式」關閉、打開各一次。看看每個人是不是都點得到、預覽順不順。有數字之後再調整（PLN）。
