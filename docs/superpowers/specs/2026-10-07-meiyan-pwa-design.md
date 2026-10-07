# MonaLisa 美顏 PWA — Design Spec

- **Date:** 2026-10-07
- **Status:** approved for implementation (user: 「開始做」)
- **Research appendix:** [`2026-10-07-meiyan-research-brief.md`](2026-10-07-meiyan-research-brief.md) — sourced platform facts, shader math, landmark mapping. Section refs like **RB §2.3** point there. Where they disagree, this spec wins.

## 1. Intent

| | |
|---|---|
| What | An iPhone-first PWA offering 美顏 (beauty) effects: live beautified front camera **and** photo retouching, with one shared GPU engine. |
| Who / why | Personal / portfolio demo. Showcase quality matters; no commercial or licensing-revenue obligations. |
| Engine source | GPUPixel (pixpark/gpupixel @ `ef552bf`, Apache-2.0) GLSL shaders **hand-ported to WebGL2**. PixelFreeEffects is a **reference spec only** (feature taxonomy, parameter model, defaults, UI grouping) — no code, binaries, licence files or assets. |
| UI reference | Commercial beauty apps; chosen style **C · Darkroom Pro** (醒圖 / Hypic / Facetune genre), without copying any brand asset. |
| Hosting | Vercel, static only. **All processing on-device; no photo ever leaves the phone.** No backend, accounts or analytics. |

### Success criteria

1. Installs from Safari via Add to Home Screen; launches standalone; works offline after the first engine download.
2. Live preview ≥ 24 fps (target 30) with skin + reshape on, on the device the user tests with; quality tier auto-steps down to keep it.
3. Photo edits export at full (downscaled-on-import) resolution, visually natural at default settings.
4. Deployed to a Vercel URL.
5. `npm run build`, `npm test` and the Playwright e2e suite pass.

## 2. Decisions (with who decided)

| Topic | Decision | By |
|---|---|---|
| Purpose | Personal / portfolio demo | user |
| Modes | Live camera + photo edit, one engine | user |
| v1 feature groups | 美膚 Skin, 美型 Reshape, 濾鏡 Filters, 美妝 Makeup (lip + blush) | user |
| Visual style | C · Darkroom Pro (opaque black chrome, lime accent, center-zero sliders, hold-to-compare, undo/redo) | user |
| Entry flow | Home hub: 拍攝 / 匯入照片 / 最近編輯 | user |
| Capture | Photos only (no video) | user |
| Architecture | Approach 1: hand-ported WebGL2 engine, MediaPipe on main thread; worker migration is a later contained change | user |
| Targets | iOS 18 / 26 / 27 Safari + Home Screen web app; iPhone portrait only; desktop Chrome/Safari for development | research |
| UI language | 繁體中文 | assumed, confirmed |
| Face tracking | MediaPipe Tasks Vision FaceLandmarker **pinned 0.10.35** (1.x has un-opt-out-able telemetry), self-hosted, `numFaces: 1`, GPU delegate → CPU fallback | research |
| Stack | Vite 8 + TypeScript 5.9 + Preact 10 + vite-plugin-pwa 2; Vitest; Playwright | research |
| App name | **MonaLisa 美顏** (short: MonaLisa) | repo name |

## 3. Scope

**In v1:** everything in §6–§8.

**Out of v1** (deliberately): video recording; stickers; body reshaping; green screen; 亮眼/祛法令紋/祛黑眼圈/白牙/AI 祛瑕疵; eye-shadow/brow/liner makeup; the deferred PixelFree reshape list (RB §5 "out of scope"); landscape layout; multi-face; Web Worker pipeline; WebGPU; accounts/cloud sync.

## 4. Architecture

```
src/
  types.ts                shared contracts (single source of truth for interfaces)
  engine/                 plain TS, no UI deps; owns one WebGL2 context
    gl/                   context, textures, FBO pool, program, VAO helpers
    shaders/              ported GLSL (attribution headers + change notes)
    passes/               mask · makeup · reshape · mean (H,V) · composite
    pipeline.ts           pass order, skip rules, tiers, capture render
    params.ts             parameter schema, presets, filters, shades, uniform mapping
    assets.ts             engine download (model + wasm) with progress
  tracking/
    tracker.ts            MediaPipe wrapper (VIDEO/IMAGE on one instance; GPU→CPU)
    adapter111.ts         478 → GPUPixel-111 + ext anchors + face oval + yaw
  media/
    camera.ts             getUserMedia lifecycle + recovery + wake lock
    importer.ts           File → oriented, downscaled ImageBitmap
    exporter.ts           ImageData → JPEG File → share sheet / long-press fallback
  store/
    settings.ts           params + prefs (localStorage, try/catch)
    history.ts            recent edits (IndexedDB)
    undo.ts               generic undo/redo stack
  ui/                     Preact screens + components + theme.css
  main.tsx                app entry
  bench/main.ts           performance-spike page entry (bench.html)
```

