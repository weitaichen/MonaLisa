# v0.4 Step 3 — 裁切／旋轉／翻轉 + 原解析度／PNG 匯出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 8th editor tab 裁切 (free and fixed ratios, 90° 旋轉, 翻轉, ±45° 拉直, 還原) as a final geometric transform folded into P2, and make 儲存 export at the photo's own resolution (long edge ≤ 4096, tiled) as JPEG q 0.95 or PNG, with the source file kept in 最近編輯, a crash breadcrumb, a two-tap share and a `standard` fallback.

**Architecture:** Every persisted coordinate stays in O; `photo.geometry` (flip, quarter turns, straighten, crop) becomes one V→O affine (`src/geometry/view.ts`) that P2 applies in front of the existing backward maps, so a crop/rotation never re-detects and the source is resampled once. Full-resolution export decodes the kept source file and renders V in tiles (`src/media/exportPlan.ts` plans windows from an analytic displacement bound; `src/media/exportFull.ts` runs them through `Engine.renderTile`), with every kernel scaled by `fullShortEdge`. In the 裁切 tab the engine draws the whole O image with identity geometry and CSS rotates the canvas, so gestures cost no engine frame.

**Tech Stack:** Vite 8, TypeScript 5.9 (strict), Preact 10, WebGL2 (GLSL ES 3.00), MediaPipe tasks-vision 0.10.35 (unchanged), Vitest 5 (`environment: node`, fake-indexeddb), Playwright 1.63 (Chromium + SwiftShader, `workers: 1`).

**Spec:** `docs/superpowers/specs/2026-10-12-crop-and-fullres-export-design.md` (step-3 spec, **S** below), under the contract `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (**C**, status accepted; every §12 default is decided: #15 cap 4096, #16 原始解析度 JPEG default, #17 按住對比 keeps the crop, #18 no metadata, #19 seven ratios only, #20 the box moves, #21 keep only larger originals, #22 增高 stays on the photo's rows, #23 重置 resets geometry). Names consumed from step 1 and step 2 come from `2026-10-12-face-person-select-design.md` (**S1**) and `2026-10-12-adjust-and-looks-design.md` (**S2**).

## Reconciliation (step 3)

Checked against the code at the step base `b975bcc` (steps 1 and 2 fully committed, follow-ups included). The CRLF list under Global Constraints was re-verified with `git ls-files --eol` (all 24 still `w/crlf`, the other edited files `w/lf`, only `tests/harness/t1/harness.ts` mixed). Every name this plan produces is unchanged, so steps 4–6 still find them. These edits were made:

- **Anchors:** the **Files** lines and the step instructions of every task now cite `b975bcc` lines (types, settings, deps, app, exporter, importer, Camera, Review, state, history, reshape, pipeline, index, mask, makeup, testFakes, t7 fakes, still, panelModel, Slider, BeautyPanel, theme.css, zoomPan, HeightBandOverlay, Editor, editorModel, cache, migrate, flows, Home, bench main, NOTICE, editor.spec); `STEP3_BASE` is `b975bcc` (Before Task 1, Task 20).
- **Task 3:** `RenderInput.geometry?` moves here from Task 8 (`buildFrame` returns a `StillFrame` literal: without the field, typecheck fails); `normalizeEntry` (`history.ts:192`) passes the entry's `{width, height}` to `sanitizeEditState`, or every history read would reset a saved crop; the frame test passes step 1's required `primary`.
- **Task 4:** the `settings.ts` type import keeps `CameraLook`, and the `deps.ts` settings import keeps step 1's `loadLook` / `saveLook` (the plan's import lists were v0.3's).
- **Task 7:** `runReshapePinView` is written on step 1's page helpers `context()` / `floatTex` / `rig()` / `compare` instead of a copy of v0.3's setup.
- **Task 8:** run() calls `MaskPass.drawFaces` / `MakeupPass.drawFaces` and plans through `planFrame`, so those get the view, the window and the two plan flags; step 1's `aspect` (which also feeds `tableFaces`) becomes `job.oAspect`; `releaseBuffers` guards `Partial` `fbs`; `index.ts` drops the now-unused `frameFor` import and does not import `PxRect` (`noUnusedLocals`); the pipeline test's flag is `anyFace` (step 1), not `hasFace`.
- **Task 11:** `StillFrame` is imported from `../types` (still.ts does not re-export it).
- **Task 12:** `SliderView` carries every field `SliderRow` reads (step 1's `aria` / `mixed`, step 2's `track` / `hideDefault`); exact signatures of step 1's exhaustive switches (`activate`'s crop case is `done()`); 裁切 is photo-level through step 1's `photoScoped` / `personNote` (S §2.1: the person strip dims with 「整張照片」), with a test. This replaces Task 14's "add 'crop' to step 1's list of photo-level tabs" (step 1 has no such list).
- **Task 13:** `ZoomPanOptions` gains `resetWhen`; the reset also restores step 1's `--zs`; `yAt` joins `HeightBandOverlay`'s destructuring.
- **Task 14:** `Page` comes from `@playwright/test` (fixtures.ts does not export it); the crop block sits after `session` (it needs `stageRef` / `photo`); undo / redo use step 1's `e`; the tap maps step 1's `uv` tuple; face and body boxes, the debug `boxes` and step 1's `mapY` row shift map through the geometry; chip thumbnails get the turn through a new `PersonStrip` prop `thumbTransform`; the slider row keeps `emptyText`.
- **Task 15:** step 1's definite answer is the pure `firstAnswer` (`edit/migrate.ts`): `AnswerInput.quarter?` and `addFaceScan`, which moves to `detect/cache.ts` (re-exported by `editorModel.ts`); `normalizeDetect` returns `{ cache, stale, lost }` and builds `base` (the test reads `.cache`, uses `makeCache()`); `withFaces` carries `bodyScans`; `DetectionCache.bodyScans` is new (step 1 has none); the memo test uses step 1's `update(input, draft)` signature; the Editor wiring follows step 1's `sessionPlan` / `detectBody` / `bodyAnswer` / `measurePersons` / `applyField` code, and the suggested 增高 band reads the U measure too.
- **Task 16:** step 1's reopen passes the entry to `openInEditor` (no `historyId` / `source` options): the source is read from the entry there, Home's `openEntry` is unchanged, and the reopen test builds an entry.
- **Task 17:** step 1 has no frame ref: `planFor`, `encode`, `save`, `runWorking` and `runTiled` take the tap's `EditState` and build frames with step 1's `frameOf(e, s)`; the tiled fallback logs with `console.warn`, because `tests/e2e/fixtures.ts` fails a test on any `console.error` and the knob-injected failures take that path.
- **Commits:** the `git commit -m "v0.4 step 3: …"` blocks show each task's file list and intent; the workflow's own message format (`v0.4 step 3 task <N>: <title>`, fixes `v0.4 step 3 task <N> fix: …`, written to a file and committed with `git commit -F`) replaces them.

## Global Constraints

- Branch `feat/meiyan-pwa`; every commit is **local only** (never `git push`, never deploy); `package.json` `"version"` stays `0.3.0` (only step 6's release task bumps it).
- No new dependency: `package.json` / `package-lock.json` unchanged. MediaPipe stays `0.10.35`; CSP stays `connect-src 'self'`; no network request beyond localhost in any test.
- Line endings are preserved per file. CRLF working-tree files this plan edits (from `git ls-files --eol`, `w/crlf`): `src/types.ts`, `src/engine/index.ts`, `src/engine/pipeline.ts`, `src/engine/passes/mask.ts`, `src/engine/passes/makeup.ts`, `src/engine/passes/reshape.test.ts`, `src/media/importer.ts`, `src/media/importer.test.ts`, `src/app/testFakes.ts`, `src/ui/app.tsx`, `src/ui/deps.ts`, `src/ui/state.ts`, `src/ui/flows.ts`, `src/ui/screens/Home.tsx`, `src/ui/components/Slider.tsx`, `src/ui/panelModel.ts`, `src/ui/components/BeautyPanel.tsx`, `src/ui/screens/zoomPan.ts`, `src/ui/components/HeightBandOverlay.tsx`, `src/ui/theme.css`, `src/ui/icons.tsx`, `src/ui/screens/Camera.tsx`, `src/ui/screens/Review.tsx`, `src/bench/main.ts`. Every other edited file is LF (`Editor.tsx`, `still.ts`, `history.ts`, `settings.ts`, `exporter.ts`, `reshape.ts`, `uniforms.ts`, `gl.ts`, `present.ts`, `Settings.tsx`, `Controls.tsx`, `CanvasHost.tsx`, `hooks.ts`, `LICENSES/NOTICE.txt`, …). New files are LF (`.gitattributes`: `* text=auto eol=lf`). `git diff` normalizes line endings, so it cannot show a lost CRLF: check with `git ls-files --eol -- <file>` (the `w/` column must stay `w/crlf` for the list above and never become `w/mixed`). Do not use `grep -c $'\r$'` inside `$(…)` in Git Bash: the CR is dropped from the pattern and every line matches.
- **v0.3 parity (C §1.1):** with identity geometry, no window and no warps P2 stays skipped (`planPasses`, `pipeline.ts:146-157`); every new uniform reduces to ×1 / +0 at identity (`uGeo` = exact identity `mat3`, `uTile = uWin = (0,0,1,1)`), so `tests/e2e/parity.spec.ts` (≤ 1/255 max, < 0.02/255 mean) stays green after every task.
- Shader pins: `RESHAPE_FS` is re-pinned in the same commit as its CPU port (C §8.2). Step 3 changes **no** composite text: both step-2 pins in `src/engine/compositeCpu.test.ts` must stay unchanged.
- Anchors: `file:line` citations were written at `1f0273d` (= v0.3 code at `892ea61`); the **Files** lines and the step instructions are moved to the step base `b975bcc` (see Reconciliation). Line numbers inside spec quotes and code comments may still read v0.3 lines: when an anchor has moved, find the quoted code. Step-1/2 names this plan consumes are listed in each task's **Consumes**.
- Limits (`src/config/limits.ts`, created by step 1): `FULL_EXPORT_MAX_EDGE = 4096`, `TILE_DEFAULT = 1024`, `GL_TILE_BUDGET_MB = 40`, `SOURCE_MAX_MB = 30`, `SHARE_WINDOW_MS = 4000`, `MIN_CROP_FRAC = 0.05`, `MIN_CROP_PX = 64`.
- Export: `full` long edge = `min(source long edge, 4096)`; `standard` = the working size (2048, or 1440 on tier L), untiled, today's path. JPEG quality 0.95 when the size pref is `'full'` (whatever the mode), 0.92 for `'standard'`; PNG lossless; no metadata. File name `meiyan-YYYYMMDD-HHMMSS.jpg|.png`.
- Tiles: `TILE ∈ {2048, 1024, 512, 256}`, largest whose worst tile needs ≤ 40 MiB of GL buffers `(2·win² + 3·buf²)·4 B`; `apronV = ceil(14·k) + 2` rounded up to 4 with `k = fullShortEdge/720`; tile origins multiples of 4; snap outward first, clip last.
- Source retention: keep the picked file only when its probed long edge > the working long edge, `size ≤ 30 MiB`, and `quota − usage ≥ 3 × size` (estimate missing or throwing → keep only when `size ≤ 10 MiB`). Camera shots carry no source.
- Storage keys: `meiyan.exportGuard.v1` (`{at, w, h, format}`), `meiyan.exportCap.v1` (`2048`), `meiyan.debug.export.v1` (`{tile?: 256|512|1024|2048, slowMs?: number, failAt?: 'decode'|'tile'|'encode'}`); prefs stay under `meiyan.prefs.v1` with `exportFormat: 'jpeg'`, `exportSize: 'full'` defaults. Every storage access is in try/catch.
- 裁切 UI: strip `自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原`; 拉直 is the tab's slider (−45.0°…+45.0°, step 0.1°, snap to 0 within ±0.5°, bubble `+3.5°` / `−12.0°` / `0°`); positive θ turns the picture clockwise; 旋轉 turns 90° counter-clockwise (`quarter' = (quarter + 3) % 4`); the minimum crop is 5 % of each E dimension and ≥ 64 working px. 8 editor tabs, 裁切 last; the camera has no 裁切 tab.
- Copy, verbatim: 裁切 · 自由 · 原比例 · 旋轉 · 翻轉 · 還原 · 拉直 · 裁切框 · 左上角 · 右上角 · 左下角 · 右下角 · 上邊 · 下邊 · 左邊 · 右邊 · 正在輸出原始解析度… · 取消 · 儲存 · 準備中 · 分享 · 輸出 · 輸出格式 · JPEG（較小） · PNG（無損） · 檔案較小，適合分享 · PNG 檔案較大，約為 JPEG 的 3–5 倍 · 輸出解析度 · 原始解析度 · 標準（2048） · 原始解析度：最長邊最多 4096 像素 · 此裝置記憶體不足，改用標準解析度 · 畫質設為「低」時使用標準解析度 · 上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試 · 旋轉後已移除增高 · 正在重新偵測臉部… · 已準備好，點一下分享 · 已改用標準解析度輸出 · 上次以原始解析度輸出時程式中止，已改用標準解析度 · 此照片只保留了 2048 解析度 · 輸出已中斷，請再按一次「儲存」.
- Test commands: unit `npx vitest run <file>`; engine harness specs (dev server pages under `tests/e2e/pages/`) `npx playwright test <spec>`; **app specs run against `dist`, so run `npm run build` first**, then `npx playwright test <spec>`. Every Playwright run needs a `dist/` (`tests/e2e/global-setup.ts` throws without one, and `vite preview` serves it), so the harness specs too need one `npm run build` if `dist/` is missing. Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Merging into test files: when a step says "add to `<file>.test.ts`", put new names into the file's existing import declarations (a second import of an already-imported name is a duplicate binding, a syntax error); only names the file does not import yet get new import lines.

## Review Focus

1. **Output prefs changed after a pre-encode:** the user switches 輸出格式 to PNG (or 輸出解析度) in 設定 after the debounced JPEG pre-encode, then taps 儲存 — they expect a PNG, never the stale cached JPEG. Pinned in Task 17 (`shareReady` keys the cache on the plan signature).
2. **Undo of a 旋轉 that cleared a 增高 band:** one ↶ must bring back both the geometry and the band. Pinned in Task 3 (the reducer returns one state; the previous state object keeps the band).
3. **A crop gesture that never sees its pointerup** (tab switched, overlay unmounted, pointer capture lost): exactly one undo step with what was on screen, no stuck drag. Pinned in Task 13 (`CropDrag.abort`).
4. **Extreme aspect photos** (a 16000 × 4000 panorama; a 20000 × 3 sliver; a photo under 64 px): plans and crops stay finite, valid and non-empty; tiles still partition V. Pinned in Task 1 (`minCrop`, `cropConstrain`) and Task 9 (`planExport` panorama case).
5. **The 「分享」 second tap after a slow export that fell back, or whose 美體 field settled meanwhile:** the tap shares the file that just finished (transient activation is fresh), never starts another export that could end in 「分享」 again. Pinned in Task 17 (`tapAction` unit test; the fallback e2e reaches the file through the second tap).

(Leaving 裁切 mid-拉直 drag is also covered: Task 12's `StraightenGesture.reset` test, wired in Task 14.)

## Deferred (not in this plan)

- The on-device checklist (S §8.4) and the iPhone half of the Phase 0 rows (S §6.4, including row 5, the share-activation timing, and the memory peaks): they need a preview deploy the user approves (C §1.2), and this step only makes local commits. Task 19 builds the rows so they run on the device unchanged; on desktop Chromium they run from `/bench.html`.
- The time and memory budgets (S §6.2–6.3) are measured by Task 19's rows, not asserted by tests: SwiftShader timings say nothing about the iPhone.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/geometry/view.ts` (new) | Pure geometry: spaces O/E/V/U as affines, `viewSize`, `snapCrop`, validity, `maxFit`, `cropConstrain`, `rotateLeft`, `flipView`, `setStraighten`, ratio locks, crop-mode layout, overlay helpers |
| `src/geometry/cropModel.ts` (new) | Crop handle / edge / move gesture reducers |
| `src/geometry/upFrame.ts` (new) | Exact U↔O permutations of landmarks, poses, masks and the body field; the U image; the U-frame tracker wrapper |
| `src/edit/state.ts`, `src/edit/frame.ts`, `src/edit/migrate.ts` (step 1) | Geometry edit reducers, `sanitizeGeometry`, `oSize` threading, `frame.geometry` |
| `src/media/exportPlan.ts` (new) | Export block, plan selection, source retention, tile planner, displacement bounds, 設定 view model |
| `src/media/exportFull.ts` (new) | Tiled export runner against a `TileRenderer` (abort, knob, breadcrumb) |
| `src/engine/backMapCpu.ts` (new) | The one CPU copy of P2's backward map (V → content position in O) |
| `src/engine/passes/reshape.ts`, `reshapeCpu.ts` | `uGeo`/`uTile`/`uWin` in `RESHAPE_FS`, `withView`, `displacementBound` |
| `src/engine/{index,pipeline,uniforms}.ts`, `passes/{mask,makeup}.ts`, `shaders/present.ts` | V-sized buffers, windows, `renderTile`, `releaseBuffers`, `renderOriginal` with geometry |
| `src/media/{exporter,importer}.ts` | `encodeOutput`/`encodePng`/`outputFileName`; `importPhotoInfo` |
| `src/store/{history,settings}.ts` | Source fields + quota retry; export prefs and guard/cap/debug keys |
| `src/app/still.ts` | View mode, display pause, `renderCount`, tile input and bounds |
| `src/ui/cropPanel.ts` (new), `panelModel.ts`, `components/{Slider,BeautyPanel,Controls}.tsx`, `icons.tsx` | 裁切 strip and 拉直 slider model and rendering |
| `src/ui/components/CropOverlay.tsx` (new), `theme.css`, `screens/zoomPan.ts`, `components/{CanvasHost,HeightBandOverlay}.tsx` | Crop mode canvas, box, handles, band plane |
| `src/ui/exportFlow.ts` (new), `screens/{Editor,Settings,Home,Camera,Review}.tsx`, `flows.ts`, `state.ts`, `editorModel.ts`, `app.tsx`, `deps.ts` | Editor glue: crop mode, U-frame scans, source plumbing, plan-based save |
| `tests/e2e/pages/export.{html,ts}` (new), `tests/e2e/{export,crop}.spec.ts` (new), `tests/e2e/fixtures.ts`, `tests/e2e/pages/reshape.ts`, `tests/e2e/reshape.spec.ts` | Engine tile harness, app specs, helpers |
| `src/bench/exportBench.ts` (new), `src/bench/main.ts`, `LICENSES/NOTICE.txt` | Export bench rows; derived test image notice |

**Before Task 1:** `STEP3_BASE` is the step base commit `b975bcc` (the gate diffs against it; the reconcile commit on top of it touches only this plan).

---

### Task 1: Geometry and view math (`src/geometry/view.ts`)

**Files:**
- Create: `src/geometry/view.ts`, `src/geometry/view.test.ts`
- Modify: `src/types.ts` (after the step-1 `Rect`; v0.3 has none — S1 §3.2 adds it), `src/config/limits.ts` (step 1 creates it)

**Interfaces:**
- Consumes: `Rect {x, y, w, h}` (step 1, `src/types.ts`, S1 §3.2); `src/config/limits.ts` (step 1).
- Produces (`src/types.ts`): `interface Size { width: number; height: number }`, `interface Geometry { flipH: boolean; quarter: 0|1|2|3; straighten: number; crop: Rect }`, `type PxRect = Rect`.
- Produces (`src/geometry/view.ts`): `type Quarter = 0|1|2|3`; `type Vec2 = readonly [number, number]`; `interface Affine {a,b,c,d,e,f}`; `IDENTITY_GEOMETRY: Geometry`; `IDENTITY_MAT3: Float32Array`; `isFullCrop(c: Rect): boolean`; `isIdentity(g: Geometry): boolean`; `compose(m, n): Affine` (m after n); `invert(m): Affine`; `apply(m, p: Vec2): [number, number]`; `applyVec(m, d: Vec2): [number, number]`; `quarterAffine(q): Affine`; `eSize(g, o: Size): Size`; `upQuarter(g): Quarter`; `oToE(g)`, `eToO(g)`, `eToV(g, oSize)`, `vToE(g, oSize)`, `oToV(g, oSize)`, `vToO(g, oSize)`: `Affine`; `glMat3(m): Float32Array`; `viewSize(g, oPx: Size): Size`; `snapCrop(g, oPx): Geometry`; `cropAspectPx(g, oSize): number`; `minCrop(g, oSize): {w, h}`; `cropFits(g, oSize, eps?)`, `cropValid(g, oSize, eps?)`: `boolean`; `maxFit(theta, W, H, a): Rect`; `isMaxFit(g, oSize): boolean`; `cropConstrain(g, oSize): Geometry`; `rotateLeft(g)`, `flipView(g)`: `Geometry`; `clampStraighten(theta): number`; `setStraighten(start, theta, oSize): Geometry`; `type CropLock = 'free'|'original'|'1:1'|'3:4'|'4:3'|'9:16'|'16:9'`; `CROP_LOCKS`; `lockAspect(lock, g, oSize): number | null`; `applyRatio(g, lock, oSize): Geometry`; `lockFor(g, oSize): CropLock`; `transposeLock(lock): CropLock`; `interface CropLayout {eBox, canvas, sx, angle, cropBox}`; `cropModeLayout(stage, oSize, g, inset?, prevAngle?): CropLayout`; `cssTurn(l): string`; `ovalViewBox(points: Float32Array, g, oSize): Rect`; `chipTransform(g): string`; `bandPlane(g): {left, top, width, height, rotate}`; `eYAt(g, oSize, v: Vec2): number`.

- [x] **Step 1: Add the limits and types**

Append to `src/config/limits.ts`:

```ts
// ── step 3: crop and full-resolution export (step-3 spec §3.8) ──
/** long edge of a 原始解析度 export (C §11 Q4: capped at 4096) */
export const FULL_EXPORT_MAX_EDGE = 4096;
/** the tile edge expected at 4096 × 3072 (the planner picks the largest of 2048/1024/512/256 within GL_TILE_BUDGET_MB) */
export const TILE_DEFAULT = 1024;
/** GL buffer budget of the worst tile, MiB */
export const GL_TILE_BUDGET_MB = 40;
/** the picked file is kept as HistoryEntry.source only up to this size, MiB */
export const SOURCE_MAX_MB = 30;
/** an export slower than this from the tap shares on a second tap (transient activation lasts 5 s) */
export const SHARE_WINDOW_MS = 4000;
/** smallest crop: this fraction of each E dimension… */
export const MIN_CROP_FRAC = 0.05;
/** …and at least this many working-resolution pixels per axis */
export const MIN_CROP_PX = 64;
```

In `src/types.ts`, next to the step-1 `Rect` (CRLF file: keep CRLF):

```ts
export interface Size {
  width: number;
  height: number;
}

/** step-3 spec §3.1. O → E is flipH, then `quarter` clockwise quarter turns; V is the crop of E straightened by θ. */
export interface Geometry {
  flipH: boolean;
  /** clockwise quarter turns, applied after flipH (旋轉 turns counter-clockwise: quarter' = (quarter + 3) % 4) */
  quarter: 0 | 1 | 2 | 3;
  /** degrees, −45…45, rounded to 0.1, about the E-frame centre; positive turns the picture clockwise on screen */
  straighten: number;
  /** in the straighten plane, normalized to the E frame; axis-aligned in the view; every corner inside the straightened image and inside [0,1]² */
  crop: Rect;
}

/** integer pixel rectangle (tile planner, readback) */
export type PxRect = Rect;
```

- [x] **Step 2: Write the failing tests**

Create `src/geometry/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Geometry, Rect } from '../types';
import {
  apply,
  applyRatio,
  bandPlane,
  chipTransform,
  clampStraighten,
  cropAspectPx,
  cropConstrain,
  cropFits,
  cropModeLayout,
  cropValid,
  cssTurn,
  eSize,
  eToV,
  eYAt,
  flipView,
  glMat3,
  IDENTITY_GEOMETRY,
  invert,
  isIdentity,
  isMaxFit,
  lockAspect,
  lockFor,
  maxFit,
  minCrop,
  oToE,
  oToV,
  ovalViewBox,
  rotateLeft,
  setStraighten,
  snapCrop,
  transposeLock,
  upQuarter,
  viewSize,
  vToO,
  type Quarter,
} from './view';

const O = { width: 1600, height: 1200 };
const THETAS = [-45, -7.3, 0, 12, 45];
const QUARTERS: Quarter[] = [0, 1, 2, 3];

/** mulberry32: a deterministic PRNG for the fuzz cases */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGeometry(r: () => number, theta?: number): Geometry {
  const g: Geometry = {
    flipH: r() < 0.5,
    quarter: QUARTERS[Math.floor(r() * 4)],
    straighten: theta ?? clampStraighten(-45 + 90 * r()),
    crop: { x: r() * 0.5, y: r() * 0.5, w: 0.1 + r() * 0.8, h: 0.1 + r() * 0.8 },
  };
  return cropConstrain(g, O);
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
const closeG = (a: Geometry, b: Geometry, eps = 1e-9) =>
  a.flipH === b.flipH &&
  a.quarter === b.quarter &&
  Math.abs(a.straighten - b.straighten) <= eps &&
  close([a.crop.x, a.crop.y, a.crop.w, a.crop.h], [b.crop.x, b.crop.y, b.crop.w, b.crop.h], eps);

describe('affines', () => {
  it('vToO ∘ oToV = id within 1e-9 for every flip, quarter and θ, on random crops', () => {
    const r = rng(1);
    for (const flipH of [false, true])
      for (const quarter of QUARTERS)
        for (const theta of THETAS) {
          const g = cropConstrain({ flipH, quarter, straighten: theta, crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } }, O);
          const fwd = oToV(g, O);
          const back = vToO(g, O);
          for (let i = 0; i < 20; i++) {
            const p = [r(), r()] as const;
            expect(close(apply(back, apply(fwd, p)), p)).toBe(true);
          }
        }
  });

  it('oToV is eToV after oToE', () => {
    const r = rng(2);
    for (let i = 0; i < 50; i++) {
      const g = randomGeometry(r);
      const p = [r(), r()] as const;
      expect(close(apply(oToV(g, O), p), apply(eToV(g, O), apply(oToE(g), p)))).toBe(true);
    }
  });

  it('O → E is the exact permutation of the spec (F, then R1 (1−y, x), R2 (1−x, 1−y), R3 (y, 1−x))', () => {
    const p = [0.2, 0.7] as const;
    expect(apply(oToE({ flipH: false, quarter: 1 }), p)).toEqual([1 - 0.7, 0.2]);
    expect(apply(oToE({ flipH: false, quarter: 2 }), p)).toEqual([1 - 0.2, 1 - 0.7]);
    expect(apply(oToE({ flipH: false, quarter: 3 }), p)).toEqual([0.7, 1 - 0.2]);
    expect(apply(oToE({ flipH: true, quarter: 0 }), p)).toEqual([1 - 0.2, 0.7]);
    expect(eSize({ quarter: 1 }, O)).toEqual({ width: 1200, height: 1600 });
  });

  it('positive θ turns the picture clockwise on a y-down screen', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, straighten: 10 };
    // a content point right of the centre moves down in the view
    const v = apply(oToV(g, { width: 1000, height: 1000 }), [0.9, 0.5]);
    expect(v[1]).toBeGreaterThan(0.5);
  });

  it('identity geometry is the identity map, and glMat3 is column-major', () => {
    expect(isIdentity(IDENTITY_GEOMETRY)).toBe(true);
    expect(apply(vToO(IDENTITY_GEOMETRY, O), [0.3, 0.6])).toEqual([0.3, 0.6]);
    expect(Array.from(glMat3({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }))).toEqual([1, 2, 0, 3, 4, 0, 5, 6, 1]);
    const m = { a: 0.5, b: 0.25, c: -0.3, d: 2, e: 0.1, f: -0.4 };
    expect(close(apply(m, apply(invert(m), [0.4, 0.9])), [0.4, 0.9])).toBe(true);
  });
});

describe('actions', () => {
  it('rotateLeft four times and flipView twice are the identity', () => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      expect(closeG(rotateLeft(rotateLeft(rotateLeft(rotateLeft(g)))), g)).toBe(true);
      expect(closeG(flipView(flipView(g)), g)).toBe(true);
    }
  });

  it('flipView ∘ rotateLeft = rotateLeft⁻¹ ∘ flipView', () => {
    const r = rng(4);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      expect(closeG(flipView(rotateLeft(g)), rotateLeft(rotateLeft(rotateLeft(flipView(g)))))).toBe(true);
    }
  });

  it('the view turns 90° counter-clockwise under rotateLeft and mirrors under flipView, content kept inside the crop', () => {
    const r = rng(5);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      const o = apply(vToO(g, O), [0.2 + 0.6 * r(), 0.2 + 0.6 * r()]);
      const v = apply(oToV(g, O), o);
      const vr = apply(oToV(rotateLeft(g), O), o);
      const vf = apply(oToV(flipView(g), O), o);
      expect(close(vr, [v[1], 1 - v[0]], 1e-9)).toBe(true);
      expect(close(vf, [1 - v[0], v[1]], 1e-9)).toBe(true);
      for (const p of [vr, vf]) for (const c of p) expect(c >= 0 && c <= 1).toBe(true);
    }
  });

  it('upQuarter is invariant under flipView and moves by one under rotateLeft', () => {
    for (const flipH of [false, true])
      for (const quarter of QUARTERS) {
        const g = { ...IDENTITY_GEOMETRY, flipH, quarter };
        expect(upQuarter(flipView(g))).toBe(upQuarter(g));
        const d = (upQuarter(rotateLeft(g)) - upQuarter(g) + 4) % 4;
        expect(d === 1 || d === 3).toBe(true);
      }
  });

  it('clampStraighten clamps to ±45, rounds to 0.1 and never returns −0 or NaN', () => {
    expect(clampStraighten(50)).toBe(45);
    expect(clampStraighten(-3.46)).toBe(-3.5);
    expect(Object.is(clampStraighten(-0.04), 0)).toBe(true);
    expect(clampStraighten(Number.NaN)).toBe(0);
  });
});

describe('maxFit and cropConstrain', () => {
  it('maxFit equals the closed form and a brute-force search', () => {
    const r = rng(6);
    for (let i = 0; i < 60; i++) {
      const theta = -45 + 90 * r();
      const a = 0.3 + 3 * r();
      const W = 800 + 1200 * r();
      const H = 800 + 1200 * r();
      const m = maxFit(theta, W, H, a);
      const g: Geometry = { flipH: false, quarter: 0, straighten: theta, crop: m };
      expect(cropFits(g, { width: W, height: H }, 1e-7)).toBe(true);
      expect((m.w * W) / (m.h * H)).toBeCloseTo(a, 6);
      // 0.5 % larger does not fit
      const big = { x: 0.5 - m.w * 0.5025, y: 0.5 - m.h * 0.5025, w: m.w * 1.005, h: m.h * 1.005 };
      expect(cropFits({ ...g, crop: big }, { width: W, height: H })).toBe(false);
    }
  });

  it('maxFit at θ = 0 with the frame aspect is the full frame, exactly', () => {
    expect(maxFit(0, 1600, 1200, 1600 / 1200)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cropConstrain (fuzzed): valid, keeps a feasible aspect, idempotent, and leaves a valid input untouched', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const g: Geometry = {
        flipH: r() < 0.5,
        quarter: QUARTERS[Math.floor(r() * 4)],
        straighten: clampStraighten(-45 + 90 * r()),
        crop: { x: -0.3 + 1.2 * r(), y: -0.3 + 1.2 * r(), w: 0.01 + 1.2 * r(), h: 0.01 + 1.2 * r() },
      };
      const out = cropConstrain(g, O);
      expect(cropValid(out, O, 1e-7)).toBe(true);
      // every aspect in [1/4, 4] has a valid crop in 1600 × 1200 at any θ, so it is kept; a sliver (w = 0.02, h = 1.1:
      // about 1:41) cannot also be 5 % wide and fit, so it falls back to the E frame's own aspect (still valid)
      const a = cropAspectPx(g, O);
      if (a >= 0.25 && a <= 4) expect(cropAspectPx(out, O)).toBeCloseTo(a, 6);
      expect(cropConstrain(out, O)).toBe(out);
    }
    const sliver = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.4, y: 0, w: 0.02, h: 1 } }, O);
    expect(cropValid(sliver, O, 1e-7)).toBe(true);
    const valid = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, O);
    expect(cropConstrain(valid, O)).toBe(valid);
  });

  it('minimum size: 5 % and 64 working px; a photo under 64 px keeps its full frame', () => {
    expect(minCrop(IDENTITY_GEOMETRY, O)).toEqual({ w: 0.05, h: 64 / 1200 });
    expect(minCrop(IDENTITY_GEOMETRY, { width: 4000, height: 3000 })).toEqual({ w: 0.05, h: 0.05 });
    expect(minCrop(IDENTITY_GEOMETRY, { width: 40, height: 3000 }).w).toBe(1);
    const tiny = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.4, y: 0.4, w: 0.001, h: 0.001 } }, O);
    expect(tiny.crop.w * 1600).toBeGreaterThanOrEqual(64 - 1e-6);
  });

  it('extreme aspects stay finite and valid (Review Focus 4)', () => {
    for (const size of [{ width: 2048, height: 512 }, { width: 2048, height: 1 }, { width: 50, height: 40 }]) {
      for (const theta of [0, 30, -45]) {
        const g = cropConstrain({ ...IDENTITY_GEOMETRY, straighten: theta, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }, size);
        for (const v of [g.crop.x, g.crop.y, g.crop.w, g.crop.h]) expect(Number.isFinite(v)).toBe(true);
        expect(g.crop.w).toBeGreaterThan(0);
        expect(g.crop.h).toBeGreaterThan(0);
        expect(cropFits(g, size, 1e-7)).toBe(true);
      }
    }
  });

  it('setStraighten: a max-fit crop re-expands at 0°; a hand-shaped crop only shrinks', () => {
    const start = IDENTITY_GEOMETRY;
    expect(isMaxFit(start, O)).toBe(true);
    const tilted = setStraighten(start, 12, O);
    expect(tilted.crop.w).toBeLessThan(1);
    expect(setStraighten(tilted, 0, O).crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(setStraighten(start, 0, O)).toBe(start);

    const hand: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 } };
    expect(isMaxFit(hand, O)).toBe(false);
    expect(setStraighten(hand, 5, O).crop).toEqual(hand.crop); // still fits: unchanged
    const far: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.6, h: 0.6 } };
    const s = setStraighten(far, 20, O);
    expect(s.crop.w).toBeLessThan(0.6);
    expect(cropValid(s, O, 1e-7)).toBe(true);
  });
});

describe('ratio locks', () => {
  it('applyRatio is the centred max-fit of the lock aspect; 自由 and a matching aspect change nothing', () => {
    const one = applyRatio(IDENTITY_GEOMETRY, '1:1', O);
    expect(cropAspectPx(one, O)).toBeCloseTo(1, 9);
    expect(one.crop.x + one.crop.w / 2).toBeCloseTo(0.5, 12);
    expect(applyRatio(one, '1:1', O)).toBe(one);
    expect(applyRatio(one, 'free', O)).toBe(one);
    expect(applyRatio(IDENTITY_GEOMETRY, 'original', O)).toBe(IDENTITY_GEOMETRY);
  });

  it('lockFor: 自由 uncropped, the matching ratio within 0.5 %, else 自由', () => {
    expect(lockFor(IDENTITY_GEOMETRY, O)).toBe('free');
    expect(lockFor(applyRatio(IDENTITY_GEOMETRY, '9:16', O), O)).toBe('9:16');
    expect(lockFor({ ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }, O)).toBe('original');
    expect(lockFor({ ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.5, h: 0.31 } }, O)).toBe('free');
  });

  it('transposeLock swaps 3:4 ↔ 4:3 and 9:16 ↔ 16:9 only; original follows the E aspect', () => {
    expect(transposeLock('3:4')).toBe('4:3');
    expect(transposeLock('16:9')).toBe('9:16');
    expect(transposeLock('1:1')).toBe('1:1');
    expect(transposeLock('free')).toBe('free');
    expect(lockAspect('original', { ...IDENTITY_GEOMETRY, quarter: 1 }, O)).toBeCloseTo(1200 / 1600, 12);
  });
});

describe('sizes', () => {
  it('viewSize rounds the crop at that density; snapCrop at θ = 0 gives whole-pixel edges', () => {
    const g: Geometry = { flipH: false, quarter: 1, straighten: 0, crop: { x: 0.1234, y: 0.2345, w: 0.5111, h: 0.4222 } };
    const s = snapCrop(g, O);
    const e = eSize(s, O);
    for (const v of [s.crop.x * e.width, s.crop.y * e.height, (s.crop.x + s.crop.w) * e.width, (s.crop.y + s.crop.h) * e.height]) {
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
    }
    expect(viewSize(s, O)).toEqual({ width: Math.round(s.crop.w * 1200), height: Math.round(s.crop.h * 1600) });
    const tilted = { ...g, straighten: 3 };
    expect(snapCrop(tilted, O)).toBe(tilted);
    expect(viewSize(IDENTITY_GEOMETRY, O)).toEqual(O);
  });
});

describe('crop-mode layout and overlays', () => {
  it('odd quarters swap the E box; the canvas box keeps the O aspect, centred on the E box', () => {
    const stage = { width: 393, height: 500 };
    const l = cropModeLayout(stage, O, { ...IDENTITY_GEOMETRY, quarter: 1 });
    expect(l.eBox.w / l.eBox.h).toBeCloseTo(1200 / 1600, 9);
    expect(l.canvas.w / l.canvas.h).toBeCloseTo(1600 / 1200, 9);
    expect(l.canvas.x + l.canvas.w / 2).toBeCloseTo(l.eBox.x + l.eBox.w / 2, 9);
    expect(l.eBox.x).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(cssTurn(l)).toBe('scaleX(1) rotate(90deg)');
    expect(l.cropBox).toEqual(l.eBox);
  });

  it('the turn is unwrapped toward the previous angle, and a flip is a pure mirror', () => {
    const stage = { width: 400, height: 400 };
    const g3 = { ...IDENTITY_GEOMETRY, quarter: 3 as Quarter };
    const prev = cropModeLayout(stage, O, g3, 24, 270);
    const next = cropModeLayout(stage, O, rotateLeft(g3), 24, prev.angle);
    expect(next.angle).toBe(180); // 270 → 180: a 90° counter-clockwise turn, not +270
    const f = cropModeLayout(stage, O, flipView(g3), 24, prev.angle);
    expect(f.sx).toBe(-1);
    expect(f.angle).toBe(prev.angle);
  });

  it('ovalViewBox maps O points to the V bounding box; chips and the band plane follow the geometry', () => {
    const pts = new Float32Array([0.2, 0.2, 0.4, 0.2, 0.4, 0.5, 0.2, 0.5]);
    const box = ovalViewBox(pts, { ...IDENTITY_GEOMETRY, quarter: 1 }, O);
    expect(close([box.x, box.y, box.w, box.h], [0.5, 0.2, 0.3, 0.2], 1e-6)).toBe(true);
    expect(chipTransform({ ...IDENTITY_GEOMETRY, quarter: 3, flipH: true })).toBe('rotate(270deg) scaleX(-1)');
    expect(bandPlane(IDENTITY_GEOMETRY)).toEqual({ left: 0, top: 0, width: 100, height: 100, rotate: 0 });
    const crop: Rect = { x: 0.25, y: 0, w: 0.5, h: 1 };
    expect(bandPlane({ ...IDENTITY_GEOMETRY, straighten: 5, crop })).toEqual({ left: -50, top: 0, width: 200, height: 100, rotate: 5 });
    expect(eYAt(IDENTITY_GEOMETRY, O, [0.3, 0.7])).toBeCloseTo(0.7, 12);
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npx vitest run src/geometry/view.test.ts`
Expected: FAIL — `Failed to resolve import "./view"`.

- [x] **Step 4: Implement `src/geometry/view.ts`**

```ts
// Geometry of the v0.4 crop / rotate / flip (contract §3.5, step-3 spec §3.1–3.3). Spaces: O (the EXIF-oriented original,
// normalized [0,1]², y down), E (O after flipH, then `quarter` clockwise quarter turns: an exact permutation), V (the crop
// of the E plane straightened by θ, normalized to the crop) and U (O turned by whole quarters only, never mirrored, so
// U-up = E-up and E rows = U rows). Every map is one 2 × 3 affine in normalized coordinates. Pure: no DOM, no GL.
import { MIN_CROP_FRAC, MIN_CROP_PX } from '../config/limits';
import type { Geometry, Rect, Size } from '../types';

export type Quarter = 0 | 1 | 2 | 3;
export type Vec2 = readonly [number, number];
/** x' = a·x + c·y + e, y' = b·x + d·y + f (DOMMatrix order) */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_GEOMETRY: Geometry = { flipH: false, quarter: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
/** uGeo at identity: exact, so P2's `uGeo * vec3(v, 1)` is bit-identical to `v` (parity) */
export const IDENTITY_MAT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ID: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const FLIP: Affine = { a: -1, b: 0, c: 0, d: 1, e: 1, f: 0 };
const STEPS = 24;

export function isFullCrop(c: Rect): boolean {
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1;
}

export function isIdentity(g: Geometry): boolean {
  return !g.flipH && g.quarter === 0 && g.straighten === 0 && isFullCrop(g.crop);
}

/** m after n */
export function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function apply(m: Affine, p: Vec2): [number, number] {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** the linear part only (brush deltas, step 6) */
export function applyVec(m: Affine, d: Vec2): [number, number] {
  return [m.a * d[0] + m.c * d[1], m.b * d[0] + m.d * d[1]];
}

/** q clockwise quarter turns of normalized coordinates: R1 (x, y) → (1 − y, x), R2 → (1 − x, 1 − y), R3 → (y, 1 − x) */
export function quarterAffine(q: Quarter): Affine {
  switch (q) {
    case 0:
      return ID;
    case 1:
      return { a: 0, b: 1, c: -1, d: 0, e: 1, f: 0 };
    case 2:
      return { a: -1, b: 0, c: 0, d: -1, e: 1, f: 1 };
    case 3:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: 1 };
  }
}

export function eSize(g: Pick<Geometry, 'quarter'>, o: Size): Size {
  return g.quarter % 2 === 1 ? { width: o.height, height: o.width } : { width: o.width, height: o.height };
}

/** the U frame's quarter: E = U, or E = mirror_x(U) (C §3.5) */
export function upQuarter(g: Pick<Geometry, 'flipH' | 'quarter'>): Quarter {
  return (g.flipH ? (4 - g.quarter) % 4 : g.quarter) as Quarter;
}

export function oToE(g: Pick<Geometry, 'flipH' | 'quarter'>): Affine {
  const r = quarterAffine(g.quarter);
  return g.flipH ? compose(r, FLIP) : r;
}

export function eToO(g: Pick<Geometry, 'flipH' | 'quarter'>): Affine {
  return invert(oToE(g));
}

/** E-normalized → the straightened plane (rotation in pixels about the E centre, rigid when W ≠ H), normalized to E */
function plane(g: Geometry, oSize: Size): Affine {
  if (g.straighten === 0) return ID;
  const { width: W, height: H } = eSize(g, oSize);
  const t = (g.straighten * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const S: Affine = { a: W, b: 0, c: 0, d: H, e: -W / 2, f: -H / 2 };
  const R: Affine = { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
  const N: Affine = { a: 1 / W, b: 0, c: 0, d: 1 / H, e: 0.5, f: 0.5 };
  return compose(N, compose(R, S));
}

function cropAffine(k: Rect): Affine {
  return isFullCrop(k) ? ID : { a: 1 / k.w, b: 0, c: 0, d: 1 / k.h, e: -k.x / k.w, f: -k.y / k.h };
}

export function eToV(g: Geometry, oSize: Size): Affine {
  return compose(cropAffine(g.crop), plane(g, oSize));
}

export function vToE(g: Geometry, oSize: Size): Affine {
  return invert(eToV(g, oSize));
}

export function oToV(g: Geometry, oSize: Size): Affine {
  return compose(eToV(g, oSize), oToE(g));
}

export function vToO(g: Geometry, oSize: Size): Affine {
  return invert(oToV(g, oSize));
}

/** column-major mat3 for `uGeo * vec3(v, 1.0)` */
export function glMat3(m: Affine): Float32Array {
  return new Float32Array([m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1]);
}

/** V pixel size at the density of `oPx` (the O size in pixels) */
export function viewSize(g: Geometry, oPx: Size): Size {
  const e = eSize(g, oPx);
  return { width: Math.max(1, Math.round(g.crop.w * e.width)), height: Math.max(1, Math.round(g.crop.h * e.height)) };
}

/** θ = 0 only: the crop edges on whole pixels of `oPx`, so crop / quarter turn / flip are pixel copies (S §1.3) */
export function snapCrop(g: Geometry, oPx: Size): Geometry {
  if (g.straighten !== 0 || isFullCrop(g.crop)) return g;
  const { width: W, height: H } = eSize(g, oPx);
  const x0 = Math.round(g.crop.x * W);
  const y0 = Math.round(g.crop.y * H);
  const x1 = Math.max(x0 + 1, Math.round((g.crop.x + g.crop.w) * W));
  const y1 = Math.max(y0 + 1, Math.round((g.crop.y + g.crop.h) * H));
  return { ...g, crop: { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H } };
}

/** the crop's aspect in E pixels */
export function cropAspectPx(g: Geometry, oSize: Size): number {
  const e = eSize(g, oSize);
  return (g.crop.w * e.width) / (g.crop.h * e.height);
}

/** 5 % of each E dimension and ≥ MIN_CROP_PX working px; 1 (the full frame) for an axis shorter than that */
export function minCrop(g: Pick<Geometry, 'quarter'>, oSize: Size): { w: number; h: number } {
  const e = eSize(g, oSize);
  return {
    w: Math.min(1, Math.max(MIN_CROP_FRAC, MIN_CROP_PX / e.width)),
    h: Math.min(1, Math.max(MIN_CROP_FRAC, MIN_CROP_PX / e.height)),
  };
}

/** every crop corner inside [0,1]² and inside the straightened image (both convex: the corners decide) */
export function cropFits(g: Geometry, oSize: Size, eps = 1e-9): boolean {
  const { width: W, height: H } = eSize(g, oSize);
  const t = (g.straighten * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = g.crop;
  const corners: Vec2[] = [
    [k.x, k.y],
    [k.x + k.w, k.y],
    [k.x, k.y + k.h],
    [k.x + k.w, k.y + k.h],
  ];
  for (const [px, py] of corners) {
    if (!(px >= -eps && py >= -eps && px <= 1 + eps && py <= 1 + eps)) return false;
    const x = (px - 0.5) * W;
    const y = (py - 0.5) * H;
    // back into E: Rot_{−θ}
    if (Math.abs(c * x + s * y) > W / 2 + eps * W || Math.abs(-s * x + c * y) > H / 2 + eps * H) return false;
  }
  return true;
}

export function cropValid(g: Geometry, oSize: Size, eps = 1e-9): boolean {
  const m = minCrop(g, oSize);
  return g.crop.w >= m.w - eps && g.crop.h >= m.h - eps && cropFits(g, oSize, eps);
}

/** the largest centred crop of pixel aspect `a` inside the image straightened by θ and inside the E frame (S §3.3) */
export function maxFit(theta: number, W: number, H: number, a: number): Rect {
  const t = (Math.abs(theta) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const h = Math.min(W / (a * c + s), H / (a * s + c), H, W / a);
  // a full axis is exactly 1, so the untouched crop at θ = 0 is exactly the identity crop
  const unit = (v: number) => (v > 1 - 1e-9 ? 1 : v);
  const nw = unit((a * h) / W);
  const nh = unit(h / H);
  return { x: (1 - nw) / 2, y: (1 - nh) / 2, w: nw, h: nh };
}

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

export function isMaxFit(g: Geometry, oSize: Size): boolean {
  const e = eSize(g, oSize);
  const m = maxFit(g.straighten, e.width, e.height, cropAspectPx(g, oSize));
  const k = g.crop;
  return near(k.x, m.x, 1e-4) && near(k.y, m.y, 1e-4) && near(k.w, m.w, 1e-4) && near(k.h, m.h, 1e-4);
}

/**
 * Valid and idempotent (S §3.3): 1. the centre into the valid region (toward the E centre), 2. shrink about the centre,
 * 3. the minimum size, moving the centre toward the E centre until it fits. The pixel aspect is kept whenever a crop of
 * that aspect can meet the minimum size; a sliver aspect that cannot (only a corrupt record has one: gestures and ratios
 * never make it) becomes the max-fit of the E frame's own aspect, so the result is always valid. A photo too small for
 * MIN_CROP_PX keeps its full frame at θ = 0 (S §7); at θ ≠ 0 it gets the max-fit, which fits but cannot be full.
 */
export function cropConstrain(g: Geometry, oSize: Size): Geometry {
  if (cropValid(g, oSize)) return g;
  const e = eSize(g, oSize);
  const k = g.crop;
  const aspect = Number.isFinite(k.w / k.h) && k.w > 0 && k.h > 0 ? (k.w * e.width) / (k.h * e.height) : e.width / e.height;
  const fit = (a: number): Geometry => ({ ...g, crop: maxFit(g.straighten, e.width, e.height, a) });
  const fallback = (): Geometry => {
    const kept = fit(aspect);
    return cropValid(kept, oSize) ? kept : fit(e.width / e.height);
  };
  if (![k.x, k.y, k.w, k.h].every(Number.isFinite) || !(k.w > 0 && k.h > 0)) return fallback();
  const m = minCrop(g, oSize);
  const fitsAt = (cx: number, cy: number, w: number, h: number) => cropFits({ ...g, crop: { x: cx - w / 2, y: cy - h / 2, w, h } }, oSize);
  let cx = k.x + k.w / 2;
  let cy = k.y + k.h / 2;
  let w = k.w;
  let h = k.h;
  const towardCentre = (sw: number, sh: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < STEPS; i++) {
      const t = (lo + hi) / 2;
      if (fitsAt(cx + t * (0.5 - cx), cy + t * (0.5 - cy), sw, sh)) hi = t;
      else lo = t;
    }
    cx += hi * (0.5 - cx);
    cy += hi * (0.5 - cy);
  };
  if (!fitsAt(cx, cy, 0, 0)) towardCentre(0, 0);
  if (!fitsAt(cx, cy, w, h)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < STEPS; i++) {
      const s = (lo + hi) / 2;
      if (fitsAt(cx, cy, w * s, h * s)) lo = s;
      else hi = s;
    }
    w *= lo;
    h *= lo;
  }
  if (!(w > 0 && h > 0)) return fallback();
  if (w < m.w || h < m.h) {
    const s = Math.max(m.w / w, m.h / h);
    w *= s;
    h *= s;
    if (!fitsAt(cx, cy, w, h)) {
      if (!fitsAt(0.5, 0.5, w, h)) return fallback();
      towardCentre(w, h);
    }
  }
  return { ...g, crop: { x: cx - w / 2, y: cy - h / 2, w, h } };
}

/** 旋轉: the view turns 90° counter-clockwise; the crop follows the content (S §3.3) */
export function rotateLeft(g: Geometry): Geometry {
  const c = g.crop;
  return { ...g, quarter: ((g.quarter + 3) % 4) as Quarter, crop: { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w } };
}

/** 翻轉 in the view, canonical form F∘R_q = R_{−q}∘F (C §3.5) */
export function flipView(g: Geometry): Geometry {
  return {
    flipH: !g.flipH,
    quarter: ((4 - g.quarter) % 4) as Quarter,
    straighten: g.straighten === 0 ? 0 : -g.straighten,
    crop: { ...g.crop, x: 1 - g.crop.x - g.crop.w },
  };
}

export function clampStraighten(theta: number): number {
  if (!Number.isFinite(theta)) return 0;
  const r = Math.round(Math.max(-45, Math.min(45, theta)) * 10) / 10;
  return r === 0 ? 0 : r;
}

/** one 拉直 drag step, always from the gesture's start geometry (S §3.3) */
export function setStraighten(start: Geometry, theta: number, oSize: Size): Geometry {
  const t = clampStraighten(theta);
  if (t === start.straighten) return start;
  if (isMaxFit(start, oSize)) {
    const e = eSize(start, oSize);
    return { ...start, straighten: t, crop: maxFit(t, e.width, e.height, cropAspectPx(start, oSize)) };
  }
  return cropConstrain({ ...start, straighten: t }, oSize);
}

// ── ratio locks (S §2.1; the ratio is width:height like the camera's RATIO_VALUE, ui/state.ts:14) ──

export type CropLock = 'free' | 'original' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
export const CROP_LOCKS: readonly CropLock[] = ['free', 'original', '1:1', '3:4', '4:3', '9:16', '16:9'];
const FIXED: Record<Exclude<CropLock, 'free' | 'original'>, number> = { '1:1': 1, '3:4': 3 / 4, '4:3': 4 / 3, '9:16': 9 / 16, '16:9': 16 / 9 };

/** pixel aspect of a lock; 原比例 = the E frame's aspect; 自由 = null */
export function lockAspect(lock: CropLock, g: Pick<Geometry, 'quarter'>, oSize: Size): number | null {
  if (lock === 'free') return null;
  if (lock === 'original') {
    const e = eSize(g, oSize);
    return e.width / e.height;
  }
  return FIXED[lock];
}

/** the centred max-fit of the lock's aspect; unchanged for 自由 or when the crop already has that aspect */
export function applyRatio(g: Geometry, lock: CropLock, oSize: Size): Geometry {
  const a = lockAspect(lock, g, oSize);
  if (a === null || Math.abs(cropAspectPx(g, oSize) / a - 1) <= 0.005) return g;
  const e = eSize(g, oSize);
  return { ...g, crop: maxFit(g.straighten, e.width, e.height, a) };
}

export function lockFor(g: Geometry, oSize: Size): CropLock {
  if (isFullCrop(g.crop)) return 'free';
  const a = cropAspectPx(g, oSize);
  for (const l of CROP_LOCKS) {
    if (l === 'free') continue;
    const b = lockAspect(l, g, oSize)!;
    if (Math.abs(a / b - 1) <= 0.005) return l;
  }
  return 'free';
}

export function transposeLock(l: CropLock): CropLock {
  switch (l) {
    case '3:4':
      return '4:3';
    case '4:3':
      return '3:4';
    case '9:16':
      return '16:9';
    case '16:9':
      return '9:16';
    default:
      return l;
  }
}

// ── crop mode (S §2.1, §3.2) ──

export interface CropLayout {
  /** the upright E frame fitted into the stage minus the inset, stage px */
  eBox: Rect;
  /** the canvas CSS box before its transform: the O aspect, centred on eBox, stage px */
  canvas: Rect;
  /** CSS `scaleX(sx) rotate(angle deg)`: equal to `rotate(θ + 90°·q) scaleX(±1)`, written mirror-first so a 翻轉 animates as a pure mirror */
  sx: 1 | -1;
  /** degrees, unwrapped toward the previous angle so 270° → 0° turns 90° */
  angle: number;
  /** the crop box, stage px (axis-aligned: the crop is axis-aligned in the plane) */
  cropBox: Rect;
}

export function cropModeLayout(stage: Size, oSize: Size, g: Geometry, inset = 24, prevAngle?: number): CropLayout {
  const e = eSize(g, oSize);
  const aw = Math.max(1, stage.width - 2 * inset);
  const ah = Math.max(1, stage.height - 2 * inset);
  const k = Math.min(aw / e.width, ah / e.height);
  const eBox: Rect = { x: (stage.width - e.width * k) / 2, y: (stage.height - e.height * k) / 2, w: e.width * k, h: e.height * k };
  const cx = eBox.x + eBox.w / 2;
  const cy = eBox.y + eBox.h / 2;
  const cw = oSize.width * k;
  const ch = oSize.height * k;
  const sx: 1 | -1 = g.flipH ? -1 : 1;
  const target = sx * (g.straighten + 90 * g.quarter);
  const angle = prevAngle === undefined ? target : prevAngle + (((((target - prevAngle) % 360) + 540) % 360) - 180);
  return {
    eBox,
    canvas: { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch },
    sx,
    angle,
    cropBox: { x: eBox.x + g.crop.x * eBox.w, y: eBox.y + g.crop.y * eBox.h, w: g.crop.w * eBox.w, h: g.crop.h * eBox.h },
  };
}

export function cssTurn(l: Pick<CropLayout, 'sx' | 'angle'>): string {
  return `scaleX(${l.sx}) rotate(${l.angle}deg)`;
}

// ── overlays in normal mode (S §2.2) ──

/** V-normalized bounding box of O-space (x, y) pairs (a face oval: the drawn face box) */
export function ovalViewBox(points: Float32Array, g: Geometry, oSize: Size): Rect {
  const m = oToV(g, oSize);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = apply(m, [points[i], points[i + 1]]);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** a person chip's O thumbnail shown upright (θ ignored) */
export function chipTransform(g: Pick<Geometry, 'flipH' | 'quarter'>): string {
  return `rotate(${90 * g.quarter}deg) scaleX(${g.flipH ? -1 : 1})`;
}

/** the E frame inside the V frame, in % of the frame, rotated by θ about its centre: the 增高 lines are E rows */
export function bandPlane(g: Geometry): { left: number; top: number; width: number; height: number; rotate: number } {
  const k = g.crop;
  const z = (v: number) => (v === 0 ? 0 : v); // no −0 in styles or snapshots
  return { left: z((-k.x / k.w) * 100), top: z((-k.y / k.h) * 100), width: 100 / k.w, height: 100 / k.h, rotate: g.straighten };
}

/** the E row under a V point (a 增高 drag: client → V → E, C §3.5) */
export function eYAt(g: Geometry, oSize: Size, v: Vec2): number {
  return apply(vToE(g, oSize), v)[1];
}
```

- [x] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/geometry/view.test.ts`
Expected: PASS (all tests in `view.test.ts`). Then `npm run typecheck` — Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/config/limits.ts src/types.ts src/geometry/view.ts src/geometry/view.test.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: geometry spaces and crop math (view.ts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Crop gestures (`src/geometry/cropModel.ts`)

**Files:**
- Create: `src/geometry/cropModel.ts`, `src/geometry/cropModel.test.ts`

**Interfaces:**
- Consumes (Task 1): `cropFits`, `cropValid`, `eSize`, `lockAspect`, `minCrop`, `CropLock`, `transposeLock`.
- Produces: `type Corner = 'tl'|'tr'|'bl'|'br'`; `type Edge = 'top'|'bottom'|'left'|'right'`; `dragCorner(start: Geometry, corner: Corner, d: Vec2, lock: CropLock, oSize: Size): Geometry`; `dragEdge(start, edge: Edge, d: Vec2, oSize): Geometry`; `dragMove(start, d: Vec2, oSize): Geometry`; re-exports `CropLock`, `lockAspect`, `transposeLock` (S §3.8 lists them here; they live in `view.ts` because `applyRatio`/`lockFor` need them, which avoids an import cycle). `d` is the finger delta in the plane, normalized to the E frame (stage px ÷ `eBox.w`/`eBox.h`).

- [x] **Step 1: Write the failing tests**

Create `src/geometry/cropModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Geometry } from '../types';
import { dragCorner, dragEdge, dragMove, type Corner, type Edge } from './cropModel';
import { applyRatio, clampStraighten, cropAspectPx, cropConstrain, cropValid, IDENTITY_GEOMETRY, lockAspect, minCrop, type CropLock, type Quarter } from './view';

const O = { width: 2048, height: 1536 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const LOCKS: CropLock[] = ['free', 'original', '1:1', '3:4', '4:3', '9:16', '16:9'];

function start(r: () => number, lock: CropLock): Geometry {
  const base: Geometry = {
    flipH: r() < 0.5,
    quarter: Math.floor(r() * 4) as Quarter,
    straighten: clampStraighten(-30 + 60 * r()),
    crop: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  };
  const fitted = applyRatio(cropConstrain(base, O), lock, O);
  return cropConstrain(fitted, O);
}

describe('crop gestures (fuzzed)', () => {
  it('every corner, edge and move result is valid; a lock keeps its aspect; the minimum size holds', () => {
    const r = rng(11);
    for (let i = 0; i < 600; i++) {
      const lock = LOCKS[Math.floor(r() * LOCKS.length)];
      const g = start(r, lock);
      const d = [-0.6 + 1.2 * r(), -0.6 + 1.2 * r()] as const;
      const m = minCrop(g, O);
      const corner = dragCorner(g, CORNERS[Math.floor(r() * 4)], d, lock, O);
      expect(cropValid(corner, O, 1e-7)).toBe(true);
      const a = lockAspect(lock, g, O);
      // a start that already has the lock's aspect keeps it exactly through the gesture
      if (a !== null && corner !== g && Math.abs(cropAspectPx(g, O) / a - 1) < 1e-9) expect(cropAspectPx(corner, O)).toBeCloseTo(a, 5);
      const edge = dragEdge(g, EDGES[Math.floor(r() * 4)], d, O);
      expect(cropValid(edge, O, 1e-7)).toBe(true);
      const move = dragMove(g, d, O);
      expect(cropValid(move, O, 1e-7)).toBe(true);
      expect(move.crop.w).toBeCloseTo(g.crop.w, 12);
      for (const out of [corner, edge, move]) {
        expect(out.crop.w).toBeGreaterThanOrEqual(m.w - 1e-7);
        expect(out.crop.h).toBeGreaterThanOrEqual(m.h - 1e-7);
      }
    }
  });

  it('a corner drag keeps the opposite corner fixed', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
    const out = dragCorner(g, 'br', [-0.1, -0.05], 'free', O);
    expect(out.crop.x).toBe(0.2);
    expect(out.crop.y).toBe(0.2);
    expect(out.crop.w).toBeCloseTo(0.4, 12);
    expect(out.crop.h).toBeCloseTo(0.45, 12);
  });

  it('with a lock the dominant axis (in pixels) drives the size', () => {
    const g = applyRatio(IDENTITY_GEOMETRY, '1:1', O);
    const out = dragCorner(g, 'tl', [0.1, 0.01], '1:1', O);
    expect(out.crop.w * O.width).toBeCloseTo(g.crop.w * O.width - 0.1 * O.width, 6);
    expect(cropAspectPx(out, O)).toBeCloseTo(1, 9);
  });

  it('a move slides along a limit instead of stopping', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.5, y: 0.2, w: 0.5, h: 0.3 } };
    const out = dragMove(g, [0.2, 0.1], O);
    expect(out.crop.x).toBeCloseTo(0.5, 12); // already at the right edge
    expect(out.crop.y).toBeCloseTo(0.3, 6); // still moved down
  });

  it('an edge drag stops at the minimum size', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
    const out = dragEdge(g, 'right', [-0.9, 0], O);
    expect(out.crop.w).toBeCloseTo(minCrop(g, O).w, 6);
    expect(out.crop.x).toBe(0.2);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/geometry/cropModel.test.ts`
Expected: FAIL — `Failed to resolve import "./cropModel"`.

- [x] **Step 3: Implement `src/geometry/cropModel.ts`**

```ts
// Crop box gestures in 裁切 mode (S §2.1, §3.3): pure reducers from the geometry at gesture start and the finger delta in
// the plane (normalized to the E frame). Every result is valid: the limits are found by bisection, so the box stops
// (or slides, for a move) where it would leave the straightened photo or the E frame, and never gets below minCrop.
import type { Geometry, Rect, Size } from '../types';
import { cropFits, eSize, lockAspect, minCrop, type CropLock, type Vec2 } from './view';

export { lockAspect, transposeLock, type CropLock } from './view';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Edge = 'top' | 'bottom' | 'left' | 'right';

const STEPS = 24;
const withCrop = (g: Geometry, crop: Rect): Geometry => ({ ...g, crop });

/** the largest t in [0, 1] with ok(t), given ok(0) */
function bisect(ok: (t: number) => boolean): number {
  if (ok(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < STEPS; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

export function dragCorner(start: Geometry, corner: Corner, d: Vec2, lock: CropLock, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'bl' || corner === 'br';
  const ax = right ? c.x : c.x + c.w;
  const ay = bottom ? c.y : c.y + c.h;
  const e = eSize(start, oSize);
  const m = minCrop(start, oSize);
  let w = c.w + (right ? d[0] : -d[0]);
  let h = c.h + (bottom ? d[1] : -d[1]);
  const a = lockAspect(lock, start, oSize);
  if (a !== null) {
    if (Math.abs(d[0] * e.width) >= Math.abs(d[1] * e.height)) h = (w * e.width) / (a * e.height);
    else w = (a * h * e.height) / e.width;
    if (!(w >= m.w && h >= m.h)) {
      h = Math.max(m.h, (m.w * e.width) / (a * e.height));
      w = (a * h * e.height) / e.width;
    }
  } else {
    w = Math.max(w, m.w);
    h = Math.max(h, m.h);
  }
  const rect = (t: number): Rect => {
    const wt = c.w + t * (w - c.w);
    const ht = c.h + t * (h - c.h);
    return { x: right ? ax : ax - wt, y: bottom ? ay : ay - ht, w: wt, h: ht };
  };
  const t = bisect((s) => cropFits(withCrop(start, rect(s)), oSize));
  return t === 0 ? start : withCrop(start, rect(t));
}

/** 自由 only (the strip shows edge handles only then) */
export function dragEdge(start: Geometry, edge: Edge, d: Vec2, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const m = minCrop(start, oSize);
  let rect: (t: number) => Rect;
  switch (edge) {
    case 'left': {
      const x1 = c.x + c.w;
      const nx = Math.min(c.x + d[0], x1 - m.w);
      rect = (t) => {
        const x = c.x + t * (nx - c.x);
        return { x, y: c.y, w: x1 - x, h: c.h };
      };
      break;
    }
    case 'right': {
      const nw = Math.max(c.w + d[0], m.w);
      rect = (t) => ({ ...c, w: c.w + t * (nw - c.w) });
      break;
    }
    case 'top': {
      const y1 = c.y + c.h;
      const ny = Math.min(c.y + d[1], y1 - m.h);
      rect = (t) => {
        const y = c.y + t * (ny - c.y);
        return { x: c.x, y, w: c.w, h: y1 - y };
      };
      break;
    }
    case 'bottom': {
      const nh = Math.max(c.h + d[1], m.h);
      rect = (t) => ({ ...c, h: c.h + t * (nh - c.h) });
      break;
    }
  }
  const t = bisect((s) => cropFits(withCrop(start, rect(s)), oSize));
  return t === 0 ? start : withCrop(start, rect(t));
}

/** one finger inside the box: the box moves over the fixed photo and slides along a limit (S D2) */
export function dragMove(start: Geometry, d: Vec2, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const at = (dx: number, dy: number) => withCrop(start, { ...c, x: c.x + dx, y: c.y + dy });
  const t = bisect((s) => cropFits(at(s * d[0], s * d[1]), oSize));
  let dx = t * d[0];
  let dy = t * d[1];
  const rx = d[0] - dx;
  const ry = d[1] - dy;
  dx += bisect((s) => cropFits(at(dx + s * rx, dy), oSize)) * rx;
  dy += bisect((s) => cropFits(at(dx, dy + s * ry), oSize)) * ry;
  return dx === 0 && dy === 0 ? start : at(dx, dy);
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/geometry/cropModel.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src/geometry/cropModel.ts src/geometry/cropModel.test.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: crop handle, edge and move gestures (cropModel.ts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Geometry in the edit state

**Files:**
- Modify: `src/types.ts` (step-1 `PhotoParams` `:169-180`, S1 §3.2; `RenderInput` `:444-469`), `src/edit/state.ts` (step 1: `defaultPhoto` `:51-57`, `sanitizePhoto` `:212-233`, `sanitizeEditState` `:245-259`), `src/edit/frame.ts` (step 1, `buildFrame` `:17-41`), `src/edit/migrate.ts` (step 1, `openState` `:51-85`), `src/store/history.ts` (`normalizeEntry` `:192`), every `PhotoParams` literal that `npm run typecheck` reports after the type change (step 1's `defaultPhoto`, `splitLegacy` and their tests; `cameraShotEdit` / `importEdit` reuse the camera look's photo, which has no literal)
- Test: `src/edit/state.test.ts`, `src/edit/frame.test.ts`, `src/edit/migrate.test.ts` (step-1 files; add cases)

**Interfaces:**
- Consumes (step 1, S1 §3.1–3.2, §5.3–5.4; C §3.2): `EditState`, `PhotoParams`, `defaultPhoto()`, `neutralPerson()`, `naturalPerson()`, `sanitizePhoto(raw, persons)`, `sanitizeEditState(raw, personIds | null)`, `editKey(edit)`, `buildFrame(edit, …)` (returns the `StillFrame` passed to `session.render`), `openState(entry, size)`. (Task 1): `IDENTITY_GEOMETRY`, `isIdentity`, `rotateLeft`, `flipView`, `cropValid`, `cropConstrain`, `clampStraighten`.
- Produces: `PhotoParams.geometry: Geometry`; `defaultPhoto().geometry === IDENTITY_GEOMETRY` (so 重置 resets geometry, C §12 #23); in `src/edit/state.ts`: `editSetGeometry(edit, g): EditState`, `editRotateLeft(edit): EditState` (clears `heightBand`), `editFlipView(edit): EditState` (keeps it), `editResetGeometry(edit): EditState`, `sanitizeGeometry(raw: unknown, oSize?: Size | null): Geometry`; `sanitizePhoto(raw, persons, oSize?: Size | null)`; `sanitizeEditState(raw, personIds, oSize?: Size)` (S D13); `RenderInput.geometry?: Geometry` (moved here from Task 8: `buildFrame` returns a `StillFrame` literal, so the field must exist before the frame can carry it); `buildFrame(...)` result gains `geometry: edit.photo.geometry`; `openState` validates the stored geometry against `{width: entry.width, height: entry.height}` on every v2 path; `normalizeEntry` (`history.ts:192`) sanitizes a stored edit with the entry's `{width, height}` (without it every read would reset the geometry to identity).

- [x] **Step 1: Write the failing tests**

Add to `src/edit/state.test.ts`:

```ts
import { cropConstrain, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import type { EditState, Geometry } from '../types';
import {
  defaultPhoto,
  editFlipView,
  editKey,
  editResetGeometry,
  editRotateLeft,
  editSetGeometry,
  naturalPerson,
  neutralPerson,
  sanitizeEditState,
  sanitizeGeometry,
} from './state';

const OSIZE = { width: 1536, height: 2048 };
const base = (): EditState => ({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });

describe('geometry in the edit state (step 3)', () => {
  it('defaultPhoto carries the identity geometry, so 重置 resets crop and rotation', () => {
    expect(defaultPhoto().geometry).toEqual(IDENTITY_GEOMETRY);
  });

  it('旋轉 clears the 增高 band in the same state; ↶ to the previous state brings both back (Review Focus 2)', () => {
    const banded: EditState = { ...base(), photo: { ...base().photo, heightBand: { top: 0.5, bottom: 0.9, amount: 0.6 } } };
    const turned = editRotateLeft(banded);
    expect(turned.photo.heightBand).toBeNull();
    expect(turned.photo.geometry.quarter).toBe(3);
    // one new state: the previous one is untouched, so one undo step restores geometry and band together
    expect(banded.photo.heightBand).toEqual({ top: 0.5, bottom: 0.9, amount: 0.6 });
    expect(banded.photo.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(turned.persons).toBe(banded.persons);
  });

  it('翻轉 keeps the band; 還原 is one state and a no-op at identity; geometry changes the edit key', () => {
    const banded: EditState = { ...base(), photo: { ...base().photo, heightBand: { top: 0.5, bottom: 0.9, amount: 0.6 } } };
    const flipped = editFlipView(banded);
    expect(flipped.photo.heightBand).toEqual(banded.photo.heightBand);
    expect(flipped.photo.geometry.flipH).toBe(true);
    expect(editKey(flipped)).not.toBe(editKey(banded));
    const reset = editResetGeometry(flipped);
    expect(reset.photo.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(editResetGeometry(reset)).toBe(reset);
    const g: Geometry = rotateLeft(IDENTITY_GEOMETRY);
    const e = editSetGeometry(base(), g);
    expect(editSetGeometry(e, g)).toBe(e);
  });

  it('sanitizeGeometry: identity without oSize; mistyped fields reset; float noise constrained; a far crop resets all', () => {
    const ok: Geometry = cropConstrain({ flipH: true, quarter: 1, straighten: 12.3, crop: { x: 0.1, y: 0.1, w: 0.7, h: 0.6 } }, OSIZE);
    expect(sanitizeGeometry(ok)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry(ok, OSIZE)).toEqual(ok);
    const small: Geometry = { flipH: false, quarter: 0, straighten: 99, crop: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } };
    expect(sanitizeGeometry(small, OSIZE).straighten).toBe(45);
    expect(sanitizeGeometry({ ...ok, quarter: 7, flipH: 'yes' }, OSIZE)).toMatchObject({ quarter: 0, flipH: false });
    const noisy = { ...ok, crop: { ...ok.crop, w: ok.crop.w + 5e-5 } };
    const fixed = sanitizeGeometry(noisy, OSIZE);
    expect(fixed).not.toEqual(IDENTITY_GEOMETRY);
    expect(fixed.crop.w).toBeLessThanOrEqual(noisy.crop.w);
    expect(sanitizeGeometry({ ...ok, crop: { x: 0.6, y: 0.6, w: 0.9, h: 0.9 } }, OSIZE)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry({ ...ok, crop: { x: Number.NaN, y: 0, w: 1, h: 1 } }, OSIZE)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry('garbage', OSIZE)).toEqual(IDENTITY_GEOMETRY);
  });

  it('sanitizeEditState threads oSize to the geometry (S D13); the camera look (no oSize) is always identity', () => {
    const raw = { ...base(), photo: { ...base().photo, geometry: rotateLeft(IDENTITY_GEOMETRY) } };
    expect(sanitizeEditState(raw, null, OSIZE).photo.geometry.quarter).toBe(3);
    expect(sanitizeEditState(raw, null).photo.geometry).toEqual(IDENTITY_GEOMETRY);
  });
});
```

Add to `src/edit/frame.test.ts`:

```ts
it('the frame carries the photo geometry (the engine reads RenderInput.geometry, step 3)', () => {
  const edit = editRotateLeft({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
  const frame = buildFrame(edit, [], [], new Map(), 'p0');
  expect(frame.geometry).toBe(edit.photo.geometry);
});
```

(Step 1's `buildFrame(edit, faces, obstacles, protects, primary, warpScales?)`: the no-face call of the file's second test plus the primary; `editRotateLeft` joins the file's `./state` import.)

Add to `src/edit/migrate.test.ts`:

```ts
it('opens a v2 entry with its stored geometry, validated against the entry size (S §5)', () => {
  const edit = editFlipView({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
  const entry = {
    id: 'g1', createdAt: 1, updatedAt: 1,
    original: new Blob(['o'], { type: 'image/jpeg' }), thumb: new Blob(['t'], { type: 'image/jpeg' }),
    width: 1536, height: 2048, schema: 2 as const, edit, params: defaultParams(),
  };
  expect(openState(entry, { width: 1536, height: 2048 }).edit.photo.geometry.flipH).toBe(true);
  const broken = { ...entry, edit: { ...edit, photo: { ...edit.photo, geometry: { ...edit.photo.geometry, crop: { x: 2, y: 2, w: 1, h: 1 } } } } };
  expect(openState(broken, { width: 1536, height: 2048 }).edit.photo.geometry).toEqual(IDENTITY_GEOMETRY);
});
```

(`defaultParams` from `src/engine/params.ts`; add the imports the snippets use.)

- [x] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/edit/state.test.ts src/edit/frame.test.ts src/edit/migrate.test.ts`
Expected: FAIL — `editRotateLeft is not a function` / `sanitizeGeometry is not exported` / `frame.geometry` undefined.

- [x] **Step 3: Add `geometry` to `PhotoParams` and every literal**

In `src/types.ts`, the step-1 `PhotoParams` gains (keep CRLF):

```ts
  /** crop, rotate, straighten, flip (step 3); photo-level, identity by default */
  geometry: Geometry;
```

and `RenderInput` (`types.ts:444-469`, after step 2's `grainSeed?`) gains the field Task 8's engine reads (until then the engine ignores it):

```ts
  /** crop / rotate / straighten / flip, applied as the final transform in P2 (step 3); default identity */
  geometry?: Geometry;
```

Run `npm run typecheck`; at every reported `PhotoParams` literal (step 1's `defaultPhoto`, `splitLegacy`, `cameraShotEdit`, test builders) add `geometry: IDENTITY_GEOMETRY` (import from `../geometry/view`). This is a mechanical port; no assertion changes.

- [x] **Step 4: Implement the reducers and the sanitizer in `src/edit/state.ts`**

```ts
import { clampStraighten, cropConstrain, cropValid, flipView, IDENTITY_GEOMETRY, isIdentity, rotateLeft } from '../geometry/view';
import type { EditState, Geometry, Size } from '../types';

/** a geometry change (a 裁切 gesture step or commit): one undo step at commit, like a slider (Editor.tsx update, :303-321) */
export function editSetGeometry(edit: EditState, g: Geometry): EditState {
  return g === edit.photo.geometry ? edit : { ...edit, photo: { ...edit.photo, geometry: g } };
}

/** 旋轉: E turns a quarter, so the 增高 band (E rows) is removed in the same undo step (C §3.5) */
export function editRotateLeft(edit: EditState): EditState {
  return { ...edit, photo: { ...edit.photo, geometry: rotateLeft(edit.photo.geometry), heightBand: null } };
}

/** 翻轉: E rows are unchanged, so the band is kept */
export function editFlipView(edit: EditState): EditState {
  return { ...edit, photo: { ...edit.photo, geometry: flipView(edit.photo.geometry) } };
}

/** 還原 */
export function editResetGeometry(edit: EditState): EditState {
  return isIdentity(edit.photo.geometry) ? edit : editSetGeometry(edit, IDENTITY_GEOMETRY);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Stored geometry → a valid one (S §5): without the O size (the camera look) identity; a mistyped field → that field's
 * identity; a crop off the valid region by ≤ 1e-4 (float noise) → cropConstrain; farther → the whole geometry identity.
 */
export function sanitizeGeometry(raw: unknown, oSize?: Size | null): Geometry {
  if (!oSize || !(oSize.width > 0 && oSize.height > 0) || !raw || typeof raw !== 'object') return IDENTITY_GEOMETRY;
  const r = raw as Record<string, unknown>;
  const c = r.crop && typeof r.crop === 'object' ? (r.crop as Record<string, unknown>) : null;
  const cropOk = !!c && finite(c.x) && finite(c.y) && finite(c.w) && finite(c.h) && c.w > 0 && c.h > 0;
  const g: Geometry = {
    flipH: r.flipH === true,
    quarter: r.quarter === 1 || r.quarter === 2 || r.quarter === 3 ? r.quarter : 0,
    straighten: clampStraighten(finite(r.straighten) ? r.straighten : 0),
    crop: cropOk ? { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number } : { ...IDENTITY_GEOMETRY.crop },
  };
  if (cropValid(g, oSize)) return isIdentity(g) ? IDENTITY_GEOMETRY : g;
  if (cropValid(g, oSize, 1e-4)) return cropConstrain(g, oSize);
  return IDENTITY_GEOMETRY;
}
```

In step 1's `src/edit/state.ts` the sanitized photo is built by `sanitizePhoto(raw, persons)` (step-1 plan Task 5), which `sanitizeEditState(raw, personIds)` calls as `sanitizePhoto(r.photo, new Set(Object.keys(persons)))`:
- `sanitizePhoto` gains the third parameter `oSize?: Size | null` and its `photo: PhotoParams` literal gains `geometry: sanitizeGeometry(r.geometry, oSize),` (`r` = the raw photo record it already reads);
- `sanitizeEditState` gains the third parameter `oSize?: Size` (S D13) and passes it: `sanitizePhoto(r.photo, new Set(Object.keys(persons)), oSize)`.

Callers without `oSize` (the camera look in `settings.ts` `sanitizeLook`, `cameraShotEdit`) keep identity geometry. The one stored-edit caller that knows the size is `normalizeEntry` (`src/store/history.ts:192`, `sanitizeEditState(r.edit, null)`): pass the entry's own size, `sanitizeEditState(r.edit, null, { width, height })` (validated just above it), or every `getEntry` / `listEntries` read would reset a saved crop to identity before `openState` sees it.

In `src/edit/frame.ts` (`buildFrame`), add `geometry: edit.photo.geometry` to the returned frame object.

In `src/edit/migrate.ts` (`openState(entry, size)`): step 1 calls `sanitizeEditState` only when a fitting detection cache exists; the other v2 paths (no cache, a dropped cache, a rollback-edited `params`) hand back the stored `edit` as it is, which would let a corrupt geometry through. So, with `const oSize = { width: entry.width, height: entry.height };` (S D13: the stored size of `original`, never the decode size):
- right after `let edit = v2Edit;`, validate the geometry on every v2 path: `edit = { ...edit, photo: { ...edit.photo, geometry: sanitizeGeometry(edit.photo.geometry, oSize) } };`
- pass `oSize` as the third argument of the `sanitizeEditState(edit, d.persons.map((p) => p.id))` call.

(The v1 path builds its edit from `editFromLegacy`, whose photo comes from `defaultPhoto()`: identity.)

- [x] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/edit/ src/store/history.test.ts`
Expected: PASS (all `src/edit/*.test.ts`, history unchanged). Then `npm run typecheck` — no errors.

- [x] **Step 6: Commit**

```bash
git add src/types.ts src/edit/ src/app src/ui src/store tests
git commit -m "$(cat <<'EOF'
v0.4 step 3: photo geometry in EditState (reducers, sanitize, frame)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git add` only the paths that typecheck made you touch; `git status` must show nothing else modified.)

---
### Task 4: Export prefs, crash breadcrumb and 設定 › 輸出

**Files:**
- Create: `src/media/exportPlan.ts` (first part: types, `fullExportBlock`, `exportSizeView`), `src/media/exportPlan.test.ts`
- Modify: `src/types.ts:559-566` (`Prefs`), `src/store/settings.ts:10-85` (+ new keys), `src/ui/components/Controls.tsx:47-74` (`Segmented`), `src/ui/screens/Settings.tsx:88-103` (new group between 拍攝 and 效能), `src/ui/deps.ts:12, 41-70` (CRLF), `src/ui/app.tsx:22-41` (CRLF, launch toast), the Prefs literals typecheck reports (`src/app/testFakes.ts:337-347` (CRLF), `src/bench/main.ts:82-89` (CRLF), `src/store/settings.test.ts:194-201`)
- Test: `src/store/settings.test.ts`, `src/media/exportPlan.test.ts`, `tests/e2e/settings.spec.ts` (new test)

**Interfaces:**
- Consumes: `Tier`, `Prefs` (`src/types.ts`); `autoTierSession()` (`src/app/live.ts:60`, already in `deps`).
- Produces (`src/types.ts`): `type ExportFormat = 'jpeg' | 'png'`; `type ExportSize = 'full' | 'standard'`; `Prefs.exportFormat: ExportFormat`, `Prefs.exportSize: ExportSize`.
- Produces (`src/store/settings.ts`): `EXPORT_GUARD_KEY = 'meiyan.exportGuard.v1'`, `EXPORT_CAP_KEY = 'meiyan.exportCap.v1'`, `EXPORT_DEBUG_KEY = 'meiyan.debug.export.v1'`, `EXPORT_CAP_EDGE = 2048`; `interface ExportGuard {at: number; w: number; h: number; format: ExportFormat}`; `writeExportGuard(g: ExportGuard): void`; `clearExportGuard(): void`; `readExportGuard(): ExportGuard | null`; `consumeExportGuardAtLaunch(): boolean`; `exportCapped(): boolean`; `clearExportCap(): void`; `interface ExportDebugKnob {tile?: 256|512|1024|2048; slowMs?: number; failAt?: 'decode'|'tile'|'encode'}`; `readExportDebug(): ExportDebugKnob`.
- Produces (`src/media/exportPlan.ts`): re-exports `ExportFormat`, `ExportSize`; `type FullBlock = 'tierL'|'tierLow'|'device'|'guard'|null`; `interface ExportEnv {prefTier: Prefs['tier']; autoTier: Tier; screen: {width: number; height: number}; capped: boolean}`; `isSeClassScreen(s): boolean`; `fullExportBlock(env): FullBlock`; `interface ExportSizeView {value: ExportSize; fullDisabled: boolean; sub: string}`; `exportSizeView(pref: ExportSize, block: FullBlock): ExportSizeView`; `EXPORT_COPY` (the step's export strings).
- Produces (`Segmented`): optional prop `disabled?: readonly T[]`. (`deps`): `consumeExportGuardAtLaunch`, `exportCapped`, `clearExportCap`, `readExportDebug`.

- [x] **Step 1: Write the failing tests**

Add to `src/store/settings.test.ts` (and port the `const p: Prefs` literal at `settings.test.ts:194-201` by adding `exportFormat: 'png', exportSize: 'standard',` — the round trip then covers the new fields):

```ts
import {
  clearExportCap,
  clearExportGuard,
  consumeExportGuardAtLaunch,
  EXPORT_CAP_KEY,
  EXPORT_DEBUG_KEY,
  EXPORT_GUARD_KEY,
  exportCapped,
  readExportDebug,
  readExportGuard,
  writeExportGuard,
} from './settings';

describe('export prefs and keys (step 3)', () => {
  it('default to JPEG at full resolution; invalid values fall back to the defaults', () => {
    expect(DEFAULT_PREFS).toMatchObject({ exportFormat: 'jpeg', exportSize: 'full' });
    expect(sanitizePrefs({ exportFormat: 'png', exportSize: 'standard' })).toMatchObject({ exportFormat: 'png', exportSize: 'standard' });
    expect(sanitizePrefs({ exportFormat: 'heic', exportSize: 4096 })).toMatchObject({ exportFormat: 'jpeg', exportSize: 'full' });
  });

  it('the breadcrumb is written, read with a shape check, and cleared', () => {
    writeExportGuard({ at: 5, w: 4096, h: 3072, format: 'png' });
    expect(EXPORT_GUARD_KEY).toBe('meiyan.exportGuard.v1');
    expect(readExportGuard()).toEqual({ at: 5, w: 4096, h: 3072, format: 'png' });
    clearExportGuard();
    expect(readExportGuard()).toBeNull();
    store.setItem(EXPORT_GUARD_KEY, '{"at":"x"}');
    expect(readExportGuard()).toBeNull();
  });

  it('at launch a breadcrumb sets the 2048 cap once and is removed; a malformed one is removed without a cap', () => {
    writeExportGuard({ at: 1, w: 4000, h: 3000, format: 'jpeg' });
    expect(consumeExportGuardAtLaunch()).toBe(true);
    expect(store.getItem(EXPORT_GUARD_KEY)).toBeNull();
    expect(store.getItem(EXPORT_CAP_KEY)).toBe('2048');
    expect(exportCapped()).toBe(true);
    expect(consumeExportGuardAtLaunch()).toBe(false);
    clearExportCap();
    expect(exportCapped()).toBe(false);
    store.setItem(EXPORT_GUARD_KEY, 'not json');
    expect(consumeExportGuardAtLaunch()).toBe(false);
    expect(store.getItem(EXPORT_GUARD_KEY)).toBeNull();
    expect(exportCapped()).toBe(false);
  });

  it('the test knob keeps only valid fields', () => {
    expect(readExportDebug()).toEqual({});
    store.setItem(EXPORT_DEBUG_KEY, JSON.stringify({ tile: 256, slowMs: 4500, failAt: 'tile' }));
    expect(readExportDebug()).toEqual({ tile: 256, slowMs: 4500, failAt: 'tile' });
    store.setItem(EXPORT_DEBUG_KEY, JSON.stringify({ tile: 300, slowMs: -1, failAt: 'boom' }));
    expect(readExportDebug()).toEqual({});
  });

  it('every key access survives a throwing storage', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    expect(() => writeExportGuard({ at: 1, w: 1, h: 1, format: 'jpeg' })).not.toThrow();
    expect(consumeExportGuardAtLaunch()).toBe(false);
    expect(exportCapped()).toBe(false);
    expect(readExportDebug()).toEqual({});
    expect(() => clearExportCap()).not.toThrow();
  });
});
```

Create `src/media/exportPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportSizeView, fullExportBlock, isSeClassScreen, type ExportEnv } from './exportPlan';

const env = (over: Partial<ExportEnv> = {}): ExportEnv => ({
  prefTier: 'auto',
  autoTier: 'H',
  screen: { width: 393, height: 852 },
  capped: false,
  ...over,
});

describe('fullExportBlock (S §3.7)', () => {
  it('in order: 畫質 低, auto tier L, SE-class screen, breadcrumb cap, else none', () => {
    expect(fullExportBlock(env())).toBeNull();
    expect(fullExportBlock(env({ prefTier: 'L', capped: true }))).toBe('tierLow');
    expect(fullExportBlock(env({ autoTier: 'L', capped: true }))).toBe('tierL');
    expect(fullExportBlock(env({ prefTier: 'H', autoTier: 'L' }))).toBeNull();
    expect(fullExportBlock(env({ screen: { width: 667, height: 375 } }))).toBe('device');
    expect(fullExportBlock(env({ capped: true }))).toBe('guard');
  });

  it('SE class is 375 × 667 in either orientation only', () => {
    expect(isSeClassScreen({ width: 375, height: 667 })).toBe(true);
    expect(isSeClassScreen({ width: 375, height: 812 })).toBe(false);
  });
});

describe('exportSizeView (設定 › 輸出解析度, S §2.4)', () => {
  it('shows the stored pref when nothing blocks it', () => {
    expect(exportSizeView('full', null)).toEqual({ value: 'full', fullDisabled: false, sub: '原始解析度：最長邊最多 4096 像素' });
    expect(exportSizeView('standard', null).value).toBe('standard');
  });

  it('shows 標準（2048） under every block; disabled for the device and 畫質 低, enabled (retry) under the cap', () => {
    expect(exportSizeView('full', 'tierL')).toEqual({ value: 'standard', fullDisabled: true, sub: '此裝置記憶體不足，改用標準解析度' });
    expect(exportSizeView('full', 'device')).toEqual({ value: 'standard', fullDisabled: true, sub: '此裝置記憶體不足，改用標準解析度' });
    expect(exportSizeView('full', 'tierLow')).toEqual({ value: 'standard', fullDisabled: true, sub: '畫質設為「低」時使用標準解析度' });
    expect(exportSizeView('full', 'guard')).toEqual({
      value: 'standard',
      fullDisabled: false,
      sub: '上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試',
    });
  });
});
```

Add to `tests/e2e/settings.spec.ts`:

```ts
test('設定 › 輸出: JPEG and 原始解析度 by default; PNG persists across a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '設定' }).click();
  const sheet = page.getByRole('dialog', { name: '設定' });
  const format = sheet.getByRole('radiogroup', { name: '輸出格式' });
  const size = sheet.getByRole('radiogroup', { name: '輸出解析度' });
  await expect(format.getByRole('radio', { name: 'JPEG（較小）' })).toHaveAttribute('aria-checked', 'true');
  await expect(size.getByRole('radio', { name: '原始解析度' })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByText('原始解析度：最長邊最多 4096 像素')).toBeVisible();
  await format.getByRole('radio', { name: 'PNG（無損）' }).click();
  await expect(sheet.getByText('PNG 檔案較大，約為 JPEG 的 3–5 倍')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '設定' }).click();
  await expect(
    page.getByRole('dialog', { name: '設定' }).getByRole('radiogroup', { name: '輸出格式' }).getByRole('radio', { name: 'PNG（無損）' }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.prefs.v1') ?? 'null'))).toMatchObject({
    exportFormat: 'png',
    exportSize: 'full',
  });
});
```

- [x] **Step 2: Run the unit tests to see them fail**

Run: `npx vitest run src/store/settings.test.ts src/media/exportPlan.test.ts`
Expected: FAIL — `writeExportGuard is not exported` / `Failed to resolve import "./exportPlan"`.

- [x] **Step 3: Implement the types, the store keys and the pure view model**

`src/types.ts` (CRLF), before `Prefs`:

```ts
export type ExportFormat = 'jpeg' | 'png';
export type ExportSize = 'full' | 'standard';
```

and in `Prefs` after `installHintDismissed: boolean;`:

```ts
  /** 設定 › 輸出格式 (step 3); every save, the camera's included */
  exportFormat: ExportFormat;
  /** 設定 › 輸出解析度 (step 3): the stored choice; a block shows 標準 without changing it */
  exportSize: ExportSize;
```

Port the three Prefs literals typecheck reports (add `exportFormat: 'jpeg', exportSize: 'full',`; the settings test literal gets `'png'` / `'standard'` as in Step 1).

`src/store/settings.ts` (LF): add `exportFormat: 'jpeg', exportSize: 'full',` to `DEFAULT_PREFS`; next to `TIERS` add `const FORMATS: readonly ExportFormat[] = ['jpeg', 'png'];` and `const SIZES: readonly ExportSize[] = ['full', 'standard'];`; extend the type import to `import type { BeautyParams, CameraLook, ExportFormat, ExportSize, Prefs } from '../types';` (step 1's `CameraLook` stays: `sanitizeLook` / `loadLook` use it); in `sanitizePrefs` after the `DELEGATES` line:

```ts
  if (FORMATS.includes(r.exportFormat as ExportFormat)) out.exportFormat = r.exportFormat as ExportFormat;
  if (SIZES.includes(r.exportSize as ExportSize)) out.exportSize = r.exportSize as ExportSize;
```

Append to `src/store/settings.ts`:

```ts
// ───────────── full-resolution export: crash breadcrumb, cap and test knob (step-3 spec §3.7) ─────────────

export const EXPORT_GUARD_KEY = 'meiyan.exportGuard.v1';
export const EXPORT_CAP_KEY = 'meiyan.exportCap.v1';
export const EXPORT_DEBUG_KEY = 'meiyan.debug.export.v1';
/** the long edge exports fall back to after a full export died */
export const EXPORT_CAP_EDGE = 2048;

export interface ExportGuard {
  at: number;
  w: number;
  h: number;
  format: ExportFormat;
}

function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // disabled storage: nothing to remove
  }
}

function hasKey(key: string): boolean {
  try {
    return storage()?.getItem(key) != null;
  } catch {
    return false;
  }
}

/** written synchronously right before a tiled export; a launch that finds it knows the page died while saving */
export function writeExportGuard(g: ExportGuard): void {
  writeJson(EXPORT_GUARD_KEY, g);
}

export function clearExportGuard(): void {
  removeKey(EXPORT_GUARD_KEY);
}

export function readExportGuard(): ExportGuard | null {
  const r = readJson(EXPORT_GUARD_KEY);
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const { at, w, h, format } = r as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!n(at) || !n(w) || !n(h) || (format !== 'jpeg' && format !== 'png')) return null;
  return { at: at as number, w: w as number, h: h as number, format };
}

/** At launch: a breadcrumb found → remove it, cap exports at 2048 and tell the caller to toast once (S §3.7). */
export function consumeExportGuardAtLaunch(): boolean {
  const g = readExportGuard();
  if (hasKey(EXPORT_GUARD_KEY)) removeKey(EXPORT_GUARD_KEY);
  if (!g) return false;
  writeJson(EXPORT_CAP_KEY, EXPORT_CAP_EDGE);
  return true;
}

export function exportCapped(): boolean {
  return readJson(EXPORT_CAP_KEY) === EXPORT_CAP_EDGE;
}

/** choosing 原始解析度 in 設定 lifts the cap (S D8) */
export function clearExportCap(): void {
  removeKey(EXPORT_CAP_KEY);
}

export interface ExportDebugKnob {
  tile?: 256 | 512 | 1024 | 2048;
  slowMs?: number;
  failAt?: 'decode' | 'tile' | 'encode';
}

/** e2e knob (works in the production build): read once per export; it never changes the output */
export function readExportDebug(): ExportDebugKnob {
  const r = readJson(EXPORT_DEBUG_KEY);
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  const { tile, slowMs, failAt } = r as Record<string, unknown>;
  const out: ExportDebugKnob = {};
  if (tile === 256 || tile === 512 || tile === 1024 || tile === 2048) out.tile = tile;
  if (typeof slowMs === 'number' && Number.isFinite(slowMs) && slowMs > 0) out.slowMs = slowMs;
  if (failAt === 'decode' || failAt === 'tile' || failAt === 'encode') out.failAt = failAt;
  return out;
}
```

Create `src/media/exportPlan.ts` (LF):

```ts
// Export model (step-3 spec §3.7, §4.4): which plan a 儲存 takes (the working-size path of today, or a tiled render of
// the source decoded at up to 4096), the tile planner and the 設定 view of 輸出解析度. Pure: no DOM, no GL.
import type { ExportSize, Prefs, Tier } from '../types';

export type { ExportFormat, ExportSize } from '../types';

export type FullBlock = 'tierL' | 'tierLow' | 'device' | 'guard' | null;

export interface ExportEnv {
  prefTier: Prefs['tier'];
  /** the tier the live loop settled on this session (autoTierSession) */
  autoTier: Tier;
  screen: { width: number; height: number };
  /** meiyan.exportCap.v1 is set (a full export died earlier) */
  capped: boolean;
}

export const EXPORT_COPY = {
  overlay: '正在輸出原始解析度…',
  cancel: '取消',
  shareReady: '已準備好，點一下分享',
  fallback: '已改用標準解析度輸出',
  breadcrumb: '上次以原始解析度輸出時程式中止，已改用標準解析度',
  noSource: '此照片只保留了 2048 解析度',
  interrupted: '輸出已中斷，請再按一次「儲存」',
  sizeNote: '原始解析度：最長邊最多 4096 像素',
  device: '此裝置記憶體不足，改用標準解析度',
  tierLow: '畫質設為「低」時使用標準解析度',
  guard: '上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試',
  jpegSub: '檔案較小，適合分享',
  pngSub: 'PNG 檔案較大，約為 JPEG 的 3–5 倍',
} as const;

/** iPhone SE class (375 × 667 pt) in either orientation: always 標準 (C §6.2) */
export function isSeClassScreen(s: { width: number; height: number }): boolean {
  return Math.min(s.width, s.height) === 375 && Math.max(s.width, s.height) === 667;
}

export function fullExportBlock(env: ExportEnv): FullBlock {
  if (env.prefTier === 'L') return 'tierLow';
  if (env.prefTier === 'auto' && env.autoTier === 'L') return 'tierL';
  if (isSeClassScreen(env.screen)) return 'device';
  if (env.capped) return 'guard';
  return null;
}

export interface ExportSizeView {
  /** the effective choice the segmented control shows */
  value: ExportSize;
  /** 原始解析度 cannot be picked here */
  fullDisabled: boolean;
  sub: string;
}

export function exportSizeView(pref: ExportSize, block: FullBlock): ExportSizeView {
  if (block === 'tierL' || block === 'device') return { value: 'standard', fullDisabled: true, sub: EXPORT_COPY.device };
  if (block === 'tierLow') return { value: 'standard', fullDisabled: true, sub: EXPORT_COPY.tierLow };
  if (block === 'guard') return { value: 'standard', fullDisabled: false, sub: EXPORT_COPY.guard };
  return { value: pref, fullDisabled: false, sub: EXPORT_COPY.sizeNote };
}
```

- [x] **Step 4: Run the unit tests to see them pass**

Run: `npx vitest run src/store/settings.test.ts src/media/exportPlan.test.ts`
Expected: PASS.

- [x] **Step 5: Wire `Segmented`, 設定 › 輸出, `deps` and the launch toast**

`src/ui/components/Controls.tsx` (`Segmented`, `Controls.tsx:47-74`): add the prop `disabled?: readonly T[];` to the props type and destructuring, and on each option `<button>`:

```tsx
          disabled={disabled?.includes(o.value)}
          aria-disabled={disabled?.includes(o.value) ? 'true' : undefined}
```

`src/ui/deps.ts`: change the settings import (`deps.ts:12`, step 1 reads the camera look there) to `import { clearExportCap, consumeExportGuardAtLaunch, exportCapped, loadLook, loadPrefs, readExportDebug, saveLook, savePrefs } from '../store/settings';` and add `consumeExportGuardAtLaunch, exportCapped, clearExportCap, readExportDebug,` to `deps`.

`src/ui/screens/Settings.tsx` (LF): import `deps` from `../deps` and `EXPORT_COPY, exportSizeView, fullExportBlock` from `../../media/exportPlan`; add

```ts
const FORMAT_OPTIONS = [
  { value: 'jpeg', label: 'JPEG（較小）' },
  { value: 'png', label: 'PNG（無損）' },
] as const;

const SIZE_OPTIONS = [
  { value: 'full', label: '原始解析度' },
  { value: 'standard', label: '標準（2048）' },
] as const;
```

In `SettingsBody`, right before `<div class="group-label">效能</div>` (`Settings.tsx:102`), insert `<ExportGroup prefs={prefs} />`, and add the component:

```tsx
/** 輸出 (S §2.4): 輸出解析度 shows the effective setting; under the breadcrumb cap a tap on 原始解析度 retries */
function ExportGroup({ prefs }: { prefs: Prefs }) {
  const [, bump] = useState(0);
  const block = fullExportBlock({
    prefTier: prefs.tier,
    autoTier: deps.autoTierSession(),
    screen: { width: window.screen.width, height: window.screen.height },
    capped: deps.exportCapped(),
  });
  const view = exportSizeView(prefs.exportSize, block);
  return (
    <>
      <div class="group-label">輸出</div>
      <div class="group">
        <div class="row stack">
          <div class="row-text">
            <div class="row-title">輸出格式</div>
            <div class="row-sub">{prefs.exportFormat === 'png' ? EXPORT_COPY.pngSub : EXPORT_COPY.jpegSub}</div>
          </div>
          <Segmented label="輸出格式" value={prefs.exportFormat} options={FORMAT_OPTIONS} onChange={(exportFormat) => setPrefs({ exportFormat })} />
        </div>
        <div class="row stack">
          <div class="row-text">
            <div class="row-title">輸出解析度</div>
            <div class="row-sub">{view.sub}</div>
          </div>
          <Segmented
            label="輸出解析度"
            value={view.value}
            options={SIZE_OPTIONS}
            disabled={view.fullDisabled ? ['full'] : undefined}
            onChange={(exportSize) => {
              if (exportSize === 'full') deps.clearExportCap();
              setPrefs({ exportSize });
              bump((n) => n + 1);
            }}
          />
        </div>
      </div>
    </>
  );
}
```

`src/ui/app.tsx`: import `deps` from `./deps`, `toast` from `./state` (it joins the existing `app, closeSaveFallback` import), `reportError` from `./debug` and `EXPORT_COPY` from `../media/exportPlan`; at the start of the `App` mount effect (`app.tsx:22`, before `if (webgl2) prefetchWhenIdle();`):

```ts
    // a full-resolution export died last time (S §3.7): from now on 標準, told once
    try {
      if (deps.consumeExportGuardAtLaunch()) toast(EXPORT_COPY.breadcrumb, 4000);
    } catch (e) {
      reportError(e, 'export guard');
    }
```

- [x] **Step 6: Run the e2e and the unit suite**

Run: `npm run build && npx playwright test tests/e2e/settings.spec.ts`
Expected: every test passes (v0.3's two, any steps 1–2 added, and the new 輸出 test).
Run: `npm test`
Expected: every suite passes.

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/store/settings.ts src/store/settings.test.ts src/media/exportPlan.ts src/media/exportPlan.test.ts src/ui/components/Controls.tsx src/ui/screens/Settings.tsx src/ui/deps.ts src/ui/app.tsx src/app/testFakes.ts src/bench/main.ts tests/e2e/settings.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: export prefs, crash breadcrumb and 設定 › 輸出

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: JPEG/PNG encoding and the import probe

**Files:**
- Modify: `src/media/exporter.ts:5-26, 88-129`, `src/media/importer.ts:3-13, 49-109` (CRLF), `src/ui/deps.ts` (CRLF), `src/ui/screens/Camera.tsx:219-227` (CRLF), `src/ui/screens/Review.tsx:10, 46-56` (CRLF), `src/ui/state.ts:64-79, 90-101, 172-182` (CRLF), `src/ui/app.tsx:86-113` (CRLF)
- Test: `src/media/exporter.test.ts`, `src/media/importer.test.ts` (CRLF)

**Interfaces:**
- Consumes (Task 4): `ExportFormat`, `Prefs.exportFormat`.
- Produces (`exporter.ts`): `FULL_JPEG_QUALITY = 0.95`; `outputFileName(format: ExportFormat, d?: Date): string`; `jpegFileName(d?)` (kept, wraps it); `encodeOutput(img: ImageData, format: ExportFormat, quality?: number): Promise<File>`; `encodeJpeg(img, quality?)` (kept: `encodeOutput(img, 'jpeg', quality)`); `encodePng(img): Promise<File>`; `interface Surface {ctx; toBlob(quality?: number): Promise<Blob>; release(): void}`; `interface SurfaceOptions {type?: 'image/jpeg' | 'image/png'; alpha?: boolean}`; `createSurface(w, h, opts?): Surface` (now exported).
- Produces (`importer.ts`): `interface ImportInfo {bitmap: ImageBitmap; oriented: {width: number; height: number}; path: 'bitmap' | 'img'}` (`path`: which decoder ran, for the Phase 0 row S §6.4 item 1); `importPhotoInfo(file, maxLongEdge): Promise<ImportInfo>`; `importViaBitmapInfo(file, maxLongEdge, probe?)`, `importViaImageElementInfo(file, maxLongEdge)`: `Promise<ImportInfo>` (`importPhoto`, `importViaBitmap`, `importViaImageElement` keep their signatures and behaviour).
- Produces (`deps`): `encodeOutput`, `encodePng`, `importPhotoInfo`. (`state.ts`): `AppState.saveFallbackName: string | null`; the 長按 fallback `<img>` carries `data-name` = the file name.

- [x] **Step 1: Write the failing tests**

Add to `src/media/exporter.test.ts` (extend the first import with `createSurface, encodeOutput, encodePng, outputFileName`):

```ts
describe('outputFileName', () => {
  it('names JPEG .jpg and PNG .png with the meiyan- prefix', () => {
    const d = new Date(2026, 9, 12, 8, 4, 2);
    expect(outputFileName('jpeg', d)).toBe('meiyan-20261012-080402.jpg');
    expect(outputFileName('png', d)).toBe('meiyan-20261012-080402.png');
    expect(jpegFileName(d)).toBe(outputFileName('jpeg', d));
  });
});

describe('encodeOutput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface Rec {
    ctxOpts: unknown;
    blobOpts: ImageEncodeOptions | undefined;
    put: unknown[][];
  }
  /** an OffscreenCanvas stand-in that records its context options and encode calls */
  function stubOffscreen(): Rec[] {
    const made: Rec[] = [];
    class FakeOC {
      width: number;
      height: number;
      rec: Rec = { ctxOpts: undefined, blobOpts: undefined, put: [] };
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        made.push(this.rec);
      }
      getContext(_type: string, opts?: unknown) {
        this.rec.ctxOpts = opts;
        return { putImageData: (...a: unknown[]) => this.rec.put.push(a) };
      }
      convertToBlob(opts?: ImageEncodeOptions) {
        this.rec.blobOpts = opts;
        return Promise.resolve(new Blob(['x'], { type: opts?.type ?? 'image/png' }));
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOC);
    return made;
  }
  const img = { width: 3, height: 2, data: new Uint8ClampedArray(24) } as unknown as ImageData;

  it('JPEG: image/jpeg at the given quality, an opaque surface, a .jpg File', async () => {
    const made = stubOffscreen();
    const f = await encodeOutput(img, 'jpeg', 0.95);
    expect(f.type).toBe('image/jpeg');
    expect(f.name).toMatch(/^meiyan-\d{8}-\d{6}\.jpg$/);
    expect(made[0].blobOpts).toEqual({ type: 'image/jpeg', quality: 0.95 });
    expect(made[0].ctxOpts).toEqual({ alpha: false });
    expect(made[0].put).toHaveLength(1);
  });

  it('PNG: image/png without a quality, a .png File', async () => {
    const made = stubOffscreen();
    const f = await encodePng(img);
    expect(f.type).toBe('image/png');
    expect(f.name).toMatch(/\.png$/);
    expect(made[0].blobOpts).toEqual({ type: 'image/png' });
  });

  it("createSurface keeps today's defaults (JPEG, default alpha) for thumbnails", async () => {
    const made = stubOffscreen();
    const s = createSurface(4, 4);
    await s.toBlob(0.85);
    expect(made[0].ctxOpts).toBeUndefined();
    expect(made[0].blobOpts).toEqual({ type: 'image/jpeg', quality: 0.85 });
  });
});
```

Add to `src/media/importer.test.ts` (extend the import with `importViaBitmapInfo, importViaImageElementInfo`; reuse `stubEngine`, `FakeFile`):

```ts
describe('import probe (importPhotoInfo, step 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const header = async (f: Blob) => {
    const { rawW, rawH, rot } = f as unknown as FakeFile;
    return rot ? { width: rawH, height: rawW } : { width: rawW, height: rawH };
  };

  it('returns the oriented header size with the decoded bitmap, with one header read', async () => {
    stubEngine('spec');
    let probes = 0;
    const probe = async (f: Blob) => {
      probes++;
      return header(f);
    };
    const info = await importViaBitmapInfo({ rawW: 4032, rawH: 3024, rot: true } as unknown as Blob, 2048, probe);
    expect(info.oriented).toEqual({ width: 3024, height: 4032 });
    expect([info.bitmap.width, info.bitmap.height]).toEqual([1536, 2048]);
    expect(info.path).toBe('bitmap');
    expect(probes).toBe(1);
  });

  it('without a readable header, the oriented size comes from the full decode', async () => {
    stubEngine('spec');
    const info = await importViaBitmapInfo({ rawW: 4032, rawH: 3024, rot: false } as unknown as Blob, 2048, async () => {
      throw new Error('no header');
    });
    expect(info.oriented).toEqual({ width: 4032, height: 3024 });
  });

  it('the <img> fallback reports the natural (oriented) size', async () => {
    stubEngine('spec');
    class FakeImage {
      naturalWidth = 3000;
      naturalHeight = 4000;
      decoding = '';
      src = '';
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    const info = await importViaImageElementInfo(new Blob([]), 2048);
    expect(info.oriented).toEqual({ width: 3000, height: 4000 });
    expect([info.bitmap.width, info.bitmap.height]).toEqual([1536, 2048]);
    expect(info.path).toBe('img');
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/media/exporter.test.ts src/media/importer.test.ts`
Expected: FAIL — `outputFileName is not a function` / `importViaBitmapInfo is not a function`.

- [x] **Step 3: Implement `exporter.ts`**

Change the type import to `import type { ExportFormat, SaveResult } from '../types';`. Replace `jpegFileName` and `encodeJpeg` (`exporter.ts:8-26`) with:

```ts
/** 原始解析度 JPEG quality (C §4.6); 標準 and the camera keep JPEG_QUALITY */
export const FULL_JPEG_QUALITY = 0.95;

const MIME: Record<ExportFormat, 'image/jpeg' | 'image/png'> = { jpeg: 'image/jpeg', png: 'image/png' };
const EXT: Record<ExportFormat, string> = { jpeg: 'jpg', png: 'png' };

/** meiyan-YYYYMMDD-HHMMSS.jpg|.png in local time (the prefix stays, C §3.8) */
export function outputFileName(format: ExportFormat, d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `meiyan-${date}-${time}.${EXT[format]}`;
}

/** meiyan-YYYYMMDD-HHMMSS.jpg in local time. */
export function jpegFileName(d: Date = new Date()): string {
  return outputFileName('jpeg', d);
}

/** Encode `img` as a JPEG (at `quality`) or a lossless PNG File, EXIF-free, on an opaque surface. */
export async function encodeOutput(img: ImageData, format: ExportFormat, quality: number = JPEG_QUALITY): Promise<File> {
  const type = MIME[format];
  const surface = createSurface(img.width, img.height, { type, alpha: false });
  try {
    surface.ctx.putImageData(img, 0, 0);
    const blob = await surface.toBlob(format === 'jpeg' ? quality : undefined);
    return new File([blob], outputFileName(format), { type, lastModified: Date.now() });
  } finally {
    surface.release();
  }
}

/** JPEG-encode `img` as a File named meiyan-YYYYMMDD-HHMMSS.jpg (EXIF-free). */
export function encodeJpeg(img: ImageData, quality: number = JPEG_QUALITY): Promise<File> {
  return encodeOutput(img, 'jpeg', quality);
}

export function encodePng(img: ImageData): Promise<File> {
  return encodeOutput(img, 'png');
}
```

Replace the internals block from `type Ctx2D` through the end of `createSurface` (`exporter.ts:90-129`) with:

```ts
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Surface {
  ctx: Ctx2D;
  /** `quality` is ignored for PNG */
  toBlob(quality?: number): Promise<Blob>;
  release(): void;
}

export interface SurfaceOptions {
  /** default image/jpeg (thumbnails, history originals) */
  type?: 'image/jpeg' | 'image/png';
  /** false: an opaque context (every exported pixel is opaque anyway) */
  alpha?: boolean;
}

/** OffscreenCanvas when it can encode (Safari 16.4+), else a detached <canvas>. */
export function createSurface(width: number, height: number, opts: SurfaceOptions = {}): Surface {
  const type = opts.type ?? 'image/jpeg';
  const ctxOpts = opts.alpha === false ? { alpha: false } : undefined;
  const enc = (quality?: number): ImageEncodeOptions => (quality === undefined ? { type } : { type, quality });
  if (typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function') {
    const oc = new OffscreenCanvas(width, height);
    const ctx = oc.getContext('2d', ctxOpts);
    if (ctx) {
      return {
        ctx,
        toBlob: (quality) => oc.convertToBlob(enc(quality)),
        release: () => {
          oc.width = oc.height = 0;
        },
      };
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', ctxOpts);
  if (!ctx) throw new Error('exporter: 2D canvas unavailable');
  return {
    ctx,
    toBlob: (quality) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`exporter: ${type} encode failed`))), type, quality),
      ),
    // iOS caps total canvas memory and frees backing stores only on GC; release eagerly.
    release: () => {
      canvas.width = canvas.height = 0;
    },
  };
}
```

`toJpegBlob` keeps `createSurface(width, height)` and `surface.toBlob(quality)` (same output as today).

- [x] **Step 4: Implement the probe in `importer.ts`** (CRLF)

Add after `importPhoto`:

```ts
export interface ImportInfo {
  bitmap: ImageBitmap;
  /** the oriented size of the file itself (probeSize, or the full decode when the header is unreadable) */
  oriented: { width: number; height: number };
  /** the decoder that produced `bitmap`: createImageBitmap, or the <img> fallback (HEIC on some WebKit builds) */
  path: 'bitmap' | 'img';
}

/** importPhoto plus the file's oriented size (the source-retention rule needs it, with one header read, S §3.7) */
export async function importPhotoInfo(file: Blob, maxLongEdge: number): Promise<ImportInfo> {
  if (typeof createImageBitmap !== 'function') throw new Error('importPhoto: createImageBitmap unsupported');
  try {
    return await importViaBitmapInfo(file, maxLongEdge);
  } catch (e) {
    console.warn('[importer] createImageBitmap path failed, falling back to <img>', e);
    return importViaImageElementInfo(file, maxLongEdge);
  }
}
```

Rename the existing `importViaBitmap` body to `export async function importViaBitmapInfo(file: Blob, maxLongEdge: number, probe = probeSize): Promise<ImportInfo>` and change its returns: `return full;` → `return { bitmap: full, oriented: { width: full.width, height: full.height }, path: 'bitmap' };`; `return createImageBitmap(file, …)` → `return { bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }), oriented: { width: pw, height: ph }, path: 'bitmap' };`; `return bmp;` → `return { bitmap: bmp, oriented: { width: pw, height: ph }, path: 'bitmap' };`; `return scaleBitmap(bmp, …)` → `return { bitmap: await scaleBitmap(bmp, target.width, target.height), oriented: { width: pw, height: ph }, path: 'bitmap' };`. Then:

```ts
export async function importViaBitmap(
  file: Blob,
  maxLongEdge: number,
  probe: (file: Blob) => Promise<{ width: number; height: number }> = probeSize,
): Promise<ImageBitmap> {
  return (await importViaBitmapInfo(file, maxLongEdge, probe)).bitmap;
}
```

For the `<img>` path, rename the existing `importViaImageElement` body to `export async function importViaImageElementInfo(file: Blob, maxLongEdge: number): Promise<ImportInfo>` and change its one return `return await drawToBitmap(img, width, height);` to `return { bitmap: await drawToBitmap(img, width, height), oriented: { width: img.naturalWidth, height: img.naturalHeight }, path: 'img' };`. Then:

```ts
export async function importViaImageElement(file: Blob, maxLongEdge: number): Promise<ImageBitmap> {
  return (await importViaImageElementInfo(file, maxLongEdge)).bitmap;
}
```

- [x] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/media/exporter.test.ts src/media/importer.test.ts`
Expected: PASS (every existing test unchanged).

- [x] **Step 6: Use the format in every save; expose the fallback file name**

`src/ui/deps.ts`: import `encodeOutput`, `encodePng` (exporter) and `importPhotoInfo` (importer) and add them to `deps`.

`src/ui/screens/Camera.tsx:223` (CRLF): `file = deps.encodeOutput(image, prefsRef.current.exportFormat, 0.92);`
`src/ui/screens/Review.tsx:51` (CRLF): `p = deps.encodeOutput(shot.image, app.get().prefs.exportFormat, 0.92);` (`app` joins the `go, showSaveFallback, toast, type Shot` import from `../state`, `Review.tsx:10`). A camera frame is ≤ 1920 px, so 輸出解析度 does not apply (S §2.4).

`src/ui/state.ts` (CRLF): `AppState` gains

```ts
  /** file name of the save-fallback image (the e2e reads the format from it) */
  saveFallbackName: string | null;
```

initial value `saveFallbackName: null`; `showSaveFallback(file)` ends with `app.set({ saveFallback: URL.createObjectURL(file), saveFallbackName: file.name });`; `closeSaveFallback()` ends with `app.set({ saveFallback: null, saveFallbackName: null });`.

`src/ui/app.tsx` `SaveFallback`: `const name = useStore(app, (s) => s.saveFallbackName);` and `<img src={url} alt="編輯結果" data-name={name ?? undefined} />`.

- [x] **Step 7: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: no type errors; every suite passes.

```bash
git add src/media/exporter.ts src/media/exporter.test.ts src/media/importer.ts src/media/importer.test.ts src/ui/deps.ts src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/ui/state.ts src/ui/app.tsx
git commit -m "$(cat <<'EOF'
v0.4 step 3: JPEG/PNG output encoding and the import size probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The picked source in 最近編輯 (`HistoryEntry.source`) with the quota retry

**Files:**
- Modify: `src/types.ts:568-607` (`HistoryEntry`, CRLF), `src/store/history.ts:28-73, 171-199, 241-261`
- Test: `src/store/history.test.ts`

**Interfaces:**
- Consumes: `NewHistoryEntry` (`history.ts:15`, `Omit<HistoryEntry, …>`: picks the new fields up automatically).
- Produces: `HistoryEntry.source?: Blob`, `sourceWidth?: number`, `sourceHeight?: number`; `addEntry` stores them and, when the put fails with `QuotaExceededError`, puts the entry once more without `source` (same id, sizes kept); `normalizeEntry` keeps `source` only as a non-empty `Blob` and the sizes only as positive integers; `isQuotaError(err): boolean` (exported); internal `withStore(mode, fallback, body, onError?: (err) => 'retry' | 'stop')`.

- [x] **Step 1: Write the failing tests**

Add to `src/store/history.test.ts`:

```ts
describe('source file (HistoryEntry.source, step 3)', () => {
  const source = new Blob([new Uint8Array(64)], { type: 'image/jpeg' });

  it('round-trips the source and its oriented size; updateEntry never touches them', async () => {
    const id = await addEntry({ ...entry('s'), source, sourceWidth: 4032, sourceHeight: 3024 });
    const got = await getEntry(id);
    expect(got?.source).toBeInstanceOf(Blob);
    expect(got?.source?.size).toBe(64);
    expect([got?.sourceWidth, got?.sourceHeight]).toEqual([4032, 3024]);
    await updateEntry(id, { thumb: jpeg('t2') });
    expect((await getEntry(id))?.source?.size).toBe(64);
  });

  it('sizes are recorded without a kept file (the "only 2048 kept" note)', async () => {
    const id = await addEntry({ ...entry('n'), sourceWidth: 8064, sourceHeight: 6048 });
    const got = await getEntry(id);
    expect(got?.source).toBeUndefined();
    expect(got?.sourceWidth).toBe(8064);
  });

  it('invalid fields are dropped and the entry kept', () => {
    const raw = {
      id: 'x',
      createdAt: 1,
      updatedAt: 1,
      original: jpeg('o'),
      thumb: jpeg('t'),
      params: defaultParams(),
      width: 10,
      height: 10,
      source: new Blob([]),
      sourceWidth: 4032.5,
      sourceHeight: -1,
    };
    const e = normalizeEntry(raw);
    expect(e).not.toBeNull();
    expect(e?.source).toBeUndefined();
    expect(e?.sourceWidth).toBeUndefined();
    expect(e?.sourceHeight).toBeUndefined();
  });

  it('a QuotaExceededError add is put once more without the source, with the same id', async () => {
    const put = FDBObjectStore.prototype.put;
    const calls: { id: string; source?: Blob }[] = [];
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (this: FDBObjectStore, value: unknown, key?: IDBValidKey) {
      calls.push(value as { id: string; source?: Blob });
      if ((value as { source?: Blob }).source) throw new DOMException('quota', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    const id = await addEntry({ ...entry('q'), source, sourceWidth: 4032, sourceHeight: 3024 });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.id)).toEqual([id, id]);
    expect(calls[1].source).toBeUndefined();
    const got = await getEntry(id);
    expect(got).toBeDefined();
    expect(got?.source).toBeUndefined();
    expect(got?.sourceWidth).toBe(4032);
  });

  it("other errors keep today's reconnect retry (the file is not dropped)", async () => {
    const put = FDBObjectStore.prototype.put;
    let failed = false;
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (this: FDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (!failed) {
        failed = true;
        throw new DOMException('lost', 'UnknownError');
      }
      return put.call(this, value, key);
    });
    const id = await addEntry({ ...entry('r'), source, sourceWidth: 4032, sourceHeight: 3024 });
    expect((await getEntry(id))?.source?.size).toBe(64);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/store/history.test.ts`
Expected: FAIL — a type error on `source` in `NewHistoryEntry`, or `expected undefined to be an instance of Blob`.

- [x] **Step 3: Implement**

`src/types.ts` `HistoryEntry` (CRLF), after `faceMask?`:

```ts
  /** the full-resolution file as picked (step 3, C §4.6): written once by the add that creates the entry, never patched */
  source?: Blob;
  /** oriented size of the picked file, recorded whenever it exceeded the working edge (also when the file was not kept) */
  sourceWidth?: number;
  sourceHeight?: number;
```

`src/store/history.ts`: replace `addEntry` (`history.ts:28-73`, as step 1 left it: the four v2 lines after `faceMask` (`schema`, `edit`, `paramsKey`, `detect`) are kept below; no other field is copied there) with:

```ts
/** Stores the entry and evicts the oldest (by updatedAt) beyond HISTORY_LIMIT. Resolves with the id even if not stored. */
export async function addEntry(e: NewHistoryEntry): Promise<string> {
  const id = createId();
  const put = (withSource: boolean) => (store: IDBObjectStore) => {
    const now = stamp();
    const entry: HistoryEntry = {
      id,
      createdAt: now,
      updatedAt: now,
      original: e.original,
      thumb: e.thumb,
      params: e.params,
      width: e.width,
      height: e.height,
    };
    // typed arrays survive IDB's structured clone, so the cached detection is stored as is
    if (e.body !== undefined) entry.body = e.body;
    if (e.faceProtect === true) entry.faceProtect = true;
    if (e.faceMask) entry.faceMask = e.faceMask;
    // step 1's HistoryEntry v2 fields (unchanged)
    if (e.schema === 2) entry.schema = 2;
    if (e.edit) entry.edit = e.edit;
    if (e.paramsKey !== undefined) entry.paramsKey = e.paramsKey;
    if (e.detect) entry.detect = e.detect;
    if (withSource && e.source) entry.source = e.source;
    if (e.sourceWidth !== undefined && e.sourceHeight !== undefined) {
      entry.sourceWidth = e.sourceWidth;
      entry.sourceHeight = e.sourceHeight;
    }
    store.put(entry);
    // Requests in one transaction run in order, so the count already includes the new entry.
    const index = store.index(UPDATED_INDEX);
    const count = index.count();
    count.onsuccess = () => {
      let excess = count.result - HISTORY_LIMIT;
      if (excess <= 0) return;
      const cursor = index.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        // never evict what we just added, even if the clock went backwards
        if (c.primaryKey !== id) {
          c.delete();
          excess--;
        }
        if (excess > 0) c.continue();
      };
    };
    return () => undefined;
  };
  // the entry must never be lost because of the file: a quota failure is put once more without it (S §5)
  let quota = false;
  await withStore('readwrite', undefined, put(true), (err) => {
    if (e.source && isQuotaError(err)) {
      quota = true;
      return 'stop';
    }
    return 'retry';
  });
  if (quota) await withStore('readwrite', undefined, put(false));
  return id;
}

export function isQuotaError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'QuotaExceededError';
}
```

In `normalizeEntry` (`history.ts:171-199`), before `return entry;`:

```ts
  // a missing or unreadable source only costs this entry's 原始解析度 export
  if (isBlob(r.source) && r.source.size > 0) entry.source = r.source;
  if (isPositiveInt(r.sourceWidth) && isPositiveInt(r.sourceHeight)) {
    entry.sourceWidth = r.sourceWidth;
    entry.sourceHeight = r.sourceHeight;
  }
```

with, next to `isFiniteNumber`:

```ts
function isPositiveInt(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}
```

Replace `withStore` (`history.ts:241-261`) with:

```ts
/**
 * Run `body` in one transaction; resolve with its result getter once the transaction commits.
 * `body` must issue all requests synchronously or from request callbacks (IDB auto-commits).
 * `onError` decides what a failed attempt does: 'retry' (the default: reconnect and run once more) or 'stop'.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  body: (store: IDBObjectStore) => () => T,
  onError?: (err: unknown) => 'retry' | 'stop',
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await getDb();
    if (!db) return fallback;
    try {
      return await runTx(db, mode, body);
    } catch (err) {
      warnOnce(err);
      if (onError?.(err) === 'stop') return fallback;
      dropConnection(db);
    }
  }
  return fallback;
}
```

`deleteEntry` and the `HISTORY_LIMIT` eviction remove the source with the record (no change).

- [x] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/store/history.test.ts`
Expected: PASS (every existing test unchanged).

- [x] **Step 5: Commit**

```bash
git add src/types.ts src/store/history.ts src/store/history.test.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: keep the picked source in history; retry without it on quota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: P2 view uniforms (`uGeo`, `uTile`, `uWin`), the CPU port and the displacement bound

**Files:**
- Modify: `src/engine/passes/reshape.ts:244-391` (`reshapeFs`, its `main()` at `:363-390`), `:417-549` (`ReshapePass`: `drawFaces` `:505-541`, `draw` `:546-549`), new `displacementBound`; `src/engine/passes/reshapeCpu.ts` (`withView`); `tests/e2e/pages/reshape.ts` (new `runReshapePinView`); `tests/e2e/reshape.spec.ts` (new test)
- Test: `src/engine/passes/reshapeCpu.test.ts` (hash pin, `withView`), `src/engine/passes/reshape.test.ts` (`displacementBound`)

**Interfaces:**
- Consumes (step 1, S1 §4.4, §8.1, and the step-1 plan's Tasks 16–17): `reshapeFs(carrier: 'texture' | 'ubo'): string` with `RESHAPE_FS = reshapeFs('texture')` (both carriers share `main()`: `vec2 tcB = vUv; if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, vUv).xy; … outColor = texture(uSrc, tc);`); `ReshapePass.drawFaces(src, dst, faces: readonly TableFace[], opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[] })`; the one-face wrapper `ReshapePass.draw(src, dst, face, u, aspect?, body?, protect?: FaceProtect | null)`, which calls `drawFaces`; `reshapeMapCpu(face, u, aspect, body?, protect?)` (one face) and `reshapeMapMulti(faces: readonly TableFace[], aspect, opts?: { body?; protects? }): UvMap` (the N-face port); `UvMap` (`reshapeCpu.ts:14`); the pin constant `PINNED` in `reshapeCpu.test.ts`; `shaderHash` (step 2 moves it to `src/engine/shaderHash.ts`, S2 §4.7). (Task 1): `IDENTITY_MAT3`, `glMat3`, `vToO`, `IDENTITY_GEOMETRY`, `setStraighten`.
- Produces (`reshape.ts`): `interface ReshapeView { geo: Float32Array; tile: readonly [number, number, number, number]; win: readonly [number, number, number, number] }`; `IDENTITY_VIEW: ReshapeView`; `drawFaces` options gain `view?: ReshapeView`; `ReshapePass.draw(…, protect?, view?: ReshapeView)` (new last parameter, forwarded to `drawFaces`); `displacementBound(face: Face, aspect: number, u: ReshapeUniforms): number` (iso units: fractions of the O width; S §4.4 writes `displacementBound(face, u)`; the aspect is needed for `reshapeGeometry`).
- Produces (`reshapeCpu.ts`): `withView(map: UvMap, view: ReshapeView): UvMap` (buffer uv → V → O → `map` → src uv).

- [x] **Step 1: Write the failing tests**

Add to `src/engine/passes/reshape.test.ts` (CRLF). The file already imports `type { Face, ParamId }` from `../../types`, `{ applyPreset, defaultParams }` from `../params` and `reshapeActive`, `reshapeUniforms` (among others) from `./reshape`: add `PARAM_DEFS, paramDef` to the `../params` import and `displacementBound` to the `./reshape` import, and add only these new import lines:

```ts
import { readFileSync } from 'node:fs';
import { adapt } from '../../tracking/adapter111';
import { reshapeMapCpu } from './reshapeCpu';
```

then append:

```ts
describe('displacementBound (step 3, S §4.4 D7)', () => {
  const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const aspect = lm.width / lm.height;
  const mirrored = lm.points.map((v, i) => (i % 3 === 0 ? 1 - v : v));
  const faces = [adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height), adapt({ points: new Float32Array(mirrored) }, lm.width, lm.height)];
  const SHAPE = PARAM_DEFS.filter((d) => d.group === 'shape').map((d) => d.id);
  const neutral = () => Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296);

  it("bounds the CPU port's largest move on a 257 × 257 grid, fuzzed over faces and slider values", () => {
    for (let i = 0; i < 24; i++) {
      const face = faces[i % 2];
      const values = neutral();
      for (const id of SHAPE) if (rnd() < 0.7) values[id] = rnd();
      const u = reshapeUniforms(values, 1);
      const bound = displacementBound(face, aspect, u);
      const map = reshapeMapCpu(face, u, aspect);
      let max = 0;
      for (let y = 0; y <= 256; y++)
        for (let x = 0; x <= 256; x++) {
          const t = map(x / 256, y / 256);
          max = Math.max(max, Math.hypot(t[0] - x / 256, (t[1] - y / 256) / aspect));
        }
      expect(max).toBeLessThanOrEqual(bound + 1e-9);
      if (reshapeActive(u)) expect(bound).toBeGreaterThan(0);
    }
  });

  it('is 0 with every face slider neutral', () => {
    expect(displacementBound(faces[0], aspect, reshapeUniforms(neutral(), 1))).toBe(0);
    expect(paramDef('shape.chin').bidirectional).toBe(true);
  });
});
```

Add to `src/engine/passes/reshapeCpu.test.ts` (and add a structural line to the pin test, so the old shader fails it: `expect(RESHAPE_FS).toContain('uniform mat3 uGeo');` and `expect(reshapeFs('ubo')).toContain('uniform vec4 uWin');`):

```ts
import { glMat3, IDENTITY_GEOMETRY, rotateLeft, vToO, apply } from '../../geometry/view';
import { IDENTITY_VIEW } from './reshape';
import { withView } from './reshapeCpu';

describe('withView (P2 under geometry and windows, step 3)', () => {
  const u = reshapeUniforms(params(['shape.faceSlim', 'shape.eyeEnlarge']), 1);
  const map = reshapeMapCpu(face, u, aspect);

  it('the identity view is the map itself, exactly', () => {
    const m = withView(map, IDENTITY_VIEW);
    for (const [x, y] of [[0.3, 0.4], [0.51, 0.62], [0.9, 0.1]]) expect(m(x, y)).toEqual(map(x, y));
  });

  it('a geometry view samples the map at Geo⁻¹(v); a window rescales the result', () => {
    const g = rotateLeft(IDENTITY_GEOMETRY);
    const oSize = { width: lm.width, height: lm.height };
    const geo = glMat3(vToO(g, oSize));
    const view = { geo, tile: [0.25, 0.2, 0.5, 0.5] as const, win: [0.1, 0.2, 0.6, 0.5] as const };
    const m = withView(map, view);
    const v: [number, number] = [0.25 + 0.4 * 0.5, 0.2 + 0.7 * 0.5];
    const o = apply(vToO(g, oSize), v);
    const t = map(o[0], o[1]);
    const got = m(0.4, 0.7);
    expect(got[0]).toBeCloseTo((t[0] - 0.1) / 0.6, 6);
    expect(got[1]).toBeCloseTo((t[1] - 0.2) / 0.5, 6);
  });
});
```

Add to `tests/e2e/reshape.spec.ts`:

```ts
test('reshape CPU port == RESHAPE_FS under geometry and windows (uGeo, uTile, uWin)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinView === 'function');
  const cases = await page.evaluate(() => window.runReshapePinView!());
  expect(cases.map((c) => c.name)).toEqual(['quarter 1 + flip', 'θ 12° + crop', 'tile in a window']);
  for (const c of cases) {
    console.log(`${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
    expect(c.n, c.name).toBeGreaterThan(5_000);
    expect(c.moved, c.name).toBeGreaterThan(1_000);
    expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
  }
});
```

- [x] **Step 2: Run the unit tests to see them fail**

Run: `npx vitest run src/engine/passes/reshape.test.ts src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL — `displacementBound is not exported`, `withView is not exported`, the hash pin mismatch.

- [x] **Step 3: Implement the shader change, `draw`'s view and `displacementBound`**

In `RESHAPE_FS` (as step 1 left it), add after the `uAspect` uniform:

```glsl
uniform mat3 uGeo;   // V → O, normalized (step 3); the exact identity mat3 when the geometry is identity
uniform vec4 uTile;  // buffer uv → V: V = uTile.xy + vUv · uTile.zw; (0, 0, 1, 1) outside a tile
uniform vec4 uWin;   // O → src uv: (o − uWin.xy) / uWin.zw; (0, 0, 1, 1) when src is the whole O
```

and change the head and the tail of `main()` (step 1's loop between them is unchanged):

```glsl
void main() {
  vec2 v = uTile.xy + vUv * uTile.zw;
  vec2 o = (uGeo * vec3(v, 1.0)).xy;
  // body first as a backward map (C §4.2 D_body), sampled at O; the face chains below still see detected-landmark
  // coordinates (O-space)
  vec2 tcB = o;
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, o).xy;
  // … step 1's face-table loop over tcB, unchanged …
  outColor = texture(uSrc, (tc - uWin.xy) / uWin.zw);   // ONE resample of the source window
}
```

At identity every new operation is `×1` or `+0` (exact in fp32): `v = vUv`, `o = v`, `(tc − 0)/1 = tc`, so the output is bit-identical to step 1's.

In `reshape.ts` (LF) add, after `EMPTY_BOX`:

```ts
import { IDENTITY_MAT3 } from '../../geometry/view';

/** where P2 reads and writes (step 3): V → O, buffer uv → V, O → src uv */
export interface ReshapeView {
  /** column-major mat3 of vToO (glMat3); IDENTITY_MAT3 at identity geometry */
  geo: Float32Array;
  /** (x, y, w, h): the V rectangle the destination buffer covers */
  tile: readonly [number, number, number, number];
  /** (x, y, w, h): the O rectangle the source texture covers */
  win: readonly [number, number, number, number];
}

export const IDENTITY_VIEW: ReshapeView = { geo: IDENTITY_MAT3, tile: [0, 0, 1, 1], win: [0, 0, 1, 1] };
```

The shader text lives in `reshapeFs(carrier)`, so both carriers get the change. `drawFaces`' options type gains `view?: ReshapeView` (document it: "geometry / tile / window (step 3); omitted = identity"), and in its implementation, right after `prog.use();`:

```ts
      const vw = o.view ?? IDENTITY_VIEW;
      gl.uniformMatrix3fv(prog.u('uGeo'), false, vw.geo);
      gl.uniform4f(prog.u('uTile'), vw.tile[0], vw.tile[1], vw.tile[2], vw.tile[3]);
      gl.uniform4f(prog.u('uWin'), vw.win[0], vw.win[1], vw.win[2], vw.win[3]);
```

(`o` = `drawFaces`' options argument, as step 1 names it.) The one-face `draw` gains the last parameter `view?: ReshapeView` and forwards it: `drawFaces(src, dst, faces, { aspect: aspectIn, body, protects: protect ? [protect] : [], view })`.

Add `displacementBound` after `reshapeGeometry`:

```ts
/**
 * Upper bound of how far the face chain moves any coordinate, in iso units (fractions of the image width): the sum of
 * each active warp's largest move (S §4.4 D7): curveWarp |t − o|·|d|, enlargeEye / scaleAround R·|d|, shiftAround |disp|
 * (two eyes). The yaw attenuation, the 瘦臉 limit and the influence cap only scale moves down, so they are ignored.
 * The tile planner grows each tile's source window by it; step 5 adds its warps here.
 */
export function displacementBound(face: Face, aspect: number, u: ReshapeUniforms): number {
  const g = reshapeGeometry(face, aspect, u);
  const p = (i: number) => pt(face.pts111, i);
  const isoLen = (dx: number, dy: number) => Math.hypot(dx, dy / aspect);
  const curve = (o: V2, t: V2, d: number) => isoLen(t[0] - o[0], t[1] - o[1]) * Math.abs(d);
  let b = 0;
  if (u.faceSlim) for (const [o, t] of SLIM) b += curve(p(o), p(t), u.faceSlim);
  if (u.faceV) V_JAW.forEach((i, k) => (b += curve(p(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], u.faceV)));
  if (u.faceNarrow) NARROW.forEach((i, k) => (b += curve(p(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], u.faceNarrow)));
  if (u.chin) b += curve(p(16), g.chinTarget, u.chin);
  if (u.forehead) b += curve(pt(face.ext, 0), pt(face.ext, 3), u.forehead);
  if (u.noseSlim) for (const [o, t] of NOSE) b += curve(p(o), p(t), u.noseSlim);
  if (u.mouthSize) b += g.mouthR * Math.abs(u.mouthSize);
  if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) b += 2 * isoLen(g.eyeDisp[0], g.eyeDisp[1]);
  if (u.eyeEnlarge) b += (g.eyeR[0] + g.eyeR[1]) * Math.abs(u.eyeEnlarge);
  return b;
}
```

In `reshapeCpu.ts` add:

```ts
import type { ReshapeView } from './reshape';

/**
 * The map P2 draws with a view (step 3): buffer uv → V (uTile) → O (uGeo, the float32 mat3 the shader gets) → `map`
 * (the O-space chain: body, faces) → src uv (uWin). With IDENTITY_VIEW it returns `map`'s result unchanged.
 */
export function withView(map: UvMap, view: ReshapeView): UvMap {
  const m = view.geo;
  const [tx, ty, tw, th] = view.tile;
  const [wx, wy, ww, wh] = view.win;
  return (x, y) => {
    const vx = tx + x * tw;
    const vy = ty + y * th;
    const t = map(m[0] * vx + m[3] * vy + m[6], m[1] * vx + m[4] * vy + m[7]);
    return [(t[0] - wx) / ww, (t[1] - wy) / wh];
  };
}
```

- [x] **Step 4: Re-pin the shader hash and run the unit tests**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL only on the hash, `expected '<new hash>' to be '<step 1's PINNED>'` (the structural lines pass now). Set `PINNED` to `<new hash>` (C §8.2: the CPU port changes in this same commit), then:

Run: `npx vitest run src/engine/passes/reshape.test.ts src/engine/passes/reshapeCpu.test.ts src/engine/passes/faceProtect.test.ts`
Expected: PASS.

- [x] **Step 5: Add the GPU = CPU view cases to the reshape harness**

In `tests/e2e/pages/reshape.ts`, add to the `declare global` block `runReshapePinView?: () => PinCase[];` and, after `window.runReshapePin` (`reshape.ts:105-151` of the page), a second entry built on step 1's page helpers — `context()`, `floatTex(…)` and `rig(gl)` (the identity coordinate texture, the RGBA32F 200 × 300 target and its `compare(name, map)`), plus `runReshapePin`'s RG16F body field and face — that draws the face warps through a view. Add `withView` to the page's `../../../src/engine/passes/reshapeCpu` import and `type ReshapeView` to its `../../../src/engine/passes/reshape` import; the one new import line is:

```ts
import { glMat3, IDENTITY_GEOMETRY, setStraighten, vToO } from '../../../src/geometry/view';

window.runReshapePinView = () => {
  const gl = context();
  const r = rig(gl);
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  // runReshapePin's smooth body field (RG16F from FLOAT data, like the engine)
  const bw = 24;
  const bh = 36;
  const bd = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      bd[(y * bw + x) * 2] = 0.012 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      bd[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  const bodyTex = floatTex(gl, bw, bh, gl.RG16F, gl.RG, bd);
  const bodyField: BodyField = { width: bw, height: bh, data: bd, version: 1 };
  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const oSize = { width: W, height: H };
  const flip = { ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 as const };
  const tilted = setStraighten(IDENTITY_GEOMETRY, 12, oSize);
  const views: { name: string; view: ReshapeView }[] = [
    { name: 'quarter 1 + flip', view: { geo: glMat3(vToO(flip, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] } },
    { name: 'θ 12° + crop', view: { geo: glMat3(vToO(tilted, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] } },
    { name: 'tile in a window', view: { geo: glMat3(vToO(IDENTITY_GEOMETRY, oSize)), tile: [0.25, 0.2, 0.5, 0.5], win: [0.15, 0.1, 0.7, 0.7] } },
  ];
  const ids: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.chin', 'shape.noseSlim', 'shape.eyeEnlarge'];
  const u = reshapeUniforms(at(ids), 1);
  const pass = createReshapePass(gl);
  const res: PinCase[] = [];
  for (const { name, view } of views) {
    // runReshapePin's draw (step 1's one-face signature); the view is the new last argument
    pass.draw(r.src, r.dst, face, u, aspect, bodyTex, null, view);
    res.push(r.compare(name, withView(reshapeMapCpu(face, u, aspect, bodyField), view)));
  }
  pass.dispose();
  gl.deleteTexture(bodyTex.tex);
  r.dispose();
  return res;
};
```

(`rig`'s `compare` skips pixels whose CPU source UV falls outside the identity texture's exact range and counts the pixels the warp moved by more than 1 px, as for the other cases. The CPU map uses `reshapeMapCpu(…, bodyField)`, as `runReshapePin`'s "body field + contour" case does.)

- [x] **Step 6: Run the harness spec**

Run: `npx playwright test tests/e2e/reshape.spec.ts`
Expected: every test passes (the existing case unchanged, plus the view case: three lines with `max |GPU − CPU|` < 0.05 px).

- [x] **Step 7: Commit**

```bash
git add src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.ts src/engine/passes/reshape.test.ts src/engine/passes/reshapeCpu.test.ts tests/e2e/pages/reshape.ts tests/e2e/reshape.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: P2 view uniforms, CPU port withView, displacement bound (re-pin RESHAPE_FS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Engine — V-sized frames, source windows, `renderTile`, `releaseBuffers`

**Files:**
- Modify: `src/types.ts:444-517` (`RenderInput`, `Engine`, CRLF), `src/engine/uniforms.ts:54-71` (+ `adjustFrameFor`), `src/engine/pipeline.ts:78-179, 200-216, 295-305, 387-517` (CRLF: `FrameJob`, `PassPlanInput`, `planPasses`, `planFrame`, `Pipeline`, `createPipeline`, `runMean`, `run`, `drawSource`), `src/engine/index.ts:1-22, 260-384` (CRLF), `src/engine/passes/mask.ts:15-30, 46-53, 172-219` (CRLF), `src/engine/passes/makeup.ts:119-127, 198-235` (CRLF), `src/engine/shaders/present.ts:15-21`, `src/engine/gl/gl.ts` (+ `shrinkTexture`), `src/app/testFakes.ts:123-211`, `tests/harness/t7/fakes.ts:92-153`
- Test: `src/engine/uniforms.test.ts`, `src/engine/pipeline.test.ts`, `src/engine/index.test.ts`

**Interfaces:**
- Consumes: Task 1 (`IDENTITY_GEOMETRY`, `IDENTITY_MAT3`, `isIdentity`, `glMat3`, `vToO`, `viewSize`), Task 7 (`ReshapeView`, `ReshapePass.draw(…, view?)`); step 1 (`RenderInput` v0.4 fields, `FrameJob.faces`, the RGBA8 mask pass `MaskPass.drawFaces(dst, faces, clear)`, the per-face `MakeupPass.drawFaces(src, dst, faces)` — `run()` calls these two, the one-face `draw` wrappers stay identity; `planFrame(job, makeupReady, bodyOn)`, which `run()` plans with); Task 3 (`RenderInput.geometry?`); step 2 (S2 §3.5, §4.5: `job()` builds `adjust = adjustUniforms(photo, lookDef, lookReady, frame)` whose `frame` argument carries the composite's `uVMap`, `uVAspect`, `uGrainScale` and the grain cell size).
- Produces (`src/types.ts`): `interface RenderOutput { tile: Rect; pixelSize: Size; fullShortEdge: number }`; `RenderInput.sourceWindow?: Rect` (next to Task 3's `geometry?`), `output?: RenderOutput`, `oAspect?: number` (the working bitmap's width/height; tiles must pass it, S §4.1); `Engine.renderTile(input: RenderInput, read: PxRect): ImageData`; `Engine.releaseBuffers(): void`; `Engine.renderOriginal(input: Pick<RenderInput, 'source' | 'width' | 'height' | 'geometry'>, opts?)`.
- Produces (`uniforms.ts`): `meanStep(size, axis, fullShortEdge = min(size))`, `sharpenTexel(size, fullShortEdge = min(size))` (S §3.8 writes `meanStep(buf, fullShortEdge, axis)`; the trailing optional parameter keeps every existing call and test unchanged); `adjustFrameFor(input: Pick<RenderInput, 'output' | 'pictureFrame' | 'grainSeed'>, size: Size, fullShortEdge: number): AdjustFrame` (step 2's `AdjustFrame`, fed to `adjustUniforms`).
- Produces (`pipeline.ts`): `FrameJob.win`, `tile: [number, number, number, number]`, `geo: Float32Array`, `geoIdentity: boolean`, `windowed: boolean`, `oAspect: number`, `srcSize: Size`, `fullShortEdge: number`; `PassPlanInput.geoIdentity?: boolean`, `windowed?: boolean` (forwarded by `planFrame`); `MaskPass.drawFaces(…, view?)`, `MakeupPass.drawFaces(…, win?)`; `Pipeline.drawSource(src, mirror, geo?: Float32Array)`; `Pipeline.releaseBuffers(): void`.
- Produces (`gl.ts`): `shrinkTexture(gl, tex): void` (1 × 1 RGBA8).

- [x] **Step 1: Write the failing tests**

Add to `src/engine/uniforms.test.ts`:

```ts
import { frameFor } from './adjustMath';
import { adjustFrameFor } from './uniforms';

describe('kernels scale with fullShortEdge (step 3)', () => {
  it("equal today's values when fullShortEdge = min(size)", () => {
    for (const s of [{ width: 2048, height: 1536 }, { width: 1001, height: 1501 }, { width: 720, height: 1280 }]) {
      const m = Math.min(s.width, s.height);
      expect(meanStep(s, 'h', m)).toEqual(meanStep(s, 'h'));
      expect(meanStep(s, 'v', m)).toEqual(meanStep(s, 'v'));
      expect(sharpenTexel(s, m)).toEqual(sharpenTexel(s));
    }
  });

  it('a tile buffer uses the O short edge in output pixels, not its own size', () => {
    const tile = { width: 1088, height: 1152 };
    const [ux] = meanStep(tile, 'h', 3072);
    const [, uy] = meanStep(tile, 'v', 3072);
    expect(ux * tile.width).toBeCloseTo((4 * 3072) / 720, 9);
    expect(uy * tile.height).toBeCloseTo((4 * 3072) / 720, 9);
    const [kx, ky] = sharpenTexel(tile, 3072);
    expect(kx * tile.width).toBeCloseTo(3072 / 720, 9);
    expect(ky * tile.height).toBeCloseTo(3072 / 720, 9);
  });
});

describe('adjustFrameFor (the composite V frame of 暗角 and 顆粒, S §4.2 P5)', () => {
  it('without a tile it is step 2 frameFor, with the O short edge of the photo', () => {
    expect(adjustFrameFor({}, { width: 2048, height: 1536 }, 1536)).toEqual(frameFor({ width: 2048, height: 1536 }));
    // a crop preview: V buffer 1024 × 1536 at working density, the photo's short edge stays 1536
    expect(adjustFrameFor({}, { width: 1024, height: 1536 }, 1536)).toEqual({ ...frameFor({ width: 1024, height: 1536 }), fullShortEdge: 1536 });
    const cam = { x: 0.2, y: 0, w: 0.6, h: 1 };
    expect(adjustFrameFor({ pictureFrame: cam, grainSeed: 9 }, { width: 1280, height: 720 }, 720)).toEqual(frameFor({ width: 1280, height: 720 }, cam, 9));
  });

  it('a tile maps buffer uv into the whole V; vSize is the whole V in output pixels', () => {
    const f = adjustFrameFor({ output: { tile: { x: 0.25, y: 0.5, w: 0.25, h: 0.25 }, pixelSize: { width: 1024, height: 768 }, fullShortEdge: 3072 } }, { width: 1024, height: 768 }, 3072);
    expect(f).toEqual({ vMap: [0.25, 0.25, 0.25, 0.5], vSize: [4096, 3072], fullShortEdge: 3072, seed: 0 });
  });
});
```

Add to `src/engine/pipeline.test.ts`:

```ts
describe('planPasses with geometry and windows (step 3)', () => {
  const quiet: PassPlanInput = { ...base, anyFace: false, reshapeActive: false, bodyOn: false };
  it('identity geometry and no window keep P2 skipped (v0.3 parity)', () => {
    expect(planPasses({ ...quiet, geoIdentity: true, windowed: false }).reshape).toBe(false);
    expect(planPasses(quiet).reshape).toBe(false);
  });
  it('a geometry or a window always runs P2', () => {
    expect(planPasses({ ...quiet, geoIdentity: false }).reshape).toBe(true);
    expect(planPasses({ ...quiet, windowed: true }).reshape).toBe(true);
  });
});
```

(`base` is the step-1 `PassPlanInput` fixture at the top of the file (`pipeline.test.ts:22-33`, whose face flag is `anyFace`); `quiet` turns off every face and body warp.)

Add to `src/engine/index.test.ts` (extend the `vi.mock('./gl/gl', …)` override list with `shrinkTexture: vi.fn(),`; extend the mocked pipeline object with `releaseBuffers: vi.fn(),`; extend `fakeCanvas()`'s `gl` with `readPixels: vi.fn(), bindFramebuffer: vi.fn(), viewport: vi.fn(), drawingBufferWidth: 1, drawingBufferHeight: 1, FRAMEBUFFER: 1, RGBA: 2, UNSIGNED_BYTE: 3,`):

```ts
import { glMat3, IDENTITY_MAT3, rotateLeft, IDENTITY_GEOMETRY, vToO } from '../geometry/view';
import { defaultPhoto } from '../edit/state';

describe('createEngine: geometry, windows and tiles (step 3)', () => {
  const pipe = () => vi.mocked(createPipeline).mock.results.at(-1)!.value as {
    run: ReturnType<typeof vi.fn>;
    releaseBuffers: ReturnType<typeof vi.fn>;
    drawSource: ReturnType<typeof vi.fn>;
  };
  const job = (): FrameJob => pipe().run.mock.calls.at(-1)![0] as FrameJob;
  const input = (over: Partial<RenderInput> = {}): RenderInput => ({
    source: {} as TexImageSource,
    width: 640,
    height: 480,
    faces: [],
    globalSkin: null,
    photo: defaultPhoto(),
    ...over,
  });

  it('identity: the source size, the identity mat3, fullShortEdge = min(size), no window', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(input(), { still: true });
    const j = job();
    expect(j.size).toEqual({ width: 640, height: 480 });
    expect(j.srcSize).toEqual({ width: 640, height: 480 });
    expect(j.geoIdentity).toBe(true);
    expect(j.windowed).toBe(false);
    expect(j.geo).toBe(IDENTITY_MAT3);
    expect(j.fullShortEdge).toBe(480);
    expect(j.oAspect).toBe(640 / 480);
  });

  it('a quarter turn renders V (sides swapped) from the O source; the canvas takes the V size', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const g = rotateLeft(IDENTITY_GEOMETRY);
    engine.render(input({ geometry: g }), { still: true });
    const j = job();
    expect(j.size).toEqual({ width: 480, height: 640 });
    expect(canvas.width).toBe(480);
    expect(j.srcSize).toEqual({ width: 640, height: 480 });
    expect(j.geoIdentity).toBe(false);
    expect(Array.from(j.geo)).toEqual(Array.from(glMat3(vToO(g, { width: 640 / 480, height: 1 }))));
    expect(j.fullShortEdge).toBe(480);
  });

  it('renderTile renders the output tile from the window and reads back only `read`', async () => {
    vi.stubGlobal('ImageData', class {
      constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
    });
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    pipe().run.mockReturnValueOnce({ passes: [], output: { fbo: {} } });
    const img = engine.renderTile(
      input({
        width: 1200,
        height: 1100,
        sourceWindow: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        output: { tile: { x: 0.25, y: 0, w: 0.25, h: 0.5 }, pixelSize: { width: 1088, height: 1152 }, fullShortEdge: 3072 },
        oAspect: 4 / 3,
      }),
      { x: 64, y: 0, w: 1024, h: 1088 },
    );
    const j = job();
    expect(j.target).toBe('fbo');
    expect(j.size).toEqual({ width: 1088, height: 1152 });
    expect(j.srcSize).toEqual({ width: 1200, height: 1100 });
    expect(j.win).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(j.tile).toEqual([0.25, 0, 0.25, 0.5]);
    expect(j.windowed).toBe(true);
    expect(j.oAspect).toBe(4 / 3);
    expect(j.fullShortEdge).toBe(3072);
    expect([img.width, img.height]).toEqual([1024, 1088]);
    vi.unstubAllGlobals();
  });

  it('releaseBuffers shrinks the pipeline buffers and the source texture', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.releaseBuffers();
    expect(pipe().releaseBuffers).toHaveBeenCalledTimes(1);
  });

  it('renderOriginal draws through the geometry (按住對比 keeps the crop)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    const g = rotateLeft(IDENTITY_GEOMETRY);
    engine.renderOriginal({ source: {} as TexImageSource, width: 640, height: 480, geometry: g }, { still: true });
    expect(canvas.width).toBe(480);
    expect(Array.from(pipe().drawSource.mock.calls.at(-1)![2] as Float32Array)).toEqual(Array.from(glMat3(vToO(g, { width: 640, height: 480 }))));
  });
});
```

(`RenderInput` from `../types`.)

- [x] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/engine/uniforms.test.ts src/engine/pipeline.test.ts src/engine/index.test.ts`
Expected: FAIL — `adjustFrameFor is not exported`, `j.srcSize` undefined, `engine.renderTile is not a function`.

- [x] **Step 3: Types and pure math**

`src/types.ts` (CRLF): next to `RenderInput`:

```ts
/** the V tile a render writes (step 3, C §4.1): V-normalized rect, its pixel size, and the O short edge in output px */
export interface RenderOutput {
  tile: Rect;
  pixelSize: Size;
  /** kernel scale k = fullShortEdge / 720 (C §3.5); the same for the preview, a crop, a tile and the export */
  fullShortEdge: number;
}
```

and in `RenderInput` (after Task 3's `geometry?`):

```ts
  /** O-normalized rect `source` covers (a tile's window); default [0,0,1,1] */
  sourceWindow?: Rect;
  /** a V tile at a given pixel size (renderTile); default: the whole V at the processing size */
  output?: RenderOutput;
  /** the working bitmap's width / height: the iso metric of every face warp; tiles pass it (never the decode's aspect) */
  oAspect?: number;
```

In `Engine`: change `renderOriginal`'s input to `Pick<RenderInput, 'source' | 'width' | 'height' | 'geometry'>` and add:

```ts
  /**
   * Render `input.output` (a V tile, at its pixelSize) offscreen from `input.source` (the window `sourceWindow`) and read
   * back `read` (buffer pixels, row 0 = top). Synchronous. Throws when the context is unavailable or `output` is missing.
   */
  renderTile(input: RenderInput, read: PxRect): ImageData;
  /** shrink every pipeline buffer and the source texture to 1 × 1 (after a tiled export, before encoding) */
  releaseBuffers(): void;
```

`src/engine/uniforms.ts` (LF): replace `meanStep` and `sharpenTexel`:

```ts
/**
 * UV step of one "offset unit" along `axis`, from the PROCESSING size (not the mean buffer size), so the half-res mean
 * of tier L covers the same image footprint. `fullShortEdge` (step 3) is the O short edge in output pixels: a crop or a
 * tile keeps the kernel of the whole photo. Default = min(size): exactly today's arithmetic.
 */
export function meanStep(size: Size, axis: 'h' | 'v', fullShortEdge: number = Math.min(size.width, size.height)): [number, number] {
  const unit = MEAN_SPACING * (fullShortEdge / MEAN_REFERENCE_SHORT_EDGE);
  return axis === 'h' ? [unit / size.width, 0] : [0, unit / size.height];
}

/** UV step of the P5 sharpen taps: GPUPixel's 1 px at a 720 short edge, scaled by fullShortEdge/720 (see meanStep). */
export function sharpenTexel(size: Size, fullShortEdge: number = Math.min(size.width, size.height)): [number, number] {
  const k = fullShortEdge / MEAN_REFERENCE_SHORT_EDGE;
  return [k / size.width, k / size.height];
}
```

(`meanScale(size)` is `min(size)/720`, so `MEAN_SPACING * (min/720)` is today's exact expression.) Append:

```ts
/**
 * The composite's picture frame (S2 §4.5, S §4.2 P5) as step 2's AdjustFrame: without a tile it is step 2's
 * frameFor(size, pictureFrame, seed) with the O short edge of the photo (a crop keeps the grain cell of the whole
 * photo); a tile maps its buffer uv into the whole V (vMap from output.tile) and vSize is the whole V in output pixels,
 * so 暗角 and 顆粒 depend only on global V and tiles match the untiled render.
 */
export function adjustFrameFor(input: Pick<RenderInput, 'output' | 'pictureFrame' | 'grainSeed'>, size: Size, fullShortEdge: number): AdjustFrame {
  const seed = input.grainSeed ?? 0;
  const o = input.output;
  if (!o) return { ...frameFor(size, input.pictureFrame, seed), fullShortEdge };
  const t = o.tile;
  return { vMap: [t.w, t.h, t.x, t.y], vSize: [o.pixelSize.width / t.w, o.pixelSize.height / t.h], fullShortEdge, seed };
}
```

(Imports for `uniforms.ts`: `frameFor, type AdjustFrame` from `./adjustMath` (step 2, S2 plan: `frameFor(size, pictureFrame?, seed?): AdjustFrame`, `AdjustFrame { vMap; vSize; fullShortEdge; seed; thumb? }`), and `RenderInput` to the type import. The grain cell `fullShortEdge / 1080` stays computed by step 2's `adjustUniforms` from the frame.)

`src/engine/gl/gl.ts` (LF), after `uploadSource`:

```ts
/** Free a texture's storage without deleting it (the next uploadSource reallocates). */
export function shrinkTexture(gl: GL, tex: Texture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  tex.width = 1;
  tex.height = 1;
}
```

- [x] **Step 4: Pipeline**

`src/engine/pipeline.ts` (CRLF). `FrameJob` gains:

```ts
  /** O-normalized rect the uploaded src covers, (x, y, w, h); [0,0,1,1] for the preview */
  win: [number, number, number, number];
  /** V-normalized rect the V buffers cover; [0,0,1,1] for the preview */
  tile: [number, number, number, number];
  /** V → O, column-major mat3; IDENTITY_MAT3 (the same object) at identity geometry */
  geo: Float32Array;
  geoIdentity: boolean;
  /** win ≠ tile: P2 resamples the window into the buffer */
  windowed: boolean;
  /** the working bitmap's width / height: every face warp's iso metric, the same for the preview, a tile and the export */
  oAspect: number;
  /** pixel size of the O-space buffers (src, M at ¼, A): the window, or `size` at identity without a window */
  srcSize: Size;
  /** the O short edge in output pixels (k = fullShortEdge / 720) */
  fullShortEdge: number;
```

`PassPlanInput` (`pipeline.ts:114-128`) gains `/** step 3: false → P2 runs (default true) */ geoIdentity?: boolean;` and `/** step 3: true → P2 runs (default false) */ windowed?: boolean;`, and the `reshape` line of `planPasses` (`pipeline.ts:153`) ends with `|| i.geoIdentity === false || i.windowed === true` (S §4.3). `run()` plans through step 1's `planFrame(job, makeupReady, bodyOn)` (`pipeline.ts:160-179, 411`): its `job` parameter type gains `& Partial<Pick<FrameJob, 'geoIdentity' | 'windowed'>>` (optional, so its tests' literals stand) and its `planPasses({...})` call passes `geoIdentity: job.geoIdentity, windowed: job.windowed`.

In `run(job)` (`pipeline.ts:404-503`):
- the plan call is step 1's `planFrame(job, makeupReady, body !== null)` (unchanged; it forwards the two flags);
- the mask target (`pipeline.ts:417`) becomes `fb('M', maskBufferSize(job.srcSize))` and the mask draw `mask.drawFaces(m, …, job.maskClear)` (`:418`) gets the view as its new last argument: `{ win: job.win, aspect: job.geoIdentity && !job.windowed ? undefined : job.oAspect }`;
- the makeup target (`:426`) becomes `fb('A', job.srcSize)` and `makeup.drawFaces(base, a, meshes)` (`:427`) gets `job.win` as its new last argument;
- step 1's `const aspect = job.size.width / job.size.height;` (`:434`) becomes `const aspect = job.oAspect;`: it feeds `tableFaces(job, aspect)` (the caps live in O, `:437`) and both P2 draws — `reshape.drawFaces(base, b, t.faces, { aspect, body, protects: t.protects })` (`:439`) and the maskWarp one (`:450`) — identical numbers at identity; both draws' options also gain `view`, with `const view: ReshapeView = { geo: job.geo, tile: job.tile, win: job.win };`; B (`:438`) and N (`:449`) stay `job.size` / `maskBufferSize(job.size)` (V);
- `runMean` uses `meanStep(job.size, 'h', job.fullShortEdge)` and `meanStep(job.size, 'v', job.fullShortEdge)` (`pipeline.ts:394, 398`);
- the composite uses `sharpenTexel(job.size, job.fullShortEdge)` (`pipeline.ts:487`);
- the FBO output rule (`pipeline.ts:466`) is unchanged: `fb('A', job.size)` re-sizes A from `srcSize` to `size` after P2 has read it.

`drawSource(src, mirror, geo: Float32Array = IDENTITY_MAT3)` (`pipeline.ts:509-517`) sets `gl.uniformMatrix3fv(presentProg.u('uGeo'), false, geo);` before drawing; `createPipeline` sets `uGeo` to `IDENTITY_MAT3` once at init (after `gl.uniform1i(presentProg.u('uSrc'), 0);`, `pipeline.ts:304`). Add to the returned object:

```ts
    releaseBuffers() {
      // every FBO to 1 × 1: the next frame re-allocates at its own size (S §4.4, after a tiled export)
      for (const f of Object.values(fbs)) if (f) resizeFramebuffer(gl, f, 1, 1);
    },
```

(`fbs` is a `Partial<Record<FbName, Framebuffer>>`, so `Object.values` yields `Framebuffer | undefined`.)

and `releaseBuffers(): void;` to the `Pipeline` interface. Import `IDENTITY_MAT3` from `../geometry/view` and `type ReshapeView` from `./passes/reshape`.

`src/engine/shaders/present.ts` (LF): `PRESENT_FS` becomes

```ts
/** Plain source draw for hold-to-compare (renderOriginal); uGeo = V → O, identity in 裁切 mode and in the camera. */
export const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform mat3 uGeo;
out vec4 outColor;
void main() { outColor = vec4(texture(uSrc, (uGeo * vec3(vUv, 1.0)).xy).rgb, 1.0); }`;
```

`src/engine/passes/mask.ts` (CRLF): `MASK_VS` (`mask.ts:46-53`) becomes

```ts
const MASK_VS = /* glsl */ `#version 300 es
in vec2 aPos;   // O-space UV, top-left origin
in float aVal;  // 1 = mask on, 0 = off
uniform vec4 uWin; // the O rect the target covers (a tile's window); (0, 0, 1, 1) = the whole image
out float vVal;
void main() {
  vVal = aVal;
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;
```

`MaskPass.drawFaces` (interface `mask.ts:21`, implementation `:172-219`) gains the last parameter `view?: { win: readonly [number, number, number, number]; aspect?: number }`; in the implementation the geometry aspect (`const aspect = dst.width / dst.height;`, `:181`) becomes `view?.aspect ?? dst.width / dst.height` (today's value when no view is given), and after `prog.use();` (`:188`) `const w = view?.win ?? [0, 0, 1, 1]; gl.uniform4f(prog.u('uWin'), w[0], w[1], w[2], w[3]);`. The one-face `draw` (`:223-226`) passes no view.

`src/engine/passes/makeup.ts` (CRLF): `MakeupPass.drawFaces` (interface `makeup.ts:125`, implementation `:198-235`) gains the last parameter `win: readonly [number, number, number, number] = [0, 0, 1, 1]`, and the vertex loop (`for (let i = 0; i < 222; i++) pos[i] = p[i] * 2 - 1;`, `makeup.ts:210`) maps each landmark into the target window on the CPU, exactly today's arithmetic at identity (`(p − 0) / 1 = p`); the one-face `draw` (`:239-241`) passes no window:

```ts
      for (let i = 0; i < 222; i += 2) {
        pos[i] = ((p[i] - win[0]) / win[2]) * 2 - 1;
        pos[i + 1] = ((p[i + 1] - win[1]) / win[3]) * 2 - 1;
      }
```

(S §4.2 puts this map in the vertex shader; doing it where `pos` is already computed keeps the identity case bit-identical, because a shader round trip `aPos·0.5 + 0.5` would round.)

- [x] **Step 5: Engine entry points**

`src/engine/index.ts` (CRLF): import `IDENTITY_GEOMETRY, IDENTITY_MAT3, glMat3, isIdentity, viewSize, vToO` from `../geometry/view`, `shrinkTexture` from `./gl/gl` (the `./gl/gl` import, `index.ts:7-15`), `adjustFrameFor` from `./uniforms` (`index.ts:22`), and types `Geometry, Rect` (`index.ts:5`; not `PxRect`: `renderTile`'s parameters are typed by `Engine`, and an unused import fails `noUnusedLocals`). Drop `frameFor` from the `./adjustMath` import (`index.ts:6`): `adjustFrameFor` replaces its one use, and `noUnusedLocals` rejects the leftover. Add helpers inside `createEngine` (next to `sizeCanvas`, `index.ts:260`):

```ts
  const rect4 = (r: Rect | undefined): [number, number, number, number] => (r ? [r.x, r.y, r.w, r.h] : [0, 0, 1, 1]);
  const same4 = (a: readonly number[], b: readonly number[]) => a.every((v, i) => v === b[i]);

  /** the V buffer size: the tile's, else (stills) the crop at the source density, else today's processing size */
  function frameSize(input: RenderInput, still: boolean): Size {
    if (input.output) return { width: input.output.pixelSize.width, height: input.output.pixelSize.height };
    const g = input.geometry;
    if (still && g && !isIdentity(g)) {
      const v = viewSize(g, { width: input.width, height: input.height });
      return processingSize(v.width, v.height, tier, true, maxSize);
    }
    return processingSize(input.width, input.height, tier, still, maxSize);
  }
```

In `job(...)` (`index.ts:265-312`), compute `const view = viewFields(input, size);` first and spread `...view` into the returned object (step 1/2's fields stay), with

```ts
  function viewFields(input: RenderInput, size: Size) {
    const g: Geometry = input.geometry ?? IDENTITY_GEOMETRY;
    const geoIdentity = isIdentity(g);
    const win = rect4(input.sourceWindow);
    const tile = rect4(input.output?.tile);
    const windowed = !same4(win, tile);
    const plain = geoIdentity && !windowed;
    const srcSize: Size = plain ? size : { width: input.width, height: input.height };
    const oAspect = input.oAspect ?? srcSize.width / srcSize.height;
    const fullShortEdge = input.output?.fullShortEdge ?? (plain ? Math.min(size.width, size.height) : Math.min(input.width, input.height));
    const geo = geoIdentity ? IDENTITY_MAT3 : glMat3(vToO(g, { width: oAspect, height: 1 }));
    return { win, tile, geo, geoIdentity, windowed, oAspect, srcSize, fullShortEdge };
  }
```

Where step 2's `job()` builds the frame for its memoized `adjustFor(values, look, lookReady, frame)` (`index.ts:306`: step 2 passes `frameFor(size, input.pictureFrame, input.grainSeed ?? 0)`), pass instead

```ts
    adjustFrameFor(input, size, view.fullShortEdge)
```

(`view` = the `viewFields(...)` result). Without `output`, at identity, this is exactly step 2's frame (`fullShortEdge = min(size)`); with the camera's `pictureFrame` it is step 2's camera frame; a crop keeps the photo's short edge; a tile gets its slice of the whole V.

`render`: `const size = frameSize(input, still);` (replacing `processingSize(...)` at `index.ts:350`). `renderToImageData`: `const size = frameSize(input, true);` (`index.ts:364`). Replace `renderOriginal` (`index.ts:378-384`) and add `renderTile` / `releaseBuffers`:

```ts
    renderOriginal(input, opts) {
      if (lost || disposed || !pipeline || !srcTex || input.width <= 0 || input.height <= 0) return;
      const g = input.geometry;
      const turned = opts?.still === true && !!g && !isIdentity(g);
      let size = processingSize(input.width, input.height, tier, opts?.still === true, maxSize);
      if (turned) {
        const v = viewSize(g, { width: input.width, height: input.height });
        size = processingSize(v.width, v.height, tier, true, maxSize);
      }
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      sizeCanvas(size);
      pipeline.drawSource(srcTex, options.mirror, turned ? glMat3(vToO(g, { width: input.width, height: input.height })) : IDENTITY_MAT3);
    },

    renderTile(input, read) {
      if (lost || disposed || !pipeline || !srcTex) throw new Error('renderTile: WebGL context unavailable');
      if (!input.output) throw new Error('renderTile: no output tile');
      if (input.width <= 0 || input.height <= 0) throw new Error('renderTile: empty source');
      const size = frameSize(input, true);
      uploadSource(gl, srcTex, input.source, input.width, input.height);
      const res = pipeline.run(job(input, srcTex, size, false, 'fbo', false));
      const out = res.output;
      if (!out) throw new Error('renderTile: no output buffer');
      const pixels = new Uint8Array(read.w * read.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      // FBO row 0 = image top (gl.ts convention): the ImageData needs no flip
      gl.readPixels(read.x, read.y, read.w, read.h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      return new ImageData(new Uint8ClampedArray(pixels.buffer), read.w, read.h);
    },

    releaseBuffers() {
      if (lost || disposed || !pipeline) return;
      pipeline.releaseBuffers();
      if (srcTex) shrinkTexture(gl, srcTex);
    },
```

(`renderOriginal` takes a `Pick` of `RenderInput`, so it sizes the V canvas with `viewSize` directly.)

- [x] **Step 6: Fakes**

`src/app/testFakes.ts`: `FakeEngine` (`testFakes.ts:123-143`) gains `renderTile: ReturnType<typeof vi.fn<Engine['renderTile']>>; releaseBuffers: ReturnType<typeof vi.fn<Engine['releaseBuffers']>>;` and `fakeEngine` (`:145-211`, next to `renderOriginal`) gains

```ts
    renderTile: vi.fn(
      (_input: RenderInput, read: PxRect) =>
        ({ width: read.w, height: read.h, data: new Uint8ClampedArray(read.w * read.h * 4) }) as unknown as ImageData,
    ),
    releaseBuffers: vi.fn(),
```

(`PxRect` joins the `../types` type import). `tests/harness/t7/fakes.ts` `class FakeEngine implements Engine` (`fakes.ts:92-153`; `PxRect` joins its `../../../src/types` type import) gains:

```ts
  renderTile(input: RenderInput, read: PxRect) {
    const c = document.createElement('canvas');
    c.width = read.w;
    c.height = read.h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(input.source as CanvasImageSource, -read.x, -read.y);
    return ctx.getImageData(0, 0, read.w, read.h);
  }
  releaseBuffers() {}
```

- [x] **Step 7: Run the unit tests, the engine harnesses and parity**

Run: `npx vitest run src/engine/`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/engine.spec.ts tests/e2e/reshape.spec.ts tests/e2e/faceProtect.spec.ts tests/e2e/parity.spec.ts`
Expected: all passed (identity geometry is bit-identical; parity ≤ 1/255).

- [x] **Step 8: Commit**

```bash
git add src/types.ts src/engine/ src/app/testFakes.ts tests/harness/t7/fakes.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: engine renders V from O windows (renderTile, releaseBuffers, fullShortEdge kernels)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `backMapCpu`, the export planner and the tile-equivalence harness

**Files:**
- Create: `src/engine/backMapCpu.ts`, `src/engine/backMapCpu.test.ts`, `tests/e2e/pages/export.html`, `tests/e2e/pages/export.ts`, `tests/e2e/export.spec.ts`
- Modify: `src/media/exportPlan.ts` (plan, tiles, bounds, source retention), `src/media/exportPlan.test.ts`

**Interfaces:**
- Consumes: Task 1 (`apply`, `vToO`, `snapCrop`, `viewSize`, `Vec2`), Task 4 (`fullExportBlock`, `ExportEnv`, `FullBlock`, `ExportDebugKnob` from `src/store/settings.ts`), Task 5 (`FULL_JPEG_QUALITY`, `JPEG_QUALITY` from `exporter.ts`; `fitLongEdge` from `importer.ts:16`), Task 7 (`displacementBound`, `reshapeGeometry`, `reshapeUniforms`, `reshapeActive`, `UvMap`, `reshapeMapCpu`), Task 8 (`RenderInput.output/sourceWindow/oAspect`, `Engine.renderTile`); step 1 `RenderFace {face, weight, person}`, `defaultPhoto`, `neutralPerson`; step 2 `Engine.loadLut('look', id)`, `photo.look`, `adjust.grain`/`adjust.vignette` ids.
- Produces (`backMapCpu.ts`): `interface BackMapFrame { geometry: Geometry; oSize: Size; oMap: UvMap }`; `backMapCpu(v: Vec2, frame: BackMapFrame): [number, number]`; `backMapperCpu(frame): (v: Vec2) => [number, number]`.
- Produces (`exportPlan.ts`): `interface SourceInfo { blob: Blob | null; width: number | null; height: number | null }`; `NO_SOURCE: SourceInfo`; `interface TileJob { out: PxRect; buf: PxRect; win: PxRect }`; `interface ExportPlan { mode: 'working' | 'tiled'; format; quality; width; height; decode: Size | null; fullShortEdge; tile; tiles: TileJob[]; fallback: 'noSource' | 'notLarger' | FullBlock }`; `interface FaceBound { box: readonly [number, number, number, number]; bound: number }`; `interface TileBounds { body: BodyField | null; faces: readonly FaceBound[]; liquifyMaxDisp?: (rectO: Rect) => number; spotWindowGrowth?: (winO: Rect) => Rect; oSpacePasses?: boolean }`; `interface TileGrid { V: Size; decode: Size; geometry: Geometry; oAspect: number; fullShortEdge: number }`; `TILE_SIZES`; `apronFor(fullShortEdge): number`; `planTiles(grid, bounds, T): TileJob[]`; `tileBytes(t, oSpace): number`; `chooseTile(grid, bounds, budgetBytes?): { tile: number; tiles: TileJob[] }`; `faceBoundsFor(faces: readonly RenderFace[], oAspect): FaceBound[]`; `bodyMaxDispPx(field, decode): number`; `planExport(edit: { photo: { geometry: Geometry } }, prefs: Pick<Prefs, 'exportFormat' | 'exportSize'>, source: SourceInfo, working: Size, env: ExportEnv, bounds: TileBounds, knob?: ExportDebugKnob): ExportPlan`; `shouldKeepSource(file: Blob, probed: Size | null, workingLong: number, estimate?): Promise<boolean>`; `sourceSizeRecord(probed: Size | null, workingLong: number): { sourceWidth: number; sourceHeight: number } | null`. Hooks for later steps: `TileBounds.liquifyMaxDisp` (step 6, its `maxDisp`, UV), `spotWindowGrowth` and `oSpacePasses` (step 4).

- [ ] **Step 1: Write the failing tests**

Create `src/engine/backMapCpu.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, glMat3, IDENTITY_GEOMETRY, rotateLeft, setStraighten, vToO } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import type { ParamId } from '../types';
import { backMapCpu, backMapperCpu } from './backMapCpu';
import { PARAM_DEFS } from './params';
import { reshapeUniforms } from './passes/reshape';
import { reshapeMapCpu, withView } from './passes/reshapeCpu';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const oSize = { width: lm.width, height: lm.height };
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const values = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
values['shape.faceSlim'] = 1;
values['shape.eyeEnlarge'] = 1;
const oMap = reshapeMapCpu(face, reshapeUniforms(values, 1), lm.width / lm.height);

describe('backMapCpu (the CPU copy of P2, S §4.6)', () => {
  it('with an identity O map it is vToO', () => {
    const g = setStraighten(rotateLeft(IDENTITY_GEOMETRY), 12, oSize);
    const id = (x: number, y: number): [number, number] => [x, y];
    expect(backMapCpu([0.3, 0.6], { geometry: g, oSize, oMap: id })).toEqual(apply(vToO(g, oSize), [0.3, 0.6]));
  });

  it('applies Geo⁻¹ first, then the O-space chain, like the shader (withView with the float32 mat3)', () => {
    const g = setStraighten(IDENTITY_GEOMETRY, -7.3, oSize);
    const frame = { geometry: g, oSize, oMap };
    const gpuForm = withView(oMap, { geo: glMat3(vToO(g, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] });
    const many = backMapperCpu(frame);
    for (const v of [[0.4, 0.3], [0.5, 0.45], [0.62, 0.38]] as const) {
      const a = backMapCpu(v, frame);
      const b = gpuForm(v[0], v[1]);
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 6);
      expect(many(v)).toEqual(a);
    }
  });
});
```

Add to `src/media/exportPlan.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fieldAt } from '../body/cpuWarp';
import { backMapperCpu } from '../engine/backMapCpu';
import { PARAM_DEFS } from '../engine/params';
import { displacementBound, reshapeGeometry, reshapeUniforms } from '../engine/passes/reshape';
import { reshapeMapCpu, type UvMap } from '../engine/passes/reshapeCpu';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft, setStraighten, snapCrop, viewSize } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import type { BodyField, Face, Geometry, ParamId, Prefs } from '../types';
import {
  apronFor,
  chooseTile,
  planExport,
  planTiles,
  shouldKeepSource,
  sourceSizeRecord,
  TILE_SIZES,
  type SourceInfo,
  type TileBounds,
  type TileGrid,
} from './exportPlan';

const W2048 = { width: 2048, height: 1536 };
const prefs = (over: Partial<Pick<Prefs, 'exportFormat' | 'exportSize'>> = {}) => ({ exportFormat: 'jpeg' as const, exportSize: 'full' as const, ...over });
const src = (w: number | null, h: number | null, blob: Blob | null = new Blob(['x'])): SourceInfo => ({ blob, width: w, height: h });
const edit = (g: Geometry = IDENTITY_GEOMETRY) => ({ photo: { geometry: g } });
const NO_BOUNDS: TileBounds = { body: null, faces: [] };

describe('planExport: plan selection (S §3.7)', () => {
  it('standard pref, a block, no source, or a source no larger than the working copy → working (today\'s path)', () => {
    const a = planExport(edit(), prefs({ exportSize: 'standard' }), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([a.mode, a.width, a.height, a.fallback, a.quality]).toEqual(['working', 2048, 1536, null, 0.92]);
    const tierL = planExport(edit(), prefs(), src(4032, 3024), { width: 1440, height: 1080 }, env({ autoTier: 'L' }), NO_BOUNDS);
    expect([tierL.mode, tierL.width, tierL.fallback, tierL.quality]).toEqual(['working', 1440, 'tierL', 0.95]);
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env({ screen: { width: 375, height: 667 } }), NO_BOUNDS).fallback).toBe('device');
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env({ capped: true }), NO_BOUNDS).fallback).toBe('guard');
    expect(planExport(edit(), prefs(), src(null, null, null), W2048, env(), NO_BOUNDS).fallback).toBe('noSource');
    expect(planExport(edit(), prefs(), src(4032, 3024, null), W2048, env(), NO_BOUNDS).fallback).toBe('noSource');
    expect(planExport(edit(), prefs(), src(2048, 1536), W2048, env(), NO_BOUNDS).fallback).toBe('notLarger');
  });

  it('a larger source with the full pref → tiled at min(source, 4096), q 0.95; PNG has no quality', () => {
    const p = planExport(edit(), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([p.mode, p.width, p.height, p.fullShortEdge, p.quality]).toEqual(['tiled', 4032, 3024, 3024, 0.95]);
    expect(p.decode).toEqual({ width: 4032, height: 3024 });
    const big = planExport(edit(), prefs({ exportFormat: 'png' }), src(8064, 6048), W2048, env(), NO_BOUNDS);
    expect([big.width, big.height, big.format]).toEqual([4096, 3072, 'png']);
  });

  it('a crop exports the cropped part at the decode density; 旋轉 swaps the sides', () => {
    const one = applyRatio(IDENTITY_GEOMETRY, '1:1', W2048);
    const p = planExport(edit(one), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([p.width, p.height]).toEqual([3024, 3024]);
    const turned = planExport(edit(rotateLeft(IDENTITY_GEOMETRY)), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([turned.width, turned.height]).toEqual([3024, 4032]);
  });

  it('a panorama and a sliver stay finite (Review Focus 4)', () => {
    const pano = planExport(edit(), prefs(), src(16000, 4000), { width: 2048, height: 512 }, env(), NO_BOUNDS);
    expect([pano.mode, pano.width, pano.height]).toEqual(['tiled', 4096, 1024]);
    expectPartition(pano.tiles, { width: pano.width, height: pano.height });
    const sliver = planExport(edit(), prefs(), src(20000, 3), { width: 2048, height: 1 }, env(), NO_BOUNDS);
    expect(sliver.width).toBe(4096);
    expect(sliver.height).toBeGreaterThanOrEqual(1);
    expectPartition(sliver.tiles, { width: sliver.width, height: sliver.height });
  });

  it('the knob forces the tile size', () => {
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS, { tile: 256 }).tile).toBe(256);
  });
});

/** the out rects cover V exactly once (counted, then asserted once: millions of pixels) */
function expectPartition(tiles: { out: { x: number; y: number; w: number; h: number } }[], V: { width: number; height: number }) {
  const seen = new Uint8Array(V.width * V.height);
  let overlaps = 0;
  for (const { out } of tiles)
    for (let y = out.y; y < out.y + out.h; y++)
      for (let x = out.x; x < out.x + out.w; x++) {
        const i = y * V.width + x;
        if (seen[i]) overlaps++;
        seen[i] = 1;
      }
  expect(overlaps).toBe(0);
  expect(seen.indexOf(0)).toBe(-1);
}

describe('planTiles (S §4.4)', () => {
  const grid = (V: { width: number; height: number }, decode = V, g: Geometry = IDENTITY_GEOMETRY, fse = Math.min(decode.width, decode.height)): TileGrid => ({
    V,
    decode,
    geometry: g,
    oAspect: decode.width / decode.height,
    fullShortEdge: fse,
  });

  it('apronV = ceil(14·k) + 2 rounded up to 4: 64 at a 3072 short edge', () => {
    expect(apronFor(3072)).toBe(64);
    expect(apronFor(1536)).toBe(32);
    expect(apronFor(720) % 4).toBe(0);
  });

  it('tiles partition V; origins are multiples of 4; buf ⊆ V and win ⊆ decode, also off the 4-grid', () => {
    for (const V of [{ width: 4096, height: 3072 }, { width: 4001, height: 2999 }, { width: 601, height: 799 }]) {
      for (const T of [256, 1024]) {
        const tiles = planTiles(grid(V), NO_BOUNDS, T);
        expectPartition(tiles, V);
        for (const t of tiles) {
          expect(t.out.x % 4).toBe(0);
          expect(t.out.y % 4).toBe(0);
          expect(t.buf.x >= 0 && t.buf.y >= 0 && t.buf.x + t.buf.w <= V.width && t.buf.y + t.buf.h <= V.height).toBe(true);
          expect(t.win.x >= 0 && t.win.y >= 0 && t.win.x + t.win.w <= V.width && t.win.y + t.win.h <= V.height).toBe(true);
          expect(t.buf.x <= t.out.x && t.buf.x + t.buf.w >= t.out.x + t.out.w).toBe(true);
        }
      }
    }
  });

  it('the TILE choice: 1024 at 4096 × 3072 within 40 MiB', () => {
    const r = chooseTile(grid({ width: 4096, height: 3072 }), NO_BOUNDS);
    expect(r.tile).toBe(1024);
    expect(TILE_SIZES).toEqual([2048, 1024, 512, 256]);
  });

  it('coverage: every buffer pixel of every tile samples inside its window (two faces, a body field, θ = 12°)', () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
      width: number;
      height: number;
      points: number[];
    };
    const decode = { width: 400, height: 600 };
    const aspect = decode.width / decode.height;
    const faceA = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const moved = (f: Face, s: number, dx: number, dy: number): Face => {
      const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? v * s + dx : v * s + dy));
      return { ...f, pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval) };
    };
    const faceB = moved(faceA, 0.4, 0.55, 0.05);
    const values = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
    for (const id of ['shape.faceSlim', 'shape.faceV', 'shape.chin', 'shape.eyeEnlarge', 'shape.eyeDistance'] as ParamId[]) values[id] = 1;
    const u = reshapeUniforms(values, 1);
    const bw = 16;
    const bh = 24;
    const bd = new Float32Array(bw * bh * 2);
    for (let i = 0; i < bw * bh; i++) {
      bd[i * 2] = 0.02 * Math.sin(i * 0.37);
      bd[i * 2 + 1] = 0.015 * Math.cos(i * 0.21);
    }
    const body: BodyField = { width: bw, height: bh, data: bd, version: 1 };
    const mapA = reshapeMapCpu(faceA, u, aspect);
    const mapB = reshapeMapCpu(faceB, u, aspect);
    const oMap: UvMap = (x, y) => {
      const d = fieldAt(body, x, y);
      const bx = x + d[0];
      const by = y + d[1];
      const a = mapA(bx, by);
      const b = mapB(bx, by);
      return [a[0] + b[0] - bx, a[1] + b[1] - by];
    };
    const bounds: TileBounds = {
      body,
      faces: [faceA, faceB].map((f) => ({ box: reshapeGeometry(f, aspect, u).box, bound: displacementBound(f, aspect, u) })),
    };
    const g = snapCrop(setStraighten(IDENTITY_GEOMETRY, 12, decode), decode);
    const V = viewSize(g, decode);
    const tiles = planTiles({ V, decode, geometry: g, oAspect: aspect, fullShortEdge: 400 }, bounds, 64);
    const back = backMapperCpu({ geometry: g, oSize: decode, oMap });
    let checked = 0;
    const outside: number[][] = [];
    for (const t of tiles)
      for (let y = t.buf.y; y < t.buf.y + t.buf.h; y += 3)
        for (let x = t.buf.x; x < t.buf.x + t.buf.w; x += 3) {
          const o = back([(x + 0.5) / V.width, (y + 0.5) / V.height]);
          const px = o[0] * decode.width;
          const py = o[1] * decode.height;
          // a window clipped at the decode edge may be passed there (CLAMP_TO_EDGE does the same untiled)
          const inX = (t.win.x === 0 || px >= t.win.x) && (t.win.x + t.win.w === decode.width || px <= t.win.x + t.win.w);
          const inY = (t.win.y === 0 || py >= t.win.y) && (t.win.y + t.win.h === decode.height || py <= t.win.y + t.win.h);
          if (!inX || !inY) outside.push([x, y, px, py]);
          checked++;
        }
    expect(checked).toBeGreaterThan(5000);
    expect(outside.slice(0, 5)).toEqual([]);
  });
});

describe('source retention (S §3.7)', () => {
  const file = (bytes: number) => ({ size: bytes }) as Blob;
  const MiB = 1024 * 1024;
  it('keeps a larger original within 30 MiB when 3× its size is free', async () => {
    const est = (quota: number, usage: number) => async () => ({ quota, usage });
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, est(1000 * MiB, 100 * MiB))).toBe(true);
    expect(await shouldKeepSource(file(8 * MiB), { width: 2048, height: 1536 }, 2048, est(1000 * MiB, 0))).toBe(false);
    expect(await shouldKeepSource(file(31 * MiB), { width: 8064, height: 6048 }, 2048, est(1000 * MiB, 0))).toBe(false);
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, est(30 * MiB, 10 * MiB))).toBe(false);
    expect(await shouldKeepSource(file(8 * MiB), null, 2048, est(1000 * MiB, 0))).toBe(false);
  });

  it('without an estimate (missing or throwing) only files ≤ 10 MiB are kept', async () => {
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, undefined)).toBe(true);
    expect(await shouldKeepSource(file(12 * MiB), { width: 4032, height: 3024 }, 2048, undefined)).toBe(false);
    const boom = async () => {
      throw new Error('no');
    };
    expect(await shouldKeepSource(file(12 * MiB), { width: 4032, height: 3024 }, 2048, boom)).toBe(false);
  });

  it('records the oriented size whenever it exceeds the working edge', () => {
    expect(sourceSizeRecord({ width: 4032, height: 3024 }, 2048)).toEqual({ sourceWidth: 4032, sourceHeight: 3024 });
    expect(sourceSizeRecord({ width: 2000, height: 1500 }, 2048)).toBeNull();
    expect(sourceSizeRecord(null, 2048)).toBeNull();
  });
});
```

(`env` is the helper from Task 4's tests at the top of the file.)

Create `tests/e2e/export.spec.ts`:

```ts
// The tiled full-resolution export must equal one untiled render of the same V (S §8.2): windows, aprons, the
// fullShortEdge kernels and the global-V grain / vignette make every tile seamless.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('a TILE = 256 export equals the untiled render (warps, 磨皮, lip, body field, 顆粒, 暗角, 膠片) at three geometries', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/export.html`);
  await page.waitForFunction(() => typeof window.runExportTiles === 'function');
  const res = await page.evaluate(() => window.runExportTiles!());
  expect(res.map((r) => r.name)).toEqual(['identity', 'quarter 1 + flip', 'θ 12° + crop', '601×799 identity']);
  for (const r of res) {
    console.log(`${r.name}: ${r.w}×${r.h}, ${r.tiles} tiles, max channel diff ${r.maxDiff}/255, glError ${r.glError}`);
    expect(r.glError, r.name).toBe(0);
    expect(r.tiles, r.name).toBeGreaterThan(1);
    expect(r.maxDiff, r.name).toBeLessThanOrEqual(r.name.startsWith('601') ? 2 : 1);
  }
});
```

- [ ] **Step 2: Run the unit tests to see them fail**

Run: `npx vitest run src/engine/backMapCpu.test.ts src/media/exportPlan.test.ts`
Expected: FAIL — `Failed to resolve import "./backMapCpu"`, `planExport is not exported`.

- [ ] **Step 3: Implement `backMapCpu.ts`**

```ts
// The one CPU copy of P2's backward map (S §4.6, C §4.2): a V point → the O position whose content P2 samples there.
// Order as in RESHAPE_FS: Geo⁻¹, then the O-space maps (liquify from step 6, the body field, the face chains with caps and
// protect), which `oMap` carries. Used by the tile-planner tests, step 4's spot taps (skin-cleanup spec §3.4 cpuSample)
// and the e2e GPU-vs-CPU checks. Test / tap only: never in a render path.
import { apply, vToO, type Vec2 } from '../geometry/view';
import type { Geometry, Size } from '../types';
import type { UvMap } from './passes/reshapeCpu';

export interface BackMapFrame {
  geometry: Geometry;
  /** any size with the O aspect (the working bitmap's): only the aspect enters the straighten rotation */
  oSize: Size;
  /** the O-space part of P2: reshapeMapCpu(face, u, aspect, body, protect) for one face, or reshapeMapMulti(faces, aspect, { body, protects }) for the photo's faces */
  oMap: UvMap;
}

export function backMapCpu(v: Vec2, frame: BackMapFrame): [number, number] {
  const o = apply(vToO(frame.geometry, frame.oSize), v);
  return frame.oMap(o[0], o[1]);
}

/** the same map for many points (the affine is built once) */
export function backMapperCpu(frame: BackMapFrame): (v: Vec2) => [number, number] {
  const m = vToO(frame.geometry, frame.oSize);
  return (v) => {
    const o = apply(m, v);
    return frame.oMap(o[0], o[1]);
  };
}
```

- [ ] **Step 4: Implement the planner in `exportPlan.ts`**

Extend the imports and append:

```ts
import { GL_TILE_BUDGET_MB, FULL_EXPORT_MAX_EDGE, SOURCE_MAX_MB } from '../config/limits';
import { displacementBound, reshapeActive, reshapeGeometry, reshapeUniforms } from '../engine/passes/reshape';
import { MEAN_REFERENCE_SHORT_EDGE } from '../engine/uniforms';
import { apply, snapCrop, viewSize, vToO } from '../geometry/view';
import type { ExportDebugKnob } from '../store/settings';
import type { BodyField, ExportFormat, Geometry, ParamId, PxRect, Rect, RenderFace, Size } from '../types';
import { FULL_JPEG_QUALITY, JPEG_QUALITY } from './exporter';
import { fitLongEdge } from './importer';

export interface SourceInfo {
  /**
   * the file to export from: on reopen HistoryEntry.source; in the first session the picked File, only once
   * shouldKeepSource accepted it (the first session and every reopen export the same); null = none
   */
  blob: Blob | null;
  /** oriented size from the import probe; null = unknown (v1 entries, camera shots) */
  width: number | null;
  height: number | null;
}

export const NO_SOURCE: SourceInfo = { blob: null, width: null, height: null };

export interface TileJob {
  /** V output pixels this tile writes (the tiles partition V) */
  out: PxRect;
  /** V pixels the GPU buffers cover: out ⊕ apron, snapped outward to multiples of 4, then clipped to V */
  buf: PxRect;
  /** decode pixels the source crop covers: bbox(Geo⁻¹(buf)) ⊕ displacement bound ⊕ 4, snapped to 4, then clipped */
  win: PxRect;
}

export interface ExportPlan {
  mode: 'working' | 'tiled';
  format: ExportFormat;
  /** JPEG only: 0.95 when the size pref is 'full' (whatever the mode), 0.92 for 'standard' */
  quality: number;
  /** V output size in pixels */
  width: number;
  height: number;
  /** 'tiled': the size the source is decoded at */
  decode: Size | null;
  /** O short edge in output pixels (kernel scale, C §3.5) */
  fullShortEdge: number;
  tile: number;
  tiles: TileJob[];
  /** why the plan is 'working' while the size pref is 'full'; null otherwise */
  fallback: 'noSource' | 'notLarger' | FullBlock;
}

export interface FaceBound {
  /** the face's influence box (UV, reshapeGeometry().box) */
  box: readonly [number, number, number, number];
  /** displacementBound: iso units (fractions of the O width) */
  bound: number;
}

export interface TileBounds {
  /** the O-space body field (UV vectors); null = none */
  body: BodyField | null;
  /** every face with an active warp */
  faces: readonly FaceBound[];
  /** step 6: the liquify model's max |L| over an O rect, UV; absent = no strokes */
  liquifyMaxDisp?: (rectO: Rect) => number;
  /** step 4: grows an O-normalized window around the spots (and donors) that meet it; absent = identity */
  spotWindowGrowth?: (winO: Rect) => Rect;
  /** step 4: an O-space pass holds B at window size, so the GL budget is (3·win² + 2·buf²)·4 B */
  oSpacePasses?: boolean;
}

export interface TileGrid {
  /** V output size */
  V: Size;
  /** decode size of the source */
  decode: Size;
  /** the geometry snapped to the decode grid (snapCrop) */
  geometry: Geometry;
  /** the working bitmap's aspect (S §4.1 oAspect) */
  oAspect: number;
  fullShortEdge: number;
}

export const TILE_SIZES = [2048, 1024, 512, 256] as const;

const floor4 = (n: number) => Math.floor(n / 4) * 4;
const ceil4 = (n: number) => Math.ceil(n / 4) * 4;

/** the mean's reach per axis is 14·k (3.5 × 4·k), each pass's bilinear tap adds ≤ 1 px; sharpen lies inside (S D11) */
export function apronFor(fullShortEdge: number): number {
  const k = fullShortEdge / MEAN_REFERENCE_SHORT_EDGE;
  return ceil4(Math.ceil(14 * k) + 2);
}

/** the largest body-field texel, in decode pixels (a bilinear field never exceeds its largest texel) */
export function bodyMaxDispPx(field: BodyField | null, decode: Size): number {
  if (!field) return 0;
  let m = 0;
  for (let i = 0; i + 1 < field.data.length; i += 2) m = Math.max(m, Math.hypot(field.data[i] * decode.width, field.data[i + 1] * decode.height));
  return m;
}

/** |tc − o| ≤ L + B + Σ F_f over the faces near the tile's O rect (S §4.4), in decode pixels */
function displacementPx(rectO: Rect, bounds: TileBounds, decode: Size, oAspect: number, bodyPx: number): number {
  const L = bounds.liquifyMaxDisp ? bounds.liquifyMaxDisp(rectO) * Math.max(decode.width, decode.height) : 0;
  const reach = L + bodyPx;
  const gx = reach / decode.width;
  const gy = reach / decode.height;
  let F = 0;
  for (const f of bounds.faces) {
    const fx = f.bound;
    const fy = f.bound * oAspect; // iso y = UV y / aspect
    const near =
      f.box[0] - fx <= rectO.x + rectO.w + gx &&
      f.box[2] + fx >= rectO.x - gx &&
      f.box[1] - fy <= rectO.y + rectO.h + gy &&
      f.box[3] + fy >= rectO.y - gy;
    if (near) F += f.bound * decode.width;
  }
  return L + bodyPx + F;
}

export function planTiles(grid: TileGrid, bounds: TileBounds, T: number): TileJob[] {
  const { V, decode } = grid;
  const apron = apronFor(grid.fullShortEdge);
  const m = vToO(grid.geometry, { width: grid.oAspect, height: 1 });
  const bodyPx = bodyMaxDispPx(bounds.body, decode);
  const tiles: TileJob[] = [];
  for (let y = 0; y < V.height; y += T) {
    for (let x = 0; x < V.width; x += T) {
      const out: PxRect = { x, y, w: Math.min(T, V.width - x), h: Math.min(T, V.height - y) };
      const bx0 = Math.max(0, floor4(out.x - apron));
      const by0 = Math.max(0, floor4(out.y - apron));
      const bx1 = Math.min(V.width, ceil4(out.x + out.w + apron));
      const by1 = Math.min(V.height, ceil4(out.y + out.h + apron));
      const buf: PxRect = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
      let ox0 = Infinity;
      let oy0 = Infinity;
      let ox1 = -Infinity;
      let oy1 = -Infinity;
      for (const [px, py] of [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]]) {
        const [ox, oy] = apply(m, [px / V.width, py / V.height]);
        ox0 = Math.min(ox0, ox);
        oy0 = Math.min(oy0, oy);
        ox1 = Math.max(ox1, ox);
        oy1 = Math.max(oy1, oy);
      }
      const rectO: Rect = { x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0 };
      const pad = displacementPx(rectO, bounds, decode, grid.oAspect, bodyPx) + 4;
      let winO: Rect = {
        x: ox0 - pad / decode.width,
        y: oy0 - pad / decode.height,
        w: rectO.w + (2 * pad) / decode.width,
        h: rectO.h + (2 * pad) / decode.height,
      };
      if (bounds.spotWindowGrowth) winO = bounds.spotWindowGrowth(winO);
      const wx0 = Math.max(0, floor4(winO.x * decode.width));
      const wy0 = Math.max(0, floor4(winO.y * decode.height));
      const wx1 = Math.min(decode.width, ceil4((winO.x + winO.w) * decode.width));
      const wy1 = Math.min(decode.height, ceil4((winO.y + winO.h) * decode.height));
      tiles.push({ out, buf, win: { x: wx0, y: wy0, w: Math.max(1, wx1 - wx0), h: Math.max(1, wy1 - wy0) } });
    }
  }
  return tiles;
}

/** GL bytes of a tile: src and A at window size, B, C and D at buffer size (step 4: B at window size too) */
export function tileBytes(t: TileJob, oSpace: boolean): number {
  const win = t.win.w * t.win.h;
  const buf = t.buf.w * t.buf.h;
  return (oSpace ? 3 * win + 2 * buf : 2 * win + 3 * buf) * 4;
}

/** the largest TILE whose worst tile fits the GL budget (S D9); 256 when none does */
export function chooseTile(grid: TileGrid, bounds: TileBounds, budgetBytes = GL_TILE_BUDGET_MB * 1024 * 1024): { tile: number; tiles: TileJob[] } {
  for (const T of TILE_SIZES) {
    const tiles = planTiles(grid, bounds, T);
    if (tiles.every((t) => tileBytes(t, !!bounds.oSpacePasses) <= budgetBytes)) return { tile: T, tiles };
  }
  return { tile: 256, tiles: planTiles(grid, bounds, 256) };
}

/** the faces whose warps the tile windows must cover (P2 draws only weight > 0 faces with an active warp) */
export function faceBoundsFor(faces: readonly RenderFace[], oAspect: number): FaceBound[] {
  const out: FaceBound[] = [];
  for (const f of faces) {
    if (!(f.weight > 0)) continue;
    // reshapeUniforms reads only the shape.* values, which every person carries
    const u = reshapeUniforms(f.person.values as unknown as Record<ParamId, number>, f.weight);
    if (!reshapeActive(u)) continue;
    out.push({ box: reshapeGeometry(f.face, oAspect, u).box, bound: displacementBound(f.face, oAspect, u) });
  }
  return out;
}

export function planExport(
  edit: { photo: { geometry: Geometry } },
  prefs: { exportFormat: ExportFormat; exportSize: ExportSize },
  source: SourceInfo,
  working: Size,
  env: ExportEnv,
  bounds: TileBounds,
  knob: ExportDebugKnob = {},
): ExportPlan {
  const g = edit.photo.geometry;
  const format = prefs.exportFormat;
  const quality = format === 'jpeg' ? (prefs.exportSize === 'full' ? FULL_JPEG_QUALITY : JPEG_QUALITY) : 1;
  const workingPlan = (fallback: ExportPlan['fallback']): ExportPlan => {
    const v = viewSize(snapCrop(g, working), working);
    return { mode: 'working', format, quality, width: v.width, height: v.height, decode: null, fullShortEdge: Math.min(working.width, working.height), tile: 0, tiles: [], fallback };
  };
  if (prefs.exportSize === 'standard') return workingPlan(null);
  const block = fullExportBlock(env);
  if (block) return workingPlan(block);
  const sw = source.width ?? 0;
  const sh = source.height ?? 0;
  if (!source.blob || !(sw > 0 && sh > 0)) return workingPlan('noSource');
  if (Math.max(sw, sh) <= Math.max(working.width, working.height)) return workingPlan('notLarger');
  const decode = fitLongEdge(sw, sh, FULL_EXPORT_MAX_EDGE);
  const gs = snapCrop(g, decode);
  const V = viewSize(gs, decode);
  const fullShortEdge = Math.min(decode.width, decode.height);
  const grid: TileGrid = { V, decode, geometry: gs, oAspect: working.width / working.height, fullShortEdge };
  const { tile, tiles } = knob.tile ? { tile: knob.tile, tiles: planTiles(grid, bounds, knob.tile) } : chooseTile(grid, bounds);
  return { mode: 'tiled', format, quality, width: V.width, height: V.height, decode, fullShortEdge, tile, tiles, fallback: null };
}

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

function defaultEstimate(): (() => Promise<StorageEstimateLike>) | undefined {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  return s && typeof s.estimate === 'function' ? () => s.estimate() : undefined;
}

/** keep the picked file? (S §3.7): larger than the working copy, ≤ 30 MiB, and 3× its size free (unknown → ≤ 10 MiB) */
export async function shouldKeepSource(
  file: Blob,
  probed: Size | null,
  workingLong: number,
  estimate: (() => Promise<StorageEstimateLike>) | undefined = defaultEstimate(),
): Promise<boolean> {
  if (!probed || Math.max(probed.width, probed.height) <= workingLong) return false;
  const MiB = 1024 * 1024;
  if (file.size > SOURCE_MAX_MB * MiB) return false;
  try {
    if (!estimate) throw new Error('no storage estimate');
    const e = await estimate();
    if (typeof e.quota !== 'number' || typeof e.usage !== 'number') throw new Error('incomplete storage estimate');
    return e.quota - e.usage >= 3 * file.size;
  } catch {
    return file.size <= 10 * MiB;
  }
}

/** HistoryEntry.sourceWidth/Height: recorded whenever the original exceeded the working edge (the "only 2048 kept" note) */
export function sourceSizeRecord(probed: Size | null, workingLong: number): { sourceWidth: number; sourceHeight: number } | null {
  if (!probed || Math.max(probed.width, probed.height) <= workingLong) return null;
  return { sourceWidth: probed.width, sourceHeight: probed.height };
}
```

(Merge the type import with Task 4's: `import type { BodyField, ExportFormat, ExportSize, Geometry, ParamId, Prefs, PxRect, Rect, RenderFace, Size, Tier } from '../types';`.)

- [ ] **Step 5: Run the unit tests to see them pass**

Run: `npx vitest run src/engine/backMapCpu.test.ts src/media/exportPlan.test.ts`
Expected: PASS.

- [ ] **Step 6: The tile-equivalence harness**

Create `tests/e2e/pages/export.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>export tile check</title>
  </head>
  <body style="margin: 0; background: #000">
    <canvas id="gl"></canvas>
    <script type="module" src="./export.ts"></script>
  </body>
</html>
```

Create `tests/e2e/pages/export.ts`:

```ts
// Tile-equivalence harness (S §8.2): one synthetic frame with sample_face.png composited, rendered once as a single tile
// covering V and once with the planner's TILE = 256 tiles, at three geometries; the PNG-free comparison happens here.
// Steps 4, 5 and 6 add their cases to `CASES` (spots and tone, every makeup part, strokes).
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { defaultPhoto, neutralPerson } from '../../../src/edit/state';
import { createEngine } from '../../../src/engine/index';
import { IDENTITY_GEOMETRY, setStraighten, snapCrop, viewSize } from '../../../src/geometry/view';
import { faceBoundsFor, planTiles, type TileGrid } from '../../../src/media/exportPlan';
import { adapt } from '../../../src/tracking/adapter111';
import type { BodyField, Geometry, PersonParams, PhotoParams, RenderFace, RenderInput } from '../../../src/types';

export interface TileCheck {
  name: string;
  w: number;
  h: number;
  tiles: number;
  /** max |tiled − untiled| over every channel, 0..255 */
  maxDiff: number;
  glError: number;
}

declare global {
  interface Window {
    runExportTiles?: () => Promise<TileCheck[]>;
  }
}

/** the frame: a gradient with sample_face.png scaled to its height, centred */
async function makeFrame(w: number, h: number, face: ImageBitmap): Promise<{ bitmap: ImageBitmap; place: { x: number; s: number } }> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#c9a48a');
  g.addColorStop(1, '#3d5770');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const s = h / face.height;
  const x = (w - face.width * s) / 2;
  ctx.drawImage(face, x, 0, face.width * s, h);
  return { bitmap: await createImageBitmap(c), place: { x, s } };
}

function bodyField(): BodyField {
  const bw = 24;
  const bh = 18;
  const data = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      data[(y * bw + x) * 2] = 0.01 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      data[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  return { width: bw, height: bh, data, version: 1 };
}

window.runExportTiles = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  await engine.loadLut('look', 'film');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const sample = await createImageBitmap(await (await fetch('/tests/fixtures/sample_face.png')).blob());
  const person: PersonParams = {
    ...neutralPerson(),
    values: { ...neutralPerson().values, 'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'skin.smooth': 0.8, 'makeup.lip': 0.8 },
  };
  const out: TileCheck[] = [];
  const cases: { name: string; w: number; h: number; geometry: (size: { width: number; height: number }) => Geometry }[] = [
    { name: 'identity', w: 800, h: 600, geometry: () => IDENTITY_GEOMETRY },
    { name: 'quarter 1 + flip', w: 800, h: 600, geometry: () => ({ ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 }) },
    { name: 'θ 12° + crop', w: 800, h: 600, geometry: (size) => setStraighten(IDENTITY_GEOMETRY, 12, size) },
    { name: '601×799 identity', w: 601, h: 799, geometry: () => IDENTITY_GEOMETRY },
  ];
  for (const c of cases) {
    const decode = { width: c.w, height: c.h };
    const { bitmap, place } = await makeFrame(c.w, c.h, sample);
    // the fixture's landmarks, moved into the frame (z in width units)
    const pts = new Float32Array(landmarks.points.length);
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] = (place.x + landmarks.points[i] * landmarks.width * place.s) / c.w;
      pts[i + 1] = landmarks.points[i + 1];
      pts[i + 2] = (landmarks.points[i + 2] * landmarks.width * place.s) / c.w;
    }
    const face = adapt({ points: pts }, c.w, c.h);
    const faces: RenderFace[] = [{ face, weight: 1, person, protect: null }];
    const g = snapCrop(c.geometry(decode), decode);
    const photo: PhotoParams = {
      ...defaultPhoto(),
      values: { ...defaultPhoto().values, 'adjust.grain': 0.5, 'adjust.vignette': 0.5 },
      look: { id: 'film', amount: 0.8 },
      geometry: g,
    };
    const V = viewSize(g, decode);
    const fullShortEdge = Math.min(c.w, c.h);
    const oAspect = c.w / c.h;
    const base: Omit<RenderInput, 'source' | 'width' | 'height'> = { faces, obstacles: [], globalSkin: null, photo, body: bodyField(), geometry: g, oAspect };
    const grid: TileGrid = { V, decode, geometry: g, oAspect, fullShortEdge };
    const bounds = { body: base.body ?? null, faces: faceBoundsFor(faces, oAspect) };
    const render = async (T: number): Promise<{ data: Uint8ClampedArray; tiles: number }> => {
      const tiles = planTiles(grid, bounds, T);
      const data = new Uint8ClampedArray(V.width * V.height * 4);
      for (const t of tiles) {
        const bmp = await createImageBitmap(bitmap, t.win.x, t.win.y, t.win.w, t.win.h);
        const img = engine.renderTile(
          {
            ...base,
            source: bmp,
            width: t.win.w,
            height: t.win.h,
            sourceWindow: { x: t.win.x / c.w, y: t.win.y / c.h, w: t.win.w / c.w, h: t.win.h / c.h },
            output: { tile: { x: t.buf.x / V.width, y: t.buf.y / V.height, w: t.buf.w / V.width, h: t.buf.h / V.height }, pixelSize: { width: t.buf.w, height: t.buf.h }, fullShortEdge },
          },
          { x: t.out.x - t.buf.x, y: t.out.y - t.buf.y, w: t.out.w, h: t.out.h },
        );
        bmp.close();
        for (let y = 0; y < t.out.h; y++) data.set(img.data.subarray(y * t.out.w * 4, (y + 1) * t.out.w * 4), ((t.out.y + y) * V.width + t.out.x) * 4);
      }
      return { data, tiles: tiles.length };
    };
    const whole = await render(8192);
    const tiled = await render(256);
    let maxDiff = 0;
    for (let i = 0; i < whole.data.length; i++) if ((i & 3) !== 3) maxDiff = Math.max(maxDiff, Math.abs(whole.data[i] - tiled.data[i]));
    out.push({ name: c.name, w: V.width, h: V.height, tiles: tiled.tiles, maxDiff, glError: gl.getError() });
    bitmap.close();
  }
  sample.close();
  engine.dispose();
  return out;
};
```

(The face is made from the fixture landmarks placed in the frame; `RenderFace.protect` is null: the 瘦臉 limit is a later concern. If step 1's `RenderFace` or `RenderInput` carry more required fields, fill them with the values `buildFrame` gives a one-face photo.)

- [ ] **Step 7: Run the harness spec**

Run: `npx playwright test tests/e2e/export.spec.ts`
Expected: `1 passed`; four lines with `max channel diff` ≤ 1 (≤ 2 for 601 × 799).

- [ ] **Step 8: Commit**

```bash
git add src/engine/backMapCpu.ts src/engine/backMapCpu.test.ts src/media/exportPlan.ts src/media/exportPlan.test.ts tests/e2e/pages/export.html tests/e2e/pages/export.ts tests/e2e/export.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: backMapCpu, export planner and the tile-equivalence harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The tiled export runner (`src/media/exportFull.ts`)

**Files:**
- Create: `src/media/exportFull.ts`, `src/media/exportFull.test.ts`

**Interfaces:**
- Consumes: Task 4 (`writeExportGuard`, `clearExportGuard`, `ExportGuard`, `ExportDebugKnob`), Task 5 (`outputFileName`, `createSurface`; `importPhoto`), Task 8 (`Engine.renderTile`, `releaseBuffers`, `RenderInput.output/sourceWindow/oAspect`), Task 9 (`ExportPlan`, `TileJob`), Task 1 (`snapCrop`, `IDENTITY_GEOMETRY`).
- Produces: `type TileInputBase = Omit<RenderInput, 'source' | 'width' | 'height' | 'sourceWindow' | 'output'>`; `interface TileRenderer { renderTile(input: RenderInput, read: PxRect): ImageData; releaseBuffers(): void }` (an `Engine` is one); `interface OutputCanvas { put(img: ImageData, x: number, y: number): void; encode(quality?: number): Promise<Blob>; release(): void }`; `interface RunnerDeps { decode(blob, maxLongEdge): Promise<ImageBitmap>; crop(full, r: PxRect): Promise<ImageBitmap>; createCanvas(w, h, type: 'image/jpeg' | 'image/png'): OutputCanvas; nextFrame(): Promise<void>; sleep(ms): Promise<void>; writeGuard(g: ExportGuard): void; clearGuard(): void }`; `browserRunnerDeps: RunnerDeps`; `class ExportError extends Error { kind: 'aspect' | 'size' | 'knob' }`; `interface RunOptions { signal: AbortSignal; onProgress?(fraction: number): void; working: Size; knob?: ExportDebugKnob }`; `runTiledExport(renderer: TileRenderer, sourceBlob: Blob, plan: ExportPlan, input: TileInputBase, opts: RunOptions, deps?: RunnerDeps): Promise<File>`.

- [ ] **Step 1: Write the failing tests**

Create `src/media/exportFull.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_GEOMETRY } from '../geometry/view';
import { defaultPhoto } from '../edit/state';
import type { ExportPlan } from './exportPlan';
import { ExportError, runTiledExport, type RunnerDeps, type TileInputBase } from './exportFull';

const plan: ExportPlan = {
  mode: 'tiled',
  format: 'jpeg',
  quality: 0.95,
  width: 8,
  height: 4,
  decode: { width: 8, height: 4 },
  fullShortEdge: 4,
  tile: 4,
  tiles: [
    { out: { x: 0, y: 0, w: 4, h: 4 }, buf: { x: 0, y: 0, w: 8, h: 4 }, win: { x: 0, y: 0, w: 8, h: 4 } },
    { out: { x: 4, y: 0, w: 4, h: 4 }, buf: { x: 0, y: 0, w: 8, h: 4 }, win: { x: 0, y: 0, w: 8, h: 4 } },
  ],
  fallback: null,
};
const input = { faces: [], obstacles: [], globalSkin: null, photo: defaultPhoto(), geometry: IDENTITY_GEOMETRY, oAspect: 2 } as unknown as TileInputBase;
const working = { width: 4, height: 2 };

function fakes(decoded = { width: 8, height: 4 }) {
  const log: string[] = [];
  const full = { width: decoded.width, height: decoded.height, close: vi.fn(() => log.push('close full')) };
  const canvas = {
    put: vi.fn((_img: ImageData, x: number) => log.push(`put ${x}`)),
    encode: vi.fn(async (q?: number) => {
      log.push(`encode ${q}`);
      return new Blob(['x']);
    }),
    release: vi.fn(() => log.push('release canvas')),
  };
  const renderer = {
    renderTile: vi.fn((i: { sourceWindow?: unknown; output?: unknown }, read: { w: number; h: number }) => {
      log.push('tile');
      return { width: read.w, height: read.h, data: new Uint8ClampedArray(read.w * read.h * 4), input: i } as unknown as ImageData;
    }),
    releaseBuffers: vi.fn(() => log.push('releaseBuffers')),
  };
  const deps: RunnerDeps = {
    decode: vi.fn(async () => {
      log.push('decode');
      return full as unknown as ImageBitmap;
    }),
    crop: vi.fn(async () => ({ width: 8, height: 4, close: vi.fn() }) as unknown as ImageBitmap),
    createCanvas: vi.fn(() => canvas),
    nextFrame: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    writeGuard: vi.fn(() => log.push('guard')),
    clearGuard: vi.fn(() => log.push('clear guard')),
  };
  return { log, full, canvas, renderer, deps };
}

describe('runTiledExport (S §4.4)', () => {
  it('guard → decode → tiles (progress) → close → release → encode → clear guard; a named JPEG File', async () => {
    const f = fakes();
    const progress: number[] = [];
    const file = await runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, onProgress: (p) => progress.push(p) }, f.deps);
    expect(f.log).toEqual(['guard', 'decode', 'tile', 'put 0', 'tile', 'put 4', 'close full', 'releaseBuffers', 'encode 0.95', 'release canvas', 'clear guard']);
    expect(progress).toEqual([0.5, 1]);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^meiyan-\d{8}-\d{6}\.jpg$/);
    expect(f.deps.writeGuard).toHaveBeenCalledWith(expect.objectContaining({ w: 8, h: 4, format: 'jpeg' }));
    const call = f.renderer.renderTile.mock.calls[1];
    expect(call[0]).toMatchObject({
      sourceWindow: { x: 0, y: 0, w: 1, h: 1 },
      output: { tile: { x: 0, y: 0, w: 1, h: 1 }, pixelSize: { width: 8, height: 4 }, fullShortEdge: 4 },
      oAspect: 2,
    });
    expect(call[1]).toEqual({ x: 4, y: 0, w: 4, h: 4 });
  });

  it('PNG is encoded without a quality', async () => {
    const f = fakes();
    const file = await runTiledExport(f.renderer, new Blob(['s']), { ...plan, format: 'png' }, input, { signal: new AbortController().signal, working }, f.deps);
    expect(f.canvas.encode).toHaveBeenCalledWith(undefined);
    expect(file.type).toBe('image/png');
    expect(f.deps.createCanvas).toHaveBeenCalledWith(8, 4, 'image/png');
  });

  it('an abort frees everything synchronously inside abort(); the pending step rejects with AbortError', async () => {
    const f = fakes();
    let resume!: () => void;
    f.deps.nextFrame = vi.fn(() => new Promise<void>((r) => (resume = r)));
    const ac = new AbortController();
    const p = runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: ac.signal, working }, f.deps);
    await vi.waitFor(() => expect(f.renderer.renderTile).toHaveBeenCalledTimes(1));
    ac.abort();
    expect(f.full.close).toHaveBeenCalled();
    expect(f.canvas.release).toHaveBeenCalled();
    expect(f.renderer.releaseBuffers).toHaveBeenCalled();
    expect(f.deps.clearGuard).toHaveBeenCalled();
    resume();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.renderer.renderTile).toHaveBeenCalledTimes(1);
    expect(f.canvas.encode).not.toHaveBeenCalled();
  });

  it.each(['decode', 'tile', 'encode'] as const)('the %s knob fails the export; memory and guard are released', async (failAt) => {
    const f = fakes();
    const run = runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, knob: { failAt } }, f.deps);
    await expect(run).rejects.toBeInstanceOf(ExportError);
    expect(f.deps.clearGuard).toHaveBeenCalled();
    expect(f.renderer.releaseBuffers).toHaveBeenCalled();
    expect(f.full.close).toHaveBeenCalled();
  });

  it('a decode whose aspect is off by > 1 % (orientation ignored) throws ExportError aspect', async () => {
    const f = fakes({ width: 4, height: 8 });
    await expect(runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working }, f.deps)).rejects.toMatchObject({
      name: 'ExportError',
      kind: 'aspect',
    });
  });

  it('a renderer failure (context lost) rejects with it and releases', async () => {
    const f = fakes();
    f.renderer.renderTile.mockImplementationOnce(() => {
      throw new Error('renderTile: WebGL context unavailable');
    });
    await expect(runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working }, f.deps)).rejects.toThrow('context unavailable');
    expect(f.deps.clearGuard).toHaveBeenCalled();
  });

  it('the slow knob waits after the decode', async () => {
    const f = fakes();
    await runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, knob: { slowMs: 4500 } }, f.deps);
    expect(f.deps.sleep).toHaveBeenCalledWith(4500);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/media/exportFull.test.ts`
Expected: FAIL — `Failed to resolve import "./exportFull"`.

- [ ] **Step 3: Implement `src/media/exportFull.ts`**

```ts
// Tiled full-resolution export (step-3 spec §4.4 runner): decode the source at the plan's size, render each tile through
// the engine into one output canvas, free the GL and the decode, then encode. Every big resource is registered on the
// abort signal, so 取消, ✕ or the app going to the background frees it synchronously inside abort(). The crash breadcrumb
// brackets the run: only a kill while visible leaves it (S §3.7).
import { FULL_EXPORT_MAX_EDGE } from '../config/limits';
import { IDENTITY_GEOMETRY, snapCrop } from '../geometry/view';
import { clearExportGuard, writeExportGuard, type ExportDebugKnob, type ExportGuard } from '../store/settings';
import type { PxRect, RenderInput, Size } from '../types';
import type { ExportPlan } from './exportPlan';
import { createSurface, outputFileName } from './exporter';
import { importPhoto } from './importer';

export type TileInputBase = Omit<RenderInput, 'source' | 'width' | 'height' | 'sourceWindow' | 'output'>;

export interface TileRenderer {
  renderTile(input: RenderInput, read: PxRect): ImageData;
  releaseBuffers(): void;
}

export interface OutputCanvas {
  put(img: ImageData, x: number, y: number): void;
  /** quality: JPEG only */
  encode(quality?: number): Promise<Blob>;
  /** canvas to 0 × 0 */
  release(): void;
}

export interface RunnerDeps {
  decode(blob: Blob, maxLongEdge: number): Promise<ImageBitmap>;
  crop(full: ImageBitmap, r: PxRect): Promise<ImageBitmap>;
  createCanvas(width: number, height: number, type: 'image/jpeg' | 'image/png'): OutputCanvas;
  nextFrame(): Promise<void>;
  sleep(ms: number): Promise<void>;
  writeGuard(g: ExportGuard): void;
  clearGuard(): void;
}

export const browserRunnerDeps: RunnerDeps = {
  // the import's own decoder: EXIF orientation, probeSize, the <img> fallback (importer.ts:4-13)
  decode: (blob, edge) => importPhoto(blob, edge),
  crop: (full, r) => createImageBitmap(full, r.x, r.y, r.w, r.h),
  createCanvas: (w, h, type) => {
    const s = createSurface(w, h, { type, alpha: false });
    return { put: (img, x, y) => s.ctx.putImageData(img, x, y), encode: (q) => s.toBlob(q), release: () => s.release() };
  },
  nextFrame: () => new Promise<void>((r) => requestAnimationFrame(() => r())),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  writeGuard: writeExportGuard,
  clearGuard: clearExportGuard,
};

export class ExportError extends Error {
  constructor(
    readonly kind: 'aspect' | 'size' | 'knob',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress?(fraction: number): void;
  /** the working bitmap's size: the decode must have its aspect within 1 % */
  working: Size;
  knob?: ExportDebugKnob;
}

const abortError = () => new DOMException('export cancelled', 'AbortError');

export async function runTiledExport(
  renderer: TileRenderer,
  sourceBlob: Blob,
  plan: ExportPlan,
  input: TileInputBase,
  opts: RunOptions,
  deps: RunnerDeps = browserRunnerDeps,
): Promise<File> {
  const decode = plan.decode;
  if (plan.mode !== 'tiled' || !decode) throw new Error('runTiledExport: not a tiled plan');
  const { signal } = opts;
  const knob = opts.knob ?? {};
  if (signal.aborted) throw abortError();
  const type = plan.format === 'png' ? 'image/png' : 'image/jpeg';
  let full: ImageBitmap | null = null;
  let canvas: OutputCanvas | null = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      full?.close();
    } catch {
      // already closed
    }
    full = null;
    canvas?.release();
    canvas = null;
    try {
      renderer.releaseBuffers();
    } catch {
      // a lost context has nothing to release
    }
    deps.clearGuard();
  };
  signal.addEventListener('abort', release, { once: true });
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  deps.writeGuard({ at: Date.now(), w: plan.width, h: plan.height, format: plan.format });
  try {
    const bmp = await deps.decode(sourceBlob, FULL_EXPORT_MAX_EDGE);
    if (signal.aborted) {
      bmp.close();
      throw abortError();
    }
    full = bmp;
    if (knob.failAt === 'decode') throw new ExportError('knob', 'injected decode failure');
    if (Math.abs(bmp.width / bmp.height / (opts.working.width / opts.working.height) - 1) > 0.01) {
      throw new ExportError('aspect', `decoded ${bmp.width}×${bmp.height}, working ${opts.working.width}×${opts.working.height}`);
    }
    if (bmp.width !== decode.width || bmp.height !== decode.height) {
      throw new ExportError('size', `decoded ${bmp.width}×${bmp.height}, planned ${decode.width}×${decode.height}`);
    }
    if (knob.slowMs) {
      await deps.sleep(knob.slowMs);
      check();
    }
    canvas = deps.createCanvas(plan.width, plan.height, type);
    const geometry = snapCrop(input.geometry ?? IDENTITY_GEOMETRY, decode);
    for (let i = 0; i < plan.tiles.length; i++) {
      check();
      if (knob.failAt === 'tile') throw new ExportError('knob', 'injected tile failure');
      const t = plan.tiles[i];
      const tileBmp = await deps.crop(bmp, t.win);
      if (signal.aborted) {
        tileBmp.close();
        throw abortError();
      }
      let img: ImageData;
      try {
        img = renderer.renderTile(
          {
            ...input,
            geometry,
            source: tileBmp,
            width: t.win.w,
            height: t.win.h,
            sourceWindow: { x: t.win.x / decode.width, y: t.win.y / decode.height, w: t.win.w / decode.width, h: t.win.h / decode.height },
            output: {
              tile: { x: t.buf.x / plan.width, y: t.buf.y / plan.height, w: t.buf.w / plan.width, h: t.buf.h / plan.height },
              pixelSize: { width: t.buf.w, height: t.buf.h },
              fullShortEdge: plan.fullShortEdge,
            },
          },
          { x: t.out.x - t.buf.x, y: t.out.y - t.buf.y, w: t.out.w, h: t.out.h },
        );
      } finally {
        tileBmp.close();
      }
      canvas.put(img, t.out.x, t.out.y);
      opts.onProgress?.((i + 1) / plan.tiles.length);
      await deps.nextFrame();
    }
    check();
    // only the canvas and the encoder's copy stay alive while encoding (S §4.4 step 6)
    bmp.close();
    full = null;
    renderer.releaseBuffers();
    if (knob.failAt === 'encode') throw new ExportError('knob', 'injected encode failure');
    const blob = await canvas.encode(plan.format === 'jpeg' ? plan.quality : undefined);
    check();
    canvas.release();
    canvas = null;
    deps.clearGuard();
    return new File([blob], outputFileName(plan.format), { type, lastModified: Date.now() });
  } catch (e) {
    // a caught failure is no crash: memory and breadcrumb go now
    release();
    throw signal.aborted ? abortError() : e;
  } finally {
    signal.removeEventListener('abort', release);
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/media/exportFull.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/media/exportFull.ts src/media/exportFull.test.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: tiled export runner with abort, breadcrumb and test knob

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: The still session — crop view mode, display pause, tile input

**Files:**
- Modify: `src/app/still.ts` (step-1 version: `StillSession` interface `:18-68`, state and render loop `:112-143`, returned object `:231-294`), `src/types.ts:611-636` (`DebugState`), `tests/harness/t7/fakes.ts` (`fakeStill`, `:258-321`)
- Test: `src/app/still.test.ts`

**Interfaces:**
- Consumes: step 1 (S1 §3.4 S1): `StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body'>`, `createStillSession(engine, tracker, bitmap, opts)` with `opts.faces`, `render(frame)`, `exportImageData(frame, body?)`, `prepareExport(frame)`, `exportReady(frame)`; Task 1 (`IDENTITY_GEOMETRY`, `snapCrop`, `viewSize`); Task 3 (`frame.geometry` from `buildFrame`); Task 9 (`faceBoundsFor`, `TileBounds`); Task 10 (`TileInputBase`).
- Produces (`StillSession`): `viewSizeFor(g: Geometry): Size`; `setViewMode(mode: ViewMode): void`; `pauseDisplay(on: boolean): void`; `tileInput(frame: StillFrame, body?: BodyField | null): TileInputBase`; `bounds(frame: StillFrame, body?: BodyField | null): TileBounds`; `type ViewMode = 'crop' | 'normal'`; `sameDisplayFrame(a: StillFrame, b: StillFrame): boolean`. `DebugState.renderCount?: number` (display frames drawn), `DebugState.export?: { mode: 'working' | 'tiled'; width: number; height: number; tiles: number; ms: number } | null`.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/still.test.ts`:

```ts
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft, snapCrop } from '../geometry/view';
// merged into the file's existing imports: `Geometry` joins `import type { …, StillFrame } from '../types'` (still.ts
// does not re-export StillFrame), `sameDisplayFrame` joins `import { createStillSession, … } from './still'`;
// `defaultPhoto` is imported already

describe('crop view mode, display pause and tiles (step 3)', () => {
  const photo = defaultPhoto();
  const frame = (g: Geometry = IDENTITY_GEOMETRY): StillFrame => ({ faces: [], obstacles: [], globalSkin: null, photo: { ...photo, geometry: g }, geometry: g });
  const turned = rotateLeft(IDENTITY_GEOMETRY);
  const square = applyRatio(IDENTITY_GEOMETRY, '1:1', { width: 1536, height: 2048 });

  it('sameDisplayFrame ignores only the geometry', () => {
    expect(sameDisplayFrame(frame(), frame(turned))).toBe(true);
    expect(sameDisplayFrame(frame(), { ...frame(), photo: { ...photo, values: { ...photo.values } } })).toBe(false);
    expect(sameDisplayFrame(frame(), { ...frame(), globalSkin: { smooth: 0.5, rosy: 0, weight: 1 } })).toBe(false);
  });

  it('normal mode draws V through the snapped geometry; the canvas size is the view size', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.render(frame(square));
    vi.advanceTimersByTime(20);
    expect(engine.lastInput()!.geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
    expect(s.viewSizeFor(square)).toEqual({ width: 1536, height: 1536 });
  });

  it('crop mode draws identity geometry; a geometry-only change schedules no frame; exports still apply it', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.setViewMode('crop');
    s.render(frame());
    vi.advanceTimersByTime(20);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.lastInput()!.geometry).toEqual(IDENTITY_GEOMETRY);
    s.render(frame(turned));
    s.render(frame(square));
    vi.advanceTimersByTime(50);
    expect(engine.render).toHaveBeenCalledTimes(1);
    s.exportImageData(frame(square));
    expect(engine.renderToImageData.mock.calls.at(-1)![0].geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
    vi.advanceTimersByTime(20);
    expect(engine.render).toHaveBeenCalledTimes(1); // the autosave's export draws nothing in 裁切 mode
    s.setViewMode('normal');
    vi.advanceTimersByTime(20);
    // leaving 裁切 draws once, in normal mode (V)
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.lastInput()!.geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
  });

  it('pauseDisplay drops every display frame until it is lifted, which draws once', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.pauseDisplay(true);
    s.render(frame());
    s.setCompare(true);
    vi.advanceTimersByTime(50);
    expect(engine.render).not.toHaveBeenCalled();
    expect(engine.renderOriginal).not.toHaveBeenCalled();
    s.pauseDisplay(false);
    vi.advanceTimersByTime(20);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
  });

  it('renderCount counts display frames only', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    const before = window.__meiyan?.renderCount ?? 0;
    s.render(frame());
    vi.advanceTimersByTime(20);
    expect(window.__meiyan!.renderCount).toBe(before + 1);
    s.exportImageData(frame());
    expect(window.__meiyan!.renderCount).toBe(before + 1);
  });

  it('tileInput carries the raw geometry and the working aspect; bounds lists the body field', () => {
    const s = createStillSession(fakeEngine(), null, bitmap(), { faces: [] });
    const body = makeBodyField();
    s.setBody(body);
    const t = s.tileInput(frame(square));
    expect(t.geometry).toBe(square);
    expect(t.oAspect).toBe(1536 / 2048);
    expect('source' in t).toBe(false);
    expect(s.bounds(frame()).body).toBe(body);
    expect(s.bounds(frame(), null).body).toBeNull();
  });
});
```

(`bitmap()`, `fakeEngine`, `makeBodyField` and `stubRaf` are this file's existing helpers. `debugState()` needs a `window` (`src/app/debug.ts:6`): give the `describe` a `beforeEach(() => vi.stubGlobal('window', globalThis));` — the file's `afterEach` already calls `vi.unstubAllGlobals()`.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/app/still.test.ts`
Expected: FAIL — `sameDisplayFrame is not exported`, `s.setViewMode is not a function`.

- [ ] **Step 3: Implement**

`src/types.ts` `DebugState` (CRLF), after `update?`:

```ts
  /** display frames the still session drew (engine FBO exports do not count): e2e checks 裁切 gestures draw none */
  renderCount?: number;
  /** the last export of the editor, or null while one runs / after an abort */
  export?: { mode: 'working' | 'tiled'; width: number; height: number; tiles: number; ms: number } | null;
```

`src/app/still.ts` (LF). Imports: `IDENTITY_GEOMETRY, snapCrop, viewSize` from `../geometry/view`; `faceBoundsFor, type TileBounds` from `../media/exportPlan`; `type TileInputBase` from `../media/exportFull`; `Geometry`, `Size` types. Add to the `StillSession` interface:

```ts
  /** V pixel size of `g` at the working density (the editor frame's aspect) */
  viewSizeFor(g: Geometry): Size;
  /**
   * 'crop' (the 裁切 tab): display frames draw the whole O image (identity geometry; CSS turns the canvas) and a
   * geometry-only change draws nothing. Exports always apply the frame's geometry.
   */
  setViewMode(mode: ViewMode): void;
  /** held during a tiled export: no display frame at all (the last one stays on screen); lifting it draws once */
  pauseDisplay(on: boolean): void;
  /** the tile runner's input: the frame plus the session's body field and the working aspect, geometry unsnapped */
  tileInput(frame: StillFrame, body?: BodyField | null): TileInputBase;
  /** the planner's displacement bounds for this frame */
  bounds(frame: StillFrame, body?: BodyField | null): TileBounds;
```

and the exported helpers:

```ts
export type ViewMode = 'crop' | 'normal';

function shallowSame(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true;
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, i) => shallowSame(v, y[i]));
  if (x && y && typeof x === 'object' && typeof y === 'object' && Object.getPrototypeOf(x) === Object.prototype && Object.getPrototypeOf(y) === Object.prototype) {
    const a = x as Record<string, unknown>;
    const b = y as Record<string, unknown>;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.is(a[k], b[k]));
  }
  return false;
}

/** two frames draw the same crop-mode display (the geometry is the only difference): edits share their unchanged parts */
export function sameDisplayFrame(a: StillFrame, b: StillFrame): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (k === 'geometry') continue;
    if (k === 'photo') {
      const pa = ra.photo as Record<string, unknown>;
      const pb = rb.photo as Record<string, unknown>;
      for (const q of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (q !== 'geometry' && !Object.is(pa[q], pb[q])) return false;
      continue;
    }
    if (!shallowSame(ra[k], rb[k])) return false;
  }
  return true;
}
```

Inside `createStillSession`, next to the existing state (`displayOff`, `compare`, …, `still.ts:112-118`; before `input`):

```ts
  let mode: ViewMode = 'normal';
  let paused = false;
  /** the frame the display last drew (crop mode compares against it) */
  let drawn: StillFrame | null = null;
  const oSize: Size = { width, height };
  const viewGeometry = (f: StillFrame) => (mode === 'crop' ? IDENTITY_GEOMETRY : snapCrop(f.geometry ?? IDENTITY_GEOMETRY, oSize));
```

Changes to the existing functions (step 1's lines at `b975bcc`):
- the render-input builder, step 1's one-liner `const input = (f: StillFrame, b: BodyField | null = body): RenderInput => ({ source: bitmap, width, height, ...f, body: b });` (`still.ts:120`), adds `geometry: snapCrop(f.geometry ?? IDENTITY_GEOMETRY, oSize),` after `...f` (exports and thumbnails: V);
- `schedule()` (`still.ts:122-125`) returns early also when `paused`;
- `flush()` (`still.ts:127-143`) returns early also when `paused`; the compare branch draws `engine.renderOriginal({ source: bitmap, width, height, geometry: viewGeometry(frame) }, { still: true })`; the normal branch draws `engine.render({ ...input(frame), geometry: viewGeometry(frame) }, { still: true })`; after a successful draw: `drawn = frame;` and

```ts
      const d = debugState();
      if (d) d.renderCount = (d.renderCount ?? 0) + 1;
```

- `render(f)` (`still.ts:238-243`): after storing the frame and requesting its LUTs, `if (mode === 'crop' && drawn && !raf && sameDisplayFrame(drawn, f)) return;` before `schedule()`;
- `exportImageData` (`still.ts:268-275`): its closing redraw becomes `if (mode !== 'crop') schedule();` — an FBO export never touches the display canvas, and in 裁切 mode the debounced autosave after a gesture must not draw an engine frame (S §6.3: no engine frame during 裁切 gestures; e2e checks `renderCount`).

Add to the returned object:

```ts
    viewSizeFor(g) {
      return viewSize(snapCrop(g, oSize), oSize);
    },
    setViewMode(m) {
      if (disposed || m === mode) return;
      mode = m;
      schedule();
    },
    pauseDisplay(on) {
      if (disposed || on === paused) return;
      paused = on;
      if (on) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else schedule();
    },
    tileInput(f, b) {
      const all: Partial<RenderInput> = { ...input(f, b === undefined ? body : b) };
      delete all.source;
      delete all.width;
      delete all.height;
      return { ...(all as TileInputBase), geometry: f.geometry ?? IDENTITY_GEOMETRY, oAspect: width / height };
    },
    bounds(f, b) {
      return { body: b === undefined ? body : b, faces: faceBoundsFor(f.faces, width / height) };
    },
```

(`input(f, b)` is step 1's builder taking the frame and the field; the copy drops the three keys the runner sets per tile.)

`tests/harness/t7/fakes.ts` `fakeStill`: add `viewSizeFor: () => ({ width: bitmap.width, height: bitmap.height }), setViewMode() {}, pauseDisplay() {}, tileInput: (f) => ({ ...f, oAspect: bitmap.width / bitmap.height }), bounds: () => ({ body, faces: [] }),`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/app/still.test.ts`
Expected: PASS (step 1's tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/still.ts src/app/still.test.ts src/types.ts tests/harness/t7/fakes.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: still session crop view mode, display pause and tile input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 裁切 strip and 拉直 slider (model, slider scale, BeautyPanel, icons)

**Files:**
- Create: `src/ui/cropPanel.ts`, `src/ui/cropPanel.test.ts`
- Modify: `src/ui/panelModel.ts:8-53, 171-209, 277-315, 556-872` (CRLF: tabs and selection, `personNote` / `photoScoped`, item types, the `itemsFor` / `activate` / `SliderBinding` / `sliderFor` / `tabHasValue` block), `src/ui/components/Slider.tsx:6-31, 41-196` (CRLF), `src/ui/components/BeautyPanel.tsx:5-28, 30-57, 62-219, 256-262` (CRLF), `src/ui/icons.tsx:236-243` (CRLF, `P` after `custom`) (the ratio icons reuse the strip's `.icon` style: no CSS change)
- Test: `src/ui/cropPanel.test.ts`, `src/ui/ui.test.ts` (slider scale), `src/ui/panelModel.test.ts`

**Interfaces:**
- Consumes: Task 1 (`applyRatio`, `isIdentity`, `lockAspect`, `lockFor`, `setStraighten`, `transposeLock`, `CropLock`, `CROP_LOCKS`), Task 3 (`editRotateLeft`, `editFlipView`, `editResetGeometry`, `editSetGeometry`); step 1/2 `panelModel` (`itemsFor(lens, sel, body?)`, `activate(item, lens, sel, ctx?)`, `sliderFor(lens, sel, body?)`, `tabHasValue(lens, tab, body?)` — each an exhaustive `switch` without `default`, so the new tab needs a case in every one; `personNote(tab, lens)` and `photoScoped(sel, lens)`, step 1's photo-level rules (A11: the person strip dims with 「整張照片」); `SliderBinding` with step 1's `param` / `aria?` / `mixed` and step 2's `track?` / `hideDefault?`; `PanelItem.divider?: 'before'` from step 2; `TABS` with 調節).
- Produces (`panelModel.ts`): `TabId += 'crop'`; `EDITOR_TABS = [...TABS, { id: 'crop', label: '裁切' }]` (8 tabs, 裁切 last). `TABS` itself stays the 7 tabs the camera and the editor share: step 2's panelModel test asserts exactly those 7 (C §2.4: the camera has no 裁切); `PanelSelection.crop: CropLock` (initial `'free'`); `ItemVisual += { kind: 'ratio'; aspect: number | null }`; `ItemAction += { type: 'crop'; crop: CropAction }`; `interface SliderScale { min; max; step; snap; suffix }`; `interface SliderView { key; label; aria?; bidirectional; value; mixed?; defaultValue; track?; hideDefault?; scale?: SliderScale }` (every field `SliderRow` reads); `SliderBinding extends SliderView` (keeps `param`, a required `mixed: boolean` and `apply`); `photoScoped` / `personNote` treat 裁切 as photo-level.
- Produces (`cropPanel.ts`): `type CropAction = { type: 'ratio'; lock: CropLock } | { type: 'rotate' } | { type: 'flip' } | { type: 'geoReset' }`; `RATIO_ITEMS`; `cropItems(g, lock, oSize): PanelItem[]`; `interface CropResult { edit: EditState; lock: CropLock; changed: boolean; toast: string | null }`; `cropActivate(edit, a, lock, oSize): CropResult`; `ROTATE_BAND_TOAST = '旋轉後已移除增高'`; `STRAIGHTEN_SCALE: SliderScale`; `straightenView(g): SliderView`; `class StraightenGesture { step(current: Geometry, v: number, oSize: Size, commit: boolean): Geometry; reset(): void }`.
- Produces (`Slider.tsx`): `displayOf(bi, v, scale?)`, `formatDisplay(bi, v, scale?)`, `dragValue(bi, startV, dx, width, scale?)` (no scale = today's exact output); `SliderRow` takes `binding: SliderView | null` and honours `scale`.
- Produces (`BeautyPanel`): prop `crop?: { geometry: Geometry; lock: CropLock; oSize: Size; onAction(a: CropAction): void }` — without it the 裁切 tab is not listed (the camera keeps 7 tabs). Icons `rotateLeft`, `flipH`, `free` (S §3.8 names; the parametric `ratio` icon is BeautyPanel's `RatioIcon`, which draws 自由 with `free`).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/cropPanel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import type { EditState, Geometry } from '../types';
import { cropActivate, cropItems, ROTATE_BAND_TOAST, StraightenGesture, straightenView } from './cropPanel';

const O = { width: 1536, height: 2048 };
const edit = (g: Geometry = IDENTITY_GEOMETRY, band = false): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), geometry: g, heightBand: band ? { top: 0.5, bottom: 0.9, amount: 0.5 } : null },
  persons: { p0: naturalPerson() },
  template: neutralPerson(),
  primaryInit: null,
});

describe('cropItems (S §2.1)', () => {
  it('自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原', () => {
    const items = cropItems(IDENTITY_GEOMETRY, 'free', O);
    expect(items.map((i) => i.label)).toEqual(['自由', '原比例', '1:1', '3:4', '4:3', '9:16', '16:9', '旋轉', '翻轉', '還原']);
    expect(items.filter((i) => i.selected).map((i) => i.label)).toEqual(['自由']);
    expect(items[7].divider).toBe('before');
    expect(items[0].visual).toEqual({ kind: 'ratio', aspect: null });
    expect(items[2].visual).toEqual({ kind: 'ratio', aspect: 1 });
    expect(items[1].visual).toEqual({ kind: 'ratio', aspect: 1536 / 2048 });
  });

  it('還原 is dimmed at identity only', () => {
    expect(cropItems(IDENTITY_GEOMETRY, 'free', O).at(-1)!.disabled).toBe(true);
    expect(cropItems(rotateLeft(IDENTITY_GEOMETRY), 'free', O).at(-1)!.disabled).toBe(false);
  });
});

describe('cropActivate', () => {
  it('a ratio replaces the crop with its centred max-fit and selects the lock; the same aspect changes nothing', () => {
    const r = cropActivate(edit(), { type: 'ratio', lock: '1:1' }, 'free', O);
    expect(r.changed).toBe(true);
    expect(r.lock).toBe('1:1');
    expect(r.edit.photo.geometry).toEqual(applyRatio(IDENTITY_GEOMETRY, '1:1', O));
    const again = cropActivate(r.edit, { type: 'ratio', lock: '1:1' }, '1:1', O);
    expect(again.changed).toBe(false);
    const free = cropActivate(r.edit, { type: 'ratio', lock: 'free' }, '1:1', O);
    expect([free.changed, free.lock]).toEqual([false, 'free']);
  });

  it('旋轉 turns counter-clockwise, transposes the lock and removes the 增高 band with a toast', () => {
    const r = cropActivate(edit(applyRatio(IDENTITY_GEOMETRY, '3:4', O), true), { type: 'rotate' }, '3:4', O);
    expect(r.edit.photo.geometry.quarter).toBe(3);
    expect(r.lock).toBe('4:3');
    expect(r.edit.photo.heightBand).toBeNull();
    expect(r.toast).toBe(ROTATE_BAND_TOAST);
    expect(cropActivate(edit(), { type: 'rotate' }, 'free', O).toast).toBeNull();
  });

  it('翻轉 keeps the band; 還原 resets to identity and 自由, a no-op at identity', () => {
    const f = cropActivate(edit(IDENTITY_GEOMETRY, true), { type: 'flip' }, 'free', O);
    expect(f.edit.photo.geometry.flipH).toBe(true);
    expect(f.edit.photo.heightBand).not.toBeNull();
    const back = cropActivate(f.edit, { type: 'geoReset' }, '1:1', O);
    expect([back.changed, back.lock, back.edit.photo.geometry]).toEqual([true, 'free', IDENTITY_GEOMETRY]);
    expect(cropActivate(edit(), { type: 'geoReset' }, 'free', O).changed).toBe(false);
  });
});

describe('拉直', () => {
  it('the slider shows θ on −45…+45 with 0.1° steps and a ° suffix', () => {
    const v = straightenView({ ...IDENTITY_GEOMETRY, straighten: 9 });
    expect(v.value).toBeCloseTo(0.6, 12);
    expect(v.defaultValue).toBe(0.5);
    expect(v.scale).toEqual({ min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' });
    expect(v.label).toBe('拉直');
  });

  it('every drag step starts from the gesture start; the commit ends the gesture', () => {
    const s = new StraightenGesture();
    const g0 = IDENTITY_GEOMETRY;
    const g1 = s.step(g0, 0.6, O, false);
    expect(g1.straighten).toBe(9);
    const g2 = s.step(g1, 0.5, O, false);
    expect(g2).toBe(g0); // back at the start angle: the start geometry itself
    const g3 = s.step(g2, 0.7, O, true);
    expect(g3.straighten).toBe(18);
    expect(s.step(g3, 0.7, O, false)).toBe(g3); // a new gesture starts from g3
  });

  it('reset forgets the gesture start (leaving 裁切 mid-drag)', () => {
    const s = new StraightenGesture();
    s.step(IDENTITY_GEOMETRY, 0.6, O, false);
    s.reset();
    const other = rotateLeft(IDENTITY_GEOMETRY);
    expect(s.step(other, 0.5, O, true)).toBe(other);
  });
});
```

Add to `src/ui/ui.test.ts`:

```ts
describe('slider scale (拉直)', () => {
  const deg = { min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' };
  it('display and text use the scale; no scale keeps today\'s output', () => {
    expect(formatDisplay(true, (3.5 + 45) / 90, deg)).toBe('+3.5°');
    expect(formatDisplay(true, (-12 + 45) / 90, deg)).toBe('−12.0°');
    expect(formatDisplay(true, 0.5, deg)).toBe('0°');
    expect(formatDisplay(true, 0.62)).toBe('+12');
  });
  it('drags quantize to the step and snap to 0 within ±0.5°', () => {
    expect(dragValue(true, 0.5, 1, 900, deg)).toEqual({ v: 0.5, snapped: true });
    const r = dragValue(true, 0.5, 10, 900, deg);
    expect(r.snapped).toBe(false);
    expect(Math.round((r.v * 90 - 45) * 10) / 10).toBe(1);
    expect(dragValue(false, 0.5, 100, 200)).toEqual({ v: 1, snapped: false });
  });
});
```

Add to `src/ui/panelModel.test.ts` (add `EDITOR_TABS` to its `./panelModel` import; `sel` and `lensOf` are the file's helpers, and `defaultParams`, `personNote`, `photoScoped` are imported already):

```ts
it('裁切 is the 8th editor tab; the shared (camera) tab list keeps 7; its selection starts at 自由', () => {
  expect(EDITOR_TABS.map((t) => t.label).at(-1)).toBe('裁切');
  expect(EDITOR_TABS).toHaveLength(8);
  expect(EDITOR_TABS.slice(0, -1)).toEqual(TABS);
  expect(TABS.some((t) => t.id === 'crop')).toBe(false);
  expect(INITIAL_SELECTION.crop).toBe('free');
});

it('裁切 is photo-level: the person strip dims with 整張照片, no person note (S §2.1, C §2.2)', () => {
  const l = lensOf(defaultParams());
  expect(photoScoped(sel({ tab: 'crop' }), l)).toBe(true);
  expect(personNote('crop', l)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/cropPanel.test.ts src/ui/ui.test.ts src/ui/panelModel.test.ts`
Expected: FAIL — `Failed to resolve import "./cropPanel"`; `EDITOR_TABS` is not exported.

- [ ] **Step 3: Slider scale**

In `src/ui/panelModel.ts` (CRLF) add before `SliderBinding` and make `SliderBinding` extend it:

```ts
/** a slider's display scale (default: 0–100, or −50…+50 with snap ±3) */
export interface SliderScale {
  min: number;
  max: number;
  step: number;
  /** bidirectional: snap to the centre within ± this many display units */
  snap: number;
  suffix: string;
}

/** what the slider row shows; SliderBinding adds how a value writes the edit */
export interface SliderView {
  /** changes when the slider targets a different value (resets drag state) */
  key: string;
  label: string;
  /** aria-label (S §2.4): 「{label}，人物 {n}」 / 「{label}，全部」 / 「{label}，整張照片」; absent → label */
  aria?: string;
  bidirectional: boolean;
  value: number;
  /** the targets disagree under 全部 (the label adds 各人不同) */
  mixed?: boolean;
  /** recommended-default dot / double-tap target */
  defaultValue: number;
  /** 色溫 / 色調: a coloured track (CSS .track-temperature / .track-tint) */
  track?: 'temperature' | 'tint';
  /** no recommended-default dot (調節: neutral is the default) */
  hideDefault?: boolean;
  scale?: SliderScale;
}
```

(`SliderBinding`'s own `key`/`label`/`aria?`/`bidirectional`/`value`/`defaultValue`/`track?`/`hideDefault?` lines (`panelModel.ts:717-736`) move into `SliderView`, because `SliderRow` reads every one of them; `export interface SliderBinding extends SliderView { param: ParamId | null; mixed: boolean; apply(lens: Lens, v: number): EditState }` keeps step 1's `param`, its required `mixed` and `apply`.)

In `src/ui/components/Slider.tsx` (CRLF): import `type SliderScale, type SliderView` (instead of `SliderBinding`, `Slider.tsx:6`); `Props.binding: SliderView | null` (`:42`). Replace `displayOf`, `formatDisplay`, `dragValue` (`:15-31`):

```ts
const decimals = (step: number) => (step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9));

export function displayOf(bidirectional: boolean, v: number, scale?: SliderScale): number {
  if (!scale) return bidirectional ? Math.round(v * 100 - 50) : Math.round(v * 100);
  const raw = scale.min + v * (scale.max - scale.min);
  const n = Number((Math.round(raw / scale.step) * scale.step).toFixed(decimals(scale.step)));
  return n === 0 ? 0 : n;
}

export function formatDisplay(bidirectional: boolean, v: number, scale?: SliderScale): string {
  const n = displayOf(bidirectional, v, scale);
  if (!scale) {
    if (!bidirectional || n === 0) return String(n);
    return n > 0 ? `+${n}` : `−${-n}`;
  }
  const d = decimals(scale.step);
  if (n === 0) return `0${scale.suffix}`;
  if (!bidirectional) return `${n.toFixed(d)}${scale.suffix}`;
  return n > 0 ? `+${n.toFixed(d)}${scale.suffix}` : `−${(-n).toFixed(d)}${scale.suffix}`;
}

/** Drag maths, exported for tests: new value from a horizontal delta, with bidirectional snapping. */
export function dragValue(bidirectional: boolean, startV: number, dxPx: number, widthPx: number, scale?: SliderScale): { v: number; snapped: boolean } {
  let v = clamp01(startV + (widthPx > 0 ? dxPx / widthPx : 0));
  if (!scale) {
    v = Math.round(v * 100) / 100;
    if (bidirectional && Math.abs(displayOf(true, v)) <= SNAP) return { v: 0.5, snapped: true };
    return { v, snapped: false };
  }
  const steps = Math.round((scale.max - scale.min) / scale.step);
  v = Math.round(v * steps) / steps;
  if (bidirectional && Math.abs(displayOf(true, v, scale)) <= scale.snap) return { v: -scale.min / (scale.max - scale.min), snapped: true };
  return { v, snapped: false };
}
```

In `SliderRow` (`Slider.tsx:51-196`): `const sc = binding.scale;` (after `const bi = binding.bidirectional;`, `:80`) and use `dragValue(bi, d.v0, dx, width, sc)` (`:114`), `formatDisplay(bi, v, sc)` (`:154`), `aria-valuemin={sc ? sc.min : bi ? -50 : 0}`, `aria-valuemax={sc ? sc.max : bi ? 50 : 100}`, `aria-valuenow={displayOf(bi, v, sc)}` (`:166-168`). The keyboard handler (`Slider.tsx:175-182`) becomes:

```ts
        onKeyDown={(e) => {
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          // without a scale: today's exact 0.01 arithmetic (editor.spec.ts checks aria-valuenow 98)
          const nv = sc
            ? clamp01(Math.round((binding.value + (dir * sc.step) / (sc.max - sc.min)) * ((sc.max - sc.min) / sc.step)) / ((sc.max - sc.min) / sc.step))
            : clamp01(Math.round((binding.value + dir * 0.01) * 100) / 100);
          onChange(nv);
          onCommit(nv);
        }}
```

- [ ] **Step 4: Panel model and `cropPanel.ts`**

`src/ui/panelModel.ts`: `TabId` (`:8`) gains `| 'crop'`; `TABS` (`:13-21`) is unchanged and, after it,

```ts
/** the photo editor's tabs: the shared 7 plus 裁切 (C §2.1; the camera has none, C §2.4) */
export const EDITOR_TABS: readonly { id: TabId; label: string }[] = [...TABS, { id: 'crop', label: '裁切' }];
```

`PanelSelection` (`:35-43`) gains `/** the 裁切 ratio lock (UI state: derived from the crop on entering the tab and after ↶ ↷, S §2.1) */ crop: CropLock;` and `INITIAL_SELECTION` (`:45-53`) gains `crop: 'free'`; `ItemVisual` (`:277-281`) gains `| { kind: 'ratio'; aspect: number | null }`; `ItemAction` (`:283-295`) gains `| { type: 'crop'; crop: CropAction }` (import `type CropAction` from `./cropPanel` and `type CropLock` from `../geometry/view`). In the step-1 switches over the tab: `itemsFor` (`:558`) → `case 'crop': return [];` (BeautyPanel draws `cropItems`), `sliderFor` (`:767`) → `case 'crop': return null;` (the Editor binds 拉直), `tabHasValue(lens, tab, body?)` (`:857`) → `case 'crop': return false;` (BeautyPanel dots the tab from the geometry); in `activate`'s switch over `item.action.type` (`:663`) → `case 'crop': return done();` (its "nothing changed" result; BeautyPanel never sends crop items there). 裁切 is photo-level (C §2.2, S §2.1 "Person strip: dimmed, with the caption 「整張照片」"), and step 1 keeps that rule in this file: `photoScoped` (`:203-209`) gains `if (sel.tab === 'crop') return true;` next to its 濾鏡 line (the Editor's `scope` dims the strip from it), and `personNote` (`:171-177`) returns null for `tab === 'crop'` as it does for 濾鏡 / 調節.

Create `src/ui/cropPanel.ts` (LF):

```ts
// The 裁切 strip and the 拉直 slider (S §2.1): pure, like panelModel. Ratio taps, 旋轉, 翻轉 and 還原 return a new
// EditState (one undo step each); the highlighted ratio lock is UI state.
import { editFlipView, editResetGeometry, editRotateLeft, editSetGeometry } from '../edit/state';
import { applyRatio, isIdentity, lockAspect, setStraighten, transposeLock, type CropLock } from '../geometry/view';
import type { EditState, Geometry, Size } from '../types';
import type { PanelItem, SliderScale, SliderView } from './panelModel';

export type CropAction = { type: 'ratio'; lock: CropLock } | { type: 'rotate' } | { type: 'flip' } | { type: 'geoReset' };

export const RATIO_ITEMS: readonly { lock: CropLock; label: string }[] = [
  { lock: 'free', label: '自由' },
  { lock: 'original', label: '原比例' },
  { lock: '1:1', label: '1:1' },
  { lock: '3:4', label: '3:4' },
  { lock: '4:3', label: '4:3' },
  { lock: '9:16', label: '9:16' },
  { lock: '16:9', label: '16:9' },
];

export const ROTATE_BAND_TOAST = '旋轉後已移除增高';

const item = (key: string, label: string, visual: PanelItem['visual'], crop: CropAction, extra: Partial<PanelItem> = {}): PanelItem => ({
  key,
  label,
  visual,
  selected: false,
  hasValue: false,
  action: { type: 'crop', crop },
  disabled: false,
  reason: null,
  ...extra,
});

export function cropItems(g: Geometry, lock: CropLock, oSize: Size): PanelItem[] {
  const identity = isIdentity(g);
  return [
    ...RATIO_ITEMS.map((r) =>
      item(`ratio.${r.lock}`, r.label, { kind: 'ratio', aspect: lockAspect(r.lock, g, oSize) }, { type: 'ratio', lock: r.lock }, { selected: lock === r.lock }),
    ),
    item('rotate', '旋轉', { kind: 'icon', icon: 'rotateLeft' }, { type: 'rotate' }, { divider: 'before' }),
    item('flip', '翻轉', { kind: 'icon', icon: 'flipH' }, { type: 'flip' }),
    item('geoReset', '還原', { kind: 'icon', icon: 'reset' }, { type: 'geoReset' }, { disabled: identity }),
  ];
}

export interface CropResult {
  edit: EditState;
  lock: CropLock;
  /** an undo step to record */
  changed: boolean;
  toast: string | null;
}

export function cropActivate(edit: EditState, a: CropAction, lock: CropLock, oSize: Size): CropResult {
  const g = edit.photo.geometry;
  switch (a.type) {
    case 'ratio': {
      if (a.lock === 'free') return { edit, lock: 'free', changed: false, toast: null };
      const next = applyRatio(g, a.lock, oSize);
      return { edit: editSetGeometry(edit, next), lock: a.lock, changed: next !== g, toast: null };
    }
    case 'rotate':
      return { edit: editRotateLeft(edit), lock: transposeLock(lock), changed: true, toast: edit.photo.heightBand ? ROTATE_BAND_TOAST : null };
    case 'flip':
      return { edit: editFlipView(edit), lock, changed: true, toast: null };
    case 'geoReset':
      return isIdentity(g) ? { edit, lock, changed: false, toast: null } : { edit: editResetGeometry(edit), lock: 'free', changed: true, toast: null };
  }
}

export const STRAIGHTEN_SCALE: SliderScale = { min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' };

export function straightenView(g: Geometry): SliderView {
  return { key: 'crop.straighten', label: '拉直', bidirectional: true, value: (g.straighten + 45) / 90, defaultValue: 0.5, scale: STRAIGHTEN_SCALE };
}

/** one 拉直 drag: every step from the geometry at the gesture's start (setStraighten), so returning restores it */
export class StraightenGesture {
  private start: Geometry | null = null;

  step(current: Geometry, v: number, oSize: Size, commit: boolean): Geometry {
    const start = this.start ?? current;
    this.start = commit ? null : start;
    return setStraighten(start, -45 + 90 * v, oSize);
  }

  /** the 裁切 tab closed, or the gesture was abandoned */
  reset(): void {
    this.start = null;
  }
}
```

- [ ] **Step 5: BeautyPanel and icons**

`src/ui/components/BeautyPanel.tsx` (CRLF): import `cropItems, type CropAction` from `../cropPanel`, `isIdentity, type CropLock` from `../../geometry/view`, types `Geometry`, `Size` (joining the `EditState, LookId` type import, `:6`). Props (`interface Props`, `:30-57`; destructured at `:62`) gain:

```ts
  /** the editor's 裁切 tab (absent in the camera: the tab is not listed) */
  crop?: { geometry: Geometry; lock: CropLock; oSize: Size; onAction(a: CropAction): void };
```

Inside the component: `const tabs = crop ? EDITOR_TABS : TABS;` (import `EDITOR_TABS` next to `TABS`; render `tabs.map` instead of `TABS.map`, `:194`); `const items = sel.tab === 'crop' && crop ? cropItems(crop.geometry, crop.lock, crop.oSize) : itemsFor(lens, sel, body);` (`:80`); at the top of `tapItem` (`:93`, before step 1's `activate(item, lens, sel, { lookFailed })`):

```ts
    if (item.action.type === 'crop') {
      if (item.disabled || !crop) return;
      haptic();
      crop.onAction(item.action.crop);
      return;
    }
```

the tab dot for 裁切 (`:210`): `(t.id === 'crop' ? !!crop && !isIdentity(crop.geometry) : tabHasValue(lens, t.id, body))`; `stripKey` for `crop` stays `'crop'`. `ItemVisual` (`:256-262`) gains the ratio case, before its last line (`return <Icon name={v.icon} />;`, which then reads only the icon kind):

```tsx
  if (v.kind === 'ratio') return <RatioIcon aspect={v.aspect} />;
```

with

```tsx
/** a rectangle drawn with the ratio's aspect; 自由 is the dashed-square `free` icon */
function RatioIcon({ aspect }: { aspect: number | null }) {
  if (aspect === null) return <Icon name="free" />;
  const w = aspect >= 1 ? 16 : 16 * aspect;
  const h = aspect >= 1 ? 16 / aspect : 16;
  return (
    <svg class="icon" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={1.75} aria-hidden="true" focusable="false">
      <rect x={12 - w / 2} y={12 - h / 2} width={w} height={h} rx={1.5} />
    </svg>
  );
}
```

`src/ui/icons.tsx` (CRLF), in `P` after `custom`:

```tsx
  rotateLeft: (
    <>
      <path d="M7.2 9.6H4.4V6.8" />
      <path d="M4.6 9.4A8 8 0 1 1 6.3 17" />
      <rect x="9.6" y="10.2" width="6.4" height="6.4" rx="1" />
    </>
  ),
  flipH: (
    <>
      <path d="M12 3.6v16.8" stroke-dasharray="2 2" />
      <path d="M9.4 6.4 4.2 17.6h5.2Z" />
      <path d="M14.6 6.4l5.2 11.2h-5.2Z" />
    </>
  ),
  free: <rect x="5" y="5" width="14" height="14" rx="1.5" stroke-dasharray="3 2.4" />,
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/ui/`
Expected: PASS (existing slider tests in `ui.test.ts` unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/ui/cropPanel.ts src/ui/cropPanel.test.ts src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/components/Slider.tsx src/ui/components/BeautyPanel.tsx src/ui/icons.tsx src/ui/ui.test.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: 裁切 strip, 拉直 slider scale and crop panel model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Crop box overlay, crop-mode CSS and zoomPan reset

**Files:**
- Create: `src/ui/components/CropOverlay.tsx`, `src/ui/components/CropOverlay.test.ts`
- Modify: `src/ui/theme.css:257-267` and the editor block `1627-1642` (CRLF), `src/ui/screens/zoomPan.ts:33-46` (CRLF), `src/ui/components/CanvasHost.tsx:6-20`, `src/ui/components/HeightBandOverlay.tsx:210-247` (CRLF)
- Test: `src/ui/components/CropOverlay.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CropLayout`, `CropLock`, `bandPlane`), Task 2 (`dragCorner`, `dragEdge`, `dragMove`, `Corner`, `Edge`); step 1's `useZoomPan(stage, layer, enabled, opts?: { onTap? })`.
- Produces: `type Handle = { kind: 'corner'; corner: Corner } | { kind: 'edge'; edge: Edge } | { kind: 'move' }`; `interface CropDragHost { geometry: Geometry; lock: CropLock; oSize: Size; eBox: { w: number; h: number }; onChange(g: Geometry, commit: boolean): void }`; `class CropDrag { dragging: boolean; down(handle, id, x, y): void; move(id, x, y): boolean; end(id): boolean; abort(): void }`; `CropOverlay(props: { layout: CropLayout; geometry: Geometry; lock: CropLock; oSize: Size; grid: boolean; onChange(g: Geometry, commit: boolean): void })`; `useZoomPan` option `resetWhen?: boolean`; `CanvasHost` prop `style?: JSX.CSSProperties`; `HeightBandOverlay` prop `yAt?: (clientX: number, clientY: number) => number`; `BandPlane({ geometry, children })`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/CropOverlay.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_GEOMETRY } from '../../geometry/view';
import type { Geometry } from '../../types';
import { CropDrag, type CropDragHost } from './CropOverlay';

const O = { width: 1536, height: 2048 };

function setup(start: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } }) {
  const changes: { g: Geometry; commit: boolean }[] = [];
  const host: CropDragHost = { geometry: start, lock: 'free', oSize: O, eBox: { w: 300, h: 400 }, onChange: (g, commit) => changes.push({ g, commit }) };
  const active = vi.fn();
  const drag = new CropDrag(() => host, active);
  return { drag, changes, active, host };
}

describe('CropDrag (one undo step per gesture)', () => {
  it('a move gesture previews each step and commits its last once on release', () => {
    const { drag, changes, active } = setup();
    drag.down({ kind: 'move' }, 1, 100, 100);
    drag.move(1, 130, 100);
    drag.move(1, 160, 140);
    drag.end(1);
    expect(changes.map((c) => c.commit)).toEqual([false, false, true]);
    expect(changes[2].g).toBe(changes[1].g);
    expect(changes[1].g.crop.x).toBeCloseTo(0.2 + 60 / 300, 9);
    expect(active.mock.calls).toEqual([[true], [false]]);
  });

  it('an unmount mid-drag (abort) commits what is on screen exactly once (Review Focus 3)', () => {
    const { drag, changes } = setup();
    drag.down({ kind: 'corner', corner: 'br' }, 7, 0, 0);
    drag.move(7, -30, -40);
    drag.abort();
    drag.abort();
    expect(changes.filter((c) => c.commit)).toHaveLength(1);
    expect(drag.dragging).toBe(false);
  });

  it('another pointer is ignored; a press without a move commits nothing', () => {
    const { drag, changes } = setup();
    drag.down({ kind: 'edge', edge: 'left' }, 1, 0, 0);
    expect(drag.move(2, 50, 0)).toBe(false);
    drag.down({ kind: 'move' }, 3, 0, 0);
    expect(drag.end(1)).toBe(true);
    expect(changes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/ui/components/CropOverlay.test.ts`
Expected: FAIL — `Failed to resolve import "./CropOverlay"`.

- [ ] **Step 3: Implement `CropOverlay.tsx`**

```tsx
// 裁切 mode box (S §2.1): the scrim (a large box-shadow), a 1 pt border, corner L handles, edge bars (自由 only) and the
// rule-of-thirds grid while a gesture or a 拉直 drag runs. Handles are <button>s with labels (zoomPan ignores buttons,
// zoomPan.ts:96, and is off in this mode anyway); one finger inside the box moves it over the fixed photo (S D2). The
// gesture maths is pure (cropModel.ts); CropDrag commits exactly once per gesture, like BandDrag (HeightBandOverlay.tsx).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dragCorner, dragEdge, dragMove, type Corner, type Edge } from '../../geometry/cropModel';
import type { CropLayout, CropLock } from '../../geometry/view';
import type { Geometry, Size } from '../../types';

export type Handle = { kind: 'corner'; corner: Corner } | { kind: 'edge'; edge: Edge } | { kind: 'move' };

export interface CropDragHost {
  geometry: Geometry;
  lock: CropLock;
  oSize: Size;
  /** the E box on screen: finger px → plane units */
  eBox: { w: number; h: number };
  onChange(g: Geometry, commit: boolean): void;
}

export class CropDrag {
  private g: { id: number; handle: Handle; x0: number; y0: number; start: Geometry; last: Geometry | null } | null = null;

  constructor(
    private readonly host: () => CropDragHost,
    private readonly onActive: (on: boolean) => void,
  ) {}

  get dragging(): boolean {
    return this.g !== null;
  }

  down(handle: Handle, id: number, x: number, y: number): void {
    if (this.g) return;
    this.g = { id, handle, x0: x, y0: y, start: this.host().geometry, last: null };
    this.onActive(true);
  }

  /** false: not this gesture's pointer */
  move(id: number, x: number, y: number): boolean {
    const g = this.g;
    if (!g || g.id !== id) return false;
    const h = this.host();
    const d = [(x - g.x0) / h.eBox.w, (y - g.y0) / h.eBox.h] as const;
    const next =
      g.handle.kind === 'corner'
        ? dragCorner(g.start, g.handle.corner, d, h.lock, h.oSize)
        : g.handle.kind === 'edge'
          ? dragEdge(g.start, g.handle.edge, d, h.oSize)
          : dragMove(g.start, d, h.oSize);
    if (next === (g.last ?? g.start)) return true;
    g.last = next;
    h.onChange(next, false);
    return true;
  }

  end(id: number): boolean {
    if (!this.g || this.g.id !== id) return false;
    this.finish();
    return true;
  }

  /** the overlay unmounts mid-gesture: commit what is on screen */
  abort(): void {
    if (this.g) this.finish();
  }

  private finish(): void {
    const last = this.g?.last ?? null;
    this.g = null;
    this.onActive(false);
    if (last) this.host().onChange(last, true);
  }
}

const CORNERS: readonly { corner: Corner; label: string }[] = [
  { corner: 'tl', label: '左上角' },
  { corner: 'tr', label: '右上角' },
  { corner: 'bl', label: '左下角' },
  { corner: 'br', label: '右下角' },
];
const EDGES: readonly { edge: Edge; label: string }[] = [
  { edge: 'top', label: '上邊' },
  { edge: 'bottom', label: '下邊' },
  { edge: 'left', label: '左邊' },
  { edge: 'right', label: '右邊' },
];

interface Props {
  layout: CropLayout;
  geometry: Geometry;
  lock: CropLock;
  oSize: Size;
  /** a 拉直 drag is running: show the grid */
  grid: boolean;
  onChange(g: Geometry, commit: boolean): void;
}

export function CropOverlay({ layout, geometry, lock, oSize, grid, onChange }: Props) {
  const [active, setActive] = useState(false);
  const host = useRef<CropDragHost>({ geometry, lock, oSize, eBox: layout.eBox, onChange });
  host.current = { geometry, lock, oSize, eBox: layout.eBox, onChange };
  const drag = useMemo(() => new CropDrag(() => host.current, setActive), []);
  useEffect(() => () => drag.abort(), [drag]);

  const down = (handle: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    if (drag.dragging) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.down(handle, e.pointerId, e.clientX, e.clientY);
  };
  const move = (e: PointerEvent) => {
    if (drag.move(e.pointerId, e.clientX, e.clientY)) e.stopPropagation();
  };
  const end = (e: PointerEvent) => {
    if (drag.end(e.pointerId)) e.stopPropagation();
  };
  const follow = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };
  const b = layout.cropBox;
  return (
    <div class="crop-overlay" role="group" aria-label="裁切框">
      <div
        class={`crop-box${active || grid ? ' gesture' : ''}`}
        style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }}
        onPointerDown={down({ kind: 'move' })}
        {...follow}
      >
        {(active || grid) && <div class="crop-grid" aria-hidden="true" />}
        {CORNERS.map((c) => (
          <button key={c.corner} type="button" class={`crop-handle corner ${c.corner}`} aria-label={c.label} onPointerDown={down({ kind: 'corner', corner: c.corner })} {...follow} />
        ))}
        {lock === 'free' &&
          EDGES.map((x) => (
            <button key={x.edge} type="button" class={`crop-handle edge ${x.edge}`} aria-label={x.label} onPointerDown={down({ kind: 'edge', edge: x.edge })} {...follow} />
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CSS, zoomPan reset, CanvasHost style, the band plane**

`src/ui/theme.css` (CRLF), in the Editor block after `.zoom-layer`:

```css
/* 裁切 mode (S §2.1): the frame fills the stage, so a 拉直 corner stays visible under the scrim */
.editor-stage .frame.crop-mode {
  width: 100cqw;
  height: 100cqh;
  transition: none;
}
.crop-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  touch-action: none;
}
.crop-box {
  position: absolute;
  outline: 1px solid #fff;
  box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.55);
}
.crop-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to right, transparent calc(33.333% - 0.25px), rgba(255, 255, 255, 0.5) calc(33.333% - 0.25px), rgba(255, 255, 255, 0.5) calc(33.333% + 0.25px), transparent calc(33.333% + 0.25px), transparent calc(66.667% - 0.25px), rgba(255, 255, 255, 0.5) calc(66.667% - 0.25px), rgba(255, 255, 255, 0.5) calc(66.667% + 0.25px), transparent calc(66.667% + 0.25px)),
    linear-gradient(to bottom, transparent calc(33.333% - 0.25px), rgba(255, 255, 255, 0.5) calc(33.333% - 0.25px), rgba(255, 255, 255, 0.5) calc(33.333% + 0.25px), transparent calc(33.333% + 0.25px), transparent calc(66.667% - 0.25px), rgba(255, 255, 255, 0.5) calc(66.667% - 0.25px), rgba(255, 255, 255, 0.5) calc(66.667% + 0.25px), transparent calc(66.667% + 0.25px));
}
.crop-handle {
  position: absolute;
  width: 44px;
  height: 44px;
  margin: -22px 0 0 -22px;
  padding: 0;
  background: transparent;
}
.crop-handle.corner.tl,
.crop-handle.edge.left,
.crop-handle.corner.bl {
  left: 0;
}
.crop-handle.corner.tr,
.crop-handle.edge.right,
.crop-handle.corner.br {
  left: 100%;
}
.crop-handle.corner.tl,
.crop-handle.edge.top,
.crop-handle.corner.tr {
  top: 0;
}
.crop-handle.corner.bl,
.crop-handle.edge.bottom,
.crop-handle.corner.br {
  top: 100%;
}
.crop-handle.edge.top,
.crop-handle.edge.bottom {
  left: 50%;
}
.crop-handle.edge.left,
.crop-handle.edge.right {
  top: 50%;
}
.crop-handle::before {
  content: '';
  position: absolute;
  left: 22px;
  top: 22px;
  border: 0 solid #fff;
}
.crop-handle.corner::before {
  width: 20px;
  height: 20px;
}
.crop-handle.corner.tl::before {
  margin: -3px 0 0 -3px;
  border-width: 3px 0 0 3px;
}
.crop-handle.corner.tr::before {
  margin: -3px 0 0 -17px;
  border-width: 3px 3px 0 0;
}
.crop-handle.corner.bl::before {
  margin: -17px 0 0 -3px;
  border-width: 0 0 3px 3px;
}
.crop-handle.corner.br::before {
  margin: -17px 0 0 -17px;
  border-width: 0 3px 3px 0;
}
.crop-handle.edge.top::before,
.crop-handle.edge.bottom::before {
  width: 24px;
  height: 3px;
  margin: -1.5px 0 0 -12px;
  background: #fff;
}
.crop-handle.edge.left::before,
.crop-handle.edge.right::before {
  width: 3px;
  height: 24px;
  margin: -12px 0 0 -1.5px;
  background: #fff;
}
/* 增高 lines are E rows: in a straightened or cropped view they live in the E box (BandPlane) */
.hband-clip {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.hband-clip.clipped {
  overflow: hidden;
}
.hband-plane {
  position: absolute;
  transform-origin: 50% 50%;
}
@media (prefers-reduced-motion: reduce) {
  .editor-stage .canvas-host {
    transition: none !important;
  }
}
```

(The `.crop-box` scrim is drawn by its own box-shadow, so the frame's dark corners outside the turned photo are covered as well.)

`src/ui/screens/zoomPan.ts` (CRLF): step 1's `ZoomPanOptions` (`zoomPan.ts:33-39`, holding `onTap`) gains `/** 裁切 open: zoom and pan back to identity */ resetWhen?: boolean;`, and after the main effect of `useZoomPan` (whose `opts` parameter defaults to `{}`):

```ts
  // 裁切 mode shows the whole photo: zoom and pan return to identity when it opens (S §2.1)
  useEffect(() => {
    if (!opts.resetWhen) return;
    view.current = { s: 1, x: 0, y: 0 };
    const layer = layerRef.current;
    if (layer) {
      layer.style.transition = 'none';
      layer.style.transform = '';
      // step 1's face boxes keep 2 px strokes through --zs (zoomPan apply): back to zoom 1 as well
      layer.style.setProperty('--zs', '1');
    }
  }, [opts.resetWhen]);
```

`src/ui/components/CanvasHost.tsx` (LF): `export function CanvasHost({ fit, style }: { fit: 'cover' | 'contain'; style?: JSX.CSSProperties })` (import `type { JSX } from 'preact'`) and `return <div class="canvas-host" ref={ref} style={style} />;`.

`src/ui/components/HeightBandOverlay.tsx` (CRLF): `Props` (`:210-217`, destructured as `{ band, onChange, stretch = defaultStretch }` at `:219`, where `yAt` joins) gains

```ts
  /** E-normalized row under a client point (client → V → E, C §3.5); default: this element's own rect */
  yAt?: (clientX: number, clientY: number) => number;
```

`yOf` (`HeightBandOverlay.tsx:232-235`) becomes

```ts
  const yOf = (clientX: number, clientY: number) => {
    if (yAt) return yAt(clientX, clientY);
    const r = rootRef.current?.getBoundingClientRect();
    return r && r.height > 0 ? (clientY - r.top) / r.height : 0;
  };
```

and its two callers pass `yOf(e.clientX, e.clientY)`. Append:

```tsx
/** the E frame inside the V frame (rotated by θ, cropped): 增高 lines are E rows (S §2.2); identity = the frame itself */
export function BandPlane({ geometry, children }: { geometry: Geometry; children: ComponentChildren }) {
  const p = bandPlane(geometry);
  const plain = p.rotate === 0 && p.left === 0 && p.top === 0 && p.width === 100 && p.height === 100;
  return (
    <div class={`hband-clip${plain ? '' : ' clipped'}`}>
      <div class="hband-plane" style={{ left: `${p.left}%`, top: `${p.top}%`, width: `${p.width}%`, height: `${p.height}%`, transform: p.rotate ? `rotate(${p.rotate}deg)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
```

(imports: `type { ComponentChildren } from 'preact'`, `bandPlane` from `../../geometry/view`, `Geometry` type.) `.hband` keeps `position: absolute; inset: 0`, so it fills the plane; the clip wrapper is inert (`pointer-events: none`; the lines keep their own pointer events as today).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/components/`
Expected: PASS (`HeightBandOverlay.test.tsx` unchanged: no `yAt` means today's mapping).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/CropOverlay.tsx src/ui/components/CropOverlay.test.ts src/ui/theme.css src/ui/screens/zoomPan.ts src/ui/components/CanvasHost.tsx src/ui/components/HeightBandOverlay.tsx
git commit -m "$(cat <<'EOF'
v0.4 step 3: crop box overlay, crop-mode CSS, zoom reset and the band plane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Editor — 裁切 mode, frame aspect and overlays through the view

**Files:**
- Create: `tests/e2e/crop.spec.ts` (first cases)
- Modify: `src/ui/screens/Editor.tsx` (step-1/2 version at `b975bcc`: imports `:20-101`, `lastSel` `:111`, `sel` `:145`, `stageRef` `:198`, `photo` `:227`, `session` `:231`, `update` `:303-321`, the debug `boxes` write `:807-810`, undo/redo `:960-987`, photo taps `:1044-1056`, chips / face boxes `:1074-1097`, `ratio` `:1108`, stage JSX `:1140-1176`, slider row and panel `:1179-1197`), `src/ui/screens/hooks.ts` (+ `useElementSize`), `src/ui/components/PersonStrip.tsx` (LF; a chip-thumbnail transform prop)
- Test: `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: step 1 Editor names (S1 §3.3–3.4 U1–U5): `edit` / `editRef` (the current `EditState`), `update(e: EditState, commit: boolean, user = true)`, `sel` / `setSel`, `session`, `sessionRef`, `sessionFaces`, `photo` (`{width, height}` of the working bitmap, `Editor.tsx:227`), `doUndo` / `doRedo` (each applies the restored state `e` from `undo.undo()` / `undo.redo()`), `useZoomPan(stageRef, layerRef, enabled, { onTap })` whose `onTap(uv: [number, number], rect)` hands `hitPerson(uv, hitCtxOf(…))` a layer UV tuple, `FaceBoxes` (`items`, `dim`, `idle`, `mapY`) / `PersonStrip` (`persons`, `selection`, `photoScope`, `onSelect`) props, the debug `boxes` write (a layout effect), `scope = multi && photoScoped(sel, lens)`. Task 1 (`apply`, `chipTransform`, `cropModeLayout`, `cssTurn`, `eYAt`, `lockFor`, `ovalViewBox`, `vToO`), Task 3 (`editSetGeometry`), Task 11 (`setViewMode`, `viewSizeFor`, `DebugState.renderCount`), Task 12 (`cropActivate`, `straightenView`, `StraightenGesture`, `CropAction`, BeautyPanel `crop`), Task 13 (`CropOverlay`, `BandPlane`, `HeightBandOverlay.yAt`, `CanvasHost.style`, `useZoomPan` `resetWhen`).
- Produces: `useElementSize(ref): Size` (`hooks.ts`); the Editor's 裁切 mode (S §2.1) and normal-mode overlay mapping (S §2.2).

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/crop.spec.ts`:

```ts
// 裁切／旋轉／翻轉 and full-resolution export in the app (S §8.2). Imports go through the file chooser like a user's.
import type { Page } from '@playwright/test';
import { debugState, expect, SAMPLE_FACE, test } from './fixtures';

async function importInto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
}

const frameAspect = (page: Page) =>
  page.locator('.editor-stage .frame').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width / r.height;
  });

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });
/** the slider row's slider (the 增高 band lines are role="slider" too, as in body.spec.ts) */
const rowSlider = (page: Page) => page.locator('.slider-row [role="slider"]');

test('裁切 is the 8th tab: 1:1 crops the frame, ↶ ↷ step it, 還原 restores and is dimmed at identity', async ({ page }) => {
  await importInto(page, SAMPLE_FACE);
  await expect(page.getByRole('tab')).toHaveCount(8);
  await expect(page.getByRole('tab').last()).toHaveText('裁切');
  expect(await frameAspect(page)).toBeCloseTo(1000 / 1500, 2);

  await tab(page, '裁切').click();
  await expect(page.locator('.editor-stage .frame.crop-mode')).toHaveCount(1);
  await expect(page.getByRole('group', { name: '裁切框' })).toBeVisible();
  await expect(option(page, '自由')).toHaveAttribute('aria-selected', 'true');
  await expect(option(page, '還原')).toHaveAttribute('aria-disabled', 'true');
  const slider = page.getByRole('slider', { name: '拉直' });
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await expect(slider).toHaveAttribute('aria-valuetext', '0°');

  await option(page, '1:1').click();
  await expect(option(page, '1:1')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '美膚').click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1, 2);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1000 / 1500, 2);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1, 2);

  await tab(page, '裁切').click();
  await expect(option(page, '1:1')).toHaveAttribute('aria-selected', 'true'); // derived from the crop
  await expect(option(page, '還原')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '還原').click();
  await tab(page, '美膚').click();
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1000 / 1500, 2);
  expect((await debugState(page)).lastError).toBeNull();
});

test('增高 lines stay on their rows after 翻轉 and are removed by 旋轉 with a toast', async ({ page }) => {
  await importInto(page, 'tests/fixtures/fullbody.jpg');
  await tab(page, '美體').click();
  await option(page, '增高').click();
  const top = page.locator('.hband-line.top');
  await expect(top).toBeVisible();
  const y0 = (await top.boundingBox())!.y;
  await rowSlider(page).focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await expect(rowSlider(page)).toHaveAttribute('aria-valuenow', '20');
  await tab(page, '裁切').click();
  await option(page, '翻轉').click();
  await tab(page, '美體').click();
  await option(page, '增高').click();
  await expect.poll(async () => Math.abs((await top.boundingBox())!.y - y0)).toBeLessThan(1.5);
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await expect(page.getByText('旋轉後已移除增高')).toBeVisible();
  await tab(page, '美體').click();
  await option(page, '增高').click();
  await expect(rowSlider(page)).toHaveAttribute('aria-valuenow', '0');
});

test('旋轉 turns the canvas the short way over 240 ms; nothing animates under prefers-reduced-motion', async ({ page }) => {
  await importInto(page, SAMPLE_FACE);
  await tab(page, '裁切').click();
  /** every inline transform / transition the canvas host gets from now on */
  const watch = () =>
    page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.editor-stage .canvas-host')!;
      const w = window as unknown as { __turns: { transform: string; transition: string }[] };
      w.__turns = [];
      new MutationObserver(() => w.__turns.push({ transform: host.style.transform, transition: host.style.transition })).observe(host, {
        attributes: true,
        attributeFilter: ['style'],
      });
    });
  const turns = () => page.evaluate(() => (window as unknown as { __turns: { transform: string; transition: string }[] }).__turns);
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  await watch();
  for (let i = 0; i < 3; i++) await option(page, '旋轉').click();
  await page.waitForTimeout(600);
  const seen = await turns();
  expect(seen.some((s) => s.transition.includes(EASE))).toBe(true);
  // unwrapped toward the previous angle: 0 → −90 → −180 → −270, never a 270° spin back
  expect(seen.at(-1)!.transform).toContain('rotate(-270deg)');
  expect(seen.at(-1)!.transition).not.toContain(EASE); // the 240 ms window has passed
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watch();
  await option(page, '翻轉').click();
  await page.waitForTimeout(600);
  const reduced = await turns();
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced.every((s) => !s.transition.includes(EASE))).toBe(true);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts`
Expected: FAIL — `expected 7 to be 8` (the Editor does not pass `crop` to BeautyPanel yet).

- [ ] **Step 3: `useElementSize`**

Append to `src/ui/screens/hooks.ts` (LF; `useState` is already imported):

```ts
/** the element's CSS size, kept current by a ResizeObserver (the 裁切 layout fits the stage) */
export function useElementSize(ref: { current: HTMLElement | null }): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}
```

- [ ] **Step 4: 裁切 mode in the Editor**

In `src/ui/screens/Editor.tsx` (LF) add the imports (`editSetGeometry` joins the `editKey, P0` import from `../../edit/state`, `BandPlane` the `HeightBandOverlay` import, `useElementSize` the `./hooks` import and `Rect` the `../../types` type import; the rest are new lines):

```ts
import { editSetGeometry } from '../../edit/state';
import { apply, chipTransform, cropModeLayout, cssTurn, eYAt, isIdentity, lockFor, ovalViewBox, vToO } from '../../geometry/view';
import { BandPlane } from '../components/HeightBandOverlay';
import { CropOverlay } from '../components/CropOverlay';
import { cropActivate, StraightenGesture, straightenView, type CropAction } from '../cropPanel';
import { useElementSize } from './hooks';
```

After `const session = …` (`Editor.tsx:231`; the block needs `sel` `:145`, `stageRef` `:198` and `photo` `:227`):

```ts
  // ── 裁切 (S §2.1): the engine draws the whole O image (identity geometry) and CSS turns the canvas ──
  const cropMode = sel.tab === 'crop';
  const g = edit.photo.geometry;
  const [straighten] = useState(() => new StraightenGesture());
  const [straightening, setStraightening] = useState(false);
  /** 240 ms after a 旋轉 / 翻轉 tap: the canvas animates (not during 拉直 drags) */
  const [turning, setTurning] = useState(false);
  const stageSize = useElementSize(stageRef);
  const turnAngle = useRef<number | undefined>(undefined);
  const cropLayout = cropMode && stageSize.width > 0 ? cropModeLayout(stageSize, photo, g, 24, turnAngle.current) : null;
  turnAngle.current = cropLayout ? cropLayout.angle : undefined;
  /** read at the tap (not at render), so a reduced-motion change applies to the very next 旋轉 / 翻轉 */
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
```

Entering and leaving the tab (after the session effect, `Editor.tsx:392-463`):

```ts
  // the session draws identity geometry while 裁切 is open; the ratio lock is derived from the crop on entering
  const wasCrop = useRef(false);
  useEffect(() => {
    if (cropMode !== wasCrop.current) {
      wasCrop.current = cropMode;
      straighten.reset();
      setStraightening(false);
      if (cropMode) {
        const lock = lockFor(editRef.current.photo.geometry, photo);
        if (lock !== sel.crop) setSel({ ...sel, crop: lock });
      }
    }
    try {
      session?.setViewMode(cropMode ? 'crop' : 'normal');
    } catch (e) {
      reportError(e, 'session.setViewMode');
    }
  }, [cropMode, session]);

  const onCropAction = (a: CropAction) => {
    const r = cropActivate(editRef.current, a, sel.crop, photo);
    if (r.lock !== sel.crop) setSel({ ...sel, crop: r.lock });
    if (r.changed) {
      if ((a.type === 'rotate' || a.type === 'flip') && !reduceMotion()) {
        setTurning(true);
        window.setTimeout(() => setTurning(false), 260);
      }
      update(r.edit, true);
    }
    if (r.toast) toast(r.toast);
  };

  /** a 拉直 drag step (commit=false) or its commit: always from the gesture's start geometry */
  const straightenTo = (v: number, commit: boolean) => {
    setStraightening(!commit);
    update(editSetGeometry(editRef.current, straighten.step(editRef.current.photo.geometry, v, photo, commit)), commit);
  };
```

In `doUndo` / `doRedo` (`Editor.tsx:960-987`), inside their `if (e) { … }` after `setEditState(e)`: `if (sel.tab === 'crop') setSel({ ...sel, crop: lockFor(e.photo.geometry, photo) });`.

`useZoomPan` (`Editor.tsx:1046`): step 1's call becomes `useZoomPan(stageRef, layerRef, !!session && !cropMode, { onTap: tapsOn ? … : undefined, resetWhen: cropMode })` (its `onTap` as below).

The frame aspect (`Editor.tsx:1108`) becomes the V aspect:

```ts
  const view = session ? session.viewSizeFor(g) : { width: source.bitmap.width, height: Math.max(1, source.bitmap.height) };
  const ratio = view.width / view.height || 0.75;
```

The stage (`Editor.tsx:1140-1176`) becomes:

```tsx
      <div class="stage editor-stage" ref={stageRef}>
        <div class={`frame${cropMode ? ' crop-mode' : ''}`} style={cropMode ? undefined : { '--r': String(ratio) }}>
          <div class="zoom-layer" ref={layerRef}>
            <CanvasHost
              fit="contain"
              style={
                cropLayout
                  ? {
                      left: `${cropLayout.canvas.x}px`,
                      top: `${cropLayout.canvas.y}px`,
                      right: 'auto',
                      bottom: 'auto',
                      width: `${cropLayout.canvas.w}px`,
                      height: `${cropLayout.canvas.h}px`,
                      transform: cssTurn(cropLayout),
                      transformOrigin: '50% 50%',
                      transition: turning ? 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
                    }
                  : undefined
              }
            />
            {session && !fatal && !hold.held && !cropMode && showsHeightBand(sel, bodyCtx) && (
              <BandPlane geometry={g}>
                <HeightBandOverlay
                  band={bandOrSuggested(edit, bodyCtx)}
                  stretch={heightBandStretch}
                  onChange={/* step 1's handler (bandTouchToast + update(l.setHeightBand(b), commit)), unchanged */}
                  yAt={(cx, cy) => {
                    const r = layerRef.current?.getBoundingClientRect();
                    return r && r.width > 0 ? eYAt(g, photo, [(cx - r.left) / r.width, (cy - r.top) / r.height]) : 0;
                  }}
                />
              </BandPlane>
            )}
            {/* step 1's `{showBoxes && <FaceBoxes … />}` stays where it is (right after CanvasHost): 裁切 is not in
                PERSON_TABS, so its boxItems are already empty there (C §2.2) */}
          </div>
          {cropLayout && session && !fatal && (
            <CropOverlay layout={cropLayout} geometry={g} lock={sel.crop} oSize={photo} grid={straightening} onChange={(ng, commit) => update(editSetGeometry(editRef.current, ng), commit)} />
          )}
          {hold.held && <span class="corner-label">原圖</span>}
          {/* the editor tools (重置, 按住對比) as today */}
        </div>
        {overlay}
      </div>
```

The slider row and the panel (`Editor.tsx:1179-1197`):

```tsx
        <SliderRow
          binding={session && !faceOff ? (cropMode ? straightenView(g) : binding) : null}
          onChange={(v) => (cropMode ? straightenTo(v, false) : binding && slide(binding, v, false))}
          onCommit={(v) => (cropMode ? straightenTo(v, true) : binding && slide(binding, v, true))}
          emptyText={/* step 1's, unchanged (null on 裁切) */}
        />
        <BeautyPanel
          /* step 1's props, unchanged */
          crop={{ geometry: g, lock: sel.crop, oSize: photo, onAction: onCropAction }}
        />
```

Normal-mode overlays through the view (S §2.2), at step 1's call sites:
- **Face boxes** (`boxItems`, `Editor.tsx:1086-1097`) **and the debug `boxes`** (the layout effect at `:807-810`; `edit.photo.geometry` joins its dependencies): every box is V-normalized. With `const viewBoxOf = (pts: Float32Array, box: Rect): Rect => (isIdentity(g) ? box : ovalViewBox(pts, g, photo));` a face's box is `viewBoxOf(oval, f.box)`, `oval` being the session face's adapted O-space FACE_OVAL (`sessionFaces?.find((x) => x.id === f.id)?.face.oval`, or the box's four corners while none is at hand); with identity geometry it is step 1's box (the oval's bbox, T3). A body-only person's dashed `bodyBox(b)` maps its four corners: `viewBoxOf(new Float32Array([x, y, x + w, y, x, y + h, x + w, y + h]), box)`.
- **The boxes' 增高 / 長腿 row shift** (step 1's `mapY`, `Editor.tsx:1084, 1144`): the bands are rows of the field's frame (E rows once Task 15 builds the field in U), so at θ = 0 the shift maps through the crop, `mapY={bands.length && g.straighten === 0 ? (y) => (forwardY(bands, g.crop.y + y * g.crop.h) - g.crop.y) / g.crop.h : undefined}` (exactly step 1's `forwardY(bands, y)` at identity); with θ ≠ 0 the rows tilt and no shift is drawn.
- **Tap → person:** step 1's `onTap: (uv, rect) => …` (`Editor.tsx:1047-1055`) maps the layer UV (V) to O before the hit test: `hitPerson(apply(vToO(g, photo), uv), hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect))` (`uv` is a `[number, number]` tuple).
- **Person chips:** `PersonStrip` (`src/ui/components/PersonStrip.tsx`) gains the prop `thumbTransform?: string`, applied as `style={thumbTransform ? { transform: thumbTransform } : undefined}` on each chip's `<img>`; the Editor passes `thumbTransform={isIdentity(g) ? undefined : chipTransform(g)}` (`Editor.tsx:1180`).
- **Person strip on 裁切:** 裁切 is a photo-level tab (C §2.2): Task 12's `photoScoped` already returns true for it, so step 1's `scope` dims the strip with 「整張照片」 while 裁切 is open (the strip stays mounted: `session && multi`).

- [ ] **Step 5: Run the e2e and the unit suite**

Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts tests/e2e/editor.spec.ts tests/e2e/body.spec.ts`
Expected: all passed (`editor.spec.ts` and `body.spec.ts` unchanged).
Run: `npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Editor.tsx src/ui/screens/hooks.ts src/ui/components/PersonStrip.tsx tests/e2e/crop.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: editor 裁切 mode, V frame aspect and overlays through the view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: The up frame U — face re-scan, body detection and the body field in U

**Files:**
- Create: `src/geometry/upFrame.ts`, `src/geometry/upFrame.test.ts`
- Modify: `src/ui/editorModel.ts` (+ `needsFaceScan`, `needsBodyScan`, `addBodyScan`, the `addFaceScan` re-export; `BodyFieldMemo` `:266-286`), `src/detect/cache.ts` (step 1: `normalizeDetect` `:101-176`, `withFaces` `:291-310`, + `addFaceScan` next to `scanned0` `:184`), `src/edit/migrate.ts` (`AnswerInput` `:101-110`, `firstAnswer`'s scans `:145`), `src/types.ts` (`DetectionCache` `:229-247`: step 1 has no `bodyScans`, add it), `src/ui/screens/Editor.tsx` (measures `:237-240`, memo `:216`, session effect `:392-463`, body detection `:615-660`, field `:663-683`, segmenter `:745`), `tests/e2e/crop.spec.ts`
- Test: `src/geometry/upFrame.test.ts`, `src/ui/editorModel.test.ts`, `src/detect/cache.test.ts`, `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`quarterAffine`, `apply`, `applyVec`, `upQuarter`, `Quarter`), Task 14 (`cropMode`); step 1: `Tracker.detectImage(image, { maxFaces }): Landmarks478[]`, `BodyDetections { bodies: { pose, mask, score }[]; width; height }`, `DetectionCache.faceScans`, the definite-answer routine (S1 §3.3 item 4) — the pure `firstAnswer(a: AnswerInput)` in `src/edit/migrate.ts:144`, which sets `faceScans` to `[{ quarter: 0, flipH: false }]` and which the Editor's session effect calls through `applyAnswer` —, `sessionPlan(cache, hasTracker)` / `detectSession(...)` (the Editor's session effect), `detectBody(ensure, image, opts?)` returning `BodyDetections | null | undefined` and `bodyAnswer(cache, found, size)` (`startBodyDetection`), `measurePersons(cache, faceOf, measure, onError)` with `measureBody(det, pairedFace)`, `bodyPanelContext(...)` / `suggestedBand(det)`, `buildBodyField(input, prev?, longEdge?)` with `BodyFieldInput` (S1 §4.6), `BodyFieldMemo.update(input, draft = false)`; `normalizeDetect(raw)` returns `{ cache, stale, lost }`.
- Produces (`upFrame.ts`): `inverseQuarter(q): Quarter`; `pointsOToU(src: Float32Array, stride: number, q): Float32Array`; `pointsUToO(src, stride, q)`; `landmarksUToO(points: Float32Array, q): Float32Array`; `poseOToU(p: Pose33, q): Pose33`; `poseUToO(p, q): Pose33`; `faceOToU(f: Face, q): Face`; `maskOToU(m: PersonMask, q): PersonMask`; `maskUToO(m, q): PersonMask`; `fieldUToO(f: BodyField, q): BodyField`; `bodiesUToO(d: BodyDetections, q): BodyDetections`; `upCanvas(src, q): HTMLCanvasElement`; `upImage(bitmap: ImageBitmap, q): Promise<{ image: ImageBitmap; close(): void }>`; `upTracker(t: Tracker, q): Tracker`.
- Produces (`editorModel.ts`): `needsFaceScan(s: { cache: { faces: readonly unknown[]; faceScans: readonly { quarter: number; flipH: boolean }[] } | null; geometry: Geometry; mode: 'crop' | 'normal'; hasTracker: boolean }): boolean`; `needsBodyScan(cache: { bodies: readonly unknown[] | null; bodyScans?: readonly number[] } | null, geometry: Geometry): boolean`; `addFaceScan(scans, q)` (defined in `src/detect/cache.ts`, so the pure `firstAnswer` can use it without importing the UI layer; `editorModel.ts` re-exports it); `addBodyScan(scans: readonly Quarter[] | undefined, q): Quarter[]`; `BodyFieldMemo.update(input, draft = false, up: Quarter = 0)` (last parameter, part of the key).
- Produces (`DetectionCache`): `bodyScans?: (0 | 1 | 2 | 3)[]` (absent = `[0]`, S D5), validated by `normalizeDetect`. (`AnswerInput`): `quarter?: Quarter` (the up-frame the face detection ran in; default 0).

- [ ] **Step 1: Write the failing tests**

Create `src/geometry/upFrame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BodyField, PersonMask } from '../types';
import { fieldUToO, inverseQuarter, landmarksUToO, maskOToU, maskUToO, pointsOToU, poseOToU, poseUToO } from './upFrame';
import { apply, quarterAffine, type Quarter } from './view';

const Q: Quarter[] = [0, 1, 2, 3];

describe('U ↔ O permutations (C §3.5, S §3.4)', () => {
  /** float32 storage: a round trip through 1 − x may move a value by one or two float32 ulps */
  const near = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).every((v, i) => Math.abs(v - b[i]) < 1e-6);

  it('points go O → U → O; landmarks keep z exactly', () => {
    const p = new Float32Array([0.1, 0.2, 0.33, 0.7, 0.4, -0.5]);
    for (const q of Q) {
      expect(near(landmarksUToO(pointsOToU(p, 3, q), q), p)).toBe(true);
      const u = pointsOToU(p, 3, q);
      expect(u[2]).toBe(p[2]);
      expect([u[0], u[1]]).toEqual(apply(quarterAffine(q), [p[0], p[1]]).map((v) => Math.fround(v)));
    }
    expect(inverseQuarter(1)).toBe(3);
    expect(landmarksUToO(p, 0)).toBe(p);
  });

  it('poses keep z and visibility', () => {
    const pose = { points: new Float32Array(33 * 4).map((_, i) => (i % 4 === 3 ? 0.9 : (i % 7) / 10)) };
    for (const q of Q) {
      const back = poseUToO(poseOToU(pose, q), q);
      expect(near(back.points, pose.points)).toBe(true);
      for (let i = 3; i < 132; i += 4) expect(back.points[i]).toBe(pose.points[i]);
    }
  });

  it('masks are exact texel permutations with swapped sides for odd quarters', () => {
    const m: PersonMask = { width: 3, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    const u1 = maskOToU(m, 1);
    expect([u1.width, u1.height]).toEqual([2, 3]);
    // R1 (x, y) → (1 − y, x): the O bottom-left texel (value 4) becomes the U top-left
    expect(Array.from(u1.data)).toEqual([4, 1, 5, 2, 6, 3]);
    for (const q of Q) expect(Array.from(maskUToO(maskOToU(m, q), q).data)).toEqual(Array.from(m.data));
  });

  it('a U field becomes the O field of the same backward map: o + D_O(o) = R⁻¹(u + D_U(u))', () => {
    const w = 4;
    const h = 3;
    const data = new Float32Array(w * h * 2);
    for (let i = 0; i < w * h; i++) {
      data[i * 2] = 0.01 * (i + 1);
      data[i * 2 + 1] = -0.02 * (i % 3);
    }
    const fu: BodyField = { width: w, height: h, data, version: 3 };
    for (const q of Q) {
      const fo = fieldUToO(fu, q);
      const toU = quarterAffine(q);
      const toO = quarterAffine(inverseQuarter(q));
      for (let y = 0; y < fo.height; y++)
        for (let x = 0; x < fo.width; x++) {
          const o: [number, number] = [(x + 0.5) / fo.width, (y + 0.5) / fo.height];
          const u = apply(toU, o);
          const ui = Math.round(u[0] * w - 0.5);
          const uj = Math.round(u[1] * h - 0.5);
          const du = [data[(uj * w + ui) * 2], data[(uj * w + ui) * 2 + 1]];
          const want = apply(toO, [u[0] + du[0], u[1] + du[1]]);
          const d = [fo.data[(y * fo.width + x) * 2], fo.data[(y * fo.width + x) * 2 + 1]];
          expect(o[0] + d[0]).toBeCloseTo(want[0], 6);
          expect(o[1] + d[1]).toBeCloseTo(want[1], 6);
        }
    }
  });
});
```

Add to `src/ui/editorModel.test.ts`:

```ts
import { flipView, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import { addBodyScan, addFaceScan, needsBodyScan, needsFaceScan } from './editorModel';

describe('scans in the up frame (S §3.6, D5, D12)', () => {
  const turned = rotateLeft(IDENTITY_GEOMETRY); // upQuarter 3
  const empty = { faces: [], faceScans: [{ quarter: 0 as const, flipH: false }] }; // DetectionCache['faceScans'] quarters
  it('a face scan only in normal mode, with a tracker, an empty face cache and an unscanned up-frame', () => {
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'normal', hasTracker: true })).toBe(true);
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'crop', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: empty, geometry: turned, mode: 'normal', hasTracker: false })).toBe(false);
    expect(needsFaceScan({ cache: empty, geometry: IDENTITY_GEOMETRY, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: { ...empty, faces: [{}] }, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: null, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
  });

  it('a scan counts for both flip states', () => {
    const scanned = { faces: [], faceScans: addFaceScan(empty.faceScans, 3) };
    expect(needsFaceScan({ cache: scanned, geometry: turned, mode: 'normal', hasTracker: true })).toBe(false);
    expect(needsFaceScan({ cache: scanned, geometry: flipView(turned), mode: 'normal', hasTracker: true })).toBe(false);
    expect(addFaceScan(scanned.faceScans, 3)).toEqual(scanned.faceScans);
  });

  it('a body re-scan only when nobody was found and the up-frame is new; absent bodyScans = [0]', () => {
    expect(needsBodyScan({ bodies: [] }, turned)).toBe(true);
    expect(needsBodyScan({ bodies: [] }, IDENTITY_GEOMETRY)).toBe(false);
    expect(needsBodyScan({ bodies: [{}] }, turned)).toBe(false);
    expect(needsBodyScan({ bodies: null }, turned)).toBe(false);
    expect(needsBodyScan({ bodies: [], bodyScans: addBodyScan(undefined, 3) }, turned)).toBe(false);
    expect(addBodyScan(undefined, 3)).toEqual([0, 3]);
  });
});
```

Add to `src/detect/cache.test.ts` (step-1 file):

```ts
it('bodyScans is kept only as distinct quarters 0–3', () => {
  // makeCache() (./testCaches, imported already) = the valid cache the step-1 normalizeDetect tests use;
  // normalizeDetect answers { cache, stale, lost }
  expect(normalizeDetect({ ...makeCache(), bodyScans: [0, 3] }).cache?.bodyScans).toEqual([0, 3]);
  expect(normalizeDetect({ ...makeCache(), bodyScans: [0, 0] }).cache?.bodyScans).toBeUndefined();
  expect(normalizeDetect({ ...makeCache(), bodyScans: [5] }).cache?.bodyScans).toBeUndefined();
  expect(normalizeDetect({ ...makeCache(), bodyScans: 'x' }).cache?.bodyScans).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/geometry/upFrame.test.ts src/ui/editorModel.test.ts src/detect/cache.test.ts`
Expected: FAIL — `Failed to resolve import "./upFrame"`, `needsFaceScan is not exported`.

- [ ] **Step 3: Implement `src/geometry/upFrame.ts`**

```ts
// The up frame U (C §3.5, S §3.4, §3.6): O turned by whole quarters only, so that U-up = E-up and E rows = U rows. Detectors
// that care which way is up (BlazeFace, the pose model, the selfie segmenter) and the body measure run in U; their
// results come back to O by exact permutations. Pure except upCanvas / upImage (DOM).
import type { BodyDetections, BodyField, Face, Landmarks478, PersonMask, Pose33, Tracker } from '../types';
import { apply, applyVec, quarterAffine, type Quarter } from './view';

export function inverseQuarter(q: Quarter): Quarter {
  return ((4 - q) % 4) as Quarter;
}

/** (x, y) pairs every `stride` floats (the rest, e.g. z or visibility, copied) mapped O → U */
export function pointsOToU(src: Float32Array, stride: number, q: Quarter): Float32Array {
  const out = new Float32Array(src);
  if (q === 0) return out;
  const m = quarterAffine(q);
  for (let i = 0; i + 1 < src.length; i += stride) {
    const [x, y] = apply(m, [src[i], src[i + 1]]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export function pointsUToO(src: Float32Array, stride: number, q: Quarter): Float32Array {
  return pointsOToU(src, stride, inverseQuarter(q));
}

/** 478 × (x, y, z) found on the U image → O; z unchanged (the yaw proxy uses isotropic x, y distances) */
export function landmarksUToO(points: Float32Array, q: Quarter): Float32Array {
  return q === 0 ? points : pointsUToO(points, 3, q);
}

export function poseOToU(p: Pose33, q: Quarter): Pose33 {
  return q === 0 ? p : { points: pointsOToU(p.points, 4, q) };
}

export function poseUToO(p: Pose33, q: Quarter): Pose33 {
  return q === 0 ? p : { points: pointsUToO(p.points, 4, q) };
}

/** the face in U, for the body measure's head / neck anchors (S §3.4) */
export function faceOToU(f: Face, q: Quarter): Face {
  if (q === 0) return f;
  return { ...f, pts111: pointsOToU(f.pts111, 2, q), ext: pointsOToU(f.ext, 2, q), oval: pointsOToU(f.oval, 2, q) };
}

/** grid permutation by q quarter turns (row 0 = top); channels interleaved */
function permute<T extends Float32Array | Uint8Array>(data: T, w: number, h: number, ch: number, q: Quarter, make: (n: number) => T): { data: T; width: number; height: number } {
  const W = q % 2 === 1 ? h : w;
  const H = q % 2 === 1 ? w : h;
  const out = make(W * H * ch);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let x: number;
      let y: number;
      if (q === 0) {
        x = i;
        y = j;
      } else if (q === 1) {
        x = j;
        y = h - 1 - i;
      } else if (q === 2) {
        x = w - 1 - i;
        y = h - 1 - j;
      } else {
        x = w - 1 - j;
        y = i;
      }
      const s = (y * w + x) * ch;
      const d = (j * W + i) * ch;
      for (let c = 0; c < ch; c++) out[d + c] = data[s + c];
    }
  }
  return { data: out, width: W, height: H };
}

export function maskOToU(m: PersonMask, q: Quarter): PersonMask {
  if (q === 0) return m;
  const r = permute(m.data, m.width, m.height, 1, q, (n) => new Uint8Array(n));
  return { width: r.width, height: r.height, data: r.data };
}

export function maskUToO(m: PersonMask, q: Quarter): PersonMask {
  return maskOToU(m, inverseQuarter(q));
}

/** a backward field built on a U grid → the O grid: texels permuted, vectors turned by the U → O map's linear part */
export function fieldUToO(f: BodyField, q: Quarter): BodyField {
  if (q === 0) return f;
  const back = inverseQuarter(q);
  const r = permute(f.data, f.width, f.height, 2, back, (n) => new Float32Array(n));
  const m = quarterAffine(back);
  for (let i = 0; i < r.data.length; i += 2) {
    const [dx, dy] = applyVec(m, [r.data[i], r.data[i + 1]]);
    r.data[i] = dx;
    r.data[i + 1] = dy;
  }
  return { width: r.width, height: r.height, data: r.data, version: f.version };
}

/** body detection run on the U image → O (poses and masks; the reported size back to O's) */
export function bodiesUToO(d: BodyDetections, q: Quarter): BodyDetections {
  if (q === 0) return d;
  return {
    ...d,
    bodies: d.bodies.map((b) => ({ ...b, pose: poseUToO(b.pose, q), mask: b.mask ? maskUToO(b.mask, q) : null })),
    width: q % 2 === 1 ? d.height : d.width,
    height: q % 2 === 1 ? d.width : d.height,
  };
}

/** the U image as a canvas: an exact quarter-turn copy (smoothing off, about 12.6 MB at 2048), synchronous */
export function upCanvas(src: CanvasImageSource & { width: number; height: number }, q: Quarter): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const c = document.createElement('canvas');
  c.width = q % 2 === 1 ? h : w;
  c.height = q % 2 === 1 ? w : h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('upCanvas: 2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  if (q === 1) ctx.setTransform(0, 1, -1, 0, h, 0);
  else if (q === 2) ctx.setTransform(-1, 0, 0, -1, w, h);
  else if (q === 3) ctx.setTransform(0, -1, 1, 0, 0, w);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** the U image as an ImageBitmap (the canvas is released at once); q = 0 hands back the bitmap itself */
export async function upImage(bitmap: ImageBitmap, q: Quarter): Promise<{ image: ImageBitmap; close(): void }> {
  if (q === 0) return { image: bitmap, close: () => undefined };
  const c = upCanvas(bitmap, q);
  try {
    const image = await createImageBitmap(c);
    return { image, close: () => image.close() };
  } finally {
    c.width = c.height = 0;
  }
}

/** a Tracker whose IMAGE detection runs on the U image and answers in O (the one-time sideways scan, S §3.6) */
export function upTracker(t: Tracker, q: Quarter): Tracker {
  if (q === 0) return t;
  return {
    get delegate() {
      return t.delegate;
    },
    detectVideo: (video, ts, opts) => t.detectVideo(video, ts, opts),
    detectImage(image, opts) {
      const c = upCanvas(image as CanvasImageSource & { width: number; height: number }, q);
      try {
        return t.detectImage(c, opts).map((lm: Landmarks478) => ({ ...lm, points: landmarksUToO(lm.points, q) }));
      } finally {
        c.width = c.height = 0;
      }
    },
    close: () => t.close(),
  };
}
```

(`pointsOToU` writes into a `Float32Array`, so the round trip compares float32 values: the test's `Math.fround` is that rounding.)

- [ ] **Step 4: Scan rules and the memo key in `editorModel.ts`**

```ts
import { upQuarter, type Quarter } from '../geometry/view';
import type { Geometry } from '../types'; // joins the file's existing `../types` type import

/** the up-frame scan record lives with the cache (src/detect/cache.ts), so firstAnswer can write it too */
export { addFaceScan } from '../detect/cache';

type FaceScan = { quarter: number; flipH: boolean };

/** one face scan in the current up-frame (S §3.6, D12): normal mode, a tracker, no face known, the up-frame unscanned */
export function needsFaceScan(s: {
  cache: { faces: readonly unknown[]; faceScans: readonly FaceScan[] } | null;
  geometry: Geometry;
  mode: 'crop' | 'normal';
  hasTracker: boolean;
}): boolean {
  if (s.mode !== 'normal' || !s.hasTracker || !s.cache || s.cache.faces.length > 0) return false;
  const q = upQuarter(s.geometry);
  return !s.cache.faceScans.some((x) => x.quarter === q);
}

/** nobody was found, and this up-frame was not tried yet (absent bodyScans = [0], S D5) */
export function needsBodyScan(cache: { bodies: readonly unknown[] | null; bodyScans?: readonly number[] } | null, geometry: Geometry): boolean {
  if (!cache || !cache.bodies || cache.bodies.length > 0) return false;
  return !(cache.bodyScans ?? [0]).includes(upQuarter(geometry));
}

export function addBodyScan(scans: readonly Quarter[] | undefined, q: Quarter): Quarter[] {
  const s = scans ? [...scans] : [0 as Quarter];
  return s.includes(q) ? s : [...s, q];
}
```

`BodyFieldMemo.update(input, draft = false)` (step 1, `editorModel.ts:274`) gains the last parameter `up: Quarter = 0`, appended to the key (`` `${bodyInputKey(input)}|${up}` ``), and the builder is called with `prev` only when `up === 0` (an odd U grid has swapped sides); add a test in `editorModel.test.ts`:

```ts
it('BodyFieldMemo rebuilds on a 旋轉 (new up-frame) and not on a 翻轉', () => {
  const build = vi.fn((_i: BodyFieldInput, _p?: BodyField | null, _e?: number) => makeBodyField());
  const memo = new BodyFieldMemo(build);
  // the input shape of this file's existing BodyFieldMemo tests; draft = false, then `up`
  const input: BodyFieldInput = { edited: [{ id: 'f0', measure: {} as BodyMeasure, values: { 'body.slim': 0.6 } as never }], masks: [], heightBand: null, legs: { value: 0, measure: null }, bodyProtect: true, aspect: 0.75 };
  memo.update(input, false, 0);
  memo.update(input, false, upQuarter(flipView(IDENTITY_GEOMETRY)));
  expect(build).toHaveBeenCalledTimes(1);
  memo.update(input, false, upQuarter(rotateLeft(IDENTITY_GEOMETRY)));
  expect(build).toHaveBeenCalledTimes(2);
});
```

(Imports: `upQuarter` joins the `../geometry/view` import of this file's scan tests; `BodyFieldInput`, `BodyMeasure`, `BodyField` and `makeBodyField` are imported already.)

`src/detect/cache.ts`: in `normalizeDetect` (`:101-176`), step 1's raw record is `raw` and the fields both returns spread are `base` (`:130-139`). Keep `bodyScans` only when it is an array of distinct integers 0–3:

```ts
  const bs = raw.bodyScans;
  const bodyScans =
    Array.isArray(bs) && bs.every((x) => x === 0 || x === 1 || x === 2 || x === 3) && new Set(bs).size === bs.length ? ([...bs] as (0 | 1 | 2 | 3)[]) : undefined;
```

and `base` gains `...(bodyScans ? { bodyScans } : {}),`. `withFaces` (`:291-310`) rebuilds a cache without bodies through `buildCache`, which drops unknown fields: carry `bodyScans` over there (`{ ...buildCache(…), ...(cache.bodyScans ? { bodyScans: cache.bodyScans } : {}) }`; its other branch spreads `cache` already). Next to `scanned0` (`:184`) add the pure helper the Editor model and `firstAnswer` share:

```ts
/** a scan counts for both flip states (a mirror does not change detectability), so it is recorded with flipH false */
export function addFaceScan(scans: DetectionCache['faceScans'], q: 0 | 1 | 2 | 3): DetectionCache['faceScans'] {
  return scans.some((x) => x.quarter === q) ? [...scans] : [...scans, { quarter: q, flipH: false }];
}
```

(`editorModel.ts` re-exports it, as in the snippet above, so the scan tests import it from `./editorModel`.) Add `/** quarters the 美體 detection ran in (S D5); absent = [0] */ bodyScans?: (0 | 1 | 2 | 3)[];` to `DetectionCache` in `src/types.ts` (`:229-247`; step 1 has none).

`src/edit/migrate.ts`: `AnswerInput` (`:101-110`) gains `/** the up-frame the face detection ran in (S §3.6); default 0 */ quarter?: 0 | 1 | 2 | 3;`, and `firstAnswer`'s first line (`:145`) becomes `const scans: DetectionCache['faceScans'] = a.prepared ? addFaceScan(a.detect?.faceScans ?? [], a.quarter ?? 0) : [];` (import `addFaceScan` from `../detect/cache`). At quarter 0 this is step 1's `[{ quarter: 0, flipH: false }]` for every cache step 1 can pass here (none, or one with `[]`: `sessionPlan` reuses a scanned-upright cache instead of detecting).

- [ ] **Step 5: Wire U into the Editor**

In `src/ui/screens/Editor.tsx`, import `bodiesUToO, faceOToU, fieldUToO, maskOToU, maskUToO, poseOToU, upImage, upTracker` from `../../geometry/upFrame`, `upQuarter, type Quarter` (joining Task 14's `../../geometry/view` import), `addBodyScan, needsBodyScan, needsFaceScan` (joining the `../editorModel` import; `addFaceScan` is `firstAnswer`'s now) and `type BodyFieldInput` (joining the `../../body/field` import); then:

1. **Face scan on leaving 裁切 / after ↶ ↷** (S §3.6): a ref `scanQuarter = useRef<Quarter>(0)`; an effect on `[cropMode, edit.photo.geometry, detect, session]`:

```ts
  useEffect(() => {
    if (!bundle || !needsFaceScan({ cache: detectRef.current, geometry: editRef.current.photo.geometry, mode: cropMode ? 'crop' : 'normal', hasTracker: !!bundle.tracker })) return;
    scanQuarter.current = upQuarter(editRef.current.photo.geometry);
    forceDetect.current = true;
    setScanning(true);
    setDetectGen((n) => n + 1);
  }, [cropMode, edit.photo.geometry, detect, session]);
```

In the session effect (`Editor.tsx:392-463`; it re-runs on `[currentEngine, detectGen]`), when `forceDetect.current` is set: the plan is `{ useCache: false, asks: !!tracker }` instead of step 1's `sessionPlan(cache, !!tracker)` (whose `useCache` is true for a scanned-upright cache, so it would not detect), and `deps.createStillSession` gets `upTracker(tracker, scanQuarter.current)` as its tracker (and so no cached `faces` / `obstacles`, as `useCache` is false); the `firstAnswer({ … })` that step 1 hands to `applyAnswer` gains `quarter: scanQuarter.current` (it is 0 for the first detection, so step 1's `{quarter: 0, flipH: false}` is unchanged); then clear `forceDetect`. The overlay chain (`Editor.tsx:1110-1125`) shows `<Status spinner title="正在重新偵測臉部…" />` while `scanning`, before its `!session` case; `setScanning(false)` once the session is bound (`setBound`). New persons enter through step 1's `rebase` (`applyAnswer` → `rebaseOnDetect`), so ↶ of the rotation keeps them (C §7). (`detectRef` = step 1's ref to the current `DetectionCache | null`; `forceDetect` = `useRef(false)`; `scanning` = `useState(false)`; `bundle.tracker` is the tracker step 1's effect reads.)

2. **Body detection in U** (`startBodyDetection`, `Editor.tsx:615-652`): step 1 calls `detectBody(() => ensureBodyTracker(), source.bitmap, { pause, cancelled })` and answers with `bodyAnswer(cache, dets?.bodies ?? [], photo)`. Make the image the U image: `const q = upQuarter(editRef.current.photo.geometry);`, `upImage(source.bitmap, q)` awaited before `detectBody` and its `image` passed in place of `source.bitmap`, `close()` once `detectBody` settles (either way); the answer reads `bodyAnswer(cache, dets ? bodiesUToO(dets, q).bodies : [], photo)` and step 1's `rebaseOnDetect(a.rebase, a.detect)` gets `{ ...a.detect, bodyScans: addBodyScan(cache.bodyScans, q) }`. The trigger effect (`Editor.tsx:654-660`) also starts a detection when the 美體 tab is `entered` and `needsBodyScan(detectRef.current, editRef.current.photo.geometry)` (step 1's `shouldDetectBody` answers false once the phase is `done`), never while `bodyDet.phase === 'working'`.

3. **Selfie segmenter in U** (`Editor.tsx:745`, the `FaceProtectSource` deps): the deps' `segmenter` becomes

```ts
          segmenter: () =>
            ensureFaceSegmenter().then(async (sg) => {
              if (!sg) return null;
              const q = upQuarter(editRef.current.photo.geometry);
              const up = await upImage(source.bitmap, q);
              return {
                segment: () => {
                  try {
                    const m = sg.segment(up.image);
                    return m ? maskUToO(m, q) : null;
                  } finally {
                    up.close();
                  }
                },
              };
            }),
```

4. **Measure and field in U** (S §3.4): with `const up = upQuarter(edit.photo.geometry);` and `const detU = (det: BodyDetection): BodyDetection => (up === 0 ? det : { ...det, pose: poseOToU(det.pose, up), mask: det.mask && maskOToU(det.mask, up), width: up % 2 ? det.height : det.width, height: up % 2 ? det.width : det.height });`, step 1's `measurePersons(detect, faceOf, measureBody, onError)` memo (`Editor.tsx:237-240`) passes the measure `(det, face) => measureBody(detU(det), face && faceOToU(face, up))` and lists `up` in its dependencies, and the 美體 note's detection (`bodyDetectionOf(detect, ownerBody)` handed to `bodyPanelContext`, `Editor.tsx:1031`) goes through `detU` as well, so a new 增高 band is suggested on the legs' E rows (`BodyDetection` joins the `../../types` type import); the field builder handed to `BodyFieldMemo` is wrapped:

```ts
  const buildInU = (input: BodyFieldInput, prev?: BodyField | null, edge?: number) => {
    const q = upQuarter(editRef.current.photo.geometry);
    const inputU: BodyFieldInput = q === 0 ? input : { ...input, aspect: q % 2 ? 1 / input.aspect : input.aspect, masks: input.masks.map((m) => ({ ...m, mask: maskOToU(m.mask, q) })) };
    const f = buildBodyField(inputU, q === 0 ? prev : null, edge);
    return f && fieldUToO(f, q);
  };
```

and the memo (`Editor.tsx:216`, `useState(() => new BodyFieldMemo(buildBodyField))`) is built as `new BodyFieldMemo((input, prev, edge) => buildInU(input, prev, edge))`: the arrow reads `buildInU` only when the memo builds, so `buildInU` may be declared further down the component (a direct reference in the `useState` initializer would hit its temporal dead zone on the first render). The one `fieldMemo.update(…)` call, step 1's `applyField` (`fieldMemo.update(fieldInputOf(…), draft)`, `Editor.tsx:666`), passes `upQuarter(editRef.current.photo.geometry)` as its new last argument. `heightBand` stays as stored: E rows = U rows.

- [ ] **Step 6: A sideways photo is scanned once, after 裁切**

Add to `tests/e2e/crop.spec.ts` (import `PNG` from `pngjs` and `readFileSync` from `node:fs`):

```ts
/** sample_face.png turned 90° clockwise (a sideways photo) */
function sidewaysFace(): Buffer {
  const src = PNG.sync.read(readFileSync(SAMPLE_FACE));
  const out = new PNG({ width: src.height, height: src.width });
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = (x * out.width + (out.width - 1 - y)) * 4;
      src.data.copy(out.data, d, s, s + 4);
    }
  return PNG.sync.write(out);
}

test('a sideways photo: 旋轉 and 翻轉 run no detector; leaving 裁切 scans the new up-frame once', async ({ page }) => {
  await importInto(page, { name: 'sideways.png', mimeType: 'image/png', buffer: sidewaysFace() });
  const before = await debugState(page);
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await option(page, '翻轉').click();
  await option(page, '翻轉').click();
  expect((await debugState(page)).detectCalls).toBe(before.detectCalls);
  await tab(page, '美膚').click();
  if (before.faces === 0) {
    await expect.poll(async () => (await debugState(page)).detectCalls).toBe(before.detectCalls + 1);
    await expect.poll(async () => (await debugState(page)).faces).toBe(1);
  } else {
    await page.waitForTimeout(1500);
    expect((await debugState(page)).detectCalls).toBe(before.detectCalls);
  }
});
```

- [ ] **Step 7: Run everything touched**

Run: `npx vitest run src/geometry/ src/ui/editorModel.test.ts src/detect/ src/edit/migrate.test.ts`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts tests/e2e/body.spec.ts tests/e2e/faceProtect.spec.ts`
Expected: all passed (identity geometry: `upQuarter` 0 everywhere, so body and 瘦臉-limit paths are today's).

- [ ] **Step 8: Commit**

```bash
git add src/geometry/upFrame.ts src/geometry/upFrame.test.ts src/ui/editorModel.ts src/ui/editorModel.test.ts src/detect/ src/edit/migrate.ts src/types.ts src/ui/screens/Editor.tsx tests/e2e/crop.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: detection and body field in the up frame U (one sideways re-scan)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Source plumbing — keep the picked file, carry it on reopen

**Files:**
- Modify: `src/ui/state.ts:32-54` (`EditorSource`, CRLF), `src/ui/flows.ts:21-40` (`openInEditor`, CRLF), `src/ui/screens/Home.tsx:82` (CRLF; the import only: `openEntry` `:85-101` already hands `openInEditor` the entry), `src/ui/deps.ts` (CRLF), `src/ui/screens/Editor.tsx` (next to `photo` `:227`; `writeHistory` `:512-532`), `tests/e2e/fixtures.ts` (helpers)
- Test: `src/ui/flows.test.ts`, `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`importPhotoInfo`), Task 6 (`HistoryEntry.source/sourceWidth/sourceHeight`), Task 9 (`SourceInfo`, `NO_SOURCE`, `shouldKeepSource`, `sourceSizeRecord`); step 1's `openInEditor(blob, { entry?: HistoryEntry | null; returnTo })` (a reopen passes the entry and `openState` runs inside it) and the `addEntry` call in `writeHistory`.
- Produces: `EditorSource.source?: SourceInfo` (absent = none: camera shots through `freshSource`, `Review.tsx` unchanged), `EditorSource.picked?: File` (a new import's file, kept only if `shouldKeepSource` accepts it); `openInEditor(blob, { entry?, returnTo, picked?: boolean })`, which derives `source` from the entry on a reopen; in the Editor: `sourceRef: { current: SourceInfo }` (what an export reads, resolved once the keep decision settles), `keepSource: Promise<boolean>`; `deps.shouldKeepSource`; e2e helpers `makeJpeg(page, w, h): Promise<Buffer>`, `withExifOrientation(jpeg: Buffer, orientation: number): Buffer`, `exportFile(page): Promise<{ width; height; type; name }>`, `closeFallback(page)`, `readHistory(page): Promise<{ sourceSize: number; sourceWidth?: number; sourceHeight?: number }[]>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/flows.test.ts`:

```ts
describe('openInEditor source (step 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a picked file is decoded with its oriented size and handed over for the keep decision', async () => {
    const { flows, app } = await load('auto', 'H');
    const { deps } = await import('./deps');
    const info = vi.fn(async () => ({ bitmap: { width: 1536, height: 2048, close: vi.fn() } as unknown as ImageBitmap, oriented: { width: 3000, height: 4000 } }));
    deps.importPhotoInfo = info as unknown as typeof deps.importPhotoInfo;
    const file = new File([new Uint8Array(8)], 'p.jpg', { type: 'image/jpeg' });
    await flows.openInEditor(file, { returnTo: 'home', picked: true });
    expect(info).toHaveBeenCalledWith(file, 2048);
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect(screen.source.picked).toBe(file);
    expect(screen.source.source).toEqual({ blob: null, width: 3000, height: 4000 });
  });

  it('a reopened entry carries its stored source through', async () => {
    const { flows, app } = await load('auto', 'H');
    const blob = new Blob(['s']);
    // step 1's reopen: openInEditor gets the entry itself (Home.tsx openEntry) and runs openState inside
    const entry: HistoryEntry = {
      id: 'e3', createdAt: 1, updatedAt: 1, original: new Blob([]), thumb: new Blob([]), params: defaultParams(), width: 4, height: 3,
      source: blob, sourceWidth: 4032, sourceHeight: 3024,
    };
    await flows.openInEditor(new Blob([]), { entry, returnTo: 'home' });
    const screen = app.get().screen;
    if (screen.name !== 'editor') throw new Error('not the editor');
    expect(screen.source.source).toEqual({ blob, width: 4032, height: 3024 });
    expect(screen.source.picked).toBeUndefined();
  });
});
```

(`HistoryEntry` and `defaultParams` are imported in the file already.)

Add to `tests/e2e/fixtures.ts`:

```ts
/** A synthetic JPEG made in the page (canvas toBlob, S §8.3): a gradient, sample_face.png centred, a red block at the stored top-left. */
export async function makeJpeg(page: Page, width: number, height: number): Promise<Buffer> {
  const face = readFileSync(SAMPLE_FACE).toString('base64');
  const b64 = await page.evaluate(
    async ([w, h, faceB64]) => {
      const bytes = Uint8Array.from(atob(faceB64), (c) => c.charCodeAt(0));
      const faceBmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d8b49a');
      g.addColorStop(1, '#4a6680');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w / faceBmp.width, h / faceBmp.height) * 0.8;
      ctx.drawImage(faceBmp, (w - faceBmp.width * s) / 2, (h - faceBmp.height * s) / 2, faceBmp.width * s, faceBmp.height * s);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, Math.round(w * 0.08), Math.round(h * 0.08));
      const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    [width, height, face] as const,
  );
  return Buffer.from(b64, 'base64');
}

/** Splice an EXIF APP1 with only an Orientation tag after the JFIF APP0 (or the SOI). */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II*\0", IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // 0x0112 Orientation, SHORT, count 1
    orientation, 0x00, 0x00, 0x00, // the value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const len = body.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), body]);
  const at = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, at), app1, jpeg.subarray(at)]);
}

/** 儲存 → (a second tap when the pill turned 分享) → the long-press fallback's image: size, blob type and file name. */
export async function exportFile(page: Page): Promise<{ width: number; height: number; type: string; name: string | null }> {
  const pill = page.locator('.topbar .pill');
  await pill.click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  const shareAgain = page.locator('.topbar .pill', { hasText: '分享' });
  await expect(fallback.or(shareAgain)).toBeVisible({ timeout: 300_000 });
  if (!(await fallback.isVisible())) await shareAgain.click();
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  return img.evaluate(async (i: HTMLImageElement) => ({
    width: i.naturalWidth,
    height: i.naturalHeight,
    type: (await (await fetch(i.src)).blob()).type,
    name: i.dataset.name ?? null,
  }));
}

export async function closeFallback(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: '儲存照片' }).getByRole('button', { name: '關閉' }).click();
}

/** the raw 最近編輯 records (IndexedDB meiyan / edits): what the source fields hold */
export async function readHistory(page: Page): Promise<{ sourceSize: number; sourceWidth?: number; sourceHeight?: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('meiyan', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('edits', 'readonly').objectStore('edits').getAll();
          req.onsuccess = () => {
            resolve(
              (req.result as { source?: Blob; sourceWidth?: number; sourceHeight?: number }[]).map((r) => ({
                sourceSize: r.source?.size ?? 0,
                sourceWidth: r.sourceWidth,
                sourceHeight: r.sourceHeight,
              })),
            );
            open.result.close();
          };
        };
      }),
  );
}
```

(`readFileSync` from `node:fs` joins the imports.) Add to `tests/e2e/crop.spec.ts` (add `makeJpeg` and `readHistory` to its `./fixtures` import):

```ts
test('a larger picked photo is kept in 最近編輯 with its size; a reopen still has it', async ({ page }) => {
  await page.goto('/');
  const jpeg = await makeJpeg(page, 3000, 4000);
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const rows = await readHistory(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].sourceSize).toBe(jpeg.length);
  expect([rows[0].sourceWidth, rows[0].sourceHeight]).toEqual([3000, 4000]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/flows.test.ts`
Expected: FAIL — `info` not called (`openInEditor` ignores `picked`).

- [ ] **Step 3: Implement**

`src/ui/state.ts` (CRLF), `EditorSource` gains:

```ts
  /** the source to export at full resolution (S §3.7): the entry's kept file on reopen; for a new import blob stays null
   * until the Editor's keep decision; absent = none (camera shots) */
  source?: SourceInfo;
  /** a new import's picked file: kept as HistoryEntry.source only when shouldKeepSource accepts it */
  picked?: File;
```

(`import type { SourceInfo } from '../media/exportPlan';`.)

`src/ui/flows.ts` (CRLF): `openInEditor`'s options (`flows.ts:22`, step 1's `{ entry?: HistoryEntry | null; returnTo }`) gain `picked?: boolean;` and the decode (`flows.ts:25`) becomes

```ts
    let bitmap: ImageBitmap;
    let oriented: { width: number; height: number } | null = null;
    if (opts.picked) {
      const info = await deps.importPhotoInfo(blob, maxImportEdge());
      bitmap = info.bitmap;
      oriented = info.oriented;
    } else bitmap = await deps.importPhoto(blob, maxImportEdge());
```

and after building `source` (both branches, before `go(…)`): `if (entry) source.source = { blob: entry.source ?? null, width: entry.sourceWidth ?? null, height: entry.sourceHeight ?? null }; else if (opts.picked && oriented) { source.picked = blob as File; source.source = { blob: null, width: oriented.width, height: oriented.height }; }` (`import type { SourceInfo }` is not needed here: the fields are typed by `EditorSource`).

`src/ui/screens/Home.tsx` (CRLF): the import (`Home.tsx:82`) becomes `pickPhoto((f) => void openInEditor(f, { returnTo: 'home', picked: true }));`. `openEntry` (`Home.tsx:85-101`) is unchanged: it already passes `{ entry, returnTo: 'home' }`, and `openInEditor` reads the source from the entry.

`src/ui/deps.ts`: import `shouldKeepSource` from `../media/exportPlan` and add it to `deps`.

`src/ui/screens/Editor.tsx`: import `NO_SOURCE, sourceSizeRecord, type SourceInfo` from `../../media/exportPlan` (Task 17 extends this import); next to `photo` (`Editor.tsx:227`):

```ts
  // ── the full-resolution source (S §3.7): decided once per import, before the add that creates the entry ──
  const workingLong = Math.max(photo.width, photo.height);
  const probed = source.source?.width && source.source.height ? { width: source.source.width, height: source.source.height } : null;
  const [keepSource] = useState<Promise<boolean>>(() =>
    source.picked ? deps.shouldKeepSource(source.picked, probed, workingLong).catch(() => false) : Promise.resolve(false),
  );
  /** what an export reads (the first session exports like every later reopen: only a kept file counts) */
  const sourceRef = useRef<SourceInfo>(source.picked ? { blob: null, width: probed?.width ?? null, height: probed?.height ?? null } : (source.source ?? NO_SOURCE));
  useEffect(() => {
    if (!source.picked) return;
    void keepSource.then((keep) => {
      if (keep && source.picked) sourceRef.current = { blob: source.picked, width: probed?.width ?? null, height: probed?.height ?? null };
    });
  }, []);
```

In `writeHistory`, the `deps.addEntry({...})` that creates the entry (`Editor.tsx:522-529`) gains:

```ts
      ...((await keepSource) && source.picked ? { source: source.picked } : {}),
      ...(sourceSizeRecord(probed, workingLong) ?? {}),
```

(`addEntry` retries without the file on a quota error; this session keeps `sourceRef` and exports from the in-memory file, S §3.7.)

In the same function, the `original` fallback `deps.toJpegBlob(img, ORIGINAL_EDGE, 0.9)` (`Editor.tsx:519`; the setup normally made `originalBlob` from `source.bitmap` already, `:408`) becomes `deps.toJpegBlob(source.bitmap, ORIGINAL_EDGE, 0.9)`: `img` is now the V image (cropped, turned), and `original` must stay the uncropped O working copy so 還原 works after a reopen (S §5). `width` / `height` stay the session's working size (`still.ts` keeps `session.width/height` = O).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/flows.test.ts`
Expected: PASS (existing cases unchanged: they pass no `picked`).
Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts tests/e2e/home.spec.ts tests/e2e/editor.spec.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/ui/state.ts src/ui/flows.ts src/ui/flows.test.ts src/ui/screens/Home.tsx src/ui/deps.ts src/ui/screens/Editor.tsx tests/e2e/fixtures.ts tests/e2e/crop.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: keep a larger picked original in history and carry it on reopen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Editor export flow — plan-based 儲存, tiled overlay, two-tap share, fallback, background abort

**Files:**
- Create: `src/ui/exportFlow.ts`, `src/ui/exportFlow.test.ts`
- Modify: `src/ui/screens/Editor.tsx` (state `:184-188`, `update` `:303-321`, visibility `:578-585`, unmount cleanup `:587-610`, `encode` `:814-820`, debounce effect `:827-881`, `share` / `save` `:890-947`, `close` `:1014-1017`, overlay `:1110-1125`, topbar `:1128-1138`, tools and panel `:1157-1197`), `src/ui/deps.ts` (CRLF, `runTiledExport`)
- Test: `src/ui/exportFlow.test.ts`, `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`EXPORT_COPY`, `ExportEnv`, `readExportDebug`, `exportCapped`), Task 5 (`encodeOutput`), Task 9 (`planExport`, `ExportPlan`, `SourceInfo`, `NO_SOURCE`), Task 10 (`runTiledExport`), Task 11 (`pauseDisplay`, `tileInput`, `bounds`, `DebugState.export`), Task 16 (`sourceRef`); `stampIs` (`editorModel.ts:344`); step 1's `editKey`, `frameOf(e, s)` (`Editor.tsx:256-259`: the frame session `s` renders and exports for edit `e`; step 1 keeps no frame ref, and an export builds its frame from the edit captured at the tap, so the replacement session of `exportOnLatest` gets its own faces), `exportOnLatest` (`editorModel.ts:92`), `settleField` / `snapshotField` / `fieldGen` / `sessionEngine` / `share`, the existing `encode(s, e, field)` and the `useStore` / `toast` / `debug` imports.
- Produces (`exportFlow.ts`): `type Pill = 'save' | 'preparing' | 'share'`; `pillLabel(p): string`; `planSig(p: Pick<ExportPlan, 'mode' | 'format' | 'quality' | 'width' | 'height'>): string`; `interface ShareCache { key: string; field: number; sig: string; file: File }`; `shareReady(c, key, field, sig): boolean`; `preEncodes(p: Pick<ExportPlan, 'mode' | 'format'>): boolean`; `shareNow(startedAt: number, now: number): boolean`; `tapAction(pill: Pill, hasPending: boolean): 'ignore' | 'sharePending' | 'export'`; `exportOutcome(e: unknown): 'abort' | 'fallback'`; `noSourceNote(plan, source, working): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/exportFlow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ExportPlan } from '../media/exportPlan';
import { exportOutcome, noSourceNote, pillLabel, planSig, preEncodes, shareNow, shareReady, tapAction } from './exportFlow';

const plan = (over: Partial<ExportPlan> = {}): ExportPlan => ({
  mode: 'working',
  format: 'jpeg',
  quality: 0.95,
  width: 1536,
  height: 2048,
  decode: null,
  fullShortEdge: 1536,
  tile: 0,
  tiles: [],
  fallback: 'notLarger',
  ...over,
});
const file = new File(['x'], 'meiyan-20261012-000000.jpg', { type: 'image/jpeg' });

describe('export flow rules (S §2.3)', () => {
  it('the share cache matches the edit, the field and the output settings (Review Focus 1)', () => {
    const sig = planSig(plan());
    const cache = { key: 'k', field: 3, sig, file };
    expect(shareReady(cache, 'k', 3, sig)).toBe(true);
    expect(shareReady(cache, 'k', 3, planSig(plan({ format: 'png', quality: 1 })))).toBe(false);
    expect(shareReady(cache, 'k', 3, planSig(plan({ mode: 'tiled', width: 3000, height: 4000 })))).toBe(false);
    expect(shareReady(cache, 'k2', 3, sig)).toBe(false);
    expect(shareReady(null, 'k', 3, sig)).toBe(false);
  });

  it('only a working-size JPEG is pre-encoded', () => {
    expect(preEncodes(plan())).toBe(true);
    expect(preEncodes(plan({ format: 'png' }))).toBe(false);
    expect(preEncodes(plan({ mode: 'tiled' }))).toBe(false);
  });

  it('shares at once within 4 s of the tap, else asks for a second tap', () => {
    expect(shareNow(1000, 5000)).toBe(true);
    expect(shareNow(1000, 5001)).toBe(false);
  });

  it('the 分享 tap shares the finished file whatever made it (a fallback included), never a new export (Review Focus 5)', () => {
    expect(tapAction('share', true)).toBe('sharePending');
    expect(tapAction('share', false)).toBe('export'); // an edit dropped the file: export again
    expect(tapAction('save', false)).toBe('export');
    expect(tapAction('preparing', true)).toBe('ignore');
  });

  it('AbortError shows nothing; everything else falls back once', () => {
    expect(exportOutcome(new DOMException('x', 'AbortError'))).toBe('abort');
    expect(exportOutcome(new Error('context lost'))).toBe('fallback');
  });

  it('the "only 2048 kept" note: a working plan without a source although the original was larger', () => {
    const w = { width: 1536, height: 2048 };
    expect(noSourceNote(plan({ fallback: 'noSource' }), { blob: null, width: 3000, height: 4000 }, w)).toBe(true);
    expect(noSourceNote(plan({ fallback: 'noSource' }), { blob: null, width: null, height: null }, w)).toBe(false);
    expect(noSourceNote(plan({ fallback: 'notLarger' }), { blob: null, width: 3000, height: 4000 }, w)).toBe(false);
  });

  it('pill copy', () => {
    expect([pillLabel('save'), pillLabel('preparing'), pillLabel('share')]).toEqual(['儲存', '準備中', '分享']);
  });
});
```

Add to `tests/e2e/crop.spec.ts` (add `exportFile` and `closeFallback` to its `./fixtures` import; `makeJpeg` is there since Task 16):

```ts
const knob = (page: Page, value: object) => page.evaluate((v) => localStorage.setItem('meiyan.debug.export.v1', JSON.stringify(v)), value);

/** every toast text shown from now on (a toast lasts 4 s, and an export on SwiftShader can outlive it) */
const watchToasts = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    const scan = () => {
      for (const el of document.querySelectorAll('.toast')) {
        const t = (el.textContent ?? '').trim();
        if (t && w.__toasts.at(-1) !== t) w.__toasts.push(t);
      }
    };
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
const toastsSeen = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

test('原始解析度: a tiled export keeps the picked size; 標準 is the working size; a failure falls back once', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  const full = await exportFile(page);
  expect([full.width, full.height, full.type]).toEqual([2400, 3200, 'image/jpeg']);
  expect((await debugState(page)).export).toMatchObject({ mode: 'tiled', width: 2400, height: 3200 });
  await closeFallback(page);

  // slowMs makes the fallback finish after the 4 s window, so its file is delivered through the 「分享」 pill
  await knob(page, { failAt: 'tile', slowMs: 4500 });
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowRight'); // an edit: the cached file no longer matches
  await watchToasts(page);
  // a fallback slower than 4 s ends in 「分享」: exportFile's second tap must then share that file (Review Focus 5)
  const fell = await exportFile(page);
  expect(await toastsSeen(page)).toContain('已改用標準解析度輸出');
  expect([fell.width, fell.height]).toEqual([1536, 2048]);
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).toBeNull();
});

test('a slow tiled export turns the pill into 分享; the second tap shares', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await knob(page, { slowMs: 4500, tile: 2048 });
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  await page.locator('.topbar .pill').click();
  await expect(page.locator('.topbar .pill', { hasText: '分享' })).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText('已準備好，點一下分享')).toBeVisible();
  await page.locator('.topbar .pill', { hasText: '分享' }).click();
  await expect(page.getByRole('dialog', { name: '儲存照片' })).toBeVisible();
});

test('going to the background mid-export aborts it, frees it and says so on return', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await knob(page, { slowMs: 4500, tile: 2048 });
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 2400, 3200) });
  await page.locator('.topbar .pill').click();
  await expect(page.getByText('正在輸出原始解析度…')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).not.toBeNull();
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportGuard.v1'))).toBeNull();
  await expect(page.locator('.topbar .pill')).toHaveText('儲存');
  expect((await debugState(page)).export).toBeNull();
  await setVisibility('visible');
  await expect(page.getByText('輸出已中斷，請再按一次「儲存」')).toBeVisible();
});
```

- [ ] **Step 2: Run the unit tests to see them fail**

Run: `npx vitest run src/ui/exportFlow.test.ts`
Expected: FAIL — `Failed to resolve import "./exportFlow"`.

- [ ] **Step 3: Implement `src/ui/exportFlow.ts`**

```ts
// The 儲存 flow's rules (S §2.3), pure: which file a tap may share at once, when the pill asks for a second tap, what a
// failure does, and when to say that only the 2048 copy was kept.
import { SHARE_WINDOW_MS } from '../config/limits';
import type { ExportPlan, SourceInfo } from '../media/exportPlan';
import type { Size } from '../types';
import { stampIs } from './editorModel';

export type Pill = 'save' | 'preparing' | 'share';

export function pillLabel(p: Pill): string {
  return p === 'preparing' ? '準備中' : p === 'share' ? '分享' : '儲存';
}

/** the output settings a share file was made with: a 設定 change after a pre-encode must not share the old file */
export function planSig(p: Pick<ExportPlan, 'mode' | 'format' | 'quality' | 'width' | 'height'>): string {
  return `${p.mode}|${p.format}|${p.quality}|${p.width}x${p.height}`;
}

export interface ShareCache {
  key: string;
  field: number;
  sig: string;
  file: File;
}

export function shareReady(c: ShareCache | null, key: string, field: number, sig: string): boolean {
  return !!c && stampIs(c, key, field) && c.sig === sig;
}

/** the debounced pre-encode makes a share file only for a working-size JPEG (a PNG encode costs battery on every edit) */
export function preEncodes(p: Pick<ExportPlan, 'mode' | 'format'>): boolean {
  return p.mode === 'working' && p.format === 'jpeg';
}

/** within the tap's transient activation (5 s; SHARE_WINDOW_MS leaves a margin): share at once */
export function shareNow(startedAt: number, now: number): boolean {
  return now - startedAt <= SHARE_WINDOW_MS;
}

/**
 * What a pill tap does (S §2.3): 「分享」 shares the file the slow export just delivered, synchronously inside the tap,
 * whatever plan made it (a fallback's working-size file too, and also when a settling 美體 field kept it out of the share
 * cache), so the second tap can never start another export that ends in 「分享」 again.
 */
export function tapAction(pill: Pill, hasPending: boolean): 'ignore' | 'sharePending' | 'export' {
  if (pill === 'preparing') return 'ignore';
  return pill === 'share' && hasPending ? 'sharePending' : 'export';
}

export function exportOutcome(e: unknown): 'abort' | 'fallback' {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError' ? 'abort' : 'fallback';
}

export function noSourceNote(plan: ExportPlan, source: SourceInfo, working: Size): boolean {
  return plan.fallback === 'noSource' && !!source.width && !!source.height && Math.max(source.width, source.height) > Math.max(working.width, working.height);
}
```

- [ ] **Step 4: Wire the Editor**

`src/ui/deps.ts`: import `runTiledExport` from `../media/exportFull` and add it to `deps`.

`src/ui/screens/Editor.tsx`: imports `EXPORT_COPY, planExport, type ExportPlan` added to Task 16's `../../media/exportPlan` import (`NO_SOURCE`, `SourceInfo` are there already), `exportOutcome, noSourceNote, pillLabel, planSig, preEncodes, shareNow, shareReady, tapAction, type Pill, type ShareCache` (`../exportFlow`) and `app` (joining the `go, setPendingHistory, showSaveFallback, toast, type EditorSource` import from `../state`); `debug`, `useStore`, `exportOnLatest` and `stampIs` are imported already. State (replacing `preparing`, `Editor.tsx:184`, and typing `fresh` as `ShareCache`, `Editor.tsx:188`):

```ts
  const prefs = useStore(app, (s) => s.prefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [pill, setPill] = useState<Pill>('save');
  const [exporting, setExporting] = useState<{ progress: number } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const interrupted = useRef(false);
  const noSourceToastDone = useRef(false);
  const fresh = useRef<ShareCache | null>(null);
  /** the file a slow export delivered: the 「分享」 tap shares it (tapAction) */
  const delivered = useRef<File | null>(null);
```

and, after step 1's `frameOf` (`Editor.tsx:256-259`; it needs `photo` and `frameOf`):

```ts
  const planFor = (s: StillSession, e: EditState, src: SourceInfo, field: BodyField | null): ExportPlan =>
    planExport(
      e,
      prefsRef.current,
      src,
      photo,
      { prefTier: prefsRef.current.tier, autoTier: deps.autoTierSession(), screen: { width: window.screen.width, height: window.screen.height }, capped: deps.exportCapped() },
      s.bounds(frameOf(e, s), field),
      deps.readExportDebug(),
    );
```

`update(e, commit, user = true)` (`Editor.tsx:303-321`) additionally drops a finished file: `fresh.current = null; delivered.current = null; setPill((p) => (p === 'share' ? 'save' : p));` (a 25 MB file is not kept past the next edit, S §2.3; the functional update avoids a stale `pill` in a drag's closure).

`encode` (`Editor.tsx:814-820`; step 1's `encode(s, e, field)` builds the frame from the edit for the session it runs on) takes the plan:

```ts
  const encode = async (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan) => {
    await s.prepareExport(frameOf(e, s));
    if (unmounted.current) throw new Error('editor closed');
    const img = s.exportImageData(frameOf(e, s), field);
    return { img, file: await deps.encodeOutput(img, plan.format, plan.quality) };
  };
```

The debounce effect (`Editor.tsx:827-881`): returns at once while `exporting` (it re-arms when the export ends), lists `exporting` and `prefs` in its dependencies, computes `const plan = planFor(s, editRef.current, sourceRef.current, fieldMemo.field); const sig = planSig(plan);`, uses `shareReady(fresh.current, key, gen, sig)` where it used `stampIs(fresh.current, …)` (`:831`, `:841`), calls `encode(s, edit, field, plan)` and encodes a share file only when `preEncodes(plan)` (otherwise it exports the image for the thumbnail and the autosave only, as its `!img` branch does today); a new share file is stored as `{ key, field: gen, sig, file }`.

`save` (`Editor.tsx:908-947`) becomes:

```ts
  const save = () => {
    if (!session || lost) return;
    const action = tapAction(pill, delivered.current !== null);
    if (action === 'ignore') return;
    if (action === 'sharePending') {
      const file = delivered.current!;
      delivered.current = null;
      setPill('save');
      share(file); // synchronous inside the tap: a fresh transient activation
      return;
    }
    const s = session;
    // the user's state at the tap is what is exported (step 1: these params and this 美體 field, snapshotField)
    const e = editRef.current;
    const key = editKey(e);
    const gen = settleField();
    const field = snapshotField();
    const plan = planFor(s, e, sourceRef.current, field);
    const sig = planSig(plan);
    if (shareReady(fresh.current, key, gen, sig)) {
      setPill('save');
      share(fresh.current!.file); // synchronous inside the tap
      return;
    }
    if (noSourceNote(plan, sourceRef.current, photo) && !noSourceToastDone.current) {
      noSourceToastDone.current = true;
      toast(EXPORT_COPY.noSource);
    }
    const t0 = performance.now();
    if (plan.mode === 'tiled' && sourceRef.current.blob && sessionEngine.current) runTiled(s, e, field, plan, key, gen, t0);
    else runWorking(s, e, field, plan, key, gen, t0);
  };

  /** finished: share inside the 4 s window, else the pill asks for a second tap (S §2.3) */
  const deliver = (file: File, t0: number) => {
    if (shareNow(t0, performance.now())) {
      setPill('save');
      share(file);
    } else {
      delivered.current = file;
      setPill('share');
      toast(EXPORT_COPY.shareReady, 4000);
    }
  };

  /** today's path (step 1's save): the working size, encoded in the plan's format */
  const runWorking = (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan, key: string, gen: number, t0: number) => {
    setPill('preparing');
    const replacement = (failed: StillSession) => {
      const cur = sessionRef.current;
      return !unmounted.current && cur && cur !== failed && !sessionEngine.current?.lost ? cur : null;
    };
    exportOnLatest(s, (x) => encode(x, e, field, plan), replacement).then(
      ({ s: done, result: r }) => {
        debug({ export: { mode: 'working', width: r.img.width, height: r.img.height, tiles: 0, ms: Math.round(performance.now() - t0) } });
        if (sessionRef.current === done && editKey(editRef.current) === key && fieldGen.current === gen) fresh.current = { key, field: gen, sig: planSig(plan), file: r.file };
        deliver(r.file, t0);
      },
      (err: unknown) => {
        if (unmounted.current) return;
        setPill('save');
        toast(`無法輸出照片：${reportError(err, 'encode')}`, 4000);
      },
    );
  };

  /** the source decoded at up to 4096 and rendered in tiles; one fallback to the working size on failure (C §4.6) */
  const runTiled = (s: StillSession, e: EditState, field: BodyField | null, plan: ExportPlan, key: string, gen: number, t0: number) => {
    const engine = sessionEngine.current!;
    const ac = new AbortController();
    exportAbort.current = ac;
    setPill('preparing');
    setExporting({ progress: 0 });
    debug({ export: null });
    s.pauseDisplay(true);
    deps
      .runTiledExport(engine, sourceRef.current.blob!, plan, s.tileInput(frameOf(e, s), field), {
        signal: ac.signal,
        working: photo,
        knob: deps.readExportDebug(),
        onProgress: (p) => setExporting({ progress: p }),
      })
      .then(
        (file) => {
          if (unmounted.current) return;
          debug({ export: { mode: 'tiled', width: plan.width, height: plan.height, tiles: plan.tiles.length, ms: Math.round(performance.now() - t0) } });
          if (editKey(editRef.current) === key && fieldGen.current === gen) fresh.current = { key, field: gen, sig: planSig(plan), file };
          deliver(file, t0);
        },
        (err: unknown) => {
          if (unmounted.current || exportOutcome(err) === 'abort') {
            setPill('save');
            return;
          }
          // a handled fallback, told by its toast: a warning, not reportError (console.error fails every e2e test,
          // tests/e2e/fixtures.ts guard, and the knob-injected failures of crop.spec.ts take this path)
          console.warn('[meiyan] tiled export failed; standard fallback', err);
          toast(EXPORT_COPY.fallback, 4000);
          const working = planFor(s, e, NO_SOURCE, field);
          runWorking(sessionRef.current ?? s, e, field, working, key, gen, t0);
        },
      )
      .finally(() => {
        if (exportAbort.current === ac) exportAbort.current = null;
        setExporting(null);
        try {
          s.pauseDisplay(false);
        } catch (err) {
          reportError(err, 'pauseDisplay');
        }
      });
  };
```

The visibility handler (`Editor.tsx:578-585`):

```ts
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        // abort first: its listener frees ~140 MB synchronously, before the flush renders a thumbnail (S §2.3)
        if (exportAbort.current) {
          exportAbort.current.abort();
          interrupted.current = true;
        }
        flushHistory();
      } else if (interrupted.current) {
        interrupted.current = false;
        toast(EXPORT_COPY.interrupted, 4000);
      }
    };
```

`close` (`Editor.tsx:1014-1017`) starts with `exportAbort.current?.abort();` (✕ cancels, then closes); the unmount cleanup (`Editor.tsx:587-610`) drops `fresh.current = null; delivered.current = null;`.

The topbar pill (`Editor.tsx:1135-1137`):

```tsx
        <button type="button" class="pill" onClick={save} disabled={!session || pill === 'preparing' || lost} aria-busy={pill === 'preparing'}>
          <span>{pillLabel(pill)}</span>
        </button>
```

and `inert={!!exporting}` on `.title-center` (↶ ↷, `:1131`), `.editor-tools` (`:1160`) and `.editor-panel` (`:1179`). In the overlay chain (`Editor.tsx:1110-1125`), before the `lost` case:

```tsx
  } else if (exporting) {
    overlay = (
      <Status spinner scrim title={EXPORT_COPY.overlay} detail={`${Math.round(exporting.progress * 100)}%`}>
        <button type="button" class="btn" onClick={() => exportAbort.current?.abort()}>
          {EXPORT_COPY.cancel}
        </button>
      </Status>
    );
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/`
Expected: PASS.
Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts tests/e2e/editor.spec.ts`
Expected: all passed (`editor.spec.ts:108-109` still exports 1000 × 1500: `sample_face.png` is not larger than the working copy, so the plan is `working`).

- [ ] **Step 6: Commit**

```bash
git add src/ui/exportFlow.ts src/ui/exportFlow.test.ts src/ui/screens/Editor.tsx src/ui/deps.ts tests/e2e/crop.spec.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: plan-based 儲存 with tiled export, two-tap share, fallback and background abort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: App e2e — dimensions, exact copies, 拉直, faces under geometry, reopen, PNG, breadcrumb, EXIF, 裁切 frames

**Files:**
- Modify: `tests/e2e/crop.spec.ts` (cases 1–4, 6–8, 10, 11 of S §8.2), `LICENSES/NOTICE.txt:61` (one entry for the derived test images, S §8.3)
- Test: `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–17 (the whole feature); Task 16's fixtures `makeJpeg`, `withExifOrientation`, `exportFile`, `closeFallback`; step 1's fixture `tests/fixtures/group_faces.png` (S1 §8.3), `__meiyan.boxes` / `faces` / `detectCalls` (S1 §3.2) and its e2e helper `selectPerson(page, n)` (C §8.4); this file's `importInto`, `frameAspect`, `tab`, `option`, `knob`.
- Produces: no new code; NOTICE gains one line.

- [ ] **Step 1: Write the tests**

In `tests/e2e/crop.spec.ts`, add `withExifOrientation` and step 1's `selectPerson` to the `./fixtures` import (`closeFallback`, `exportFile`, `makeJpeg` are there since Tasks 16–17; `readFileSync` since Task 15; every pixel check runs in the page, so no `decodePng`), and add at the top, with the other imports:

```ts
import { apply, flipView, IDENTITY_GEOMETRY, oToV, rotateLeft, setStraighten, snapCrop, viewSize } from '../../src/geometry/view';
```

Then append:

```ts
/** the open fallback image's pixels, kept in the page under `name` */
async function stash(page: Page, name: string): Promise<void> {
  await page
    .getByRole('dialog', { name: '儲存照片' })
    .getByRole('img', { name: '編輯結果' })
    .evaluate(async (img: HTMLImageElement, n: string) => {
      const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const w = window as unknown as { __exports?: Record<string, ImageData> };
      (w.__exports ??= {})[n] = ctx.getImageData(0, 0, bmp.width, bmp.height);
    }, name);
}

/** max channel difference of b against a mirrored ('mirror') or turned 90° counter-clockwise ('rotate'), inside a margin */
function compare(page: Page, a: string, b: string, kind: 'mirror' | 'rotate', margin: number): Promise<number> {
  return page.evaluate(
    ([an, bn, k, m]) => {
      const ex = (window as unknown as { __exports: Record<string, ImageData> }).__exports;
      const A = ex[an];
      const B = ex[bn];
      let max = 0;
      for (let j = m; j < B.height - m; j++)
        for (let i = m; i < B.width - m; i++) {
          const si = k === 'mirror' ? A.width - 1 - i : A.width - 1 - j;
          const sj = k === 'mirror' ? j : i;
          const p = (j * B.width + i) * 4;
          const q = (sj * A.width + si) * 4;
          for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(B.data[p + c] - A.data[q + c]));
        }
      return max;
    },
    [a, b, kind, margin] as const,
  );
}

/** RGB of the open fallback image at (x, y) */
function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return page
    .getByRole('dialog', { name: '儲存照片' })
    .getByRole('img', { name: '編輯結果' })
    .evaluate(
      async (img: HTMLImageElement, [px, py]: number[]) => {
        const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return Array.from(ctx.getImageData(px < 0 ? bmp.width + px : px, py < 0 ? bmp.height + py : py, 1, 1).data.slice(0, 3));
      },
      [x, y],
    );
}

const usePng = (page: Page) =>
  page.addInitScript(() => {
    if (!localStorage.getItem('meiyan.prefs.v1')) localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ exportFormat: 'png' }));
  });

test('dimensions: 原始解析度 keeps the picked size; 1:1, 旋轉 and 標準 change it as the geometry says', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto('/');
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 3000, 4000) });
  let f = await exportFile(page);
  expect([f.width, f.height]).toEqual([3000, 4000]);
  await closeFallback(page);
  await tab(page, '裁切').click();
  await option(page, '1:1').click();
  await tab(page, '美膚').click();
  f = await exportFile(page);
  expect([f.width, f.height]).toEqual([3000, 3000]);
  await closeFallback(page);
  await tab(page, '裁切').click();
  await option(page, '3:4').click();
  await option(page, '旋轉').click();
  await expect(option(page, '4:3')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '美膚').click();
  f = await exportFile(page);
  expect([f.width, f.height]).toEqual([4000, 3000]);
  await closeFallback(page);
  await page.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  await page.getByRole('dialog', { name: '設定' }).getByRole('radiogroup', { name: '輸出解析度' }).getByRole('radio', { name: '標準（2048）' }).click();
  await page.getByRole('button', { name: '完成' }).click();
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  f = await exportFile(page);
  expect([f.width, f.height]).toEqual([2048, 1536]);
});

test('exact copies: 翻轉 mirrors the export (≤ 1/255), 旋轉 turns it (≤ 2/255), inside the kernel margin', async ({ page }) => {
  test.setTimeout(300_000);
  await usePng(page);
  await importInto(page, SAMPLE_FACE);
  await exportFile(page);
  await stash(page, 'a');
  await closeFallback(page);
  await tab(page, '裁切').click();
  await option(page, '翻轉').click();
  await tab(page, '美膚').click();
  await exportFile(page);
  await stash(page, 'flip');
  await closeFallback(page);
  // margin: two kernel aprons at a 1000 px short edge (apronFor(1000) = 24)
  expect(await compare(page, 'a', 'flip', 'mirror', 48)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '復原' }).click();
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await tab(page, '美膚').click();
  const r = await exportFile(page);
  expect([r.width, r.height]).toEqual([1500, 1000]);
  await stash(page, 'turn');
  expect(await compare(page, 'a', 'turn', 'rotate', 48)).toBeLessThanOrEqual(2);
});

test('拉直 12°: the export is the largest crop inside the straightened photo', async ({ page }) => {
  test.setTimeout(300_000);
  await importInto(page, SAMPLE_FACE);
  await tab(page, '裁切').click();
  await page.getByRole('slider', { name: '拉直' }).focus();
  for (let i = 0; i < 120; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('slider', { name: '拉直' })).toHaveAttribute('aria-valuetext', '+12.0°');
  await tab(page, '美膚').click();
  const W = { width: 1000, height: 1500 };
  const want = viewSize(snapCrop(setStraighten(IDENTITY_GEOMETRY, 12, W), W), W);
  const f = await exportFile(page);
  expect([f.width, f.height]).toEqual([want.width, want.height]);
  for (const [x, y] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const [r, g, b] = await pixelAt(page, x, y);
    expect(r + g + b, `corner ${x},${y}`).toBeGreaterThan(30); // photo content, not the stage's black
  }
});

test('faces stay on their content after 旋轉 + 翻轉; 大眼 on person 2 changes only person 2', async ({ page }) => {
  test.setTimeout(300_000);
  await importInto(page, 'tests/fixtures/group_faces.png');
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  const before = (await debugState(page)).boxes;
  await tab(page, '裁切').click();
  await option(page, '旋轉').click();
  await option(page, '翻轉').click();
  await tab(page, '美型').click();
  const O = { width: 1800, height: 1200 };
  const g = flipView(rotateLeft(IDENTITY_GEOMETRY));
  await expect
    .poll(async () => {
      const after = (await debugState(page)).boxes;
      return before.every((b) => {
        const a = after.find((x) => x.id === b.id);
        if (!a) return false;
        const [ex, ey] = apply(oToV(g, O), [b.x + b.w / 2, b.y + b.h / 2]);
        return Math.hypot(a.x + a.w / 2 - ex, a.y + a.h / 2 - ey) < 0.02;
      });
    })
    .toBe(true);

  const frame = page.locator('.editor-stage .frame');
  const shot = async () => frame.screenshot();
  const box = (await debugState(page)).boxes.find((b) => b.id === before[1].id)!;
  // select first: the selection recolours the brackets, which must not count as an edit
  await selectPerson(page, 2);
  await option(page, '大眼').click();
  await page.waitForTimeout(500);
  const a0 = await shot();
  await page.getByRole('slider').focus();
  for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const a1 = await shot();
  const diff = await page.evaluate(
    async ([p, q, bx]) => {
      const load = async (b64: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        return c.getContext('2d')!.getImageData(0, 0, bmp.width, bmp.height);
      };
      const A = await load(p);
      const B = await load(q);
      // the person's box padded by 15 %, in screenshot pixels
      const pad = 0.15;
      const x0 = (bx.x - bx.w * pad) * A.width;
      const x1 = (bx.x + bx.w * (1 + pad)) * A.width;
      const y0 = (bx.y - bx.h * pad) * A.height;
      const y1 = (bx.y + bx.h * (1 + pad)) * A.height;
      let outside = 0;
      let inside = 0;
      for (let y = 0; y < A.height; y++)
        for (let x = 0; x < A.width; x++) {
          const i = (y * A.width + x) * 4;
          const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside = Math.max(inside, d);
          else outside = Math.max(outside, d);
        }
      return { inside, outside };
    },
    [a0.toString('base64'), a1.toString('base64'), box] as const,
  );
  expect(diff.inside).toBeGreaterThan(8);
  expect(diff.outside).toBeLessThanOrEqual(1);
});

test('reopen keeps the geometry, runs no detector, and still exports from the kept source', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  await importInto(page, { name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 3000, 4000) });
  await tab(page, '裁切').click();
  await option(page, '1:1').click();
  await tab(page, '美膚').click();
  await page.getByRole('button', { name: '關閉' }).click();
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => frameAspect(page)).toBeCloseTo(1, 2);
  expect((await debugState(page)).detectCalls).toBe(calls);
  const f = await exportFile(page);
  expect([f.width, f.height]).toEqual([3000, 3000]);
});

test('PNG: the editor and the camera review save image/png named .png', async ({ page }) => {
  test.setTimeout(300_000);
  await usePng(page);
  await importInto(page, SAMPLE_FACE);
  const e = await exportFile(page);
  expect(e.type).toBe('image/png');
  expect(e.name).toMatch(/^meiyan-\d{8}-\d{6}\.png$/);
  await closeFallback(page);
  await page.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 90_000 }).toBe('live');
  await page.getByRole('button', { name: '拍照' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await page.getByRole('button', { name: '儲存' }).click();
  const img = page.getByRole('dialog', { name: '儲存照片' }).getByRole('img', { name: '編輯結果' });
  await expect(img).toBeVisible({ timeout: 30_000 });
  expect(await img.evaluate((i: HTMLImageElement) => i.dataset.name)).toMatch(/\.png$/);
  expect(await img.evaluate(async (i: HTMLImageElement) => (await (await fetch(i.src)).blob()).type)).toBe('image/png');
});

test('a crash breadcrumb: toast at launch, 標準 exports, 設定 shows why; 原始解析度 again lifts the cap', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('meiyan.exportGuard.v1', JSON.stringify({ at: 1, w: 4000, h: 3000, format: 'jpeg' }));
  });
  await page.goto('/');
  await expect(page.getByText('上次以原始解析度輸出時程式中止，已改用標準解析度')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportCap.v1'))).toBe('2048');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 3000, 4000) });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  const f = await exportFile(page);
  expect([f.width, f.height]).toEqual([1536, 2048]);
  await closeFallback(page);
  await page.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: '設定' }).click();
  const size = page.getByRole('dialog', { name: '設定' }).getByRole('radiogroup', { name: '輸出解析度' });
  await expect(size.getByRole('radio', { name: '標準（2048）' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('再選一次「原始解析度」即可重試', { exact: false })).toBeVisible();
  await size.getByRole('radio', { name: '原始解析度' }).click();
  expect(await page.evaluate(() => localStorage.getItem('meiyan.exportCap.v1'))).toBeNull();
  await expect(size.getByRole('radio', { name: '原始解析度' })).toHaveAttribute('aria-checked', 'true');
});

test('EXIF orientation 6: imports upright; the full-resolution export is upright with the sides swapped', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  // stored 4000 × 3000 with the red block at the stored top-left; orientation 6 shows it turned 90° clockwise
  const jpeg = withExifOrientation(await makeJpeg(page, 4000, 3000), 6);
  await importInto(page, { name: 'exif6.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  expect(await frameAspect(page)).toBeCloseTo(3000 / 4000, 2);
  const f = await exportFile(page);
  expect([f.width, f.height]).toEqual([3000, 4000]);
  const [r1, g1, b1] = await pixelAt(page, -10, 10);
  expect(r1).toBeGreaterThan(200);
  expect(g1 + b1).toBeLessThan(120);
  const [r0, g0, b0] = await pixelAt(page, 10, 10);
  expect(r0 > 200 && g0 + b0 < 120).toBe(false);
});

test('裁切 mode draws no engine frame while handles move, 拉直 drags and 旋轉 turns; leaving draws once', async ({ page }) => {
  await importInto(page, SAMPLE_FACE);
  await tab(page, '裁切').click();
  const count = async () => (await debugState(page)).renderCount ?? 0;
  // entering draws the whole photo once; wait for it to settle
  let n = await count();
  await expect
    .poll(async () => {
      const m = await count();
      const same = m === n;
      n = m;
      return same;
    }, { intervals: [600] })
    .toBe(true);
  const canvas = page.locator('canvas.display-canvas');
  const size = () => canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(await size()).toEqual([1000, 1500]);

  const corner = page.getByRole('button', { name: '右下角' });
  const b = (await corner.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 - i * 6, b.y + b.height / 2 - i * 8);
  await page.mouse.up();
  await page.getByRole('slider', { name: '拉直' }).focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 3; i++) await option(page, '旋轉').click();
  await page.waitForTimeout(1200); // the autosave debounce after the last edit
  expect(await count()).toBe(n);
  expect(await size()).toEqual([1000, 1500]);

  await tab(page, '美膚').click();
  await expect.poll(count).toBeGreaterThan(n);
  await page.waitForTimeout(800);
  expect(await count()).toBe(n + 1);
});
```

(`selectPerson` comes from step 1's `tests/e2e/fixtures.ts` additions, C §8.4.)

- [ ] **Step 2: Add the NOTICE line**

In `LICENSES/NOTICE.txt` (LF), after the `tests/fixtures/sample_face.pose.json …` line (`NOTICE.txt:61`; step 1 added the `group_faces` / `group_people` entries below it):

```
  - Test images generated in code from sample_face.png and a gradient (not committed): the large JPEGs, the EXIF-
    orientation JPEG and the sideways copy of tests/e2e/crop.spec.ts and tests/e2e/fixtures.ts, and the frames of
    tests/e2e/pages/export.ts. Modified derivatives of sample_face.png (Apache-2.0 §4(b) change notice).
```

- [ ] **Step 3: Run the app spec**

Run: `npm run build && npx playwright test tests/e2e/crop.spec.ts`
Expected: every crop.spec test passes (the 12 MP cases take minutes on SwiftShader; their timeouts allow it). On a failure, fix the code the failing case exercises (the plan's earlier tasks own it), never the assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/crop.spec.ts LICENSES/NOTICE.txt
git commit -m "$(cat <<'EOF'
v0.4 step 3: crop and full-resolution export app specs; NOTICE for derived test images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Phase 0 export rows in `/bench.html`

**Files:**
- Create: `src/bench/exportBench.ts`
- Modify: `src/bench/report.ts` (+ `formatExportRows`), `src/bench/report.test.ts`, `src/bench/main.ts` (CRLF; a 「輸出測試」 button next to the body bench, rows in 複製結果)
- Test: `src/bench/report.test.ts`

**Interfaces:**
- Consumes: Task 1 (`IDENTITY_GEOMETRY`, `setStraighten`, `snapCrop`, `viewSize`), Task 5 (`importPhotoInfo`), Task 8 (`Engine.renderTile`, `releaseBuffers`, `renderToImageData` with geometry), Task 9 (`planTiles`, `TileGrid`), step 1 (`defaultPhoto`, the step-1 `RenderInput`).
- Produces: `interface ExportBenchRow { name: string; ms: number | null; detail: string }`; `runExportBench(engine: Engine, onRow: (r: ExportBenchRow) => void, picked?: File): Promise<ExportBenchRow[]>`; `formatExportRows(rows: readonly ExportBenchRow[]): string`.

- [ ] **Step 1: Write the failing test**

Add to `src/bench/report.test.ts`:

```ts
import { formatExportRows } from './report';

describe('formatExportRows (S §6.4)', () => {
  it('one TSV line per row with ms rounded, and — for manual or failed rows', () => {
    expect(
      formatExportRows([
        { name: 'decode 12MP', ms: 412.6, detail: '4032×3024 from 4032×3024' },
        { name: 'share after 3.5 / 4.5 / 5.5 s', ms: null, detail: 'manual on the iPhone' },
      ]),
    ).toBe('輸出\tms\t說明\ndecode 12MP\t413\t4032×3024 from 4032×3024\nshare after 3.5 / 4.5 / 5.5 s\t—\tmanual on the iPhone');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/bench/report.test.ts`
Expected: FAIL — `formatExportRows is not exported`.

- [ ] **Step 3: Implement**

Append to `src/bench/report.ts`:

```ts
export interface ExportBenchRow {
  name: string;
  /** null: failed, or a manual row */
  ms: number | null;
  detail: string;
}

/** the export rows of 複製結果 (S §6.4) */
export function formatExportRows(rows: readonly ExportBenchRow[]): string {
  return ['輸出\tms\t說明', ...rows.map((r) => `${r.name}\t${r.ms === null ? '—' : r.ms.toFixed(0)}\t${r.detail}`)].join('\n');
}
```

Create `src/bench/exportBench.ts`:

```ts
// Phase 0 export rows (step-3 spec §6.4) on synthetic frames, so no photo is needed: decode of 12 / 24 / 48 MP JPEGs to
// a 4096 long edge, a tiled render of 4096 × 3072 (6 faces, body field, θ = 12°) at TILE 512 / 1024 / 2048 with the
// putImageData into the output canvas, JPEG q 0.95 and PNG encode, a canvas-area probe, and P2's cost with geometry at
// 2048. The share-activation row is manual on the device.
import { defaultPhoto, naturalPerson } from '../edit/state';
import { FACE_TEMPLATE } from '../engine/passes/faceMesh';
import { IDENTITY_GEOMETRY, setStraighten, snapCrop, viewSize } from '../geometry/view';
import { faceBoundsFor, planTiles, type TileGrid } from '../media/exportPlan';
import { importPhotoInfo } from '../media/importer';
import type { BodyField, Engine, Face, RenderFace, RenderInput } from '../types';
import type { ExportBenchRow } from './report';

const now = () => performance.now();

/** six template faces in a 3 × 2 grid with 大眼 and 瘦臉 on (the face warps' window growth and the N-face pass) */
function gridFaces(): RenderFace[] {
  const ext = [0.5, 0.2, 0.5, 0.26, 0.5, 0.33, 0.5, 0.4, 0.5, 0.71, 0.5, 0.68, 0.3, 0.45, 0.7, 0.45];
  const base = naturalPerson();
  const person = { ...base, values: { ...base.values, 'shape.eyeEnlarge': 0.6, 'shape.faceSlim': 0.6 } };
  const out: RenderFace[] = [];
  for (let k = 0; k < 6; k++) {
    const ox = 0.02 + (k % 3) * 0.33;
    const oy = 0.04 + Math.floor(k / 3) * 0.48;
    const at = (a: ArrayLike<number>) => Float32Array.from(a, (v, i) => (i % 2 === 0 ? ox + v * 0.3 : oy + v * 0.45));
    const pts111 = at(FACE_TEMPLATE);
    // the contour points stand in for the oval: enough for the bench's mask and box work
    const face = { pts111, ext: at(ext), oval: pts111.slice(0, 72), yaw: 0 } as unknown as Face;
    out.push({ face, weight: 1, person, protect: null } as unknown as RenderFace);
  }
  return out;
}

async function synthJpeg(w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d8b49a');
  g.addColorStop(1, '#4a6680');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `hsl(${(i * 37) % 360} 40% 50%)`;
    ctx.fillRect(((i * 97) % 100) * (w / 100), ((i * 53) % 100) * (h / 100), w / 40, h / 40);
  }
  const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  c.width = c.height = 0;
  return b;
}

function synthField(): BodyField {
  const w = 32;
  const h = 24;
  const data = new Float32Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    data[i * 2] = 0.01 * Math.sin(i * 0.3);
    data[i * 2 + 1] = 0.008 * Math.cos(i * 0.2);
  }
  return { width: w, height: h, data, version: 1 };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export async function runExportBench(engine: Engine, onRow: (r: ExportBenchRow) => void, picked?: File): Promise<ExportBenchRow[]> {
  const rows: ExportBenchRow[] = [];
  const push = (r: ExportBenchRow) => {
    rows.push(r);
    onRow(r);
  };
  const fail = (name: string, e: unknown) => push({ name, ms: null, detail: `failed: ${e instanceof Error ? e.message : String(e)}` });

  // a real photo from 照片 (HEIC cannot be synthesized): its decode to 4096 (S §6.4 row 1)
  if (picked) {
    try {
      const t = now();
      const info = await importPhotoInfo(picked, 4096);
      push({
        name: `decode picked ${picked.type || 'unknown'}`,
        ms: now() - t,
        detail: `${info.bitmap.width}×${info.bitmap.height} from ${info.oriented.width}×${info.oriented.height}, ${(picked.size / 1048576).toFixed(1)} MB, via ${info.path}`,
      });
      info.bitmap.close();
    } catch (e) {
      fail(`decode picked ${picked.type || 'unknown'}`, e);
    }
  }

  for (const [w, h, label] of [
    [4032, 3024, '12MP'],
    [5712, 4284, '24MP'],
    [8064, 6048, '48MP'],
  ] as const) {
    try {
      const blob = await synthJpeg(w, h);
      const t = now();
      const info = await importPhotoInfo(blob, 4096);
      push({ name: `decode ${label}`, ms: now() - t, detail: `${info.bitmap.width}×${info.bitmap.height} from ${info.oriented.width}×${info.oriented.height}, via ${info.path}` });
      info.bitmap.close();
    } catch (e) {
      fail(`decode ${label}`, e);
    }
  }

  const decode = { width: 4096, height: 3072 };
  let full: ImageBitmap | null = null;
  try {
    full = (await importPhotoInfo(await synthJpeg(4096, 3072), 4096)).bitmap;
    const g = snapCrop(setStraighten(IDENTITY_GEOMETRY, 12, decode), decode);
    const V = viewSize(g, decode);
    const body = synthField();
    const faces = gridFaces();
    const oAspect = 4096 / 3072;
    const grid: TileGrid = { V, decode, geometry: g, oAspect, fullShortEdge: 3072 };
    const base = { faces, obstacles: [], globalSkin: null, photo: { ...defaultPhoto(), geometry: g }, body, geometry: g, oAspect } as unknown as Omit<RenderInput, 'source' | 'width' | 'height'>;
    const bounds = { body, faces: faceBoundsFor(faces, oAspect) };
    for (const T of [512, 1024, 2048]) {
      const out = new OffscreenCanvas(V.width, V.height);
      try {
        const ctx = out.getContext('2d', { alpha: false })!;
        const tiles = planTiles(grid, bounds, T);
        let tileMs = 0;
        let putMs = 0;
        const t = now();
        for (const tj of tiles) {
          const bmp = await createImageBitmap(full, tj.win.x, tj.win.y, tj.win.w, tj.win.h);
          const t1 = now();
          const img = engine.renderTile(
            {
              ...base,
              source: bmp,
              width: tj.win.w,
              height: tj.win.h,
              sourceWindow: { x: tj.win.x / 4096, y: tj.win.y / 3072, w: tj.win.w / 4096, h: tj.win.h / 3072 },
              output: { tile: { x: tj.buf.x / V.width, y: tj.buf.y / V.height, w: tj.buf.w / V.width, h: tj.buf.h / V.height }, pixelSize: { width: tj.buf.w, height: tj.buf.h }, fullShortEdge: 3072 },
            },
            { x: tj.out.x - tj.buf.x, y: tj.out.y - tj.buf.y, w: tj.out.w, h: tj.out.h },
          );
          const t2 = now();
          tileMs += t2 - t1;
          bmp.close();
          ctx.putImageData(img, tj.out.x, tj.out.y);
          putMs += now() - t2;
        }
        push({
          name: `tiled render TILE ${T}`,
          ms: now() - t,
          detail: `${tiles.length} tiles, ${(tileMs / tiles.length).toFixed(1)} ms/tile (render + readPixels), putImageData ${(putMs / tiles.length).toFixed(1)} ms/tile, 6 faces`,
        });
      } catch (e) {
        fail(`tiled render TILE ${T}`, e);
      } finally {
        out.width = out.height = 0;
        engine.releaseBuffers();
      }
    }

    const oc = new OffscreenCanvas(4096, 3072);
    oc.getContext('2d')!.drawImage(full, 0, 0);
    for (const [type, quality] of [
      ['image/jpeg', 0.95],
      ['image/png', undefined],
    ] as const) {
      try {
        const t = now();
        const b = await oc.convertToBlob(quality === undefined ? { type } : { type, quality });
        push({ name: `encode ${type}`, ms: now() - t, detail: `${(b.size / 1048576).toFixed(1)} MB at 4096×3072` });
      } catch (e) {
        fail(`encode ${type}`, e);
      }
    }
    oc.width = oc.height = 0;
  } catch (e) {
    fail('tiled render', e);
  } finally {
    full?.close();
  }

  for (const [w, h] of [
    [4096, 4096],
    [8192, 6144],
  ] as const) {
    const t = now();
    try {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(w - 2, h - 2, 2, 2);
      const px = ctx.getImageData(w - 1, h - 1, 1, 1).data;
      c.width = c.height = 0;
      push({ name: `canvas ${w}×${h}`, ms: now() - t, detail: px[0] === 255 && px[3] === 255 ? 'ok' : `read back ${Array.from(px).join(',')}` });
    } catch (e) {
      fail(`canvas ${w}×${h}`, e);
    }
  }

  try {
    const src = (await importPhotoInfo(await synthJpeg(2048, 1536), 2048)).bitmap;
    const input = (geometry = IDENTITY_GEOMETRY): RenderInput =>
      ({ source: src, width: 2048, height: 1536, faces: [], obstacles: [], globalSkin: null, photo: { ...defaultPhoto(), geometry }, geometry }) as unknown as RenderInput;
    const time = (g = IDENTITY_GEOMETRY) => {
      const xs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = now();
        engine.renderToImageData(input(g), { mirror: false });
        xs.push(now() - t);
      }
      return median(xs);
    };
    const plain = time();
    const turned = time(setStraighten(IDENTITY_GEOMETRY, 12, { width: 2048, height: 1536 }));
    push({ name: 'P2 with geometry at 2048', ms: turned - plain, detail: `identity ${plain.toFixed(1)} ms, θ 12° ${turned.toFixed(1)} ms (median of 5, readback included)` });
    src.close();
  } catch (e) {
    fail('P2 with geometry at 2048', e);
  }

  push({ name: 'share after 3.5 / 4.5 / 5.5 s', ms: null, detail: 'manual on the iPhone (S §6.4 item 5)' });
  return rows;
}
```

`src/bench/main.ts` (CRLF): import `runExportBench` and `formatExportRows, type ExportBenchRow`; keep `let exportRows: ExportBenchRow[] = [];`; add a button next to the body-bench controls in the panel, and a hidden file input like the body bench's (`bodyInput`, `main.ts:498-512`) whose `change` runs the bench with the picked photo (a HEIC original from 照片 on the iPhone):

```ts
const exportBtn = button('輸出測試', () => void runExport());
// in the document and not display:none / hidden, like bodyInput (main.ts:498-512): iOS then opens the picker reliably
const exportInput = el('input', { type: 'file', accept: 'image/*', tabIndex: -1 });
exportInput.setAttribute('aria-hidden', 'true');
exportInput.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
exportInput.addEventListener('change', () => {
  const f = exportInput.files?.[0];
  exportInput.value = '';
  if (f) void runExport(f);
});
root.appendChild(exportInput);
// synchronous inside the tap (iOS user-activation rule, as bodyTest)
const exportPhotoBtn = button('輸出測試（選照片）', () => {
  if (!busy) exportInput.click();
});
```

with

```ts
async function runExport(picked?: File): Promise<void> {
  if (busy || !engine) return;
  busy = true;
  exportBtn.disabled = exportPhotoBtn.disabled = true;
  try {
    exportRows = [];
    await runExportBench(engine, (r) => {
      exportRows.push(r);
      bodyOut.textContent = `輸出：${r.name} ${r.ms === null ? '—' : `${r.ms.toFixed(0)} ms`}`;
    }, picked);
  } catch (err) {
    showError('export bench', err);
  } finally {
    busy = false;
    exportBtn.disabled = exportPhotoBtn.disabled = false;
  }
}
```

and `copyResults` (`main.ts:725`) appends `\n\n${formatExportRows(exportRows)}` when `exportRows.length > 0`. Append `exportBtn` and `exportPhotoBtn` where the panel's other buttons (`bodyBtn`) are appended; `exportInput` is already in `root`. Declare these after `root` and `bodyOut` (`main.ts:166, 221`) so the module-level code finds them.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/bench/report.test.ts && npm run typecheck`
Expected: PASS; no type errors.
Run: `npm run build && npx playwright test tests/e2e/bench.spec.ts`
Expected: every test in `bench.spec.ts` passes (step 2 added one; the bench page still starts; the new buttons are not exercised headless).

- [ ] **Step 5: Commit**

```bash
git add src/bench/exportBench.ts src/bench/report.ts src/bench/report.test.ts src/bench/main.ts
git commit -m "$(cat <<'EOF'
v0.4 step 3: Phase 0 export rows in the bench page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Step 3 gate

**Files:**
- Modify: none (fixes go to the task that owns the failing code, with their own commit)

**Interfaces:**
- Consumes: everything above; `STEP3_BASE` = `b975bcc`, the step base commit (substitute it in every command below; the plan-reconcile commit right after it touches only this plan).
- Produces: a green step 3 on local `feat/meiyan-pwa`, version still `0.3.0`.

- [ ] **Step 1: Typecheck, unit tests, build**

Run: `npm run typecheck`
Expected: exit 0, no output.
Run: `npm test`
Expected: every suite passes, 0 failed.
Run: `npm run build`
Expected: `tsc` clean and `vite build` completes (`dist/` written).

- [ ] **Step 2: The whole e2e suite**

Run: `npm run test:e2e`
Expected: every spec passes — including `parity.spec.ts`, `editor.spec.ts`, `camera.spec.ts`, `engine.spec.ts`, `reshape.spec.ts`, `faceProtect.spec.ts`, `body.spec.ts`, `settings.spec.ts`, `home.spec.ts`, `update.spec.ts`, `bench.spec.ts`, the step-1/2 specs (`persons`, `camera-group` in the `chromium-group` project, `adjust`, `composite`) and this step's `export.spec.ts` and `crop.spec.ts`.

- [ ] **Step 3: v0.3 equivalence (C §1.1, S §1.3)**

Run: `npx playwright test tests/e2e/parity.spec.ts`
Expected: passes (identity geometry: max channel diff ≤ 1/255, mean < 0.02/255 against the v0.3 goldens).
Run: `npx vitest run src/engine/pipeline.test.ts -t "P2 skipped"`
Expected: PASS (identity geometry and no window keep P2 skipped).
Run: `git diff --exit-code STEP3_BASE -- src/engine/shaders/composite.ts src/engine/compositeCpu.test.ts`
Expected: exit 0 (step 3 changes no composite text; both step-2 hash pins unchanged, C §8.2).
Run: `git diff STEP3_BASE -- tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/engine.spec.ts tests/e2e/body.spec.ts tests/e2e/faceProtect.spec.ts tests/e2e/home.spec.ts tests/e2e/update.spec.ts tests/e2e/parity.spec.ts`
Expected: no output (existing app specs untouched; `editor.spec.ts:108-109` still exports 1000 × 1500).
Run: `git diff STEP3_BASE -- tests/e2e/settings.spec.ts tests/e2e/reshape.spec.ts | grep -E '^-[^-]'`
Expected: no output (only added tests).
Run: `git diff STEP3_BASE -- 'src/**/*.test.ts' 'src/**/*.test.tsx' | grep -E '^-[^-]'`
Expected: only these intended lines: the `RESHAPE_FS` hash pin in `reshapeCpu.test.ts` (C §8.2); import lines that only gained names (`exporter.test.ts`, `importer.test.ts`, `reshape.test.ts`, `panelModel.test.ts`, `editorModel.test.ts`, …); `PhotoParams` literals in step 1's `src/edit/*.test.ts` that only gained `geometry: IDENTITY_GEOMETRY` (Task 3's mechanical port); the `Prefs` literal of `settings.test.ts`'s round-trip test (two added fields); and the `index.test.ts` fakes (`fakeCanvas` gl / pipeline mock gained members). Anything else is an assertion change: revert it and fix the code instead.

- [ ] **Step 4: Constraints**

Run: `node -p "require('./package.json').version"`
Expected: `0.3.0`.
Run: `git diff --exit-code STEP3_BASE -- package.json package-lock.json`
Expected: exit 0 (no dependency change).
Run (CRLF files keep CRLF on every line; `git ls-files --eol` reads the working tree, so it sees what `git diff` normalizes away):

```bash
git ls-files --eol -- src/types.ts src/engine/index.ts src/engine/pipeline.ts src/engine/passes/mask.ts src/engine/passes/makeup.ts src/engine/passes/reshape.test.ts src/media/importer.ts src/media/importer.test.ts src/app/testFakes.ts src/ui/app.tsx src/ui/deps.ts src/ui/state.ts src/ui/flows.ts src/ui/screens/Home.tsx src/ui/components/Slider.tsx src/ui/panelModel.ts src/ui/components/BeautyPanel.tsx src/ui/screens/zoomPan.ts src/ui/components/HeightBandOverlay.tsx src/ui/theme.css src/ui/icons.tsx src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/bench/main.ts | awk '$2 != "w/crlf" { print "NOT CRLF:", $NF }'
git ls-files --eol | awk '$2 == "w/mixed" && $NF != "tests/harness/t1/harness.ts" { print "MIXED:", $NF }'
```

Expected: no output from either (`tests/harness/t1/harness.ts` was already mixed at `1f0273d`; this plan does not touch it).
Run: `git status --short && git log --oneline STEP3_BASE..HEAD`
Expected: a clean tree, the plan-reconcile commit and one local commit per task (Tasks 1–19, plus any `task <N> fix` commits); `git status -sb` shows the branch ahead of its upstream — nothing was pushed.

- [ ] **Step 5: Record the gate**

If any step failed, fix it in the owning task's files, re-run that task's tests and this gate from Step 1, and commit the fix:

```bash
git commit -am "$(cat <<'EOF'
v0.4 step 3: gate fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

The step is done when Steps 1–4 pass in one run without changes in between.
