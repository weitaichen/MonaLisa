# v0.4 Step 2: 調節第一批 + 一鍵質感 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the photo-level 調節 tab (12 items: 亮度 · 曝光 · 對比 · 高光 · 陰影 · 色溫 · 色調 · 飽和 · 鮮艷度 · 褪色 · 顆粒 · 暗角) and the 一鍵 › 質感 looks (膠片 · CCD · 直閃 · 藍調 · 電影感) to the editor and the live camera, saved with history and undoable, with v0.3-equivalent output whenever they are unused.

**Architecture:** The 12 values and the look live in `EditState.photo` (step 1's param model). All new pixel work happens inside P5 composite, after the 濾鏡 LUT: a second composite program variant `compositeFs({adjust: true})` adds the 質感 LUT (texture unit 8) and `adjustStage()`; it is compiled lazily and only frames with a non-neutral 調節 value or a drawable look use it, so every other frame runs the step-1 composite text unchanged (hash-pinned). Every constant lives in TypeScript (`src/engine/adjustMath.ts`), which is also the CPU reference (`compositeCpu.ts`), the look-thumbnail grader (`scripts/gen-luts.mjs`) and the uniform builder. The engine's filter-LUT cache becomes one LRU cache for `filter` and `look` LUTs (6 resident textures).

**Tech Stack:** Vite 8, TypeScript 5.9, Preact 10, WebGL2 (GLSL ES 3.00), Vitest 5 (`npm test`), Playwright 1.63 (`npx playwright test <spec>`), Node v24 (type stripping for `scripts/gen-luts.mjs` importing `.ts`), pngjs 7.

**Spec:** `docs/superpowers/specs/2026-10-12-adjust-and-looks-design.md` (called **S** below). Contract: `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (called **C**; accepted, every §12 question at its recommended default). Names consumed from step 1: `docs/superpowers/specs/2026-10-12-face-person-select-design.md` (called **S1**).

## Reconciliation (step 2)

Checked against the code at `9eec432` (step 1 fully committed, its follow-ups included; `npm run typecheck` is green there). Every step-1 name in the table below exists with the shape this plan assumed (`ParamDef.scope/live`, `PhotoParamId`, `RenderInput`, `lensFor` / `Lens`, `itemsFor` / `activate` / `sliderFor` / `tabHasValue`, `SliderBinding`, `LiveDeps.getLook`, `loadLook` / `LOOK_KEY`, v2 history), and the line endings listed under Global Constraints were re-verified. These edits were made:

- **Line anchors** of every task were moved to `9eec432` (types, params, composite, pipeline, index, still, live, testFakes, t7 fakes, panelModel, BeautyPanel, Slider, Editor, Camera, bench). `gen-luts.mjs`, `assets.test.mjs`, `NOTICE.txt`, `Settings.tsx`, `icons.tsx` and `theme.css` anchors already matched.
- **Step-1 names table:** `StillFrame` lives in `src/types.ts` (still.ts only imports it); `LiveDeps` also has a required `getAll()`; `FakeEngine` is at `t7/fakes.ts:90`; the photo-scope rule and the first-touch toasts are step 1's `photoScoped`, `personNote`, `photoTouchToast`, `tapToast` and `sliderEmptyText` in `src/ui/panelModel.ts` (Editor / BeautyPanel only call them), and the face boxes / photo taps are gated by `PERSON_TABS` (`src/ui/editorModel.ts:535`); `BeautyPanel` has the extra prop `photoTouched?`.
- **Task 3:** `settings.test.ts` already imports `loadLook`, `LOOK_KEY`, `PARAMS_KEY`, `PARAM_DEFS`, `applyPreset`; `history.test.ts` already imports `EditState` and has an `../edit/state` import to extend.
- **Task 6:** the local `shaderHash` of `reshapeCpu.test.ts` is at `:19-27`; the step-1 composite measured `0cc1e52b` at `9eec432` (re-measure in Step 1 all the same).
- **Task 7:** `run()` plans through step 1's `planFrame(job, makeupReady, bodyOn)`, so `adjustOn` is added there (its `job` type gains `adjust: { on: boolean }`) and the three `planFrame` tests are ported with the `planPasses` ones.
- **Task 11:** the still test imports `StillFrame` from `../types`; both new live tests pass `getAll: () => false` (required by `LiveDeps`; without it `step()` throws before drawing); `render` / `exportImageData` name their frame `f`; `imaging.ts` already has a `../types` type import to extend.
- **Task 12:** step 1 keeps the photo-level rules in panelModel, so the plan's `firstTouchLabel` (meant for Editor code that does not exist) is replaced by teaching step 1's `photoScoped`, `personNote`, `photoTouchToast`, `TILE_ITEMS` and `sliderEmptyText` the 調節 tab and 一鍵 › 質感 (one new test); the two new sliders go through step 1's `decorate` (photo form with ≥ 2 persons; unchanged with one person, so the dispatch test's `'look.film'` stands).
- **Task 13:** the 美妝 part dot keeps step 1's `partHasValue(lens, part)` (under 全部: any face person's), not `lens.shade(part).on`; the strip's person note is skipped on 調節 and 一鍵 › 質感 (S §2.2 "no per-person strip notes").
- **Task 14:** Editor Step 4 is rewritten for the real step-1 code: the chip dimming and both toasts come from Task 12; Editor only hides the face boxes and photo taps on the two photo-level tabs (`PERSON_TABS.has(sel.tab) && !photoTabLabel(sel)`, as 濾鏡 already is).
- **Task 16:** the 調節效能 output box uses its own class `adjust-note` (step 1's bench test and `tests/harness/t8/run-bench.mjs` require `.gate .note` to be unique).
- **Task 17:** `BASE` is the step base commit `9eec432` (the workflow's messages read `v0.4 step 2 task <N>: …`, which `--grep='^v0.4 step 2:'` would not find).
- **Commits:** the `git commit -m "v0.4 step 2: …"` lines show each task's file list and intent; the workflow's own message format (`v0.4 step 2 task <N>: <title>`, fixes `v0.4 step 2 task <N> fix: …`, written to a file and committed with `git commit -F`) replaces them. Task 9's second paragraph (the tuning-sheet path) goes into that message's body.

## Global Constraints

- Branch `feat/meiyan-pwa`; commits are LOCAL ONLY (never `git push`, never deploy). Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `package.json` `"version"` stays `0.3.0` (step 6's release task bumps it). No new npm dependency (S §4.8). MediaPipe stays `0.10.35`; CSP stays `connect-src 'self'`.
- Line endings: files keep their existing endings. CRLF files touched here (re-verified at `9eec432`; re-check with `file <path>` before editing): `src/types.ts`, `src/ui/panelModel.ts`, `src/engine/shaders/composite.ts`, `src/engine/pipeline.ts`, `src/engine/index.ts`, `src/app/live.ts`, `src/app/live.test.ts`, `src/app/testFakes.ts`, `src/ui/components/BeautyPanel.tsx`, `src/ui/components/Slider.tsx`, `src/ui/screens/Camera.tsx`, `src/ui/icons.tsx`, `src/ui/theme.css`, `scripts/gen-luts.mjs`, `src/bench/main.ts`. Edit them with the Edit tool (never rewrite a CRLF file with Write); after each task run `git diff --numstat` and confirm no file shows a whole-file rewrite. New files are LF (`.gitattributes`: `* text=auto eol=lf`).
- `npm run typecheck` is `tsc --noEmit` over `src` **and** `tests` (`tsconfig.json:20`), harnesses included: a change to a shared type (`Engine`, `PhotoParams`, `PanelSelection`, `ParamId`) ports `tests/harness/**` and `tests/e2e/pages/**` in the same commit (`tests/harness/t7/fakes.ts` has `class FakeEngine implements Engine`). The gitignored, generated `tests/harness/b2/baseline/` is never edited: if a stale copy on disk fails typecheck, delete the directory (`rm -rf tests/harness/b2/baseline`; `make-baseline.mjs` regenerates it).
- Tabs: the editor and the camera both get 7 tabs `一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節` (C §2.1, §2.4). No 9th tab may ever be added (C §2.1).
- Naming: this step's code says `adjust` (`adjustMath.ts`, `ADJUST_GLSL`, `adjustStage()`, `uAdjustOn`), never `tone` (step 4 owns `tone.*`) (S §1.4 "Naming").
- Invariant (C §1.1, S §1.3): with every 調節 item neutral and no drawable look, the frame is drawn by the base composite program, whose text equals step 1's (`shaderHash` pin) — parity goldens (`tests/e2e/parity.spec.ts`) stay ≤ 1/255 max, mean < 0.02/255.
- Values: bidirectional items show −50…+50 (neutral 0.5), one-way items (褪色, 顆粒, 暗角) show 0–100 (neutral 0). Shader space: `s = (v − 0.5)·2`, `v` (C §4.4). 暗角 darkens only (C §12 #14).
- Looks: `defaultAmount` 0.8 for every look (C §12 #10); 濾鏡 and 質感 stack, 濾鏡 first (C §12 #8); both 「膠片」 labels kept (C §12 #9); a look's 顆粒／褪色／暗角 add on top of the user's values, sliders show the user's own value (C §12 #13); a look is all-or-nothing: while its LUT is not resident neither the LUT nor its offsets draw (S §1.4).
- Grain: cell = `fullShortEdge/1080` output px, indexed in global V coordinates; seed 0 in the editor, its exports and thumbnails; the camera passes a frame counter (moving grain, C §12 #11); camera 調節 and 質感 persist under `meiyan.look.v1` and imports start from the camera look (C §12 #12).
- GPU resources: look LUT = 512² RGBA8 on texture unit 8 (9 composite units in the 調節 program); `MAX_RESIDENT_LUTS = 6` for filters and looks together (S §3.5).
- Assets: `public/luts/looks/look_<id>.png` (512², GPUImage 64³ layout, opaque RGB, only IHDR/IDAT/IEND) and `look_<id>_thumb.png` (96²), generated by `node scripts/gen-luts.mjs` (Node ≥ 22.18; repo Node v24.13.0). Original work: no third-party LUT, `.cube`, profile, app preset or SDK bitmap; no brand names (S §4.8).
- Copy (exact strings, S §2.4): tab 調節; items 亮度 · 曝光 · 對比 · 高光 · 陰影 · 色溫 · 色調 · 飽和 · 鮮艷度 · 褪色 · 顆粒 · 暗角; reset item 原圖; 一鍵 parts 美顏 / 質感; looks 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感; slider 程度; lead chip 質感：{label}; first touch 調節套用於整張照片 / 質感套用於整張照片; LUT failure 無法載入「{label}」質感，請稍後再試; compile failure 調節效果暫時無法使用; credits 「濾鏡與質感 LUT、色號與圖示為本專案原創」.
- The user pre-authorized execution without approval stops: the S §3.7 "show the preview sheet to the user before 2e" is satisfied by generating `tests/harness/t5/previews/looks.png` in Task 9 and naming it in that commit's message; execution does not wait.

## Review Focus

1. **The grain hash on an iPhone GPU**: the composite declares only `precision highp float`, so an unqualified `uint` / `ivec2` in the 調節 GLSL is `mediump`, which GLSL ES 3.00 lets a GPU run in 16 bits; the iPhone preview, export and thumbnails would then show a different (and possibly periodic) grain from the CPU port. Every integer declaration must be `highp` (S §4.4: "`highp uint` … wrapping is defined"). Tests: Task 6 (a tripwire: every integer declaration of `ADJUST_GLSL` is `highp`), Task 16 (the bench probe runs `GRAIN_HASH_GLSL` with no default int precision and must be bit-exact against `lowbias32`).
2. **Camera before its first video frame, or a degenerate picture frame** (`videoWidth = 0`, a zero-width or NaN `pictureFrame`): the vignette and grain must fall back to the whole frame, never NaN (a black preview). Tests: Task 5 (`frameFor` with degenerate rects), Task 11 (`normalizedCropRect(0, 0, r)`).
3. **A stored camera look or history `edit` written by a step-1 build** (no `look` key, no `adjust.*` keys) **or holding junk** (unknown look id, NaN amount, string values): it must open with neutral 調節 and `look: null`. Tests: Task 3.
4. **A WebGL context loss while a look is on** (iOS backgrounding): after the restore the look must come back on the next frame without user action — the cache entry is dropped, not marked failed. Test: Task 8 (Task 8 also pins that a look re-requested while it loads is fetched once).
5. **The 調節 program failing to compile on a device**: the base program keeps drawing (no 調節, no 質感), the failure is flagged once, never retried until the next context restore, and the UI says 「調節效果暫時無法使用」 once. Tests: Task 7 (program choice), Task 14 (notice hook).

## Where this plan refines the spec

Each point was measured or forced while writing the plan; the reviewer should check that the reason holds.

1. `LOOKS` / `lookDef` are imported from `src/engine/looks.ts`, not re-exported from `params.ts` (S §3.6): a runtime re-export would make `params.ts` unloadable under Node type stripping, which `tests/harness/t5/preview-luts.mjs` relies on.
2. The composite "no jump" check (S §8.3) allows max ≤ 2 levels, mean ≤ 0.5, instead of ≤ 1: the CPU reference itself moves saturated colours by up to 2 levels at +1 display unit of 亮度 (luma gamma × hue-safe scaling). Continuity is pinned more tightly in Task 5: ±0.1 display unit of every item moves no 8-bit colour by more than 1 level.
3. The 鮮艷度 skin-guard test (S §8.1) asserts that skin gains at most 50 % of an equal-S/V non-skin hue; "< 40 %" is unreachable with the guard 0.6 (its best case is exactly 40 %). The 飽和 +50 "does not clip a 70 %-saturated colour" test uses (0.5, 0.3, 0.15); the formula does clip some other 70 % colours.
4. The `ADJUST_FAST` define and the 調節 pre-warm (S §6.1 fallbacks 2–3) are conditional on iPhone measurements (preview deploy only with the user's go-ahead) and are not built here.
5. The bench row times a synthetic 1080 × 1920 frame; the live-camera-frame variant of S §6.4 is left to an iPhone session with the camera running.
6. The tuning sheet is three files (`looks.png` face, `looks_swatch.png`, `looks_chart.png`) rather than one; it is generated, not waited on (pre-authorized execution).

---

## Step-1 names this plan consumes

Step 1 is implemented before this plan runs (its plan: `docs/superpowers/plans/2026-10-12-v04-step1-face-person-select.md`). The names below come from its spec and, where noted, its plan; tasks cite them in **Consumes**. Before each task that edits step-1 code, run the task's **Step 0** grep. If the implemented step 1 named something differently, use its name and keep this plan's behaviour (the tests describe the behaviour).

| Name (as defined by C §3.2–3.3 and S1 §3.2–3.4) | Where | Used in |
|---|---|---|
| `PhotoParams`, `PersonParams`, `EditState`, `Selection`, `CameraLook`, `PhotoParamId`, `Rect {x, y, w, h}`, `RenderInput {source, width, height, faces, obstacles?, globalSkin, photo, body?}`, `ParamDef.scope/live` | `src/types.ts` | 1, 3, 5, 8, 10, 11 |
| `defaultPhoto()`, `sanitizePhoto(raw, persons)`, `PHOTO_IDS`, `neutralPerson()`, `naturalPerson()`, `sanitizeEditState(raw, personIds \| null)`, `editKey(edit)` | `src/edit/state.ts` | 3, 10, 12, 16 |
| `splitLegacy(p) → {photo, person}`, `legacyProjection(edit, primary)` | `src/edit/legacy.ts` | 3 |
| `lensFor(edit, sel, persons, primary, opts?): Lens` with `readonly edit`, `get(id) → {value, mixed}`, `set`, `applyPreset`, `setFilter(filterId)`, `resetGroup`, `reset()` (重置 → `resetAll`), `shade(part)`; `PersonInfo {id, face, body}`, `P0_INFO` | `src/edit/lens.ts` | 3, 12, 13 |
| the step-1 unit assertions that list the photo-level ids literally: `src/edit/state.test.ts` 'scope table' (`[...PHOTO_IDS].sort()`), `src/edit/legacy.test.ts` 'splits photo items …' (`Object.keys(photo.values).sort()`) | `src/edit/*.test.ts` (step-1 plan Task 4) | 1 |
| `class FakeEngine implements Engine` (the T7 visual harness) | `tests/harness/t7/fakes.ts:90` | 8 |
| `itemsFor(lens, sel, body?)`, `activate(item, lens, sel)` → `ActivateResult {edit, sel, changed, notice?}` (local `done(next = edit, nextSel = sel, notice?)`), `sliderFor(lens, sel, body?)` (≥ 2 persons: wrapped by the local `decorate(b, lens, photo)`), `tabHasValue(lens, tab, body?)`, `SliderBinding {key, param, label, aria?, bidirectional, value, mixed, defaultValue, apply(lens, v) → EditState}`; `BeautyPanel` props `{lens, sel, onSel, onEdit, collapsed?, faceNote?, body?, photoTouched?, id?}` | `src/ui/panelModel.ts`, `src/ui/components/BeautyPanel.tsx` (step-1 plan Task 10) | 12, 13 |
| `StillFrame = Omit<RenderInput, 'source' \| 'width' \| 'height' \| 'body'>` (`src/types.ts:432`); `render(frame)`, `prepareExport(frame)`, `exportReady(frame)`, `exportImageData(frame, body?)` | `src/types.ts`, `src/app/still.ts` | 11 |
| `LiveDeps.getLook(): CameraLook` (`live.ts:43`; `getAll(): boolean` is required too), `capture()` returning `{image, seed} \| null` | `src/app/live.ts` | 11, 14 |
| `LOOK_KEY = 'meiyan.look.v1'`, `loadLook(): CameraLook` (step-1 plan Task 11) | `src/store/settings.ts` | 3 |
| `addEntry`/`getEntry` with `schema: 2, edit` | `src/store/history.ts` | 3 |
| the photo-scope rule (A11: `photoScoped(sel, lens)` dims the person chips and the face boxes), `personNote(tab, lens)`, the first-touch toasts 「{label}套用於整張照片」 (`photoTouchToast(b, lens, seen)` for sliders, `tapToast(item, lens, r, seen)` + `TILE_ITEMS` for tiles, keyed in the Editor's `touchedPhoto` set), `sliderEmptyText(lens, sel)`; the face boxes and photo taps show on `PERSON_TABS` only | `src/ui/panelModel.ts`; `PERSON_TABS` in `src/ui/editorModel.ts:535` (used by `src/ui/screens/Editor.tsx:1018, 1060`) | 12, 13, 14 |
| `tests/e2e/parity.spec.ts`, `tests/fixtures/parity-v03/*.png` | e2e | 17 |

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types.ts` | modify | `'adjust'` group, 12 `ParamId`s, `AdjustId`, `LookId`, `LookDef`, `LutKind`, `LutState`; `PhotoParamId` += `adjust.*`; `PhotoParams.look`; `RenderInput.pictureFrame/grainSeed`; `Engine.loadLut/lutState/adjustUnavailable` |
| `src/engine/params.ts` | modify | the 12 `ParamDef`s (photo, live, neutral default) |
| `src/engine/looks.ts` | create | `LOOK_IDS`, `LOOKS`, `lookDef`, `isLookId`, `offsetToShader`, `photoLuts`, `lookThumbUrl` (type-only imports) |
| `src/edit/state.ts`, `src/edit/lens.ts` | modify | `look` in `defaultPhoto`/sanitize; `setLook`, `resetAdjust`, `adjustIsNeutral`, `sanitizePhotoLook`; lens `look()`, `setLook`, `resetGroup('adjust')` |
| `src/engine/adjustMath.ts` | create | `ADJUST_K`, sRGB, tone curve, grain hash, effective values, `frameFor`, `adjustUniforms`, `adjustRgb`, `adjustWanted` (type-only imports) |
| `src/engine/shaders/adjust.ts` | create | `GRAIN_HASH_GLSL`, `ADJUST_GLSL` (uniforms + `adjustStage`) |
| `src/engine/shaders/composite.ts` | modify | `compositeFs({adjust})`, `COMPOSITE_FS = compositeFs({adjust: false})`, `COMPOSITE_UNITS.look = 8` |
| `src/engine/shaderHash.ts` | create | FNV-1a shader hash (moved out of `reshapeCpu.test.ts`) |
| `src/engine/compositeCpu.ts` | create | CPU reference of P5's 質感 + 調節 stages (`lut64Cpu`, `compositeCpu`) |
| `src/engine/compositePrograms.ts` | create | base program + lazily compiled 調節 program, `uploadAdjust` |
| `src/engine/pipeline.ts` | modify | `FrameJob.adjust/lookLut`, `PassPlan.adjust`, program choice, unit 8, unbind 9, `adjustFailed` |
| `src/engine/index.ts` | modify | LUT cache (kinds, LRU 6), `loadLut`, `lutState`, `adjustUnavailable`, `job()` builds `adjust` |
| `scripts/gen-luts.mjs` | modify | `LOOK_IDS`, `LOOK_GRADES`, `gradeLook`, `buildLookThumb`, writes `public/luts/looks/` |
| `public/luts/looks/look_<id>.png`, `look_<id>_thumb.png` | create (generated) | 5 + 5 assets |
| `tests/harness/t5/assets.test.mjs` | modify | look LUT / thumbnail checks |
| `tests/harness/t5/preview-looks.mjs` | create | tuning sheet `previews/looks.png` |
| `LICENSES/NOTICE.txt`, `src/ui/screens/Settings.tsx` | modify | original-work and hash-prospector lines; credits sentence |
| `tests/e2e/pages/composite.{html,ts}`, `tests/e2e/composite.spec.ts` | create | GPU vs `compositeCpu` harness |
| `src/app/still.ts`, `src/app/live.ts`, `src/app/testFakes.ts`, `src/ui/imaging.ts` | modify | `ensureLuts`, `exportReady` via `lutState`; `pictureFrame`, `grainSeed`; fake engine LUT states; `normalizedCropRect` |
| `src/ui/panelModel.ts` | modify | `'adjust'` tab, `PresetPart`, adjust/look items, sliders, activation, dots, parts, lead chip, `photoTabLabel`; step 1's `photoScoped`, `personNote`, `photoTouchToast`, `TILE_ITEMS`, `sliderEmptyText` learn the two photo-level tabs |
| `src/ui/icons.tsx`, `src/ui/components/BeautyPanel.tsx`, `src/ui/components/Slider.tsx`, `src/ui/theme.css` | modify | 13 icons; part row for 一鍵, dividers, lead chip, thumb fallback, retry; slider tints; styles |
| `src/ui/screens/hooks.ts`, `Editor.tsx`, `Camera.tsx` | modify | `useLutLoader`, `requestLut`, `useAdjustFailureNotice`; wiring; no face boxes / photo taps on the photo-level tabs; `getFrame` |
| `tests/e2e/adjust.spec.ts` | create | editor + camera e2e |
| `src/bench/adjustBench.ts`, `src/bench/main.ts`, `tests/e2e/bench.spec.ts` | create/modify | 調節 cost row, grain-hash probe, smoke test |

---

### Task 1: 調節 parameters in the schema

**Files:**
- Modify: `src/types.ts:6` (`ParamGroup`), `src/types.ts:8-34` (`ParamId`), step 1's `PhotoParamId` (`src/types.ts:117`, C §3.2), new type exports after `ParamDef` (`src/types.ts:38-53`)
- Modify: `src/engine/params.ts:4-38` (`PARAM_DEFS`, after the 美妝 entries)
- Test: `src/engine/params.adjust.test.ts` (create); `src/engine/params.test.ts`, step 1's `src/edit/state.test.ts` and `src/edit/legacy.test.ts` (mechanical ports of the counts and photo-id lists)

**Interfaces:**
- Consumes: step 1's `ParamDef` fields `scope: 'photo' | 'person'` and `live: boolean`; step 1's `PhotoParamId` (S1 §3.2: `Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs'>`); step 1's scope-table unit test.
- Produces:
  - `type ParamGroup = 'skin' | 'shape' | 'body' | 'filter' | 'makeup' | 'adjust'`
  - 12 `ParamId`s `'adjust.brightness' … 'adjust.vignette'` (order below)
  - `type AdjustId = Extract<ParamId, \`adjust.${string}\`>`
  - `type PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs' | \`adjust.${string}\`>`
  - `type LookId = 'film' | 'ccd' | 'flash' | 'blue' | 'cinema'`
  - `interface LookDef { id: LookId; label: string; defaultAmount: number; offsets: Readonly<Partial<Record<AdjustId, number>>> }`
  - `type LutKind = 'filter' | 'look'`; `type LutState = 'none' | 'loading' | 'ready' | 'failed'`
  - `paramsInGroup('adjust')` returns the 12 defs in strip order.

- [x] **Step 0: Confirm the step-1 shapes**

Run: `grep -n "PhotoParamId\|scope:\|live:\|LookId" src/types.ts | head -20`
Expected: `PhotoParamId` defined as in S1 §3.2; `ParamDef` has `scope` and `live`. If step 1 already declared `LookId` (C §3.2 lists it), do not declare it twice in Step 3.

- [x] **Step 1: Write the failing test**

Create `src/engine/params.adjust.test.ts`:

```ts
// 調節 params (v0.4 step-2 spec §3.1): 12 photo-level, live items, neutral by default, outside every preset.
import { describe, expect, it } from 'vitest';
import type { AdjustId, ParamId, PhotoParamId } from '../types';
import { neutralValue, PARAM_DEFS, paramDef, paramsInGroup, PRESETS } from './params';

const ADJUST: AdjustId[] = [
  'adjust.brightness',
  'adjust.exposure',
  'adjust.contrast',
  'adjust.highlights',
  'adjust.shadows',
  'adjust.temperature',
  'adjust.tint',
  'adjust.saturation',
  'adjust.vibrance',
  'adjust.fade',
  'adjust.grain',
  'adjust.vignette',
];
const ONE_WAY: AdjustId[] = ['adjust.fade', 'adjust.grain', 'adjust.vignette'];

describe('調節 params (step-2 spec §3.1)', () => {
  it('are the 12 items of the strip, in strip order, with their labels and icons', () => {
    const defs = paramsInGroup('adjust');
    expect(defs.map((d) => d.id)).toEqual(ADJUST);
    expect(defs.map((d) => d.label)).toEqual(['亮度', '曝光', '對比', '高光', '陰影', '色溫', '色調', '飽和', '鮮艷度', '褪色', '顆粒', '暗角']);
    expect(defs.map((d) => d.icon)).toEqual([
      'brightness', 'exposure', 'contrast', 'highlights', 'shadows', 'temperature',
      'tint', 'saturation', 'vibrance', 'fade', 'grain', 'vignette',
    ]);
  });

  it('are photo-level, live, neutral by default; only 褪色 / 顆粒 / 暗角 are one-way', () => {
    for (const id of ADJUST) {
      const d = paramDef(id);
      expect(d).toMatchObject({ group: 'adjust', scope: 'photo', live: true });
      expect(d.bidirectional).toBe(!ONE_WAY.includes(id));
      expect(d.default).toBe(neutralValue(d));
    }
  });

  it('sit outside every beauty preset (C §3.4): each preset holds the neutral value', () => {
    for (const p of PRESETS) for (const id of ADJUST) expect(p.values[id], `${p.id} ${id}`).toBe(neutralValue(paramDef(id)));
  });

  it('PhotoParamId covers adjust.* (type-level check, compiled by npm run typecheck)', () => {
    const ids: PhotoParamId[] = ADJUST;
    const all: ParamId[] = ids;
    expect(all).toHaveLength(12);
    expect(PARAM_DEFS.filter((d) => d.group === 'adjust')).toHaveLength(12);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/params.adjust.test.ts`
Expected: FAIL — `paramsInGroup('adjust')` returns `[]` (and `npm run typecheck` reports `"adjust"` not assignable to `ParamGroup`).

- [x] **Step 3: Add the types**

In `src/types.ts` change line 6 to:

```ts
export type ParamGroup = 'skin' | 'shape' | 'body' | 'filter' | 'makeup' | 'adjust';
```

Append to the `ParamId` union (after `| 'makeup.blush'`, keeping its `;` on the last member):

```ts
  | 'makeup.blush'
  // 調節 (v0.4 step 2): photo-level, live, neutral by default, outside every beauty preset
  | 'adjust.brightness'
  | 'adjust.exposure'
  | 'adjust.contrast'
  | 'adjust.highlights'
  | 'adjust.shadows'
  | 'adjust.temperature'
  | 'adjust.tint'
  | 'adjust.saturation'
  | 'adjust.vibrance'
  | 'adjust.fade'
  | 'adjust.grain'
  | 'adjust.vignette';
```

Replace step 1's `PhotoParamId` with C §3.2's form:

```ts
export type PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs' | `adjust.${string}`>;
```

Add after the `ParamDef` interface:

```ts
/** the 12 調節 items (v0.4 step-2 spec §3.1) */
export type AdjustId = Extract<ParamId, `adjust.${string}`>;

/** 一鍵 › 質感 looks (v0.4 roadmap §3.2) */
export type LookId = 'film' | 'ccd' | 'flash' | 'blue' | 'cinema';

export interface LookDef {
  id: LookId;
  /** 膠片 · CCD · 直閃 · 藍調 · 電影感 */
  label: string;
  /** 程度 when the look is picked from 無 (0..1) */
  defaultAmount: number;
  /** at 程度 100, in display units (−50…+50 bidirectional, 0–100 one-way); scaled by 程度 in shader space */
  offsets: Readonly<Partial<Record<AdjustId, number>>>;
}

/** engine LUT kinds: 濾鏡 /luts/filters/<id>.png, 質感 /luts/looks/look_<id>.png */
export type LutKind = 'filter' | 'look';
/** none = not resident (never asked, or evicted / dropped with a lost context) */
export type LutState = 'none' | 'loading' | 'ready' | 'failed';
```

- [x] **Step 4: Add the 12 defs**

In `src/engine/params.ts`, after the `makeup.blush` entry of `PARAM_DEFS` (line 37), add (the `scope`/`live` fields are step 1's; keep the field order step 1 uses for the other entries):

```ts
  // 調節 — photo-level and live; neutral by default and never part of a beauty preset (step-2 spec §3.1)
  { id: 'adjust.brightness', label: '亮度', group: 'adjust', bidirectional: true, default: 0.5, icon: 'brightness', scope: 'photo', live: true },
  { id: 'adjust.exposure', label: '曝光', group: 'adjust', bidirectional: true, default: 0.5, icon: 'exposure', scope: 'photo', live: true },
  { id: 'adjust.contrast', label: '對比', group: 'adjust', bidirectional: true, default: 0.5, icon: 'contrast', scope: 'photo', live: true },
  { id: 'adjust.highlights', label: '高光', group: 'adjust', bidirectional: true, default: 0.5, icon: 'highlights', scope: 'photo', live: true },
  { id: 'adjust.shadows', label: '陰影', group: 'adjust', bidirectional: true, default: 0.5, icon: 'shadows', scope: 'photo', live: true },
  { id: 'adjust.temperature', label: '色溫', group: 'adjust', bidirectional: true, default: 0.5, icon: 'temperature', scope: 'photo', live: true },
  { id: 'adjust.tint', label: '色調', group: 'adjust', bidirectional: true, default: 0.5, icon: 'tint', scope: 'photo', live: true },
  { id: 'adjust.saturation', label: '飽和', group: 'adjust', bidirectional: true, default: 0.5, icon: 'saturation', scope: 'photo', live: true },
  { id: 'adjust.vibrance', label: '鮮艷度', group: 'adjust', bidirectional: true, default: 0.5, icon: 'vibrance', scope: 'photo', live: true },
  { id: 'adjust.fade', label: '褪色', group: 'adjust', bidirectional: false, default: 0, icon: 'fade', scope: 'photo', live: true },
  { id: 'adjust.grain', label: '顆粒', group: 'adjust', bidirectional: false, default: 0, icon: 'grain', scope: 'photo', live: true },
  { id: 'adjust.vignette', label: '暗角', group: 'adjust', bidirectional: false, default: 0, icon: 'vignette', scope: 'photo', live: true },
```

`PRESETS` builds its `values` from `neutralValues()` / `defaultValues()` over `PARAM_DEFS` (`params.ts:87-97`), so every preset gets the neutral adjust values without further edits.

- [x] **Step 5: Port the schema assertions that count params (mechanical, C §1.1)**

Run: `grep -n "toHaveLength(26)\|toBe(26)\|GROUPS: ParamGroup\|const BIDIRECTIONAL\|'makeup.blush': 0," src/engine/params.test.ts`
In `src/engine/params.test.ts` (wherever step 1 left these assertions):
- `toHaveLength(26)` and `.size).toBe(26)` → `38`; the test title "has the 26 params (16 face/colour + 10 美體)" → "has the 38 params (16 face/colour + 10 美體 + 12 調節)".
- `const GROUPS: ParamGroup[] = ['skin', 'shape', 'body', 'filter', 'makeup'];` → append `'adjust'`.
- `const BIDIRECTIONAL: ParamId[]` → append `'adjust.brightness', 'adjust.exposure', 'adjust.contrast', 'adjust.highlights', 'adjust.shadows', 'adjust.temperature', 'adjust.tint', 'adjust.saturation', 'adjust.vibrance'`; its title gains "and the 9 bidirectional 調節 items".
- the `expected: Record<ParamId, number>` defaults table → after `'makeup.blush': 0,` add the 12 lines `'adjust.brightness': 0.5, 'adjust.exposure': 0.5, 'adjust.contrast': 0.5, 'adjust.highlights': 0.5, 'adjust.shadows': 0.5, 'adjust.temperature': 0.5, 'adjust.tint': 0.5, 'adjust.saturation': 0.5, 'adjust.vibrance': 0.5, 'adjust.fade': 0, 'adjust.grain': 0, 'adjust.vignette': 0,`.
- Step 1's tests that list the photo-level ids literally (the scope table of C §3.1 now has 16 photo ids). Find them with `grep -rnF "'body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten'" src --include=*.test.ts`; at minimum `src/edit/state.test.ts` ('scope table (RM §3.1, step-1 subset)': `expect([...PHOTO_IDS].sort()).toEqual([…])`) and `src/edit/legacy.test.ts` ('splits photo items to the photo and the rest to the person': `expect(Object.keys(photo.values).sort()).toEqual([…])`). In each, replace the 4-id array literal with the sorted 16-id list:
  ```ts
  [
    'adjust.brightness', 'adjust.contrast', 'adjust.exposure', 'adjust.fade', 'adjust.grain', 'adjust.highlights',
    'adjust.saturation', 'adjust.shadows', 'adjust.temperature', 'adjust.tint', 'adjust.vibrance', 'adjust.vignette',
    'body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten',
  ]
  ```
  (the person-side assertions next to them — `person.filter((id) => id.startsWith('body.'))` has length 9, `live` is `group !== 'body'` — hold unchanged, because every adjust def is `scope: 'photo'`, `live: true`).

- [x] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/engine/params.adjust.test.ts src/engine/params.test.ts src/edit && npm run typecheck`
Expected: PASS, and `tsc` exits 0. If `tsc` reports a `Record<ParamId, …>` or `Record<PhotoParamId, …>` literal that now misses the adjust keys, fill those keys with the neutral value (0.5 bidirectional, 0 one-way) in that literal. (`PhotoParams` has no `look` field yet: Task 3 adds it, so `defaultPhoto()` / `splitLegacy` compile unchanged here.)

- [x] **Step 7: Run the whole unit suite**

Run: `npm test`
Expected: PASS (the new defs are neutral and photo-level, so no render or panel changes).

- [x] **Step 8: Commit**

```bash
git add src/types.ts src/engine/params.ts src/engine/params.adjust.test.ts src/engine/params.test.ts
git add -u src
git commit -m "v0.4 step 2: 調節 params in the schema (12 photo-level, live, neutral items)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The 質感 look table

**Files:**
- Create: `src/engine/looks.ts`
- Test: `src/engine/looks.test.ts`

**Interfaces:**
- Consumes: `LookDef`, `LookId`, `LutKind`, `ParamDef` (Task 1); `PARAM_DEFS`, `paramDef`, `fromDisplay`, `signed` (`src/engine/params.ts:265-272`, test only).
- Produces:
  - `const LOOK_IDS: readonly LookId[]` = `['film', 'ccd', 'flash', 'blue', 'cinema']`
  - `const LOOKS: readonly LookDef[]`
  - `function lookDef(id: string): LookDef | null`
  - `function isLookId(id: unknown): id is LookId`
  - `function offsetToShader(def: Pick<ParamDef, 'bidirectional'>, d: number): number`
  - `interface LutRef { kind: LutKind; id: string }`
  - `function photoLuts(photo: { filterId: string; look: { id: string } | null }): LutRef[]`
  - `function lookThumbUrl(id: LookId): string`

- [x] **Step 1: Write the failing test**

Create `src/engine/looks.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromDisplay, paramDef, signed } from './params';
import { isLookId, LOOK_IDS, lookDef, LOOKS, lookThumbUrl, offsetToShader, photoLuts } from './looks';