Contracts live in `src/types.ts`; modules depend only on contracts, never on each other's internals. Data flow is in RB §2 and the approved Section 1:

- **Live:** `requestVideoFrameCallback` → `tracker.detectVideo` → `adapt` → `engine.render` → display canvas. Params changes only change uniforms.
- **Editor:** detect once per photo (IMAGE mode on the same instance); render on param change, coalesced to one per animation frame.
- **Shutter:** re-render current frame at full video resolution into an offscreen FBO → `ImageData` → JPEG immediately → Review.
- **Single page, no router**, screens are in-memory state; camera stream survives Review/Editor.

## 5. Engine (GPU)

Pipeline per RB §2.2 — 5 passes + optional mask:

| Pass | What | Port source |
|---|---|---|
| P0 mask | R8 ¼-res feathered face-oval mask (gates skin & rosy); off in "match GPUPixel" mode | new |
| P1 makeup | one mesh draw: lip × blush multiply (111-pt template mesh, 528 indices) | `face_makeup_filter.cc`, lipstick/blusher |
| P2 reshape | single backward-warp pass: slim, V, narrow, chin, forehead, nose, mouth, eye-distance, big-eye; yaw attenuation | `face_reshape_filter.cc` + new warps (RB §2.4) |
| P3/P4 mean | sparse 5-tap separable mean, offsets ×(shortEdge/720) | `box_blur_filter.cc`, `box_mono_blur_filter.cc` |
| P5 composite | smoothing + sharpen + whitening chain (with smoothstep fade-in fix) + rosy + LUT filter + present (flip Y, mirror X) | `beauty_face_unit_filter.cc` + new |

Rules: GLSL ES 3.00, `precision highp float` everywhere; RGBA8 FBOs; static textures uploaded without colour conversion / premultiply; texture v=0 = top row through the chain, flip once at present; render at processing resolution, never devicePixelRatio. Quality tiers **H** (1080 short edge), **M** (720), **L** (540 + half-res mean + detect every 2nd frame); auto step-down from a moving average of frame time after 3 s; tier is a pref (`auto|H|M|L`).

`faceWeight` (0..1) scales every landmark effect and is eased ~150 ms by the caller on face gain/loss; skin + LUT keep running without a face.

The GPUPixel quirks listed in RB §2.8 are not copied.

## 6. Face tracking

Per RB §3: `@mediapipe/tasks-vision@0.10.35`, model `face_landmarker.task` (float16/1, md5 `sOcnSQehZEQE/vZrKN1thQ==`), wasm + model self-hosted under versioned paths. `runningMode: 'VIDEO'`, `numFaces: 1`, no blendshapes / matrices, `delegate: 'GPU'`, explicit `canvas: new OffscreenCanvas(1,1)` when available; on `createFromOptions` failure retry with `'CPU'`. Detect on **unmirrored** frames. Photo mode switches the same instance to IMAGE and back. Landmark adapter mapping table: RB §2.7 (normative).

## 7. Screens and UX (Darkroom Pro)

### 7.1 Tokens

| Token | Value |
|---|---|
| `--bg` | `#000000` |
| `--panel` | `#1C1C1E` |
| `--elevated` | `#262628` |
| `--text` | `#FFFFFF` |
| `--text-2` | `#8E8E93` |
| `--dim` | `#4A4A4C` |
| `--accent` | `#B8F02A` (lime) |
| `--accent-ink` | `#000000` (text on accent) |
| `--danger` | `#FF453A` |
| Font | `-apple-system, "PingFang TC", "Noto Sans TC", system-ui, sans-serif` |

Selected item = 1 px accent outline, 8 px radius; active tab = accent underline 3×20 px; icons are our own 1.5–2 px stroke SVGs; no brand names/assets, no VIP motifs. Dark-only app (sets `color-scheme: dark`). All touch targets ≥ 44 pt. Layout uses `max(env(safe-area-inset-*), Npx)`.

### 7.2 Screens

