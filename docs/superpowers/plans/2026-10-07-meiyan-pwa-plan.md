# MonaLisa 美顏 PWA — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md` (**spec**). Research appendix: `docs/superpowers/specs/2026-10-07-meiyan-research-brief.md` (**RB**). Contracts: `src/types.ts`. Pre-written: `src/engine/gl/gl.ts` (GL helpers + coordinate convention), `src/engine/params.ts` (param data + pure functions), typed stubs for every module (`throw new Error('not implemented')`).

## Ground rules for every task

1. **Own only your files** (listed per task). Never edit `src/types.ts`, `src/engine/gl/gl.ts`, `src/engine/params.ts`, another task's files, `package.json`, configs. If a contract is wrong or missing, implement the closest correct thing inside your files and **report the needed contract change** in your final summary.
2. **Do not run `npm install`** or add dependencies. Available: preact 10, @mediapipe/tasks-vision 0.10.35, vitest 5, pngjs 7, fake-indexeddb 6, @playwright/test 1.63, Node 24 built-ins.
3. Keep exported signatures of your stubs exactly as declared (you may add exports).
4. Type-check with `npx tsc --noEmit -p .` and **only fix errors in your own files** (other tasks run concurrently, so foreign errors are expected). Unit tests: `npx vitest run <your test files>`.
5. Code style: TypeScript strict, ES2022, no `any` unless unavoidable, small focused files, comments only where they explain *why* (match `gl.ts`). Ported shader files carry the GPUPixel header + a `Derived from GPUPixel <path>; modified: …` note (RB §8).
6. GPUPixel source (pinned): `https://raw.githubusercontent.com/pixpark/gpupixel/ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88/<path>` — fetch with `curl -s` (the GitHub REST API is rate-limited; use raw URLs only). Port from the **GLES** shader variants.
7. All coordinates follow the convention at the top of `src/engine/gl/gl.ts`.
8. Never fetch or use anything on the PixelFree do-not-reuse list (RB §8).
9. **Verify in a real browser engine, not just tsc.** Headless Chromium (Playwright 1.63, WebGL2 available) is installed. You may create harness pages/scripts under `tests/harness/<task-id>/` (owned by you) and serve the repo with `npx vite --port <PORT> --strictPort` (Vite serves any repo path, e.g. `http://localhost:<PORT>/tests/harness/t2/index.html`). Ports: T1 5181, T2 5182, T3 5183, T4 5184, T5 5185, T6 5186, T7 5187, T8 5188. Stop your server when done. GL code must be proven to compile + run (no GL errors, sane pixels) in headless Chromium.

## Tasks (phase 1 runs all in parallel)

### T1 · engine-core — owns `src/engine/index.ts`, `src/engine/pipeline.ts`, `src/engine/shaders/{mean,composite,present}.ts`, `src/engine/uniforms.ts`, `src/engine/*.test.ts`

Implement `createEngine` / `isWebGL2Supported` per `Engine` in `types.ts`, the pipeline of RB §2.2 and spec §5:

- WebGL2 context on the given canvas: `{ alpha:false, antialias:false, depth:false, stencil:false, premultipliedAlpha:false, preserveDrawingBuffer:false, powerPreference:'high-performance' }`. Handle `webglcontextlost` (preventDefault, set `lost`) / `webglcontextrestored` (rebuild all GL objects; re-upload static textures).
- Static textures from `/luts/gp/lookup_{gray,origin,skin,light}.png` via `loadImageTexture`; `ready` resolves when uploaded. `loadFilter(id)` lazily loads `/luts/filters/<id>.png` (512×512, 64³ GPUImage layout; `'none'` resolves immediately).
- Source texture upload each render (`uploadSource`). Processing size = `fitShortEdge(w, h, tierShortEdge)` live (H 1080 / M 720 / L 540) or source size for `still` / `renderToImageData`.
- Pass order: [P0 mask → R8 ¼-res] → [P1 makeup] → [P2 reshape] → P3 meanH → P4 meanV → P5 composite+present. Use the face passes from `src/engine/passes/{mask,makeup,reshape,overlay}.ts` (T2 implements them; call them exactly per their declared signatures; skip P1/P2 when `face` is null, `faceWeight` is 0, or `makeupActive/reshapeActive` is false; when `opts.matchGpupixel` or no face → `mask.fill(maskFb, 1)`).
- P3/P4: sparse 5-tap separable mean exactly as RB §2.3 (offsets `{0, ±1.5, ±3.5} × 4` texels scaled by `shortEdge/720`, weights 1/9 & 2/9); tier L uses half-res mean buffers.
- P5 composite: RB §2.3 parts 1–2 verbatim math (smoothing gate with mask, sharpen, whitening chain with `smoothstep(0.0, 0.1, w)` fade-in, `w = 0.5·v`), rosy (RB §2.5: soft-light toward `#FFB8C2`, weighted by `p·mask`, opacity ≤ 0.35·v), LUT filter `mix(c, lut64(c), amount)`, then present: flip Y, mirror X when `mirror`. Uniform mapping from `BeautyParams` lives in `src/engine/uniforms.ts` (RB §5 "Engine mapping" column).
- `renderToImageData`: render chain at full source res into an offscreen RGBA8 FBO with a present variant that does **not** flip Y (so `readPixels` rows are top-first) and mirrors per `opts.mirror`; return `ImageData`. Restore display state afterwards.
- `renderOriginal`: draw source to canvas (flip Y, mirror per options) for hold-to-compare.
- `showLandmarks`: after present, call `overlay.draw(face, mirror)`.
- Canvas backing size = processing size; never devicePixelRatio. `RenderStats.passes` lists executed passes.
- Precision: `precision highp float;` in every shader; no `lowp` accumulators (RB §1 #4).
- Unit-test pure parts (`uniforms.ts` mapping, size/tier math, kernel offsets) with Vitest.

### T2 · face-passes — owns `src/engine/passes/{mask,makeup,reshape,overlay}.ts`, `src/engine/passes/faceMesh.ts`, `src/engine/passes/*.test.ts`

- **P2 reshape** (`reshape.ts`): port `src/filter/face_reshape_filter.cc` (`curveWarp`, `enlargeEye`) + new primitives `scaleAround`, `shiftAround` exactly as RB §2.4 code, warp list in the RB §2.4 table order (thinFace first … bigEye last), `uPts[111]`, `uExt[8]`, `uAspect = W/H`, eye radius from eye width (RB §2.4 big-eye row), yaw attenuation `smoothstep(0.35, 0.15, |yaw|)`, all deltas × faceWeight (done in `reshapeUniforms`). `reshapeUniforms` implements the RB §2.4 "Delta" column from the 0..1 values (bidirectional via `signed()` from params.ts). `reshapeActive` = any |delta| > 1e-4.
- **P1 makeup** (`makeup.ts` + `faceMesh.ts`): port `src/filter/face_makeup_filter.cc` — copy `FaceTextureCoordinates()` (111 template points) and `GetFaceIndexs()` (528 indices) **verbatim** into `faceMesh.ts` with attribution; VAO with dynamic `aPos` (111 vec2 = `pts·2−1`) and static UVs per part using the lipstick bounds `{502.5, 710, 262.5, 167.5}` and blusher bounds `{395, 520, 489, 209}` (RB §2.5); Uint16 IBO. One draw: blit `src`→`dst` with a copy shader first, then the mesh draw reading the base via `texture(uBase, gl_FragCoord.xy * uInvDst)` (src may differ in size from dst — never texelFetch), `out = base · mix(1, lipMul, iLip) · mix(1, blushMul, iBlush)` with `lipMul = color ? mix(vec3(1), shade, mask) : tex` (masks `/makeup/gp/{lip,blush}_mask.png` produced by T5; originals `/makeup/gp/{lip,blush}.png`). `makeupUniforms` uses `shadeColor` + `hexToRgb`; intensities × faceWeight. `ready` resolves after the 4 textures load.
- **P0 mask** (`mask.ts`): R8 target; triangle fan over `face.oval` (36 pts) centred on the oval centroid + a feathered outer ring (vertex alpha 1→0, ring width ≈ 8% of face width); punch eye holes (pts 52–57 / 58–63 polygons) and mouth hole (outer lip 84–95) with alpha 0, feathered. `fill(dst, v)` = clear to v. Multiply by faceWeight (mask = mix(1, mask, faceWeight) so no face ⇒ full smoothing).
- **Overlay** (`overlay.ts`): GL_POINTS (size 4) for 111 pts (lime) + ext anchors (magenta), same flip/mirror as present.
- Unit-test `reshapeUniforms`/`makeupUniforms`/`reshapeActive` and the mesh data integrity (111×2 coords, 528 indices all < 111).

### T3 · tracking — owns `src/tracking/*`, `tests/fixtures/landmarks_sample_face.json`, `scripts/record-landmarks.mjs`

- `tracker.ts` per RB §3: `FilesetResolver.forVisionTasks(wasmBase)`, `FaceLandmarker.createFromOptions` with `baseOptions: { modelAssetBuffer, delegate }`, `runningMode:'VIDEO'`, `numFaces:1`, no blendshapes/matrices, `canvas: new OffscreenCanvas(1,1)` when `typeof OffscreenCanvas !== 'undefined'`; `'auto'` → try GPU, on throw retry CPU. Guards for VIDEO: `readyState ≥ 2`, `videoWidth > 0`, strictly increasing ts (bump by 1 ms if needed). `detectImage` switches to IMAGE via `setOptions` and back to VIDEO. Return `Landmarks478` (Float32Array 478×3) or null. Catch per-call errors → null (log once).
- `adapter111.ts` per RB §2.7 table (normative): contour arc-length resample per frame (17+17 with shared chin point 16) computed in isotropic pixel space (`x·width, y·height`), `mid()` rules, template-midpoint rules for 106–110, `ext` in the fixed order documented in `types.ts`, `oval` = MediaPipe FACE_OVAL 36 indices in order, `yaw` formula RB §2.4.
- `scripts/record-landmarks.mjs`: Playwright (chromium) + a tiny page served by `vite` **or** a `file://`-free static server you write in the script, running tasks-vision from `node_modules` on `tests/fixtures/sample_face.png`, saving the 478 points to `tests/fixtures/landmarks_sample_face.json`. Run it once and commit the fixture. (If the bundled Playwright chromium revision is missing, use `chromium.launch({ channel: 'chrome' })` or the newest available `%LOCALAPPDATA%/ms-playwright/chromium-*` via `executablePath`.)
- `adapter111.test.ts`: on the fixture — no NaN, all in [0,1], left/right ordering (x of 52 < x of 74 < x of 55 < x of 58 < x of 77 < x of 61), contour monotone chin at 16, symmetric pairs mirror about the face midline within tolerance, 106–110 equal their template rules exactly.

### T4 · media — owns `src/media/*`, `src/engine/assets.ts`, `src/media/*.test.ts`

- `camera.ts` per spec §8 + RB §4 "Camera handling": controller-owned `<video autoplay muted playsinline>` appended to `document.body` with style `position:fixed; width:1px; height:1px; opacity:0; pointer-events:none` (not `display:none`). Constraints `{ facingMode, width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30} }`, audio false. Map errors: NotAllowedError→denied, NotFoundError/OverconstrainedError→notfound, NotReadableError→inuse, insecure context→insecure. Dimensions from `video.videoWidth/Height` after `loadedmetadata`. Recovery: `visibilitychange`/track `mute`/`unmute`/`ended`; on foreground wait 800 ms, if muted/ended → state `interrupted` (UI shows 恢復相機 → `resume()`). Black-frame detector: sample the video into a 16×16 canvas 2 s after live; if max luma < 4 for 3 consecutive checks → error `black`. `flip()` stops old tracks first. Wake Lock while live (feature-detect; re-acquire on visibility). `subscribe` emits snapshots.
- `importer.ts` per RB §4 "Photo import": `createImageBitmap(file, { imageOrientation:'from-image', resizeWidth, resizeHeight, resizeQuality:'high' })` (compute size via a first `createImageBitmap(file)` probe or `<img>` natural size), fallback `<img>` + `decode()` + canvas draw. `fitLongEdge` pure.
- `exporter.ts`: `OffscreenCanvas.convertToBlob` when available else `<canvas>.toBlob`; filename `meiyan-YYYYMMDD-HHMMSS.jpg` (local time); `saveFile` per contract — no `await` before `navigator.share`.
- `engine/assets.ts`: memoised `loadEngineAssets` streaming the model with progress (`Content-Length` may be absent → total 0), then warm-fetch the wasm (progress phase `'wasm'`; failure non-fatal), phase `'done'`. Call `navigator.storage?.persist?.()` when standalone. Retry-able after failure (clear memo on rejection).
- Vitest: `fitLongEdge`, filename format, error mapping, camera state machine with a fake `navigator.mediaDevices` (jsdom is not installed — stub the minimal DOM pieces you need or test pure helpers you extract).

### T5 · generated assets — owns `scripts/gen-luts.mjs`, `scripts/gen-makeup.mjs`, `scripts/gen-icons.mjs`, `scripts/gen-y4m.mjs`, outputs under `public/luts/filters/`, `public/makeup/gp/*_mask.png`, `public/icons/`, `tests/fixtures/face.y4m` (gitignored output is fine)

- `gen-luts.mjs`: 8 LUTs (`natural, soft, milktea, warm, cool, japanese, film, mono`), each a 512×512 PNG in the **GPUImage 64³ layout** (8×8 tiles of 64×64; blue selects tile, `x = (b_tile%8)*64 + r`, `y = floor(b_tile/8)*64 + g`). Implement each as a tasteful colour transform in linear-ish space (curves, split-toning, saturation, fade) suited to portraits; keep skin tones pleasant; `mono` = luminance with slight warm tone. Also `<id>_thumb.png` 96×96: apply the LUT to a synthetic portrait-like gradient swatch (skin tones + background) so thumbnails differ visibly. Verify identity math by also generating (not shipping) an identity LUT in a test and checking round-trip.
- `gen-makeup.mjs`: `lip_mask.png` and `blush_mask.png` single-channel (stored as greyscale RGBA, R=G=B=mask, A=255) from `public/makeup/gp/{lip,blush}.png` via RB §2.5 formulas: lip `(1 − min(G,B)) / (1 − 40/255)`, blush `(1 − min(G,B)) / (1 − 221/255)` (values 0..1, clamp).
- `gen-icons.mjs`: app icons with pngjs (own software rasteriser with anti-aliasing): black `#000` background, a lime `#B8F02A` minimal mark (e.g. a stylised face outline / sparkle — original, no brand resemblance); `apple-touch-icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (mark within the 80% safe zone).
- `gen-y4m.mjs`: convert `tests/fixtures/sample_face.png` to a 1280×720 (letterboxed/cropped, face centred) YUV4MPEG2 4:2:0 file `tests/fixtures/face.y4m` with 30 frames (identical frames are fine) for Chromium's fake camera.
- Run all scripts; commit outputs (except y4m). Package script `assets` already chains fetch/luts/makeup/icons.

### T6 · store — owns `src/store/*`, `src/engine/params.test.ts`, `src/store/*.test.ts`

- `settings.ts`: keys `meiyan.params.v1`, `meiyan.prefs.v1`; `loadParams` uses `sanitizeParams`; prefs merged over `DEFAULT_PREFS` with type checks; every storage access in try/catch.
- `history.ts`: IndexedDB `meiyan` v1, store `edits` keyPath `id`, index `updatedAt`; ids via `crypto.randomUUID()` (fallback random); `addEntry` enforces `HISTORY_LIMIT` (delete oldest by `updatedAt`); `listEntries` newest first; all ops resolve sanely (empty list / no-op) if IDB is unavailable or throws.
- `undo.ts`: bounded stack per declared API (deep-equality via JSON to ignore duplicate pushes; `structuredClone` stored states).
- Tests: `params.test.ts` (preset scaling, setParam → custom, resetGroup, displayValue/fromDisplay round-trip, sanitizeParams with junk), `history.test.ts` with `fake-indexeddb/auto`, `undo.test.ts`, `settings.test.ts` with a stub `localStorage`.

### T7 · UI — owns `src/main.tsx`, `src/ui/**` (screens, components, `theme.css`, `icons.tsx`, `app.tsx`, `state.ts`)

Implement spec §7 exactly (Darkroom Pro tokens, screens Home / Camera / Review / Editor / Settings, BeautyPanel, Slider, hold-to-compare, undo/redo, ratio chip, timer, install hint, engine progress chip, error states from spec §8). Use only the module APIs declared in the stubs (`createEngine`, `createTracker`, `adapt` (not needed directly), `createCamera`, `importPhoto`, `encodeJpeg`, `toJpegBlob`, `saveFile`, `loadEngineAssets`, store APIs, `startLiveLoop`, `createStillSession`, params.ts functions).

- One `Engine` + one `Tracker` per app session (created lazily after `loadEngineAssets`; tracker failure → 基本模式 flag). One shared display `<canvas>` element moved between Camera and Editor screens (keep a single instance; re-parent the DOM node).
- No router, no `history.pushState`, no hash changes. Screen = state in `state.ts` (Preact signals are not installed — use hooks/context).
- iOS details: `touch-action: none` on canvas/sliders; pointer events for slider dragging; prevent double-tap zoom and rubber-banding; `user-select:none`; safe-area insets via `max(env(safe-area-inset-*), Npx)`; `100dvh` layout; the ratio frame crops the canvas visually with `object-fit: cover` and capture is center-cropped to the same ratio (do the crop on the `ImageData` before encoding).
- Save: on Review/Editor 儲存 tap call `saveFile(file)` synchronously with a file encoded **before** the tap (Review: right after capture; Editor: re-encode on param change debounced 400 ms, and on tap if stale use `saveFile` only after encoding but show a quick 「準備中」 state — never await before share when the file is fresh). `'fallback'` → overlay with `<img>` + 「長按圖片 → 儲存到照片」.
- Haptics: the iOS `<input type="checkbox" switch>` trick on tab/preset/shutter taps (feature-detected, silent no-op elsewhere).
- Debug: expose `window.__meiyan: DebugState` (update from `LiveStats`, screen changes, errors).
- Icons: original inline SVG line icons (1.5–2 px stroke) in `icons.tsx` for every `ParamDef.icon` key, tab icons, top-bar actions.
- Credits screen content per spec §11 (static text, list of licences); privacy text 「所有影像處理都在你的裝置上完成，照片不會上傳。」.

### T8 · app-glue + bench — owns `src/app/*`, `src/bench/*`

- `live.ts`: `requestVideoFrameCallback` loop when available (fallback `requestAnimationFrame` + `video.currentTime` change check); per frame: detect (tier L: every 2nd frame, reuse last landmarks) → `adapt` → ease `faceWeight` toward 1/0 over ~150 ms → `engine.render`; measure detectMs / renderMs (performance.now) and fps (EMA); **auto-tier** when `prefs.tier==='auto'`: after 3 s warm-up, EMA frame time > 40 ms for 1.5 s → step down (H→M→L), never step up automatically within a session; explicit pref → `engine.setTier`. `setCompare(true)` → `engine.renderOriginal`. `capture()` → `engine.renderToImageData` with current frame/landmarks at full video res, `mirror: prefs.mirrorOnSave && facing==='user'`. Engine `mirror` option = `facing==='user'`. Pause when `camera.snapshot.state !== 'live'` or `engine.lost`. Write `window.__meiyan` fields fps/detectMs/renderMs/tier/face.
- `still.ts`: per contract; detect once via `tracker.detectImage(bitmap)` → `adapt`; `faceWeight` 1 when face; render via `engine.render(..., {still:true})`, coalesced by rAF; `exportImageData` → `renderToImageData(..., {mirror:false})`.
- `bench/main.ts` (plain DOM, no Preact): button 「開始」 (gesture) → `loadEngineAssets` with progress → `createEngine` on a full-screen canvas → `createTracker` → `createCamera().start('user')` → `startLiveLoop` with the 自然 preset; overlay shows fps, detect ms, render ms, tier, delegate, video size, UA, elapsed; buttons: tier H/M/L/auto, toggle params (skin only / skin+shape / all), delegate CPU restart; logs a sample every 5 s into a table and offers 「複製結果」 (clipboard write) for the user to paste back. Also a 「靜態圖片測試」 mode on a picked photo (file picker; the bench never reads a photo from `public/`).

## Phase 2 · integration (sequential, after phase 1)

Wire everything; make `npm run typecheck`, `npm test`, `npm run build` green; Playwright config + e2e (`tests/e2e/*.spec.ts`) per spec §10 using Chromium flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/fixtures/face.y4m`; engine render test on `sample_face.png`; fix contract mismatches reported by phase-1 tasks.

## Phase 3 · review → fix

Independent reviewers per lens (shader-port fidelity vs GPUPixel source & RB; iOS Safari/PWA constraints RB §1/§4; TS correctness/bugs/leaks; UI vs spec §7), adversarial verification of findings, fixes, re-run all checks.

## Phase 4 · deploy (needs user go-ahead)

`vercel` CLI deploy of `dist/` with `vercel.json`; smoke test the URL; hand the user the bench + app URLs and the on-device checklist (spec §10 "Device").