describe('質感 looks (step-2 spec §3.2)', () => {
  it('5 looks with unique ids and labels in strip order, 程度 0.8 when picked', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(['film', 'ccd', 'flash', 'blue', 'cinema']);
    expect(LOOK_IDS).toEqual(LOOKS.map((l) => l.id));
    expect(LOOKS.map((l) => l.label)).toEqual(['膠片', 'CCD', '直閃', '藍調', '電影感']);
    for (const l of LOOKS) expect(l.defaultAmount).toBe(0.8);
  });

  it('offsets use only 調節 ids and stay inside each item display range', () => {
    for (const l of LOOKS) {
      expect(Object.keys(l.offsets).length).toBeGreaterThan(0);
      for (const [id, o] of Object.entries(l.offsets)) {
        expect(id.startsWith('adjust.'), `${l.id} ${id}`).toBe(true);
        const d = paramDef(id as never);
        if (d.bidirectional) expect(Math.abs(o!)).toBeLessThanOrEqual(50);
        else {
          expect(o!).toBeGreaterThanOrEqual(0);
          expect(o!).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('keeps the C §4.4 starting offsets (the tuning loop may change them only with §8.2 green)', () => {
    expect(lookDef('film')!.offsets).toEqual({
      'adjust.fade': 30, 'adjust.grain': 35, 'adjust.vignette': 20, 'adjust.contrast': -10, 'adjust.saturation': -10, 'adjust.temperature': 8,
    });
    expect(lookDef('flash')!.offsets['adjust.vignette']).toBe(35);
  });

  it('offsetToShader matches the slider mapping: display d → shader value of fromDisplay(d)', () => {
    for (const id of ['adjust.exposure', 'adjust.fade'] as const) {
      const def = paramDef(id);
      for (let d = def.bidirectional ? -50 : 0; d <= (def.bidirectional ? 50 : 100); d++) {
        const v = fromDisplay(def, d);
        expect(offsetToShader(def, d)).toBeCloseTo(def.bidirectional ? signed(v) : v, 12);
      }
    }
  });

  it('lookDef / isLookId reject unknown ids', () => {
    expect(lookDef('nope')).toBeNull();
    expect(isLookId('ccd')).toBe(true);
    expect(isLookId('film ')).toBe(false);
    expect(isLookId(3)).toBe(false);
  });

  it('photoLuts lists the 濾鏡 unless 無, then the 質感', () => {
    expect(photoLuts({ filterId: 'none', look: null })).toEqual([]);
    expect(photoLuts({ filterId: 'warm', look: null })).toEqual([{ kind: 'filter', id: 'warm' }]);
    expect(photoLuts({ filterId: 'film', look: { id: 'film' } })).toEqual([
      { kind: 'filter', id: 'film' },
      { kind: 'look', id: 'film' },
    ]);
    expect(lookThumbUrl('ccd')).toBe('/luts/looks/look_ccd_thumb.png');
  });

  it('has only type imports and no runtime re-exports (scripts/gen-luts.mjs loads it under Node)', () => {
    const src = readFileSync(new URL('./looks.ts', import.meta.url), 'utf8');
    for (const line of src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))) expect(line).toMatch(/^\s*import type\s/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/looks.test.ts`
Expected: FAIL — `Failed to resolve import "./looks"`.

- [x] **Step 3: Write the module**

Create `src/engine/looks.ts`:

```ts
// 一鍵 › 質感 looks (v0.4 step-2 spec §3.2): each look is a LUT (public/luts/looks/look_<id>.png, generated by
// scripts/gen-luts.mjs) plus fixed 調節 offsets, both scaled by 程度. Generic photographic names only.
// `import type` only: scripts/gen-luts.mjs imports this file directly under Node's type stripping (Node ≥ 22.18).
import type { LookDef, LookId, LutKind, ParamDef } from '../types';

export const LOOK_IDS: readonly LookId[] = ['film', 'ccd', 'flash', 'blue', 'cinema'];

/** Offsets at 程度 100 in display units (C §4.4 starting values; S §4.6 tuning loop). */
export const LOOKS: readonly LookDef[] = [
  {
    id: 'film',
    label: '膠片',
    defaultAmount: 0.8,
    offsets: { 'adjust.fade': 30, 'adjust.grain': 35, 'adjust.vignette': 20, 'adjust.contrast': -10, 'adjust.saturation': -10, 'adjust.temperature': 8 },
  },
  {
    id: 'ccd',
    label: 'CCD',
    defaultAmount: 0.8,
    offsets: { 'adjust.exposure': 8, 'adjust.highlights': 15, 'adjust.saturation': 12, 'adjust.temperature': -10, 'adjust.grain': 15, 'adjust.vignette': 10 },
  },
  {
    id: 'flash',
    label: '直閃',
    defaultAmount: 0.8,
    offsets: {
      'adjust.exposure': 10,
      'adjust.contrast': 20,
      'adjust.highlights': 20,
      'adjust.shadows': -15,
      'adjust.vignette': 35,
      'adjust.grain': 10,
      'adjust.temperature': -6,
    },
  },
  {
    id: 'blue',
    label: '藍調',
    defaultAmount: 0.8,
    offsets: { 'adjust.temperature': -25, 'adjust.tint': -5, 'adjust.shadows': 10, 'adjust.saturation': -8, 'adjust.fade': 10, 'adjust.vignette': 15 },
  },
  {
    id: 'cinema',
    label: '電影感',
    defaultAmount: 0.8,
    offsets: { 'adjust.contrast': 12, 'adjust.shadows': -10, 'adjust.vibrance': -10, 'adjust.fade': 12, 'adjust.grain': 12, 'adjust.vignette': 25 },
  },
];

export function lookDef(id: string): LookDef | null {
  return LOOKS.find((l) => l.id === id) ?? null;
}

export function isLookId(id: unknown): id is LookId {
  return typeof id === 'string' && (LOOK_IDS as readonly string[]).includes(id);
}

/** Display-unit offset → shader space: −50…+50 → −1…1, 0–100 → 0…1 (step-2 spec §4.3). */
export function offsetToShader(def: Pick<ParamDef, 'bidirectional'>, d: number): number {
  return def.bidirectional ? d / 50 : d / 100;
}

export interface LutRef {
  kind: LutKind;
  id: string;
}

/** The LUTs a photo draws with: its 濾鏡 (unless 無), then its 質感. */
export function photoLuts(photo: { filterId: string; look: { id: string } | null }): LutRef[] {
  const out: LutRef[] = [];
  if (photo.filterId !== 'none') out.push({ kind: 'filter', id: photo.filterId });
  if (photo.look) out.push({ kind: 'look', id: photo.look.id });
  return out;
}

export function lookThumbUrl(id: LookId): string {
  return `/luts/looks/look_${id}_thumb.png`;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/looks.test.ts && npm run typecheck`
Expected: PASS (7 tests); `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/engine/looks.ts src/engine/looks.test.ts
git commit -m "v0.4 step 2: 質感 look table (5 looks, offsets, LUT refs)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 質感 and 調節 in the edit state, the lens and persistence

**Files:**
- Modify: `src/types.ts` (step 1's `PhotoParams`: add `look`)
- Modify: `src/edit/state.ts` (`defaultPhoto`, `sanitizePhoto`, new `setLook`, `resetAdjust`, `adjustIsNeutral`, `sanitizePhotoLook`)
- Modify: `src/edit/legacy.ts` (`splitLegacy`: a v1 record has no 質感 → `look: null`)
- Modify: `src/edit/lens.ts` (`Lens.look()`, `Lens.setLook`, `Lens.resetGroup('adjust')`)
- Test: `src/edit/adjust.test.ts` (create); append to `src/store/settings.test.ts` and `src/store/history.test.ts`

**Interfaces:**
- Consumes: Task 1 (`AdjustId`, `LookId`, adjust defs); Task 2 (`isLookId`, `lookDef`); step 1's `EditState`, `PhotoParams`, `defaultPhoto()`, `naturalPerson()`, `neutralPerson()`, `sanitizeEditState(raw, personIds | null)`, `editKey(edit)`, `splitLegacy(p)`, `legacyProjection(edit, primary)`, `lensFor(edit, sel, persons, primary)` with `get/set/applyPreset/setFilter/resetGroup/reset`; step 1's `loadLook()`/`LOOK_KEY` (`meiyan.look.v1`) in `src/store/settings.ts`; step 1's v2 `addEntry`/`getEntry`.
- Produces:
  - `PhotoParams.look: { id: LookId; amount: number } | null` (C §3.2)
  - `setLook(edit: EditState, id: LookId | null, amount: number): EditState`
  - `resetAdjust(edit: EditState): EditState`
  - `adjustIsNeutral(photo: Pick<PhotoParams, 'values'>): boolean`
  - `sanitizePhotoLook(raw: unknown): PhotoParams['look']`
  - `Lens.look(): PhotoParams['look']`; `Lens.setLook(id: LookId | null, amount: number): EditState`; `Lens.resetGroup('adjust')` = `resetAdjust(edit)`

- [x] **Step 0: Confirm the step-1 names**

Run: `grep -n "export function \(defaultPhoto\|sanitizePhoto\|neutralPerson\|naturalPerson\|sanitizeEditState\|editKey\|splitLegacy\|legacyProjection\|lensFor\)" -r src/edit; grep -n "export interface Lens\|resetGroup(group\|const lens: Lens" src/edit/lens.ts; grep -n "LOOK_KEY\|export function loadLook" src/store/settings.ts`
Expected (step-1 plan, Tasks 4–6 and 11): `defaultPhoto`, `sanitizePhoto`, `neutralPerson`, `naturalPerson`, `sanitizeEditState(raw, personIds)` and `editKey` in `src/edit/state.ts`; `splitLegacy`, `legacyProjection` in `src/edit/legacy.ts`; the `Lens` interface (with `readonly edit`) and `const lens: Lens = { … }` inside `lensFor` in `src/edit/lens.ts`, without `look`/`setLook`; `LOOK_KEY` and `loadLook()` in `src/store/settings.ts` (whose own `sanitizeLook(raw): CameraLook` is why this task names its function `sanitizePhotoLook`). If the v1 helpers `defaultParams`/`applyPreset` moved out of `src/engine/params.ts`, import them from where they now live.

- [x] **Step 1: Write the failing tests**

Create `src/edit/adjust.test.ts`:

```ts
// 質感 and 調節 in the edit model (step-2 spec §3.3–3.4, §5; C §3.3–3.4).
import { describe, expect, it } from 'vitest';
import { applyPreset } from '../engine/params';
import type { AdjustId, EditState, PhotoParams } from '../types';
import { legacyProjection, splitLegacy } from './legacy';
import { lensFor } from './lens';
import {
  adjustIsNeutral,
  defaultPhoto,
  editKey,
  naturalPerson,
  neutralPerson,
  resetAdjust,
  sanitizeEditState,
  sanitizePhotoLook,
  setLook,
} from './state';

const ADJUST: AdjustId[] = [
  'adjust.brightness', 'adjust.exposure', 'adjust.contrast', 'adjust.highlights', 'adjust.shadows', 'adjust.temperature',
  'adjust.tint', 'adjust.saturation', 'adjust.vibrance', 'adjust.fade', 'adjust.grain', 'adjust.vignette',
];
const neutral = (id: AdjustId) => (id === 'adjust.fade' || id === 'adjust.grain' || id === 'adjust.vignette' ? 0 : 0.5);

const edit = (photo: Partial<PhotoParams> = {}, persons: Record<string, ReturnType<typeof naturalPerson>> = { p0: naturalPerson() }): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), ...photo },
  persons,
  template: neutralPerson(),
  primaryInit: null,
});
const withValues = (over: Partial<Record<AdjustId, number>>, look: PhotoParams['look'] = null): EditState => {
  const p = defaultPhoto();
  return edit({ values: { ...p.values, ...over }, look });
};

describe('defaultPhoto / setLook / resetAdjust', () => {
  it('defaultPhoto has neutral 調節 and no look', () => {
    const p = defaultPhoto();
    for (const id of ADJUST) expect(p.values[id], id).toBe(neutral(id));
    expect(p.look).toBeNull();
    expect(adjustIsNeutral(p)).toBe(true);
  });

  it('setLook sets, clamps the amount, returns the same object when equal, null clears; the rest is shared', () => {
    const e0 = edit();
    const e1 = setLook(e0, 'film', 0.8);
    expect(e1.photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(e1.persons).toBe(e0.persons);
    expect(e1.photo.values).toBe(e0.photo.values);
    expect(setLook(e1, 'film', 0.8)).toBe(e1);
    expect(setLook(e1, 'ccd', 7).photo.look).toEqual({ id: 'ccd', amount: 1 });
    expect(setLook(e1, 'ccd', Number.NaN).photo.look).toEqual({ id: 'ccd', amount: 0 });
    expect(setLook(e1, null, 0.8).photo.look).toBeNull();
    expect(setLook(e0, null, 0)).toBe(e0);
  });

  it('resetAdjust neutralizes the 12 values, keeps the look and every other field; a neutral photo is returned as is', () => {
    const e = withValues({ 'adjust.exposure': 0.8, 'adjust.grain': 0.4 }, { id: 'blue', amount: 0.5 });
    const r = resetAdjust(e);
    for (const id of ADJUST) expect(r.photo.values[id]).toBe(neutral(id));
    expect(r.photo.look).toEqual({ id: 'blue', amount: 0.5 });
    expect(r.photo.values['skin.whiten']).toBe(e.photo.values['skin.whiten']);
    expect(r.persons).toBe(e.persons);
    const n = edit();
    expect(resetAdjust(n)).toBe(n);
  });
});

describe('the lens routes 調節 and 質感 to the photo (C §3.3)', () => {
  const two = () =>
    edit({}, { f0: naturalPerson(), f1: { ...naturalPerson(), preset: 'custom' } });
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'f1', face: true, body: false },
  ];

  it('adjust ids write photo.values under a person selection and under 全部, persons untouched', () => {
    for (const sel of [{ kind: 'person', id: 'f1' } as const, { kind: 'all' } as const]) {
      const e = two();
      const l = lensFor(e, sel, persons, 'f0');
      const next = l.set('adjust.exposure', 0.7);
      expect(next.photo.values['adjust.exposure']).toBe(0.7);
      expect(next.persons).toBe(e.persons);
      expect(lensFor(next, sel, persons, 'f0').get('adjust.exposure')).toEqual({ value: 0.7, mixed: false });
    }
  });

  it('look() / setLook / resetGroup("adjust")', () => {
    const e = two();
    const l = lensFor(e, { kind: 'person', id: 'f0' }, persons, 'f0');
    expect(l.look()).toBeNull();
    const withLook = l.setLook('cinema', 0.6);
    expect(lensFor(withLook, { kind: 'all' }, persons, 'f0').look()).toEqual({ id: 'cinema', amount: 0.6 });
    const dirty = lensFor(withLook, { kind: 'all' }, persons, 'f0').set('adjust.vignette', 0.5);
    const reset = lensFor(dirty, { kind: 'all' }, persons, 'f0').resetGroup('adjust');
    expect(reset).toEqual(resetAdjust(dirty));
    expect(reset.photo.look).toEqual({ id: 'cinema', amount: 0.6 });
  });

  it('a beauty preset never touches 調節 or the look (C §3.4)', () => {
    const e = withValues({ 'adjust.contrast': 0.9 }, { id: 'ccd', amount: 0.8 });
    const next = lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0').applyPreset('refined', 1);
    expect(next.photo.values['adjust.contrast']).toBe(0.9);
    expect(next.photo.look).toEqual({ id: 'ccd', amount: 0.8 });
  });

  it('the step-2 spec §3.3 table: 重置 clears both; 濾鏡, 調節 and 質感 edits leave each other and the preset link alone', () => {
    const styled = withValues({ 'adjust.exposure': 0.9, 'adjust.grain': 0.4 }, { id: 'film', amount: 0.8 });
    const l = lensFor(styled, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0');
    const link = styled.photo.presetLink;
    expect(link).not.toBeNull(); // defaultPhoto() is linked to 自然 100
    // 重置 (RM §3.4): defaultPhoto() — no look, the 12 values neutral
    const reset = l.reset();
    expect(reset.photo.look).toBeNull();
    for (const id of ADJUST) expect(reset.photo.values[id], id).toBe(neutral(id));
    // picking a 濾鏡 keeps the look and the 調節 values
    const filtered = l.setFilter('warm');
    expect(filtered.photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(filtered.photo.values['adjust.exposure']).toBe(0.9);
    // a 調節 drag and a 質感 pick keep the preset link and every person's preset
    expect(l.set('adjust.contrast', 0.7).photo.presetLink).toEqual(link);
    const picked = setLook(styled, 'ccd', 0.5);
    expect(picked.photo.presetLink).toEqual(link);
    expect(picked.persons).toBe(styled.persons);
  });
});

describe('sanitize, keys and legacy (step-2 spec §5)', () => {
  it('sanitizePhotoLook keeps a valid look (amount clamped) and drops everything else', () => {
    expect(sanitizePhotoLook({ id: 'film', amount: 0.8 })).toEqual({ id: 'film', amount: 0.8 });
    expect(sanitizePhotoLook({ id: 'film', amount: 4 })).toEqual({ id: 'film', amount: 1 });
    expect(sanitizePhotoLook({ id: 'portra', amount: 0.8 })).toBeNull();
    expect(sanitizePhotoLook({ id: 'film', amount: Number.NaN })).toBeNull();
    expect(sanitizePhotoLook({ id: 'film' })).toBeNull();
    expect(sanitizePhotoLook('film')).toBeNull();
    expect(sanitizePhotoLook(undefined)).toBeNull();
  });

  it('sanitizeEditState: junk adjust values → neutral, values clamped, a missing look (a step-1 record) → null', () => {
    const raw = JSON.parse(JSON.stringify(withValues({ 'adjust.exposure': 0.75 }))) as { photo: Record<string, unknown> };
    (raw.photo.values as Record<string, unknown>)['adjust.grain'] = 'lots';
    (raw.photo.values as Record<string, unknown>)['adjust.fade'] = 3;
    delete (raw.photo.values as Record<string, unknown>)['adjust.tint'];
    delete raw.photo.look;
    const s = sanitizeEditState(raw, null);
    expect(s.photo.values['adjust.exposure']).toBe(0.75);
    expect(s.photo.values['adjust.grain']).toBe(0);
    expect(s.photo.values['adjust.fade']).toBe(1);
    expect(s.photo.values['adjust.tint']).toBe(0.5);
    expect(s.photo.look).toBeNull();
    (raw.photo as Record<string, unknown>).look = { id: 'nope', amount: 0.5 };
    expect(sanitizeEditState(raw, null).photo.look).toBeNull();
    (raw.photo as Record<string, unknown>).look = { id: 'flash', amount: -2 };
    expect(sanitizeEditState(raw, null).photo.look).toEqual({ id: 'flash', amount: 0 });
  });

  it('editKey changes with every adjust value and with the look id and amount', () => {
    const base = edit();
    const k0 = editKey(base);
    for (const id of ADJUST) expect(editKey(withValues({ [id]: neutral(id) === 0 ? 0.3 : 0.7 })), id).not.toBe(k0);
    const a = editKey(setLook(base, 'film', 0.8));
    expect(a).not.toBe(k0);
    expect(editKey(setLook(base, 'film', 0.7))).not.toBe(a);
    expect(editKey(setLook(base, 'ccd', 0.8))).not.toBe(a);
  });

  it('a v1 BeautyParams splits into neutral 調節 and no look; the legacy projection keeps every v0.3 field', () => {
    const { photo } = splitLegacy(applyPreset('glow', 1));
    for (const id of ADJUST) expect(photo.values[id]).toBe(neutral(id));
    expect(photo.look).toBeNull();
    const plain = edit();
    const styled = setLook(withValues({ 'adjust.exposure': 0.9 }), 'film', 0.8);
    // a 0.3 build reads only the v0.3 fields of the projection (C §5.1): 調節 and 質感 must not change them
    const v03 = (p: ReturnType<typeof legacyProjection>) => ({
      ...p,
      values: Object.fromEntries(Object.entries(p.values).filter(([k]) => !k.startsWith('adjust.'))),
    });
    expect(v03(legacyProjection(styled, 'p0'))).toEqual(v03(legacyProjection(plain, 'p0')));
  });
});
```

Append to `src/store/settings.test.ts` (it already stubs `localStorage` with `MemoryStorage` in `beforeEach`, and already imports `loadLook`, `LOOK_KEY`, `PARAMS_KEY` from `./settings` and `applyPreset`, `PARAM_DEFS` from `../engine/params`: no new import):

```ts
describe('camera look: 調節 and 質感 (step-2 spec §5)', () => {
  it('a migrated meiyan.params.v1 opens with neutral 調節 and no look', () => {
    store.setItem(PARAMS_KEY, JSON.stringify(applyPreset('glow', 1)));
    const look = loadLook();
    const values = look.photo.values as Record<string, number>;
    for (const d of PARAM_DEFS.filter((x) => x.group === 'adjust')) expect(values[d.id], d.id).toBe(d.bidirectional ? 0.5 : 0);
    expect(look.photo.look).toBeNull();
  });

  it('a meiyan.look.v1 written by a step-1 build (no look, no adjust keys) or holding junk opens neutral', () => {
    const raw = JSON.parse(JSON.stringify(loadLook())) as { photo: { values: Record<string, unknown>; look?: unknown } };
    for (const k of Object.keys(raw.photo.values)) if (k.startsWith('adjust.')) delete raw.photo.values[k];
    delete raw.photo.look;
    store.setItem(LOOK_KEY, JSON.stringify(raw));
    expect(loadLook().photo.look).toBeNull();
    expect(loadLook().photo.values['adjust.vignette']).toBe(0);
    raw.photo.look = { id: 'ccd', amount: 'x' };
    raw.photo.values['adjust.exposure'] = Number.POSITIVE_INFINITY;
    store.setItem(LOOK_KEY, JSON.stringify(raw));
    expect(loadLook().photo.look).toBeNull();
    expect(loadLook().photo.values['adjust.exposure']).toBe(0.5);
  });

  it('round-trips 調節 values and the look', () => {
    const l = loadLook();
    const styled = { ...l, photo: { ...l.photo, values: { ...l.photo.values, 'adjust.fade': 0.3 }, look: { id: 'blue' as const, amount: 0.6 } } };
    store.setItem(LOOK_KEY, JSON.stringify(styled));
    expect(loadLook().photo.look).toEqual({ id: 'blue', amount: 0.6 });
    expect(loadLook().photo.values['adjust.fade']).toBe(0.3);
  });
});
```

(`JSON.stringify(Infinity)` writes `null`; the sanitizer must turn `null` into the neutral value.)

Append to `src/store/history.test.ts` (it uses `fake-indexeddb` and the helper `entry(tag, params)`):

```ts
describe('v2 entries with 調節 and 質感 (step-2 spec §5)', () => {
  it('round-trip the 12 values and the look', async () => {
    const photo = { ...defaultPhoto(), look: { id: 'cinema' as const, amount: 0.7 } };
    photo.values = { ...photo.values, 'adjust.exposure': 0.65, 'adjust.grain': 0.35, 'adjust.vignette': 1 };
    const e: EditState = { v: 2, photo, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const id = await addEntry({ ...entry('adj'), schema: 2, edit: e });
    const back = (await getEntry(id))!.edit!;
    expect(back.photo.look).toEqual({ id: 'cinema', amount: 0.7 });
    expect(back.photo.values['adjust.exposure']).toBe(0.65);
    expect(back.photo.values['adjust.grain']).toBe(0.35);
    expect(back.photo.values['adjust.vignette']).toBe(1);
  });
});
```

(add `defaultPhoto, naturalPerson, neutralPerson` to its existing `import { assignPersons, renamePersons } from '../edit/state';`; `EditState` is already in its `../types` type import.)

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/edit/adjust.test.ts src/store/settings.test.ts src/store/history.test.ts`
Expected: FAIL — `setLook`, `resetAdjust`, `adjustIsNeutral`, `sanitizePhotoLook` are not exported; `defaultPhoto().look` is `undefined`.

- [x] **Step 3: Add `look` to `PhotoParams`**

In `src/types.ts`, in step 1's `PhotoParams` after `filterId: string;` add:

```ts
  /** 一鍵 › 質感 (C §3.4): a look and its 程度, or null (無) */
  look: { id: LookId; amount: number } | null;
```

- [x] **Step 4: Edit-state functions**

In `src/edit/state.ts`:
1. In `defaultPhoto()`'s returned object add `look: null,` (the 12 adjust values are already neutral: step 1 fills them from `PHOTO_IDS`, the photo-scope `PARAM_DEFS`, via the 自然 preset).
2. In step 1's `sanitizePhoto(raw, persons)` (the stored-photo sanitizer `sanitizeEditState` calls), add `look: sanitizePhotoLook(r.look),` to the `PhotoParams` literal it builds (`r` is its raw record). The adjust values need no new code: its loop clamps every id of `PHOTO_IDS` (finite → clamp01, else the 自然 default), and `PHOTO_IDS` now holds the 12 adjust ids.
3. Add (imports: `paramsInGroup`, `neutralValue` into the existing `../engine/params` import; `isLookId` from `../engine/looks`; `AdjustId`, `LookId` into the existing `../types` type import):

```ts
const clampAmount = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** 一鍵 › 質感 (step-2 spec §3.4): null clears it; the amount is clamped to 0..1. Unchanged → the same object. */
export function setLook(edit: EditState, id: LookId | null, amount: number): EditState {
  const cur = edit.photo.look;
  const next = id === null ? null : { id, amount: clampAmount(amount) };
  if (cur === next || (cur && next && cur.id === next.id && cur.amount === next.amount)) return edit;
  return { ...edit, photo: { ...edit.photo, look: next } };
}

/** true when no 調節 item carries a value (the item / tab dots and the ⊘ no-op check, step-2 spec §2.1) */
export function adjustIsNeutral(photo: Pick<PhotoParams, 'values'>): boolean {
  return paramsInGroup('adjust').every((d) => photo.values[d.id as AdjustId] === neutralValue(d));
}

/** ⊘ 原圖 in 調節: the 12 user values to neutral, the 質感 untouched. Already neutral → the same object. */
export function resetAdjust(edit: EditState): EditState {
  if (adjustIsNeutral(edit.photo)) return edit;
  const values = { ...edit.photo.values };
  for (const d of paramsInGroup('adjust')) values[d.id as AdjustId] = neutralValue(d);
  return { ...edit, photo: { ...edit.photo, values } };
}

/** A stored 質感 → a valid look (amount clamped) or null. */
export function sanitizePhotoLook(raw: unknown): PhotoParams['look'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; amount?: unknown };
  if (!isLookId(r.id) || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) return null;
  return { id: r.id, amount: clampAmount(r.amount) };
}
```

(`hasValue` is not needed here; do not import it if unused — `noUnusedLocals` is on.)

4. In `src/edit/legacy.ts` `splitLegacy`, add `look: null,` after `filterId: p.filterId,` in the returned `photo` literal (a v1 `BeautyParams` has no 質感; `loadLook()`'s first-load migration of `meiyan.params.v1` goes through it, so the settings test below depends on it). `legacyProjection` needs no change: it writes the 12 adjust values into `params.values` (a 0.3 build ignores ids it does not know) and has no look field.

- [x] **Step 5: Lens**

In `src/edit/lens.ts`:
1. Add `resetAdjust` and `setLook as setPhotoLook` to the existing `./state` import and `LookId` to the `../types` type import; add to the `Lens` interface (step 1 does not have these yet; C §3.3 lists `setLook`):

```ts
  /** 一鍵 › 質感 of the photo (step-2 spec §3.4) */
  look(): PhotoParams['look'];
  /** pick a look (amount clamped) or 無 (null); a photo item, whatever the selection */
  setLook(id: LookId | null, amount: number): EditState;
```

2. In the `const lens: Lens = { … }` object inside `lensFor`, add:

```ts
    look() {
      return edit.photo.look;
    },
    setLook(id, amount) {
      return setPhotoLook(edit, id, amount);
    },
```

3. In `resetGroup(group)`, add as the first statement `if (group === 'adjust') return resetAdjust(edit);` — 調節 is photo-level as a whole tab, so ⊘ resets it under any selection (step 1's generic branch resets photo items only under 全部 or with < 2 persons).
4. Adjust ids need no routing code: their `scope` is `'photo'` (Task 1), and step 1's lens writes photo-scope ids to `edit.photo.values` under every selection — the tests prove it.
5. If `a beauty preset never touches 調節 or the look` fails, step 1's preset photo part walks every photo-scope id; restrict it to the four C §3.4 names — 美白 (`skin.whiten`), 銳化 (`skin.sharpen`), `filterId`, `filter.amount`.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/edit/adjust.test.ts src/store/settings.test.ts src/store/history.test.ts && npm run typecheck`
Expected: PASS; `tsc` exits 0. If `tsc` reports object literals of type `PhotoParams` missing `look` (step-1 code, tests or harnesses that build a photo field by field), add `look: null` there. Code that passes a whole photo through (`importEdit` / `cameraShotEdit` use `photo: look.photo`, `cameraEdit` / `lookOf` likewise) already carries the camera's 質感 into the editor and must stay that way (S §2.3 hand-over, §11 Q5).

- [x] **Step 7: Run the whole unit suite**

Run: `npm test`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/types.ts src/edit/state.ts src/edit/legacy.ts src/edit/lens.ts src/edit/adjust.test.ts src/store/settings.test.ts src/store/history.test.ts
git add -u src tests
git commit -m "v0.4 step 2: 質感 and 調節 in the edit state, lens and persistence" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: adjustMath.ts — constants and the deterministic grain hash

**Files:**
- Create: `src/engine/adjustMath.ts`
- Test: `src/engine/adjustMath.grain.test.ts`

**Interfaces:**
- Consumes: `AdjustId` (Task 1).
- Produces (all exported from `src/engine/adjustMath.ts`):
  - `ADJUST_IDS: readonly AdjustId[]` (strip order), `ADJUST_ONE_WAY: ReadonlySet<AdjustId>`
  - `ADJUST_K` (every tunable constant, `as const`)
  - `clamp01(v)`, `smoothstep(e0, e1, x)`, `lin(c: number): number`, `enc(x: number): number`, `luma(c: readonly number[]): number`
  - `lowbias32(x: number): number` (uint32 → uint32)
  - `seedMix(seed: number): number` = `lowbias32((seed + 0x9e3779b9) >>> 0)`
  - `latticeValue(ix: number, rowHash: number): number` ∈ [−1, 1)
  - `grainAt(px: number, py: number, mix: number): number` (lattice coordinates; bilinear, variance-normalized)

- [x] **Step 1: Write the failing test**

Create `src/engine/adjustMath.grain.test.ts`:

```ts
// Grain (step-2 spec §4.4): the lowbias32 lattice must be bit-exact between this port and GLSL, and the
// value noise must have the same variance at every cell size and alignment.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grainAt, latticeValue, lowbias32, seedMix } from './adjustMath';

/** independent reference: the same finalizer in BigInt arithmetic */
function lowbias32Big(x: number): number {
  const M = 0xffffffffn;
  let v = BigInt(x >>> 0);
  v ^= v >> 16n;
  v = (v * 0x7feb352dn) & M;
  v ^= v >> 15n;
  v = (v * 0x846ca68bn) & M;
  v ^= v >> 16n;
  return Number(v);
}

describe('lowbias32 (hash-prospector constants)', () => {
  it('matches known vectors, negative lattice indices included', () => {
    expect(lowbias32(0)).toBe(0);
    expect(lowbias32(1)).toBe(0x688990c0);
    expect(lowbias32(2)).toBe(0xd1132181);
    expect(lowbias32(0x9e3779b9)).toBe(0x01fce552);
    expect(lowbias32(0xffffffff)).toBe(0x6768824a);
    expect(lowbias32(-1)).toBe(0x6768824a);
    expect(lowbias32(-7)).toBe(0xa73d9bcb);
    expect(seedMix(0)).toBe(0x01fce552);
  });

  it('equals an independent BigInt reference over 10 000 inputs', () => {
    let x = 12345;
    for (let i = 0; i < 10_000; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      expect(lowbias32(x)).toBe(lowbias32Big(x));
    }
  });
});

describe('lattice and value noise', () => {
  it('lattice values are exact multiples of 2^−23 in [−1, 1) (so float32 GLSL gets the same numbers)', () => {
    for (let i = -50; i < 50; i++) {
      const v = latticeValue(i, lowbias32(i * 7));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger((v + 1) * 8388608)).toBe(true);
      expect(Math.fround(v)).toBe(v);
    }
  });

  it('equals the lattice value on lattice points', () => {
    const mix = seedMix(3);
    for (const [x, y] of [[0, 0], [5, 9], [-3, 2], [-1, -1]]) expect(grainAt(x, y, mix)).toBe(latticeValue(x, lowbias32((y >>> 0) ^ mix)));
  });

  it('has mean ≈ 0 over 1024² pixels', () => {
    const mix = seedMix(0);
    let sum = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) sum += grainAt(x + 0.5, y + 0.5, mix);
    expect(Math.abs(sum / 1024 ** 2)).toBeLessThan(0.002);
  });

  it('has the same per-pixel std at cell sizes 1, 1.42 and 2.8 px, at every phase (variance normalization)', () => {
    const target = Math.sqrt(1 / 3);
    for (const cell of [1, 1.42, 2.8]) {
      for (let x = 0; x < 10; x++) {
        let s1 = 0;
        let s2 = 0;
        const N = 4000;
        for (let k = 0; k < N; k++) {
          const v = grainAt((x + 0.5) / cell, 7.3, seedMix(k));
          s1 += v;
          s2 += v * v;
        }
        const std = Math.sqrt(s2 / N - (s1 / N) ** 2);
        expect(Math.abs(std / target - 1), `cell ${cell} x ${x}`).toBeLessThan(0.05);
      }
    }
  });

  it('is deterministic per seed; another seed is uncorrelated', () => {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 256 * 256; i++) {
      const x = (i % 256) + 0.5;
      const y = Math.floor(i / 256) + 0.5;
      a.push(grainAt(x, y, seedMix(0)));
      b.push(grainAt(x, y, seedMix(1)));
    }
    expect(grainAt(10.5, 20.5, seedMix(0))).toBe(a[20 * 256 + 10]);
    const mean = (v: number[]) => v.reduce((s, t) => s + t, 0) / v.length;
    const ma = mean(a);
    const mb = mean(b);
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < a.length; i++) {
      cov += (a[i] - ma) * (b[i] - mb);
      va += (a[i] - ma) ** 2;
      vb += (b[i] - mb) ** 2;
    }
    expect(Math.abs(cov / Math.sqrt(va * vb))).toBeLessThan(0.1);
  });

  it('has only type imports (scripts/gen-luts.mjs loads it under Node)', () => {
    const src = readFileSync(new URL('./adjustMath.ts', import.meta.url), 'utf8');
    for (const line of src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))) expect(line).toMatch(/^\s*import type\s/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/adjustMath.grain.test.ts`
Expected: FAIL — `Failed to resolve import "./adjustMath"`.

- [x] **Step 3: Write the module (constants, helpers, grain)**

Create `src/engine/adjustMath.ts`:

```ts
// 調節 and 質感 maths (v0.4 step-2 spec §4.2–4.5): every tunable constant, the uniform builder of the composite's
// 調節 program, and the CPU reference of each stage (compositeCpu.ts, the gen-luts.mjs thumbnails, unit tests).
// Pure and `import type` only, so scripts/gen-luts.mjs can import this file under Node's type stripping.
// Original work: IEC 61966-2-1 sRGB transfer, Rec. 709 luma, the logistic sigmoid, Fritsch–Carlson (1980) monotone
// cubic tangents; the grain hash uses the lowbias32 constants of Chris Wellons' hash-prospector (public domain).
import type { AdjustId } from '../types';

/** strip order (step-2 spec §2.1) */
export const ADJUST_IDS = [
  'adjust.brightness',
  'adjust.exposure',
  'adjust.contrast',
  'adjust.highlights',
  'adjust.shadows',
  'adjust.temperature',
  'adjust.tint',
  'adjust.saturation',
  'adjust.vibrance',
  'adjust.fade',
  'adjust.grain',
  'adjust.vignette',
] as const satisfies readonly AdjustId[];

/** 0–100 items; every other adjust item is bidirectional (−50…+50, neutral 0.5) */
export const ADJUST_ONE_WAY: ReadonlySet<AdjustId> = new Set<AdjustId>(['adjust.fade', 'adjust.grain', 'adjust.vignette']);

/** Every tunable constant (S §4.1 "constants live in TypeScript"): the shader only receives derived uniforms. */
export const ADJUST_K = {
  /** 亮度: y = x^(2^(−bright·s)) — mid grey 0.5 → 0.653 at +50, 0.324 at −50 */
  bright: 0.7,
  /** 對比: logistic steepness for s > 0, and of the inverse curve for s < 0 (mid slope 1.66 / 0.76) */
  contrastUp: 6,
  contrastDown: 4,
  /** 高光／陰影: knot offset at full strength and the knot weights at x_i = i/8 */
  toneKnot: 0.12,
  shadowW: [0, 0.7, 0.75, 0.45, 0.2, 0.05, 0, 0, 0],
  highlightW: [0, 0, 0, 0.05, 0.2, 0.45, 0.75, 0.7, 0],
  /** 曝光: EV at full strength, shoulder knee in linear light */
  exposureEv: 1,
  knee: 0.75,
  /** 色溫／色調: log2 gains at full strength (+ = warmer / magenta) */
  tempGain: 0.3,
  tintGreen: 0.2,
  tintRB: 0.1,
  /** 鮮艷度 strength and skin guard; skin window: HSV hue (turns) centre and half-width ≈ 25°, S ramps, V ramp */
  vibrance: 0.7,
  skinGuard: 0.6,
  skinHue: [0.07, 0.07],
  skinSatIn: [0.08, 0.2],
  skinSatOut: [0.6, 0.8],
  skinVal: [0.15, 0.35],
  /** boosts (k > 1) taper off as S approaches the gamut edge (the gen-luts.mjs chroma() taper) */
  taper: [0.6, 0.95],
  /** 褪色 at 100: black lift (→ 41/255), white drop (→ 245/255), chroma loss */
  fadeLift: 0.16,
  fadeWhite: 0.04,
  fadeChroma: 0.1,
  /** 暗角 at 100: linear-light corner loss (gain 0.3), radial ramp, encoded-space exponent */
  vignette: 0.7,
  vigInner: 0.4,
  vigOuter: 1,
  vigGamma: 1 / 2.2,
  /** 顆粒 at 100: amplitude, midtone weighting base + mid·4Y(1 − Y), reference short edge of a 1 px cell */
  grainAmp: 0.08,
  grainBase: 0.3,
  grainMid: 0.7,
  grainRef: 1080,
  /** thumbnails: grain on the thumbnail's own pixel grid at this fraction of the amplitude */
  thumbGrain: 0.6,
} as const;

export const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** IEC 61966-2-1 sRGB; the branch tests match the shader's step() */
export const lin = (c: number) => (c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const enc = (x: number) => (x < 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
/** Rec. 709 luma of an encoded colour */
export const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ───────────── grain (step-2 spec §4.4) ─────────────

/** lowbias32 integer finalizer (hash-prospector constants, public domain): uint32 in, uint32 out */
export function lowbias32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** per-frame constant mixed into every row hash (computed once on the CPU, uniform uSeedMix) */
export function seedMix(seed: number): number {
  return lowbias32((seed + 0x9e3779b9) >>> 0);
}

/** lattice value in [−1, 1): a 24-bit integer times 2^−23, exact in float32, so GPU and CPU agree bit for bit */
export function latticeValue(ix: number, rowHash: number): number {
  return (lowbias32((ix >>> 0) ^ rowHash) >>> 8) / 8388608 - 1;
}

/**
 * Value noise at lattice coordinates (px, py): bilinear between the 4 surrounding lattice values, divided by the
 * blend's standard-deviation factor so every pixel has the same variance whatever the cell size and alignment.
 * The shader's adjGrain().
 */
export function grainAt(px: number, py: number, mix: number): number {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const r0 = lowbias32((y0 >>> 0) ^ mix);
  const r1 = lowbias32(((y0 + 1) >>> 0) ^ mix);
  const n00 = latticeValue(x0, r0);
  const n10 = latticeValue(x0 + 1, r0);
  const n01 = latticeValue(x0, r1);
  const n11 = latticeValue(x0 + 1, r1);
  const a = n00 + (n10 - n00) * fx;
  const b = n01 + (n11 - n01) * fx;
  const n = a + (b - a) * fy;
  const gx = (1 - fx) * (1 - fx) + fx * fx;
  const gy = (1 - fy) * (1 - fy) + fy * fy;
  return n / Math.sqrt(gx * gy);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/adjustMath.grain.test.ts && npm run typecheck`
Expected: PASS (8 tests); `tsc` exits 0.

- [x] **Step 5: Check the module loads under Node's type stripping**

Run: `node --input-type=module -e "import('./src/engine/adjustMath.ts').then((m) => console.log(m.lowbias32(1).toString(16)))"`
Expected: prints `688990c0` (no `ERR_` error).

- [x] **Step 6: Commit**

```bash
git add src/engine/adjustMath.ts src/engine/adjustMath.grain.test.ts
git commit -m "v0.4 step 2: adjustMath constants and the deterministic grain hash" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: adjustMath.ts — stages, effective values, picture frame and uniforms

**Files:**
- Modify: `src/engine/adjustMath.ts` (append; widen the type import)
- Test: `src/engine/adjustMath.test.ts`

**Interfaces:**
- Consumes: Task 4 (`ADJUST_IDS`, `ADJUST_ONE_WAY`, `ADJUST_K`, `clamp01`, `smoothstep`, `lin`, `enc`, `luma`, `grainAt`, `seedMix`); `LookDef`, `Rect` (types); `lookDef` (Task 2, tests only).
- Produces:
  - `interface CurveKnots { y: number[]; m: number[] }`; `curveKnots(sb, sc, sh, ss): CurveKnots`; `curveAt(k: CurveKnots, Y: number): number`
  - `type AdjustValues = Readonly<Partial<Record<AdjustId, number>>>`
  - `neutralAdjust(id: AdjustId): number`; `isNeutralAdjust(id: AdjustId, shaderValue: number): boolean`
  - `effectiveAdjust(values: AdjustValues, look: LookDef | null, amount: number): Record<AdjustId, number>` (shader space)
  - `interface AdjustFrame { vMap: readonly [number, number, number, number]; vSize: readonly [number, number]; fullShortEdge: number; seed: number; thumb?: boolean }`
  - `frameFor(size: { width: number; height: number }, pictureFrame?: Rect | null, seed?: number): AdjustFrame`
  - `interface AdjustUniforms { on; adjustOn; lookAmt; exp; curveOn; curve; wbOn; wb; sat; skinA; skinB; taper; fade; vig; vAspect; vMap; grain; grainScale; seedMix }` (exact field types in Step 3)
  - `adjustUniforms(values: AdjustValues, look: { def: LookDef; amount: number } | null, lookReady: boolean, frame: AdjustFrame): AdjustUniforms`
  - `adjustRgb(rgb: readonly number[], u: AdjustUniforms, uv: readonly [number, number]): [number, number, number]`
  - `adjustWanted(values: AdjustValues, look: { id: string } | null): boolean`

- [x] **Step 1: Write the failing test**

Create `src/engine/adjustMath.test.ts`:

```ts
// 調節 maths against the step-2 spec §8.1 list: each item moves the right thing, neutral is exact, every stage is
// continuous at neutral, the curve is monotone under fuzzing, grain is tile-independent, the look is all-or-nothing.
import { describe, expect, it } from 'vitest';
import type { AdjustId } from '../types';
import {
  ADJUST_IDS,
  ADJUST_ONE_WAY,
  adjustRgb,
  adjustUniforms,
  adjustWanted,
  curveAt,
  curveKnots,
  effectiveAdjust,
  enc,
  frameFor,
  lin,
  luma,
  seedMix,
  type AdjustFrame,
  type AdjustValues,
} from './adjustMath';
import { lookDef } from './looks';

const F = frameFor({ width: 1080, height: 1080 });
const MID: [number, number] = [0.5, 0.5];
const U = (values: AdjustValues) => adjustUniforms(values, null, false, F);
/** display units → stored 0..1 value */
const at = (id: AdjustId, d: number) => (ADJUST_ONE_WAY.has(id) ? d / 100 : (d + 50) / 100);
const one = (id: AdjustId, d: number) => U({ [id]: at(id, d) });
const grey = (v: number): [number, number, number] => [v, v, v];
const level = (v: number) => Math.round(v * 255);

describe('neutral', () => {
  it('every value neutral and no look: the 調節 program is off', () => {
    const u = U({});
    expect(u.on).toBe(false);
    expect(u.adjustOn).toBe(false);
    expect(u.lookAmt).toBe(0);
  });

  it('forced on with neutral values, adjustRgb is the exact identity on a 17³ grid', () => {
    const u = { ...U({}), adjustOn: true };
    for (let r = 0; r <= 16; r++)
      for (let g = 0; g <= 16; g++)
        for (let b = 0; b <= 16; b++) {
          const c = [r / 16, g / 16, b / 16];
          expect(adjustRgb(c, u, MID)).toEqual(c);
        }
  });

  it('every stage is continuous at neutral: ±0.1 display unit changes no 8-bit colour by more than 1 level', () => {
    for (const id of ADJUST_IDS)
      for (const d of ADJUST_ONE_WAY.has(id) ? [0.1] : [0.1, -0.1]) {
        const u = one(id, d);
        for (let r = 0; r <= 32; r += 2)
          for (let g = 0; g <= 32; g += 2)
            for (let b = 0; b <= 32; b += 2) {
              const c = [r / 32, g / 32, b / 32];
              for (const uv of [MID, [0.02, 0.03], [0.97, 0.4]] as [number, number][]) {
                const o = adjustRgb(c, u, uv);
                for (let k = 0; k < 3; k++) expect(Math.abs(level(o[k]) - level(c[k])), `${id} ${d}`).toBeLessThanOrEqual(1);
              }
            }
      }
  });
});

describe('each item moves the right thing (±max)', () => {
  it('亮度: mid grey 0.5 → 0.653 / 0.324, black and white fixed', () => {
    expect(adjustRgb(grey(0.5), one('adjust.brightness', 50), MID)[0]).toBeCloseTo(0.653, 2);
    expect(adjustRgb(grey(0.5), one('adjust.brightness', -50), MID)[0]).toBeCloseTo(0.324, 2);
    for (const d of [50, -50]) {
      expect(adjustRgb(grey(0), one('adjust.brightness', d), MID)).toEqual([0, 0, 0]);
      expect(adjustRgb(grey(1), one('adjust.brightness', d), MID)).toEqual([1, 1, 1]);
    }
  });

  it('曝光: ±1 EV on linear 18 % grey (± 1 %), white stays ≤ 1, no jump off 0', () => {
    const g18 = enc(0.18);
    expect(Math.abs(lin(adjustRgb(grey(g18), one('adjust.exposure', 50), MID)[0]) / 0.18 - 2)).toBeLessThan(0.02);
    expect(Math.abs(lin(adjustRgb(grey(g18), one('adjust.exposure', -50), MID)[0]) / 0.18 - 0.5)).toBeLessThan(0.005);
    expect(adjustRgb(grey(1), one('adjust.exposure', 50), MID)[0]).toBeLessThanOrEqual(1);
    const tiny = U({ 'adjust.exposure': 0.5 + 0.0005 }); // s = 0.001
    for (let i = 0; i <= 255; i++) expect(Math.abs(adjustRgb(grey(i / 255), tiny, MID)[0] - i / 255)).toBeLessThan(0.002);
  });

  it('對比: + widens the 10–90 % spread, − narrows it, 0.5 fixed', () => {
    const spread = (d: number) =>
      adjustRgb(grey(0.9), one('adjust.contrast', d), MID)[0] - adjustRgb(grey(0.1), one('adjust.contrast', d), MID)[0];
    expect(spread(50)).toBeGreaterThan(0.85);
    expect(spread(-50)).toBeLessThan(0.75);
    expect(adjustRgb(grey(0.5), one('adjust.contrast', 50), MID)[0]).toBeCloseTo(0.5, 9);
  });

  it('高光 moves Y > 0.6 at least 4× more than Y < 0.3; 陰影 the reverse', () => {
    const moves = (id: AdjustId) => {
      let hi = 0;
      let nh = 0;
      let lo = 0;
      let nl = 0;
      for (let i = 0; i <= 255; i++) {
        const y = i / 255;
        const d = Math.abs(adjustRgb(grey(y), one(id, 50), MID)[0] - y);
        if (y > 0.6) {
          hi += d;
          nh++;
        }
        if (y < 0.3) {
          lo += d;
          nl++;
        }
      }
      return { hi: hi / nh, lo: lo / nl };
    };
    const h = moves('adjust.highlights');
    expect(h.hi).toBeGreaterThan(4 * h.lo);
    const s = moves('adjust.shadows');
    expect(s.lo).toBeGreaterThan(4 * s.hi);
  });

  it('色溫 + warms grey (R/B up) at constant luminance, − cools; 色調 + is magenta', () => {
    const L = (c: number[]) => luma(c.map(lin));
    const warm = adjustRgb(grey(0.5), one('adjust.temperature', 50), MID);
    const cool = adjustRgb(grey(0.5), one('adjust.temperature', -50), MID);
    expect(warm[0] / warm[2]).toBeGreaterThan(1.1);
    expect(cool[0] / cool[2]).toBeLessThan(0.9);
    expect(Math.abs(L(warm) / L(grey(0.5)) - 1)).toBeLessThan(0.01);
    const t = adjustRgb(grey(0.5), one('adjust.tint', 50), MID);
    expect(t[1] / (t[0] + t[2])).toBeLessThan(0.48);
  });

  it('飽和: −50 is black and white; +50 raises the chroma of a 70 %-saturated colour without clipping it', () => {
    const c = [0.5, 0.3, 0.15];
    const bw = adjustRgb(c, one('adjust.saturation', -50), MID);
    expect(bw[0]).toBeCloseTo(bw[1], 9);
    expect(bw[1]).toBeCloseTo(bw[2], 9);
    const sat = adjustRgb(c, one('adjust.saturation', 50), MID);
    for (const v of sat) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.max(...sat) - Math.min(...sat)).toBeGreaterThan(0.35 * 1.5);
  });

  it('鮮艷度 +: a muted blue gains more than a vivid red; a skin patch gains at most half of a non-skin hue of equal S and V', () => {
    const u = one('adjust.vibrance', 50);
    const chroma = (c: number[]) => Math.max(...c) - Math.min(...c);
    const gain = (c: number[]) => chroma(adjustRgb(c, u, MID)) / chroma(c) - 1;
    expect(gain([0.4, 0.45, 0.55])).toBeGreaterThan(gain([0.9, 0.2, 0.2]));
    expect(gain([0.8, 0.6, 0.5])).toBeLessThanOrEqual(0.5 * gain([0.5, 0.65, 0.8]));
    expect(gain([0.8, 0.6, 0.5])).toBeGreaterThan(0);
  });

  it('褪色 100: black → 41 ± 1, white → 245 ± 1 (/255)', () => {
    for (const v of adjustRgb(grey(0), one('adjust.fade', 100), MID)) expect(Math.abs(v * 255 - 41)).toBeLessThanOrEqual(1);
    for (const v of adjustRgb(grey(1), one('adjust.fade', 100), MID)) expect(Math.abs(v * 255 - 245)).toBeLessThanOrEqual(1);
  });

  it('暗角 100: the corner × 0.3^(1/2.2) ± 0.5 %, the centre untouched, symmetric, aspect-aware', () => {
    const u = one('adjust.vignette', 100);
    const k = 0.3 ** (1 / 2.2);
    for (const uv of [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][])
      expect(Math.abs(adjustRgb(grey(0.6), u, uv)[0] / 0.6 / k - 1)).toBeLessThan(0.005);
    expect(adjustRgb(grey(0.6), u, MID)[0]).toBe(0.6);
    const wide = adjustUniforms({ 'adjust.vignette': 1 }, null, false, frameFor({ width: 2000, height: 1000 }));
    // the middle of the right edge of a 2:1 frame lies nearer its corner radius than in a square frame
    expect(adjustRgb(grey(0.6), wide, [1, 0.5])[0]).toBeLessThan(adjustRgb(grey(0.6), u, [1, 0.5])[0]);
  });
});

describe('tone curve fuzz', () => {
  it('2000 random (亮度, 對比, 高光, 陰影): knots non-decreasing, f(0) = 0, f(1) = 1, samples monotone, finite, in [0, 1]', () => {
    let s = 1;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    for (let k = 0; k < 2000; k++) {
      const kn = curveKnots(rnd(), rnd(), rnd(), rnd());
      expect(kn.y[0]).toBe(0);
      expect(kn.y[8]).toBe(1);
      for (let i = 1; i < 9; i++) expect(kn.y[i]).toBeGreaterThanOrEqual(kn.y[i - 1]);
      let prev = 0;
      for (let j = 0; j <= 1000; j++) {
        const v = curveAt(kn, j / 1000);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it('extreme combinations (對比 +50, 陰影 −50, 曝光 −50, 飽和 +50, 鮮艷度 +50) stay finite and in range', () => {
    const u = U({ 'adjust.contrast': 1, 'adjust.shadows': 0, 'adjust.exposure': 0, 'adjust.saturation': 1, 'adjust.vibrance': 1 });
    for (let i = 0; i <= 64; i++) for (const v of adjustRgb([i / 64, 1 - i / 64, 0.3], u, MID)) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe('effective values and the look (step-2 spec §4.3)', () => {
  const film = lookDef('film')!;

  it('user value + amount × offset in shader space, clamped per item', () => {
    const e = effectiveAdjust({ 'adjust.fade': 0.9, 'adjust.contrast': 0.5 }, film, 0.8);
    expect(e['adjust.fade']).toBe(1); // 0.9 + 0.8·30/100 → clamped
    expect(e['adjust.contrast']).toBeCloseTo(0.8 * (-10 / 50), 12);
    expect(e['adjust.grain']).toBeCloseTo(0.8 * 0.35, 12);
    expect(effectiveAdjust({}, film, 0)['adjust.grain']).toBe(0);
    expect(effectiveAdjust({ 'adjust.exposure': Number.NaN }, null, 1)['adjust.exposure']).toBe(0);
  });

  it('lookReady = false ignores the look entirely (no LUT, no offsets)', () => {
    const u = adjustUniforms({}, { def: film, amount: 0.8 }, false, F);
    expect(u.on).toBe(false);
    expect(u.lookAmt).toBe(0);
    expect(u.grain[0]).toBe(0);
  });

  it('a resident look draws its LUT mix and its offsets', () => {
    const u = adjustUniforms({}, { def: film, amount: 0.8 }, true, F);
    expect(u.on).toBe(true);
    expect(u.adjustOn).toBe(true);
    expect(u.lookAmt).toBe(0.8);
    expect(u.grain[0]).toBeGreaterThan(0);
    expect(u.fade[0]).toBeGreaterThan(0);
  });

  it('on is false exactly when every effective value is neutral and no look is drawn', () => {
    expect(adjustUniforms({}, { def: film, amount: 0 }, true, F).on).toBe(false);
    expect(U({ 'adjust.vibrance': 0.51 }).on).toBe(true);
    expect(U({ 'adjust.vignette': 0.01 }).on).toBe(true);
  });

  it('adjustWanted: any non-neutral user value, or any look (resident or not)', () => {
    expect(adjustWanted({}, null)).toBe(false);
    expect(adjustWanted({ 'adjust.tint': 0.5, 'adjust.grain': 0 }, null)).toBe(false);
    expect(adjustWanted({ 'adjust.grain': 0.2 }, null)).toBe(true);
    expect(adjustWanted({}, { id: 'ccd' })).toBe(true);
  });
});

describe('picture frame and grain size (step-2 spec §4.4–4.5)', () => {
  it('frameFor: the whole source by default, a camera ratio crop, degenerate rects fall back to the whole source', () => {
    expect(frameFor({ width: 2048, height: 1536 })).toEqual({ vMap: [1, 1, 0, 0], vSize: [2048, 1536], fullShortEdge: 1536, seed: 0 });
    const crop = frameFor({ width: 1280, height: 720 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, 9);
    expect(crop.vMap).toEqual([2, 1, -0.5, 0]);
    expect(crop.vSize).toEqual([640, 720]);
    expect(crop.seed).toBe(9);
    for (const bad of [{ x: 0, y: 0, w: 0, h: 1 }, { x: Number.NaN, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: -1 }, null, undefined])
      expect(frameFor({ width: 640, height: 480 }, bad).vMap).toEqual([1, 1, 0, 0]);
    expect(frameFor({ width: 0, height: 0 }).vSize).toEqual([1, 1]);
    const u = adjustUniforms({ 'adjust.vignette': 1, 'adjust.grain': 1 }, null, false, frameFor({ width: 0, height: 0 }, { x: 0, y: 0, w: 0, h: 0 }));
    for (const v of adjustRgb(grey(0.5), u, [0.3, 0.7])) expect(Number.isFinite(v)).toBe(true);
  });

  it('grain cells follow fullShortEdge (1 px at 1080) and damp below 1 px per cell; thumbnails use 1 px cells at 0.6', () => {
    const at1080 = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 1080, height: 1920 }));
    expect(at1080.grainScale).toEqual([1080, 1920]);
    expect(at1080.grain[0]).toBeCloseTo(0.08, 12);
    const preview = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 2048, height: 1536 }));
    expect(preview.grainScale[0]).toBeCloseTo(2048 / (1536 / 1080), 9);
    const tierL = adjustUniforms({ 'adjust.grain': 1 }, null, false, frameFor({ width: 540, height: 960 }));
    expect(tierL.grain[0]).toBeCloseTo(0.08 * 0.5, 12);
    const thumb = adjustUniforms({ 'adjust.grain': 1 }, null, false, { ...frameFor({ width: 96, height: 96 }), thumb: true });
    expect(thumb.grainScale).toEqual([96, 96]);
    expect(thumb.grain[0]).toBeCloseTo(0.08 * 0.6, 12);
    expect(adjustUniforms({}, null, false, frameFor({ width: 8, height: 8 }, null, 5)).seedMix).toBe(seedMix(5));
  });

  it('grain std on flat grey is proportional to 顆粒 (within 5 %)', () => {
    const std = (v: number) => {
      const u = U({ 'adjust.grain': v });
      let s1 = 0;
      let s2 = 0;
      let n = 0;
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) {
          const o = adjustRgb(grey(0.5), u, [(x + 0.5) / 1080, (y + 0.5) / 1080])[0];
          s1 += o;
          s2 += o * o;
          n++;
        }
      return Math.sqrt(s2 / n - (s1 / n) ** 2);
    };
    expect(Math.abs(std(1) / std(0.5) - 2)).toBeLessThan(0.1);
  });

  it('tile independence: a 64×64 region through two different windows gives the same grain and vignette', () => {
    const W = 4032;
    const H = 3024;
    const whole: AdjustFrame = { vMap: [1, 1, 0, 0], vSize: [W, H], fullShortEdge: H, seed: 0 };
    const [x0, y0, tw, th] = [1024, 512, 1024, 1024];
    const tile: AdjustFrame = { vMap: [tw / W, th / H, x0 / W, y0 / H], vSize: [W, H], fullShortEdge: H, seed: 0 };
    const vals = { 'adjust.grain': 1, 'adjust.vignette': 0.6 };
    const a = adjustUniforms(vals, null, false, whole);
    const b = adjustUniforms(vals, null, false, tile);
    for (let j = 0; j < 64; j++)
      for (let i = 0; i < 64; i++) {
        const ga = adjustRgb(grey(0.5), a, [(x0 + 100 + i + 0.5) / W, (y0 + 200 + j + 0.5) / H]);
        const gb = adjustRgb(grey(0.5), b, [(100 + i + 0.5) / tw, (200 + j + 0.5) / th]);
        expect(Math.abs(ga[0] - gb[0])).toBeLessThan(1e-6);
      }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/adjustMath.test.ts`
Expected: FAIL — `adjustRgb` (and the other new names) are not exported.

- [x] **Step 3: Append the stages to `src/engine/adjustMath.ts`**

Change the type import at the top to `import type { AdjustId, LookDef, Rect } from '../types';` and append:

```ts
/** effective shader-space values within this distance of neutral count as neutral */
const EPS = 1e-4;
const clampS = (v: number) => (v <= -1 ? -1 : v >= 1 ? 1 : v);
const fract = (x: number) => x - Math.floor(x);

export function neutralAdjust(id: AdjustId): number {
  return ADJUST_ONE_WAY.has(id) ? 0 : 0.5;
}

/** `v` is a shader-space value (s ∈ [−1, 1] bidirectional, v ∈ [0, 1] one-way) */
export function isNeutralAdjust(id: AdjustId, v: number): boolean {
  return ADJUST_ONE_WAY.has(id) ? !(v > EPS) : !(Math.abs(v) > EPS);
}

// ───────────── tone curve: 亮度, 對比, 高光, 陰影 (step-2 spec §4.2) ─────────────

export interface CurveKnots {
  /** y at x_i = i/8, i = 0…8 */
  y: number[];
  /** dy/dx at the knots (Fritsch–Carlson) */
  m: number[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** normalized logistic S-curve through (0, 0), (½, ½), (1, 1) */
function sCurve(y: number, k: number): number {
  const lo = sigmoid(-k / 2);
  const hi = sigmoid(k / 2);
  return (sigmoid(k * (y - 0.5)) - lo) / (hi - lo);
}
function sCurveInv(y: number, k: number): number {
  const lo = sigmoid(-k / 2);
  const hi = sigmoid(k / 2);
  const t = Math.min(1 - 1e-12, Math.max(1e-12, lo + y * (hi - lo)));
  return 0.5 + Math.log(t / (1 - t)) / k;
}

/** Fritsch–Carlson monotone tangents: the algorithm of scripts/gen-luts.mjs curve(), ported */
function fritschCarlson(y: readonly number[], h: number): number[] {
  const n = y.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / h);
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

/** The 9 knots of the luma curve for shader-space 亮度 sb, 對比 sc, 高光 sh, 陰影 ss (each −1…1). */
export function curveKnots(sb: number, sc: number, sh: number, ss: number): CurveKnots {
  const k = ADJUST_K;
  const y: number[] = [];
  for (let i = 0; i < 9; i++) {
    let v = (i / 8) ** (2 ** (-k.bright * sb));
    if (sc > 1e-3) v = sCurve(v, k.contrastUp * sc);
    else if (sc < -1e-3) v = sCurveInv(v, k.contrastDown * -sc);
    v += k.toneKnot * (ss * k.shadowW[i] + sh * k.highlightW[i]);
    y.push(clamp01(v));
  }
  // black and white stay fixed (曝光 is the item that moves white)
  y[0] = 0;
  y[8] = 1;
  for (let i = 1; i < 9; i++) y[i] = Math.max(y[i], y[i - 1]);
  return { y, m: fritschCarlson(y, 1 / 8) };
}

/** Cubic Hermite through the knots: the shader's adjCurve(). */
export function curveAt(k: CurveKnots, Y: number): number {
  const t = clamp01(Y) * 8;
  const i = Math.min(Math.floor(t), 7);
  const f = t - i;
  const f2 = f * f;
  const f3 = f2 * f;
  const v =
    (2 * f3 - 3 * f2 + 1) * k.y[i] + (f3 - 2 * f2 + f) * (k.m[i] / 8) + (-2 * f3 + 3 * f2) * k.y[i + 1] + (f3 - f2) * (k.m[i + 1] / 8);
  return clamp01(v);
}

// ───────────── effective values and uniforms (step-2 spec §4.3, §4.5) ─────────────

/** What the user stored for the 12 items, 0..1 (missing or non-finite → neutral). */
export type AdjustValues = Readonly<Partial<Record<AdjustId, number>>>;

/**
 * Shader-space values with the look's offsets added: s ∈ [−1, 1] for bidirectional items, v ∈ [0, 1] for one-way
 * items. `amount` is the look's 程度; `look` null (or not drawn) adds nothing.
 */
export function effectiveAdjust(values: AdjustValues, look: LookDef | null, amount: number): Record<AdjustId, number> {
  const out = {} as Record<AdjustId, number>;
  const a = look ? clamp01(Number.isFinite(amount) ? amount : 0) : 0;
  for (const id of ADJUST_IDS) {
    const raw = values[id];
    const u = typeof raw === 'number' && Number.isFinite(raw) ? clamp01(raw) : neutralAdjust(id);
    const o = look?.offsets[id] ?? 0;
    out[id] = ADJUST_ONE_WAY.has(id) ? clamp01(u + (a * o) / 100) : clampS((u - 0.5) * 2 + (a * o) / 50);
  }
  return out;
}

/** The picture V that vignette and grain treat as "the photo" (step-2 spec §4.5). */
export interface AdjustFrame {
  /** V = vUv·(vMap[0], vMap[1]) + (vMap[2], vMap[3]) */
  vMap: readonly [number, number, number, number];
  /** V width and height in output pixels */
  vSize: readonly [number, number];
  /** short edge of the photo O in output pixels: one grain cell = fullShortEdge / 1080 px */
  fullShortEdge: number;
  seed: number;
  /** thumbnails: 1 px cells at ADJUST_K.thumbGrain amplitude */
  thumb?: boolean;
}

const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** The frame of a render of `size` whose picture is `pictureFrame` (source UV); invalid or absent → the whole source. */
export function frameFor(size: { width: number; height: number }, pictureFrame?: Rect | null, seed = 0): AdjustFrame {
  const pf = pictureFrame;
  const ok = !!pf && [pf.x, pf.y, pf.w, pf.h].every((v) => Number.isFinite(v)) && pf.w > 0 && pf.h > 0;
  const r = ok ? pf : WHOLE;
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  return {
    // + 0 turns −0 into 0 (stable keys and equality)
    vMap: [1 / r.w, 1 / r.h, -r.x / r.w + 0, -r.y / r.h + 0],
    vSize: [r.w * W, r.h * H],
    fullShortEdge: Math.min(W, H),
    seed: Number.isFinite(seed) ? seed >>> 0 : 0,
  };
}

/** The uniforms of the composite's 調節 program (shaders/adjust.ts), and the input of adjustRgb(). */
export interface AdjustUniforms {
  /** the 調節 program draws this frame: any effective value non-neutral, or a drawable look */
  on: boolean;
  /** uAdjustOn: run adjustStage() */
  adjustOn: boolean;
  /** uLookAmt: 質感 LUT mix (0 = not drawn) */
  lookAmt: number;
  /** uExp: gain 2^s (1 = off), knee, shoulder white Lw (0 = no shoulder), shoulder exponent */
  exp: [number, number, number, number];
  /** uCurveOn, uCurve[9] as 18 floats: (y_i, m_i / 8) */
  curveOn: boolean;
  curve: number[];
  /** uWbOn, uWb: linear-light gains, normalized so grey keeps its luminance */
  wbOn: boolean;
  wb: [number, number, number];
  /** uSat: (1 + s_σ, vibrance·s_ν, skin guard, on) */
  sat: [number, number, number, number];
  /** uSkinA: (hue centre, hue half-width, S-in lo, S-in hi); uSkinB: (S-out lo, S-out hi, V lo, V hi); uTaper */
  skinA: [number, number, number, number];
  skinB: [number, number, number, number];
  taper: [number, number];
  /** uFade: (lift, scale, chroma); lift 0 = off */
  fade: [number, number, number];
  /** uVig: (strength, inner, outer, exponent); strength 0 = off */
  vig: [number, number, number, number];
  /** uVAspect: V width / height */
  vAspect: number;
  vMap: [number, number, number, number];
  /** uGrain: (amplitude, base, mid, 0); amplitude 0 = off */
  grain: [number, number, number, number];
  /** uGrainScale: lattice cells per V unit */
  grainScale: [number, number];
  /** uSeedMix (uint) */
  seedMix: number;
}

/** Uniforms of one frame. `lookReady` false → the look is drawn neither in part nor in full (spec §1.4). */
export function adjustUniforms(
  values: AdjustValues,
  look: { def: LookDef; amount: number } | null,
  lookReady: boolean,
  frame: AdjustFrame,
): AdjustUniforms {
  const k = ADJUST_K;
  const draw = look !== null && lookReady;
  const e = effectiveAdjust(values, draw ? look.def : null, draw ? look.amount : 0);
  const lookAmt = draw ? clamp01(Number.isFinite(look.amount) ? look.amount : 0) : 0;
  const adjustOn = ADJUST_IDS.some((id) => !isNeutralAdjust(id, e[id]));

  const se = e['adjust.exposure'];
  const gain = Math.abs(se) > EPS ? 2 ** (k.exposureEv * se) : 1;
  const shoulder = gain > 1;
  const exp: AdjustUniforms['exp'] = [gain, k.knee, shoulder ? gain : 0, shoulder ? (gain - k.knee) / (1 - k.knee) : 1];

  const sb = e['adjust.brightness'];
  const sc = e['adjust.contrast'];
  const sh = e['adjust.highlights'];
  const ss = e['adjust.shadows'];
  const curveOn = [sb, sc, sh, ss].some((v) => Math.abs(v) > EPS);
  const knots = curveOn ? curveKnots(sb, sc, sh, ss) : curveKnots(0, 0, 0, 0);
  const curve: number[] = [];
  for (let i = 0; i < 9; i++) curve.push(knots.y[i], knots.m[i] / 8);

  const st = e['adjust.temperature'];
  const sn = e['adjust.tint'];
  const wbOn = Math.abs(st) > EPS || Math.abs(sn) > EPS;
  const gr = 2 ** (k.tempGain * st + k.tintRB * sn);
  const gg = 2 ** (-k.tintGreen * sn);
  const gb = 2 ** (-k.tempGain * st + k.tintRB * sn);
  const norm = luma([gr, gg, gb]);
  const wb: AdjustUniforms['wb'] = wbOn ? [gr / norm, gg / norm, gb / norm] : [1, 1, 1];

  const sSat = e['adjust.saturation'];
  const sVib = e['adjust.vibrance'];
  const satOn = Math.abs(sSat) > EPS || Math.abs(sVib) > EPS;

  const vf = e['adjust.fade'];
  const vg = e['adjust.vignette'];
  const vn = e['adjust.grain'];
  const cellPx = frame.thumb ? 1 : frame.fullShortEdge / k.grainRef;
  const amp = vn > EPS ? k.grainAmp * vn * Math.min(1, cellPx) * (frame.thumb ? k.thumbGrain : 1) : 0;

  return {
    on: adjustOn || lookAmt > 0,
    adjustOn,
    lookAmt,
    exp,
    curveOn,
    curve,
    wbOn,
    wb,
    sat: [1 + sSat, k.vibrance * sVib, k.skinGuard, satOn ? 1 : 0],
    skinA: [k.skinHue[0], k.skinHue[1], k.skinSatIn[0], k.skinSatIn[1]],
    skinB: [k.skinSatOut[0], k.skinSatOut[1], k.skinVal[0], k.skinVal[1]],
    taper: [k.taper[0], k.taper[1]],
    fade: vf > EPS ? [k.fadeLift * vf, 1 - (k.fadeLift + k.fadeWhite) * vf, 1 - k.fadeChroma * vf] : [0, 1, 1],
    vig: [vg > EPS ? k.vignette * vg : 0, k.vigInner, k.vigOuter, k.vigGamma],
    vAspect: frame.vSize[0] / frame.vSize[1],
    vMap: [frame.vMap[0], frame.vMap[1], frame.vMap[2], frame.vMap[3]],
    grain: [amp, k.grainBase, k.grainMid, 0],
    grainScale: [frame.vSize[0] / cellPx, frame.vSize[1] / cellPx],
    seedMix: seedMix(frame.seed),
  };
}

// ───────────── per-pixel reference: the shader's adjustStage() ─────────────

/** hue-safe luma change Y → Yn without leaving the gamut (step-2 spec §4.2) */
function toLuma(c: number[], Y: number, Yn: number): void {
  if (Yn <= Y) {
    const s = Yn / Math.max(Y, 1e-5);
    for (let i = 0; i < 3; i++) c[i] *= s;
  } else {
    const s = (1 - Yn) / Math.max(1 - Y, 1e-5);
    for (let i = 0; i < 3; i++) c[i] = 1 - (1 - c[i]) * s;
  }
}

/**
 * adjustStage() on one encoded colour (0..1) at source uv. Returns a new clamped colour; with `u.adjustOn` false it
 * returns the clamped input, exactly as the composite skips the stage.
 */
export function adjustRgb(rgb: readonly number[], u: AdjustUniforms, uv: readonly [number, number]): [number, number, number] {
  const c = [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  if (!u.adjustOn) return [c[0], c[1], c[2]];
  // 曝光: linear-light gain with a shoulder back to white when brightening
  if (u.exp[0] !== 1) {
    const [g, knee, lw, a] = u.exp;
    for (let i = 0; i < 3; i++) {
      let x = lin(c[i]) * g;
      if (lw > 0 && x >= knee) {
        const t = clamp01((x - knee) / (lw - knee));
        x = knee + (1 - knee) * (1 - (1 - t) ** a);
      }
      c[i] = enc(clamp01(x));
    }
  }
  // 亮度／對比／高光／陰影: one monotone curve on encoded luma, hue kept
  if (u.curveOn) {
    const knots: CurveKnots = { y: [], m: [] };
    for (let i = 0; i < 9; i++) {
      knots.y.push(u.curve[i * 2]);
      knots.m.push(u.curve[i * 2 + 1] * 8);
    }
    const Y = luma(c);
    toLuma(c, Y, curveAt(knots, Y));
  }
  // 色溫／色調: linear-light white balance
  if (u.wbOn) for (let i = 0; i < 3; i++) c[i] = enc(clamp01(lin(c[i]) * u.wb[i]));
  // 飽和／鮮艷度: chroma about luma; vibrance weighted by (1 − S) with a skin guard; boosts tapered near the gamut
  if (u.sat[3] > 0) {
    const mx = Math.max(c[0], c[1], c[2]);
    const mn = Math.min(c[0], c[1], c[2]);
    const d = mx - mn;
    const S = d / Math.max(mx, 1e-5);
    let h = 0;
    if (d > 1e-5) {
      if (mx === c[0]) h = (c[1] - c[2]) / d;
      else if (mx === c[1]) h = 2 + (c[2] - c[0]) / d;
      else h = 4 + (c[0] - c[1]) / d;
      h = fract(h / 6);
    }
    const dh = Math.abs(fract(h - u.skinA[0] + 0.5) - 0.5);
    const win = dh >= u.skinA[1] ? 0 : 0.5 * (1 + Math.cos((Math.PI * dh) / u.skinA[1]));
    const skin =
      win * smoothstep(u.skinA[2], u.skinA[3], S) * (1 - smoothstep(u.skinB[0], u.skinB[1], S)) * smoothstep(u.skinB[2], u.skinB[3], mx);
    const wv = (u.sat[1] > 0 ? 1 - S : 1) * (1 - u.sat[2] * skin);
    let kk = u.sat[0] * (1 + u.sat[1] * wv);
    if (kk > 1) kk = 1 + (kk - 1) * (1 - smoothstep(u.taper[0], u.taper[1], S));
    const Y = luma(c);
    for (let i = 0; i < 3; i++) c[i] = clamp01(Y + (c[i] - Y) * kk);
  }
  // 褪色: black lift, white drop, chroma loss
  if (u.fade[0] > 0) {
    for (let i = 0; i < 3; i++) c[i] = u.fade[0] + c[i] * u.fade[1];
    const Yf = luma(c);
    for (let i = 0; i < 3; i++) c[i] = Yf + (c[i] - Yf) * u.fade[2];
  }
  const Vx = uv[0] * u.vMap[0] + u.vMap[2];
  const Vy = uv[1] * u.vMap[1] + u.vMap[3];
  // 暗角: radial gain in V, aspect-corrected, applied in encoded space
  if (u.vig[0] > 0) {
    const r = Math.hypot((Vx - 0.5) * u.vAspect, Vy - 0.5) / Math.hypot(0.5 * u.vAspect, 0.5);
    const m = (1 - u.vig[0] * smoothstep(u.vig[1], u.vig[2], r)) ** u.vig[3];
    for (let i = 0; i < 3; i++) c[i] *= m;
  }
  // 顆粒: monochrome value noise on the global V lattice, strongest in the midtones
  if (u.grain[0] > 0) {
    const n = grainAt(Vx * u.grainScale[0], Vy * u.grainScale[1], u.seedMix);
    const Y = luma(c);
    const a = n * u.grain[0] * (u.grain[1] + u.grain[2] * 4 * Y * (1 - Y));
    for (let i = 0; i < 3; i++) c[i] = clamp01(c[i] + a);
  }
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/** The photo asks for the 調節 program: a non-neutral user value, or a look (whether or not its LUT is resident). */
export function adjustWanted(values: AdjustValues, look: { id: string } | null): boolean {
  if (look !== null) return true;
  return ADJUST_IDS.some((id) => {
    const v = values[id];
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v - neutralAdjust(id)) > EPS;
  });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/adjustMath.test.ts src/engine/adjustMath.grain.test.ts && npm run typecheck`
Expected: PASS. The tolerances were checked against this exact code while writing the plan (亮度 mid 0.6527 / 0.3243; 曝光 ratio 2.0000 / 0.5000; vibrance skin/non-skin gain ratio 0.46; 褪色 40.8 / 244.8; vignette corner exactly 0.3^(1/2.2); grain std ratio 2.000; ±0.1-unit continuity ≤ 1 level for all 21 directions).

- [x] **Step 5: Commit**

```bash
git add src/engine/adjustMath.ts src/engine/adjustMath.test.ts
git commit -m "v0.4 step 2: 調節 stages, effective values, picture frame and uniforms (CPU reference)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The 調節 composite variant, its CPU port and the hash pins

**Files:**
- Create: `src/engine/shaders/adjust.ts`, `src/engine/shaderHash.ts`, `src/engine/compositeCpu.ts`
- Modify: `src/engine/shaders/composite.ts:9-15` (Modified list), `:46-59` (units), `:61` (`COMPOSITE_FS` → `compositeFs`), `:72` (uniforms), `:156-158` (library splice), `:199-204` (call splice)
- Modify: `src/engine/passes/reshapeCpu.test.ts:19-27` (use the moved `shaderHash`)
- Test: `src/engine/compositeCpu.test.ts`

**Interfaces:**
- Consumes: Task 5 (`AdjustUniforms`, `adjustRgb`, `adjustUniforms`, `frameFor`, `clamp01`); step 1's `COMPOSITE_FS` text (its hash is recorded in Step 1 below, before anything changes).
- Produces:
  - `GRAIN_HASH_GLSL: string`; `ADJUST_GLSL: string` (declares the uniforms listed in `AdjustUniforms` and `vec3 adjustStage(vec3 c, vec2 uv)`)
  - `compositeFs(opts: { adjust: boolean }): string`; `COMPOSITE_FS = compositeFs({ adjust: false })`; `COMPOSITE_UNITS.look = 8`
  - `shaderHash(src: string): string` (FNV-1a 32 over whitespace-collapsed text, 8 hex digits)
  - `lut64Cpu(lut: ArrayLike<number>, r: number, g: number, b: number): [number, number, number]`
  - `compositeCpu(src: ArrayLike<number>, width: number, height: number, u: AdjustUniforms, lookLut: ArrayLike<number> | null): Uint8ClampedArray`

- [x] **Step 1: Record the step-1 composite hash before touching the shader**

Run:

```bash
node --input-type=module -e "
import { COMPOSITE_FS } from './src/engine/shaders/composite.ts';
let h = 0x811c9dc5;
for (const ch of COMPOSITE_FS.replace(/\s+/g, ' ').trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
console.log(h.toString(16).padStart(8, '0'));
"
```

Expected: 8 hex digits. v0.3's text (`892ea61`) hashes to `c960b9db`; step 1 changed it (per-face 磨皮／紅潤 strengths, C §3.8 `composite.ts:158-201`): at `9eec432` it prints `0cc1e52b`. Whatever is printed is the value to pin — it is measured, not designed. Call the printed value `STEP1_COMPOSITE_HASH`; Step 2 pastes it.

If Node cannot import the file (step 1 gave `composite.ts` an extensionless runtime import), measure it in Vitest instead, still before any edit: create `src/engine/compositeBase.tmp.test.ts` with

```ts
import { it } from 'vitest';
import { COMPOSITE_FS } from './shaders/composite';
it('prints the step-1 composite hash', () => {
  let h = 0x811c9dc5;
  for (const ch of COMPOSITE_FS.replace(/\s+/g, ' ').trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  console.log('STEP1_COMPOSITE_HASH', h.toString(16).padStart(8, '0'));
});
```

run `npx vitest run src/engine/compositeBase.tmp.test.ts`, read the printed value, and delete the file (it is never committed).

- [x] **Step 2: Write the failing tests**

Create `src/engine/compositeCpu.test.ts`. In the first line of code below, replace the string `PASTE_STEP1_HASH` with the 8 hex digits printed in Step 1 (the value is measured, not designed). The 調節-variant pin starts as `'00000000'` and is set in Step 8.

```ts
// P5's 質感 + 調節 stages: the CPU port is pinned to both composite variants (step-2 spec §4.7). The e2e
// composite.spec.ts compares the real shader with compositeCpu() pixel by pixel; these are the cheap tripwires.
import { describe, expect, it } from 'vitest';
import { adjustUniforms, frameFor } from './adjustMath';
import { compositeCpu, lut64Cpu } from './compositeCpu';
import { shaderHash } from './shaderHash';
import { ADJUST_GLSL } from './shaders/adjust';
import { COMPOSITE_FS, COMPOSITE_UNITS, compositeFs } from './shaders/composite';

/** the composite text step 1 left, recorded before step 2 touched composite.ts */
const STEP1_COMPOSITE_HASH = 'PASTE_STEP1_HASH';

/** identity 512² LUT in the GPUImage 64³ layout */
function identityLut(): Uint8Array {
  const d = new Uint8Array(512 * 512 * 4);
  for (let b = 0; b < 64; b++)
    for (let g = 0; g < 64; g++)
      for (let r = 0; r < 64; r++) {
        const i = ((Math.floor(b / 8) * 64 + g) * 512 + (b % 8) * 64 + r) * 4;
        d[i] = Math.round((r * 255) / 63);
        d[i + 1] = Math.round((g * 255) / 63);
        d[i + 2] = Math.round((b * 255) / 63);
        d[i + 3] = 255;
      }
  return d;
}

describe('composite variants (step-2 spec §4.1, §4.7)', () => {
  it('the base variant is the step-1 composite, unchanged (parity by construction)', () => {
    expect(COMPOSITE_FS).toBe(compositeFs({ adjust: false }));
    expect(shaderHash(compositeFs({ adjust: false }))).toBe(STEP1_COMPOSITE_HASH);
  });

  it('the 調節 variant is pinned: an edit must be mirrored in compositeCpu.ts / adjustMath.ts (then update this hash)', () => {
    expect(shaderHash(compositeFs({ adjust: true }))).toBe('00000000');
  });

  it('splice: the 調節 program holds ADJUST_GLSL and calls adjustStage once, after the 濾鏡 and 質感 LUTs; the base holds neither', () => {
    const a = compositeFs({ adjust: true });
    expect(a).toContain(ADJUST_GLSL);
    expect(a.split('adjustStage(color, vUv)').length - 1).toBe(1);
    expect(a.indexOf('lut64(uLookLut')).toBeGreaterThan(a.indexOf('lut64(uFilterLut'));
    expect(a.indexOf('adjustStage(color, vUv)')).toBeGreaterThan(a.indexOf('lut64(uLookLut'));
    const base = compositeFs({ adjust: false });
    expect(base).not.toContain('uLookLut');
    expect(base).not.toContain('adjustStage');
    expect(COMPOSITE_UNITS.look).toBe(8);
  });

  it('every integer of the grain hash is highp (the composite has no default int precision; mediump may be 16-bit on iOS)', () => {
    // declarations only: `uint x`, `highp uint r0 =`, `ivec2 i =`; constructor calls such as `uint(i.y)` do not match
    const decls = [...ADJUST_GLSL.matchAll(/(\w+\s+)?\b(uint|uvec[234]|ivec[234])\s+[A-Za-z_]\w*\s*[=;,()]/g)];
    expect(decls.length).toBeGreaterThanOrEqual(10);
    for (const m of decls) expect(m[1]?.trim(), m[0]).toBe('highp');
  });
});

describe('compositeCpu', () => {
  const W = 32;
  const H = 16;
  const src = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    src[i * 4] = (i * 37) % 256;
    src[i * 4 + 1] = (i * 91) % 256;
    src[i * 4 + 2] = (i * 13) % 256;
    src[i * 4 + 3] = 255;
  }
  const frame = frameFor({ width: W, height: H });

  it('is the identity with neutral uniforms and no look', () => {
    expect(Array.from(compositeCpu(src, W, H, adjustUniforms({}, null, false, frame), null))).toEqual(Array.from(src));
  });

  it('lut64Cpu with an identity LUT returns the colour (GPUImage lookup math)', () => {
    const lut = identityLut();
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.73, 0.11, 0.42]]) {
      const o = lut64Cpu(lut, c[0], c[1], c[2]);
      for (let k = 0; k < 3; k++) expect(Math.abs(o[k] - c[k])).toBeLessThan(0.5 / 255);
    }
  });

  it('a look mixes its LUT by lookAmt, then the 調節 stages run, rounding once', () => {
    const lut = identityLut();
    for (let i = 0; i < lut.length; i += 4) lut[i] = 255 - lut[i]; // invert red
    const u = { ...adjustUniforms({}, null, false, frame), on: true, lookAmt: 0.5 };
    const out = compositeCpu(src, W, H, u, lut);
    // red becomes mix(r, 1 − r, 0.5) = 0.5 (± the LUT's 64-step quantization)
    for (let i = 0; i < W * H; i++) expect(Math.abs(out[i * 4] - 128)).toBeLessThanOrEqual(3);
    expect(out[3]).toBe(255);
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/engine/compositeCpu.test.ts`
Expected: FAIL — `Failed to resolve import "./compositeCpu"` (and `./shaderHash`, `./shaders/adjust`).

- [x] **Step 4: Move the shader hash**

Create `src/engine/shaderHash.ts`:

```ts
/** FNV-1a 32 of a shader with its whitespace collapsed: the tripwire that ties a shader to its CPU port. */
export function shaderHash(src: string): string {
  let h = 0x811c9dc5;
  for (const ch of src.replace(/\s+/g, ' ').trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
```

In `src/engine/passes/reshapeCpu.test.ts` delete the local `/** FNV-1a 32 of the shader with whitespace collapsed */ function shaderHash(src: string): string {…}` (lines 19-27 at `9eec432`) and add `import { shaderHash } from '../shaderHash';` with the other imports. The reshape pin keeps its value.

- [x] **Step 5: The 調節 GLSL**

Create `src/engine/shaders/adjust.ts`:

```ts
// 調節 stages of P5 (v0.4 step-2 spec §4.1–4.4), spliced into compositeFs({adjust: true}) after the 質感 LUT.
// Original work for this project (no GPUPixel code): IEC 61966-2-1 sRGB transfer, Rec. 709 luma, a monotone cubic
// luma curve whose knots and tangents come from src/engine/adjustMath.ts, and the lowbias32 integer hash (constants
// from Chris Wellons' hash-prospector, public domain). Every tunable constant arrives as a uniform built by
// adjustUniforms(), so tuning never changes this text (the pins in compositeCpu.test.ts). CPU port: adjustRgb().

/**
 * lowbias32 + lattice value; also used by the bench's bit-exact probe (src/bench/adjustBench.ts). Every integer is
 * declared `highp`: the composite declares no default int precision, so a bare `uint` would be mediump, which a GPU
 * may run in 16 bits (GLSL ES 3.00 §4.5.2) — only highp uint is a 32-bit wrapping integer on every device.
 */
export const GRAIN_HASH_GLSL = /* glsl */ `
highp uint lowbias32(highp uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float latticeValue(highp uint ix, highp uint rowHash) {
  return float(lowbias32(ix ^ rowHash) >> 8u) * (1.0 / 8388608.0) - 1.0;
}`;

export const ADJUST_GLSL = /* glsl */ `
uniform float uAdjustOn;
uniform vec4 uExp;
uniform float uCurveOn;
uniform vec2 uCurve[9];
uniform float uWbOn;
uniform vec3 uWb;
uniform vec4 uSat;
uniform vec4 uSkinA;
uniform vec4 uSkinB;
uniform vec2 uTaper;
uniform vec3 uFade;
uniform vec4 uVig;
uniform float uVAspect;
uniform vec4 uVMap;
uniform vec4 uGrain;
uniform vec2 uGrainScale;
uniform highp uint uSeedMix;

const vec3 ADJ_L709 = vec3(0.2126, 0.7152, 0.0722);
${GRAIN_HASH_GLSL}

vec3 adjLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 adjEnc(vec3 x) {
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}

float adjCurve(float Y) {
  float t = clamp(Y, 0.0, 1.0) * 8.0;
  int i = min(int(floor(t)), 7);
  float f = t - float(i);
  float f2 = f * f;
  float f3 = f2 * f;
  vec2 a = uCurve[i];
  vec2 b = uCurve[i + 1];
  float v = (2.0 * f3 - 3.0 * f2 + 1.0) * a.x + (f3 - 2.0 * f2 + f) * a.y + (-2.0 * f3 + 3.0 * f2) * b.x + (f3 - f2) * b.y;
  return clamp(v, 0.0, 1.0);
}

vec3 adjToLuma(vec3 c, float Y, float Yn) {
  return Yn <= Y ? c * (Yn / max(Y, 1e-5)) : 1.0 - (1.0 - c) * ((1.0 - Yn) / max(1.0 - Y, 1e-5));
}

float adjGrain(vec2 P) {
  vec2 p0 = floor(P);
  vec2 f = P - p0;
  highp ivec2 i = ivec2(p0);
  highp uint r0 = lowbias32(uint(i.y) ^ uSeedMix);
  highp uint r1 = lowbias32(uint(i.y + 1) ^ uSeedMix);
  highp uint x0 = uint(i.x);
  highp uint x1 = uint(i.x + 1);
  float n = mix(mix(latticeValue(x0, r0), latticeValue(x1, r0), f.x), mix(latticeValue(x0, r1), latticeValue(x1, r1), f.x), f.y);
  vec2 g = (1.0 - f) * (1.0 - f) + f * f;
  return n * inversesqrt(g.x * g.y);
}

vec3 adjustStage(vec3 c, vec2 uv) {
  c = clamp(c, 0.0, 1.0);
  // 曝光: linear-light gain, shoulder back to white when brightening
  if (uExp.x != 1.0) {
    vec3 x = adjLin(c) * uExp.x;
    if (uExp.z > 0.0) {
      vec3 t = clamp((x - uExp.y) / (uExp.z - uExp.y), 0.0, 1.0);
      vec3 sh = uExp.y + (1.0 - uExp.y) * (1.0 - pow(1.0 - t, vec3(uExp.w)));
      x = mix(x, sh, step(vec3(uExp.y), x));
    }
    c = adjEnc(clamp(x, 0.0, 1.0));
  }
  // 亮度／對比／高光／陰影: one monotone curve on encoded luma, hue kept
  if (uCurveOn > 0.0) {
    float Y = dot(c, ADJ_L709);
    c = adjToLuma(c, Y, adjCurve(Y));
  }
  // 色溫／色調: linear-light white balance
  if (uWbOn > 0.0) c = adjEnc(clamp(adjLin(c) * uWb, 0.0, 1.0));
  // 飽和／鮮艷度: chroma about luma, vibrance weighted by (1 − S) with a skin guard, boosts tapered near the gamut
  if (uSat.w > 0.0) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    float S = d / max(mx, 1e-5);
    float h = 0.0;
    if (d > 1e-5) {
      if (mx == c.r) h = (c.g - c.b) / d;
      else if (mx == c.g) h = 2.0 + (c.b - c.r) / d;
      else h = 4.0 + (c.r - c.g) / d;
      h = fract(h / 6.0);
    }
    float dh = abs(fract(h - uSkinA.x + 0.5) - 0.5);
    float win = dh >= uSkinA.y ? 0.0 : 0.5 * (1.0 + cos(3.14159265 * dh / uSkinA.y));
    float skin = win * smoothstep(uSkinA.z, uSkinA.w, S) * (1.0 - smoothstep(uSkinB.x, uSkinB.y, S)) * smoothstep(uSkinB.z, uSkinB.w, mx);
    float wv = (uSat.y > 0.0 ? 1.0 - S : 1.0) * (1.0 - uSat.z * skin);
    float k = uSat.x * (1.0 + uSat.y * wv);
    if (k > 1.0) k = 1.0 + (k - 1.0) * (1.0 - smoothstep(uTaper.x, uTaper.y, S));
    float Y = dot(c, ADJ_L709);
    c = clamp(Y + (c - Y) * k, 0.0, 1.0);
  }
  // 褪色: black lift, white drop, chroma loss
  if (uFade.x > 0.0) {
    c = uFade.x + c * uFade.y;
    float Yf = dot(c, ADJ_L709);
    c = Yf + (c - Yf) * uFade.z;
  }
  vec2 V = uv * uVMap.xy + uVMap.zw;
  // 暗角: radial gain in V, aspect-corrected, applied in encoded space
  if (uVig.x > 0.0) {
    float r = length((V - 0.5) * vec2(uVAspect, 1.0)) / length(vec2(0.5 * uVAspect, 0.5));
    c *= pow(1.0 - uVig.x * smoothstep(uVig.y, uVig.z, r), uVig.w);
  }
  // 顆粒: monochrome value noise on the global V lattice, strongest in the midtones
  if (uGrain.x > 0.0) {
    float n = adjGrain(V * uGrainScale);
    float Y = dot(c, ADJ_L709);
    c = clamp(c + n * uGrain.x * (uGrain.y + uGrain.z * 4.0 * Y * (1.0 - Y)), 0.0, 1.0);
  }
  return clamp(c, 0.0, 1.0);
}`;
```

(While writing this plan, this GLSL was compiled on Chromium/SwiftShader and compared with Task 5's `adjustRgb`: every item at ±max, all twelve together and grain at 2.8 px cells matched within 1 level, mean ≤ 0.003; and the full `compositeFs({adjust: true})`, spliced into the v0.3 composite, linked with 36 active uniforms. The plan check re-ran the `highp`-qualified text above under `precision highp float` only (no default int precision, as in the composite): it compiled, and with seven stages on — 曝光, 對比, 色溫, 鮮艷度, 褪色, 暗角, 顆粒 — matched `adjustRgb` with max ≤ 1 level at 1, 1.42 and 2.8 px cells; the probe of Task 16 was bit-exact on 4096 indices.)

- [x] **Step 6: Two composite variants from one source**

Edit `src/engine/shaders/composite.ts` (CRLF — use the Edit tool):
1. In the header's `Modified:` sentence (lines 9-15), insert before `output alpha is 1.0 (opaque export).` the text: `the 調節 variant (compositeFs({adjust: true})) adds a 質感 LUT mix (unit 8) and calls the 調節 stages of adjust.ts after the filter LUT;`.
2. Directly after the closing ` */` of the header comment add the line `import { ADJUST_GLSL } from './adjust';`.
3. Replace the units comment and object (lines 46-59) with:

```ts
// P5 composite + present (RB §2.3 parts 1–2, §2.5). Draw with PRESENT_VS.
// Texture units: 0 src, 1 mean, 2 mask, 3 lookup_gray, 4 lookup_origin, 5 lookup_skin,
// 6 lookup_light, 7 filter LUT, 8 質感 LUT (調節 variant only).

export const COMPOSITE_UNITS = {
  src: 0,
  mean: 1,
  mask: 2,
  gray: 3,
  origin: 4,
  skin: 5,
  light: 6,
  filter: 7,
  look: 8,
} as const;
```

4. Replace the line `export const COMPOSITE_FS = /* glsl */ \`#version 300 es` with:

```ts
/** 質感 LUT mix, then the 調節 stages (spliced after the filter LUT of the 調節 variant only) */
const ADJUST_CALL = /* glsl */ `
  if (uLookAmt > 0.0) {
    vec3 a = clamp(color, 0.0, 1.0);
    color = mix(a, lut64(uLookLut, a), uLookAmt);
  }
  if (uAdjustOn > 0.0) color = adjustStage(color, vUv);`;

/**
 * P5 composite. `adjust: false` is the base program, the step-1 text unchanged (pinned in compositeCpu.test.ts);
 * `adjust: true` is the 調節 program: + uLookLut / uLookAmt, ADJUST_GLSL and the call after the filter LUT
 * (step-2 spec §4.1). The inserted parts are empty strings in the base, so its text only gains blank lines.
 */
export function compositeFs(opts: { adjust: boolean }): string {
  const a = opts.adjust;
  return /* glsl */ `#version 300 es
```

5. Inside the template:
   - change the line `uniform sampler2D uFilterLut;` to `uniform sampler2D uFilterLut;${a ? '\nuniform sampler2D uLookLut;\nuniform float uLookAmt;' : ''}` (the `\n` are escapes inside the single-quoted JS string);
   - between the closing `}` of `softLight(...)` and the empty line before `void main() {`, add a line `${a ? ADJUST_GLSL : ''}`;
   - between the closing `}` of the `if (uFilterAmt > 0.0) { … }` block and `  outColor = vec4(color, 1.0);`, replace the empty line with a line `${a ? ADJUST_CALL : ''}`.
6. The template's last line `}\`;` becomes `}\`;` followed by a line `}` (closing `compositeFs`), then a blank line and:

```ts
export const COMPOSITE_FS = compositeFs({ adjust: false });
```

- [x] **Step 7: The CPU port**

Create `src/engine/compositeCpu.ts`:

```ts
/*
 * CPU reference of P5's 質感 + 調節 stages (v0.4 step-2 spec §4.7) on an RGBA8 image whose skin stages are neutral
 * and whose 濾鏡 is 無 — exactly what the composite reads then, so GPU and CPU start from the same 8-bit values.
 *
 * lut64Cpu() is GPUImageLookupFilter's lookup math (the shader's lut64(), composite.ts), ported: two bilinear taps
 * (GL LINEAR, CLAMP_TO_EDGE) in the neighbouring blue slices, mixed by fract(b·63).
 *
 * GPUImage — Copyright (c) 2012, Brad Larson, Ben Cochran, Hugues Lismonde, Keitaroh Kobayashi,
 * Alaric Cole, Matthew Clark, Jacob Gundersen, Chris Williams. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted
 * provided that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list of conditions
 * and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright notice, this list of
 * conditions and the following disclaimer in the documentation and/or other materials provided
 * with the distribution.
 * Neither the name of the GPUImage framework nor the names of its contributors may be used to
 * endorse or promote products derived from this software without specific prior written
 * permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
import { adjustRgb, clamp01, type AdjustUniforms } from './adjustMath';

const LUT = 512;

/** GL LINEAR + CLAMP_TO_EDGE sample of a 512² RGBA8 texture at normalized (u, v): 0..1 RGB into out[o..o+2] */
function sample(lut: ArrayLike<number>, u: number, v: number, out: number[], o: number): void {
  const x = u * LUT - 0.5;
  const y = v * LUT - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = Math.min(LUT - 1, Math.max(0, x0));
  const cx1 = Math.min(LUT - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(LUT - 1, Math.max(0, y0));
  const cy1 = Math.min(LUT - 1, Math.max(0, y0 + 1));
  const i00 = (cy0 * LUT + cx0) * 4;
  const i10 = (cy0 * LUT + cx1) * 4;
  const i01 = (cy1 * LUT + cx0) * 4;
  const i11 = (cy1 * LUT + cx1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = lut[i00 + c] + (lut[i10 + c] - lut[i00 + c]) * fx;
    const bot = lut[i01 + c] + (lut[i11 + c] - lut[i01 + c]) * fx;
    out[o + c] = (top + (bot - top) * fy) / 255;
  }
}

/** The 512² / 64³ lookup of the shader's lut64() */
export function lut64Cpu(lut: ArrayLike<number>, r: number, g: number, b: number): [number, number, number] {
  const blue = b * 63;
  const q1 = Math.floor(blue);
  const q2 = Math.ceil(blue);
  const q1y = Math.floor(q1 / 8);
  const q1x = q1 - q1y * 8;
  const q2y = Math.floor(q2 / 8);
  const q2x = q2 - q2y * 8;
  const k = 1 / 8 - 1 / 512;
  const h = 0.5 / 512;
  const s = [0, 0, 0, 0, 0, 0];
  sample(lut, q1x / 8 + h + k * r, q1y / 8 + h + k * g, s, 0);
  sample(lut, q2x / 8 + h + k * r, q2y / 8 + h + k * g, s, 3);
  const f = blue - Math.floor(blue);
  return [s[0] + (s[3] - s[0]) * f, s[1] + (s[4] - s[1]) * f, s[2] + (s[5] - s[2]) * f];
}

/** P5's 質感 + 調節 on an RGBA8 image (row 0 = image top = vUv.y ≈ 0); alpha out = 255 like the composite. */
export function compositeCpu(
  src: ArrayLike<number>,
  width: number,
  height: number,
  u: AdjustUniforms,
  lookLut: ArrayLike<number> | null,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let c: number[] = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
      if (u.lookAmt > 0 && lookLut) {
        const a = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
        const t = lut64Cpu(lookLut, a[0], a[1], a[2]);
        c = [a[0] + (t[0] - a[0]) * u.lookAmt, a[1] + (t[1] - a[1]) * u.lookAmt, a[2] + (t[2] - a[2]) * u.lookAmt];
      }
      if (u.adjustOn) c = adjustRgb(c, u, [(x + 0.5) / width, (y + 0.5) / height]);
      out[i] = Math.round(clamp01(c[0]) * 255);
      out[i + 1] = Math.round(clamp01(c[1]) * 255);
      out[i + 2] = Math.round(clamp01(c[2]) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
```

- [x] **Step 8: Run the tests, then pin the 調節 variant**

Run: `npx vitest run src/engine/compositeCpu.test.ts src/engine/passes/reshapeCpu.test.ts`
Expected: everything passes except `the 調節 variant is pinned`, which fails with `expected '<8 hex>' to be '00000000'`. Put that printed 8-hex value in place of `'00000000'` in `compositeCpu.test.ts`, then run again.
Expected: PASS. (If `the base variant is the step-1 composite` fails, Step 6 changed more than whitespace in the base text: compare `compositeFs({adjust: false})` with `git show HEAD:src/engine/shaders/composite.ts` and fix the splice.)

- [x] **Step 9: Typecheck, full suite, commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/engine/shaders/adjust.ts src/engine/shaders/composite.ts src/engine/shaderHash.ts src/engine/compositeCpu.ts src/engine/compositeCpu.test.ts src/engine/passes/reshapeCpu.test.ts
git commit -m "v0.4 step 2: 調節 composite variant, CPU port and hash pins (base composite text unchanged)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The lazily compiled 調節 program in the pipeline

**Files:**
- Create: `src/engine/compositePrograms.ts`
- Modify: `src/engine/pipeline.ts` (header `:1-11`; imports `:12-49`; `FrameJob` `:77-101`; `PassPlanInput`/`PassPlan`/`planPasses`/`planFrame` `:109-166`; `Pipeline` `:187-201`; program setup `:280-299`; composite draw `:467-492`; `dispose` `:517-533`)
- Modify: `src/engine/index.ts` `job()` (`:205-244`; step 1 rewrote its face fields) — an interim `adjust` with user values only
- Test: `src/engine/compositePrograms.test.ts` (create); `src/engine/pipeline.test.ts` (extend + mechanical port)

**Interfaces:**
- Consumes: Task 5 (`AdjustUniforms`, `adjustUniforms`, `frameFor`); Task 6 (`compositeFs`, `COMPOSITE_FS`, `COMPOSITE_UNITS.look`); `createProgram`, `hexToRgb`, `Program`, `GL` (`src/engine/gl/gl.ts:28-82, 239`); `ROSY_TINT` (`src/engine/uniforms.ts:98`); step 1's `FrameJob` / `PassPlanInput` / `RenderInput.photo`.
- Produces:
  - `interface CompositePrograms { readonly base: Program; pick(adjust: boolean): Program; readonly adjustFailed: boolean; dispose(): void }`
  - `createCompositePrograms(gl: GL): CompositePrograms`
  - `uploadAdjust(gl: GL, p: Program, a: AdjustUniforms, lookResident: boolean): void`
  - `FrameJob.adjust: AdjustUniforms`, `FrameJob.lookLut: Texture | null`
  - `PassPlanInput.adjustOn: boolean`, `PassPlan.adjust: boolean` (`planFrame` reads `job.adjust.on`)
  - `Pipeline.adjustFailed: boolean` (getter)
  - the frame's `passes` gain `'adjust'` (right after `'composite'`) exactly when the 調節 program drew

- [x] **Step 0: Confirm the step-1 shapes**

Run: `grep -n "export interface FrameJob\|export interface PassPlanInput\|export interface PassPlan\b\|compProg\|for (let unit" src/engine/pipeline.ts; grep -n "function job" -A30 src/engine/index.ts | head -40`
Expected: `compProg` is created and its samplers set (`pipeline.ts:282, 290-299` at `9eec432`), drawn at the end of `run()`; `run()` plans the frame through `planFrame(job, makeupReady, body !== null)` (`:406`), which builds the `planPasses` input; `job()` returns the `FrameJob`.

- [x] **Step 1: Write the failing tests**

Create `src/engine/compositePrograms.test.ts`:

```ts
// The base composite + the lazily compiled 調節 program (step-2 spec §4.1, §7), with createProgram faked.
import { describe, expect, it, vi } from 'vitest';
import { adjustUniforms, frameFor } from './adjustMath';

const state = vi.hoisted(() => ({ labels: [] as string[], failAdjust: false }));

vi.mock('./gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gl/gl')>()),
  createProgram: vi.fn((_gl: unknown, _vs: string, _fs: string, label: string) => {
    state.labels.push(label);
    if (label === 'composite-adjust' && state.failAdjust) throw new Error('[composite-adjust] FS compile error');
    return { program: {}, u: (name: string) => ({ name }), use: vi.fn(), dispose: vi.fn() };
  }),
}));

import { createCompositePrograms, uploadAdjust } from './compositePrograms';

/** a WebGL2 stand-in that records every call; constants read as 1 */
function recordingGl() {
  const calls: [string, unknown[]][] = [];
  const gl = new Proxy(
    {},
    {
      get: (_t, k) =>
        typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)
          ? 1
          : (...args: unknown[]) => {
              calls.push([String(k), args]);
              return null;
            },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}
const reset = () => {
  state.labels.length = 0;
  state.failAdjust = false;
};

describe('composite programs (step-2 spec §4.1, §7)', () => {
  it('compiles only the base program until a frame wants 調節, then the 調節 program once', () => {
    reset();
    const { gl } = recordingGl();
    const c = createCompositePrograms(gl);
    expect(state.labels).toEqual(['composite']);
    expect(c.pick(false)).toBe(c.base);
    expect(state.labels).toEqual(['composite']);
    const a = c.pick(true);
    expect(a).not.toBe(c.base);
    expect(c.pick(true)).toBe(a);
    expect(c.pick(false)).toBe(c.base);
    expect(state.labels).toEqual(['composite', 'composite-adjust']);
    expect(c.adjustFailed).toBe(false);
  });

  it('binds the 質感 LUT sampler to unit 8 in the 調節 program only', () => {
    reset();
    const { gl, calls } = recordingGl();
    const c = createCompositePrograms(gl);
    const lookBinds = () => calls.filter(([f, a]) => f === 'uniform1i' && (a[0] as { name: string }).name === 'uLookLut');
    expect(lookBinds()).toEqual([]);
    c.pick(true);
    expect(lookBinds().map(([, a]) => a[1])).toEqual([8]);
  });

  it('a 調節 compile failure: the base program draws, the failure is flagged and logged once, never retried', () => {
    reset();
    state.failAdjust = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gl } = recordingGl();
    const c = createCompositePrograms(gl);
    expect(c.pick(true)).toBe(c.base);
    expect(c.pick(true)).toBe(c.base);
    expect(c.adjustFailed).toBe(true);
    expect(state.labels.filter((l) => l === 'composite-adjust')).toHaveLength(1);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('uploadAdjust sends every uniform, the seed as uint and the 9 curve knots as 18 floats', () => {
    reset();
    const { gl, calls } = recordingGl();
    const c = createCompositePrograms(gl);
    const p = c.pick(true);
    calls.length = 0;
    const u = adjustUniforms({ 'adjust.grain': 0.5, 'adjust.contrast': 0.8 }, null, false, frameFor({ width: 100, height: 50 }, null, 4));
    uploadAdjust(gl, p, u, false);
    const by = (name: string) => calls.find(([, a]) => (a[0] as { name?: string } | null)?.name === name);
    expect(by('uSeedMix')).toEqual(['uniform1ui', [{ name: 'uSeedMix' }, u.seedMix]]);
    expect((by('uCurve')![1][1] as Float32Array).length).toBe(18);
    expect(by('uLookAmt')![1][1]).toBe(0);
    for (const n of ['uAdjustOn', 'uExp', 'uCurveOn', 'uWbOn', 'uWb', 'uSat', 'uSkinA', 'uSkinB', 'uTaper', 'uFade', 'uVig', 'uVAspect', 'uVMap', 'uGrain', 'uGrainScale'])
      expect(by(n), n).toBeDefined();
  });
});
```

Append to `src/engine/pipeline.test.ts`, inside or after the `describe('planPasses', …)` block:

```ts
describe('planPasses: the 調節 program (step-2 spec §4.1)', () => {
  it('adjust follows adjustOn exactly and changes no other pass', () => {
    const off = planPasses({ ...base, adjustOn: false });
    const on = planPasses({ ...base, adjustOn: true });
    expect(off.adjust).toBe(false);
    expect(on.adjust).toBe(true);
    expect({ ...on, adjust: false }).toEqual(off);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/compositePrograms.test.ts src/engine/pipeline.test.ts`
Expected: FAIL — `Failed to resolve import "./compositePrograms"`; `adjust` is `undefined` in the plan.

- [x] **Step 3: The program pair**

Create `src/engine/compositePrograms.ts`:

```ts
// The two P5 composite programs (v0.4 step-2 spec §4.1): the base program (the step-1 text, built with the pipeline)
// and the 調節 program (+ 質感 LUT, unit 8), compiled the first time a frame needs it. A compile or link failure of the
// 調節 program is logged once and the base program keeps drawing (no 調節, no 質感) until the context is rebuilt.
import type { AdjustUniforms } from './adjustMath';
import { createProgram, type GL, hexToRgb, type Program } from './gl/gl';
import { COMPOSITE_FS, COMPOSITE_UNITS, compositeFs } from './shaders/composite';
import { PRESENT_VS } from './shaders/present';
import { ROSY_TINT } from './uniforms';

export interface CompositePrograms {
  readonly base: Program;
  /** the program for this frame: the 調節 program when `adjust` is true and it compiled, else the base */
  pick(adjust: boolean): Program;
  /** the 調節 program failed to compile or link on this context (never retried here) */
  readonly adjustFailed: boolean;
  dispose(): void;
}

/** sampler units and the constant 紅潤 tint, shared by both programs */
function initComposite(gl: GL, p: Program, look: boolean): void {
  p.use();
  gl.uniform1i(p.u('uSrc'), COMPOSITE_UNITS.src);
  gl.uniform1i(p.u('uMean'), COMPOSITE_UNITS.mean);
  gl.uniform1i(p.u('uMask'), COMPOSITE_UNITS.mask);
  gl.uniform1i(p.u('uLookupGray'), COMPOSITE_UNITS.gray);
  gl.uniform1i(p.u('uLookupOrigin'), COMPOSITE_UNITS.origin);
  gl.uniform1i(p.u('uLookupSkin'), COMPOSITE_UNITS.skin);
  gl.uniform1i(p.u('uLookupLight'), COMPOSITE_UNITS.light);
  gl.uniform1i(p.u('uFilterLut'), COMPOSITE_UNITS.filter);
  if (look) gl.uniform1i(p.u('uLookLut'), COMPOSITE_UNITS.look);
  gl.uniform3fv(p.u('uRosyTint'), hexToRgb(ROSY_TINT));
}

export function createCompositePrograms(gl: GL): CompositePrograms {
  const base = createProgram(gl, PRESENT_VS, COMPOSITE_FS, 'composite');
  initComposite(gl, base, false);
  let adjust: Program | null = null;
  let failed = false;
  return {
    base,
    pick(want) {
      if (!want) return base;
      if (!adjust && !failed) {
        try {
          const p = createProgram(gl, PRESENT_VS, compositeFs({ adjust: true }), 'composite-adjust');
          initComposite(gl, p, true);
          adjust = p;
        } catch (err) {
          failed = true;
          console.error('[engine] the 調節 program failed to compile; drawing without 調節 and 質感', err);
        }
      }
      return adjust ?? base;
    },
    get adjustFailed() {
      return failed;
    },
    dispose() {
      base.dispose();
      adjust?.dispose();
    },
  };
}

/** One frame's 調節 uniforms into the 調節 program (already in use). `lookResident` false → no LUT mix. */
export function uploadAdjust(gl: GL, p: Program, a: AdjustUniforms, lookResident: boolean): void {
  gl.uniform1f(p.u('uLookAmt'), lookResident ? a.lookAmt : 0);
  gl.uniform1f(p.u('uAdjustOn'), a.adjustOn ? 1 : 0);
  gl.uniform4fv(p.u('uExp'), a.exp);
  gl.uniform1f(p.u('uCurveOn'), a.curveOn ? 1 : 0);
  gl.uniform2fv(p.u('uCurve'), new Float32Array(a.curve));
  gl.uniform1f(p.u('uWbOn'), a.wbOn ? 1 : 0);
  gl.uniform3fv(p.u('uWb'), a.wb);
  gl.uniform4fv(p.u('uSat'), a.sat);
  gl.uniform4fv(p.u('uSkinA'), a.skinA);
  gl.uniform4fv(p.u('uSkinB'), a.skinB);
  gl.uniform2fv(p.u('uTaper'), a.taper);
  gl.uniform3fv(p.u('uFade'), a.fade);
  gl.uniform4fv(p.u('uVig'), a.vig);
  gl.uniform1f(p.u('uVAspect'), a.vAspect);
  gl.uniform4fv(p.u('uVMap'), a.vMap);
  gl.uniform4fv(p.u('uGrain'), a.grain);
  gl.uniform2fv(p.u('uGrainScale'), a.grainScale);
  gl.uniform1ui(p.u('uSeedMix'), a.seedMix);
}
```

- [x] **Step 4: Use it in the pipeline**

In `src/engine/pipeline.ts` (CRLF — Edit tool):
1. Imports: replace `import { COMPOSITE_FS, COMPOSITE_UNITS } from './shaders/composite';` with `import { COMPOSITE_UNITS } from './shaders/composite';`, add `import type { AdjustUniforms } from './adjustMath';` and `import { createCompositePrograms, uploadAdjust } from './compositePrograms';`, and remove `hexToRgb` from the `./gl/gl` import list and `ROSY_TINT` from the `./uniforms` list (both now live in `compositePrograms.ts`; `noUnusedLocals` is on).
2. Header comment (lines 1-11): add the line `// P5 has two programs (step 2): the base composite and the 調節 one (質感 LUT + 調節 stages), compiled on first need.`
3. `FrameJob`: after `filterLut: Texture | null;` add

```ts
  /** 調節 + 質感 uniforms of this frame (adjustUniforms); `on` picks the 調節 program */
  adjust: AdjustUniforms;
  /** the resident 質感 LUT (unit 8), or null: none, or still loading (then the look is not drawn at all) */
  lookLut: Texture | null;
```

4. `PassPlanInput`: add `/** the frame needs the 調節 program (FrameJob.adjust.on) */ adjustOn: boolean;`. `PassPlan`: add `adjust: boolean;`. In `planPasses` add `adjust: i.adjustOn,` to the returned object. In step 1's `planFrame` (the pure planner `run()` calls), widen its `job` parameter type to `{ faces: readonly Pick<FrameFace, 'weight' | 'makeup' | 'reshape'>[] } & Pick<FrameJob, 'maskClear' | 'matchGpupixel' | 'skin'> & { adjust: { on: boolean } }` and add `adjustOn: job.adjust.on,` to its `planPasses({ … })` argument.
5. `Pipeline`: add `/** the 調節 program failed to compile on this context */ readonly adjustFailed: boolean;`.
6. In `createPipeline`, replace `const compProg = createProgram(gl, PRESENT_VS, COMPOSITE_FS, 'composite');` with `const comp = createCompositePrograms(gl);`, change `const programs: Program[] = [meanProg, compProg, presentProg];` to `const programs: Program[] = [meanProg, presentProg];`, and delete the `compProg.use();` block that sets the composite samplers and `uRosyTint` (lines 290-299 at `9eec432`).
7. In `run()` (its `planFrame(job, makeupReady, body !== null)` call needs no change: item 4 reads `job.adjust`), replace the composite section, from `compProg.use();` through the unbind loop (lines 470-491), with:

```ts
      const prog = comp.pick(plan.adjust);
      const drawsAdjust = prog !== comp.base;
      prog.use();
      bindTexture(gl, COMPOSITE_UNITS.src, base);
      bindTexture(gl, COMPOSITE_UNITS.mean, meanTex);
      bindTexture(gl, COMPOSITE_UNITS.mask, maskTex ?? white);
      bindTexture(gl, COMPOSITE_UNITS.gray, luts ? luts.gray : white);
      bindTexture(gl, COMPOSITE_UNITS.origin, luts ? luts.origin : white);
      bindTexture(gl, COMPOSITE_UNITS.skin, luts ? luts.skin : white);
      bindTexture(gl, COMPOSITE_UNITS.light, luts ? luts.light : white);
      bindTexture(gl, COMPOSITE_UNITS.filter, filterAmt > 0 && job.filterLut ? job.filterLut : white);
      if (drawsAdjust) bindTexture(gl, COMPOSITE_UNITS.look, job.lookLut ?? white);
      gl.uniform2fv(prog.u('uTexel'), sharpenTexel(job.size));
      gl.uniform1f(prog.u('uSmooth'), plan.mean ? job.skin.smooth : 0);
      gl.uniform1f(prog.u('uSharpen'), job.skin.sharpen);
      gl.uniform1f(prog.u('uWhiten'), whiten);
      gl.uniform1f(prog.u('uRosy'), plan.mean ? job.skin.rosy : 0);
      gl.uniform1f(prog.u('uFilterAmt'), filterAmt);
      gl.uniform1f(prog.u('uMaskOn'), maskTex ? 1 : 0);
      gl.uniform2fv(prog.u('uOut'), presentScale(job.target === 'canvas', job.mirror));
      if (drawsAdjust) uploadAdjust(gl, prog, job.adjust, job.lookLut !== null);
      drawFullscreen(gl);
      passes.push('composite');
      if (drawsAdjust) passes.push('adjust');

      // Leave no FBO texture bound on a unit, so later passes never form a feedback loop by accident.
      for (let unit = 0; unit < 9; unit++) bindTexture(gl, unit, null);
      return { passes, output };
```

   Keep every line step 1 changed in this section (for example its skin-uniform lines) — only `compProg` → `prog` and the four added lines are new; if step 1 added composite uniforms, keep them with `prog.u(...)`.
8. In the returned pipeline object add

```ts
    get adjustFailed() {
      return comp.adjustFailed;
    },
```

9. In `dispose`, inside `if (!lost) { … }` add `comp.dispose();` after the programs loop.

- [x] **Step 5: Interim frame job in the engine (user 調節 values; looks follow in Task 8)**

In `src/engine/index.ts` add `import { adjustUniforms, frameFor } from './adjustMath';` and add to the object `job()` returns:

```ts
      // step 2: user 調節 values only until the LUT cache serves looks (Task 8)
      adjust: adjustUniforms(input.photo.values, null, false, frameFor(size)),
      lookLut: null,
```

- [x] **Step 6: Port the existing plan assertions (mechanical)**

In `src/engine/pipeline.test.ts`: add `adjustOn: false,` to the shared `base: PassPlanInput` object, and add `adjust: false` to every object literal passed to `toEqual(...)` on a `planPasses(...)` or `planFrame(...)` result (the `toMatchObject` ones need no change). Run `grep -n "plan\(Passes\|Frame\)(.*toEqual" src/engine/pipeline.test.ts` to find them (five `planPasses` lines, three `planFrame` lines at `9eec432`). In the `describe('planFrame …')` block, the local `job(weights, maskClear)` helper gains `adjust: { on: false },`.

- [x] **Step 7: Run the tests**

Run: `npx vitest run src/engine/compositePrograms.test.ts src/engine/pipeline.test.ts src/engine/index.test.ts && npm run typecheck`
Expected: PASS; `tsc` exits 0.

- [x] **Step 8: Prove neutral frames still use the base program end to end**

Run: `npm run build && npx playwright test tests/e2e/engine.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS (no case of either spec sets a 調節 value, so their pass lists and pixels are step 1's).

- [x] **Step 9: Commit**

```bash
git add src/engine/compositePrograms.ts src/engine/compositePrograms.test.ts src/engine/pipeline.ts src/engine/pipeline.test.ts src/engine/index.ts
git commit -m "v0.4 step 2: lazily compiled 調節 program in P5; base program for neutral frames" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Engine LUT cache for 濾鏡 and 質感, frame uniforms with picture frame and grain seed

**Files:**
- Modify: `src/types.ts:408-429` (`RenderInput`), `:443-468` (`Engine`)
- Modify: `src/engine/index.ts:32-34` (constants), `:60-63` (filter maps), `:111-119` (`dropGlState`), `:153-198` (`loadFilter`, `filterFor`), `:205-244` (`job()`), `:268` (`loadFilter` export), `:310-323` (`dispose`)
- Modify: `tests/harness/t7/fakes.ts:9-28, 90-110` (`class FakeEngine implements Engine` gains the three new members) — LF
- Test: `src/engine/index.test.ts` (extend; one mechanical change at `:58`)

**Interfaces:**
- Consumes: Task 1 (`LutKind`, `LutState`); Task 2 (`lookDef`); Task 5 (`adjustUniforms`, `frameFor`, `ADJUST_IDS`, `seedMix`, `AdjustUniforms`); Task 7 (`FrameJob.adjust/lookLut`, `Pipeline.adjustFailed`); step 1's `RenderInput.photo`, `defaultPhoto()` (tests).
- Produces:
  - `RenderInput.pictureFrame?: Rect`; `RenderInput.grainSeed?: number`
  - `Engine.loadLut(kind: LutKind, id: string): Promise<void>`; `Engine.lutState(kind: LutKind, id: string): LutState`; `Engine.adjustUnavailable: boolean`; `Engine.loadFilter(id)` kept (= `loadLut('filter', id)`)
  - `MAX_RESIDENT_LUTS = 6`; `lutUrl(kind: LutKind, id: string): string` (exported from `src/engine/index.ts`)
  - `job()` sets `FrameJob.adjust` from the photo's 調節 values, its look (only when the LUT is resident), `pictureFrame` and `grainSeed`; memoized

- [x] **Step 0: Confirm the step-1 shapes**

Run: `grep -n "filterFor\|filterTex\|filterLoads\|filterFailed" src/engine/index.ts`
Expected: the v0.3 filter cache (`index.ts:60-63, 115-117, 153-198, 206, 320` at `9eec432`) with `input.photo.filterId` in `job()`.

- [x] **Step 1: Write the failing tests**

In `src/engine/index.test.ts`, change the `beforeEach` mock (line 58) so look LUTs are 512² too:

```ts
  loadTex.mockImplementation(async (_gl, url) => {
    const lut = /\/(filters|looks)\//.test(url);
    return { tex: {}, width: lut ? 512 : 64, height: lut ? 512 : 64 } as never;
  });
```

Append:

```ts
import { seedMix } from './adjustMath';
import { createEngine, MAX_RESIDENT_LUTS } from './index';
import { defaultPhoto } from '../edit/state';
import type { BodyField, PhotoParams, RenderInput } from '../types';

const lookUrl = (id: string) => `/luts/looks/look_${id}.png`;
const calls = (url: string) => loadTex.mock.calls.filter((c) => c[1] === url).length;
const photoInput = (photo: Partial<PhotoParams> = {}, extra: Partial<RenderInput> = {}): RenderInput => ({
  source: {} as TexImageSource,
  width: 640,
  height: 480,
  faces: [],
  globalSkin: null,
  photo: { ...defaultPhoto(), ...photo },
  ...extra,
});
const latestJob = (): FrameJob => {
  const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
  return pipe.run.mock.calls.at(-1)![0];
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createEngine: 濾鏡 and 質感 LUT cache (step-2 spec §3.5)', () => {
  it('kinds have their own paths; filter "film" and look "film" are separate textures', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('filter', 'film');
    expect(engine.lutState('filter', 'film')).toBe('ready');
    expect(engine.lutState('look', 'film')).toBe('none');
    await engine.loadLut('look', 'film');
    expect(calls(filterUrl('film'))).toBe(1);
    expect(calls(lookUrl('film'))).toBe(1);
    expect(engine.lutState('look', 'film')).toBe('ready');
    await engine.loadFilter('warm');
    expect(engine.lutState('filter', 'warm')).toBe('ready');
    expect(engine.lutState('filter', 'none')).toBe('ready');
  });

  it('lutState: loading → ready; a failed LUT stays failed (no implicit retry) until an explicit loadLut', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    loadTex.mockImplementationOnce(async () => {
      throw new Error('HTTP 404');
    });
    const p = engine.loadLut('look', 'ccd');
    expect(engine.lutState('look', 'ccd')).toBe('loading');
    await expect(p).rejects.toThrow('HTTP 404');
    expect(engine.lutState('look', 'ccd')).toBe('failed');
    engine.render(photoInput({ look: { id: 'ccd', amount: 0.8 } }));
    expect(calls(lookUrl('ccd'))).toBe(1);
    await engine.loadLut('look', 'ccd');
    expect(engine.lutState('look', 'ccd')).toBe('ready');
    expect(calls(lookUrl('ccd'))).toBe(2);
  });

  it('the same LUT asked again while loading is fetched once (pick → 無 → pick, hook + frame path)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    let done!: (t: unknown) => void;
    loadTex.mockImplementationOnce(() => new Promise((r) => (done = r)) as never);
    const a = engine.loadLut('look', 'blue');
    const b = engine.loadLut('look', 'blue');
    engine.render(photoInput({ look: { id: 'blue', amount: 0.8 } }));
    expect(a).toBe(b);
    expect(calls(lookUrl('blue'))).toBe(1);
    done({ tex: {}, width: 512, height: 512 });
    await a;
    expect(engine.lutState('look', 'blue')).toBe('ready');
    expect(calls(lookUrl('blue'))).toBe(1);
  });

  it(`keeps at most ${MAX_RESIDENT_LUTS} LUTs resident: the least recently used goes, never one the latest frame drew with`, async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('filter', 'a');
    engine.render(photoInput({ filterId: 'a' })); // the latest frame draws with filter a
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g']) await engine.loadLut('filter', id);
    expect(engine.lutState('filter', 'a')).toBe('ready');
    expect(engine.lutState('filter', 'b')).toBe('none');
    for (const id of ['c', 'd', 'e', 'f', 'g']) expect(engine.lutState('filter', id)).toBe('ready');
  });

  it('a context loss drops the cache; after the restore the next frame reloads the look by itself', async () => {
    const { canvas, fire } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    await engine.loadLut('look', 'film');
    fire('webglcontextlost');
    expect(engine.lutState('look', 'film')).toBe('none');
    fire('webglcontextrestored');
    await engine.ready;
    const before = calls(lookUrl('film'));
    engine.render(photoInput({ look: { id: 'film', amount: 0.8 } }));
    expect(calls(lookUrl('film'))).toBe(before + 1);
  });

  it('a look draws only once its LUT is resident (all-or-nothing: no LUT and no offsets before)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    let done!: (t: unknown) => void;
    loadTex.mockImplementationOnce(() => new Promise((r) => (done = r)) as never);
    const input = photoInput({ look: { id: 'cinema', amount: 0.8 } });
    engine.render(input);
    expect(latestJob().lookLut).toBeNull();
    expect(latestJob().adjust).toMatchObject({ on: false, lookAmt: 0 });
    done({ tex: {}, width: 512, height: 512 });
    await flush();
    engine.render(input);
    expect(latestJob().lookLut).not.toBeNull();
    expect(latestJob().adjust).toMatchObject({ on: true, adjustOn: true, lookAmt: 0.8 });
  });

  it('user 調節 values, pictureFrame and grainSeed reach the frame uniforms; neutral photos stay off', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render(photoInput());
    expect(latestJob().adjust.on).toBe(false);
    const p = defaultPhoto();
    engine.render(
      photoInput({ values: { ...p.values, 'adjust.vignette': 1 } }, { pictureFrame: { x: 0.25, y: 0, w: 0.5, h: 1 }, grainSeed: 7 }),
    );
    expect(latestJob().adjust.on).toBe(true);
    expect(latestJob().adjust.vMap).toEqual([2, 1, -0.5, 0]);
    expect(latestJob().adjust.seedMix).toBe(seedMix(7));
  });

  it('adjustUnavailable mirrors the pipeline', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    expect(engine.adjustUnavailable).toBe(false);
    (vi.mocked(createPipeline).mock.results.at(-1)!.value as { adjustFailed?: boolean }).adjustFailed = true;
    expect(engine.adjustUnavailable).toBe(true);
  });
});
```

(Merge these imports into the file's existing import lines: `MAX_RESIDENT_LUTS` into `import { createEngine } from './index';`, `PhotoParams` and `RenderInput` into `import type { BodyField } from '../types';`; `FrameJob` and `createPipeline` are already imported from `./pipeline`. The `filterUrl` helper already exists at line 53.)

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/index.test.ts`
Expected: FAIL — `engine.loadLut is not a function`.

- [x] **Step 3: Types**

In `src/types.ts`, `RenderInput` (step 1's v0.4 form) gains (C §4.1):

```ts
  /** step 2: the picture rectangle (source UV) that vignette and grain treat as V — the camera's ratio crop; default the whole source */
  pictureFrame?: Rect;
  /** step 2: grain seed; 0 in the editor and exports, a frame counter in the camera */
  grainSeed?: number;
```

`Engine` (`src/types.ts:303-328`): keep `loadFilter` and add after it:

```ts
  /** Make a 濾鏡 or 質感 LUT resident (lazy-loaded on first use); resolves when uploaded. An explicit call retries a failed one. */
  loadLut(kind: LutKind, id: string): Promise<void>;
  /**
   * For export readiness ('ready' | 'failed' = settled). 'none' = not resident: never asked, evicted by the LRU cap,
   * or dropped with a lost context. A filter id 'none' (no filter) is 'ready'.
   */
  lutState(kind: LutKind, id: string): LutState;
  /** the 調節 program failed to compile on this context: 調節 and 質感 are not drawn until the context is rebuilt */
  readonly adjustUnavailable: boolean;
```

- [x] **Step 4: The cache**

In `src/engine/index.ts`:
1. Imports: add `LutKind`, `LutState` to the `../types` type import; add `import { ADJUST_IDS, adjustUniforms, frameFor, type AdjustFrame, type AdjustUniforms, type AdjustValues } from './adjustMath';` (replacing Task 7's narrower import) and `import { lookDef } from './looks';`. Add `LookDef` to the `../types` type import.
2. Replace lines 33-34 (`FILTER_ID`, `FILTER_LUT_SIZE`) with:

```ts
const LUT_ID = /^[a-z0-9_-]+$/;
const LUT_SIZE = 512;
/** 濾鏡 + 質感 LUT textures resident at once: 6 × 1 MB (step-2 spec §3.5) */
export const MAX_RESIDENT_LUTS = 6;

export function lutUrl(kind: LutKind, id: string): string {
  return kind === 'filter' ? `/luts/filters/${id}.png` : `/luts/looks/look_${id}.png`;
}

interface LutEntry {
  state: 'loading' | 'ready' | 'failed';
  tex: Texture | null;
  /** the upload in flight while loading */
  load: Promise<void> | null;
  /** LRU clock: bumped when a frame draws with it or it is asked for again */
  used: number;
}
```

3. Replace the three filter maps (lines 60-63, with the comment on `filterFailed`) with:

```ts
  /** 濾鏡 and 質感 LUTs keyed `${kind}:${id}` (the filter 'film' and the look 'film' are different textures) */
  const lutCache = new Map<string, LutEntry>();
  let lutTick = 0;
  /** keys the latest frame drew with: the LRU never evicts these */
  let frameLuts = new Set<string>();
  let adjustMemo: { key: string; u: AdjustUniforms } | null = null;
```

4. In `dropGlState()` replace the three `filter….clear()` lines with `lutCache.clear();`, `frameLuts = new Set();`, `adjustMemo = null;`.
5. Replace `loadFilter` and `filterFor` (lines 153-198) with:

```ts
  const lutKey = (kind: LutKind, id: string) => `${kind}:${id}`;

  /** Over the cap: drop the least recently used resident LUTs, but none the latest frame drew with. */
  function evictLuts(): void {
    const ready = [...lutCache.entries()].filter(([, e]) => e.state === 'ready').sort((a, b) => a[1].used - b[1].used);
    let excess = ready.length - MAX_RESIDENT_LUTS;
    for (const [key, e] of ready) {
      if (excess <= 0) break;
      if (frameLuts.has(key)) continue;
      deleteTexture(gl, e.tex);
      lutCache.delete(key);
      excess--;
    }
  }

  function loadLut(kind: LutKind, id: string): Promise<void> {
    if (kind === 'filter' && id === 'none') return Promise.resolve();
    const key = lutKey(kind, id);
    if (!LUT_ID.test(id)) {
      lutCache.set(key, { state: 'failed', tex: null, load: null, used: ++lutTick });
      return Promise.reject(new Error(`invalid ${kind} LUT id ${id}`));
    }
    const cur = lutCache.get(key);
    if (cur?.state === 'ready') {
      cur.used = ++lutTick;
      return Promise.resolve();
    }
    if (cur?.state === 'loading' && cur.load) return cur.load;
    const gen = generation;
    const entry: LutEntry = { state: 'loading', tex: null, load: null, used: ++lutTick };
    lutCache.set(key, entry);
    const p = loadImageTexture(gl, lutUrl(kind, id)).then(
      (t) => {
        if (gen !== generation) return; // uploaded to a dead context: the restored one reloads on demand
        if (lutCache.get(key) !== entry || disposed) {
          deleteTexture(gl, t);
          return;
        }
        entry.load = null;
        if (t.width !== LUT_SIZE || t.height !== LUT_SIZE) {
          deleteTexture(gl, t);
          if (lost) lutCache.delete(key);
          else entry.state = 'failed';
          throw new Error(`${kind} LUT ${id} is ${t.width}×${t.height}, expected 512×512`);
        }
        entry.tex = t;
        entry.state = 'ready';
        entry.used = ++lutTick;
        evictLuts();
      },
      (err: unknown) => {
        if (gen === generation && lutCache.get(key) === entry) {
          entry.load = null;
          // a load that failed on the lost context is not the LUT's fault: no mark, the restored context's first
          // frame asks again implicitly
          if (lost) lutCache.delete(key);
          else entry.state = 'failed';
        }
        throw err;
      },
    );
    entry.load = p;
    return p;
  }

  /** The LUT for this frame, or null (not drawn) while it loads; touches the LRU and pins it for this frame. */
  function lutFor(kind: LutKind, id: string): Texture | null {
    if (kind === 'filter' && id === 'none') return null;
    const key = lutKey(kind, id);
    frameLuts.add(key);
    const e = lutCache.get(key);
    if (e?.state === 'ready' && e.tex) {
      e.used = ++lutTick;
      return e.tex;
    }
    if (!e) loadLut(kind, id).catch((err: unknown) => console.warn(`[engine] ${kind} LUT ${id} unavailable`, err));
    return null;
  }

  /** adjustUniforms, memoized on its inputs (a drag rebuilds 9 knots; an unchanged frame rebuilds nothing) */
  function adjustFor(values: AdjustValues, look: { def: LookDef; amount: number } | null, ready: boolean, frame: AdjustFrame): AdjustUniforms {
    const key = JSON.stringify([ADJUST_IDS.map((id) => values[id]), look?.def.id ?? null, look?.amount ?? null, ready, frame]);
    if (adjustMemo?.key === key) return adjustMemo.u;
    const u = adjustUniforms(values, look, ready, frame);
    adjustMemo = { key, u };
    return u;
  }
```

6. In `job()`: make its first statement `frameLuts = new Set();`, replace the `filterFor(input.photo.filterId)` call with `lutFor('filter', input.photo.filterId)`, and replace Task 7's interim `adjust:` / `lookLut:` lines with:

```ts
      adjust: adjustFor(input.photo.values, lookRef, lookLut !== null, frameFor(size, input.pictureFrame, input.grainSeed ?? 0)),
      lookLut,
```

   with these two constants computed before the `return`:

```ts
    const look = input.photo.look;
    const def = look ? lookDef(look.id) : null;
    const lookRef = look && def ? { def, amount: look.amount } : null;
    const lookLut = lookRef ? lutFor('look', lookRef.def.id) : null;
```

7. In the returned engine object, replace the line `loadFilter,` with:

```ts
    loadFilter: (filterId: string) => loadLut('filter', filterId),
    loadLut,
    lutState(kind, id): LutState {
      if (kind === 'filter' && id === 'none') return 'ready';
      return lutCache.get(lutKey(kind, id))?.state ?? 'none';
    },
    get adjustUnavailable() {
      return pipeline?.adjustFailed ?? false;
    },
```

8. In `dispose()` replace `for (const t of filterTex.values()) deleteTexture(gl, t);` with `for (const e of lutCache.values()) deleteTexture(gl, e.tex);`.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/engine/index.test.ts`
Expected: PASS (the two v0.3 context-loss tests at `index.test.ts:62-95` keep passing: a failure on a lost context leaves no mark; one on a live context is not retried implicitly).

- [x] **Step 6: Port the engine stand-ins that implement `Engine`**

`src/app/testFakes.ts` and `src/ui/services.test.ts` build their engines with `as unknown as …`, so `tsc` does not ask for the new members there (`testFakes.ts` gains them in Task 11). `tests/harness/t7/fakes.ts` declares `class FakeEngine implements Engine`, so it must implement them now. Add `LutKind` and `LutState` to its `../../../src/types` type import, and after its `async loadFilter() { … }` method add:

```ts
  /** 濾鏡 + 質感 LUT states, like the engine's cache (the fake draws no LUT; it only settles them after a delay) */
  private luts = new Map<string, LutState>();
  readonly adjustUnavailable = false;
  loadLut(kind: LutKind, id: string): Promise<void> {
    if (kind === 'filter' && id === 'none') return Promise.resolve();
    const key = `${kind}:${id}`;
    if (this.luts.get(key) !== 'ready') this.luts.set(key, 'loading');
    return sleep(30).then(() => {
      this.luts.set(key, 'ready');
    });
  }
  lutState(kind: LutKind, id: string): LutState {
    return kind === 'filter' && id === 'none' ? 'ready' : (this.luts.get(`${kind}:${id}`) ?? 'none');
  }
```

If a stale, gitignored `tests/harness/b2/baseline/` exists on disk and `tsc` reports its `createEngine` as not returning an `Engine`, delete the directory (`rm -rf tests/harness/b2/baseline`; never edit it — `make-baseline.mjs` regenerates it).

Run: `npm run typecheck`
Expected: `tsc` exits 0.

- [x] **Step 7: Full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/types.ts src/engine/index.ts src/engine/index.test.ts tests/harness/t7/fakes.ts
git commit -m "v0.4 step 2: one LRU cache for 濾鏡 and 質感 LUTs; frame uniforms with picture frame and grain seed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Look LUTs, thumbnails, asset tests, tuning sheet and licensing lines

**Files:**
- Modify: `scripts/gen-luts.mjs` (header `:1-12`, paths `:18-19`, imports `:13-16`, after `identity` `:404`, after `drawSwatch` `:578`, `main()` `:593-603`) — CRLF
- Create (generated): `public/luts/looks/look_{film,ccd,flash,blue,cinema}.png`, `public/luts/looks/look_{film,ccd,flash,blue,cinema}_thumb.png`
- Create: `tests/harness/t5/preview-looks.mjs`
- Modify: `tests/harness/t5/assets.test.mjs` (imports `:6-22`; new `describe` after `shipped filter LUTs` `:169`)
- Modify: `LICENSES/NOTICE.txt:48`; `src/ui/screens/Settings.tsx:252-253`

**Interfaces:**
- Consumes: Task 2 (`LOOKS` as `LOOK_DEFS`), Task 5 (`adjustRgb`, `adjustUniforms`, `frameFor`), imported by the script as `.ts` files under Node type stripping; the script's own `whiteBalance`, `curve`, `chroma`, `tone`, `holdSkin`, `withL`, `srgbToLab`, `labToSrgb`, `buildLut`, `applyLut`, `drawSwatch`, `encodePng`, `lookup64`.
- Produces (exports of `scripts/gen-luts.mjs`):
  - `LOOK_IDS = ['film', 'ccd', 'flash', 'blue', 'cinema']`
  - `LOOK_GRADES: Record<LookId, (c: number[]) => number[]>`
  - `gradeLook(id, lut, rgba, width, height, amount, thumb = false): Buffer` (LUT mix + offsets through `adjustRgb`, seed 0)
  - `buildLookThumb(id, lut, swatch = drawSwatch(THUMB)): Buffer`
  - the 10 PNG assets under `public/luts/looks/` (precached by the existing `**/*.png` glob, `vite.config.ts:110`)

- [x] **Step 1: Write the failing asset tests**

In `tests/harness/t5/assets.test.mjs`, add `LOOK_GRADES`, `LOOK_IDS`, `buildLookThumb` to the `../../../scripts/gen-luts.mjs` import list, and add:

```js
import { LOOKS as LOOK_DEFS } from '../../../src/engine/looks.ts';
import { adjustRgb, adjustUniforms, frameFor } from '../../../src/engine/adjustMath.ts';
```

Then append after the `describe('shipped filter LUTs', …)` block:

```js
describe('shipped 質感 look LUTs (step-2 spec §8.2)', () => {
  it('every LookDef has a LUT recipe here, and vice versa', () => {
    expect(LOOK_DEFS.map((l) => l.id)).toEqual(LOOK_IDS);
  });

  for (const id of LOOK_IDS) {
    describe(id, () => {
      const raw = readFileSync(pub('luts', 'looks', `look_${id}.png`));
      const png = PNG.sync.read(raw);

      it('is a 512×512 opaque RGB PNG with no colour-management chunks', () => {
        expect([png.width, png.height]).toEqual([512, 512]);
        expect(raw[25]).toBe(2);
        expect(chunks(raw).filter((c) => c !== 'IDAT')).toEqual(['IHDR', 'IEND']);
      });

      it('matches the generator output (assets are up to date)', () => {
        expect(Buffer.compare(png.data, buildLut(LOOK_GRADES[id]))).toBe(0);
      });

      it('is smooth (no jumps between neighbouring grid entries) with a monotone grey axis', () => {
        const s = lutStats(png.data);
        expect(s.greyMonotone).toBe(true);
        expect(s.maxStep).toBeLessThanOrEqual(36);
      });

      it('its thumbnail matches the generator and differs from the ungraded swatch', () => {
        const thumb = readPng(pub('luts', 'looks', `look_${id}_thumb.png`));
        expect([thumb.width, thumb.height]).toEqual([THUMB, THUMB]);
        expect(Buffer.compare(thumb.data, buildLookThumb(id, png.data))).toBe(0);
        expect(meanAbsDiff(thumb.data, readPng(pub('luts', 'filters', 'none_thumb.png')).data)).toBeGreaterThan(4);
      });
    });
  }

  it('look thumbnails are mutually distinct (mean ≥ 5)', () => {
    const thumbs = LOOK_IDS.map((id) => readPng(pub('luts', 'looks', `look_${id}_thumb.png`)).data);
    for (let i = 0; i < thumbs.length; i++)
      for (let j = i + 1; j < thumbs.length; j++) {
        const d = meanAbsDiff(thumbs[i], thumbs[j]);
        if (d < 5) throw new Error(`${LOOK_IDS[i]} vs ${LOOK_IDS[j]}: mean diff ${d.toFixed(2)}`);
      }
  });

  it('every look thumbnail differs from every filter thumbnail (mean ≥ 5), 膠片 vs 膠片 included', () => {
    for (const id of LOOK_IDS) {
      const look = readPng(pub('luts', 'looks', `look_${id}_thumb.png`)).data;
      for (const f of FILTER_IDS) {
        const d = meanAbsDiff(look, readPng(pub('luts', 'filters', `${f}_thumb.png`)).data);
        if (d < 5) throw new Error(`look ${id} vs filter ${f}: mean diff ${d.toFixed(2)}`);
      }
    }
  });

  it('keeps skin skin-like under the full look at its default 程度 (LUT mix + offsets through adjustRgb)', () => {
    const skins = [
      [241, 194, 167],
      [232, 190, 172],
      [224, 172, 150],
      [200, 150, 130],
      [198, 134, 110],
      [171, 140, 114],
      [141, 85, 60],
    ];
    const lch = (lab) => [lab[0], Math.hypot(lab[1], lab[2]), (Math.atan2(lab[2], lab[1]) * 180) / Math.PI];
    for (const def of LOOK_DEFS) {
      const lut = buildLut(LOOK_GRADES[def.id]);
      const u = adjustUniforms({}, { def, amount: def.defaultAmount }, true, frameFor({ width: 1080, height: 1080 }));
      for (const s of skins) {
        const c = s.map((v) => v / 255);
        const t = lookup64(lut, c[0], c[1], c[2]);
        const mixed = c.map((v, k) => v + (t[k] - v) * def.defaultAmount);
        const inp = lch(srgbToLab(c));
        const out = lch(srgbToLab(adjustRgb(mixed, u, [0.5, 0.5])));
        const msg = `${def.id} ${s}: L ${out[0].toFixed(3)} C ${out[1].toFixed(3)} h ${out[2].toFixed(1)}`;
        expect(out[2], msg).toBeGreaterThan(20);
        expect(out[2], msg).toBeLessThan(75);
        expect(out[1], msg).toBeGreaterThan(0.02);
        expect(out[1], msg).toBeLessThan(0.12);
        expect(out[0], msg).toBeGreaterThan(inp[0] - 0.06);
      }
    }
  });

  it('NOTICE names the look LUTs as original work and credits hash-prospector', () => {
    const notice = readFileSync(join(root, 'LICENSES', 'NOTICE.txt'), 'utf8');
    expect(notice).toContain('the 質感 look LUTs and thumbnails');
    expect(notice).toContain('hash-prospector');
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/harness/t5/assets.test.mjs`
Expected: FAIL — `LOOK_GRADES` / `LOOK_IDS` / `buildLookThumb` are not exported by `gen-luts.mjs`.

- [x] **Step 3: Look grades and thumbnails in the generator**

Edit `scripts/gen-luts.mjs` (CRLF — Edit tool):
1. Header (lines 1-12): after the `<id>_thumb.png` line add
   `// and our own 質感 look LUTs into public/luts/looks/ (v0.4 step 2): look_<id>.png (same layout) and look_<id>_thumb.png`
   `// (the swatch graded by the full look at its default 程度: the LUT mix, then the look's 調節 offsets through`
   `// src/engine/adjustMath.ts). Importing the .ts modules needs Node ≥ 22.18 (type stripping); the repo uses Node 24.`
2. After the `import { PNG } from 'pngjs';` line add:

```js
import { adjustRgb, adjustUniforms, frameFor } from '../src/engine/adjustMath.ts';
import { LOOKS as LOOK_DEFS } from '../src/engine/looks.ts';
```

3. After `const outDir = join(root, 'public', 'luts', 'filters');` add `const looksDir = join(root, 'public', 'luts', 'looks');`.
4. After `export const identity = (c) => c;` (line 404) add:

```js
// ───────────────────────── 質感 looks (v0.4 step 2) ─────────────────────────
// Complete looks: the LUT carries the colour; grain, fade and vignette are the look's 調節 offsets
// (src/engine/looks.ts), so the LUTs stay grain-free. Tuned on filterId none; 程度 0.8 is the intended look.
// Generic photographic themes only (no camera, film-stock or app emulation).

/** 膠片 — warm-neutral portrait film: soft toe and shoulder, olive greens, slate blues, creamy highlights, skin held. */
const lookFilmCurve = curve([
  [0, 0.03],
  [0.25, 0.27],
  [0.5, 0.53],
  [0.75, 0.77],
  [1, 0.97],
]);
function lookFilm(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(whiteBalance(c, [1.04, 1, 0.93]));
  lab = withL(lab, lookFilmCurve);
  lab = chroma(lab, {
    sat: 0.9,
    skinSat: 1,
    bands: [
      { h: 140, half: 55, sat: 0.7, shift: -22 },
      { h: 250, half: 50, sat: 0.8, shift: -12 },
      { h: 75, half: 40, sat: 1.08 },
    ],
  });
  lab = tone(lab, { shadows: [0.004, 0.006], mids: [0.006, 0.014], highlights: [0.006, 0.024], skinKeep: 0.5 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.6, chroma: 1.04 }));
}

/** CCD — early compact digital: clean cool white balance, cyan shadows, slightly magenta highlights, skin kept pink. */
const lookCcdCurve = curve([
  [0, 0],
  [0.25, 0.24],
  [0.5, 0.52],
  [0.75, 0.8],
  [1, 1],
]);
function lookCcd(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(whiteBalance(c, [0.95, 1, 1.07], 'max'));
  lab = withL(lab, lookCcdCurve);
  lab = chroma(lab, {
    sat: 1.08,
    skinSat: 1,
    bands: [
      { h: 0, half: 35, sat: 1.15, shift: -6 },
      { h: 200, half: 50, sat: 1.1, shift: -10 },
      { h: 140, half: 50, shift: 12 },
    ],
  });
  lab = tone(lab, { shadows: [-0.018, -0.022], highlights: [0.014, -0.006], skinKeep: 0.6 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.7, hueShift: -6 }));
}

/** 直閃 — direct on-camera flash: neutral-cool, hard curve with deep blacks and a bright shoulder, skin held. */
const lookFlashCurve = curve([
  [0, 0],
  [0.15, 0.11],
  [0.5, 0.5],
  [0.85, 0.9],
  [1, 1],
]);
function lookFlash(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(whiteBalance(c, [0.98, 1, 1.03], 'max'));
  lab = withL(lab, lookFlashCurve);
  lab = chroma(lab, { sat: 0.94, skinSat: 1.02 });
  lab = tone(lab, { shadows: [-0.004, -0.008], highlights: [0.002, 0.004], skinKeep: 0.8 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.8 }));
}

/** 藍調 — blue hour: blue shadows, cyan-blue mids, cool highlights, greens to teal, skin kept out of most of the cast. */
const lookBlueCurve = curve([
  [0, 0.02],
  [0.25, 0.25],
  [0.5, 0.51],
  [0.75, 0.76],
  [1, 0.98],
]);
function lookBlue(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(c);
  lab = withL(lab, lookBlueCurve);
  lab = chroma(lab, {
    sat: 0.92,
    skinSat: 0.95,
    bands: [
      { h: 140, half: 55, sat: 0.8, shift: 30 },
      { h: 60, half: 35, sat: 0.8 },
    ],
  });
  lab = tone(lab, { shadows: [-0.012, -0.04], mids: [-0.012, -0.02], highlights: [-0.006, -0.006], skinKeep: 0.65 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.5, hueShift: -6, chroma: 0.9 }));
}

/** 電影感 — teal and orange: teal shadows, orange highlights, greens and blues pulled to teal, mild S-curve. */
const lookCinemaCurve = curve([
  [0, 0.02],
  [0.2, 0.18],
  [0.5, 0.5],
  [0.8, 0.83],
  [1, 0.98],
]);
function lookCinema(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(c);
  lab = withL(lab, lookCinemaCurve);
  lab = chroma(lab, {
    sat: 0.95,
    skinSat: 1.04,
    bands: [
      { h: 140, half: 60, sat: 0.75, shift: 45 },
      { h: 250, half: 45, sat: 0.9, shift: -18 },
      { h: 60, half: 30, sat: 1.06 },
    ],
  });
  lab = tone(lab, { shadows: [-0.026, -0.022], highlights: [0.012, 0.03], skinKeep: 0.55 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.6, chroma: 1.05 }));
}

export const LOOK_IDS = ['film', 'ccd', 'flash', 'blue', 'cinema'];
export const LOOK_GRADES = { film: lookFilm, ccd: lookCcd, flash: lookFlash, blue: lookBlue, cinema: lookCinema };
```

5. After `drawSwatch` (before the `// ── output ──` banner) add:

```js
/**
 * A 質感 look on an RGBA8 image: the LUT mix at `amount`, then the look's 調節 offsets through adjustMath.adjustRgb
 * (seed 0, the app's editor and export grain). `thumb` grades grain on the image's own pixel grid at 0.6 amplitude.
 */
export function gradeLook(id, lut, rgba, width, height, amount, thumb = false) {
  const def = LOOK_DEFS.find((l) => l.id === id);
  if (!def) throw new Error(`unknown look ${id}`);
  const graded = applyLut(lut, rgba, amount);
  const u = adjustUniforms({}, { def, amount }, true, { ...frameFor({ width, height }), thumb });
  const out = Buffer.alloc(graded.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const c = adjustRgb([graded[i] / 255, graded[i + 1] / 255, graded[i + 2] / 255], u, [(x + 0.5) / width, (y + 0.5) / height]);
      out[i] = Math.round(c[0] * 255);
      out[i + 1] = Math.round(c[1] * 255);
      out[i + 2] = Math.round(c[2] * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The 質感 strip thumbnail: the swatch graded by the full look at its default 程度. */
export function buildLookThumb(id, lut, swatch = drawSwatch(THUMB)) {
  const def = LOOK_DEFS.find((l) => l.id === id);
  if (!def) throw new Error(`unknown look ${id}`);
  return gradeLook(id, lut, swatch, THUMB, THUMB, def.defaultAmount, true);
}
```

6. At the end of `main()` (after the filter loop) add:

```js
  mkdirSync(looksDir, { recursive: true });
  for (const id of LOOK_IDS) {
    const lut = buildLut(LOOK_GRADES[id]);
    writeFileSync(join(looksDir, `look_${id}.png`), encodePng(lut, LUT_DIM, LUT_DIM));
    writeFileSync(join(looksDir, `look_${id}_thumb.png`), encodePng(buildLookThumb(id, lut, swatch), THUMB, THUMB));
    console.log(`public/luts/looks/look_${id}.png + look_${id}_thumb.png`);
  }
```

- [x] **Step 4: Generate the assets**

Run: `node scripts/gen-luts.mjs && git status --short public/luts`
Expected: the console lists 8 filter lines and 5 `public/luts/looks/look_<id>.png + look_<id>_thumb.png` lines; `git status` shows `?? public/luts/looks/`. If it also lists modified files under `public/luts/filters/` (a different zlib build can change PNG bytes without changing pixels), restore them with `git checkout -- public/luts/filters` — their pixels are pinned by the existing asset tests.

- [x] **Step 5: The tuning sheet**

Create `tests/harness/t5/preview-looks.mjs`:

```js
// T5 harness: the 質感 tuning sheet (v0.4 step-2 spec §4.6). Grades sample_face.png, the thumbnail swatch and a
// gradient chart with every look at 程度 50, 80 and 100 (LUT mix + the look's 調節 offsets through adjustMath.ts, as
// the app draws them at seed 0), under a first row of 原圖 · 濾鏡 膠片 (its default 0.6) · 原圖 for comparison.
// Output (gitignored): previews/looks.png (face), previews/looks_swatch.png, previews/looks_chart.png.
// Usage: node tests/harness/t5/preview-looks.mjs   (Node ≥ 22.18: the generator imports src/engine/*.ts)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { LOOK_IDS, THUMB, applyLut, drawSwatch, encodePng, gradeLook } from '../../../scripts/gen-luts.mjs';
import { resampleRgb } from '../../../scripts/gen-y4m.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, 'previews');
mkdirSync(out, { recursive: true });
const readPng = (p) => PNG.sync.read(readFileSync(p));

const FW = 250;
const FH = 375;
const face = readPng(join(root, 'tests', 'fixtures', 'sample_face.png'));
const rgb = resampleRgb(face.data, face.width, face.height, { x: 0, y: 0, w: face.width, h: face.height }, FW, FH);
const small = Buffer.alloc(FW * FH * 4);
for (let i = 0; i < FW * FH; i++) {
  small[i * 4] = Math.round(rgb[i * 3]);
  small[i * 4 + 1] = Math.round(rgb[i * 3 + 1]);
  small[i * 4 + 2] = Math.round(rgb[i * 3 + 2]);
  small[i * 4 + 3] = 255;
}

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
const CW = 360;
const CH = 150;
const chart = Buffer.alloc(CW * CH * 4);
for (let y = 0; y < CH; y++) {
  for (let x = 0; x < CW; x++) {
    let c;
    if (y < 50) c = hsv(x, 1, 1 - y / 60);
    else if (y < 100) c = hsv(x, 0.45, 1 - (y - 50) / 60);
    else if (y < 125) c = [x / (CW - 1), x / (CW - 1), x / (CW - 1)];
    else {
      const t = x / (CW - 1);
      c = [141 + (241 - 141) * t, 85 + (194 - 85) * t, 60 + (167 - 60) * t].map((v) => v / 255);
    }
    const i = (y * CW + x) * 4;
    chart[i] = Math.round(c[0] * 255);
    chart[i + 1] = Math.round(c[1] * 255);
    chart[i + 2] = Math.round(c[2] * 255);
    chart[i + 3] = 255;
  }
}

function sheet(cells, cw, ch, cols) {
  const rows = Math.ceil(cells.length / cols);
  const gap = 6;
  const W = cols * cw + (cols + 1) * gap;
  const H = rows * ch + (rows + 1) * gap;
  const buf = Buffer.alloc(W * H * 4, 0);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  cells.forEach((cell, k) => {
    const ox = gap + (k % cols) * (cw + gap);
    const oy = gap + Math.floor(k / cols) * (ch + gap);
    for (let y = 0; y < ch; y++) cell.copy(buf, ((oy + y) * W + ox) * 4, y * cw * 4, (y + 1) * cw * 4);
  });
  return { buf, W, H };
}

const filmFilter = readPng(join(root, 'public', 'luts', 'filters', 'film.png')).data;
const swatch = drawSwatch(THUMB);
for (const [name, img, w, h] of [
  ['looks', small, FW, FH],
  ['looks_swatch', swatch, THUMB, THUMB],
  ['looks_chart', chart, CW, CH],
]) {
  const cells = [img, applyLut(filmFilter, img, 0.6), img];
  for (const id of LOOK_IDS) {
    const lut = readPng(join(root, 'public', 'luts', 'looks', `look_${id}.png`)).data;
    for (const a of [0.5, 0.8, 1]) cells.push(gradeLook(id, lut, img, w, h, a));
  }
  const s = sheet(cells, w, h, 3);
  writeFileSync(join(out, `${name}.png`), encodePng(s.buf, s.W, s.H));
}
console.log('previews written to tests/harness/t5/previews/looks.png, looks_swatch.png, looks_chart.png');
```

Run: `node tests/harness/t5/preview-looks.mjs`
Expected: prints the `previews written …` line; `tests/harness/t5/previews/looks.png` exists (gitignored by `tests/harness/**/*.png`). This is the sheet S §3.7 asks to show the user; the user pre-authorized execution, so do not wait — name its path in this task's commit message.

- [x] **Step 6: Licensing lines**

`LICENSES/NOTICE.txt` (LF): replace line 48

`Original to this project: the filter LUTs, makeup shade colours and the icons.`

with

```
Original to this project: the filter LUTs, the 質感 look LUTs and thumbnails, makeup shade colours and the icons.
The 顆粒 (grain) hash uses the lowbias32 finalizer constants published in Chris Wellons' hash-prospector
(github.com/skeeto/hash-prospector), dedicated to the public domain (The Unlicense); the code is this project's own.
```

`src/ui/screens/Settings.tsx` (LF): in the credits paragraph (lines 252-253) change `未使用其任何程式碼或素材。濾鏡` (end of line 252) + `LUT、色號與圖示為本專案原創` (start of line 253) so the sentence reads `濾鏡與質感 LUT、色號與圖示為本專案原創`: replace `濾鏡\n        LUT、色號與圖示為本專案原創` with `濾鏡與質感\n        LUT、色號與圖示為本專案原創` (keep the line break and indentation).

- [x] **Step 7: Run the asset tests**

Run: `npx vitest run tests/harness/t5/assets.test.mjs`
Expected: PASS (while writing the plan these recipes measured: maxStep film 16, ccd 31, flash 7, blue 30, cinema 27; thumbnails vs the swatch ≥ 8.9; pairwise ≥ 6; vs every filter thumbnail ≥ 6.9; every skin patch inside the hue/chroma/lightness window). If a check fails after the user's tuning feedback, change only the recipe constants or the `LOOKS` offsets (S §3.2: "the tests check behaviour, not the constants"), regenerate (Step 4) and rerun.

- [x] **Step 8: Full suite and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add scripts/gen-luts.mjs public/luts/looks tests/harness/t5/assets.test.mjs tests/harness/t5/preview-looks.mjs LICENSES/NOTICE.txt src/ui/screens/Settings.tsx
git commit -m "v0.4 step 2: 質感 look LUTs and thumbnails (original work), asset tests, tuning sheet" -m "Tuning sheet for the user's review: tests/harness/t5/previews/looks.png (node tests/harness/t5/preview-looks.mjs)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: GPU composite harness — the real shader against compositeCpu

**Files:**
- Create: `tests/e2e/pages/composite.html`, `tests/e2e/pages/composite.ts`, `tests/e2e/composite.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`ADJUST_IDS`, `ADJUST_ONE_WAY`, `adjustUniforms`, `frameFor`), Task 6 (`compositeCpu`), Task 8 (`createEngine` with `loadLut`, `RenderInput` with `photo.values`/`photo.look`), Task 9 (the shipped look LUTs), Task 2 (`LOOK_IDS`, `lookDef`); step 1's `defaultPhoto()` and the `RenderInput` fields `faces`/`globalSkin`.
- Produces: `window.runCompositeCheck(): Promise<CompositeCheck>` with `CompositeCheck { renderer: string; glError: number; cases: Record<string, { passes: string[]; max: number; mean: number; p999: number }> }`; the Playwright test `tests/e2e/composite.spec.ts`.

- [ ] **Step 1: Write the failing spec**

Create `tests/e2e/composite.spec.ts`:

```ts
// GPU composite == compositeCpu (v0.4 step-2 spec §8.3) on the dev-server harness page: each 調節 item at ±max,
// each 質感 look at 100, everything together, grain; neutral frames use the base program; no jump at the switch.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('composite: 調節 and 質感 on the GPU match compositeCpu; neutral frames use the base program', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`${DEV_URL}/tests/e2e/pages/composite.html`);
  await page.waitForFunction(() => typeof window.runCompositeCheck === 'function');
  const r = await page.evaluate(() => window.runCompositeCheck!());
  console.log(`renderer: ${r.renderer}`);
  for (const [name, c] of Object.entries(r.cases))
    console.log(`${name.padEnd(24)} max ${c.max} mean ${c.mean.toFixed(3)} p99.9 ${c.p999} [${c.passes.join(',')}]`);

  expect(r.glError).toBe(0);
  // neutral: step 1's base program drew (no 'adjust' pass) and the composite is the identity on its input
  expect(r.cases.neutral.passes).not.toContain('adjust');
  expect(r.cases.neutral.passes).toContain('composite');
  expect(r.cases.neutral.max).toBeLessThanOrEqual(1);

  for (const [name, c] of Object.entries(r.cases)) {
    if (name === 'neutral') continue;
    expect(c.passes, name).toContain('adjust');
    if (name.startsWith('look:') || name === 'all') {
      // GPU bilinear LUT taps use fixed-point weights (as engine.spec.ts accepts for 黑白)
      expect(c.mean, name).toBeLessThanOrEqual(1);
    } else if (name === 'adjust.grain+') {
      // cell-boundary rounding: float32 lattice coordinates can pick the neighbouring cell
      expect(c.p999, name).toBeLessThanOrEqual(1);
    } else if (name.startsWith('jump:')) {
      // +1 display unit through the 調節 program vs the neutral base render: a continuous change, no jump
      expect(c.max, name).toBeLessThanOrEqual(2);
      expect(c.mean, name).toBeLessThanOrEqual(0.5);
    } else {
      expect(c.max, name).toBeLessThanOrEqual(1);
      expect(c.mean, name).toBeLessThanOrEqual(0.25);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/composite.spec.ts`
Expected: FAIL — the page does not exist (`waitForFunction` times out / 404 on `composite.html`).

- [ ] **Step 3: The harness page**

Create `tests/e2e/pages/composite.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>composite check</title>
  </head>
  <body style="margin: 0; background: #000">
    <canvas id="gl"></canvas>
    <script type="module" src="./composite.ts"></script>
  </body>
</html>
```

Create `tests/e2e/pages/composite.ts`:

```ts
// Composite check (v0.4 step-2 spec §8.3): renders a generated chart and sample_face.png (250×375) through the real
// engine and compares each export with compositeCpu() — the CPU reference of P5's 質感 + 調節 stages — in the page.
// Skin stages are neutral and the 濾鏡 is 無, so the composite reads the source itself; both paths start from the
// same bytes (ImageData → ImageBitmap without colour conversion).
import { ADJUST_IDS, ADJUST_ONE_WAY, adjustUniforms, frameFor } from '../../../src/engine/adjustMath';
import { compositeCpu } from '../../../src/engine/compositeCpu';
import { createEngine } from '../../../src/engine/index';
import { LOOK_IDS, lookDef } from '../../../src/engine/looks';
import { defaultPhoto } from '../../../src/edit/state';
import type { AdjustId, LookId, PhotoParams, RenderInput } from '../../../src/types';

export interface CaseStats {
  passes: string[];
  max: number;
  mean: number;
  p999: number;
}
export interface CompositeCheck {
  renderer: string;
  glError: number;
  cases: Record<string, CaseStats>;
}

declare global {
  interface Window {
    runCompositeCheck?: () => Promise<CompositeCheck>;
  }
}

const SKINS = [
  [241, 194, 167],
  [232, 190, 172],
  [224, 172, 150],
  [200, 150, 130],
  [198, 134, 110],
  [171, 140, 114],
  [141, 85, 60],
];

function hsv(h: number, s: number, v: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** 256×128: grey ramp, hue sweeps at three saturations, the 7 skin patches, a flat mid-grey block */
function chart(): ImageData {
  const W = 256;
  const H = 128;
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: number[];
      if (y < 24) c = [x / 255, x / 255, x / 255];
      else if (y < 48) c = hsv((x / W) * 360, 1, 0.9);
      else if (y < 72) c = hsv((x / W) * 360, 0.55, 0.75);
      else if (y < 96) c = hsv((x / W) * 360, 0.25, 0.6);
      else if (x < 7 * 24) c = SKINS[Math.floor(x / 24)].map((v) => v / 255);
      else c = [0.5, 0.5, 0.5];
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(c[0] * 255);
      img.data[i + 1] = Math.round(c[1] * 255);
      img.data[i + 2] = Math.round(c[2] * 255);
      img.data[i + 3] = 255;
    }
  return img;
}

/** pixels of a same-origin PNG (opaque, no colour conversion), optionally resized */
async function pixels(url: string, w?: number, h?: number): Promise<ImageData> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const W = w ?? bmp.width;
  const H = h ?? bmp.height;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  return ctx.getImageData(0, 0, W, H);
}

/** every skin stage off, no 濾鏡, no look, neutral 調節 */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  return { ...p, filterId: 'none', presetLink: null, look: null, values: { ...p.values, 'skin.whiten': 0, 'skin.sharpen': 0, 'filter.amount': 0 } };
}

/** max / mean / 99.9th percentile of |a − b| over the RGB channels of every pair */
function diffStats(pairs: [ArrayLike<number>, ArrayLike<number>][]): { max: number; mean: number; p999: number } {
  const hist = new Array<number>(256).fill(0);
  let sum = 0;
  let n = 0;
  let max = 0;
  for (const [a, b] of pairs)
    for (let i = 0; i < a.length; i += 4)
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(a[i + k] - b[i + k]);
        hist[d]++;
        sum += d;
        n++;
        if (d > max) max = d;
      }
  let acc = 0;
  let p999 = 0;
  for (let d = 0; d < 256; d++) {
    acc += hist[d];
    if (acc >= n * 0.999) {
      p999 = d;
      break;
    }
  }
  return { max, mean: sum / n, p999 };
}

interface Case {
  values?: Partial<Record<AdjustId, number>>;
  look?: { id: LookId; amount: number };
}

window.runCompositeCheck = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  for (const id of LOOK_IDS) await engine.loadLut('look', id);
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const luts: Record<string, Uint8ClampedArray> = {};
  for (const id of LOOK_IDS) luts[id] = (await pixels(`/luts/looks/look_${id}.png`)).data;
  const sources = [chart(), await pixels('/tests/fixtures/sample_face.png', 250, 375)];
  const bitmaps = await Promise.all(sources.map((s) => createImageBitmap(s, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })));

  const cases: Record<string, Case> = { neutral: {} };
  for (const id of ADJUST_IDS) {
    cases[`${id}+`] = { values: { [id]: 1 } };
    if (!ADJUST_ONE_WAY.has(id)) cases[`${id}-`] = { values: { [id]: 0 } };
  }
  for (const id of LOOK_IDS) cases[`look:${id}`] = { look: { id, amount: 1 } };
  cases.all = {
    values: Object.fromEntries(ADJUST_IDS.map((id) => [id, ADJUST_ONE_WAY.has(id) ? 0.6 : 0.8])) as Partial<Record<AdjustId, number>>,
    look: { id: 'cinema', amount: 0.8 },
  };
  // one display unit off neutral (below the slider's ±3 snap): drawn by the 調節 program, compared with the base render
  cases['jump:brightness'] = { values: { 'adjust.brightness': 0.51 } };
  cases['jump:exposure'] = { values: { 'adjust.exposure': 0.51 } };

  const neutralGpu: Uint8ClampedArray[] = [];
  const out: Record<string, CaseStats> = {};
  for (const [name, c] of Object.entries(cases)) {
    const pairs: [ArrayLike<number>, ArrayLike<number>][] = [];
    let passes: string[] = [];
    sources.forEach((src, s) => {
      const base = neutralPhoto();
      const photo: PhotoParams = { ...base, values: { ...base.values, ...c.values }, look: c.look ?? null };
      const input: RenderInput = { source: bitmaps[s], width: src.width, height: src.height, faces: [], globalSkin: null, photo };
      passes = engine.render(input, { still: true }).passes;
      const gpu = engine.renderToImageData(input, { mirror: false }).data;
      if (name === 'neutral') neutralGpu[s] = gpu;
      if (name.startsWith('jump:')) {
        pairs.push([gpu, neutralGpu[s]]);
        return;
      }
      const def = c.look ? lookDef(c.look.id) : null;
      const look = def && c.look ? { def, amount: c.look.amount } : null;
      const u = adjustUniforms(photo.values, look, true, frameFor({ width: src.width, height: src.height }));
      pairs.push([gpu, compositeCpu(src.data, src.width, src.height, u, c.look ? luts[c.look.id] : null)]);
    });
    out[name] = { passes, ...diffStats(pairs) };
  }

  const glError = gl.getError();
  engine.dispose();
  for (const b of bitmaps) b.close();
  return { renderer, glError, cases: out };
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx playwright test tests/e2e/composite.spec.ts`
Expected: PASS; the log shows every ALU case at max ≤ 1, the looks at mean ≤ 1, `jump:*` at max ≤ 2. (The `jump` bound is 2, not S §8.3's 1: the CPU reference itself moves saturated colours by up to 2 levels at +1 display unit of 亮度 — continuous, not a program-switch jump; Task 5's continuity test pins ≤ 1 level at 0.1 unit.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/pages/composite.html tests/e2e/pages/composite.ts tests/e2e/composite.spec.ts
git commit -m "v0.4 step 2: GPU composite harness vs compositeCpu (each item at ±max, looks, all, grain, no jump)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Still and live sessions — both LUTs, export readiness, picture frame, moving grain

**Files:**
- Modify: `src/app/still.ts` (`:105-110` LUT bookkeeping, `:144-162` `ensureFilter`, `:184-198` `onRestored`, `:200-228` `prepare`, `:237-242` `render`, `:259-271` `exportReady`/`exportImageData`) — LF
- Modify: `src/app/live.ts` (`:38-48` `LiveDeps`, `:101` requested set, `:139-190` `step`, `:202-205` `draw`, `:263-267` `ensureFilter`, `:353-365` `capture`) — CRLF
- Modify: `src/app/testFakes.ts:121-167` (`FakeEngine`) — CRLF
- Modify: `src/ui/imaging.ts` (new `normalizedCropRect`) — LF
- Test: `src/app/still.test.ts`, `src/app/live.test.ts` (extend); `src/ui/imaging.frame.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 (`photoLuts`), Task 8 (`Engine.loadLut`, `Engine.lutState`, `RenderInput.pictureFrame/grainSeed`); step 1's `StillFrame`, `render(frame)`, `prepareExport(frame)`, `exportReady(frame)`, `exportImageData(frame, body?)`; step 1's `LiveDeps` camera-look accessor `getLook` and `capture()`; `centerCropRect` (`src/ui/imaging.ts:13-24`).
- Produces:
  - `LiveDeps.getFrame?: () => Rect` — read every frame; absent → whole frame
  - live `RenderInput.grainSeed` = a per-loop counter advanced once per drawn camera frame (not on redraw); `capture()` uses the current one
  - `normalizedCropRect(w: number, h: number, ratio: number): Rect` (source UV; `{0, 0, 1, 1}` for an empty frame)
  - still `exportReady(frame)` true only when `lutState` of the frame's 濾鏡 and 質感 is `ready` or `failed`
  - `FakeEngine.loadLut`, `.lutState`, `.loadLook`, `.lutStates: Map<string, LutState>`, `.adjustUnavailable`

- [ ] **Step 0: Confirm the step-1 shapes**

Run: `grep -n "requestedFilters\|settledFilters\|ensureFilter\|StillFrame\|frame\b" src/app/still.ts | head -30; grep -n "getParams\|getLook\|ensureFilter\|requestedFilters\|capture()" src/app/live.ts`
Expected: the v0.3 filter bookkeeping is still in both files; the still session stores the latest `StillFrame` (this plan calls that variable `frame`); the live loop reads the camera look through one accessor (this plan calls it `getLook`). Use step 1's names where they differ.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/imaging.frame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { centerCropRect, normalizedCropRect } from './imaging';

describe('normalizedCropRect: the camera picture frame (step-2 spec §4.5)', () => {
  it('is centerCropRect in source UV for each ratio and stream shape', () => {
    for (const ratio of [3 / 4, 1, 9 / 16])
      for (const [w, h] of [
        [1280, 720],
        [1080, 1920],
        [1920, 1080],
      ]) {
        const r = centerCropRect(w, h, ratio);
        expect(normalizedCropRect(w, h, ratio)).toEqual({ x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h });
      }
  });

  it('is the whole frame before the first video frame (0 × 0)', () => {
    expect(normalizedCropRect(0, 0, 3 / 4)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
```

Append to `src/app/still.test.ts` (it already has `bitmap()`, `fakeEngine`, `fakeTracker`, fake timers and `stubRaf`; add `import { defaultPhoto } from '../edit/state';` and add `PhotoParams, StillFrame` to its existing `import type { BeautyParams } from '../types';` — `StillFrame` is declared in `src/types.ts`, `./still` does not export it):

```ts
describe('濾鏡 and 質感 LUTs in the still session (step-2 spec §3.5)', () => {
  const frameOf = (photo: Partial<PhotoParams>): StillFrame => ({ faces: [], globalSkin: null, photo: { ...defaultPhoto(), ...photo } });

  it('prepareExport loads both LUTs; exportReady waits for the look LUT', async () => {
    const engine = fakeEngine();
    let done!: () => void;
    engine.loadLook.mockImplementation(() => new Promise<void>((r) => (done = r)));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ filterId: 'warm', look: { id: 'ccd', amount: 0.8 } });
    const p = s.prepareExport(f);
    expect(engine.loadLut).toHaveBeenCalledWith('filter', 'warm');
    expect(engine.loadLut).toHaveBeenCalledWith('look', 'ccd');
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(f)).toBe(false);
    done();
    await p;
    expect(s.exportReady(f)).toBe(true);
  });

  it('a LUT the LRU evicted turns exportReady false again', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ look: { id: 'film', amount: 0.8 } });
    await s.prepareExport(f);
    expect(s.exportReady(f)).toBe(true);
    engine.lutStates.delete('look:film');
    expect(s.exportReady(f)).toBe(false);
  });

  it('a failed look LUT counts as settled (the preview skips it too)', async () => {
    const engine = fakeEngine();
    engine.loadLook.mockImplementation(() => Promise.reject(new Error('offline')));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ look: { id: 'blue', amount: 0.8 } });
    await s.prepareExport(f);
    expect(engine.lutState('look', 'blue')).toBe('failed');
    expect(s.exportReady(f)).toBe(true);
  });

  it('redraws when a LUT that the screen started loading arrives', async () => {
    const engine = fakeEngine();
    let done!: () => void;
    engine.loadLook.mockImplementation(() => new Promise<void>((r) => (done = r)));
    void engine.loadLut('look', 'blue'); // the screen's useLutLoader asked first
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(frameOf({ look: { id: 'blue', amount: 0.8 } }));
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    done();
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBe(renders + 1);
    expect(engine.loadLook).toHaveBeenCalledTimes(1);
  });
});
```

Append to `src/app/live.test.ts` (it has `installWorkClock`, `FakeVideo`, `fakeEngine`, `fakeCamera`, `makePrefs` (`prefs as makePrefs`); add `import { defaultPhoto, naturalPerson } from '../edit/state';` and `CameraLook`, `Rect` to the `../types` type import; `LiveDeps.getAll` is required, as in its other `startLiveLoop` calls):

```ts
describe('調節 and 質感 in the live loop (step-2 spec §2.3, §4.4–4.5)', () => {
  const lookWith = (photo: Partial<CameraLook['photo']> = {}): CameraLook => ({
    photo: { ...defaultPhoto(), ...photo },
    person: naturalPerson(),
  });

  it('reads the picture frame every frame; the grain seed advances once per drawn frame, not on redraw; capture uses it', () => {
    const clock = installWorkClock();
    const video = new FakeVideo();
    const engine = fakeEngine(clock);
    let frame: Rect = { x: 0.25, y: 0, w: 0.5, h: 1 };
    const look = lookWith();
    const loop = startLiveLoop({
      camera: fakeCamera(video),
      engine,
      tracker: null,
      getLook: () => look,
      getAll: () => false,
      getPrefs: () => makePrefs(),
      getFrame: () => frame,
    });
    video.play();
    vi.advanceTimersByTime(33 * 4 + 1);
    const seeds = engine.render.mock.calls.map(([i]) => i.grainSeed!);
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seeds.length; i++) expect(seeds[i]).toBe(seeds[i - 1] + 1);
    expect(engine.lastInput()!.pictureFrame).toEqual(frame);
    frame = { x: 0, y: 0.2, w: 1, h: 0.6 }; // ratio change: the vignette follows at once
    vi.advanceTimersByTime(33);
    expect(engine.lastInput()!.pictureFrame).toEqual(frame);
    const seed = engine.lastInput()!.grainSeed;
    loop.setCompare(true);
    loop.setCompare(false); // a redraw of the same video frame keeps its grain
    expect(engine.lastInput()!.grainSeed).toBe(seed);
    expect(loop.capture()).not.toBeNull();
    const [shot] = engine.renderToImageData.mock.calls.at(-1)!;
    expect(shot.grainSeed).toBe(seed);
    expect(shot.pictureFrame).toEqual(frame);
    loop.stop();
  });

  it('requests the 質感 LUT with the 濾鏡 LUT, once each', () => {
    const clock = installWorkClock();
    const video = new FakeVideo();
    const engine = fakeEngine(clock);
    const look = lookWith({ filterId: 'warm', look: { id: 'ccd', amount: 0.8 } });
    const loop = startLiveLoop({ camera: fakeCamera(video), engine, tracker: null, getLook: () => look, getAll: () => false, getPrefs: () => makePrefs() });
    video.play();
    vi.advanceTimersByTime(33 * 5 + 1);
    expect(engine.loadLut.mock.calls.filter(([k, id]) => k === 'filter' && id === 'warm')).toHaveLength(1);
    expect(engine.loadLut.mock.calls.filter(([k, id]) => k === 'look' && id === 'ccd')).toHaveLength(1);
    loop.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/imaging.frame.test.ts src/app/still.test.ts src/app/live.test.ts`
Expected: FAIL — `normalizedCropRect` is not exported; `engine.loadLook` is undefined; `grainSeed` is undefined.

- [ ] **Step 3: The fake engine tracks LUT states like the real cache**

In `src/app/testFakes.ts` (CRLF — Edit tool): add `LutKind`, `LutState` to its `../types` type import; add to `interface FakeEngine` after `loadFilter`:

```ts
  loadLut: ReturnType<typeof vi.fn<Engine['loadLut']>>;
  lutState: ReturnType<typeof vi.fn<Engine['lutState']>>;
  /** settles 質感 loads (filter loads go through loadFilter, so v0.3 tests keep counting them there) */
  loadLook: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  /** what lutState reports, keyed `${kind}:${id}`; delete a key to simulate the LRU evicting that LUT */
  lutStates: Map<string, LutState>;
  adjustUnavailable: boolean;
```

and in the object literal of `fakeEngine` (after `loadFilter: vi.fn(() => Promise.resolve()),`):

```ts
    loadLook: vi.fn(() => Promise.resolve()),
    lutStates: new Map<string, LutState>(),
    /** in-flight loads (the real cache answers a repeated request with the same promise) */
    lutPending: new Map<string, Promise<void>>(),
    /** bumped on webglcontextrestored: loads begun before it settle without leaving a texture, as in the engine */
    lutGen: 0,
    adjustUnavailable: false,
    loadLut: vi.fn((kind: LutKind, id: string): Promise<void> => {
      if (kind === 'filter' && id === 'none') return Promise.resolve();
      const key = `${kind}:${id}`;
      const pending = e.lutPending.get(key);
      if (pending && e.lutStates.get(key) === 'loading') return pending;
      const gen = e.lutGen;
      e.lutStates.set(key, 'loading');
      const p = kind === 'filter' ? e.loadFilter(id) : e.loadLook(id);
      e.lutPending.set(key, p);
      p.then(
        () => {
          if (gen === e.lutGen) e.lutStates.set(key, 'ready');
        },
        () => {
          if (gen === e.lutGen) e.lutStates.set(key, 'failed');
        },
      );
      return p;
    }),
    lutState: vi.fn((kind: LutKind, id: string): LutState =>
      kind === 'filter' && id === 'none' ? 'ready' : (e.lutStates.get(`${kind}:${id}`) ?? 'none'),
    ),
```

and directly before `return e as unknown as FakeEngine;`:

```ts
  // registered before any session's listener, as the real engine's own listener is (index.ts:144-145)
  e.canvas.addEventListener('webglcontextrestored', () => {
    e.lutGen++;
    e.lutStates.clear();
    e.lutPending.clear();
  });
```

- [ ] **Step 4: Still session**

In `src/app/still.ts`:
1. Add `import { photoLuts } from '../engine/looks';`.
2. Replace the two sets (`requestedFilters`, `settledFilters` and its comment, lines 105-107) with:

```ts
  /** LUT loads this session waits on to redraw (`${kind}:${id}`); cleared on restore */
  const waiting = new Set<string>();
```

3. Replace `ensureFilter` (lines 144-162) with:

```ts
  /**
   * Ask for every LUT the photo draws with (濾鏡 and 質感) and redraw when one arrives: the first frame may have gone
   * out without it. A LUT already resident needs nothing; a failed one is retried only by an explicit tap (the
   * screen's requestLut), so the preview and the export both skip it.
   */
  function ensureLuts(photo: StillFrame['photo']): void {
    for (const r of photoLuts(photo)) {
      const state = engine.lutState(r.kind, r.id);
      if (state === 'ready' || state === 'failed') continue;
      const key = `${r.kind}:${r.id}`;
      if (waiting.has(key)) continue;
      waiting.add(key);
      engine.loadLut(r.kind, r.id).then(
        () => {
          waiting.delete(key);
          schedule();
        },
        (err: unknown) => {
          waiting.delete(key);
          reportError(`${r.kind} ${r.id}`, err);
        },
      );
    }
  }
```

4. In `onRestored` replace `requestedFilters.clear(); settledFilters.clear();` with `waiting.clear();` and `if (frame) ensureFilter(frame.photo.filterId);` with `if (frame) ensureLuts(frame.photo);`.
5. Replace `prepare` (lines 200-228) with:

```ts
  function prepare(f: StillFrame, retries: number): Promise<void> {
    if (disposed) return Promise.resolve();
    // static textures (skin LUTs, makeup) too: after a context restore they reload asynchronously
    const ready = engine.ready;
    const g = gen;
    const statics = ready.catch(() => undefined);
    const loads = photoLuts(f.photo).map((r) => {
      try {
        return engine.loadLut(r.kind, r.id).catch(() => undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    });
    return Promise.all([statics, ...loads]).then(() => {
      // still lost (or closed): exportImageData throws and the callers handle that
      if (disposed || engine.lost) return;
      // lost and restored meanwhile: the loads above settled against the dead context without leaving their
      // textures behind, so wait for the reloaded ones (new `ready`, fresh LUT loads)
      if (engine.ready !== ready || g !== gen) {
        if (retries > 0) return prepare(f, retries - 1);
        return;
      }
      staticsSettled = true;
    });
  }
```

6. In `render(f)` and `exportImageData(f, b)` replace the `ensureFilter(f.photo.filterId)` call with `ensureLuts(f.photo)` (step 1 names the `StillFrame` argument `f` there; the session's latest frame is the variable `frame`).
7. Replace `exportReady`'s body after its first guard line with:

```ts
      // ask the engine, not a local set: the LRU may have evicted a LUT this session loaded earlier
      return photoLuts(f.photo).every((r) => {
        const s = engine.lutState(r.kind, r.id);
        return s === 'ready' || s === 'failed';
      });
```

- [ ] **Step 5: Live loop**

In `src/app/live.ts` (CRLF — Edit tool):
1. Add `import { photoLuts } from '../engine/looks';` and `Rect` to the `../types` type import.
2. In `LiveDeps` add:

```ts
  /**
   * step 2: the picture the shutter keeps, as normalized source UV (the ratio's centre crop, Camera.tsx); read every
   * frame, so a ratio change moves the vignette at once. Absent → the whole video frame.
   */
  getFrame?: () => Rect;
```

3. Delete `const requestedFilters = new Set<string>();` (line 101) and add next to the other per-loop state: `/** grain seed: advanced once per drawn camera frame (moving grain, C §12 #11); redraws and the capture reuse it */ let grainSeed = 0;`.
4. In `step()`, replace the `ensureFilter(look.photo.filterId);` call (line 155) with `ensureLuts(look.photo);` (`look` = `deps.getLook()`, read each frame at line 152), and directly before the `draw(look, w, h);` call (line 171) add `grainSeed = (grainSeed + 1) >>> 0;`.
5. In `draw(…)`, add to the `engine.render({ … })` input: `pictureFrame: deps.getFrame?.(), grainSeed,`.
6. Replace `ensureFilter` (lines 263-267) with:

```ts
  /** the photo's 濾鏡 and 質感 LUTs; the frame path draws each once resident, so only unasked LUTs need a request */
  function ensureLuts(photo: { filterId: string; look: { id: string } | null }): void {
    for (const r of photoLuts(photo)) {
      if (engine.lutState(r.kind, r.id) !== 'none') continue;
      engine.loadLut(r.kind, r.id).catch((err: unknown) => reportError(`${r.kind} ${r.id}`, err));
    }
  }
```

7. In `capture()`, add `pictureFrame: deps.getFrame?.(), grainSeed,` to the `renderToImageData({ … })` input.

- [ ] **Step 6: The normalized crop**

In `src/ui/imaging.ts` change its type import `import type { FaceSeed } from '../types';` to `import type { FaceSeed, Rect as UvRect } from '../types';` (the module has its own pixel `Rect`) and add after `centerCropRect`:

```ts
/** centerCropRect as normalized source UV (the camera's picture frame, step-2 spec §4.5); the whole frame when empty. */
export function normalizedCropRect(w: number, h: number, ratio: number): UvRect {
  if (!(w > 0 && h > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const r = centerCropRect(w, h, ratio);
  return { x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/ui/imaging.frame.test.ts src/app/still.test.ts src/app/live.test.ts && npm run typecheck`
Expected: PASS — including every pre-existing still/live test: the fake's `loadLut('filter', id)` calls `loadFilter(id)`, so their `loadFilter` counts are unchanged, and `exportReady` sees the same settle points through `lutState`.

- [ ] **Step 8: Full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/app/still.ts src/app/live.ts src/app/testFakes.ts src/app/still.test.ts src/app/live.test.ts src/ui/imaging.ts src/ui/imaging.frame.test.ts
git commit -m "v0.4 step 2: sessions load 濾鏡 and 質感 LUTs, export readiness from the engine, camera picture frame and moving grain" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Panel model — the 調節 tab and 一鍵 › 美顏／質感

**Files:**
- Modify: `src/ui/panelModel.ts` (`TabId`/`TABS` `:7-19`, `PanelSelection`/`INITIAL_SELECTION` `:26-40`, `ItemVisual`/`ItemAction`/`PanelItem` `:263-297`, `ActivateResult` `:478-485`, `SliderBinding` `:543-558`; new section; dispatch lines in step 1's `itemsFor` `:400`, `activate` `:487`, `sliderFor` `:587`, `tabHasValue` `:669`; step 1's photo-level helpers `personNote` `:158`, `photoScoped` `:190`, `sliderEmptyText` `:627`, `photoTouchToast` `:642`, `TILE_ITEMS` `:654`) — CRLF
- Test: `src/ui/panelModel.adjust.test.ts` (create); `src/ui/panelModel.test.ts:215-216` (mechanical port)

**Interfaces:**
- Consumes: Task 1 (`AdjustId`, `LookId`, the adjust defs), Task 2 (`LOOKS`, `lookDef`, `lookThumbUrl`), Task 3 (`Lens.look()`, `Lens.setLook`, `Lens.resetGroup('adjust')`, `adjustIsNeutral`); `paramDef`, `paramsInGroup`, `hasValue`, `neutralValue` (`src/engine/params.ts`); step 1's ported `itemsFor(lens, sel, body?)`, `activate(item, lens, sel)` → `{edit, sel, changed, notice?}` with its local `done(next = edit, nextSel = sel, notice?)`, `sliderFor(lens, sel, body?)`, `tabHasValue(lens, tab, body?)`, `SliderBinding {key, param, label, bidirectional, value, mixed, defaultValue, apply}` (step-1 plan Task 10).
- Produces (exports of `src/ui/panelModel.ts`):
  - `TabId` += `'adjust'`; `TABS` += `{ id: 'adjust', label: '調節' }` (after 美妝)
  - `type PresetPart = 'beauty' | 'look'`; `PRESET_PARTS: readonly { id: PresetPart; label: string; icon: string }[]`
  - `PanelSelection.adjust: AdjustId` (initial `'adjust.brightness'`), `PanelSelection.presetPart: PresetPart` (initial `'beauty'`)
  - `ItemVisual` thumb gains `fallback?: string`; `ItemAction` += `{ type: 'look'; id: LookId | null }`; `PanelItem.divider?: 'before'`
  - `SliderBinding.track?: 'temperature' | 'tint'`; `SliderBinding.hideDefault?: boolean`; `ActivateResult.retryLook?: LookId`
  - `interface ActivateContext { lookFailed?: (id: LookId) => boolean }`; `activate(item, lens, sel, ctx: ActivateContext = {})` (a new optional 4th parameter)
  - `adjustItems(value: (id: AdjustId) => number, sel: PanelSelection): PanelItem[]`
  - `lookItems(look: PhotoParams['look']): PanelItem[]`
  - `adjustSlider(value: (id: AdjustId) => number, sel: PanelSelection): SliderBinding`
  - `lookSlider(look: PhotoParams['look']): SliderBinding | null`
  - `type LookActivation = { kind: 'none' } | { kind: 'retry'; id: LookId } | { kind: 'set'; id: LookId | null; amount: number }`; `lookActivation(target: LookId | null, look: PhotoParams['look'], failed: (id: LookId) => boolean): LookActivation`
  - `adjustTabHasValue(value: (id: AdjustId) => number): boolean`
  - `interface PartButton { id: string; label: string; icon: string; active: boolean; hasValue: boolean }`; `partButtons(sel, state: { makeupOn(part: MakeupPart): boolean; look: PhotoParams['look'] }): PartButton[] | null`; `selectPart(sel: PanelSelection, id: string): PanelSelection`
  - `leadChip(sel: PanelSelection, look: PhotoParams['look']): { label: string; target: PanelSelection } | null`
  - `photoTabLabel(sel: PanelSelection): '調節' | '質感' | null`
  - step 1's `photoScoped(sel, lens)` is true on both photo-level tabs; `personNote('adjust', lens)` is null; `photoTouchToast` gives one 「調節套用於整張照片」 for the 12 items (seen key `'adjust'`) and, like a look tile through `tapToast` (`TILE_ITEMS.look = '質感'`), one 「質感套用於整張照片」 for the 程度 slider (seen key `'look'`); `sliderEmptyText` is null on 一鍵 › 質感
  - `lookFailedNotice(id: string): string`

- [ ] **Step 0: Confirm the step-1 panel API**

Run: `grep -n "export function \(itemsFor\|activate\|sliderFor\|tabHasValue\)\|export interface ActivateResult\|export interface SliderBinding\|const done" src/ui/panelModel.ts`
Expected (step-1 plan Task 10): `itemsFor(lens, sel, body?)`, `activate(item, lens, sel)`, `sliderFor(lens, sel, body?)`, `tabHasValue(lens, tab, body?)`; `ActivateResult { edit; sel; changed; notice? }`; `SliderBinding` with `param` and `mixed`; inside `activate`, `const edit = lens.edit;` and `const done = (next: EditState = edit, nextSel = sel, notice?: string)`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/panelModel.adjust.test.ts`:

```ts
// 調節 tab and 一鍵 › 質感 (step-2 spec §2.1–2.2, §3.4, §8.1 panelModel list).
import { describe, expect, it } from 'vitest';
import { lensFor } from '../edit/lens';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { paramsInGroup } from '../engine/params';
import type { AdjustId, EditState, PhotoParams } from '../types';
import {
  activate,
  adjustItems,
  adjustSlider,
  adjustTabHasValue,
  INITIAL_SELECTION,
  itemsFor,
  leadChip,
  lookActivation,
  lookFailedNotice,
  lookItems,
  lookSlider,
  partButtons,
  personNote,
  photoScoped,
  photoTabLabel,
  photoTouchToast,
  PRESET_PARTS,
  selectPart,
  sliderEmptyText,
  sliderFor,
  tabHasValue,
  TABS,
  tapToast,
  type PanelSelection,
} from './panelModel';

const sel = (over: Partial<PanelSelection>): PanelSelection => ({ ...INITIAL_SELECTION, ...over });
const ONE_WAY = ['adjust.fade', 'adjust.grain', 'adjust.vignette'];
const neutral = (id: AdjustId) => (ONE_WAY.includes(id) ? 0 : 0.5);
const values = (over: Partial<Record<AdjustId, number>> = {}) => (id: AdjustId) => over[id] ?? neutral(id);
const ADJUST_KEYS = paramsInGroup('adjust').map((d) => d.id);

describe('調節 tab (step-2 spec §2.1)', () => {
  it('sits after 美妝 in the editor and the camera: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節', () => {
    expect(TABS.map((t) => t.label)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節']);
    expect(TABS.at(-1)!.id).toBe('adjust');
  });

  it('strip: ⊘ 原圖 then the 12 items, dividers before 色溫 and 褪色, 亮度 selected first', () => {
    const items = adjustItems(values(), sel({ tab: 'adjust' }));
    expect(items.map((i) => i.key)).toEqual(['reset', ...ADJUST_KEYS]);
    expect(items[0]).toMatchObject({ label: '原圖', action: { type: 'reset' } });
    expect(items.filter((i) => i.divider === 'before').map((i) => i.key)).toEqual(['adjust.temperature', 'adjust.fade']);
    expect(INITIAL_SELECTION.adjust).toBe('adjust.brightness');
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['adjust.brightness']);
    expect(adjustItems(values(), sel({ tab: 'adjust', adjust: 'adjust.vignette' })).find((i) => i.selected)!.label).toBe('暗角');
  });

  it('item dots show only the user values that are not neutral', () => {
    const items = adjustItems(values({ 'adjust.exposure': 0.7, 'adjust.grain': 0.3 }), sel({ tab: 'adjust' }));
    expect(items.filter((i) => i.hasValue).map((i) => i.key)).toEqual(['adjust.exposure', 'adjust.grain']);
  });

  it('slider: ±50 or 0–100, double tap → neutral, no default dot; colour tracks only for 色溫 and 色調', () => {
    const b = adjustSlider(values({ 'adjust.temperature': 0.62 }), sel({ tab: 'adjust', adjust: 'adjust.temperature' }));
    expect(b).toMatchObject({ key: 'adjust.temperature', label: '色溫', bidirectional: true, value: 0.62, defaultValue: 0.5, hideDefault: true, track: 'temperature' });
    expect(adjustSlider(values(), sel({ tab: 'adjust', adjust: 'adjust.tint' })).track).toBe('tint');
    const g = adjustSlider(values(), sel({ tab: 'adjust', adjust: 'adjust.grain' }));
    expect(g).toMatchObject({ label: '顆粒', bidirectional: false, defaultValue: 0, hideDefault: true });
    expect(g.track).toBeUndefined();
  });

  it('tab dot: any of the 12 user values not neutral', () => {
    expect(adjustTabHasValue(values())).toBe(false);
    expect(adjustTabHasValue(values({ 'adjust.shadows': 0.4 }))).toBe(true);
  });
});

describe('一鍵 › 美顏／質感 (step-2 spec §2.2)', () => {
  it('part buttons 美顏 · 質感, 美顏 first; only 質感 shows a dot, while a look is set', () => {
    expect(PRESET_PARTS.map((p) => p.label)).toEqual(['美顏', '質感']);
    expect(INITIAL_SELECTION.presetPart).toBe('beauty');
    const parts = partButtons(sel({ tab: 'preset' }), { makeupOn: () => false, look: { id: 'ccd', amount: 0.8 } })!;
    expect(parts.map((p) => [p.label, p.active, p.hasValue])).toEqual([
      ['美顏', true, false],
      ['質感', false, true],
    ]);
    expect(selectPart(sel({ tab: 'preset' }), 'look').presetPart).toBe('look');
    expect(partButtons(sel({ tab: 'makeup' }), { makeupOn: (p) => p === 'blush', look: null })!.map((p) => p.hasValue)).toEqual([false, true]);
    expect(partButtons(sel({ tab: 'adjust' }), { makeupOn: () => false, look: null })).toBeNull();
  });

  it('質感 strip: 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感, exactly one selected, thumbnails over the look icon', () => {
    const none = lookItems(null);
    expect(none.map((i) => i.label)).toEqual(['無', '膠片', 'CCD', '直閃', '藍調', '電影感']);
    expect(none.filter((i) => i.selected).map((i) => i.label)).toEqual(['無']);
    const film = lookItems({ id: 'film', amount: 0.5 });
    expect(film.filter((i) => i.selected).map((i) => i.label)).toEqual(['膠片']);
    expect(film[1].visual).toEqual({ kind: 'thumb', src: '/luts/looks/look_film_thumb.png', fallback: 'look' });
    expect(none[0].action).toEqual({ type: 'look', id: null });
  });

  it('activation: from 無 → 0.8; hopping keeps 程度; the selected look is a no-op unless its LUT failed (retry); 無 clears', () => {
    const never = () => false;
    expect(lookActivation('film', null, never)).toEqual({ kind: 'set', id: 'film', amount: 0.8 });
    expect(lookActivation('ccd', { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'set', id: 'ccd', amount: 0.55 });
    expect(lookActivation('film', { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'none' });
    expect(lookActivation('film', { id: 'film', amount: 0.55 }, (id) => id === 'film')).toEqual({ kind: 'retry', id: 'film' });
    expect(lookActivation(null, { id: 'film', amount: 0.55 }, never)).toEqual({ kind: 'set', id: null, amount: 0.55 });
    expect(lookActivation(null, null, never)).toEqual({ kind: 'none' });
  });

  it('程度 slider: the look amount, default dot at 80, keyed by look; none while 無', () => {
    expect(lookSlider(null)).toBeNull();
    expect(lookSlider({ id: 'blue', amount: 0.3 })).toMatchObject({ key: 'look.blue', label: '程度', bidirectional: false, value: 0.3, defaultValue: 0.8 });
  });
});

describe('photo-level label, lead chip and notices', () => {
  it('調節 and 一鍵 › 質感 are photo-level tabs; 美顏 is not', () => {
    expect(photoTabLabel(sel({ tab: 'adjust' }))).toBe('調節');
    expect(photoTabLabel(sel({ tab: 'preset', presetPart: 'look' }))).toBe('質感');
    expect(photoTabLabel(sel({ tab: 'preset', presetPart: 'beauty' }))).toBeNull();
    expect(photoTabLabel(sel({ tab: 'filter' }))).toBeNull();
  });

  it('the 調節 lead chip shows 「質感：{label}」 only with a look, and opens 一鍵 › 質感', () => {
    expect(leadChip(sel({ tab: 'adjust' }), null)).toBeNull();
    expect(leadChip(sel({ tab: 'filter' }), { id: 'film', amount: 0.8 })).toBeNull();
    const chip = leadChip(sel({ tab: 'adjust' }), { id: 'cinema', amount: 0.8 })!;
    expect(chip.label).toBe('質感：電影感');
    expect(chip.target).toMatchObject({ tab: 'preset', presetPart: 'look' });
  });

  it('LUT failure copy', () => {
    expect(lookFailedNotice('ccd')).toBe('無法載入「CCD」質感，請稍後再試');
  });
});

describe('step-1 panel functions dispatch to 調節 and 質感', () => {
  const editOf = (photo: Partial<PhotoParams> = {}): EditState => ({
    v: 2,
    photo: { ...defaultPhoto(), ...photo },
    persons: { p0: naturalPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });
  const lensOf = (e: EditState) => lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0');
  const actCtx = (failed: boolean) => ({ lookFailed: () => failed });

  it('itemsFor / sliderFor / tabHasValue route the new tab and part', () => {
    const l = lensOf(editOf({ values: { ...defaultPhoto().values, 'adjust.grain': 0.4 } }));
    expect(itemsFor(l, sel({ tab: 'adjust' })).map((i) => i.key)).toEqual(['reset', ...ADJUST_KEYS]);
    expect(sliderFor(l, sel({ tab: 'adjust', adjust: 'adjust.grain' }))).toMatchObject({ label: '顆粒', value: 0.4 });
    expect(tabHasValue(l, 'adjust')).toBe(true);
    expect(tabHasValue(l, 'preset')).toBe(false);
    const withLook = lensOf(editOf({ look: { id: 'film', amount: 0.8 } }));
    expect(tabHasValue(withLook, 'preset')).toBe(true);
    expect(itemsFor(withLook, sel({ tab: 'preset', presetPart: 'look' })).find((i) => i.selected)!.label).toBe('膠片');
    expect(itemsFor(withLook, sel({ tab: 'preset', presetPart: 'beauty' })).map((i) => i.label)).toContain('自然');
    expect(sliderFor(withLook, sel({ tab: 'preset', presetPart: 'look' }))).toMatchObject({ key: 'look.film', label: '程度', value: 0.8 });
  });

  it('activate: look picks, the failed-look retry and 無', () => {
    const s = sel({ tab: 'preset', presetPart: 'look' });
    const tap = (e: EditState, label: string, failed = false) => {
      const item = itemsFor(lensOf(e), s).find((i) => i.label === label)!;
      return activate(item, lensOf(e), s, actCtx(failed));
    };
    const e0 = editOf();
    const r1 = tap(e0, '膠片');
    expect(r1.changed).toBe(true);
    expect(r1.edit.photo.look).toEqual({ id: 'film', amount: 0.8 });
    const e1 = lensOf(r1.edit).setLook('film', 0.6);
    expect(tap(e1, 'CCD').edit.photo.look).toEqual({ id: 'ccd', amount: 0.6 });
    expect(tap(e1, '膠片').changed).toBe(false);
    const retry = tap(e1, '膠片', true);
    expect(retry.changed).toBe(false);
    expect(retry.retryLook).toBe('film');
    expect(tap(e1, '無').edit.photo.look).toBeNull();
    expect(tap(e0, '無').changed).toBe(false);
  });

  it('activate: ⊘ in 調節 resets the 12 values and keeps the look; a no-op when neutral; tapping an item selects it', () => {
    const s = sel({ tab: 'adjust' });
    const dirty = editOf({ values: { ...defaultPhoto().values, 'adjust.fade': 0.5 }, look: { id: 'blue', amount: 0.7 } });
    const items = itemsFor(lensOf(dirty), s);
    const r = activate(items[0], lensOf(dirty), s, actCtx(false));
    expect(r.changed).toBe(true);
    expect(r.edit.photo.values['adjust.fade']).toBe(0);
    expect(r.edit.photo.look).toEqual({ id: 'blue', amount: 0.7 });
    expect(activate(items[0], lensOf(r.edit), s, actCtx(false)).changed).toBe(false);
    const grain = items.find((i) => i.key === 'adjust.grain')!;
    const r2 = activate(grain, lensOf(dirty), s, actCtx(false));
    expect(r2.sel.adjust).toBe('adjust.grain');
  });

  it('≥ 2 persons: 調節 and 一鍵 › 質感 dim the chips, show no person note, and say 「調節／質感套用於整張照片」 once each', () => {
    const persons = [
      { id: 'f0', face: true, body: false },
      { id: 'b0', face: false, body: true },
    ];
    const two = (e: EditState) => lensFor(e, { kind: 'person', id: 'b0' }, persons, 'f0');
    const adj = sel({ tab: 'adjust', adjust: 'adjust.grain' });
    const look = sel({ tab: 'preset', presetPart: 'look' });
    const l = two(editOf());
    expect(photoScoped(adj, l)).toBe(true);
    expect(photoScoped(look, l)).toBe(true);
    expect(photoScoped(sel({ tab: 'preset' }), l)).toBe(false);
    expect(personNote('adjust', l)).toBeNull();
    // 美顏 keeps step 1's note for a body-only person; BeautyPanel skips it on 一鍵 › 質感 (Task 13)
    expect(personNote('preset', l)).not.toBeNull();
    const seen = new Set<string>();
    const grain = sliderFor(l, adj)!;
    expect(grain).toMatchObject({ key: 'b0:adjust.grain', label: '顆粒 · 整張照片', aria: '顆粒，整張照片' });
    expect(photoTouchToast(grain, l, seen)).toBe('調節套用於整張照片');
    expect(photoTouchToast(sliderFor(l, sel({ tab: 'adjust', adjust: 'adjust.fade' }))!, l, seen)).toBeNull();
    const film = itemsFor(l, look).find((i) => i.label === '膠片')!;
    const r = activate(film, l, look, actCtx(false));
    expect(tapToast(film, l, r, seen)).toBe('質感套用於整張照片');
    const l2 = two(r.edit);
    const amount = sliderFor(l2, look)!;
    expect(amount).toMatchObject({ key: 'b0:look.film', aria: '程度，整張照片' });
    expect(photoTouchToast(amount, l2, seen)).toBeNull();
    // 全部 with different presets: 「各人不同」 under 美顏 only, never under 質感
    const mixed: EditState = { ...editOf(), persons: { f0: naturalPerson(), f1: { ...naturalPerson(), preset: 'custom' } } };
    const all = lensFor(mixed, { kind: 'all' }, [{ id: 'f0', face: true, body: false }, { id: 'f1', face: true, body: false }], 'f0');
    expect(sliderEmptyText(all, sel({ tab: 'preset' }))).toBe('各人不同');
    expect(sliderEmptyText(all, look)).toBeNull();
  });
});
```

In `src/ui/panelModel.test.ts`, port the tab-order assertion (lines 215-216 at `9eec432`) mechanically: `['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝']` → `['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節']` (the test title `sits after 美型: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝` gains `· 調節`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/panelModel.adjust.test.ts`
Expected: FAIL — `adjustItems` (and the other new names) are not exported.

- [ ] **Step 3: Types and the new section**

In `src/ui/panelModel.ts` (CRLF — Edit tool):
1. Imports: add `neutralValue` to the `../engine/params` import; add `import { lookDef, LOOKS, lookThumbUrl } from '../engine/looks';`, `adjustIsNeutral` to the existing `import { personOf } from '../edit/state';` and the types `AdjustId`, `LookId`, `PhotoParams` to the `../types` type import.
2. `export type TabId = 'preset' | 'skin' | 'shape' | 'body' | 'filter' | 'makeup' | 'adjust';`
3. Append `{ id: 'adjust', label: '調節' },` to `TABS` (after `{ id: 'makeup', label: '美妝' },`).
4. After `MAKEUP_PARTS`:

```ts
/** 一鍵's parts (step-2 spec §2.2): the beauty presets (person-level) and the 質感 looks (photo-level) */
export type PresetPart = 'beauty' | 'look';
export const PRESET_PARTS: readonly { id: PresetPart; label: string; icon: string }[] = [
  { id: 'beauty', label: '美顏', icon: 'presetGlow' },
  { id: 'look', label: '質感', icon: 'look' },
];
```

5. `PanelSelection` gains `adjust: AdjustId;` and `presetPart: PresetPart;`; `INITIAL_SELECTION` gains `adjust: 'adjust.brightness',` and `presetPart: 'beauty',`.
6. `ItemVisual`: change `| { kind: 'thumb'; src: string }` to `| { kind: 'thumb'; src: string; /** icon under the image (shown when it fails to load); default 'filter' */ fallback?: string }`.
7. `ItemAction` gains `| { type: 'look'; id: LookId | null }` (with the comment `/** 一鍵 › 質感: pick a look, or 無 (null) */`).
8. `PanelItem` gains `/** a strip divider is drawn before this item (調節: light │ colour │ effects) */ divider?: 'before';`.
9. `ActivateResult` gains `/** the tapped look is selected but its LUT failed: the screen retries the load (no edit, no undo step) */ retryLook?: LookId;`.
10. `SliderBinding` gains `/** 色溫 / 色調: a coloured track (CSS .track-temperature / .track-tint) */ track?: 'temperature' | 'tint';` and `/** no recommended-default dot (調節: neutral is the default) */ hideDefault?: boolean;`.
11. Add after `bodyItems(...)` (before `shownPreset` / `itemsFor`):

```ts
// ───────────── 調節 and 質感 (v0.4 step 2) ─────────────

/** the 調節 strip splits light │ colour │ effects: dividers before 色溫 and 褪色 (step-2 spec §2.1) */
const ADJUST_DIVIDERS: ReadonlySet<string> = new Set(['adjust.temperature', 'adjust.fade']);

/** ⊘ 原圖 · 亮度 … 暗角; `value` reads the user's stored value (lens.get(id).value) */
export function adjustItems(value: (id: AdjustId) => number, sel: PanelSelection): PanelItem[] {
  return [
    RESET_ITEM(),
    ...paramsInGroup('adjust').map(
      (d): PanelItem => ({
        key: d.id,
        label: d.label,
        visual: { kind: 'icon', icon: d.icon },
        selected: sel.adjust === d.id,
        hasValue: hasValue(d, value(d.id as AdjustId)),
        action: { type: 'param', id: d.id },
        ...(ADJUST_DIVIDERS.has(d.id) ? { divider: 'before' as const } : {}),
        ...ENABLED,
      }),
    ),
  ];
}

/** 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感: exactly one selected (無 while no look), thumbnails over the look icon */
export function lookItems(look: PhotoParams['look']): PanelItem[] {
  return [
    { ...RESET_ITEM('無'), key: 'look.none', selected: look === null, action: { type: 'look', id: null } },
    ...LOOKS.map(
      (l): PanelItem => ({
        key: `look.${l.id}`,
        label: l.label,
        visual: { kind: 'thumb', src: lookThumbUrl(l.id), fallback: 'look' },
        selected: look?.id === l.id,
        hasValue: false,
        action: { type: 'look', id: l.id },
        ...ENABLED,
      }),
    ),
  ];
}

/** 調節 slider: −50…+50 or 0–100, double tap → neutral, no default dot, coloured tracks for 色溫 / 色調 */
export function adjustSlider(value: (id: AdjustId) => number, sel: PanelSelection): SliderBinding {
  const id = sel.adjust;
  const d = paramDef(id);
  return {
    key: id,
    param: id,
    label: d.label,
    bidirectional: d.bidirectional,
    value: value(id),
    mixed: false,
    defaultValue: neutralValue(d),
    hideDefault: true,
    ...(id === 'adjust.temperature' ? { track: 'temperature' as const } : id === 'adjust.tint' ? { track: 'tint' as const } : {}),
    apply: (lens, v) => lens.set(id, v),
  };
}

/** 質感 程度 (0–100, default dot at the look's defaultAmount); keyed by look so a hop resets the drag; none while 無 */
export function lookSlider(look: PhotoParams['look']): SliderBinding | null {
  if (!look) return null;
  const id = look.id;
  return {
    key: `look.${id}`,
    param: null,
    label: '程度',
    bidirectional: false,
    value: look.amount,
    mixed: false,
    defaultValue: lookDef(id)?.defaultAmount ?? 0.8,
    apply: (lens, v) => lens.setLook(id, v),
  };
}

export type LookActivation = { kind: 'none' } | { kind: 'retry'; id: LookId } | { kind: 'set'; id: LookId | null; amount: number };

/**
 * A tap in 一鍵 › 質感 (step-2 spec §2.2): from 無 a look starts at its default 程度; hopping keeps the 程度; the
 * selected look is a no-op unless its LUT failed (then the tap only retries the load); 無 clears.
 */
export function lookActivation(target: LookId | null, look: PhotoParams['look'], failed: (id: LookId) => boolean): LookActivation {
  if (target === null) return look === null ? { kind: 'none' } : { kind: 'set', id: null, amount: look.amount };
  if (look?.id === target) return failed(target) ? { kind: 'retry', id: target } : { kind: 'none' };
  return { kind: 'set', id: target, amount: look ? look.amount : (lookDef(target)?.defaultAmount ?? 0.8) };
}

/** 調節 tab dot: any of the 12 user values is not neutral */
export function adjustTabHasValue(value: (id: AdjustId) => number): boolean {
  return paramsInGroup('adjust').some((d) => hasValue(d, value(d.id as AdjustId)));
}

export interface PartButton {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  hasValue: boolean;
}

/** The part row that leads the strip: 美妝's 口紅／腮紅 and 一鍵's 美顏／質感 (step-2 spec §2.2); null on other tabs. */
export function partButtons(sel: PanelSelection, state: { makeupOn(part: MakeupPart): boolean; look: PhotoParams['look'] }): PartButton[] | null {
  if (sel.tab === 'makeup')
    return MAKEUP_PARTS.map((p) => ({ id: p.id, label: p.label, icon: p.id, active: sel.makeupPart === p.id, hasValue: state.makeupOn(p.id) }));
  if (sel.tab === 'preset')
    return PRESET_PARTS.map((p) => ({ id: p.id, label: p.label, icon: p.icon, active: sel.presetPart === p.id, hasValue: p.id === 'look' && state.look !== null }));
  return null;
}

export function selectPart(sel: PanelSelection, id: string): PanelSelection {
  if (sel.tab === 'makeup') return { ...sel, makeupPart: id as MakeupPart };
  if (sel.tab === 'preset') return { ...sel, presetPart: id as PresetPart };
  return sel;
}

/** 調節's lead chip 「質感：{label}」 while a look is set; tapping it opens 一鍵 › 質感 (step-2 spec §2.1) */
export function leadChip(sel: PanelSelection, look: PhotoParams['look']): { label: string; target: PanelSelection } | null {
  if (sel.tab !== 'adjust' || !look) return null;
  const def = lookDef(look.id);
  return def ? { label: `質感：${def.label}`, target: { ...sel, tab: 'preset', presetPart: 'look' } } : null;
}

/**
 * Tabs whose every item acts on the whole photo (調節, 一鍵 › 質感; step-2 spec §2.1–2.2): the person strip dims with
 * 「整張照片」 (photoScoped), the face boxes hide (Editor), no per-person strip note (BeautyPanel). null → step 1's rules.
 */
export function photoTabLabel(sel: PanelSelection): '調節' | '質感' | null {
  if (sel.tab === 'adjust') return '調節';
  if (sel.tab === 'preset' && sel.presetPart === 'look') return '質感';
  return null;
}

/** shown once per look per session when its LUT cannot load (hooks.ts requestLut) */
export function lookFailedNotice(id: string): string {
  return `無法載入「${lookDef(id)?.label ?? id}」質感，請稍後再試`;
}
```

- [ ] **Step 4: Dispatch from step 1's panel functions**

Still in `src/ui/panelModel.ts`:
1. Add before `activate`:

```ts
/** what activate needs to know beyond the edit (step 2): whether a look's LUT failed (a re-tap then retries it) */
export interface ActivateContext {
  lookFailed?: (id: LookId) => boolean;
}
```

   and give `activate` a fourth parameter: `export function activate(item: PanelItem, lens: Lens, sel: PanelSelection, ctx: ActivateContext = {}): ActivateResult {` (existing three-argument calls keep working).
2. `itemsFor`: as the first statement of `case 'preset': {` add `if (sel.presetPart === 'look') return lookItems(lens.look());`, and add the case `case 'adjust': return adjustItems((id) => lens.get(id).value, sel);`.
3. `sliderFor`: as the first statement of `case 'preset': {` add
   ```ts
      if (sel.presetPart === 'look') {
        const b = lookSlider(lens.look());
        return b && decorate(b, lens, true);
      }
   ```
   and add `case 'adjust': return decorate(adjustSlider((id) => lens.get(id).value, sel), lens, true);` (see item 6).
4. `tabHasValue`: `case 'preset': return false;` becomes `case 'preset': return lens.look() !== null;`; add `case 'adjust': return adjustTabHasValue((id) => lens.get(id).value);`.
5. `activate` (`edit` is step 1's `const edit = lens.edit;`):
   - add a case:

```ts
    case 'look': {
      const r = lookActivation(a.id, lens.look(), (id) => ctx.lookFailed?.(id) ?? false);
      if (r.kind === 'retry') return { ...done(edit), retryLook: r.id };
      if (r.kind === 'none') return done(edit);
      return done(lens.setLook(r.id, r.amount));
    }
```

   - first line of `case 'reset':` — `if (sel.tab === 'adjust') return adjustIsNeutral(edit.photo) ? done(edit) : done(lens.resetGroup('adjust'));`
   - first line of `case 'param':` — `if (sel.tab === 'adjust') return done(edit, sel.adjust === a.id ? sel : { ...sel, adjust: a.id as AdjustId });`

`itemsFor`, `sliderFor` and `tabHasValue` are the only `switch` statements over `TabId` (at `9eec432`); with items 2–4 `tsc` reports none. The non-switch per-tab rules are item 7.

6. Slider identity: step 1's `sliderFor` makes keys selection-aware itself, through its local `decorate(b, lens, photo)` (≥ 2 persons: key `${selKey}:…`, label `… · 整張照片`, aria `…，整張照片`; one person: the binding unchanged). Item 3 routes both new bindings through it as photo-level (`photo = true`, step-2 spec §2.1–2.2), so with ≥ 2 persons `sliderFor` returns `b0:adjust.grain` / `b0:look.film` and the aria `程度，整張照片` (the new multi-person test); with one person the dispatch test's `'look.film'` stands. `adjustSlider` / `lookSlider` themselves keep the bare keys their own tests check.
7. Step 1's photo-level helpers learn the two photo-level tabs (S §2.1 "Persons", §2.2 "Persons", C §2.2):
   - `photoScoped(sel, lens)`: first statement `if (photoTabLabel(sel) !== null) return true;` (the chips dim with 「整張照片」 and the face boxes dim, as on 濾鏡).
   - `personNote(tab, lens)`: add `tab === 'adjust'` to its early return (`… || tab === 'body' || tab === 'filter' || tab === 'adjust'`); 一鍵 › 質感 is handled in BeautyPanel (Task 13), since `personNote` gets only the tab.
   - `photoTouchToast(b, lens, seen)`: as its first statements
     ```ts
       // 調節 and 質感: one first touch per tab, not per item (step-2 spec §2.1–2.2)
       if (b.param?.startsWith('adjust.')) return firstPhotoTouch(lens, seen, 'adjust', '調節');
       if (b.param === null && /(^|:)look\./.test(b.key)) return firstPhotoTouch(lens, seen, 'look', '質感');
     ```
   - `TILE_ITEMS`: add `look: '質感'` (a look tile that changes the photo is the 質感 first touch; its seen key is the action type `'look'`, the same as the 程度 slider's).
   - `sliderEmptyText(lens, sel)`: `sel.tab === 'preset' && …` → `sel.tab === 'preset' && sel.presetPart !== 'look' && …` (no 「各人不同」 under 質感 while it is 無).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/panelModel.adjust.test.ts src/ui/panelModel.test.ts && npm run typecheck`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 6: Full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/ui/panelModel.ts src/ui/panelModel.adjust.test.ts src/ui/panelModel.test.ts
git add -u src
git commit -m "v0.4 step 2: panel model for the 調節 tab and 一鍵 › 美顏／質感" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Panel UI — icons, part row, dividers, lead chip, slider tints

**Files:**
- Modify: `src/ui/icons.tsx:236-243` (13 icons after `custom`) — CRLF
- Modify: `src/ui/components/BeautyPanel.tsx` (imports `:3-24`, props `:26-49`, signature `:54`, `stripKey` `:56`, `pNote` `:73`, `tapItem` `:80-90`, part row `:113-140`, items `:141-167`, `ItemVisual`/`Thumb` `:232-256`) — CRLF
- Modify: `src/ui/components/Slider.tsx:184-186` — CRLF
- Modify: `src/ui/theme.css` (`.tabs` comment `:420-426`; after `.slider-track` `:727-736`) — CRLF
- Test: `src/ui/icons.adjust.test.ts` (create)

**Interfaces:**
- Consumes: Task 12 (`partButtons`, `selectPart`, `leadChip`, `photoTabLabel`, `PRESET_PARTS`, `ActivateResult.retryLook`, `PanelItem.divider`, `ItemVisual.fallback`, `SliderBinding.track/hideDefault`), Task 3 (`Lens.look()`); step 1's `BeautyPanel` props (`lens`, `onEdit`, `photoTouched`, …) and `partHasValue(lens, part)`.
- Produces:
  - `BeautyPanel` props `lookFailed?: (id: LookId) => boolean` and `onRetryLook?(id: LookId): void`
  - icon keys `brightness`, `exposure`, `contrast`, `highlights`, `shadows`, `temperature`, `tint`, `saturation`, `vibrance`, `fade`, `grain`, `vignette`, `look`
  - `BeautyPanel` prop `onRetryLook?(id: LookId): void`; the part row for 一鍵; dividers; the 調節 lead chip (`button.lead-chip`); `look` thumbnails falling back to the `look` icon; a haptic on look picks
  - `SliderRow` renders `.slider-track.track-temperature` / `.track-tint` and omits `.slider-def` when `hideDefault`
  - CSS classes `.track-temperature`, `.track-tint`, `.lead-chip`

- [ ] **Step 1: Write the failing test**

Create `src/ui/icons.adjust.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { paramsInGroup } from '../engine/params';
import { hasIcon } from './icons';
import { PRESET_PARTS } from './panelModel';

describe('調節 and 質感 visuals (step-2 spec §2.5, §7)', () => {
  it('every 調節 item, both 一鍵 parts and the look thumbnail fallback have an icon', () => {
    for (const d of paramsInGroup('adjust')) expect(hasIcon(d.icon), d.icon).toBe(true);
    for (const p of PRESET_PARTS) expect(hasIcon(p.icon), p.icon).toBe(true);
    expect(hasIcon('look')).toBe(true);
  });

  it('調節 and 一鍵 are never dimmed by the face note (基本模式, no face)', async () => {
    // BeautyPanel imports the app store: stub the browser globals first, as flows.test.ts does
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { createElement: () => ({ className: '', addEventListener: vi.fn() }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { FACE_TABS } = await import('./components/BeautyPanel');
    expect(FACE_TABS).not.toContain('adjust');
    expect(FACE_TABS).not.toContain('preset');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/icons.adjust.test.ts`
Expected: FAIL — `hasIcon('brightness')` is false.

- [ ] **Step 3: Icons**

In `src/ui/icons.tsx`, insert after the `custom: (…),` entry and before `// ── chrome ──` (original line drawings on the 24 × 24 grid; the `Icon` component supplies stroke 1.75, round caps):

```tsx
  // ── 調節 (v0.4 step 2) ──
  brightness: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" />
      <path d="M12 7.8v8.4" />
    </>
  ),
  exposure: (
    <>
      <rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3" />
      <path d="M4.6 19.4 19.4 4.6M7 8.6h4M9 6.6v4M13.2 15.6h4" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16M12 7h3.8M12 10h7.2M12 13h7.2M12 16h4.2" />
    </>
  ),
  highlights: <path d="M5 17h14M8 17a4 4 0 0 1 8 0M12 6.5v2.2M6.3 9.3l1.5 1.5M17.7 9.3l-1.5 1.5" />,
  shadows: <path d="M5 7h14M8 7a4 4 0 0 0 8 0M12 17.5v-2.2M6.3 14.7l1.5-1.5M17.7 14.7l-1.5-1.5" />,
  temperature: (
    <>
      <path d="M10 14.2V5.5a2 2 0 0 1 4 0v8.7a4 4 0 1 1-4 0Z" />
      <path d="M12 9v7" />
    </>
  ),
  tint: (
    <>
      <circle cx="12" cy="12" r="7.8" />
      <path d="M6.5 17.5 17.5 6.5" />
      <circle cx="9" cy="9" r="1.2" />
      <circle cx="15" cy="15" r="1.2" />
    </>
  ),
  saturation: (
    <>
      <circle cx="12" cy="8.8" r="4.6" />
      <circle cx="8.8" cy="14.6" r="4.6" />
      <circle cx="15.2" cy="14.6" r="4.6" />
    </>
  ),
  vibrance: (
    <>
      <circle cx="10.5" cy="13.5" r="6" />
      <path d="M18 3.6c.4 2 1.1 2.7 3 3-1.9.3-2.6 1-3 3-.4-2-1.1-2.7-3-3 1.9-.3 2.6-1 3-3Z" />
    </>
  ),
  fade: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 8h8M8 12h5.5M8 16h3" />
    </>
  ),
  grain: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" />
      <path d="M8 8h.01M12 8h.01M16 8h.01M10 12h.01M14 12h.01M8 16h.01M12 16h.01M16 16h.01" />
    </>
  ),
  vignette: (
    <>
      <rect x="3.6" y="5" width="16.8" height="14" rx="3" />
      <ellipse cx="12" cy="12" rx="5.4" ry="4" />
    </>
  ),
  // 一鍵 › 質感 part button and the look thumbnail fallback
  look: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M4 9.5h2M4 14.5h2M18 9.5h2M18 14.5h2" />
      <path d="M12 9.2c.3 1.5.8 2 2.3 2.3-1.5.3-2 .8-2.3 2.3-.3-1.5-.8-2-2.3-2.3 1.5-.3 2-.8 2.3-2.3Z" />
    </>
  ),
```

- [ ] **Step 4: BeautyPanel**

In `src/ui/components/BeautyPanel.tsx` (CRLF — Edit tool):
1. Header comment line 1: `tab row 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝` → `tab row 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節`.
2. Imports: add `import { Fragment } from 'preact';`; add `leadChip`, `partButtons`, `photoTabLabel`, `selectPart` to the `../panelModel` import and remove `MAKEUP_PARTS` from it (nothing else uses it once item 7 lands; `partHasValue` stays); add `LookId` to the `../../types` type import (`import type { EditState, LookId } from '../../types';`).
3. `Props`: after `photoTouched?: Set<string>;` add

```ts
  /** the 質感 LUT of this look failed to load (a re-tap of the selected look then retries it) */
  lookFailed?: (id: LookId) => boolean;
  /** the tapped look is selected but its LUT failed to load: retry it (step-2 spec §2.2; no edit, no undo step) */
  onRetryLook?(id: LookId): void;
```

   and destructure `lookFailed` and `onRetryLook` in the component signature (line 54, next to `photoTouched`).
4. `stripKey` (line 56):

```ts
  const stripKey =
    sel.tab === 'makeup' ? `makeup.${sel.makeupPart}` : sel.tab === 'preset' ? `preset.${sel.presetPart}` : sel.tab;
```

5. After `const items = itemsFor(lens, sel, body);` add (the makeup dot is step 1's `partHasValue(lens, part)`: the selected person's, or under 全部 any face person's):

```ts
  const look = lens.look();
  const parts = partButtons(sel, { makeupOn: (p) => partHasValue(lens, p), look });
  const lead = leadChip(sel, look);
```

   and change `const pNote = personNote(sel.tab, lens);` (line 73) to `const pNote = photoTabLabel(sel) ? null : personNote(sel.tab, lens);` (調節 and 一鍵 › 質感 show no per-person strip note, S §2.2).

6. `tapItem`: `const r = activate(item, lens, sel);` becomes `const r = activate(item, lens, sel, { lookFailed });`; after the toast line (`if (text) toast(text, …);`, before `if (!r.changed) return;`) add `if (r.retryLook) onRetryLook?.(r.retryLook);`; extend the haptic line to `if (a === 'preset' || a === 'reset' || a === 'protect' || a === 'look') haptic();`.
7. Replace the `{sel.tab === 'makeup' && ( <> {MAKEUP_PARTS.map(…)} <span class="strip-divider" /> </> )}` block (lines 113-140) with:

```tsx
          {parts && (
            <>
              {parts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class={`item part${p.active ? ' selected' : ''}${p.hasValue ? ' has-value' : ''}`}
                  aria-pressed={p.active}
                  onClick={() => {
                    if (p.active) return;
                    haptic();
                    onSel(selectPart(sel, p.id));
                  }}
                >
                  <span class="item-tile">
                    <Icon name={p.icon} />
                  </span>
                  <span class="item-label">{p.label}</span>
                  <span class="item-dot" />
                </button>
              ))}
              <span class="strip-divider" />
            </>
          )}
          {lead && (
            <button
              type="button"
              class="lead-chip"
              onClick={() => {
                haptic();
                onSel(lead.target);
              }}
            >
              {lead.label}
            </button>
          )}
```

8. Items map (lines 141-167): wrap each option in a keyed fragment so a divider can precede it — change `{items.map((item) => (` + `<button key={`${stripKey}:${item.key}`}` to:

```tsx
          {items.map((item) => (
            <Fragment key={`${stripKey}:${item.key}`}>
              {item.divider === 'before' && <span class="strip-divider" aria-hidden="true" />}
              <button
```

   remove the `key=` attribute from that `<button`, and close the fragment after the button's `</button>` with `</Fragment>`.
9. `ItemVisual`: `if (v.kind === 'thumb') return <Thumb src={v.src} fallback={v.fallback ?? 'filter'} />;`. `Thumb`:

```tsx
/** Thumbnail over an icon (the filter icon, or the look icon), so a missing PNG degrades to the icon instead of a hole. */
function Thumb({ src, fallback }: { src: string; fallback: string }) {
  return (
    <>
      <Icon name={fallback} />
```

   (the `<img …/>` part is unchanged).

- [ ] **Step 5: Slider tint and default dot**

In `src/ui/components/Slider.tsx` replace lines 184-186:

```tsx
        <div class={`slider-track${binding.track ? ` track-${binding.track}` : ''}`} ref={trackRef}>
          <div class="slider-fill" style={fill} />
          {bi ? <div class="slider-tick" /> : binding.hideDefault ? null : <div class="slider-def" style={{ left: `${binding.defaultValue * 100}%` }} />}
```

- [ ] **Step 6: Styles**

In `src/ui/theme.css`:
1. The `.tabs` comment (line 423) `/* six two-character tabs: ≥ 60 px each at 375 pt */` → `/* up to 8 tabs (v0.4 roadmap §2.1): (375 − 12)/8 = 45.4 pt each, still ≥ 44 pt — never a 9th */`.
2. After the `.slider-track { … }` rule add:

```css
/* 色溫 / 色調 (調節): the track shows which way the colour moves; the accent fill still marks the value */
.slider-track.track-temperature {
  background: linear-gradient(90deg, #4f8dff, rgba(255, 255, 255, 0.22) 50%, #ffae42);
}
.slider-track.track-tint {
  background: linear-gradient(90deg, #3ecf6e, rgba(255, 255, 255, 0.22) 50%, #e04fd8);
}
```

3. After the `.strip-note { … }` rule add:

```css
/* 調節: 「質感：膠片」 leads the strip while a look is set (tap → 一鍵 › 質感) */
.lead-chip {
  flex: none;
  align-self: center;
  height: 32px;
  margin: 0 4px 0 0;
  padding: 0 12px;
  border-radius: 16px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
```

- [ ] **Step 7: Run tests, typecheck, build**

Run: `npx vitest run src/ui/icons.adjust.test.ts src/ui/panelModel.test.ts && npm run typecheck && npm run build`
Expected: PASS; `tsc` exits 0; `vite build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/ui/icons.tsx src/ui/components/BeautyPanel.tsx src/ui/components/Slider.tsx src/ui/theme.css src/ui/icons.adjust.test.ts
git commit -m "v0.4 step 2: 調節 icons, 一鍵 part row, strip dividers, 質感 lead chip, slider tints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Screens — LUT loading hooks, failure notices, camera picture frame, photo-level scope

**Files:**
- Modify: `src/ui/screens/hooks.ts:5-17` (`useFilterLoader` → `useLutLoader` + `requestLut` + `noteAdjustFailure` + `useAdjustFailureNotice`) — LF
- Modify: `src/ui/screens/Editor.tsx` (imports `:80-97`; `useFilterLoader` call `:771`; the `PERSON_TABS` gates `:1018`, `:1060`; `<BeautyPanel>` `:1160-1168`) — LF
- Modify: `src/ui/screens/Camera.tsx` (imports `:22`, `:28`; `useFilterLoader` call `:106`; `startLiveLoop` deps `:132-140`; `<BeautyPanel>` `:455-464`) — CRLF
- Test: `src/ui/screens/hooks.test.ts` (create)

**Interfaces:**
- Consumes: Task 2 (`photoLuts`), Task 5 (`adjustWanted`), Task 8 (`Engine.loadLut`, `Engine.lutState`, `Engine.adjustUnavailable`), Task 11 (`LiveDeps.getFrame`, `normalizedCropRect`), Task 12 (`lookFailedNotice`, `photoTabLabel`; the photo-level chip dimming and first-touch toasts already live in step 1's panelModel helpers), Task 13 (`BeautyPanel` props `lookFailed`, `onRetryLook`); `RATIO_VALUE`, `app` (`src/ui/state.ts:14`); step 1's editor `edit` state, camera look store (`look`, `Camera.tsx:40`) and `PERSON_TABS` (`src/ui/editorModel.ts:535`).
- Produces (exports of `src/ui/screens/hooks.ts`):
  - `requestLut(engine: Engine, kind: LutKind, id: string): void`
  - `useLutLoader(engine: Engine | null, photo: Pick<PhotoParams, 'filterId' | 'look'>): void` (replaces `useFilterLoader`)
  - `noteAdjustFailure(engine: Pick<Engine, 'adjustUnavailable'>): boolean`
  - `useAdjustFailureNotice(engine: Engine | null, photo: Pick<PhotoParams, 'values' | 'look'>): void`

- [ ] **Step 0: Find the step-1 hooks to extend**

Run: `grep -n "useFilterLoader\|<BeautyPanel\|photoScoped\|photoTouchToast\|PERSON_TABS.has" src/ui/screens/Editor.tsx src/ui/screens/Camera.tsx; grep -n "startLiveLoop({" -A9 src/ui/screens/Camera.tsx`
Expected: the two `useFilterLoader` calls; the `<BeautyPanel` elements with step 1's `lens` / `onEdit` props; in the editor `const scope = multi && photoScoped(sel, lens);` (chips and boxes dim), `photoTouchToast(b, …)` in `slide` and the two `PERSON_TABS.has(sel.tab)` gates (photo taps, face boxes); the live-loop deps object.

- [ ] **Step 1: Write the failing test**

Create `src/ui/screens/hooks.test.ts`:

```ts
// LUT and 調節 failure notices (step-2 spec §2.4, §7): once per look / once per session.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../state', () => ({ toast: vi.fn() }));
vi.mock('../debug', () => ({ reportError: vi.fn(() => 'reported') }));

import type { Engine } from '../../types';
import { toast } from '../state';
import { noteAdjustFailure, requestLut } from './hooks';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('failure notices', () => {
  it('a failed 質感 LUT is announced once per look per session; a failed 濾鏡 only logged', async () => {
    const engine = { loadLut: vi.fn(() => Promise.reject(new Error('offline'))) } as unknown as Engine;
    requestLut(engine, 'look', 'ccd');
    requestLut(engine, 'look', 'ccd');
    requestLut(engine, 'look', 'film');
    requestLut(engine, 'filter', 'warm');
    await flush();
    expect(vi.mocked(toast).mock.calls.map((c) => c[0])).toEqual(['無法載入「CCD」質感，請稍後再試', '無法載入「膠片」質感，請稍後再試']);
    expect(engine.loadLut).toHaveBeenCalledTimes(4);
  });

  it('「調節效果暫時無法使用」 once per session, only when the engine reports the 調節 program unavailable', () => {
    vi.mocked(toast).mockClear();
    expect(noteAdjustFailure({ adjustUnavailable: false })).toBe(false);
    expect(noteAdjustFailure({ adjustUnavailable: true })).toBe(true);
    expect(noteAdjustFailure({ adjustUnavailable: true })).toBe(false);
    expect(vi.mocked(toast).mock.calls).toEqual([['調節效果暫時無法使用', 3200]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/hooks.test.ts`
Expected: FAIL — `requestLut` / `noteAdjustFailure` are not exported.

- [ ] **Step 3: hooks.ts**

Replace `useFilterLoader` (lines 5-17) in `src/ui/screens/hooks.ts` and widen the imports:

```ts
import { useEffect, useRef, useState } from 'preact/hooks';
import { adjustWanted } from '../../engine/adjustMath';
import { photoLuts } from '../../engine/looks';
import type { Engine, LutKind, PhotoParams } from '../../types';
import { reportError } from '../debug';
import { lookFailedNotice } from '../panelModel';
import { toast } from '../state';

/** looks whose load failure was already announced in this page session (step-2 spec §2.4: once per look) */
const lookFailNoted = new Set<string>();
let adjustFailNoted = false;

/**
 * Ask the engine for a LUT now (it lazy-loads; asking early makes the swap instant). An explicit call also retries a
 * failed one (the re-tap of a selected look). A 質感 that cannot load is announced once per look per session.
 */
export function requestLut(engine: Engine, kind: LutKind, id: string): void {
  let p: Promise<void>;
  try {
    p = engine.loadLut(kind, id);
  } catch (e) {
    p = Promise.reject(e);
  }
  p.catch((e: unknown) => {
    reportError(e, `loadLut(${kind}, ${id})`);
    if (kind === 'look' && !lookFailNoted.has(id)) {
      lookFailNoted.add(id);
      toast(lookFailedNotice(id), 3200);
    }
  });
}

/** The photo's 濾鏡 and 質感 LUTs, requested whenever they change (replaces useFilterLoader). */
export function useLutLoader(engine: Engine | null, photo: Pick<PhotoParams, 'filterId' | 'look'>): void {
  const filterId = photo.filterId;
  const lookId = photo.look?.id ?? null;
  useEffect(() => {
    if (!engine) return;
    for (const r of photoLuts({ filterId, look: lookId === null ? null : { id: lookId } })) requestLut(engine, r.kind, r.id);
  }, [engine, filterId, lookId]);
}

/** 「調節效果暫時無法使用」 once per page session, when the engine could not build the 調節 program (step-2 spec §7). */
export function noteAdjustFailure(engine: Pick<Engine, 'adjustUnavailable'>): boolean {
  if (adjustFailNoted || !engine.adjustUnavailable) return false;
  adjustFailNoted = true;
  toast('調節效果暫時無法使用', 3200);
  return true;
}

/** Checks after the frame that asked for 調節 or 質感 has been drawn (sessions draw on the next animation frame). */
export function useAdjustFailureNotice(engine: Engine | null, photo: Pick<PhotoParams, 'values' | 'look'>): void {
  const wanted = adjustWanted(photo.values, photo.look);
  useEffect(() => {
    if (!engine || !wanted || adjustFailNoted) return;
    const t = window.setTimeout(() => noteAdjustFailure(engine), 250);
    return () => clearTimeout(t);
  });
}
```

(The `useHold` hook below stays unchanged.)

- [ ] **Step 4: Editor**

In `src/ui/screens/Editor.tsx`:
1. Import line 97: `import { useFilterLoader, useHold } from './hooks';` → `import { requestLut, useAdjustFailureNotice, useHold, useLutLoader } from './hooks';`; add `photoTabLabel` to the `../panelModel` import (lines 80-92).
2. Replace `useFilterLoader(bundle?.engine ?? null, edit.photo.filterId);` (line 771; `edit` = step 1's `EditState` state variable) with:

```tsx
  useLutLoader(bundle?.engine ?? null, edit.photo);
  useAdjustFailureNotice(bundle?.engine ?? null, edit.photo);
```

3. `<BeautyPanel …>` (lines 1160-1168): add the props `lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}` and `onRetryLook={(id) => bundle && requestLut(bundle.engine, 'look', id)}`.
4. Photo-level scope (S §2.1–2.2, C §2.2, S1 A11). Step 1 keeps these rules in panelModel, and Task 12 / 13 already taught them the two tabs: the person chips and the face boxes dim through `const scope = multi && photoScoped(sel, lens);` (line 1047); the per-person strip note is skipped in BeautyPanel; the slider label / aria use step 1's photo form 「{label} · 整張照片」 / 「{label}，整張照片」 through `decorate`; the 「整張」 tile badge is not drawn on the 12 調節 tiles or the looks (C §2.1 marks none in 調節; `adjustItems` / `lookItems` do not call `badged`). What is left here: the face boxes hide and photo taps stop on both photo-level tabs, as on 濾鏡 (not in `PERSON_TABS`). 調節 is already outside `PERSON_TABS`; 一鍵 › 質感 is not (the 一鍵 tab is person-level for 美顏). Add next to the `tapsOn` line (line 1018):

```tsx
  /** 調節 and 一鍵 › 質感 act on the whole photo, like 濾鏡: no face boxes, no photo taps (step-2 spec §2.1–2.2) */
  const personTab = PERSON_TABS.has(sel.tab) && photoTabLabel(sel) === null;
```

   and use `personTab` in place of `PERSON_TABS.has(sel.tab)` in the `tapsOn` condition (line 1018) and the `boxItems` condition (line 1060). (Declare `personTab` before both uses; `sel` is in scope there.)
5. First-touch toast: nothing to add in the Editor. Its `slide()` already calls step 1's `photoTouchToast(b, lens, touchedPhoto.current)` for every slider step and commit, and `BeautyPanel` calls `tapToast(item, lens, r, photoTouched)` for every tile tap; Task 12 made those say 「調節套用於整張照片」 once for the 12 items (seen key `'adjust'`) and 「質感套用於整張照片」 once for a look pick or its 程度 (seen key `'look'`), with ≥ 2 persons, once per editor session (the `touchedPhoto` set).

- [ ] **Step 5: Camera**

In `src/ui/screens/Camera.tsx` (CRLF — Edit tool):
1. Imports: `import { useFilterLoader, useHold } from './hooks';` (line 28) → `import { requestLut, useAdjustFailureNotice, useHold, useLutLoader } from './hooks';`; add `normalizedCropRect` to the `../imaging` import (line 22); `RATIO_VALUE` and `app` are already imported from `../state` (line 26).
2. Replace `useFilterLoader(bundle?.engine ?? null, look.photo.filterId);` (line 106; `look` = step 1's `CameraLook` from the store, line 40) with:

```tsx
  useLutLoader(bundle?.engine ?? null, look.photo);
  useAdjustFailureNotice(bundle?.engine ?? null, look.photo);
```

3. In the `deps.startLiveLoop({ … })` call (lines 132-140, after `getPrefs`) add:

```tsx
        // the picture the shutter keeps (captureFrom crops to the same ratio): vignette and grain follow it
        getFrame: () => normalizedCropRect(ctrl.video.videoWidth, ctrl.video.videoHeight, RATIO_VALUE[app.get().ratio]),
```

4. `<BeautyPanel …>` (lines 455-464): add the props `lookFailed={(id) => bundle?.engine.lutState('look', id) === 'failed'}` and `onRetryLook={(id) => bundle && requestLut(bundle.engine, 'look', id)}`.

- [ ] **Step 6: Run the tests, typecheck and build**

Run: `npx vitest run src/ui/screens/hooks.test.ts && npm run typecheck && npm test && npm run build`
Expected: PASS; `tsc` exits 0; `vite build` succeeds. `grep -rn "useFilterLoader" src` prints nothing.

- [ ] **Step 7: Existing screen e2e still green**

Run: `npx playwright test tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts`
Expected: PASS (一鍵 opens on 美顏, so 原圖／自然 are found as before; the camera's tab loop is unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/hooks.ts src/ui/screens/hooks.test.ts src/ui/screens/Editor.tsx src/ui/screens/Camera.tsx
git commit -m "v0.4 step 2: screens load 濾鏡 + 質感 LUTs, failure notices, camera picture frame, photo-level 調節／質感" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: End-to-end — 調節 and 質感 in the editor and the camera

**Files:**
- Create: `tests/e2e/adjust.spec.ts`

**Interfaces:**
- Consumes: everything above through the built app (`npm run build` + `vite preview`), the fake front camera (`tests/fixtures/face.y4m`), `tests/e2e/fixtures.ts` helpers (`debugState`, `decodeDataUrl`, `dragSlider`, `grab`, `mad`, `meanLuma`, `SAMPLE_FACE`, `settled`, `shot`, `test`, `Pixels`); step 1's camera look key `meiyan.look.v1` holding `{photo, person}` JSON.
- Produces: `tests/e2e/adjust.spec.ts` with two tests (editor, camera).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/adjust.spec.ts`:

```ts
// 調節 and 質感 end to end (v0.4 step-2 spec §8.3): every 調節 item moves the right statistic in the editor; ⊘, ↶ and
// the dots; the colour tracks and the lead chip; 一鍵 › 質感 in the strip, in the export and after a reopen; the camera's
// 調節 tab, 暗角, CCD, moving grain, the hand-over to 編輯 and the persisted camera look.
import type { Locator, Page } from '@playwright/test';
import { debugState, decodeDataUrl, dragSlider, expect, grab, mad, meanLuma, SAMPLE_FACE, settled, shot, test, type Pixels } from './fixtures';

const luma = (p: Pixels, i: number) => 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
function sortedLumas(p: Pixels): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.data.length; i += 4) out.push(luma(p, i));
  return out.sort((a, b) => a - b);
}
function channelMeans(p: Pixels): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    r += p.data[i];
    g += p.data[i + 1];
    b += p.data[i + 2];
  }
  const n = p.data.length / 4;
  return [r / n, g / n, b / n];
}
const stats = {
  luma: (p: Pixels) => meanLuma(p),
  /** 90th − 10th percentile luma */
  spread(p: Pixels) {
    const l = sortedLumas(p);
    return l[Math.floor(l.length * 0.9)] - l[Math.floor(l.length * 0.1)];
  },
  /** 2nd percentile luma: the black level */
  black: (p: Pixels) => sortedLumas(p)[Math.floor((p.data.length / 4) * 0.02)],
  rb(p: Pixels) {
    const [r, , b] = channelMeans(p);
    return r / b;
  },
  gOverRb(p: Pixels) {
    const [r, g, b] = channelMeans(p);
    return g / (r + b);
  },
  /** mean max − min channel */
  chroma(p: Pixels) {
    let s = 0;
    for (let i = 0; i < p.data.length; i += 4) s += Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) - Math.min(p.data[i], p.data[i + 1], p.data[i + 2]);
    return s / (p.data.length / 4);
  },
  /** the two top corner patches (8 % of the width) over the centre patch; the bottom holds the editor's float buttons */
  vignette(p: Pixels) {
    const s = Math.round(p.width * 0.08);
    const at = (x: number, y: number) => meanLuma(p, { x, y, w: s, h: s });
    return (at(0, 0) + at(p.width - s, 0)) / 2 / Math.max(1, at(Math.round((p.width - s) / 2), Math.round((p.height - s) / 2)));
  },
  /** mean |L(x+1, y) − L(x, y)|: high-frequency energy */
  hf(p: Pixels) {
    let s = 0;
    let n = 0;
    for (let y = 0; y < p.height; y += 2)
      for (let x = 0; x < p.width - 1; x++) {
        const i = (y * p.width + x) * 4;
        s += Math.abs(luma(p, i + 4) - luma(p, i));
        n++;
      }
    return s / n;
  },
};
/** mean luma, before and after, of the pixels that were the brightest (q > 0) or darkest (q < 0) |q| of `before` */
function tail(before: Pixels, after: Pixels, q: number): { before: number; after: number } {
  const idx = Array.from({ length: before.data.length / 4 }, (_, k) => k).sort((a, b) => luma(before, a * 4) - luma(before, b * 4));
  const n = Math.max(1, Math.floor(idx.length * Math.abs(q)));
  const pick = q > 0 ? idx.slice(idx.length - n) : idx.slice(0, n);
  let a = 0;
  let b = 0;
  for (const k of pick) {
    a += luma(before, k * 4);
    b += luma(after, k * 4);
  }
  return { before: a / n, after: b / n };
}

async function importPhoto(page: Page): Promise<Locator> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  return page.locator('.editor-stage .frame');
}

/** 儲存 → the long-press fallback image (Chromium has no file share sheet), decoded */
async function exportPixels(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dlg = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  const img = dlg.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await dlg.getByRole('button', { name: '關閉' }).click();
  return decodeDataUrl(url);
}

const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

test('editor: every 調節 item, ⊘ / ↶ / dots, 質感 in the strip and the export, everything back after a reopen', async ({ page }) => {
  test.setTimeout(300_000);
  const frame = await importPhoto(page);
  const undo = page.getByRole('button', { name: '復原' });
  const slider = page.getByRole('slider');

  await tab(page, '調節').click();
  await expect(tab(page, '調節')).toHaveAttribute('aria-selected', 'true');
  for (const label of ['原圖', '亮度', '曝光', '對比', '高光', '陰影', '色溫', '色調', '飽和', '鮮艷度', '褪色', '顆粒', '暗角'])
    await expect(option(page, label)).toBeVisible();
  const e0 = await settled(frame);

  // [label, one-way?, check(before, after)]
  const cases: [string, boolean, (a: Pixels, b: Pixels) => void][] = [
    ['亮度', false, (a, b) => expect(stats.luma(b)).toBeGreaterThan(stats.luma(a) + 5)],
    ['曝光', false, (a, b) => expect(stats.luma(b)).toBeGreaterThan(stats.luma(a) + 5)],
    ['對比', false, (a, b) => expect(stats.spread(b)).toBeGreaterThan(stats.spread(a) + 3)],
    ['高光', false, (a, b) => {
      const t = tail(a, b, 0.1);
      expect(t.after).toBeGreaterThan(t.before + 2);
    }],
    ['陰影', false, (a, b) => {
      const t = tail(a, b, -0.5);
      expect(t.after).toBeGreaterThan(t.before + 2);
    }],
    ['色溫', false, (a, b) => expect(stats.rb(b)).toBeGreaterThan(stats.rb(a) * 1.03)],
    ['色調', false, (a, b) => expect(stats.gOverRb(b)).toBeLessThan(stats.gOverRb(a) * 0.98)],
    ['飽和', false, (a, b) => expect(stats.chroma(b)).toBeGreaterThan(stats.chroma(a) * 1.15)],
    ['鮮艷度', false, (a, b) => expect(stats.chroma(b)).toBeGreaterThan(stats.chroma(a) * 1.05)],
    ['褪色', true, (a, b) => expect(stats.black(b)).toBeGreaterThan(stats.black(a) + 10)],
    ['顆粒', true, (a, b) => expect(stats.hf(b)).toBeGreaterThan(stats.hf(a) * 1.2)],
    ['暗角', true, (a, b) => expect(stats.vignette(b)).toBeLessThan(stats.vignette(a) * 0.85)],
  ];
  for (const [label, oneWay, check] of cases) {
    await option(page, label).click();
    await expect(slider).toHaveAttribute('aria-label', label);
    await dragSlider(page, oneWay ? 400 : 300);
    await expect(slider).toHaveAttribute('aria-valuenow', oneWay ? '100' : '50');
    if (label === '色溫') await expect(page.locator('.slider-track.track-temperature')).toBeVisible();
    if (label === '褪色') await expect(page.locator('.slider-def')).toHaveCount(0);
    const e1 = await settled(frame);
    check(e0, e1);
    await undo.click();
    expect(mad(e0, await settled(frame)), `${label} undone`).toBeLessThan(0.5);
  }

  // dots, ⊘ resets all twelve in one step, ↶ brings them back
  await option(page, '亮度').click();
  await dragSlider(page, 300);
  await option(page, '暗角').click();
  await dragSlider(page, 400);
  const styled = await settled(frame);
  await expect(option(page, '亮度')).toHaveClass(/\bhas-value\b/);
  await expect(option(page, '暗角')).toHaveClass(/\bhas-value\b/);
  await expect(tab(page, '調節').locator('.tab-dot')).toHaveCount(1);
  await shot(page, '60-editor-adjust');
  await option(page, '原圖').click();
  await expect(page.locator('.strip .item.has-value')).toHaveCount(0);
  await expect(tab(page, '調節').locator('.tab-dot')).toHaveCount(0);
  expect(mad(e0, await settled(frame))).toBeLessThan(0.5);
  await undo.click();
  expect(mad(styled, await settled(frame))).toBeLessThan(0.5);
  await undo.click();
  await undo.click();
  await settled(frame);

  // 一鍵 › 質感
  await tab(page, '一鍵').click();
  await expect(option(page, '自然')).toBeVisible(); // 美顏 is the default part
  await page.getByRole('button', { name: '質感', exact: true }).click();
  for (const label of ['無', '膠片', 'CCD', '直閃', '藍調', '電影感']) await expect(option(page, label)).toBeVisible();
  await expect(option(page, '無')).toHaveAttribute('aria-selected', 'true');
  await expect(slider).toHaveCount(0);
  const plain = await exportPixels(page);
  await option(page, '膠片').click();
  await expect(slider).toHaveAttribute('aria-label', '程度');
  await expect(slider).toHaveAttribute('aria-valuenow', '80');
  await expect(tab(page, '一鍵').locator('.tab-dot')).toHaveCount(1);
  const filmFrame = await settled(frame);
  expect(mad(e0, filmFrame)).toBeGreaterThan(2);
  await shot(page, '61-editor-look-film');
  const filmExport = await exportPixels(page);
  expect(mad(plain, filmExport)).toBeGreaterThan(2);
  await option(page, '無').click();
  await expect(slider).toHaveCount(0);
  expect(mad(e0, await settled(frame))).toBeLessThan(0.5);

  // the look again (程度 from 無 → 80), 程度 → 70, 曝光 +50, then the 調節 lead chip
  await option(page, '膠片').click();
  await slider.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '70');
  await tab(page, '調節').click();
  await expect(page.locator('.lead-chip')).toHaveText('質感：膠片');
  await option(page, '曝光').click();
  await dragSlider(page, 300);
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await page.locator('.lead-chip').click();
  await expect(tab(page, '一鍵')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '質感', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await settled(frame);

  // close (autosave flush) and reopen from 最近編輯: the look, its 程度 and the 調節 values are back
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await tab(page, '一鍵').click();
  if ((await page.getByRole('button', { name: '質感', exact: true }).getAttribute('aria-pressed')) !== 'true')
    await page.getByRole('button', { name: '質感', exact: true }).click();
  await expect(option(page, '膠片')).toHaveAttribute('aria-selected', 'true');
  await expect(slider).toHaveAttribute('aria-valuenow', '70');
  await tab(page, '調節').click();
  await option(page, '曝光').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  expect(mad(before, await settled(frame))).toBeLessThan(0.5);
});

test('camera: 調節 tab, 暗角, CCD, moving grain; shot → 編輯 keeps them; the camera look persists', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0 && d.screen === 'camera';
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const frame = page.locator('.cam-stage .frame');
  const slider = page.getByRole('slider');
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);

  await tab(page, '調節').click();
  await expect(tab(page, '調節')).toHaveAttribute('aria-selected', 'true');
  await option(page, '暗角').click();
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(800);
  const vig = await grab(frame, '62-camera-vignette');
  console.log(`camera: jitter ${jitter.toFixed(2)}, vignette ratio ${stats.vignette(a1).toFixed(3)} → ${stats.vignette(vig).toFixed(3)}`);
  expect(stats.vignette(vig)).toBeLessThan(stats.vignette(a1) * 0.85);

  await tab(page, '一鍵').click();
  await page.getByRole('button', { name: '質感', exact: true }).click();
  await option(page, 'CCD').click();
  await page.waitForTimeout(800);
  const ccd = await grab(frame, '63-camera-ccd');
  expect(mad(vig, ccd)).toBeGreaterThan(Math.max(2, 4 * jitter));

  // grain moves in the preview: frame-to-frame difference well above the camera's own jitter
  await tab(page, '調節').click();
  await option(page, '顆粒').click();
  await dragSlider(page, 400);
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await page.waitForTimeout(500);
  const g1 = await grab(frame);
  await page.waitForTimeout(300);
  const g2 = await grab(frame);
  expect(mad(g1, g2)).toBeGreaterThan(Math.max(1.5, 3 * jitter));

  // shutter → review → 編輯: the editor opens with the same look and values
  await page.waitForTimeout(400); // the persisted look is debounced 300 ms
  await page.getByRole('button', { name: '拍照' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await page.getByRole('button', { name: /編輯/ }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 30_000 });
  await tab(page, '調節').click();
  await option(page, '暗角').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await option(page, '顆粒').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await tab(page, '一鍵').click();
  if ((await page.getByRole('button', { name: '質感', exact: true }).getAttribute('aria-pressed')) !== 'true')
    await page.getByRole('button', { name: '質感', exact: true }).click();
  await expect(option(page, 'CCD')).toHaveAttribute('aria-selected', 'true');

  // after a reload the camera look (meiyan.look.v1) still holds 調節 and 質感
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meiyan.look.v1') ?? 'null'));
  expect(stored?.photo?.values?.['adjust.vignette']).toBe(1);
  expect(stored?.photo?.values?.['adjust.grain']).toBe(1);
  expect(stored?.photo?.look?.id).toBe('ccd');
});
```

- [ ] **Step 2: Build and run it**

Run: `npm run build && npx playwright test tests/e2e/adjust.spec.ts`
Expected: both tests PASS. (Before Tasks 12–14 existed they would fail at `tab(page, '調節')`; this task adds no product code, so a failure here is a defect in an earlier task: fix it there, in its own files, and rerun that task's tests.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/adjust.spec.ts
git commit -m "v0.4 step 2: e2e for 調節 and 質感 in the editor and the camera" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Bench row 「調節效能」 and its smoke test

**Files:**
- Create: `src/bench/adjustBench.ts`, `src/bench/adjustBench.test.ts`
- Modify: `src/bench/main.ts` (STYLE `:139-140`; gate `:173-187`; a `runAdjust()` in the flow section after `bodyTest()` `:506-509`) — CRLF
- Modify: `tests/e2e/bench.spec.ts` (new test)

**Interfaces:**
- Consumes: Task 4 (`lowbias32`, `seedMix`), Task 5 (`ADJUST_IDS`, `ADJUST_ONE_WAY`), Task 6 (`GRAIN_HASH_GLSL`), Task 8 (`createEngine`, `loadLut`), Task 2 (`LOOK_IDS`); step 1's `defaultPhoto()` and `RenderInput`; bench helpers `el`, `button`, `busy`, `showError`, `errText` (`src/bench/main.ts:103, 148-162, 740-748`).
- Produces:
  - `interface AdjustBenchRow { config: string; medianMs: number; adjust: boolean }`
  - `interface AdjustBenchResult { size: string; rows: AdjustBenchRow[]; compileMs: number; hash: { checked: number; mismatches: number } }`
  - `runAdjustBench(): Promise<AdjustBenchResult>`; `probeGrainHash(): { checked: number; mismatches: number }`; `formatAdjustBench(r: AdjustBenchResult): string`
  - a gate button 「調節效能」 writing into `#adjust-bench` (class `adjust-note`; `data-state` = `running` | `done` | `failed`)

- [ ] **Step 1: Write the failing tests**

Create `src/bench/adjustBench.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatAdjustBench } from './adjustBench';

describe('調節 bench row text (step-2 spec §6.4)', () => {
  it('lists each configuration with its median, the compile time and the grain-hash probe', () => {
    const text = formatAdjustBench({
      size: '1080×1920',
      rows: [
        { config: 'neutral', medianMs: 1.234, adjust: false },
        { config: '調節 ×12', medianMs: 2.5, adjust: true },
        { config: '質感 film', medianMs: 2.25, adjust: true },
      ],
      compileMs: 12.34,
      hash: { checked: 4096, mismatches: 0 },
    });
    expect(text).toContain('調節效能 1080×1920');
    expect(text).toMatch(/neutral\s+1\.23 ms\n/);
    expect(text).toMatch(/調節 ×12\s+2\.50 ms 調節\n/);
    expect(text).toContain('編譯 12.3 ms');
    expect(text).toContain('顆粒雜湊 4096/4096 一致');
  });
});
```

Append to `tests/e2e/bench.spec.ts`:

```ts
test('bench.html: 調節效能 — base vs 調節 program, compile time, grain hash bit-exact on the GPU', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/bench.html');
  await page.getByRole('button', { name: '調節效能', exact: true }).click();
  const out = page.locator('#adjust-bench');
  await expect(out).toHaveAttribute('data-state', 'done', { timeout: 150_000 });
  const text = (await out.textContent()) ?? '';
  console.log(text);
  expect(text).toContain('顆粒雜湊 4096/4096 一致');
  expect(text).toMatch(/neutral\s+[\d.]+ ms\n/);
  expect(text).toMatch(/調節 ×12\s+[\d.]+ ms 調節/);
  for (const id of ['film', 'ccd', 'flash', 'blue', 'cinema']) expect(text).toMatch(new RegExp(`質感 ${id}\\s+[\\d.]+ ms 調節`));
  await shot(page, '41-bench-adjust');
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `npx vitest run src/bench/adjustBench.test.ts`
Expected: FAIL — `Failed to resolve import "./adjustBench"`.

- [ ] **Step 3: The bench module**

Create `src/bench/adjustBench.ts`:

```ts
// 調節 cost row (v0.4 step-2 spec §6.4): median GPU-complete render time at 1080 × 1920 (the largest live frame) for
// (a) neutral — the base composite program, (b) all 12 調節 items at ±40, (c) each 質感 look at 0.8; the cold
// compile + link of the 調節 program; and a bit-exact probe of the grain hash (GPU lowbias32 vs adjustMath.ts).
// Decisions (spec §6.4): (b) − (a) ≤ 1.5 ms ships as is; > 3 ms → ADJUST_FAST in the camera; compile > 50 ms → pre-warm.
import { ADJUST_IDS, ADJUST_ONE_WAY, lowbias32, seedMix } from '../engine/adjustMath';
import { createEngine } from '../engine/index';
import { LOOK_IDS } from '../engine/looks';
import { GRAIN_HASH_GLSL } from '../engine/shaders/adjust';
import { defaultPhoto } from '../edit/state';
import type { PhotoParams, RenderInput } from '../types';

export interface AdjustBenchRow {
  config: string;
  medianMs: number;
  /** the frame drew with the 調節 program */
  adjust: boolean;
}
export interface AdjustBenchResult {
  size: string;
  rows: AdjustBenchRow[];
  compileMs: number;
  hash: { checked: number; mismatches: number };
}

const RUNS = 30;
const W = 1080;
const H = 1920;

/** every skin stage off, no 濾鏡, neutral 調節 */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  return { ...p, filterId: 'none', look: null, values: { ...p.values, 'skin.whiten': 0, 'skin.sharpen': 0, 'filter.amount': 0 } };
}

/** all 12 items at ±40 display units (one-way items at 40) */
function all12(base: PhotoParams): PhotoParams {
  const values = { ...base.values };
  ADJUST_IDS.forEach((id, i) => {
    values[id] = ADJUST_ONE_WAY.has(id) ? 0.4 : i % 2 === 0 ? 0.9 : 0.1;
  });
  return { ...base, values };
}

async function syntheticFrame(): Promise<ImageBitmap> {
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      img.data[i] = (x * 255) / W;
      img.data[i + 1] = (y * 255) / H;
      img.data[i + 2] = 64 + ((x + y) * 127) / (W + H);
      img.data[i + 3] = 255;
    }
  return createImageBitmap(img);
}

export async function runAdjustBench(): Promise<AdjustBenchResult> {
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  const bmp = await syntheticFrame();
  try {
    await engine.ready;
    await Promise.all(LOOK_IDS.map((id) => engine.loadLut('look', id)));
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    const input = (photo: PhotoParams): RenderInput => ({ source: bmp, width: W, height: H, faces: [], globalSkin: null, photo });
    /** one render, waited on until the GPU is done (renderMs alone is CPU issue time) */
    const once = (photo: PhotoParams) => {
      const t0 = performance.now();
      const s = engine.render(input(photo), { still: true });
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { ms: performance.now() - t0, adjust: s.passes.includes('adjust') };
    };
    const median = (config: string, photo: PhotoParams): AdjustBenchRow => {
      const t: number[] = [];
      let adjust = false;
      for (let i = 0; i < RUNS; i++) {
        const r = once(photo);
        t.push(r.ms);
        adjust = r.adjust;
      }
      t.sort((a, b) => a - b);
      return { config, medianMs: t[RUNS >> 1], adjust };
    };
    const base = neutralPhoto();
    once(base); // warm the base program and the upload path
    const rows: AdjustBenchRow[] = [median('neutral', base)];
    const cold = once(all12(base)).ms; // the first 調節 frame compiles and links the program
    const all = median('調節 ×12', all12(base));
    rows.push(all);
    for (const id of LOOK_IDS) rows.push(median(`質感 ${id}`, { ...base, look: { id, amount: 0.8 } }));
    return { size: `${W}×${H}`, rows, compileMs: Math.max(0, cold - all.medianMs), hash: probeGrainHash() };
  } finally {
    bmp.close();
    engine.dispose();
  }
}

const PROBE_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
/**
 * Like the composite, the probe declares no default int precision (only `precision highp float`), so it runs the
 * hash exactly as the 調節 program does: a GPU that honours mediump would fail it unless every integer is highp.
 */
const PROBE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform highp uint uMix;
out vec4 outColor;
${GRAIN_HASH_GLSL}
void main() {
  highp ivec2 p = ivec2(gl_FragCoord.xy) - 32;
  highp uint h = lowbias32(uint(p.x) ^ lowbias32(uint(p.y) ^ uMix)) >> 8u;
  outColor = vec4(float(h & 255u), float((h >> 8u) & 255u), float(h >> 16u), 255.0) / 255.0;
}`;

/** The GPU's lowbias32 lattice hash for indices −32…31 (negative ones included) against the CPU port, bit for bit. */
export function probeGrainHash(): { checked: number; mismatches: number } {
  const N = 64;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  try {
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`grain probe: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, PROBE_VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, PROBE_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`grain probe: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    const mix = seedMix(12345);
    gl.uniform1ui(gl.getUniformLocation(prog, 'uMix'), mix);
    gl.viewport(0, 0, N, N);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(N * N * 4);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, out);
    let mismatches = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const h = lowbias32(((x - 32) >>> 0) ^ lowbias32(((y - 32) >>> 0) ^ mix)) >>> 8;
        const i = (y * N + x) * 4;
        if (out[i] !== (h & 255) || out[i + 1] !== ((h >>> 8) & 255) || out[i + 2] !== h >>> 16) mismatches++;
      }
    return { checked: N * N, mismatches };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function formatAdjustBench(r: AdjustBenchResult): string {
  const lines = r.rows.map((row) => `${row.config.padEnd(10)} ${row.medianMs.toFixed(2)} ms${row.adjust ? ' 調節' : ''}`);
  lines.push(`編譯 ${r.compileMs.toFixed(1)} ms`);
  lines.push(`顆粒雜湊 ${r.hash.checked - r.hash.mismatches}/${r.hash.checked} 一致`);
  return `調節效能 ${r.size}（中位數，含 GPU 完成）\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: The gate button**

In `src/bench/main.ts` (CRLF — Edit tool):
1. Add `import { formatAdjustBench, runAdjustBench } from './adjustBench';` with the other imports.
2. After `const gateBodyBtn = button('美體偵測', () => bodyTest());` add:

```ts
const gateAdjustBtn = button('調節效能', () => void runAdjust());
// own class, not .note: tests/harness/t8/run-bench.mjs and bench.spec.ts need '.gate .note' to be gateProgress alone
const adjustOut = el('div', { className: 'adjust-note', id: 'adjust-bench' });
```

   and in `STYLE`, after the `.multi-note { … }` line (line 140), add `.adjust-note { color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; text-align: left; }`.

3. Append to the `gate` element's children (after `gateBodyBtn`):

```ts
  el('p', { textContent: '調節效能：在 1080×1920 量測調節與質感的 GPU 時間、調節程式的編譯時間，並檢查顆粒雜湊與 CPU 版本一致（不需相機）。' }),
  gateAdjustBtn,
  adjustOut,
```

4. After the `bodyTest()` function add:

```ts
async function runAdjust(): Promise<void> {
  if (busy) return;
  busy = true;
  gateAdjustBtn.disabled = true;
  adjustOut.dataset.state = 'running';
  adjustOut.textContent = '量測中…';
  try {
    const r = await runAdjustBench();
    adjustOut.replaceChildren(el('pre', { textContent: formatAdjustBench(r) }));
    adjustOut.dataset.state = 'done';
  } catch (err) {
    showError('adjust', err);
    adjustOut.textContent = `失敗：${errText(err)}`;
    adjustOut.dataset.state = 'failed';
  } finally {
    busy = false;
    gateAdjustBtn.disabled = false;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/bench/adjustBench.test.ts && npm run typecheck && npm run build && npx playwright test tests/e2e/bench.spec.ts`
Expected: PASS — step 1's `多臉 section keeps its own classes` test included (`.gate .note` still counts 1); the console shows the row (SwiftShader timings), `顆粒雜湊 4096/4096 一致`.

- [ ] **Step 6: Commit**

```bash
git add src/bench/adjustBench.ts src/bench/adjustBench.test.ts src/bench/main.ts tests/e2e/bench.spec.ts
git commit -m "v0.4 step 2: bench row 調節效能 (base vs 調節 program, compile, bit-exact grain hash)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Step gate — the full suite and the v0.3-equivalence checks

**Files:**
- No new files. Fixes, if any, go into the file that owns the defect (named in the failing test's task).

**Interfaces:**
- Consumes: Tasks 1–16; step 1's `tests/e2e/parity.spec.ts` and `tests/fixtures/parity-v03/*.png` (C §8.3).
- Produces: a green step 2 on local `feat/meiyan-pwa` commits; version still `0.3.0`; nothing pushed.

- [ ] **Step 1: Typecheck, unit tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: `tsc` exits 0; Vitest reports every file passed (including `tests/harness/t5/assets.test.mjs`); `vite build` succeeds.

- [ ] **Step 2: The whole e2e suite**

Run: `npm run test:e2e`
Expected: every Playwright project and spec passes — step 1's specs (`parity`, `persons`, `body`, `camera-group` …), the v0.3 specs (`editor`, `camera`, `engine`, `reshape`, `faceProtect`, `home`, `settings`, `update`, `bench`) and step 2's `composite`, `adjust` and the new `bench` test.

- [ ] **Step 3: v0.3-equivalence checks (C §1.1, S §1.3)**

1. Parity goldens: `npx playwright test tests/e2e/parity.spec.ts` → PASS (max channel diff ≤ 1/255, mean < 0.02/255 — every parity case leaves 調節 neutral and has no look, so the base program draws).
2. The base composite is step 1's text: `npx vitest run src/engine/compositeCpu.test.ts -t "the base variant"` → PASS.
3. Neutral frames use the base program: the `composite.spec.ts` log line for `neutral` shows no `adjust` pass (Step 2 ran it).
4. The looks are precached (S §6.3: `**/*.png` already matches `public/luts/looks/`, no config change): after Step 1's build, `grep -o "luts/looks/look_[a-z]*\(_thumb\)\?\.png" dist/sw.js | sort -u | wc -l` prints `10`.
5. Existing assertions untouched by step 2: run

```bash
BASE=9eec432 # the step-2 base commit (the workflow's commits read "v0.4 step 2 task <N>: …")
git diff --stat "$BASE"..HEAD -- tests/e2e/parity.spec.ts tests/e2e/engine.spec.ts tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/body.spec.ts tests/e2e/reshape.spec.ts tests/e2e/faceProtect.spec.ts tests/fixtures
```

   Expected: no output (step 2 changed none of them; the unit-test ports in Tasks 1, 7 and 12 are the count/plan/tab-order changes listed there).
6. Version and push state: `node -p "require('./package.json').version"` prints `0.3.0`; `git status --short` is empty; nothing was pushed (`git log -1 --format=%H @{u} 2>/dev/null` is unchanged from before step 2, or there is no upstream).
7. Line endings: `file src/types.ts src/ui/panelModel.ts src/engine/shaders/composite.ts src/engine/pipeline.ts src/engine/index.ts src/app/live.ts src/app/live.test.ts src/app/testFakes.ts src/ui/components/BeautyPanel.tsx src/ui/components/Slider.tsx src/ui/screens/Camera.tsx src/ui/icons.tsx src/ui/theme.css scripts/gen-luts.mjs src/bench/main.ts | grep -v CRLF` prints nothing (they are all still CRLF), and `git diff --numstat "$BASE"..HEAD` shows no CRLF file with a whole-file rewrite (added ≈ deleted ≈ file length).

- [ ] **Step 4: Commit fixes, if any**

If Steps 1–3 required a fix, stage exactly the changed files (`git add -u` for edits; new files by name), run Steps 1–3 again until green, and commit with a message that names the failing check, in this form:

```bash
git add -u
git commit -m "v0.4 step 2: gate fix — composite.spec look:ccd mean 1.3 (LUT recipe re-tuned)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If nothing needed fixing, do not create an empty commit. Step 2 is done; step 3 (裁切＋匯出) starts from this state.