1. **Home 首頁** — title "MonaLisa 美顏"; two large tiles **拍攝** and **匯入照片**; **最近編輯** horizontal strip (thumbnails from history; tap = reopen in editor, ✕ in edit mode = delete with inline confirm); gear → Settings. Shows engine-download progress chip while assets fetch (starts on first idle after launch). In a Safari tab (not standalone) shows a dismissible one-time hint 「分享 → 加入主畫面」 without naming button positions.
2. **Camera 拍攝** — black top bar (44 pt): ✕ (home) · ratio chip `3:4 | 1:1 | 9:16` · timer `關 | 3s | 10s` · flip. Preview canvas framed to the chosen ratio (center-crop via container; capture crops identically). Before stream: **「點擊開啟相機」** gate (gesture required each launch). Floating slider above the panel; **BeautyPanel** (§7.3); bottom row: [相簿 import] [shutter ◉ 72 pt, scales 0.92 on press] [按住對比]. Tap on preview toggles panel collapse. Shutter → countdown if timer → capture → **Review**.
3. **Review 預覽** — captured JPEG full-screen; actions **重拍** · **編輯** · **儲存**. 儲存 shares the pre-encoded file synchronously in the tap handler.
4. **Editor 編輯** — top bar: ✕ · ↶ ↷ · **儲存** (accent pill). Framed canvas with pinch-zoom/pan and double-tap to fit; **按住對比** button at canvas bottom-right shows original + 「原圖」 label while held. Same BeautyPanel. **重置** (inline confirm) restores the 自然 preset. Every edit autosaves to history (debounced).
5. **Settings 設定** (bottom sheet) — 儲存時鏡像 (default on: save what you saw); 畫質 自動/高/中/低; 對齊 GPUPixel 原始效果 (disables face mask); 顯示臉部特徵點 (debug overlay); 偵測器 自動/CPU; 關於與授權 (credits, §11); 隱私 (on-device statement).

### 7.3 BeautyPanel

Tabs: **一鍵 · 美膚 · 美型 · 濾鏡 · 美妝**. Each tab is a horizontal strip of 44×74 pt items (icon + label); item 1 is **⊘ 原圖** (resets that group to neutral). Item states: {selected, unselected} × {has-value dot (4 px accent), neutral}.

| Tab | Items |
|---|---|
| 一鍵 | 原圖 · 自然 · 精緻 · 氣色 (+ 自訂 shown when any slider was edited); slider = 程度 |
| 美膚 | 磨皮 · 美白 · 紅潤 · 銳化 |
| 美型 | 大眼 · 瘦臉 · V臉 · 窄臉 · 下巴(±) · 額頭(±) · 瘦鼻 · 嘴型(±) · 眼距(±) |
| 濾鏡 | 無 · 自然 · 柔光 · 奶茶 · 暖調 · 冷調 · 日系 · 膠片 · 黑白 (thumbnails); slider = 濾鏡強度 |
| 美妝 | sub-tabs 口紅 / 腮紅; swatches (原色 = GPUPixel texture, then named shades); slider = intensity |

**Slider:** one at a time, floating above the panel. One-way shows 0–100 with a recommended-default dot; bidirectional shows −50…+50 with center tick, fill from center, snap to 0 within ±3. Value bubble while dragging, fades 600 ms after release. Double-tap resets to default. Haptics (iOS switch trick) only on taps, never on slider movement.

### 7.4 Parameters

Normative table: RB §5 (ids, 中文 labels, ranges, defaults = 自然 preset, engine mapping), with presets 原圖 / 自然 / 精緻 / 氣色. Stored 0..1; bidirectional neutral 0.5; shader value `s = (v−0.5)·2`. Editing any slider switches the preset indicator to 自訂. `程度` scales every param's distance from neutral.

Filters (own LUTs, 512×512, 64³ GPUImage layout, generated by `scripts/gen-luts.mjs`): 自然, 柔光, 奶茶, 暖調, 冷調, 日系, 膠片, 黑白, each with a default amount. Shades: lip 珊瑚 `#F06A5B` · 豆沙 `#C9767A` · 玫瑰 `#D8456B` · 正紅 `#D21F3C` · 蜜橘 `#F08A4B`; blush 蜜桃 `#FF9E8A` · 粉紅 `#FF8FB1` · 杏橘 `#FFB07A` · 玫瑰 `#E77A93`.

## 8. Platform handling and errors

| Situation | Handling |
|---|---|
| WebGL2 missing | Full-screen message 「此裝置不支援 WebGL2」. |
| Engine assets fail to download | Retry button; offer **基本模式** (skin + filter, no face effects). |
| Tracker GPU init fails | Retry once with CPU delegate; record delegate in debug info. |
| Camera permission denied / not found / insecure context | Inline message with fix steps; route to 匯入照片. |
| Track muted/ended on return to foreground | Wait ~0.8 s; still dead → **「恢復相機」** button (user gesture → new `getUserMedia`). |
| Repeated black frames in standalone (WK 252465) | Message + steps 「改用 Safari 開啟」. |
| Video dimensions | Always from `video.videoWidth/Height`; never `getSettings()`. |
| WebGL context lost | Pause loop, show spinner, recreate engine + tracker on `webglcontextrestored` (or on next user tap). |
| Import of huge/HEIC photo | `createImageBitmap(file, {imageOrientation:'from-image', resize…})` to long edge 2048 (tier L: 1440); fallback `img.decode()` + canvas; `close()` bitmaps promptly. |
| Saving | `navigator.canShare({files})` → `navigator.share({files:[file]})` inside the tap handler; `AbortError` = cancel; otherwise full-screen `<img>` with 「長按圖片 → 儲存到照片」. Never `<a download>`. |
| Storage unavailable (private mode / Lockdown) | Every storage access in try/catch; app works without SW, localStorage or IDB. |
| Screen sleep while camera active | Wake Lock where available. |

## 9. PWA and Vercel

- `vite-plugin-pwa` (generateSW): precache app shell, LUT / makeup PNGs, icons; **runtime CacheFirst** for `/mediapipe/` and `/models/` (versioned paths). `navigator.storage.persist()` when standalone.
- Manifest: `name` "MonaLisa 美顏", `short_name` "MonaLisa", `id` "/", `start_url` "/", `scope` "/", `display` "standalone", `background_color`/`theme_color` `#000000`, icons 192 / 512 / 512-maskable; plus `apple-touch-icon` 180.
- Head: `viewport-fit=cover`, `apple-mobile-web-app-capable`, status-bar style `black` (default); top bar tolerates both inset variants.
- `vercel.json`: immutable caching for the versioned/hashed paths `/assets/`, `/mediapipe/`, `/models/` (LUT/makeup PNGs are unversioned → default revalidation + SW precache revisions); `sw.js` must-revalidate; CSP with `connect-src 'self'` (blocks any telemetry) plus `frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`, `Permissions-Policy: camera=(self)`, `nosniff`, `no-referrer`. **No COOP/COEP.** If MediaPipe fails under the CSP's `script-src`, relax `script-src` only.

## 10. Testing

| Layer | How |
|---|---|
| Unit (Vitest) | params/presets math, uniform mapping, adapter111 against a recorded MediaPipe fixture (symmetry, index sanity, no NaN), undo stack, history (fake-indexeddb), importer size math, camera state machine with fake `MediaStream`. |
| Engine | Headless Chromium (Playwright) renders `sample_face.png` with fixed params; assertions: non-black, differs from source where expected, neutral params ≈ identity (mean abs diff < 2/255), no GL errors. |
| E2E (Playwright, Chromium) | Fake camera (`--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture` with a y4m generated from `sample_face.png`): home → camera gate → face detected → shutter → review; import flow → editor → slider → undo/redo → compare; settings toggles. Debug state exposed on `window.__meiyan` (fps, delegate, face). |
| Device | `bench.html` on the user's iPhone (detect ms, render ms, fps, tier over time), then manual checklist: install, permission gate, background/resume, save to Photos, offline relaunch. |

## 11. Licensing and credits

Per RB §8: ship `LICENSES/GPUPixel-Apache-2.0.txt`, GPUImage BSD-3 notice, MediaPipe Apache-2.0; every ported shader file keeps the GPUPixel header + a "Derived from … modified: …" note; credits screen lists GPUPixel, GPUImage, GPUImage-x, CainCamera (lineage), MediaPipe + Face Mesh V2, and states that the parameter design was informed by public SDK docs (PixelFree et al.) with no code or assets used. Nothing from the PixelFree do-not-reuse list (RB §8) is ever fetched or shipped.

## 12. Milestones

1. **M0 bench** — engine + tracker + camera on `bench.html` (deployable first so the user can measure on their iPhone).
2. **M1 app** — all screens, params, presets, history, save, PWA.
3. **M2 verify** — unit + e2e green, review fixes, build.
4. **M3 deploy** — Vercel (only with the user's go-ahead; it publishes the app).
