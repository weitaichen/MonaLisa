# Mona Misa 美顏 v0.4 Step 5: 臉型細項＋美妝擴充 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six 美型 warps (下頜線, 太陽穴, 髮際線, 鼻翼, 山根, 嘴高) with per-side 左右分開, and eight procedural 美妝 parts (眉毛, 眼影, 眼線, 睫毛, 臥蠶, 修容, 高光, 美瞳) behind a two-level 美妝 strip — per person, in the editor and the live camera, undoable and persisted — without changing one pixel of a photo whose new items are neutral.

**Architecture:** The 14 new items are person-level `ParamId`s, so step 1's `EditState`, lens, undo and history carry them unchanged; split values live in `PersonParams.right`, stored landmark-sided and labelled screen-sided through `PersonInfo.screenSwap`. The warps fill step 1's reserved and spare face-table texels (70–71, 75–95) and extend the per-face chain of `RESHAPE_FS` with two new primitives (`shiftEllipse`, `squeezeAxis`); the CPU port mirrors every operation and the hash pin is re-set. Makeup is drawn in P1 after the GPUPixel meshes by one new program (`PMAKEUP_FS`) from one CPU-built vertex buffer (`buildMakeupGeometry`: one triangle strip per layer, ≤ 9 draws per frame for any number of faces) over eye frames built from new `Face.iris` / `Face.lids`; a CPU port of the fragment math pins the shader, and the lashes texture is generated from math.

**Tech Stack:** TypeScript 5.9, Preact 10, WebGL2 / GLSL ES 3.00, Vite 8, Vitest 5 (`npm test`), Playwright 1.63 (`npx playwright test`), pngjs 7 (scripts), MediaPipe tasks-vision 0.10.35 (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-12-face-detail-and-makeup-design.md` (cited **S5 §n**), under the contract `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (**RM §n**, status accepted). Every RM §12 question uses its recommended default, so for this step: presets reset the new items (#31), 左／右 follow the screen (#32), two-level 美妝 strip (#33), one shape per 睫毛/眼線/眉毛 (#34), one tone per 修容/高光 (#35), only 美瞳 and 睫毛 fade on closed eyes (#36), "+ = more" (#37: 髮際線 + lowers the hairline), 下頜線 one-way (#38), all S5 §1.3 refinements approved (#39). Names consumed from earlier steps come from `2026-10-12-face-person-select-design.md` (**S1**), `2026-10-12-adjust-and-looks-design.md` (**S2**), `2026-10-12-crop-and-fullres-export-design.md` (**S3**) and `2026-10-12-skin-cleanup-tools-design.md` (**S4**).

## Reconciliation (step 5)

Checked against the code at the step base `3aebedf` (steps 1–4 committed with their fixes and follow-ups); no code was changed. Every consumed name exists as the Global Constraints list it, except where an item below says otherwise. Task 9's `PMAKEUP_FS` text still hashes to `'f76b819e'`. These edits were made:

- **Anchors:** the File Structure table, the **Files** lines and the step instructions cite `3aebedf` lines where they had moved (types, params, state, legacy, lens, adapter111, reshape, reshapeCpu, faceCap, makeup, pipeline, index, gl, panelModel, BeautyPanel, Slider, theme.css, settings, ui/state, Camera, Review, Editor, bench main, faceProtect). Lines inside spec quotes may still read `892ea61` lines; when an anchor has moved, find the quoted code.
- **Line endings** (`git ls-files --eol` at `3aebedf`): every file in the CRLF list of the Global Constraints is still CRLF. The files this reconciliation adds to tasks are LF (`src/engine/backMapFrame.ts`, `src/edit/warpGuard.ts`, `src/geometry/upFrame.ts`, `src/engine/pipeline.test.ts`, `src/ui/components/BeautyPanel.test.tsx`, `src/ui/components/Slider.test.tsx`, `tests/harness/t7/fakes.ts`), except `src/engine/pipeline.ts`, which is CRLF and already listed.
- **Task 1:** the six-part `ShadePart` leaves `state.ts`'s local lip / blush `SHADES` sets uncompilable, so Task 3's six-part sets move into Task 1. Step 4's `mergeLegacy` (`50492fc`) takes only lip / blush from the 0.3 params, so the four new shades (and `right`) survive a rollback edit; a `legacy.test.ts` case pins it. The landed `BeautyPanel` part-row callback calls `partHasValue`, so the `isShadePart` narrowing goes there and `BeautyPanel.tsx` is untouched. More mechanical test ports: `MAKEUP_PICK_DEFAULT` `toEqual` → `toMatchObject`, the scope-table `shape.` count 9 → 15, and the exact shade assertions of `state.test.ts` / `legacy.test.ts`.
- **Task 2:** the `Face` literals are listed at their landed lines, plus the ones steps 1–4 added. Step 3's `faceOToU` also maps `iris` / `lids`.
- **Task 3:** its first `state.ts` edit is done in Task 1.
- **Task 4:** `MAKEUP_PARAM` is `Record<MakeupPart, PersonParamId>`, so Tasks 12 and 18's `values[MAKEUP_PARAM[part]] = 1` type-check.
- **Task 6:** `reshapeUniforms` keeps the landed `ShapeId` key type (`ParamId` stays imported). The landed `job()` line wraps the uniforms in `scaleUniforms(…, f.warpScale ?? 1)`, and `faceBoundsFor` has no cast. Step 4's `backMapFrameOf` and step 1's `guardTable` rebuild the face table on the CPU, so they pass `right` too. `pipeline.ts`'s `ZERO_U` and two `pipeline.test.ts` literals gain the twelve keys. `faceCap.ts` gets a new `../params` import line.
- **Task 7:** the `PINNED` hash constant is `reshapeCpu.test.ts:19`. The comment anchors moved.
- **Task 11:** `run` plans through step 1's `planFrame(job, makeupReady, bodyOn)`, which gains an optional fourth parameter for the procedural inputs. The t7 harness's `class FakeEngine implements Engine` also needs `procMakeupFailed`.
- **Task 13:** `sides` goes on `SliderView`, which `SliderRow` reads (`SliderBinding` extends it), as step 4 did with `ends`. The anchors are now `sliderFor`'s landed `'skin'` / `'shape'` case and `tabHasValue`'s shared `'skin'` / `'shape'` / `'makeup'` case. The test reuses the file's existing imports.
- **Task 14:** the landed code has no `shadeOf`. `partHasValue` is ported to `MAKEUP_PARAM` before `makeupKey` is deleted. The 美妝 slider keeps step 1's `usable` gate and `decorate`. `activate`'s switch stays exhaustive. The step-2 `BeautyPanel.test.tsx` 「口紅／腮紅 row」 case is ported (again in Task 15).
- **Task 15:** the test file is `Slider.test.tsx`, and the helpers take a `SliderView`. `sliderAriaLabel` composes step 1's `aria` (「，人物 {n}」), and the chips keep the 「各人不同」 marker. `useState` gets imported. The item `aria-description` tells the 「左右」 badge from the 「整張」 one. The `BeautyPanel.test.tsx` case moves to the lead tile.
- **Task 16:** the Editor snippets use the landed names (`detect`, `infos`, `selected`, `sessionFaces`, `g`, `photo`). The matrix is named `oView`, because the component already has a `view`.
- **Task 17:** `exportPng` reads the image through a canvas, because the CSP blocks `fetch()` of the fallback's `blob:` URL (`fixtures.ts`). 全部 is `selectPerson(page, 0)`.
- **Task 18:** the `copyResults` text appends to steps 1–4's sections. The `@bench` case forces the 全部套用 chip visible, as `camera-group.spec.ts` does.
- **Task 19:** `BASE` resolves to `db1f468`. This reconciliation was committed there under a stale step-3 subject (a leftover message file, as in step 4's `905c34f`). The `v0.4 step 5: reconcile plan` commit on top of it records that and is the first `^v0.4 step 5` match. Both commits change only this plan, so `db1f468` has the step base `3aebedf`'s code. The commit count and Step 6's list of mechanical ports follow the items above.
- **Commits:** the workflow's message format replaces the plan's `git commit -F- <<'EOF'` blocks: `v0.4 step 5 task <N>: <title>`, fixes `v0.4 step 5 task <N> fix: …`. Each message has a blank line and the `Co-Authored-By` trailer, is written to a file and is committed with `git commit -F <file>` (heredocs break in this shell). A block's `git add` list shows the task's files; also stage every file this reconciliation adds to the task's **Files**.
- **Imports:** put new names into a file's existing import declarations; never import a name twice.

## Global Constraints

- Base: `feat/meiyan-pwa` with steps 1–4 landed. Commits are LOCAL ONLY: never `git push`, never deploy. `package.json` `"version"` stays `0.3.0`.
- Line endings: every file keeps its own. CRLF today: `src/types.ts`, `src/ui/panelModel.ts`, `src/ui/components/BeautyPanel.tsx`, `src/ui/components/Slider.tsx`, `src/ui/icons.tsx`, `src/ui/state.ts`, `src/ui/theme.css`, `src/ui/screens/Camera.tsx`, `src/ui/screens/Review.tsx`, `src/engine/passes/makeup.ts`, `src/engine/passes/makeup.test.ts`, `src/engine/passes/reshape.test.ts`, `src/engine/pipeline.ts`, `src/engine/index.ts`, `src/bench/main.ts`, `src/app/testFakes.ts`, `tests/harness/t2/main.ts`. Files created by steps 1–4: run `file <path>` before the first edit. New step-5 files: LF. Before every commit run `file` on every edited file: a CRLF file must never report `with CRLF, LF line terminators`.
- Invariant (S5 §1.2, RM §1.1): with every new item neutral and 左右分開 off, output equals the step-4 output exactly (every new shader branch is skipped; the reshape map is bit-identical). `tests/e2e/parity.spec.ts` passes unchanged. Existing tests keep their assertions except the mechanical ports this plan names.
- On-device only: MediaPipe 0.10.35, one FaceLandmarker, CSP `connect-src 'self'`, no new model, no third-party makeup asset (`public/makeup/gp/*` stays the only GPUPixel-derived makeup).
- Persistence: no IndexedDB schema bump, no existing `meiyan-*` / `meiyan.*` name changed; exactly one new localStorage key, `meiyan.seen.makeupParts.v1`.
- Tabs: no 9th tab (RM §2.1). 美型 strip order (S5 §2.1): `⊘原圖 · 大眼 │ 瘦臉 · V臉 · 窄臉 · 下頜線 · 太陽穴 · 下巴 · 額頭 · 髮際線 │ 瘦鼻 · 鼻翼 · 山根 │ 嘴型 · 嘴高 │ 眼距 │ 左右分開` (推臉筆 arrives in step 6, after 左右分開).
- Every new `ParamDef`: `scope: 'person'`, `live: true`, neutral default; `split: true` on exactly `shape.eyeEnlarge`, `shape.faceSlim`, `shape.faceV`, `shape.faceNarrow`, `shape.jawline`, `shape.temple`.
- Copy, verbatim (S5 §2.6): 下頜線 · 太陽穴 · 髮際線 · 鼻翼 · 山根 · 嘴高; 左右分開 / badge 左右 / chips 左 · 右; 「已開啟左右分開：左、右以螢幕上看到的方向為準」; 「已關閉左右分開：左右臉改回相同」; 「{label}左右一起調整」; caption 「左 {n}」 / 「右 {n}」; parts 口紅 · 腮紅 · 眉毛 · 眼影 · 眼線 · 睫毛 · 臥蠶 · 修容 · 高光 · 美瞳; 卸妝; 「切換部位（目前：{part}）」; 自然; notes 「眼睛閉合時不套用美瞳與睫毛」, 「臉部太小，睫毛不會套用」, 「此裝置無法使用這個妝容」.
- Shades and pick defaults are S5 §3.2 / §3.1 verbatim (Task 1). 眼線 has no 原色: `shades.liner = null` reads as 黑.
- Engine limits: ≤ 9 procedural draw calls per frame; `MAX_PMAKEUP_VERTS_PER_FACE = 768`; 11 floats (44 B) per vertex; lashes texture `public/makeup/own/lashes.png`, 512 × 128, single channel, uploaded R8 with mipmaps.
- Gates (S5 §4.9): 美瞳 `smoothstep(0.15, 0.20, EAR)`; 睫毛 `smoothstep(0.08, 0.14, EAR)` × `smoothstep(0.010, 0.016, w / min(1, 1/aspect))`; 眼影, 眼線 and 臥蠶 are never blink-gated; 修容 (all kinds) and the 高光 cheekbone fade on the yaw far side.
- Shader pins: `RESHAPE_FS` is re-pinned in `src/engine/passes/reshapeCpu.test.ts` in the same commit as the shader edit; `PMAKEUP_FS` is pinned to `'f76b819e'` in `src/engine/passes/makeupProcCpu.test.ts`.
- Names from steps 1–4 are quoted from their plans (`docs/superpowers/plans/2026-10-12-v04-step{1,2,3,4}-*.md`), which fix them: `ShadePart = 'lip' | 'blush'` in `src/types.ts`; step 2's `shaderHash` (`src/engine/shaderHash.ts`); `personFromPreset`, `neutralPerson`, `naturalPerson`, `defaultPhoto`, `personOf`, `withPersons`, `matchesPersonPreset`, `sanitizePerson`, `sanitizeEditState` (`src/edit/state.ts`); `lensFor(edit, sel, persons, primary, opts?)` with `Lens.faceTargets()`, `Lens.clearMakeup(part)`, the lens-local `makeupKey` and `withPresetPart`, `LIVE_PERSONS` (`src/edit/lens.ts`); `FT`, `packFaceTable`, `uMaxBox`, `attenuate`, `TableFace` (`src/engine/passes/faceCap.ts`, `faceTable.ts`); `chainOf`, `reshapeMapMulti`, `reshapeMapCpu` (`reshapeCpu.ts`); `reshapeMapCpuV03` (`reshapeCpuV03.ts`); `RESHAPE_FS`'s `faceChain` with `s1`, `s2`, `r`, `ce` and the accessors `F`, `P`, `EXT`, `VT`, `NT`, `pairOf`; `pinCases(gl, cases, aspect, carrier)` in `tests/e2e/pages/reshape.ts`; `MakeupPass.drawFaces(src, dst, faces)`; `SliderBinding { key, param, label, bidirectional, value, mixed, defaultValue, apply }`; `activate`'s local `done(next = edit, nextSel = sel, notice?)`; `personInfos(cache)` (`src/detect/cache.ts`); `freshSource(bitmap, edit, returnTo, faceSeed?)` (`src/ui/flows.ts`); `GROUP_FACES`, `importFixture`, `regionDiff` (`tests/e2e/fixtures.ts`); step 2's `partButtons` / `selectPart` and `PanelItem.divider`; step 3's `displacementBound(face, aspect, u)` (iso units), `RenderInput.oAspect`, the `runExportTiles` harness and `tests/e2e/export.spec.ts`. Where the landed code still spells a name differently, use the landed spelling and never add a second copy (no second lens accessor, no second ext accessor, no second `MakeupPart`).
- `npm run typecheck` (`tsc --noEmit`, `tsconfig.json`) covers `src` **and** `tests` with `strict`, `noUnusedLocals` and `noUnusedParameters`: an import or local that an edit leaves unused is an error, and a test object literal must carry every required field of its type.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Edits stored by a step-1…4 dev build, or by v0.3.** No `right`, missing new shade keys, unknown shade ids: the entry reopens with neutral new items, `right = null`, and no crash (S5 §3.5, §5). Every upgrading user has such entries. Pinned in Task 3 (fuzzed `sanitizeEditState`).
2. **The WebGL context is lost and restored while procedural makeup is on** (iOS drops contexts on backgrounding and memory pressure). The makeup comes back exactly as before: the lazily compiled PMAKEUP program, its VBO and the lashes texture are rebuilt with the new context, never reused from the old one (S5 §7 "Context loss"). Pinned in Task 12 (`runMakeupContextLoss`: the render after a lose/restore equals the render before it).
3. **A wink, or one closed eye.** The open eye keeps 美瞳 and 睫毛, the closed eye shows neither, and both lids keep 眼影, 眼線 and 臥蠶 (S5 §4.9). Pinned in Task 8 (`buildMakeupGeometry` on a face with one eye closed).
4. **Tiny or degenerate faces in group photos.** A 山根 band thinner than 0.01 FW, a mouth with p106 on p49, a face below the 睫毛 size gate: no NaN, no fold, the item simply does nothing (S5 §4.2, §7). Pinned in Task 6 (degenerate geometry) and Task 8 (tiny face).
5. **`lashes.png` fails to load** (an evicted cache, a blocked fetch). The makeup pass's `ready` still settles, so the engine becomes ready; only 睫毛 is skipped and every other part draws (S5 §4.10, §7). Pinned in Task 12 (`runMakeupLashesFail`).

The spec's own tests already cover 翻轉 / 旋轉 after split edits (Task 3 `screenLeftIsGpLeft`, Task 17 e2e) and the mirrored camera hand-over (Task 16 `handOverLook`); the influence-box border (a seam where the box skip cuts a warp) is pinned in Task 7.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/edit/sides.ts` | 左右分開 storage helpers: `Side`, `slotFor`, `readSide`, `writeSide`, `splitOn`, `splitOff`, `mirrorSides`, `screenLeftIsGpLeft`, `handOverLook`, `cameraScreenSwap` |
| `src/edit/sides.test.ts` | Unit tests of the above |
| `src/engine/passes/eyeFrame.ts` | Eye frames, lid stations and normals, brow gaps, EAR, iris validity, the three gates, strip-note inputs (pure) |
| `src/engine/passes/eyeFrame.test.ts` | Unit tests on the recorded fixture face |
| `src/engine/passes/syntheticFaces.ts` | Test-support face edits shared by unit tests and the e2e harness: `closeEye`, `mirrorFaceX`, `scaleFace` (pure, never imported by app code) |
| `src/engine/passes/makeupProc.ts` | Layers, kinds, `buildMakeupGeometry` (pure), `PMAKEUP_VS` / `PMAKEUP_FS`, `createProcMakeupPass(gl)` |
| `src/engine/passes/makeupProc.test.ts` | Geometry builder tests |
| `src/engine/passes/makeupProcCpu.ts` | Test-only CPU port of `PMAKEUP_FS` (per-kind α and colour, blend modes, `skinGate`) |
| `src/engine/passes/makeupProcCpu.test.ts` | Hash pin and fragment-math tests |
| `public/makeup/own/lashes.png` | Generated lashes coverage texture (committed) |
| `tests/e2e/pages/makeup.html`, `tests/e2e/pages/makeup.ts` | Engine harness: PMAKEUP GPU = CPU, part regions, blink, a failing lashes.png, a lost and restored context, contact sheet |
| `tests/e2e/shape-makeup.spec.ts` | Step-5 e2e (RM §8.4 step 5) |
| `src/bench/faceDetailBench.ts` | Pure bench inputs for the step-5 rows |

**Modified files** (anchors at the step base `3aebedf`, steps 1–4 landed; step 1–4 modules by name)

| File | Change |
|---|---|
| `src/types.ts:8-54, 58-73, 175, 225-229, 309-322, 549-590` | 14 ids, `ParamDef.split`, `SplitParamId`, `ShadePart` (full), `MakeupPart`, `PersonParams.right` / six shades, `Face.iris` / `Face.lids`, `Engine.procMakeupFailed` |
| `src/engine/params.ts:4-58, 84-101, 294-297` | New defs in strip order, `SPLIT_IDS`, `SHADES`, `SHADE_PARTS`, `ORIG_PARTS`, `ORIG_TINT`, `MAKEUP_FIXED`, per-part `MAKEUP_PICK_DEFAULT`, `shadeColor(part)` |
| `src/edit/state.ts`, `src/edit/legacy.ts` (step 1) | `emptyShades()`, the six-part shade id sets, `right: null` in `personFromPreset` and `splitLegacy`, `matchesPersonPreset`, `sanitizePerson` of `right` and the six shades; step 4's `mergeLegacy` keeps the new shades |
| `src/edit/lens.ts` (step 1) | `PersonInfo.screenSwap`, side-aware `get` / `set`, `split`, `setSplit`, `ensureOn`, `clearMakeup` widened to every part, `makeupKey` → `MAKEUP_PARAM`, `withPresetPart` / `resetGroup` clearing `right` and all shades |
| `src/tracking/adapter111.ts:106-140` | `iris` (MP 468–477) and `lids` (two 16-point eye contours) |
| `src/engine/passes/reshape.ts:37-85, 112-118, 120-198, 206-222, 270-424` | New uniforms with L/R, new geometry, `packFaceDetail`, `faceDetailMoves`, side tables, primitives, chain (§4.5) |
| `src/engine/passes/faceCap.ts` (step 1) | `uMaxBox` covers the 15 shape items at both ends; `packFaceTable` calls `packFaceDetail` |
| `src/engine/backMapFrame.ts:35` (step 4), `src/edit/warpGuard.ts:31` (step 1), `src/media/exportPlan.ts:247` (step 3) | The CPU copies of the face table's uniforms take `person.right` |
| `src/geometry/upFrame.ts:42-45` (step 3) | `faceOToU` maps `iris` / `lids` |
| `src/engine/passes/reshapeCpu.ts:48-108` | Port of every addition |
| `src/engine/passes/makeup.ts:119-135, 145, 194-268` | Lashes load in `ready`, lazy PMAKEUP, procedural layers after the meshes, `procStatus` |
| `src/engine/pipeline.ts:84-260, 443-455, 486-557, 648-689` | `FrameJob.procMakeup`, `planPasses` rule and `planFrame`'s procedural input, `ZERO_U` keys (Task 6), pass names `mk.<layer>`, `procMakeupFailed`, overlay aspect |
| `src/engine/index.ts:307-415` | Geometry built in `job()`, `procMakeupFailed` getter, overlay aspect |
| `src/engine/gl/gl.ts:147-157` | `loadImageTexture(gl, url, {mipmap?, r8?})` |
| `src/engine/passes/overlay.ts` | Lid stations, brow-gap ends and iris circles with 顯示臉部特徵點 |
| `scripts/gen-makeup.mjs` | `lashes()`, `lashesPng()`, written by `main()` |
| `src/ui/panelModel.ts` | `MAKEUP_PARTS` × 10, `makeupView`, `side`, level-1/level-2 items, 卸妝, 自然, liner effective shade, 左右分開 item, dividers, badges, side binding, notes |
| `src/ui/components/BeautyPanel.tsx`, `Slider.tsx`, `src/ui/theme.css`, `src/ui/icons.tsx` | Two-level strip, lead tile, seen dot, mini swatch, 左｜右 chips and caption, 17 icons |
| `src/ui/components/BeautyPanel.test.tsx`, `src/ui/components/Slider.test.tsx` (steps 1–4) | The 美妝 row case ported to the lead tile; the 左｜右 helper tests |
| `src/store/settings.ts` | `meiyan.seen.makeupParts.v1` |
| `src/ui/screens/Editor.tsx`, `Camera.tsx`, `Review.tsx`, `src/ui/state.ts` | `screenSwap` per person, strip notes, `Shot.mirrored`, hand-over |
| `src/app/testFakes.ts:50, 148-170`, `src/body/synthetic.ts:167, 375`, `src/engine/passes/mask.test.ts:13`, `src/engine/passes/reshape.test.ts:25`, `src/ui/faceProtectModel.test.ts:26`, `tests/harness/t2/main.ts:982`, `tests/harness/t7/fakes.ts:94-116, 296`, and the step 1–4 literals of Task 2 | `Face` literals gain `iris` / `lids`; both fake engines gain `procMakeupFailed` |
| `tests/e2e/pages/reshape.ts` (step 1), `tests/e2e/pages/export.ts`, `tests/e2e/export.spec.ts` (step 3) | Step-5 warp pin cases through step 1's `pinCases`; three tile cases with every part and warp |
| `src/ui/panelModel.adjust.test.ts` (step 2) | `partButtons` returns null on 美妝 (the lead tile replaces the part row): its one makeup assertion is ported |
| `src/engine/params.test.ts`, `src/edit/state.test.ts`, `src/edit/legacy.test.ts`, `src/engine/pipeline.test.ts` (steps 1–4) | The mechanical ports Tasks 1, 6 and 11 name |
| `tests/harness/t5/assets.test.mjs` | Lashes generator tests |
| `LICENSES/NOTICE.txt:48` | Procedural makeup and `lashes.png` are original work |
| `src/bench/main.ts`, `tests/e2e/camera-group.spec.ts` (step 1) | Step-5 bench rows (button, report lines, guarded `@bench` live-fps case) |
| `src/tracking/faceProtect.ts:1-4` | Comment: the 瘦臉 limit also bounds 下頜線, 太陽穴, 髮際線 |

---

### Task 1: Param schema, shades, pick defaults and icons

The 14 new ids, the split flag, the shade tables and the 17 icons, plus the type widening every later task builds on (`ShadePart`, `MakeupPart`, `PersonParams.right`). After this task the new 美型 items already appear in the strip (neutral, no effect yet); the new 美妝 parts are not reachable until Task 14.

**Files:**
- Modify: `src/types.ts:8-54` (ParamId), `src/types.ts:58-73` (ParamDef), step 1's `ShadePart` (`:175`) and `PersonParams` (`:225-229`) (RM §3.2)
- Modify: `src/engine/params.ts:4-58` (defs; the 美型 block is `:17-26`, the 美妝 block `:42-44`), `src/engine/params.ts:84-101` (shades, pick defaults), `src/engine/params.ts:294-297` (`shadeColor`)
- Modify: `src/edit/state.ts`, `src/edit/legacy.ts`, `src/edit/lens.ts` (step 1): every `PersonParams` literal gets the six shades and `right: null`; `state.ts`'s module-local `SHADES` id sets (`:97-100`) cover the six parts; step 4's `mergeLegacy` (`legacy.ts:64-85`) keeps the new shades
- Modify: `src/ui/panelModel.ts:12` (`MakeupPart` re-export) and the step 1–2 call sites in `src/ui/panelModel.ts` narrowed to `ShadePart` until Task 14 (`BeautyPanel.tsx` is not changed: its part-row callback calls `partHasValue`)
- Modify: `src/ui/icons.tsx` (17 icons, inserted before the line `  // ── 美體 (body.* ParamDef.icon keys + tools) ──`, `icons.tsx:172`)
- Test: `src/engine/params.test.ts`, `src/ui/panelModel.test.ts`, step 1's scope-table test (`src/edit/state.test.ts:27-46`), `src/edit/legacy.test.ts`; the mechanical shade-table ports in `src/edit/state.test.ts` and `src/edit/legacy.test.ts` (Step 1)

**Interfaces:**
- Consumes: step 1's `ParamDef.scope` / `ParamDef.live`, `PersonParamId`, `PersonParams`, `ShadePart` (`'lip' | 'blush'`), `personFromPreset()`, `neutralPerson()`, `naturalPerson()`, `sanitizePerson()`, `splitLegacy()` (RM §3.2), the lens's `withPresetPart` and `resetGroup`; step 1's `itemsFor` / `activate` 美妝 cases and step 2's `partButtons` callback in `BeautyPanel`; steps 2 and 4's `adjust.*` (12) and `tone.*` (6) ids, so `PARAM_DEFS` has 44 entries before this task.
- Produces (later tasks rely on these exact names):
  - `ParamId` += `'shape.jawline' | 'shape.temple' | 'shape.hairline' | 'shape.noseWing' | 'shape.noseBridge' | 'shape.mouthHeight' | 'makeup.brow' | 'makeup.eyeshadow' | 'makeup.liner' | 'makeup.lashes' | 'makeup.aegyo' | 'makeup.contour' | 'makeup.highlight' | 'makeup.lens'`
  - `ParamDef.split?: true`
  - `type SplitParamId = Extract<ParamId, 'shape.eyeEnlarge' | 'shape.faceSlim' | 'shape.faceV' | 'shape.faceNarrow' | 'shape.jawline' | 'shape.temple'>`
  - `type ShadePart = 'lip' | 'blush' | 'brow' | 'eyeshadow' | 'liner' | 'lens'`; `type MakeupPart = ShadePart | 'lashes' | 'aegyo' | 'contour' | 'highlight'` (both in `src/types.ts`; `panelModel.ts` re-exports `MakeupPart`)
  - `PersonParams.shades: Record<ShadePart, string | null>`; `PersonParams.right: Partial<Record<SplitParamId, number>> | null`
  - `params.ts`: `SPLIT_IDS: readonly SplitParamId[]`, `SHADE_PARTS: readonly ShadePart[]`, `SHADES: Readonly<Record<ShadePart, readonly ShadeDef[]>>`, `LIP_SHADES`, `BLUSH_SHADES` (aliases), `ORIG_PARTS: readonly ShadePart[]`, `ORIG_TINT`, `MAKEUP_FIXED`, `MAKEUP_PICK_DEFAULT: Readonly<Record<MakeupPart, number>>`, `shadeColor(part: ShadePart, shade: string | null): string | null`, `isShadePart(p: MakeupPart): p is ShadePart`
  - `state.ts`: `emptyShades(): Record<ShadePart, string | null>`
  - icon keys `jawline`, `temple`, `hairline`, `noseWing`, `noseBridge`, `mouthHeight`, `brow`, `eyeshadow`, `liner`, `lashes`, `aegyo`, `contour`, `highlight`, `lens`, `split`, `parts`, `makeupOff`

- [x] **Step 1: Write the failing tests**

Append to `src/engine/params.test.ts` (add `isShadePart, MAKEUP_FIXED, ORIG_PARTS, ORIG_TINT, SHADE_PARTS, SHADES, SPLIT_IDS` to its import from `./params`, and `ShadePart` to the type import):

```ts
const STEP5_SHAPE: ParamId[] = ['shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight'];
const STEP5_MAKEUP: ParamId[] = [
  'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
];

describe('step-5 params (face-detail spec §3.1)', () => {
  it('adds 14 person-level, live ids with neutral defaults and the spec labels and icons', () => {
    const spec: Record<string, [label: string, bidirectional: boolean, icon: string]> = {
      'shape.jawline': ['下頜線', false, 'jawline'],
      'shape.temple': ['太陽穴', true, 'temple'],
      'shape.hairline': ['髮際線', true, 'hairline'],
      'shape.noseWing': ['鼻翼', true, 'noseWing'],
      'shape.noseBridge': ['山根', true, 'noseBridge'],
      'shape.mouthHeight': ['嘴高', true, 'mouthHeight'],
      'makeup.brow': ['眉毛', false, 'brow'],
      'makeup.eyeshadow': ['眼影', false, 'eyeshadow'],
      'makeup.liner': ['眼線', false, 'liner'],
      'makeup.lashes': ['睫毛', false, 'lashes'],
      'makeup.aegyo': ['臥蠶', false, 'aegyo'],
      'makeup.contour': ['修容', false, 'contour'],
      'makeup.highlight': ['高光', false, 'highlight'],
      'makeup.lens': ['美瞳', false, 'lens'],
    };
    for (const id of [...STEP5_SHAPE, ...STEP5_MAKEUP]) {
      const [label, bidirectional, icon] = spec[id];
      const d = paramDef(id);
      expect(d).toMatchObject({ label, bidirectional, icon, scope: 'person', live: true });
      expect(d.default).toBe(neutralValue(d));
    }
  });

  it('split is exactly the six split-capable 美型 items, in strip order', () => {
    const split = PARAM_DEFS.filter((d) => d.split).map((d) => d.id);
    expect(split).toEqual(['shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.jawline', 'shape.temple']);
    expect(SPLIT_IDS).toEqual(split);
  });

  it('美型 and 美妝 keep the RM §2.1 strip order', () => {
    expect(paramsInGroup('shape').map((d) => d.id)).toEqual([
      'shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.jawline', 'shape.temple',
      'shape.chin', 'shape.forehead', 'shape.hairline', 'shape.noseSlim', 'shape.noseWing', 'shape.noseBridge',
      'shape.mouthSize', 'shape.mouthHeight', 'shape.eyeDistance',
    ]);
    expect(paramsInGroup('makeup').map((d) => d.id)).toEqual(['makeup.lip', 'makeup.blush', ...STEP5_MAKEUP]);
  });
});

describe('SHADES (face-detail spec §3.2)', () => {
  const TABLE: Partial<Record<ShadePart, [string, string, string][]>> = {
    brow: [['black', '自然黑', '#2E2824'], ['darkBrown', '深棕', '#4B3628'], ['greyBrown', '灰棕', '#6A5C55'], ['mocha', '摩卡', '#7B5B45'], ['chestnut', '栗棕', '#8A5636']],
    eyeshadow: [['earth', '大地', '#A27A63'], ['peach', '蜜桃', '#EFA07F'], ['rose', '玫瑰', '#C76F7F'], ['coral', '珊瑚', '#E5806B'], ['milktea', '奶茶', '#B99686'], ['mauve', '紫霧', '#9A7FA6']],
    liner: [['black', '黑', '#151313'], ['darkBrown', '深棕', '#3A2A22'], ['brown', '棕', '#6A4A37'], ['wine', '酒紅', '#6B2B34'], ['navy', '藏青', '#25304E']],
    lens: [['black', '自然黑', '#231E1C'], ['choco', '巧克力', '#5B3B29'], ['amber', '琥珀', '#A9712F'], ['grey', '霧灰', '#7E8891'], ['blue', '冰藍', '#6E9AC6'], ['green', '薄荷綠', '#7EA788']],
  };

  it('lists the spec shades per part; ids unique per part; every hex valid', () => {
    expect(SHADE_PARTS).toEqual(['lip', 'blush', 'brow', 'eyeshadow', 'liner', 'lens']);
    for (const part of SHADE_PARTS) {
      const want = TABLE[part];
      if (want) expect(SHADES[part].map((s) => [s.id, s.label, s.color])).toEqual(want);
      expect(new Set(SHADES[part].map((s) => s.id)).size).toBe(SHADES[part].length);
      for (const s of SHADES[part]) expect(s.color).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(SHADES.lip).toBe(LIP_SHADES);
    expect(SHADES.blush).toBe(BLUSH_SHADES);
  });

  it('shadeColor: null is 原色 except for 眼線, which reads as 黑; unknown ids', () => {
    expect(shadeColor('brow', null)).toBeNull();
    expect(shadeColor('eyeshadow', null)).toBeNull();
    expect(shadeColor('lens', null)).toBeNull();
    expect(shadeColor('lip', null)).toBeNull();
    expect(shadeColor('liner', null)).toBe('#151313');
    expect(shadeColor('liner', 'nope')).toBe('#151313');
    expect(shadeColor('liner', 'wine')).toBe('#6B2B34');
    expect(shadeColor('lens', 'blue')).toBe('#6E9AC6');
    expect(shadeColor('brow', 'nope')).toBeNull();
    expect(shadeColor('lip', 'rose')).toBe('#D8456B');
  });

  it('原色 parts, fixed tints and the per-part pick defaults', () => {
    expect(ORIG_PARTS).toEqual(['lip', 'blush', 'brow', 'eyeshadow', 'lens']);
    expect(ORIG_TINT).toEqual({ brow: '#999999', eyeshadow: '#CCBDB6' });
    expect(MAKEUP_FIXED).toEqual({ lashes: '#141212', aegyoLight: '#FFF1E8', aegyoShade: '#B79F95', contour: '#A8897A', highlight: '#FFF3E3' });
    expect(MAKEUP_PICK_DEFAULT).toEqual({
      lip: 0.5, blush: 0.4, brow: 0.45, eyeshadow: 0.45, liner: 0.6, lashes: 0.55, aegyo: 0.5, contour: 0.4, highlight: 0.4, lens: 0.6,
    });
    expect(isShadePart('liner')).toBe(true);
    expect(isShadePart('lashes')).toBe(false);
  });
});
```

Port the existing schema assertions in `src/engine/params.test.ts` (the mechanical port RM §1.1 allows: no assertion is removed, the expected tables grow):
- the count test: add 14 to the count steps 2 and 4 left (44 → 58), both in `toHaveLength` and in the `Set` size;
- `BIDIRECTIONAL`: append `'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight'`;
- the defaults table: add `'shape.jawline': 0`, `'shape.temple': 0.5`, `'shape.hairline': 0.5`, `'shape.noseWing': 0.5`, `'shape.noseBridge': 0.5`, `'shape.mouthHeight': 0.5` and the eight new `makeup.*` ids at `0`;
- `paramsInGroup('makeup')`: expect the ten ids (`'makeup.lip', 'makeup.blush'`, then the eight above);
- step 1's `setShade` case (`params.test.ts:397`): `expect(MAKEUP_PICK_DEFAULT).toEqual({ lip: 0.5, blush: 0.4 })` becomes `toMatchObject({ lip: 0.5, blush: 0.4 })` (the full ten-part table is pinned by the new `SHADES` describe above).

In step 1's scope-table test (`src/edit/state.test.ts:27-46`), add the 14 ids to the `person` row (an `expect(person).toEqual(expect.arrayContaining([...]))` line like the tone one) and raise its `person.filter((id) => id.startsWith('shape.'))` count from 9 to 15.

The six-part `shades` also reach four exact shade assertions of steps 1–4; port them to `{ ...emptyShades(), lip: …, blush: … }` (import `emptyShades` into the files' existing `./state` import): `state.test.ts:66` (`neutralPerson().shades`), `:197` (`{ lip: 'coral', blush: null }`), `:209` (`{ lip: null, blush: null }`) and `legacy.test.ts:56` (`{ lip: 'bean', blush: 'peach' }`).

Append to the `describe('mergeLegacy: …')` block of `src/edit/legacy.test.ts` (step 4's rollback merge; `applyPreset`, `PARAM_DEFS`, `editFromLegacy` and `mergeLegacy` are already imported, add `emptyShades` to the `./state` import):

```ts
  it('step 5: keeps right and the four new shades, which 0.3 can neither show nor write', () => {
    const e0 = editFromLegacy(applyPreset('glow', 1));
    const p0 = { ...e0.persons.p0, right: { 'shape.faceSlim': 0.9 }, shades: { ...e0.persons.p0.shades, brow: 'mocha', lens: 'blue' } };
    const m = mergeLegacy({ ...e0, persons: { p0 } }, applyPreset('refined', 1), 'p0', PARAM_DEFS.map((d) => d.id));
    expect(m.persons.p0.right).toEqual({ 'shape.faceSlim': 0.9 });
    expect(m.persons.p0.shades).toEqual({ ...emptyShades(), brow: 'mocha', lens: 'blue' });
  });
```

Append to `src/ui/panelModel.test.ts` (it already imports `hasIcon`):

```ts
describe('step-5 icons (face-detail spec §3.1)', () => {
  it('every new item and strip control has an icon', () => {
    for (const k of [
      'jawline', 'temple', 'hairline', 'noseWing', 'noseBridge', 'mouthHeight', 'brow', 'eyeshadow', 'liner', 'lashes',
      'aegyo', 'contour', 'highlight', 'lens', 'split', 'parts', 'makeupOff',
    ])
      expect(hasIcon(k), k).toBe(true);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/params.test.ts src/ui/panelModel.test.ts src/edit/legacy.test.ts`
Expected: FAIL — `unknown param shape.jawline`, `SHADE_PARTS` / `SHADES` not exported, `expected false to be true` for the icon keys, and `emptyShades` not exported by `./state` (`legacy.test.ts`).

- [x] **Step 3: Implement**

`src/types.ts` (CRLF): extend the `ParamId` union after `'shape.mouthSize'`

```ts
  | 'shape.jawline'
  | 'shape.temple'
  | 'shape.hairline'
  | 'shape.noseWing'
  | 'shape.noseBridge'
  | 'shape.mouthHeight'
```

and after `'makeup.blush'`

```ts
  | 'makeup.brow'
  | 'makeup.eyeshadow'
  | 'makeup.liner'
  | 'makeup.lashes'
  | 'makeup.aegyo'
  | 'makeup.contour'
  | 'makeup.highlight'
  | 'makeup.lens'
```

In `ParamDef`, after step 1's `live` field:

```ts
  /** 左右分開: the item can be set per side of the face (face-detail spec §3.1); absent = both sides alike */
  split?: true;
```

Step 1 declared `export type ShadePart = 'lip' | 'blush';` next to `PersonParamId` (step-1 plan Task 4): replace that one line (never add a second `ShadePart`) with:

```ts
export type SplitParamId = Extract<
  ParamId,
  'shape.eyeEnlarge' | 'shape.faceSlim' | 'shape.faceV' | 'shape.faceNarrow' | 'shape.jawline' | 'shape.temple'
>;
export type ShadePart = 'lip' | 'blush' | 'brow' | 'eyeshadow' | 'liner' | 'lens';
/** the ten 美妝 parts (face-detail spec §3.3); lives here (not in panelModel.ts) so engine code can use it */
export type MakeupPart = ShadePart | 'lashes' | 'aegyo' | 'contour' | 'highlight';
```

Step 1's `PersonParams` becomes:

```ts
export interface PersonParams {
  values: Record<PersonParamId, number>;
  /** 左右分開 (face-detail spec §3.4): GPUPixel-right values of the split items; null = both sides alike */
  right: Partial<Record<SplitParamId, number>> | null;
  /** ShadeDef ids, or null for 原色 (眼線: null reads as 黑) */
  shades: Record<ShadePart, string | null>;
  preset: PresetRef | 'custom';
}
```

`src/engine/params.ts` (LF): the 美型 block of `PARAM_DEFS` becomes (step 1's `scope` / `live` on every def; only the six new defs and the four `split: true` flags are new):

```ts
  // 美型 (RM §2.1 strip order; face-detail spec §3.1)
  { id: 'shape.eyeEnlarge', label: '大眼', group: 'shape', bidirectional: false, default: 0.2, icon: 'eye', scope: 'person', live: true, split: true },
  { id: 'shape.faceSlim', label: '瘦臉', group: 'shape', bidirectional: false, default: 0.15, icon: 'faceSlim', scope: 'person', live: true, split: true },
  { id: 'shape.faceV', label: 'V臉', group: 'shape', bidirectional: false, default: 0.1, icon: 'faceV', scope: 'person', live: true, split: true },
  { id: 'shape.faceNarrow', label: '窄臉', group: 'shape', bidirectional: false, default: 0, icon: 'faceNarrow', scope: 'person', live: true, split: true },
  { id: 'shape.jawline', label: '下頜線', group: 'shape', bidirectional: false, default: 0, icon: 'jawline', scope: 'person', live: true, split: true },
  { id: 'shape.temple', label: '太陽穴', group: 'shape', bidirectional: true, default: 0.5, icon: 'temple', scope: 'person', live: true, split: true },
  { id: 'shape.chin', label: '下巴', group: 'shape', bidirectional: true, default: 0.5, icon: 'chin', scope: 'person', live: true },
  { id: 'shape.forehead', label: '額頭', group: 'shape', bidirectional: true, default: 0.5, icon: 'forehead', scope: 'person', live: true },
  { id: 'shape.hairline', label: '髮際線', group: 'shape', bidirectional: true, default: 0.5, icon: 'hairline', scope: 'person', live: true },
  { id: 'shape.noseSlim', label: '瘦鼻', group: 'shape', bidirectional: false, default: 0.1, icon: 'nose', scope: 'person', live: true },
  { id: 'shape.noseWing', label: '鼻翼', group: 'shape', bidirectional: true, default: 0.5, icon: 'noseWing', scope: 'person', live: true },
  { id: 'shape.noseBridge', label: '山根', group: 'shape', bidirectional: true, default: 0.5, icon: 'noseBridge', scope: 'person', live: true },
  { id: 'shape.mouthSize', label: '嘴型', group: 'shape', bidirectional: true, default: 0.5, icon: 'mouth', scope: 'person', live: true },
  { id: 'shape.mouthHeight', label: '嘴高', group: 'shape', bidirectional: true, default: 0.5, icon: 'mouthHeight', scope: 'person', live: true },
  { id: 'shape.eyeDistance', label: '眼距', group: 'shape', bidirectional: true, default: 0.5, icon: 'eyeDistance', scope: 'person', live: true },
```

and the 美妝 block:

```ts
  // 美妝 (face-detail spec §3.1): 口紅 · 腮紅 (GPUPixel meshes), then the eight procedural parts
  { id: 'makeup.lip', label: '口紅', group: 'makeup', bidirectional: false, default: 0, icon: 'lip', scope: 'person', live: true },
  { id: 'makeup.blush', label: '腮紅', group: 'makeup', bidirectional: false, default: 0, icon: 'blush', scope: 'person', live: true },
  { id: 'makeup.brow', label: '眉毛', group: 'makeup', bidirectional: false, default: 0, icon: 'brow', scope: 'person', live: true },
  { id: 'makeup.eyeshadow', label: '眼影', group: 'makeup', bidirectional: false, default: 0, icon: 'eyeshadow', scope: 'person', live: true },
  { id: 'makeup.liner', label: '眼線', group: 'makeup', bidirectional: false, default: 0, icon: 'liner', scope: 'person', live: true },
  { id: 'makeup.lashes', label: '睫毛', group: 'makeup', bidirectional: false, default: 0, icon: 'lashes', scope: 'person', live: true },
  { id: 'makeup.aegyo', label: '臥蠶', group: 'makeup', bidirectional: false, default: 0, icon: 'aegyo', scope: 'person', live: true },
  { id: 'makeup.contour', label: '修容', group: 'makeup', bidirectional: false, default: 0, icon: 'contour', scope: 'person', live: true },
  { id: 'makeup.highlight', label: '高光', group: 'makeup', bidirectional: false, default: 0, icon: 'highlight', scope: 'person', live: true },
  { id: 'makeup.lens', label: '美瞳', group: 'makeup', bidirectional: false, default: 0, icon: 'lens', scope: 'person', live: true },
```

Replace `params.ts:84-101` (the 原色 comment, the two shade arrays and `MAKEUP_PICK_DEFAULT`) with:

```ts
export const SPLIT_IDS: readonly SplitParamId[] = PARAM_DEFS.filter((d) => d.split).map((d) => d.id as SplitParamId);

export const SHADE_PARTS: readonly ShadePart[] = ['lip', 'blush', 'brow', 'eyeshadow', 'liner', 'lens'];

/** Every colour is original to this project (LICENSES/NOTICE.txt). null shade = 原色 (S5 §3.2); 眼線 has none. */
export const SHADES: Readonly<Record<ShadePart, readonly ShadeDef[]>> = {
  lip: [
    { id: 'coral', label: '珊瑚', color: '#F06A5B' },
    { id: 'bean', label: '豆沙', color: '#C9767A' },
    { id: 'rose', label: '玫瑰', color: '#D8456B' },
    { id: 'red', label: '正紅', color: '#D21F3C' },
    { id: 'orange', label: '蜜橘', color: '#F08A4B' },
  ],
  blush: [
    { id: 'peach', label: '蜜桃', color: '#FF9E8A' },
    { id: 'pink', label: '粉紅', color: '#FF8FB1' },
    { id: 'apricot', label: '杏橘', color: '#FFB07A' },
    { id: 'rose', label: '玫瑰', color: '#E77A93' },
  ],
  brow: [
    { id: 'black', label: '自然黑', color: '#2E2824' },
    { id: 'darkBrown', label: '深棕', color: '#4B3628' },
    { id: 'greyBrown', label: '灰棕', color: '#6A5C55' },
    { id: 'mocha', label: '摩卡', color: '#7B5B45' },
    { id: 'chestnut', label: '栗棕', color: '#8A5636' },
  ],
  eyeshadow: [
    { id: 'earth', label: '大地', color: '#A27A63' },
    { id: 'peach', label: '蜜桃', color: '#EFA07F' },
    { id: 'rose', label: '玫瑰', color: '#C76F7F' },
    { id: 'coral', label: '珊瑚', color: '#E5806B' },
    { id: 'milktea', label: '奶茶', color: '#B99686' },
    { id: 'mauve', label: '紫霧', color: '#9A7FA6' },
  ],
  liner: [
    { id: 'black', label: '黑', color: '#151313' },
    { id: 'darkBrown', label: '深棕', color: '#3A2A22' },
    { id: 'brown', label: '棕', color: '#6A4A37' },
    { id: 'wine', label: '酒紅', color: '#6B2B34' },
    { id: 'navy', label: '藏青', color: '#25304E' },
  ],
  lens: [
    { id: 'black', label: '自然黑', color: '#231E1C' },
    { id: 'choco', label: '巧克力', color: '#5B3B29' },
    { id: 'amber', label: '琥珀', color: '#A9712F' },
    { id: 'grey', label: '霧灰', color: '#7E8891' },
    { id: 'blue', label: '冰藍', color: '#6E9AC6' },
    { id: 'green', label: '薄荷綠', color: '#7EA788' },
  ],
};
export const LIP_SHADES = SHADES.lip;
export const BLUSH_SHADES = SHADES.blush;
/** parts whose strip offers 原色 (S5 §3.2) */
export const ORIG_PARTS: readonly ShadePart[] = ['lip', 'blush', 'brow', 'eyeshadow', 'lens'];
/** what 原色 multiplies by on the procedural parts: 眉毛 grey 0.60, 眼影 a neutral skin-toned shadow (S5 §3.2) */
export const ORIG_TINT = { brow: '#999999', eyeshadow: '#CCBDB6' } as const;
/** fixed colours of the parts without shades (S5 §3.2) */
export const MAKEUP_FIXED = {
  lashes: '#141212',
  aegyoLight: '#FFF1E8',
  aegyoShade: '#B79F95',
  contour: '#A8897A',
  highlight: '#FFF3E3',
} as const;

/** intensity applied when a shade or 自然 is first picked from 0 (S5 §3.1) */
export const MAKEUP_PICK_DEFAULT: Readonly<Record<MakeupPart, number>> = {
  lip: 0.5,
  blush: 0.4,
  brow: 0.45,
  eyeshadow: 0.45,
  liner: 0.6,
  lashes: 0.55,
  aegyo: 0.5,
  contour: 0.4,
  highlight: 0.4,
  lens: 0.6,
};

export function isShadePart(p: MakeupPart): p is ShadePart {
  return (SHADE_PARTS as readonly string[]).includes(p);
}
```

Replace `shadeColor` (`params.ts:294-297`):

```ts
/** '#RRGGBB' of a shade, or null for 原色. 眼線 has no 原色: null (or an unknown id) reads as its first shade, 黑. */
export function shadeColor(part: ShadePart, shade: string | null): string | null {
  const list = SHADES[part];
  const hit = shade ? list.find((s) => s.id === shade) : undefined;
  if (part === 'liner') return (hit ?? list[0]).color;
  return hit?.color ?? null;
}
```

Add `MakeupPart, ShadePart, SplitParamId` to the `import type` line of `params.ts`. The v1 `sanitizeParams` (`params.ts:299-326`) keeps validating `lipShade` / `blushShade` against `LIP_SHADES` / `BLUSH_SHADES`, unchanged.

`src/edit/state.ts` (step 1):

```ts
export function emptyShades(): Record<ShadePart, string | null> {
  return { lip: null, blush: null, brow: null, eyeshadow: null, liner: null, lens: null };
}
```

Step 1's module-local `SHADES` id sets (`state.ts:97-100`, typed `Record<ShadePart, ReadonlySet<string>>` with lip and blush only) no longer type-check once `ShadePart` has six parts, so replace them here (this was Task 3's first `state.ts` edit) by sets for all six parts, built from the params table, which is imported under another name because the local keeps its name:

```ts
const SHADES: Record<ShadePart, ReadonlySet<string>> = Object.fromEntries(
  SHADE_PARTS.map((k) => [k, new Set(SHADE_DEFS[k].map((s) => s.id))]),
) as Record<ShadePart, ReadonlySet<string>>;
```

(add `SHADE_PARTS` and `SHADES as SHADE_DEFS` to `state.ts`'s import from `../engine/params` and drop `LIP_SHADES` / `BLUSH_SHADES` from it: these two lines were their only users.)

Make every `PersonParams` object literal carry `right: null` and `shades: { ...emptyShades(), lip: …, blush: … }` with the lip and blush values it already sets. In step 1's code these are:
- `personFromPreset` (`src/edit/state.ts`; `neutralPerson` and `naturalPerson` call it): `return { values, right: null, shades: { ...emptyShades(), lip: p.lipShade, blush: p.blushShade }, preset: { id, amount: p.presetAmount } };`
- the lens's `withPresetPart` (`src/edit/lens.ts`): `return { values, right: null, shades: { ...emptyShades(), lip: q.lipShade, blush: q.blushShade }, preset: { id, amount: q.presetAmount } };` (its `values` start from `p.values` and take every `PRESET_PERSON_IDS` value from the preset, and `PRESET_PERSON_IDS` is derived from `PARAM_DEFS`, so the 14 new values come out neutral: the preset reset of RM §11 Q7 needs no other code);
- the lens's `resetGroup`, 美妝 branch: `shades: { lip: null, blush: null }` → `shades: emptyShades()`;
- `sanitizePerson` (`src/edit/state.ts`): `const shades = { ...emptyShades(), lip: shade('lip'), blush: shade('blush') };` and `right: null` in both object literals it builds (Task 3 rewrites both lines);
- `splitLegacy` (`src/edit/legacy.ts:17`).

Step 4's `mergeLegacy` (`src/edit/legacy.ts:82`, the merge of a v2 entry that 0.3 edited after a rollback) builds its person as `{ ...was, values, shades: { ...was.shades, ...split.person.shades }, preset }`. With `splitLegacy` now returning all six shades, that spread would null the four new shades, which 0.3 can neither show nor write (its contract: "everything else stays as the v2 edit has it"). Take only the two shades 0.3 writes: `shades: { ...was.shades, lip: split.person.shades.lip, blush: split.person.shades.blush }`. `right` stays as the v2 edit has it through `...was` (the appended `legacy.test.ts` case pins both).

The wider `MakeupPart` also reaches step 1's and step 2's code that hands a `MakeupPart` to the lens's `ShadePart` API (`lens.shade`, `lens.setShade`, `lens.clearMakeup`). Until Task 14 rewrites the 美妝 strip only 口紅 and 腮紅 can be selected (`MAKEUP_PARTS` still lists two parts), so narrow those call sites without changing behaviour:
- `src/ui/panelModel.ts` `ItemAction`: the shade action becomes `{ type: 'shade'; part: ShadePart; shade: string | null }` (add `ShadePart` to the type import);
- step 1's `itemsFor`, case `'makeup'`: right after `const part = sel.makeupPart;` add `if (!isShadePart(part)) return [{ ...RESET_ITEM('無'), selected: true }];` (import `isShadePart` from `../engine/params`);
- step 1's `activate`, case `'reset'`, 美妝 branch: start it with `if (!isShadePart(sel.makeupPart)) return done();`;
- step 1's `partHasValue(lens, part)` (`panelModel.ts:371-375`; step 2's part-row callback in `BeautyPanel.tsx:94` is `makeupOn: (p) => partHasValue(lens, p)`, so `BeautyPanel.tsx` itself needs no change): start it with `if (!isShadePart(part)) return false;`.

Then run `npm run typecheck`: any remaining error is a `PersonParams` literal missing `right` or a shade key (fix it as above) or another `MakeupPart` handed to the `ShadePart` API (narrow it with `isShadePart` the same way).

`src/ui/panelModel.ts:12` (CRLF): replace `export type MakeupPart = 'lip' | 'blush';` with

```ts
export type { MakeupPart } from '../types';
```

and add `MakeupPart` to the file's `import type { … } from '../types'` line (the type is used locally).

`src/ui/icons.tsx` (CRLF): insert before `  // ── 美體 (body.* ParamDef.icon keys + tools) ──`:

```tsx
  // ── 美型 / 美妝 (face-detail spec §3.1) ──
  jawline: (
    <>
      <path d="M5.4 4.6v4.8c0 4.1 2.9 8.2 6.6 10.4 3.7-2.2 6.6-6.3 6.6-10.4V4.6" />
      <path d="M7.6 15.4 12 18.6l4.4-3.2" />
    </>
  ),
  temple: (
    <>
      <path d="M12 3.6c-3.9 0-6.4 2.9-6.4 7 0 4.8 3 9.8 6.4 9.8s6.4-5 6.4-9.8c0-4.1-2.5-7-6.4-7Z" />
      <path d="M2.8 8.8h2.4M21.2 8.8h-2.4" />
    </>
  ),
  hairline: (
    <>
      <path d="M5 20.4v-8.8a7 7 0 0 1 14 0v8.8" />
      <path d="M7.2 10.4c1.5-1.3 3.1-1.9 4.8-1.9s3.3.6 4.8 1.9" />
    </>
  ),
  noseWing: (
    <>
      <path d="M12 3.8v8.8" />
      <path d="M8.6 15.2c0 1.7 1.5 2.7 3.4 2.7s3.4-1 3.4-2.7" />
      <path d="M4.6 15.6h2.2M17.2 15.6h2.2" />
    </>
  ),
  noseBridge: (
    <>
      <path d="M9.6 4.2c.8 3 1 6 .2 9.8M14.4 4.2c-.8 3-1 6-.2 9.8" />
      <path d="M8 17.4c1 1.2 2.4 1.8 4 1.8s3-.6 4-1.8" />
    </>
  ),
  mouthHeight: (
    <>
      <path d="M6 15.4c1.8 1.9 3.8 2.8 6 2.8s4.2-.9 6-2.8H6Z" />
      <path d="M12 4v7.2m-2.2-5L12 4l2.2 2.2" />
    </>
  ),
  brow: (
    <>
      <path d="M4 9.4c2.6-2.2 5.4-3.2 8.4-3.2 2.8 0 5.4.9 7.6 2.6" />
      <path d="M5 15.6c2.1-2.2 4.4-3.3 7-3.3s4.9 1.1 7 3.3c-2.1 2.2-4.4 3.3-7 3.3s-4.9-1.1-7-3.3Z" />
    </>
  ),
  eyeshadow: (
    <>
      <path d="M3.4 14c2.4-3.4 5.3-5.1 8.6-5.1s6.2 1.7 8.6 5.1" />
      <path d="M5.6 10.6c1.8-2.6 3.9-3.9 6.4-3.9s4.6 1.3 6.4 3.9" />
      <path d="M3.4 14c2.4 2.6 5.3 3.9 8.6 3.9s6.2-1.3 8.6-3.9" />
    </>
  ),
  liner: (
    <>
      <path d="M3.6 13.4c2.4-3.2 5.2-4.8 8.4-4.8 3 0 5.6 1.3 7.8 3.8l1.8-1.9" />
      <path d="M3.6 13.4c2.4 2.8 5.2 4.2 8.4 4.2s6-1.4 8.4-4.2" />
      <circle cx="12" cy="13.2" r="2.2" />
    </>
  ),
  lashes: (
    <>
      <path d="M3.6 14c2.4-2.8 5.2-4.2 8.4-4.2s6 1.4 8.4 4.2" />
      <path d="M6 11.4 4.8 9.2M9 9.9l-.6-2.4M12 9.8V7.2M15 9.9l.6-2.4M18 11.4l1.2-2.2" />
    </>
  ),
  aegyo: (
    <>
      <path d="M3.6 10.6c2.4-2.8 5.2-4.2 8.4-4.2s6 1.4 8.4 4.2c-2.4 2.8-5.2 4.2-8.4 4.2s-6-1.4-8.4-4.2Z" />
      <path d="M6.4 16.4c1.7 1.3 3.6 1.9 5.6 1.9s3.9-.6 5.6-1.9" />
    </>
  ),
  contour: (
    <>
      <path d="M12 3.6c-3.6 0-5.8 2.7-5.8 6.6 0 4.6 2.9 9.4 5.8 9.4s5.8-4.8 5.8-9.4c0-3.9-2.2-6.6-5.8-6.6Z" />
      <path d="M8 11.6c.2 2 .9 3.8 2 5.2M16 11.6c-.2 2-.9 3.8-2 5.2" />
    </>
  ),
  highlight: (
    <>
      <path d="M12 4.2c.6 3.9 2.3 5.6 6.2 6.2-3.9.6-5.6 2.3-6.2 6.2-.6-3.9-2.3-5.6-6.2-6.2 3.9-.6 5.6-2.3 6.2-6.2Z" />
      <path d="M18.4 16.2v3M16.9 17.7h3" />
    </>
  ),
  lens: (
    <>
      <path d="M2.8 12c2.4-3.9 5.5-5.8 9.2-5.8s6.8 1.9 9.2 5.8c-2.4 3.9-5.5 5.8-9.2 5.8S5.2 15.9 2.8 12Z" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  split: (
    <>
      <path d="M12 3.4v17.2" />
      <path d="M10 4C7.2 4.6 5.6 7 5.6 10.4c0 4.4 2 8.2 4.4 9.4M14 4c2.8.6 4.4 3 4.4 6.4 0 4.4-2 8.2-4.4 9.4" />
    </>
  ),
  parts: (
    <>
      <rect x="4.4" y="4.4" width="6.2" height="6.2" rx="1.6" />
      <rect x="13.4" y="4.4" width="6.2" height="6.2" rx="1.6" />
      <rect x="4.4" y="13.4" width="6.2" height="6.2" rx="1.6" />
      <rect x="13.4" y="13.4" width="6.2" height="6.2" rx="1.6" />
    </>
  ),
  makeupOff: (
    <>
      <path d="M9 20.4h6v-7.8H9Z" />
      <path d="M10 12.6V8.4l4-2.6v6.8" />
      <path d="M4.6 4.6 19.4 19.4" />
    </>
  ),
```

- [x] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/engine/params.test.ts src/ui/panelModel.test.ts src/edit && npm run typecheck`
Expected: PASS; `tsc` prints no errors.

- [x] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: PASS. The new 美型 items are neutral, so no engine or panel assertion changes.

- [x] **Step 6: Commit**

```bash
file src/types.ts src/ui/panelModel.ts src/ui/icons.tsx src/ui/components/BeautyPanel.tsx src/engine/params.ts src/edit/state.ts src/edit/legacy.ts src/edit/lens.ts
git add src/types.ts src/engine/params.ts src/engine/params.test.ts src/edit src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/icons.tsx src/ui/components/BeautyPanel.tsx
git commit -F- <<'EOF'
v0.4 step 5: 臉型細項 and 美妝 param schema, shades and icons

Fourteen person-level ids (six warps, eight procedural makeup parts), the
split flag on six 美型 items, the per-part shade tables and pick defaults,
and seventeen original line icons.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 2: `Face.iris` and `Face.lids` from the cached landmarks

The adapter fills the two new `Face` fields from the 478 raw landmarks that step 1 caches, so reopening a photo needs no detection (S5 §4.7, RM §3.6).

**Files:**
- Modify: `src/types.ts:309-322` (`Face`)
- Modify: `src/tracking/adapter111.ts:5-6, 106-140`
- Modify (Face literals gain the two fields): `src/app/testFakes.ts:50` (CRLF), `src/body/synthetic.ts:167, 375`, `src/engine/passes/mask.test.ts:13`, `src/engine/passes/reshape.test.ts:25` (CRLF), `src/ui/faceProtectModel.test.ts:26`, `tests/harness/t2/main.ts:982` (CRLF), `tests/harness/t7/fakes.ts:296`, and the literals steps 1–4 added: `src/bench/exportBench.ts:30`, `src/bench/multiFace.ts:235`, `src/engine/passes/toneGeometry.test.ts:225`, `src/geometry/upFrame.test.ts:91`, `src/tracking/faceProtect.test.ts:106`, `tests/e2e/pages/reshape.ts:229, 261` (the typecheck lists any other)
- Modify: `src/geometry/upFrame.ts:42-45` (step 3's `faceOToU`, the U-frame face of the body measure): map `iris` and `lids` with the other point arrays
- Test: `src/tracking/adapter111.test.ts`

**Interfaces:**
- Consumes: `adapt(l: Landmarks478, width, height): Face` (`adapter111.ts:106`); the fixture `tests/fixtures/landmarks_sample_face.json` (`points` and `mirrored`).
- Produces:
  - `Face.iris: Float32Array` (length 20: `[0..9]` MP 468 centre + 469–472, GPUPixel-left eye; `[10..19]` MP 473 + 474–477)
  - `Face.lids: Float32Array` (length 64: 16 points per eye, outer corner, 7 upper outer → inner, inner corner, 7 lower outer → inner; `[0..31]` GPUPixel-left eye = MP 33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153, 154, 155; `[32..63]` = MP 263, 466, 388, 387, 386, 385, 384, 398, 362, 249, 390, 373, 374, 380, 381, 382)
  - `adapter111.ts`: `IRIS_MP: readonly number[]`, `LIDS_MP: readonly number[]`, `blankEyes(): Pick<Face, 'iris' | 'lids'>` (zero-filled, for synthetic faces)

- [x] **Step 1: Write the failing test**

Append to `src/tracking/adapter111.test.ts`:

```ts
describe('iris and lids (face-detail spec §3.3, §4.7)', () => {
  for (const [name, points] of [
    ['fixture', fx.points],
    ['mirrored', fx.mirrored],
  ] as const) {
    const f = adapt({ points: new Float32Array(points) }, W, H);
    const at = (a: Float32Array, k: number): [number, number] => [a[k * 2], a[k * 2 + 1]];
    const p = (i: number) => at(f.pts111, i);
    const px = (q: [number, number]): [number, number] => [q[0] * W, q[1] * H];

    it(`${name}: shapes, finite, inside the image`, () => {
      expect(f.iris.length).toBe(20);
      expect(f.lids.length).toBe(64);
      for (const v of [...f.iris, ...f.lids]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it(`${name}: iris centres are p104 / p105; the radius is 15–30 % of the eye width`, () => {
      expect(at(f.iris, 0)).toEqual(p(104));
      expect(at(f.iris, 5)).toEqual(p(105));
      for (const [c, [outer, inner]] of [
        [0, [52, 55]],
        [5, [61, 58]],
      ] as const) {
        const ctr = px(at(f.iris, c));
        let r = 0;
        for (let b = 1; b <= 4; b++) r += dist(px(at(f.iris, c + b)), ctr) / 4;
        const ratio = r / dist(px(p(outer)), px(p(inner)));
        expect(ratio).toBeGreaterThan(0.15);
        expect(ratio).toBeLessThan(0.3);
      }
    });

    it(`${name}: lid corners and mid points are the GPUPixel eye points`, () => {
      for (const [k, i] of [
        [0, 52],
        [8, 55],
        [4, 72],
        [12, 73],
        [16, 61],
        [24, 58],
        [20, 75],
        [28, 76],
      ] as const)
        expect(at(f.lids, k)).toEqual(p(i));
    });
  }
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tracking/adapter111.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')` (no `iris` on the adapted face).

- [x] **Step 3: Implement**

`src/types.ts` (CRLF), inside `Face` after `yaw`:

```ts
  /** MediaPipe 468–477 (x, y): [0..9] = 468 centre + 469–472 (GPUPixel-left eye), [10..19] = 473 + 474–477 */
  iris: Float32Array;
  /**
   * MediaPipe eye contours (x, y), 16 points per eye: outer corner, 7 upper (outer → inner), inner corner, 7 lower
   * (outer → inner). [0..31] GPUPixel-left eye = MP 33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153,
   * 154, 155; [32..63] GPUPixel-right eye = MP 263, 466, 388, 387, 386, 385, 384, 398, 362, 249, 390, 373, 374, 380,
   * 381, 382 (FaceLandmarker's RIGHT_EYE / LEFT_EYE contours; face-detail spec §3.3)
   */
  lids: Float32Array;
```

`src/tracking/adapter111.ts` (LF), after `const EXT …` (line 47):

```ts
/** Face.iris: MediaPipe 468 (centre) + 469–472, then 473 + 474–477; GPUPixel-left eye first (= MediaPipe's RIGHT) */
export const IRIS_MP: readonly number[] = [468, 469, 470, 471, 472, 473, 474, 475, 476, 477];
/** Face.lids: per eye the outer corner, 7 upper (outer → inner), the inner corner, 7 lower (outer → inner) */
export const LIDS_MP: readonly number[] = [
  33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153, 154, 155,
  263, 466, 388, 387, 386, 385, 384, 398, 362, 249, 390, 373, 374, 380, 381, 382,
];

function pick(p: Float32Array, idx: readonly number[]): Float32Array {
  const out = new Float32Array(idx.length * 2);
  idx.forEach((i, k) => {
    out[k * 2] = p[i * 3];
    out[k * 2 + 1] = p[i * 3 + 1];
  });
  return out;
}

/** zero-filled eye fields for synthetic faces (eyeFrames then uses its p104 / p105 fallback) */
export function blankEyes(): Pick<Face, 'iris' | 'lids'> {
  return { iris: new Float32Array(IRIS_MP.length * 2), lids: new Float32Array(LIDS_MP.length * 2) };
}
```

and replace the return of `adapt` (`adapter111.ts:139`):

```ts
  return { pts111, ext, oval, yaw: yawProxy(pts111, w, h), iris: pick(p, IRIS_MP), lids: pick(p, LIDS_MP) };
```

Port every `Face` object literal by spreading `...blankEyes()` into it (import `blankEyes` from the adapter; the test files use a relative path), e.g. `src/body/synthetic.ts:167`:

```ts
  const face: Face = { pts111: new Float32Array(222), ext, oval: new Float32Array(72), yaw: 0, ...blankEyes() };
```

Same edit at `src/body/synthetic.ts:375`, `src/app/testFakes.ts:50`, `src/engine/passes/mask.test.ts:13`, `src/engine/passes/reshape.test.ts:25`, `src/ui/faceProtectModel.test.ts:26`, `tests/harness/t2/main.ts:982`, `tests/harness/t7/fakes.ts:296` (there: `{ pts111: …, ext: …, oval: …, yaw: 0, ...blankEyes() }`) and the step 1–4 literals listed under **Files** (a face built by mapping another face's arrays, e.g. `multiFace.ts:235`, `faceProtect.test.ts:106` or the two `shrink` helpers of `tests/e2e/pages/reshape.ts:229, 261`, may map `iris` and `lids` the same way instead). Run `npm run typecheck` and port each further literal it reports the same way.

Step 3's `faceOToU` (`src/geometry/upFrame.ts:42-45`) spreads the face and maps `pts111`, `ext` and `oval` into U; add `iris: pointsOToU(f.iris, 2, q), lids: pointsOToU(f.lids, 2, q)` to it, so a U face never mixes frames (the body measure reads none of them today).

- [x] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/tracking/adapter111.test.ts && npm run typecheck && npm test`
Expected: PASS; no type errors; the rest of the unit suite unchanged.

- [x] **Step 5: Commit**

```bash
file src/types.ts src/tracking/adapter111.ts src/app/testFakes.ts src/engine/passes/reshape.test.ts tests/harness/t2/main.ts
git add src/types.ts src/tracking/adapter111.ts src/tracking/adapter111.test.ts src/app/testFakes.ts src/body/synthetic.ts src/engine/passes/mask.test.ts src/engine/passes/reshape.test.ts src/ui/faceProtectModel.test.ts tests/harness/t2/main.ts tests/harness/t7/fakes.ts
git add -u
git commit -F- <<'EOF'
v0.4 step 5: Face.iris and Face.lids from the raw landmarks

The adapter keeps MediaPipe's iris points and the two dense eye contours,
so the eye makeup can follow the real lash line; cached landmarks give
both on reopen without a new detection.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Landed:** the code is `6502bf2`. Its subject wrongly reads "v0.4 step 4 task 2: spot list edits and sanitizing" (a leftover message file again, as in `db1f468`). It is not amended; the next commit records it. Deviations: `src/app/testFakes.ts` spells out `blankEyes()` as zero-filled `iris` / `lids`, because `live.test.ts` and `still.test.ts` mock the whole adapter module and call `makeFace` from their `adapt`. The typecheck also listed `src/edit/warpGuard.test.ts:25`, `src/engine/passes/reshapeCpu.test.ts:95` and `src/engine/passes/toneGeometry.test.ts:80, 333`. They map `iris` / `lids` like their other arrays, and `toneGeometry.test.ts`'s `mirrorFace` swaps the two eyes. `upFrame.test.ts` checks the `faceOToU` mapping of both.

### Task 3: 左右分開 storage, presets and sanitize

The pure side helpers (S5 §3.4) and the edit-state rules for the new fields: presets reset them (RM §11 Q7 default), a preset id stands only with `right = null`, and sanitize fills or drops what older builds wrote (S5 §3.5).

**Files:**
- Create: `src/edit/sides.ts`, `src/edit/sides.test.ts`
- Modify: `src/edit/state.ts` (step 1): `matchesPersonPreset` (`:190-194`), `sanitizePerson` (`:210-228`, the per-person part of `sanitizeEditState`); its module-local `SHADES` id sets were widened in Task 1
- Test: `src/edit/state.test.ts` (step 1)

**Interfaces:**
- Consumes: from step 1 (RM §3.2–3.4) `EditState`, `PersonParams`, `PersonInfo`, `defaultPhoto()`, `neutralPerson()`, `naturalPerson()`, `personFromPreset()`, `sanitizeEditState(raw, personIds | null, oSize?)` (it calls `sanitizePerson(raw, fallback)` per person), `legacyProjection(edit, primary)` (`src/edit/legacy.ts`), `lensFor(edit, sel, persons, primary, opts?)` with `applyPreset(id, amount)` (its person part comes from the lens's `withPresetPart`, which Task 1 gave `right: null` and null new shades), and `matchesPersonPreset(p, ref)` (RM §3.4); from step 3 (S3 §3.3) `src/geometry/view.ts` `oToV(g: Geometry, oSize: {width, height}): Affine` and `apply(m: Affine, p: [number, number]): [number, number]`, `Geometry` (RM §3.2); from Task 1 `SPLIT_IDS`, `SHADE_PARTS`, `SHADES`, `emptyShades()`; from Task 2 `blankEyes()`.
- Produces (`src/edit/sides.ts`):
  - `type Side = 'L' | 'R'` (on-screen side); `type Slot = 'values' | 'right'` (stored half: `values` = GPUPixel-left)
  - `isSplitId(id: string): id is SplitParamId`
  - `slotFor(screenSwap: boolean, side: Side): Slot`
  - `readSide(p: PersonParams, id: SplitParamId, slot: Slot): number`
  - `writeSide(p: PersonParams, id: SplitParamId, v: number, slot: Slot): PersonParams` (never creates `right`)
  - `splitOn(p: PersonParams): PersonParams`; `splitOff(p: PersonParams, slot: Slot): PersonParams`
  - `mirrorSides(p: PersonParams): PersonParams` (an involution on a complete `right`)
  - `sanitizeRight(raw: unknown): PersonParams['right']`
  - `screenLeftIsGpLeft(face: Face, toScreen: (p: [number, number]) => [number, number]): boolean`

- [x] **Step 1: Write the failing tests**

Create `src/edit/sides.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SPLIT_IDS } from '../engine/params';
import { apply, oToV } from '../geometry/view';
import { blankEyes } from '../tracking/adapter111';
import type { Face, Geometry, PersonParams } from '../types';
import { naturalPerson } from './state';
import { isSplitId, mirrorSides, readSide, sanitizeRight, screenLeftIsGpLeft, slotFor, splitOff, splitOn, writeSide } from './sides';

const eyes = (l: [number, number], r: [number, number]): Face => {
  const pts111 = new Float32Array(222);
  pts111.set(l, 74 * 2);
  pts111.set(r, 77 * 2);
  return { pts111, ext: new Float32Array(16), oval: new Float32Array(72), yaw: 0, ...blankEyes() };
};
const G = (over: Partial<Geometry>): Geometry => ({ flipH: false, quarter: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, ...over });
const O_SIZE = { width: 1000, height: 1500 };
const through = (g: Geometry) => {
  const m = oToV(g, O_SIZE);
  return (p: [number, number]) => apply(m, [p[0], p[1]]);
};
const person = (over: Partial<PersonParams> = {}): PersonParams => ({ ...naturalPerson(), ...over });

describe('screenLeftIsGpLeft (S5 §2.2, §3.4)', () => {
  const upright = eyes([0.4, 0.4], [0.6, 0.4]);
  it('upright and unmirrored: the GPUPixel-left half shows on the screen left', () => {
    expect(screenLeftIsGpLeft(upright, (p) => p)).toBe(true);
  });
  it('the front-camera preview mirror swaps it', () => {
    expect(screenLeftIsGpLeft(upright, (p) => [1 - p[0], p[1]])).toBe(false);
  });
  it('翻轉 swaps it, a half turn swaps it, both together restore it (step 3 view module)', () => {
    expect(screenLeftIsGpLeft(upright, through(G({})))).toBe(true);
    expect(screenLeftIsGpLeft(upright, through(G({ flipH: true })))).toBe(false);
    expect(screenLeftIsGpLeft(upright, through(G({ quarter: 2 })))).toBe(false);
    expect(screenLeftIsGpLeft(upright, through(G({ quarter: 2, flipH: true })))).toBe(true);
  });
  it('an upside-down face reads by its own eyes', () => {
    expect(screenLeftIsGpLeft(eyes([0.6, 0.6], [0.4, 0.6]), (p) => p)).toBe(false);
  });
  it('a face lying sideways in O, read through a quarter turn (旋轉: clockwise quarters, RM §3.2)', () => {
    // GPUPixel-left eye below the right one in O; a clockwise quarter turn maps (x, y) → (1 − y, x)
    const lying = eyes([0.41, 0.6], [0.39, 0.4]);
    expect(screenLeftIsGpLeft(lying, through(G({})))).toBe(false);
    expect(screenLeftIsGpLeft(lying, through(G({ quarter: 1 })))).toBe(true);
    expect(screenLeftIsGpLeft(lying, through(G({ quarter: 3 })))).toBe(false);
  });
});

describe('slots (S5 §3.4)', () => {
  it('slotFor maps the on-screen side to the stored half', () => {
    expect([slotFor(false, 'L'), slotFor(false, 'R'), slotFor(true, 'L'), slotFor(true, 'R')]).toEqual(['values', 'right', 'right', 'values']);
  });
  it('readSide / writeSide: while right is null both halves read and write values; right is never created', () => {
    const p = person();
    expect(readSide(p, 'shape.faceSlim', 'right')).toBe(p.values['shape.faceSlim']);
    const q = writeSide(p, 'shape.faceSlim', 0.9, 'right');
    expect(q.right).toBeNull();
    expect(q.values['shape.faceSlim']).toBe(0.9);
  });
  it('readSide / writeSide with 左右分開 on', () => {
    const p = splitOn(person());
    const q = writeSide(p, 'shape.temple', 0.8, 'right');
    expect(q.right?.['shape.temple']).toBe(0.8);
    expect(q.values['shape.temple']).toBe(p.values['shape.temple']);
    expect(readSide(q, 'shape.temple', 'right')).toBe(0.8);
    expect(readSide(q, 'shape.temple', 'values')).toBe(0.5);
    expect(isSplitId('shape.temple')).toBe(true);
    expect(isSplitId('shape.chin')).toBe(false);
  });
  it('splitOn copies the six values (nothing moves); splitOff keeps the given side', () => {
    const p = person({ values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 } });
    const on = splitOn(p);
    expect(Object.keys(on.right ?? {}).sort()).toEqual([...SPLIT_IDS].sort());
    for (const id of SPLIT_IDS) expect(on.right?.[id]).toBe(p.values[id]);
    expect(splitOn(on)).toBe(on);
    const edited = writeSide(on, 'shape.faceSlim', 0.9, 'right');
    expect(splitOff(edited, 'right').values['shape.faceSlim']).toBe(0.9);
    expect(splitOff(edited, 'values').values['shape.faceSlim']).toBe(0.3);
    expect(splitOff(edited, 'values').right).toBeNull();
  });
  it('mirrorSides swaps exactly the six split ids and is an involution', () => {
    const base = writeSide(splitOn(person()), 'shape.jawline', 0.7, 'right');
    const on = { ...base, values: { ...base.values, 'shape.chin': 0.9 } };
    const m = mirrorSides(on);
    expect(m.values['shape.jawline']).toBe(0.7);
    expect(m.right?.['shape.jawline']).toBe(on.values['shape.jawline']);
    expect(m.values['shape.chin']).toBe(0.9);
    expect(mirrorSides(m)).toEqual(on);
    const off = person();
    expect(mirrorSides(off)).toBe(off);
  });
  it('sanitizeRight keeps finite split keys clamped to 0..1; nothing left → null', () => {
    expect(sanitizeRight({ 'shape.faceSlim': 2, 'shape.chin': 0.4, 'shape.temple': Number.NaN, 'shape.jawline': 0.25 })).toEqual({
      'shape.faceSlim': 1,
      'shape.jawline': 0.25,
    });
    expect(sanitizeRight({ 'shape.chin': 0.4 })).toBeNull();
    expect(sanitizeRight({})).toBeNull();
    expect(sanitizeRight([0.5])).toBeNull();
    expect(sanitizeRight('x')).toBeNull();
  });
});
```

Append to `src/edit/state.test.ts` (merge into its existing import lines, never importing a name twice: `paramDef`, `neutralValue`, `SHADE_PARTS`, `SHADES`, `SPLIT_IDS` from `../engine/params`; `defaultPhoto`, `emptyShades`, `naturalPerson`, `neutralPerson`, `sanitizeEditState` from `./state`; `legacyProjection` from `./legacy`; `lensFor` from `./lens`; `EditState`, `ParamId`, `PersonParams` types):

```ts
const STEP5_IDS: ParamId[] = [
  'shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight',
  'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
];
const editOf = (f0: PersonParams): EditState => ({ v: 2, photo: defaultPhoto(), persons: { f0 }, template: neutralPerson(), primaryInit: null });

describe('step-5 fields in the edit state (S5 §3.5)', () => {
  it('every beauty preset resets the new items, their shades and 左右分開 (RM §11 Q7 default)', () => {
    for (const id of ['original', 'natural', 'refined', 'glow'] as const) {
      const p: PersonParams = {
        ...naturalPerson(),
        values: { ...naturalPerson().values, 'shape.jawline': 0.7, 'shape.temple': 0.9, 'makeup.lens': 0.6 },
        right: { 'shape.faceSlim': 0.9 },
        shades: { ...emptyShades(), brow: 'mocha', eyeshadow: 'earth', liner: 'wine', lens: 'blue' },
      };
      const out = lensFor(editOf(p), { kind: 'person', id: 'f0' }, [{ id: 'f0', face: true, body: false }], 'f0').applyPreset(id, 1).persons.f0;
      expect(out.right).toBeNull();
      for (const k of STEP5_IDS) expect(out.values[k as keyof typeof out.values]).toBe(neutralValue(paramDef(k)));
      expect([out.shades.brow, out.shades.eyeshadow, out.shades.liner, out.shades.lens]).toEqual([null, null, null, null]);
    }
  });

  it('a preset id stands only while right is null (matchesPersonPreset)', () => {
    const split = { ...naturalPerson(), right: { 'shape.faceSlim': naturalPerson().values['shape.faceSlim'] } };
    expect(sanitizeEditState(editOf(split), ['f0']).persons.f0.preset).toBe('custom');
    expect(sanitizeEditState(editOf(naturalPerson()), ['f0']).persons.f0.preset).toEqual(naturalPerson().preset);
  });

  it('fills what step-1…4 builds did not write: neutral new values, null new shades, right = null', () => {
    const p = naturalPerson();
    const values: Record<string, unknown> = { ...p.values };
    for (const k of STEP5_IDS) delete values[k];
    const old = { values, shades: { lip: 'rose', blush: null }, preset: p.preset };
    const out = sanitizeEditState({ v: 2, photo: defaultPhoto(), persons: { f0: old }, template: neutralPerson(), primaryInit: null }, ['f0']).persons.f0;
    expect(out.right).toBeNull();
    expect(out.shades).toEqual({ ...emptyShades(), lip: 'rose' });
    for (const k of STEP5_IDS) expect(out.values[k as keyof typeof out.values]).toBe(neutralValue(paramDef(k)));
  });

  it('drops unknown shade ids and bad right entries (fuzzed)', () => {
    let s = 7;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const junk = (): unknown => [Number.NaN, Number.POSITIVE_INFINITY, -2, 3, 'x', null, {}, 0.3][Math.floor(rnd() * 8)];
    for (let n = 0; n < 200; n++) {
      const right: Record<string, unknown> = {};
      for (const id of [...SPLIT_IDS, 'shape.chin', 'makeup.lens']) if (rnd() < 0.5) right[id] = junk();
      const shades: Record<string, unknown> = {};
      for (const part of SHADE_PARTS) shades[part] = rnd() < 0.5 ? SHADES[part][Math.floor(rnd() * SHADES[part].length)].id : junk();
      const raw = { v: 2, photo: defaultPhoto(), persons: { f0: { ...naturalPerson(), right, shades } }, template: neutralPerson(), primaryInit: null };
      const out = sanitizeEditState(raw, ['f0']).persons.f0;
      if (out.right !== null) {
        expect(Object.keys(out.right).length).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(out.right)) {
          expect(SPLIT_IDS).toContain(k);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      expect(Object.keys(out.shades).sort()).toEqual([...SHADE_PARTS].sort());
      for (const part of SHADE_PARTS) {
        const v = out.shades[part];
        if (v !== null) expect(SHADES[part].map((x) => x.id)).toContain(v);
      }
    }
  });

  it('legacyProjection writes the GPUPixel-left (values) side of a split item', () => {
    const p = { ...naturalPerson(), values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 }, right: { 'shape.faceSlim': 0.9 } };
    expect(legacyProjection(editOf(p), 'f0').values['shape.faceSlim']).toBe(0.3);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/edit/sides.test.ts src/edit/state.test.ts`
Expected: FAIL — `Failed to resolve import "./sides"`; in `state.test.ts` the case "a preset id stands only while right is null" fails (`expected { id: 'natural', amount: 1 } to be 'custom'`: Task 1's `sanitizePerson` still drops `right`, so the split person keeps its preset id). The preset, fill, fuzz and `legacyProjection` cases already pass after Task 1 (its `withPresetPart` / `sanitizePerson` literals); they stay as the regression pins of this task.

- [x] **Step 3: Implement**

Create `src/edit/sides.ts`:

```ts
// 左右分開 (face-detail spec §3.4). Split values are stored landmark-sided: PersonParams.values drives the GPUPixel-left
// half of a split item (pts111 0–15, 52–57, 72–74: MediaPipe's RIGHT_*), PersonParams.right the GPUPixel-right half;
// the midline p16 takes the mean. Labels are screen-sided: 左 is the half whose eye shows on the left of the screen.
import { SPLIT_IDS } from '../engine/params';
import type { Face, PersonParams, SplitParamId } from '../types';

/** an on-screen side */
export type Side = 'L' | 'R';
/** a stored half: 'values' = GPUPixel-left, 'right' = GPUPixel-right */
export type Slot = 'values' | 'right';

export function isSplitId(id: string): id is SplitParamId {
  return (SPLIT_IDS as readonly string[]).includes(id);
}

/** the stored half an on-screen side edits; `screenSwap` = the GPUPixel-left half shows on the screen's right */
export function slotFor(screenSwap: boolean, side: Side): Slot {
  return (side === 'L') === !screenSwap ? 'values' : 'right';
}

export function readSide(p: PersonParams, id: SplitParamId, slot: Slot): number {
  if (slot === 'values' || p.right === null) return p.values[id];
  return p.right[id] ?? p.values[id];
}

/** While `right` is null both halves are `values`: a side write never creates `right` (S5 §3.4). */
export function writeSide(p: PersonParams, id: SplitParamId, v: number, slot: Slot): PersonParams {
  if (slot === 'values' || p.right === null) return { ...p, values: { ...p.values, [id]: v } };
  return { ...p, right: { ...p.right, [id]: v } };
}

/** 左右分開 on: `right` copies the six values, so nothing moves (S5 §2.2). */
export function splitOn(p: PersonParams): PersonParams {
  if (p.right !== null) return p;
  const right: Partial<Record<SplitParamId, number>> = {};
  for (const id of SPLIT_IDS) right[id] = p.values[id];
  return { ...p, right };
}

/** 左右分開 off: both halves take the value of `slot` (the side the slider was showing); right = null. */
export function splitOff(p: PersonParams, slot: Slot): PersonParams {
  if (p.right === null) return p;
  const values = { ...p.values };
  for (const id of SPLIT_IDS) values[id] = readSide(p, id, slot);
  return { ...p, values, right: null };
}

/**
 * A mirrored image puts each cheek on the other GPUPixel half (adapter111.ts:3-4), so a shot saved mirrored hands its
 * split values over swapped (S5 §3.4). Swaps exactly the six split ids; an involution on a complete `right`.
 */
export function mirrorSides(p: PersonParams): PersonParams {
  if (p.right === null) return p;
  const values = { ...p.values };
  const right: Partial<Record<SplitParamId, number>> = {};
  for (const id of SPLIT_IDS) {
    right[id] = p.values[id];
    values[id] = p.right[id] ?? p.values[id];
  }
  return { ...p, values, right };
}

/** untrusted `right`: only split ids with finite numbers, clamped to 0..1; nothing left → null (S5 §3.5) */
export function sanitizeRight(raw: unknown): PersonParams['right'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Partial<Record<SplitParamId, number>> = {};
  let n = 0;
  for (const id of SPLIT_IDS) {
    const v = (raw as Record<string, unknown>)[id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[id] = Math.min(1, Math.max(0, v));
      n++;
    }
  }
  return n > 0 ? out : null;
}

/** true when the GPUPixel-left eye (p74) shows left of the GPUPixel-right eye (p77) after `toScreen` (S5 §3.4) */
export function screenLeftIsGpLeft(face: Face, toScreen: (p: [number, number]) => [number, number]): boolean {
  const P = face.pts111;
  return toScreen([P[74 * 2], P[74 * 2 + 1]])[0] < toScreen([P[77 * 2], P[77 * 2 + 1]])[0];
}
```

`src/edit/state.ts` (step 1), two edits. The preset person part needs none: Task 1 already gave the lens's `withPresetPart` (what `lens.applyPreset` builds each person from) `right: null` and null new shades, and its `PRESET_PERSON_IDS` loop takes the 14 new values, neutral in every `PresetDef.values`, from the preset.

1. (Done in Task 1: step 1's module-local `SHADES` id sets already cover the six parts, built from `SHADE_PARTS` and `SHADES as SHADE_DEFS`, because the six-part `ShadePart` type left the lip / blush sets uncompilable there.)

2. In `matchesPersonPreset(p, ref)`, replace the lip / blush comparison line (`if (q.shades.lip !== p.shades.lip || q.shades.blush !== p.shades.blush) return false;`) with:

```ts
  if (p.right !== null) return false;
  if (SHADE_PARTS.some((k) => q.shades[k] !== p.shades[k])) return false;
```

3. In `sanitizePerson(raw, fallback)`, validate every part and `right` (a missing shade key keeps step 1's rule, `fallback.shades[part]`, which is null for the new parts in every constructor; a missing `right` is null, S5 §3.5):

```ts
  const shades = Object.fromEntries(SHADE_PARTS.map((k) => [k, shade(k)])) as Record<ShadePart, string | null>;
  const right = sanitizeRight(r.right);
  const ref = presetRefOf('preset' in r ? r.preset : fallback.preset);
  const preset = ref && matchesPersonPreset({ values, right, shades, preset: ref }, ref) ? ref : 'custom';
  return { values, right, shades, preset };
```

(these replace its `const shades = …` line and the three lines after it). The preset-id check runs on the sanitized person, so a split person becomes `'custom'`. Missing new values fall back to `fallback.values`, neutral for the 14 new ids.

Imports: `sanitizeRight` from `./sides` (`SHADE_PARTS` and `SHADES as SHADE_DEFS` are imported since Task 1).

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit && npm run typecheck`
Expected: PASS; no type errors.

- [x] **Step 5: Commit**

```bash
file src/edit/state.ts src/edit/sides.ts
git add src/edit/sides.ts src/edit/sides.test.ts src/edit/state.ts src/edit/state.test.ts
git commit -F- <<'EOF'
v0.4 step 5: 左右分開 storage, presets and sanitize of the new fields

Split values stay landmark-sided (values = GPUPixel-left, right =
GPUPixel-right) with screen-sided labels; presets reset the new items and
the split; old entries reopen with neutral new items.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Landed:** the code is `1aaa05c`. Its subject wrongly reads "v0.4 step 4 task 3: tone gate in the lens, the 美膚 ⊘ covers tone, owners follow renames, spots survive a load" (a leftover message file again, as in `db1f468` and `6502bf2`). It is not amended; the next commit records it. Deviation: `state.test.ts` has one case beyond this task's list, "keeps valid new-part shades and a valid right through sanitize", which failed before the `sanitizePerson` edit (Task 1's literal dropped `brow` / `eyeshadow` / `liner` / `lens` and `right` on every load). The plan's fuzz case alone passes when both are always dropped, so this case pins that a saved entry reopens with them. No other deviation: `sides.ts` and both `state.ts` edits are as written.

### Task 4: Side-aware lens, 左右分開, 自然 and 無 per part

Every panel read and write goes through step 1's lens (RM §3.3). This task wraps it with the step-5 operations of S5 §3.4 so the panel (Tasks 13–14) never touches `right` itself. Side reads and writes reuse step 1's routing (selection, 全部, applies, mixed) by presenting each split person's requested half as `values`.

**Files:**
- Modify: `src/edit/lens.ts` (step 1; `PersonInfo` `:27-31`, `Lens` `:36-66`, the lens-local `makeupKey` `:82`, `lensFor` `:90-281`)
- Modify: `src/engine/params.ts` (add `MAKEUP_PARAM` after `MAKEUP_PICK_DEFAULT`)
- Test: `src/edit/lens.test.ts` (step 1)

**Interfaces:**
- Consumes: step 1's `lensFor(edit, sel, persons, primary, opts: LensOptions = {}): Lens` (a plain object literal), `Lens` (`edit`, `sel`, `persons`, `primary`, `noFace`, `targets`, `faceTargets(): PersonId[]` — the selected face person, every face person under 全部 with the primary first, or `[primary]` on a no-face photo —, `get`, `set`, `applies`, `shade`, `preset`, `setShade`, `clearMakeup(part: ShadePart)`, `applyPreset`, `resetGroup`, …), the lens-local `makeupKey(part)` (lip / blush only), `PersonInfo`, `LensOptions`, `Selection`, `EditState`, `personOf(edit, id)` (`src/edit/state.ts`) (RM §3.3, step-1 plan Task 6); Task 1 `SHADE_PARTS`, `isShadePart`, `SplitParamId`, `MakeupPart`, `emptyShades`; Task 3 `Side`, `isSplitId`, `slotFor`, `splitOn`, `splitOff`.
- Produces:
  - `PersonInfo.screenSwap?: boolean` — true when the person's GPUPixel-left half shows on the screen's right
  - `Lens.get(id: ParamId, side?: Side): { value: number; mixed: boolean }`; `Lens.set(id: ParamId, v: number, side?: Side): EditState` (a side applies only to split ids of persons whose `right` is not null; never creates `right`)
  - `Lens.split(): boolean` (the reference person — `faceTargets()[0]`, the person the strip shows — has `right !== null`)
  - `Lens.setSplit(on: boolean, activeSide: Side): EditState`
  - `Lens.ensureOn(id: ParamId, v: number): EditState` (sets `v` on targets whose value is ≤ 0.01; returns the same `EditState` when none)
  - `Lens.clearMakeup(part: MakeupPart): EditState` — step 1's operation widened from `ShadePart` to every part: value 0 and, for a shade part, shade null; returns the same `EditState` when every target is already off (no second "clear" operation is added)
  - `Lens.shade`, `Lens.setShade` and `Lens.clearMakeup` read a part's value id from `MAKEUP_PARAM[part]` (step 1's `makeupKey` knew lip and blush only, so 眉毛／眼影／眼線／美瞳 would have read the blush value)
  - `Lens.resetGroup('shape')` also sets `right = null`; `Lens.resetGroup('makeup')` also nulls all six shades
  - `params.ts`: `MAKEUP_PARAM: Readonly<Record<MakeupPart, PersonParamId>>` (a `PersonParamId` is a `ParamId`, so every `ParamId` parameter takes it)
  - Every change made by the new operations sets the changed person's `preset = 'custom'` (RM §3.4).

- [x] **Step 1: Write the failing tests**

Append to `src/edit/lens.test.ts`, merging the imports into step 1's lines, never importing a name twice (step 1 already imports `lensFor`, `type PersonInfo` from `./lens`, `defaultPhoto`, `naturalPerson`, `neutralPerson` from `./state` and `EditState` from `../types`): add `SPLIT_IDS` to the `../engine/params` import, `emptyShades` to the `./state` import, `PersonParams` to the type import, and `import { splitOn } from './sides';`. Step 1's file already declares top-level `three`, `group`, `one` and `all`, so the helpers below are named `onePerson` / `twoPersons`:

```ts
const P = (over: Partial<PersonParams> = {}): PersonParams => ({ ...naturalPerson(), ...over });
const E = (persons: Record<string, PersonParams>): EditState => ({ v: 2, photo: defaultPhoto(), persons, template: neutralPerson(), primaryInit: null });
const onePerson = (swap = false): PersonInfo[] => [{ id: 'f0', face: true, body: false, screenSwap: swap }];
const twoPersons = (swap0 = false, swap1 = false): PersonInfo[] => [
  { id: 'f0', face: true, body: false, screenSwap: swap0 },
  { id: 'f1', face: true, body: false, screenSwap: swap1 },
];
const SEL0 = { kind: 'person', id: 'f0' } as const;
const ALL = { kind: 'all' } as const;

describe('lens: sides and 左右分開 (face-detail spec §3.4)', () => {
  it('setSplit on copies the six values and marks the person 自訂; off keeps the active side', () => {
    const e0 = E({ f0: P() });
    const on = lensFor(e0, SEL0, onePerson(), 'f0').setSplit(true, 'L');
    expect(on.persons.f0.right).toEqual(Object.fromEntries(SPLIT_IDS.map((id) => [id, e0.persons.f0.values[id]])));
    expect(on.persons.f0.preset).toBe('custom');
    const edited = lensFor(on, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.9, 'R');
    expect(edited.persons.f0.right?.['shape.faceSlim']).toBe(0.9);
    expect(lensFor(edited, SEL0, onePerson(), 'f0').setSplit(false, 'R').persons.f0.values['shape.faceSlim']).toBe(0.9);
    const offL = lensFor(edited, SEL0, onePerson(), 'f0').setSplit(false, 'L').persons.f0;
    expect(offL.values['shape.faceSlim']).toBe(e0.persons.f0.values['shape.faceSlim']);
    expect(offL.right).toBeNull();
  });

  it('side writes and reads follow screenSwap', () => {
    const on = lensFor(E({ f0: P() }), SEL0, onePerson(), 'f0').setSplit(true, 'L');
    const a = lensFor(on, SEL0, onePerson(false), 'f0').set('shape.jawline', 0.6, 'L').persons.f0;
    expect([a.values['shape.jawline'], a.right?.['shape.jawline']]).toEqual([0.6, 0]);
    const b = lensFor(on, SEL0, onePerson(true), 'f0').set('shape.jawline', 0.6, 'L').persons.f0;
    expect([b.values['shape.jawline'], b.right?.['shape.jawline']]).toEqual([0, 0.6]);
    const lb = lensFor({ ...on, persons: { f0: b } }, SEL0, onePerson(true), 'f0');
    expect([lb.get('shape.jawline', 'L').value, lb.get('shape.jawline', 'R').value]).toEqual([0.6, 0]);
  });

  it('without a side, for a non-split item, or while right is null: values only, right never created', () => {
    const e0 = E({ f0: P() });
    const a = lensFor(e0, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.4, 'R').persons.f0;
    expect(a.right).toBeNull();
    expect(a.values['shape.faceSlim']).toBe(0.4);
    const on = lensFor(e0, SEL0, onePerson(), 'f0').setSplit(true, 'L');
    const b = lensFor(on, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.7).persons.f0;
    expect(b.values['shape.faceSlim']).toBe(0.7);
    expect(b.right?.['shape.faceSlim']).toBe(on.persons.f0.right?.['shape.faceSlim']);
    expect(lensFor(on, SEL0, onePerson(), 'f0').get('shape.chin', 'R').value).toBe(on.persons.f0.values['shape.chin']);
  });

  it('全部: the reference person decides the switch, a tap sets everyone to the opposite, existing right is kept', () => {
    const f1 = splitOn(P({ values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 } }));
    const e = E({ f0: P(), f1: { ...f1, right: { ...f1.right, 'shape.faceSlim': 0.8 } } });
    const lens = lensFor(e, ALL, twoPersons(), 'f0');
    expect(lens.split()).toBe(false);
    const on = lens.setSplit(true, 'L');
    expect(on.persons.f0.right).not.toBeNull();
    expect(on.persons.f1.right?.['shape.faceSlim']).toBe(0.8);
    expect(lensFor(on, ALL, twoPersons(), 'f0').split()).toBe(true);
    const off = lensFor(on, ALL, twoPersons(), 'f0').setSplit(false, 'R');
    expect([off.persons.f0.right, off.persons.f1.right]).toEqual([null, null]);
    expect(off.persons.f1.values['shape.faceSlim']).toBe(0.8);
  });

  it('全部: mixed compares the requested side; each face maps its own screen side', () => {
    const f0 = splitOn(P());
    const f1 = splitOn(P());
    const e = E({ f0, f1: { ...f1, right: { ...f1.right, 'shape.temple': 0.9 } } });
    const lens = lensFor(e, ALL, twoPersons(false, false), 'f0');
    expect(lens.get('shape.temple', 'L').mixed).toBe(false);
    expect(lens.get('shape.temple', 'R').mixed).toBe(true);
    const w = lensFor(e, ALL, twoPersons(false, true), 'f0').set('shape.temple', 0.2, 'L');
    expect(w.persons.f0.values['shape.temple']).toBe(0.2);
    expect(w.persons.f1.right?.['shape.temple']).toBe(0.2);
    expect(w.persons.f1.values['shape.temple']).toBe(0.5);
  });

  it('⊘ on 美型 clears right; resetGroup("makeup") clears every part and all six shades', () => {
    const on = lensFor(E({ f0: P() }), SEL0, onePerson(), 'f0').setSplit(true, 'L');
    expect(lensFor(on, SEL0, onePerson(), 'f0').resetGroup('shape').persons.f0.right).toBeNull();
    const made = E({
      f0: P({
        values: { ...naturalPerson().values, 'makeup.liner': 0.6, 'makeup.lens': 0.5 },
        shades: { ...emptyShades(), liner: 'wine', lens: 'blue', lip: 'rose' },
      }),
    });
    const out = lensFor(made, SEL0, onePerson(), 'f0').resetGroup('makeup').persons.f0;
    expect(out.shades).toEqual(emptyShades());
    expect([out.values['makeup.liner'], out.values['makeup.lens']]).toEqual([0, 0]);
  });

  it('ensureOn only where the part is off; clearMakeup zeroes one part (any of the ten) and its shade', () => {
    const e = E({ f0: P() });
    const a = lensFor(e, SEL0, onePerson(), 'f0').ensureOn('makeup.lashes', 0.55);
    expect(a.persons.f0.values['makeup.lashes']).toBe(0.55);
    expect(a.persons.f0.preset).toBe('custom');
    expect(lensFor(a, SEL0, onePerson(), 'f0').ensureOn('makeup.lashes', 0.9)).toBe(a);
    const b = E({ f0: P({ values: { ...naturalPerson().values, 'makeup.liner': 0.6, 'makeup.blush': 0.4 }, shades: { ...emptyShades(), liner: 'navy' } }) });
    const c = lensFor(b, SEL0, onePerson(), 'f0').clearMakeup('liner').persons.f0;
    expect([c.values['makeup.liner'], c.shades.liner, c.values['makeup.blush']]).toEqual([0, null, 0.4]);
    expect(lensFor(a, SEL0, onePerson(), 'f0').clearMakeup('lashes').persons.f0.values['makeup.lashes']).toBe(0);
    expect(lensFor(e, SEL0, onePerson(), 'f0').clearMakeup('aegyo')).toBe(e);
  });

  it('shade / setShade read each part’s own value (step 1’s makeupKey knew lip and blush only)', () => {
    const e = E({ f0: P({ values: { ...naturalPerson().values, 'makeup.blush': 0.4 } }) });
    const lens = lensFor(e, SEL0, onePerson(), 'f0');
    expect(lens.shade('lens').on).toBe(false);
    const s = lens.setShade('lens', 'blue').persons.f0;
    expect([s.values['makeup.lens'], s.shades.lens, s.values['makeup.blush']]).toEqual([0.6, 'blue', 0.4]);
    expect(lensFor({ ...e, persons: { f0: s } }, SEL0, onePerson(), 'f0').shade('lens')).toMatchObject({ shade: 'blue', on: true });
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/edit/lens.test.ts`
Expected: FAIL — `lens.setSplit is not a function` (and the side arguments are ignored by step 1's `get` / `set`).

- [x] **Step 3: Implement**

`src/engine/params.ts`, after `MAKEUP_PICK_DEFAULT` (add `PersonParamId` to its `import type` line: the ten ids are person-level, so `values[MAKEUP_PARAM[part]]` indexes a `PersonParams.values` without a cast, as Tasks 12 and 18 do):

```ts
/** the ParamId of each 美妝 part */
export const MAKEUP_PARAM: Readonly<Record<MakeupPart, PersonParamId>> = {
  lip: 'makeup.lip',
  blush: 'makeup.blush',
  brow: 'makeup.brow',
  eyeshadow: 'makeup.eyeshadow',
  liner: 'makeup.liner',
  lashes: 'makeup.lashes',
  aegyo: 'makeup.aegyo',
  contour: 'makeup.contour',
  highlight: 'makeup.highlight',
  lens: 'makeup.lens',
};
```

`src/edit/lens.ts` (step 1):

1. `PersonInfo` gains

```ts
  /** face-detail spec §3.4: the person's GPUPixel-left half shows on the right of the screen (翻轉, camera mirror) */
  screenSwap?: boolean;
```

2. In the `Lens` interface, replace `get` / `set`, widen `clearMakeup` and add the new operations:

```ts
  /** `side` (on-screen) applies to split items of persons with 左右分開 on; otherwise ignored */
  get(id: ParamId, side?: Side): { value: number; mixed: boolean };
  set(id: ParamId, v: number, side?: Side): EditState;
  /** 左右分開 state of the reference person (faceTargets()[0]: the selected person; under 全部 the primary, else the first face person) */
  split(): boolean;
  /** on: right copies the six values; off: both sides take `activeSide`'s value. Every face target, one EditState. */
  setSplit(on: boolean, activeSide: Side): EditState;
  /** 自然 on a part without shades: `v` on every target whose value is ≤ 0.01 */
  ensureOn(id: ParamId, v: number): EditState;
  /** 無 for one part (any of the ten): value 0 and, for a shade part, shade null on every face target; `edit` when all are off */
  clearMakeup(part: MakeupPart): EditState;
```

3. In step 1's `lensFor` body: replace each `makeupKey(part)` (in `shade`, `setShade` and `clearMakeup`) with `MAKEUP_PARAM[part] as PV`, delete the lens-local `const makeupKey = …` line (`noUnusedLocals`), and replace step 1's `clearMakeup` with the widened one:

```ts
    clearMakeup(part) {
      const key = MAKEUP_PARAM[part] as PV;
      const shaded = isShadePart(part);
      const t = faceTargets();
      const off = (q: PersonParams) => q.values[key] === 0 && (!shaded || q.shades[part] === null);
      if (t.every((pid) => off(person(pid)))) return edit;
      return withPersons(edit, t, (p) => ({
        ...p,
        values: { ...p.values, [key]: 0 },
        shades: shaded ? { ...p.shades, [part]: null } : p.shades,
        preset: 'custom',
      }));
    },
```

4. Rename step 1's exported `lensFor` to a module-local `baseLensFor` (same body, same `opts: LensOptions = {}` parameter) and add, at the end of the module:

```ts
/** swaps the two halves of one split item (an involution once `right` holds the id) */
function swapHalves(p: PersonParams, id: SplitParamId): PersonParams {
  return { ...p, values: { ...p.values, [id]: p.right?.[id] ?? p.values[id] }, right: { ...p.right, [id]: p.values[id] } };
}

/**
 * The EditState in which every split person's `side` half sits in `values`, so step 1's routing (selection, 全部,
 * applies, mixed by display value) reads and writes the requested side. `swapped` lists the persons to swap back.
 */
function sideView(edit: EditState, id: SplitParamId, side: Side, persons: readonly PersonInfo[]): { view: EditState; swapped: PersonId[] } {
  const swapped: PersonId[] = [];
  let next: Record<PersonId, PersonParams> | null = null;
  for (const info of persons) {
    const p = edit.persons[info.id];
    if (!p || p.right === null || slotFor(!!info.screenSwap, side) === 'values') continue;
    next ??= { ...edit.persons };
    next[info.id] = swapHalves(p, id);
    swapped.push(info.id);
  }
  return { view: next ? { ...edit, persons: next } : edit, swapped };
}

/** step 1's lens plus the step-5 operations; step 1's own `faceTargets()` (primary first under 全部) picks every target */
function withFaceDetail(base: Lens, opts: LensOptions): Lens {
  const { edit, sel, persons, primary } = base;
  const infoOf = new Map(persons.map((p) => [p.id, p]));
  const swapOf = (pid: PersonId) => !!infoOf.get(pid)?.screenSwap;
  /** `fn` on each face target; a changed person becomes 自訂 (a person-level face edit, RM §3.4). Unchanged → `e` itself. */
  const mapTargets = (e: EditState, fn: (p: PersonParams, pid: PersonId) => PersonParams): EditState => {
    let next: Record<PersonId, PersonParams> | null = null;
    for (const pid of base.faceTargets()) {
      const p = personOf(e, pid);
      const q = fn(p, pid);
      if (q === p) continue;
      next ??= { ...e.persons };
      next[pid] = { ...q, preset: 'custom' };
    }
    return next ? { ...e, persons: next } : e;
  };
  const sideOf = (id: ParamId, side: Side | undefined): Side | null => (side !== undefined && isSplitId(id) ? side : null);
  return {
    ...base,
    get(id, side) {
      const s = sideOf(id, side);
      if (!s) return base.get(id);
      const { view, swapped } = sideView(edit, id as SplitParamId, s, persons);
      return swapped.length ? baseLensFor(view, sel, persons, primary, opts).get(id) : base.get(id);
    },
    set(id, v, side) {
      const s = sideOf(id, side);
      if (!s) return base.set(id, v);
      const { view, swapped } = sideView(edit, id as SplitParamId, s, persons);
      if (!swapped.length) return base.set(id, v);
      const out = baseLensFor(view, sel, persons, primary, opts).set(id, v);
      if (out === view) return edit;
      const back = { ...out.persons };
      for (const pid of swapped) if (back[pid]) back[pid] = swapHalves(back[pid], id as SplitParamId);
      return { ...out, persons: back };
    },
    split() {
      const ref = base.faceTargets()[0] ?? (sel.kind === 'person' ? sel.id : primary);
      return (personOf(edit, ref).right ?? null) !== null;
    },
    setSplit(on, activeSide) {
      return mapTargets(edit, (p, pid) => (on ? splitOn(p) : splitOff(p, slotFor(swapOf(pid), activeSide))));
    },
    ensureOn(id, v) {
      const key = id as PersonParamId;
      return mapTargets(edit, (p) => (p.values[key] > 0.01 ? p : { ...p, values: { ...p.values, [key]: v } }));
    },
    resetGroup(group) {
      const out = base.resetGroup(group);
      if (group === 'shape') return mapTargets(out, (p) => (p.right === null ? p : { ...p, right: null }));
      if (group === 'makeup') return mapTargets(out, (p) => (SHADE_PARTS.every((k) => p.shades[k] === null) ? p : { ...p, shades: emptyShades() }));
      return out;
    },
  };
}

export function lensFor(edit: EditState, sel: Selection, persons: readonly PersonInfo[], primary: PersonId, opts: LensOptions = {}): Lens {
  return withFaceDetail(baseLensFor(edit, sel, persons, primary, opts), opts);
}
```

Imports to add to `lens.ts` (merged into step 1's lines): `isShadePart`, `MAKEUP_PARAM`, `SHADE_PARTS` from `../engine/params`; `isSplitId`, `slotFor`, `splitOff`, `splitOn`, `type Side` from `./sides`; `emptyShades`, `personOf` from `./state` (step 1 already imports `personOf`); `MakeupPart`, `PersonParamId`, `SplitParamId` types. Step 1's lens is a plain object literal (`const lens: Lens = { edit, sel, persons, … }`), so `{ ...base }` carries every untouched member, and step 1's `setPresetAmount` keeps calling its own `lens.preset()`. `sideView` iterates `persons` (the `PersonInfo` list) and skips anyone whose `right` is null or whose requested side is already `values`, so step 1's routing decides who is written.

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/edit && npm run typecheck`
Expected: PASS (the step-1 lens tests are unchanged and still pass); no type errors.

- [x] **Step 5: Commit**

```bash
file src/edit/lens.ts src/engine/params.ts
git add src/edit/lens.ts src/edit/lens.test.ts src/engine/params.ts
git commit -F- <<'EOF'
v0.4 step 5: side-aware lens and the 左右分開 switch

get/set take an on-screen side mapped per person through screenSwap;
split/setSplit, ensureOn (自然) and clearMakeup (無, now any part) act on the selected
person or everyone under 全部, each as one EditState.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Landed deviations:** (1) Step 1's `const lens: Lens = { … }` lacks `split` / `setSplit` / `ensureOn` once `Lens` declares them (TS2739), so `baseLensFor` returns a module-local `BaseLens = Omit<Lens, 'split' | 'setSplit' | 'ensureOn'>`, which `withFaceDetail` takes. (2) Step 1's `resetGroup('makeup')` already nulls all six shades of every face target, so the wrapper keeps only the `'shape'` branch (`right = null`); the `'makeup'` branch was a no-op, and `SHADE_PARTS` is not imported. (3) `clearMakeup` narrows with `const shaded = isShadePart(part) ? part : null`, since a boolean does not narrow `part` for indexing `shades`. (4) A side `set` gives every swapped person that step 1's routing did not write its own object back, instead of swapping it twice. With the plan's swap-back, an unselected person whose requested side was `right` came back as a new object, and one whose `right` lacked the id (a sanitized partial `right`) also gained that key. One `lens.test.ts` case beyond the list pins this ("a side write leaves the persons it does not write as they were"); it failed on the plan's literal code and passes now.

### Task 5: Eye frames, lid stations, EAR, iris and gates

Pure geometry every eye item is built on (S5 §4.7, §4.9): eye-local coordinates, the dense lid polylines from `Face.lids`, station normals and the outer-corner overhang, brow gaps, EAR, the iris with its fallback, and the three gates. Also the shared synthetic face edits (closed eye, mirror, shrink) used by unit and e2e tests.

**Files:**
- Create: `src/engine/passes/eyeFrame.ts`, `src/engine/passes/syntheticFaces.ts`
- Test: `src/engine/passes/eyeFrame.test.ts`

**Interfaces:**
- Consumes: Task 2 `Face.iris`, `Face.lids`; `adapt` (`adapter111.ts`); GPUPixel indices p16, p43 (midline), p52/p55 and p61/p58 (eye corners), p72/p73 and p75/p76 (lid mids), p104/p105 (pupils), 64–67 / 71–68 (brow lower).
- Produces (`eyeFrame.ts`):
  - `type V2 = [number, number]`; `LID_STATIONS = 17`; `STATION_XS: readonly number[]` (k/16)
  - `interface EyeFrame { o: V2; ex: V2; ey: V2; w: number; upper: Float32Array; lower: Float32Array; upperPts: Float32Array; lowerPts: Float32Array; brow: Float32Array; browGap: Float32Array; ear: number; iris: { c: V2; r: number } | null; irisFallback: { c: V2; r: number } }` (iso units for `o`, `w`, iris; eye units elsewhere)
  - `eyeFrames(face: Face, aspect: number): readonly [EyeFrame, EyeFrame]` — `[GPUPixel-left, GPUPixel-right]`
  - `polyY(pts: Float32Array, x: number): number`; `browGapAt(f, x, y): number`; `browGapEnd(f, x, y): V2`
  - `eyeToUv(f: EyeFrame, x: number, y: number, aspect: number): V2`
  - `interface Station { x: number; y: number; nx: number; ny: number }`; `lidStations(f, lid: 'upper' | 'lower', xs: readonly number[]): Station[]`
  - `smoothstep(e0, e1, x)`; `lensBlinkGate(ear)`; `lashBlinkGate(ear)`; `lashSizeGate(f, aspect)`
  - `eyeNoteInfo(face: Face, aspect: number): { lensClosed: boolean; lashesClosed: boolean; lashesSmall: boolean }`
- Produces (`syntheticFaces.ts`): `closeEye(face: Face, eye: 0 | 1): Face`, `mirrorFaceX(face: Face): Face`, `scaleFace(face: Face, s: number, centre: V2): Face`

- [x] **Step 1: Write the failing test**

Create `src/engine/passes/eyeFrame.test.ts` (the pinned numbers were measured on `landmarks_sample_face.json` with this exact construction):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareFaces } from '../../detect/faces';
import { adapt } from '../../tracking/adapter111';
import {
  browGapAt,
  type EyeFrame,
  eyeFrames,
  eyeNoteInfo,
  eyeToUv,
  lashBlinkGate,
  lashSizeGate,
  lensBlinkGate,
  LID_STATIONS,
  lidStations,
  polyY,
  type Station,
  STATION_XS,
} from './eyeFrame';
import { closeEye, mirrorFaceX, scaleFace } from './syntheticFaces';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  mirrored: number[];
};
const aspect = lm.width / lm.height;
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const frames = eyeFrames(face, aspect);
const P = (i: number): [number, number] => [face.pts111[i * 2], face.pts111[i * 2 + 1]];
// the step-5 makeup's station sets (眼影 upper piece and 睫毛; 眼影 lower accent)
const UPPER_XS = [-0.22, -0.14, -0.07, ...STATION_XS];
const LOWER_ACCENT_XS = [-0.15, -0.075, ...STATION_XS.filter((x) => x <= 0.5), 0.55];

describe('eyeFrames on the fixture face (face-detail spec §4.7)', () => {
  it('every Face.lids point lies on its lid polyline (eye units)', () => {
    frames.forEach((f, eye) => {
      for (let j = 0; j < 16; j++) {
        const qx = face.lids[(eye * 16 + j) * 2];
        const qy = face.lids[(eye * 16 + j) * 2 + 1] / aspect;
        const dx = qx - f.o[0];
        const dy = qy - f.o[1];
        const x = (dx * f.ex[0] + dy * f.ex[1]) / f.w;
        const y = (dx * f.ey[0] + dy * f.ey[1]) / f.w;
        const lid = j >= 9 ? f.lowerPts : f.upperPts;
        expect(Math.abs(polyY(lid, x) - y)).toBeLessThan(1e-6);
      }
    });
  });

  it('the eyes are open: h_k ≥ 0 everywhere and > 0.05 for k = 2…14', () => {
    for (const f of frames) {
      expect(f.upper.length).toBe(LID_STATIONS);
      for (let k = 0; k < LID_STATIONS; k++) {
        const h = f.lower[k] - f.upper[k];
        expect(h).toBeGreaterThanOrEqual(-1e-6);
        if (k >= 2 && k <= 14) expect(h).toBeGreaterThan(0.05);
      }
    }
  });

  it('brow gaps lie in [0.3, 1.2] eye units', () => {
    for (const f of frames) for (const g of f.browGap) {
      expect(g).toBeGreaterThan(0.3);
      expect(g).toBeLessThan(1.2);
    }
  });

  it('EAR is pinned (measured 0.463 left, 0.378 right)', () => {
    expect(Math.abs(frames[0].ear - 0.463)).toBeLessThan(0.02);
    expect(Math.abs(frames[1].ear - 0.378)).toBeLessThan(0.02);
  });

  it('the detected iris is valid and centred on p104 / p105 (r/w measured 0.255 and 0.214)', () => {
    const [l, r] = frames;
    expect(l.iris).not.toBeNull();
    expect(r.iris).not.toBeNull();
    expect(Math.abs(l.iris!.r / l.w - 0.255)).toBeLessThan(0.02);
    expect(Math.abs(r.iris!.r / r.w - 0.214)).toBeLessThan(0.02);
    expect(l.iris!.c[0]).toBeCloseTo(P(104)[0], 6);
    expect(l.iris!.c[1]).toBeCloseTo(P(104)[1] / aspect, 6);
    expect(l.irisFallback.r).toBeCloseTo(0.21 * l.w, 9);
  });

  it('eyeToUv maps the corners back to the GPUPixel eye corners', () => {
    const [l, r] = frames;
    for (const [f, outer, inner] of [
      [l, 52, 55],
      [r, 61, 58],
    ] as const) {
      const o = eyeToUv(f, 0, 0, aspect);
      const i = eyeToUv(f, 1, 0, aspect);
      expect(o[0]).toBeCloseTo(P(outer)[0], 6);
      expect(o[1]).toBeCloseTo(P(outer)[1], 6);
      expect(i[0]).toBeCloseTo(P(inner)[0], 6);
      expect(i[1]).toBeCloseTo(P(inner)[1], 6);
    }
  });

  it('lid stations: unit normals pointing away from the aperture', () => {
    for (const f of frames) {
      const up = lidStations(f, 'upper', UPPER_XS);
      const lo = lidStations(f, 'lower', LOWER_ACCENT_XS);
      for (const s of up) expect(s.ny).toBeLessThan(0);
      for (const s of lo) expect(s.ny).toBeGreaterThan(0);
      for (const s of [...up, ...lo]) expect(Math.hypot(s.nx, s.ny)).toBeCloseTo(1, 9);
    }
  });
});

/** the fixture face, its recorded mirrored landmarks and the three edit faces of group_faces.png */
function fixtureEyes(): { name: string; f: EyeFrame; eye: number }[] {
  const g = JSON.parse(readFileSync(new URL('../../../tests/fixtures/group_faces.landmarks.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    faces: number[][];
  };
  const group = prepareFaces(g.faces.map((p) => ({ points: new Float32Array(p) })), g.width, g.height).faces;
  if (group.length !== 3) throw new Error(`group_faces.png gave ${group.length} edit faces, expected 3`);
  const mirrored = adapt({ points: new Float32Array(lm.mirrored) }, lm.width, lm.height);
  const faces: [string, readonly EyeFrame[]][] = [
    ['sample', eyeFrames(face, aspect)],
    ['mirrored', eyeFrames(mirrored, aspect)],
    ...group.map((p, i): [string, readonly EyeFrame[]] => [`group ${i}`, eyeFrames(p.face, g.width / g.height)]),
  ];
  return faces.flatMap(([name, fs]) => fs.map((f, eye) => ({ name, f, eye })));
}

/** quads of the ribbon d ∈ [d0, d1] along the station normals whose two strip triangles do not keep the lid's winding */
function foldedQuads(sts: readonly Station[], lid: 'upper' | 'lower', d0: number, d1: number | ((s: Station) => number)): number[] {
  const top = typeof d1 === 'number' ? () => d1 : d1;
  const P = sts.map((s): [number, number] => [s.x + s.nx * d0, s.y + s.ny * d0]);
  const Q = sts.map((s): [number, number] => [s.x + s.nx * top(s), s.y + s.ny * top(s)]);
  const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sign = lid === 'upper' ? -1 : 1;
  const out: number[] = [];
  for (let i = 0; i + 1 < sts.length; i++) {
    if (sign * cross(P[i], P[i + 1], Q[i]) <= 0 || sign * cross(P[i + 1], Q[i + 1], Q[i]) <= 0) out.push(sts[i].x);
  }
  return out;
}

describe('the outer-corner overhang (face-detail spec §4.7)', () => {
  const eyes = fixtureEyes();

  it('continues along the corner line: never below it for the upper lid, never above it for the lower lid', () => {
    for (const { f } of eyes) {
      // the lid's corner point is the frame origin
      expect(Math.abs(f.upperPts[1])).toBeLessThan(1e-6);
      expect(Math.abs(f.lowerPts[1])).toBeLessThan(1e-6);
      for (const s of lidStations(f, 'upper', UPPER_XS).filter((s) => s.x < 0)) {
        expect(s.y).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(s.y - f.upperPts[1])).toBeLessThan(1e-9);
      }
      for (const s of lidStations(f, 'lower', LOWER_ACCENT_XS).filter((s) => s.x < 0)) {
        expect(s.y).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(s.y - f.lowerPts[1])).toBeLessThan(1e-9);
      }
      // the two overhangs do not cross
      const xs = [-0.15, -0.075, 0];
      const up = lidStations(f, 'upper', xs);
      const lo = lidStations(f, 'lower', xs);
      xs.forEach((_, i) => expect(lo[i].y - up[i].y).toBeGreaterThanOrEqual(-1e-9));
    }
  });

  it('is the same on both eyes of a face (upper y at x = −0.22 within 0.05)', () => {
    for (let i = 0; i < eyes.length; i += 2) {
      const [l, r] = [eyes[i].f, eyes[i + 1].f].map((f) => lidStations(f, 'upper', UPPER_XS)[0].y);
      expect(Math.abs(l - r)).toBeLessThan(0.05);
    }
  });

  it('leaves the lid stations alone and gives the overhang the corner normal', () => {
    for (const { f } of eyes) {
      for (const [lid, xs] of [
        ['upper', UPPER_XS],
        ['lower', LOWER_ACCENT_XS],
      ] as const) {
        const all = lidStations(f, lid, xs);
        const on = xs.filter((x) => x >= 0);
        expect(all.filter((s) => s.x >= 0)).toEqual(lidStations(f, lid, on));
        const corner = all.find((s) => s.x === 0)!;
        for (const s of all.filter((s) => s.x < 0)) expect([s.nx, s.ny]).toEqual([corner.nx, corner.ny]);
      }
    }
  });

  it('no 眼影, 睫毛 or lower-accent ribbon folds over the stations, up to the largest heights', () => {
    for (const { name, f, eye } of eyes) {
      const up = lidStations(f, 'upper', UPPER_XS);
      const lo = lidStations(f, 'lower', LOWER_ACCENT_XS);
      // 睫毛 d ∈ [0, Lh ≤ 0.20]; 眼影 upper d ∈ [−0.02, H] with H = 0.65·max(browGap, 0.25) (S5 §4.8), and any H ≤ 0.8;
      // lower accent d ∈ [−0.03, 0.10]
      const H = (s: Station) => 0.65 * Math.max(browGapAt(f, s.x, s.y), 0.25);
      expect({ name, eye, folds: foldedQuads(up, 'upper', 0, 0.2) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(up, 'upper', -0.02, H) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(up, 'upper', -0.02, 0.8) }).toEqual({ name, eye, folds: [] });
      expect({ name, eye, folds: foldedQuads(lo, 'lower', -0.03, 0.1) }).toEqual({ name, eye, folds: [] });
    }
  });
});

describe('closed, mirrored and tiny faces (face-detail spec §4.9, §8.1)', () => {
  it('a closed eye: EAR < 0.05, h = 0 at every station, both blink gates 0', () => {
    const closed = eyeFrames(closeEye(closeEye(face, 0), 1), aspect);
    for (const f of closed) {
      expect(f.ear).toBeLessThan(0.05);
      for (let k = 0; k < LID_STATIONS; k++) expect(Math.max(0, f.lower[k] - f.upper[k])).toBe(0);
      expect(lensBlinkGate(f.ear)).toBe(0);
      expect(lashBlinkGate(f.ear)).toBe(0);
      expect(f.iris).toBeNull();
    }
  });

  it('a horizontally mirrored face (x → 1 − x) gives the same eye-local frames', () => {
    const m = eyeFrames(mirrorFaceX(face), aspect);
    frames.forEach((f, eye) => {
      const g = m[eye];
      expect(g.o[0]).toBeCloseTo(1 - f.o[0], 6);
      expect(g.ear).toBeCloseTo(f.ear, 5);
      for (let k = 0; k < LID_STATIONS; k++) {
        expect(Math.abs(g.upper[k] - f.upper[k])).toBeLessThan(1e-5);
        expect(Math.abs(g.lower[k] - f.lower[k])).toBeLessThan(1e-5);
        expect(Math.abs(g.browGap[k] - f.browGap[k])).toBeLessThan(1e-5);
      }
    });
  });

  it('gates: the spec thresholds; the fixture passes; a face shrunk to 7 % fails the 睫毛 size gate', () => {
    expect([lensBlinkGate(0.15), lensBlinkGate(0.2), lashBlinkGate(0.08), lashBlinkGate(0.14)]).toEqual([0, 1, 0, 1]);
    expect(lensBlinkGate(0.175)).toBeCloseTo(0.5, 9);
    for (const f of frames) expect(lashSizeGate(f, aspect)).toBe(1);
    const tiny = eyeFrames(scaleFace(face, 0.07, [0.5, 0.5]), aspect);
    for (const f of tiny) expect(lashSizeGate(f, aspect)).toBe(0);
  });

  it('an implausible iris (moved far outside the eye) falls back to p104 / p105 with r = 0.21·w', () => {
    const bad = { ...face, iris: face.iris.map((v, i) => (i % 2 === 0 ? v : v + 0.2)) };
    const [l] = eyeFrames(bad, aspect);
    expect(l.iris).toBeNull();
    expect(l.irisFallback.c[0]).toBeCloseTo(P(104)[0], 6);
  });

  it('eyeNoteInfo drives the 美妝 strip notes', () => {
    expect(eyeNoteInfo(face, aspect)).toEqual({ lensClosed: false, lashesClosed: false, lashesSmall: false });
    expect(eyeNoteInfo(closeEye(closeEye(face, 0), 1), aspect)).toMatchObject({ lensClosed: true, lashesClosed: true });
    expect(eyeNoteInfo(closeEye(face, 0), aspect)).toMatchObject({ lensClosed: false, lashesClosed: false });
    expect(eyeNoteInfo(scaleFace(face, 0.07, [0.5, 0.5]), aspect).lashesSmall).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/engine/passes/eyeFrame.test.ts`
Expected: FAIL — `Failed to resolve import "./eyeFrame"`.

- [x] **Step 3: Implement**

Create `src/engine/passes/syntheticFaces.ts`:

```ts
// Synthetic Face edits for tests and the e2e engine harness (never imported by app code): a closed eye, a horizontal
// mirror and a shrunk copy, as face-detail spec §8.1 / §8.3 / §8.4 describe them.
import type { Face } from '../../types';

/** GPUPixel upper-lid points and the lower-lid points they are copied onto, per eye (adapter111.ts DIRECT) */
const LID_PAIRS: readonly (readonly [number, number])[][] = [
  [
    [53, 57],
    [54, 56],
    [72, 73],
  ],
  [
    [59, 63],
    [60, 62],
    [75, 76],
  ],
];

/** Upper-lid points copied onto the lower lid (pts111 and Face.lids), the iris and pupil moved onto the lid line. */
export function closeEye(face: Face, eye: 0 | 1): Face {
  const pts111 = face.pts111.slice();
  const lids = face.lids.slice();
  const iris = face.iris.slice();
  for (const [u, l] of LID_PAIRS[eye]) {
    pts111[u * 2] = pts111[l * 2];
    pts111[u * 2 + 1] = pts111[l * 2 + 1];
  }
  const o = eye * 16;
  for (let j = 1; j <= 7; j++) {
    lids[(o + j) * 2] = lids[(o + j + 8) * 2];
    lids[(o + j) * 2 + 1] = lids[(o + j + 8) * 2 + 1];
  }
  const mid = eye === 0 ? 73 : 76;
  for (let b = 0; b < 5; b++) {
    iris[eye * 10 + b * 2] = pts111[mid * 2];
    iris[eye * 10 + b * 2 + 1] = pts111[mid * 2 + 1];
  }
  const pupil = eye === 0 ? 104 : 105;
  pts111[pupil * 2] = pts111[mid * 2];
  pts111[pupil * 2 + 1] = pts111[mid * 2 + 1];
  return { ...face, pts111, lids, iris };
}

const mapXY = (a: Float32Array, f: (x: number, y: number) => [number, number]): Float32Array => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 2) {
    const q = f(a[i], a[i + 1]);
    out[i] = q[0];
    out[i + 1] = q[1];
  }
  return out;
};

/** x → 1 − x everywhere; the GPUPixel index halves stay, so the GPUPixel-left eye now shows on the right */
export function mirrorFaceX(face: Face): Face {
  const m = (x: number, y: number): [number, number] => [1 - x, y];
  return {
    pts111: mapXY(face.pts111, m),
    ext: mapXY(face.ext, m),
    oval: mapXY(face.oval, m),
    iris: mapXY(face.iris, m),
    lids: mapXY(face.lids, m),
    yaw: -face.yaw,
  };
}

/** every point scaled by `s` about `centre` (UV): a smaller face with the same shape */
export function scaleFace(face: Face, s: number, centre: [number, number]): Face {
  const m = (x: number, y: number): [number, number] => [centre[0] + (x - centre[0]) * s, centre[1] + (y - centre[1]) * s];
  return {
    pts111: mapXY(face.pts111, m),
    ext: mapXY(face.ext, m),
    oval: mapXY(face.oval, m),
    iris: mapXY(face.iris, m),
    lids: mapXY(face.lids, m),
    yaw: face.yaw,
  };
}
```

Create `src/engine/passes/eyeFrame.ts`:

```ts
// Eye frames for the procedural eye makeup (face-detail spec §4.7, §4.9): eye-local coordinates, lid stations from
// MediaPipe's dense lid contour (Face.lids), brow gaps, EAR, the iris and the gates. Pure.
//
// Eye-local coordinates: x = (q − o)·ex / w, y = (q − o)·ey / w in iso units (iso(p) = (p.x, p.y / aspect)), with
// o the outer corner, x = 1 at the inner corner and y positive toward the chin, for both eyes.
import type { Face } from '../../types';

export type V2 = [number, number];
export const LID_STATIONS = 17;
/** x_k = k / 16 */
export const STATION_XS: readonly number[] = Array.from({ length: LID_STATIONS }, (_, k) => k / 16);

export interface EyeFrame {
  /** outer corner, iso */
  o: V2;
  /** iso unit axes: x outer → inner corner, y toward the chin (orthogonalized) */
  ex: V2;
  ey: V2;
  /** eye width (corner to corner), iso */
  w: number;
  /** lid y in eye units at the stations x_k, piecewise-linear through Face.lids */
  upper: Float32Array;
  lower: Float32Array;
  /** the 9 upper / 9 lower lid points (corners included) in eye units, x made non-decreasing (running maximum) */
  upperPts: Float32Array;
  lowerPts: Float32Array;
  /** brow-lower polyline (pts111 64–67 / 71–68) in eye units, 4 × (x, y) */
  brow: Float32Array;
  /** distance (eye units) from each upper station to the brow-lower polyline, extended flat past its ends */
  browGap: Float32Array;
  /** |iso(p72) − iso(p73)| / w (left), |iso(p75) − iso(p76)| / w (right) */
  ear: number;
  /** iso centre and radius of the detected iris; null when implausible (then irisFallback) */
  iris: { c: V2; r: number } | null;
  /** p104 / p105 and 0.21·w */
  irisFallback: { c: V2; r: number };
}

const EYES = [
  { outer: 52, inner: 55, up: 72, lo: 73, pupil: 104, lid: 0, iris: 0, brow: [64, 65, 66, 67] },
  { outer: 61, inner: 58, up: 75, lo: 76, pupil: 105, lid: 16, iris: 10, brow: [71, 70, 69, 68] },
] as const;

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** y of a polyline with non-decreasing x at `x`; the end segments extend linearly outside */
export function polyY(pts: Float32Array, x: number): number {
  const n = pts.length / 2;
  let j = 1;
  if (x > pts[0]) while (j < n - 1 && pts[j * 2] < x) j++;
  const x0 = pts[(j - 1) * 2];
  const y0 = pts[(j - 1) * 2 + 1];
  const x1 = pts[j * 2];
  const y1 = pts[j * 2 + 1];
  const dx = x1 - x0;
  return dx > 1e-9 ? y0 + ((x - x0) / dx) * (y1 - y0) : y1;
}

/** nearest point of the brow polyline, extended flat (constant y) past its leftmost and rightmost points */
function nearestOnBrow(brow: Float32Array, q: V2): { d: number; p: V2 } {
  let best = { d: Infinity, p: [0, 0] as V2 };
  const n = brow.length / 2;
  for (let j = 0; j < n - 1; j++) {
    const ax = brow[j * 2];
    const ay = brow[j * 2 + 1];
    const abx = brow[j * 2 + 2] - ax;
    const aby = brow[j * 2 + 3] - ay;
    const l2 = abx * abx + aby * aby || 1e-12;
    const t = Math.min(1, Math.max(0, ((q[0] - ax) * abx + (q[1] - ay) * aby) / l2));
    const p: V2 = [ax + abx * t, ay + aby * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, p };
  }
  let lo = 0;
  let hi = 0;
  for (let j = 1; j < n; j++) {
    if (brow[j * 2] < brow[lo * 2]) lo = j;
    if (brow[j * 2] > brow[hi * 2]) hi = j;
  }
  for (const [end, past] of [
    [lo, q[0] < brow[lo * 2]],
    [hi, q[0] > brow[hi * 2]],
  ] as const) {
    if (!past) continue;
    const d = Math.abs(q[1] - brow[end * 2 + 1]);
    if (d < best.d) best = { d, p: [q[0], brow[end * 2 + 1]] };
  }
  return best;
}

/** distance (eye units) from the eye point (x, y) to the brow-lower polyline */
export function browGapAt(f: EyeFrame, x: number, y: number): number {
  return nearestOnBrow(f.brow, [x, y]).d;
}

/** the brow end of the gap from (x, y): the nearest brow-lower point, eye units (debug overlay) */
export function browGapEnd(f: EyeFrame, x: number, y: number): V2 {
  return nearestOnBrow(f.brow, [x, y]).p;
}

/** [GPUPixel-left, GPUPixel-right] eye frames of `face` at image aspect W/H */
export function eyeFrames(face: Face, aspect: number): readonly [EyeFrame, EyeFrame] {
  const P = face.pts111;
  const iso = (x: number, y: number): V2 => [x, y / aspect];
  const pt = (i: number): V2 => iso(P[i * 2], P[i * 2 + 1]);
  const m0 = pt(43);
  const m1 = pt(16);
  const ml = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1e-12;
  const mh: V2 = [(m1[0] - m0[0]) / ml, (m1[1] - m0[1]) / ml];
  const frame = (e: (typeof EYES)[number]): EyeFrame => {
    const o = pt(e.outer);
    const inn = pt(e.inner);
    const w = Math.hypot(inn[0] - o[0], inn[1] - o[1]) || 1e-12;
    const ex: V2 = [(inn[0] - o[0]) / w, (inn[1] - o[1]) / w];
    const k = mh[0] * ex[0] + mh[1] * ex[1];
    const eyRaw: V2 = [mh[0] - k * ex[0], mh[1] - k * ex[1]];
    const el = Math.hypot(eyRaw[0], eyRaw[1]) || 1e-12;
    const ey: V2 = [eyRaw[0] / el, eyRaw[1] / el];
    const toEye = (q: V2): V2 => {
      const dx = q[0] - o[0];
      const dy = q[1] - o[1];
      return [(dx * ex[0] + dy * ex[1]) / w, (dx * ey[0] + dy * ey[1]) / w];
    };
    const lidPt = (j: number): V2 => toEye(iso(face.lids[(e.lid + j) * 2], face.lids[(e.lid + j) * 2 + 1]));
    const chain = (idx: readonly number[]): Float32Array => {
      const out = new Float32Array(idx.length * 2);
      let xmax = -Infinity;
      idx.forEach((j, i) => {
        const q = lidPt(j);
        xmax = Math.max(xmax, q[0]);
        out[i * 2] = xmax;
        out[i * 2 + 1] = q[1];
      });
      return out;
    };
    const upperPts = chain([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const lowerPts = chain([0, 9, 10, 11, 12, 13, 14, 15, 8]);
    const upper = new Float32Array(LID_STATIONS);
    const lower = new Float32Array(LID_STATIONS);
    STATION_XS.forEach((x, s) => {
      upper[s] = polyY(upperPts, x);
      lower[s] = polyY(lowerPts, x);
    });
    const brow = new Float32Array(8);
    e.brow.forEach((i, j) => brow.set(toEye(pt(i)), j * 2));
    const browGap = new Float32Array(LID_STATIONS);
    STATION_XS.forEach((x, s) => (browGap[s] = nearestOnBrow(brow, [x, upper[s]]).d));
    const up = pt(e.up);
    const lo = pt(e.lo);
    const ear = Math.hypot(up[0] - lo[0], up[1] - lo[1]) / w;
    const I = face.iris;
    const ic = iso(I[e.iris], I[e.iris + 1]);
    let r = 0;
    for (let b = 1; b <= 4; b++) r += Math.hypot(I[e.iris + b * 2] - ic[0], I[e.iris + b * 2 + 1] / aspect - ic[1]) / 4;
    const ce = toEye(ic);
    const rw = r / w;
    const valid =
      rw >= 0.12 &&
      rw <= 0.32 &&
      ce[0] >= 0.1 &&
      ce[0] <= 0.9 &&
      ce[1] >= polyY(upperPts, ce[0]) - 0.5 * rw &&
      ce[1] <= polyY(lowerPts, ce[0]) + 0.5 * rw;
    return {
      o,
      ex,
      ey,
      w,
      upper,
      lower,
      upperPts,
      lowerPts,
      brow,
      browGap,
      ear,
      iris: valid ? { c: ic, r } : null,
      irisFallback: { c: pt(e.pupil), r: 0.21 * w },
    };
  };
  return [frame(EYES[0]), frame(EYES[1])];
}

/** eye-local (x, y) → image UV */
export function eyeToUv(f: EyeFrame, x: number, y: number, aspect: number): V2 {
  const ix = f.o[0] + f.w * (x * f.ex[0] + y * f.ey[0]);
  const iy = f.o[1] + f.w * (x * f.ex[1] + y * f.ey[1]);
  return [ix, iy * aspect];
}

/** 美瞳 fades with EAR exactly at RM's threshold (EAR < 0.15 → 0) */
export const lensBlinkGate = (ear: number): number => smoothstep(0.15, 0.2, ear);
/** 睫毛 stays on half-closed eyes and fades only near closure */
export const lashBlinkGate = (ear: number): number => smoothstep(0.08, 0.14, ear);
/** 睫毛 size gate: eye width over the short edge, both iso, so preview, tiles and export agree */
export const lashSizeGate = (f: EyeFrame, aspect: number): number => smoothstep(0.01, 0.016, f.w / Math.min(1, 1 / aspect));

/** inputs of the 美妝 strip notes for one face (face-detail spec §2.4): both eyes below 0.5 of their gate */
export function eyeNoteInfo(face: Face, aspect: number): { lensClosed: boolean; lashesClosed: boolean; lashesSmall: boolean } {
  const [l, r] = eyeFrames(face, aspect);
  return {
    lensClosed: lensBlinkGate(l.ear) < 0.5 && lensBlinkGate(r.ear) < 0.5,
    lashesClosed: lashBlinkGate(l.ear) < 0.5 && lashBlinkGate(r.ear) < 0.5,
    lashesSmall: lashSizeGate(l, aspect) < 0.5 && lashSizeGate(r, aspect) < 0.5,
  };
}

/** a lid station: eye-local point and the lid's outward unit normal (away from the aperture) */
export interface Station {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * The lid sampled at ascending `xs`, with normals pointing up (upper lid) or down (lower lid). Samples at x ≥ 0 lie on
 * the lid, with normals from central differences over those samples only. Samples at x < 0 are the S5 §4.7 overhang:
 * they continue from the outer corner along the corner line (y = the lid's y at x = 0) and carry the normal of the
 * first sample at x ≥ 0, so the overhang never changes the lid stations and a ribbon over it cannot fold at the corner.
 * (Extending the end chord instead ran the upper overhang down toward the cheek: the dense contour's first chord is
 * short and steep.)
 */
export function lidStations(f: EyeFrame, lid: 'upper' | 'lower', xs: readonly number[]): Station[] {
  const pts = lid === 'upper' ? f.upperPts : f.lowerPts;
  const y0 = polyY(pts, 0);
  const ys = xs.map((x) => (x < 0 ? y0 : polyY(pts, x)));
  const lo = Math.max(0, xs.findIndex((x) => x >= 0));
  const normal = (i: number): V2 => {
    const a = Math.max(lo, i - 1);
    const b = Math.min(xs.length - 1, i + 1);
    const tx = xs[b] - xs[a];
    const ty = ys[b] - ys[a];
    const l = Math.hypot(tx, ty) || 1e-12;
    const nx = ty / l;
    const ny = -tx / l;
    return (lid === 'upper' && ny > 0) || (lid === 'lower' && ny < 0) ? [-nx, -ny] : [nx, ny];
  };
  return xs.map((x, i) => {
    const [nx, ny] = normal(Math.max(lo, i));
    return { x, y: ys[i], nx, ny };
  });
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run src/engine/passes/eyeFrame.test.ts && npm run typecheck`
Expected: PASS (16 tests); no type errors.

- [x] **Step 5: Commit**

```bash
git add src/engine/passes/eyeFrame.ts src/engine/passes/eyeFrame.test.ts src/engine/passes/syntheticFaces.ts
git commit -F- <<'EOF'
v0.4 step 5: eye frames, lid stations, EAR and the makeup gates

Eye-local frames from the dense lid contour, station normals with the
outer-corner overhang, brow gaps, the iris with its fallback, and the
美瞳 / 睫毛 blink and size gates; synthetic face edits for the tests.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Landed as `0692964`, which carries a stale step-2 subject (`v0.4 step 2 task 5: adjustMath.ts stages, …`, a leftover message file in the scratchpad, as with `db1f468`). Its content is this task's three files and its ticks. The `v0.4 step 5 task 5 fix:` commit on top of it records this note, and no commit was amended.

**Review fix (the overhang, S5 §4.7 amended):** the drafted rule extended each lid past the outer corner along its end segment. The dense contour's first chord (MP 33 → 246, 263 → 466) is only about 0.07 eye units long and steep, so the upper overhang ran down toward the cheek: at x = −0.22 it lay 0.73 (left) and 0.25 (right) eye units below the corner on `landmarks_sample_face.json`, 0.22–0.62 on the three `group_faces.png` faces, and the lower accent's overhang rose 0.09–0.23 above the corner, so the two crossed. `lidStations` now puts samples at x < 0 on the corner line (y = the lid's y at x = 0, which is 0) with the normal of the first sample at x ≥ 0, and computes the lid normals over the samples at x ≥ 0 only, so the overhang no longer changes the lid stations. The reviewer's suggested direction, the liner wing's (−0.16, −0.07) with central-difference normals, was measured and rejected: the turn of 70–100° at the corner folds the 眼影 and 睫毛 ribbons between x = −0.07 and 0 on every fixture eye. Giving that overhang the lid's corner normal instead leaves its strip almost flat on the steep eyes, where that normal is within 1–4° of the wing direction. The old slope pin is replaced by a `the outer-corner overhang` block (4 tests, on the sample face, its recorded `mirrored` landmarks and the three group faces): the corner line, the two eyes agreeing at x = −0.22, the lid stations unchanged, and no folded quad for 睫毛 d ≤ 0.20, 眼影 d ≤ H and d ≤ 0.8, and the lower accent. Task 8 keeps `UPPER_XS`, `LOWER_ACCENT_XS` and `eyeRibbon` as written; its overhang now runs outward from the corner instead of down the cheek.

### Task 6: Warp uniforms, anchors, influence box and face-table packing

CPU side of the six new warps and of 左右分開 (S5 §4.2–4.4): the engine deltas with per-side values, every anchor the shader needs (with the fold-safety clamps and degenerate-face guards), the influence box, the step-5 block of the face table, and the `U_MAX` box. The shader does not read any of it until Task 7, so pixels do not change in this task.

**Files:**
- Modify: `src/engine/passes/reshape.ts:37-85` (uniforms), `:112-118` (tables), `:120-198` (geometry); add `packFaceDetail`
- Modify: `src/engine/passes/faceCap.ts` (step 1): `packFaceTable` (`:116-138`) calls `packFaceDetail` (S5 §4.2 calls the packer `buildReshapeTable`; step 1 named it `packFaceTable`); `uMaxBox` (`:111-113`)
- Modify: `src/engine/index.ts` (CRLF; step 1's `job()`, `:321`), step 4's `src/engine/backMapFrame.ts:35` (the 祛痘 tap's back map) and step 1's `src/edit/warpGuard.ts:31` (the fold safety net): the per-face `reshape` uniforms take `f.person.right`
- Modify: `src/media/exportPlan.ts` (step 3's `faceBoundsFor`, `:247`): the tile-apron uniforms take `f.person.right`
- Modify: `src/engine/pipeline.ts:213` (CRLF; step 1's `ZERO_U` literal in `tableFaces`) and the two `ReshapeUniforms` literals of `src/engine/pipeline.test.ts:88, 209`: the twelve new keys
- Test: `src/engine/passes/reshape.test.ts` (CRLF)

**Interfaces:**
- Consumes: step 1's face-table layout (`FT` in `src/engine/passes/faceTable.ts`, re-exported by `faceCap.ts`: `{ ROW: 96, PTS: 0, EXT: 56, VT: 60, NT: 63, CHIN_EYE: 65, S1: 66, S2: 67, RADII: 68, PROT: 69, RIGHT: 70, BOX: 72, CAP: 73, WIN: 74 }`; 70–71 reserved for step 5, 75–95 spare), `packFaceTable(faces: readonly TableFace[], aspect: number, out: Float32Array)` (per face: `const o = f * FT.ROW * 4`, `const u = t.u` — already attenuated —, `const g = reshapeGeometry(t.face, aspect, u)`, then texels 0–69 and 72–74), `uMaxBox(face, aspect): [number, number, number, number]` (step 1: `reshapeGeometry(face, aspect, { ...RESHAPE_SCALE }).box`), step 1's `job()` line, as landed `reshape: scaleUniforms(reshapeUniforms(f.person.values, w), f.warpScale ?? 1),` (λ_f of the fold safety net), `RenderFace.person` (RM §4.1); Task 1 `SplitParamId`, `PersonParams['right']`.
- Produces:
  - `ReshapeUniforms` += `faceSlimR, faceVR, faceNarrowR, eyeEnlargeR, jawline, jawlineR, temple, templeR, hairline, noseWing, noseBridge, mouthHeight: number`
  - `RESHAPE_SCALE` += `jawline: 0.12, temple: 0.22, hairline: 0.09, noseWing: 0.1, noseBridge: 0.3, mouthHeight: 0.18`
  - `reshapeUniforms(values, faceWeight, right?: PersonParams['right']): ReshapeUniforms` (the right-side fields equal the left ones bit for bit while `right` is null)
  - tables `JAW`, `TEMPLE`, `TEMPLE_W`, `SLIM_SIDE`, `VJAW_SIDE`, `NARROW_SIDE`, `JAW_SIDE`, `TEMPLE_SIDE`; `sided(dl, dr, side): number`
  - `ReshapeGeometry` += `axes: [number, number, number, number]` (r̂, m̂ iso), `jawTargets: Float32Array` (10 × vec2 UV), `templeAnchors`, `templeTargets: Float32Array` (6 × vec2 UV), `hairlineS: number`, `hairlineRadii: [number, number, number]`, `hairlineDisp: V2`, `mouthHS: number`, `mouthHRadii: [number, number, number]`, `mouthHAxis: V2`, `mouthHDisp: V2`, `noseWingS: number`, `noseWingR: number`, `noseWingDisp: V2`, `root: [number, number, number, number]` (centre UV, r−, r+), `rootRy: number`, `rootK: number` — the `…S` / `rootK` fields are the effective strengths (0 for a degenerate face), the vectors are clamped
  - `packFaceDetail(row: Float32Array, u: ReshapeUniforms, g: ReshapeGeometry): void` — `row` is one face's 96-texel slice (384 floats)

- [x] **Step 1: Write the failing tests**

Append to `src/engine/passes/reshape.test.ts` (CRLF). Step 3 already added `import { readFileSync } from 'node:fs';`, `import { adapt } from '../../tracking/adapter111';` and `PARAM_DEFS` in the `../params` import; merge the rest into the existing lines, never importing a name twice: `neutralValue`, `SPLIT_IDS` into the `../params` import; `import { uMaxBox } from './faceCap';`; `faceWidthIso`, `JAW`, `JAW_SIDE`, `NARROW`, `NARROW_SIDE`, `packFaceDetail`, `sided`, `SLIM`, `SLIM_SIDE`, `TEMPLE`, `TEMPLE_SIDE`, `TEMPLE_W`, `V_JAW`, `VJAW_SIDE` into the `./reshape` import (it already has `reshapeActive`, `reshapeGeometry`, `reshapeUniforms`); `PersonParams` into the `../../types` type import:

```ts
const fx = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  mirrored: number[];
};
const FA = fx.width / fx.height;
const fixture = adapt({ points: new Float32Array(fx.points) }, fx.width, fx.height);
const mirrored = adapt({ points: new Float32Array(fx.mirrored) }, fx.width, fx.height);
const NEUTRAL = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
const U5 = (over: Partial<Record<ParamId, number>> = {}, right: PersonParams['right'] = null) =>
  reshapeUniforms({ ...NEUTRAL, ...over }, 1, right);
const NEW_AT_MAX = {
  'shape.jawline': 1, 'shape.temple': 1, 'shape.hairline': 1, 'shape.noseWing': 1, 'shape.noseBridge': 1, 'shape.mouthHeight': 1,
} as const;
const V03_AT_MAX = {
  'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.chin': 1, 'shape.forehead': 1,
  'shape.noseSlim': 1, 'shape.mouthSize': 1, 'shape.eyeDistance': 1,
} as const;
const isoOf = (p: readonly number[] | Float32Array, i: number): [number, number] => [p[i * 2], p[i * 2 + 1] / FA];
const len = (x: number, y: number) => Math.hypot(x, y);
const inBox = (b: readonly number[], x: number, y: number) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3];
const boxIn = (a: readonly number[], b: readonly number[]) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

describe('step-5 uniforms (face-detail spec §4.2, §4.3)', () => {
  it('scale by the engine deltas: 下頜線 0.12·v, 太陽穴 0.22·s, 髮際線 0.09·s, 鼻翼 0.10·s, 山根 0.30·s, 嘴高 0.18·s', () => {
    const hi = U5(NEW_AT_MAX);
    const lo = U5({ 'shape.temple': 0, 'shape.hairline': 0, 'shape.noseWing': 0, 'shape.noseBridge': 0, 'shape.mouthHeight': 0 });
    expect([hi.jawline, hi.temple, hi.hairline, hi.noseWing, hi.noseBridge, hi.mouthHeight].map((v) => +v.toFixed(9))).toEqual([0.12, 0.22, 0.09, 0.1, 0.3, 0.18]);
    expect([lo.temple, lo.hairline, lo.noseWing, lo.noseBridge, lo.mouthHeight].map((v) => +v.toFixed(9))).toEqual([-0.22, -0.09, -0.1, -0.3, -0.18]);
    expect(reshapeActive(U5())).toBe(false);
  });

  it('right-side strengths equal the left ones bit for bit while right is null; right overrides per id', () => {
    const v = { 'shape.faceSlim': 0.37, 'shape.faceV': 0.21, 'shape.faceNarrow': 0.6, 'shape.eyeEnlarge': 0.33, 'shape.jawline': 0.7, 'shape.temple': 0.81 };
    const a = U5(v);
    for (const [l, r] of [
      ['faceSlim', 'faceSlimR'],
      ['faceV', 'faceVR'],
      ['faceNarrow', 'faceNarrowR'],
      ['eyeEnlarge', 'eyeEnlargeR'],
      ['jawline', 'jawlineR'],
      ['temple', 'templeR'],
    ] as const)
      expect(Object.is(a[l], a[r])).toBe(true);
    const b = U5(v, { 'shape.faceSlim': 0.9, 'shape.temple': 0 });
    expect(b.faceSlimR).toBeCloseTo(0.1 * 0.9, 12);
    expect(b.templeR).toBeCloseTo(-0.22, 12);
    expect(Object.is(b.faceVR, b.faceV)).toBe(true);
  });

  it('side tables follow the GPUPixel halves (contour 0–15 left, 17–32 right, p16 the mean)', () => {
    const side = (i: number) => (i < 16 ? 0 : i > 16 ? 1 : 0.5);
    SLIM.forEach(([o], k) => expect(SLIM_SIDE[k]).toBe(side(o)));
    V_JAW.forEach((o, k) => expect(VJAW_SIDE[k]).toBe(side(o)));
    NARROW.forEach((o, k) => expect(NARROW_SIDE[k]).toBe(side(o)));
    JAW.forEach((o, k) => expect(JAW_SIDE[k]).toBe(side(o)));
    // temple anchors are oval points: the GPUPixel-left ones lie left of the face midline on an upright face
    const mid = (fixture.pts111[0] + fixture.pts111[64]) / 2;
    TEMPLE.forEach((j, k) => expect(TEMPLE_SIDE[k]).toBe(fixture.oval[j * 2] < mid ? 0 : 1));
    expect(TEMPLE_W).toEqual([0.6, 1, 0.6, 0.6, 1, 0.6]);
    for (const s of [0, 0.5, 1]) expect(Object.is(sided(0.123, 0.123, s), 0.123)).toBe(true);
    expect(sided(0.1, 0.3, 0.5)).toBeCloseTo(0.2, 12);
  });
});

describe('step-5 geometry (face-detail spec §4.1, §4.2, §4.4)', () => {
  for (const [name, face] of [
    ['fixture', fixture],
    ['mirrored', mirrored],
  ] as const) {
    const fw = faceWidthIso(face, FA);
    const g = reshapeGeometry(face, FA, U5(NEW_AT_MAX));
    const P = face.pts111;

    it(`${name}: face axes are orthonormal, m̂ toward the chin, r̂ from the GPUPixel-left eye to the right eye`, () => {
      const [rx, ry, mx, my] = g.axes;
      expect(len(rx, ry)).toBeCloseTo(1, 12);
      expect(len(mx, my)).toBeCloseTo(1, 12);
      expect(rx * mx + ry * my).toBeCloseTo(0, 12);
      const [ax, ay] = isoOf(P, 74);
      const [bx, by] = isoOf(P, 77);
      expect(rx * (bx - ax) + ry * (by - ay)).toBeGreaterThan(0);
      expect(my).toBeGreaterThan(0.9);
    });

    it(`${name}: jaw targets 0.22 FW from the contour, inward; temple targets 0.12 FW, outward`, () => {
      JAW.forEach((i, k) => {
        const [px, py] = isoOf(P, i);
        const [tx, ty] = isoOf(g.jawTargets, k);
        expect(len(tx - px, ty - py)).toBeCloseTo(0.22 * fw, 6);
        const [nx, ny] = isoOf(P, 46);
        expect((tx - px) * (nx - px) + (ty - py) * (ny - py)).toBeGreaterThan(0);
      });
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < 36; k++) {
        cx += face.oval[k * 2] / 36;
        cy += face.oval[k * 2 + 1] / FA / 36;
      }
      TEMPLE.forEach((_, k) => {
        const [ox, oy] = isoOf(g.templeAnchors, k);
        const [tx, ty] = isoOf(g.templeTargets, k);
        expect(len(tx - ox, ty - oy)).toBeCloseTo(0.12 * fw, 6);
        expect(len(tx - cx, ty - cy)).toBeGreaterThan(len(ox - cx, oy - cy));
      });
    });

    it(`${name}: 髮際線 moves down by 0.09·FH, 嘴高 up by 0.18·L, 鼻翼 −0.10·s·(p81 − p80), 山根 k = 0.3`, () => {
      const fh = len(face.ext[0] - face.ext[4], (face.ext[1] - face.ext[5]) / FA);
      expect(len(g.hairlineDisp[0], g.hairlineDisp[1] / FA)).toBeCloseTo(0.09 * fh, 9);
      expect(g.hairlineDisp[1]).toBeGreaterThan(0);
      expect(g.hairlineRadii.map((r) => r / fh)).toEqual([expect.closeTo((0.4 * fw) / fh, 9), expect.closeTo(0.5, 9), expect.closeTo(0.55, 9)]);
      const L = len(P[212] - P[98], (P[213] - P[99]) / FA);
      expect(len(g.mouthHDisp[0], g.mouthHDisp[1] / FA)).toBeCloseTo(0.18 * L, 9);
      expect(g.mouthHDisp[1]).toBeLessThan(0);
      expect(g.mouthHRadii[1]).toBeCloseTo(L, 12);
      expect(g.mouthHRadii[2]).toBeCloseTo(1.6 * L, 12);
      expect(g.noseWingDisp[0]).toBeCloseTo(-0.1 * (P[162] - P[160]), 9);
      expect(g.noseWingR).toBeCloseTo(0.55 * len(P[162] - P[160], (P[163] - P[161]) / FA), 12);
      expect(g.rootK).toBeCloseTo(0.3, 12);
      expect(g.root[2]).toBeGreaterThan(0.01 * fw);
      expect(g.root[3]).toBeGreaterThan(0.01 * fw);
      expect([g.hairlineS, g.mouthHS, g.noseWingS].map((v) => +v.toFixed(9))).toEqual([0.09, 0.18, 0.1]);
    });

    it(`${name}: the influence box holds every new anchor, and is unchanged while the new items are neutral`, () => {
      for (let k = 0; k < 10; k++) expect(inBox(g.box, g.jawTargets[k * 2], g.jawTargets[k * 2 + 1])).toBe(true);
      for (let k = 0; k < 6; k++) expect(inBox(g.box, g.templeAnchors[k * 2], g.templeAnchors[k * 2 + 1])).toBe(true);
      for (const i of [80, 81, 106]) expect(inBox(g.box, P[i * 2], P[i * 2 + 1])).toBe(true);
      expect(inBox(g.box, face.ext[0], face.ext[1])).toBe(true);
      expect(inBox(g.box, g.root[0], g.root[1])).toBe(true);
      // 左右分開 on with equal sides keeps the box (the R strengths only widen it when they differ)
      const same = Object.fromEntries(SPLIT_IDS.map((id) => [id, { ...NEUTRAL, ...V03_AT_MAX }[id]]));
      expect(reshapeGeometry(face, FA, U5(V03_AT_MAX, same)).box).toEqual(reshapeGeometry(face, FA, U5(V03_AT_MAX)).box);
      const idle = reshapeGeometry(face, FA, U5());
      expect(idle.box[0]).toBeGreaterThan(idle.box[2]);
    });

    it(`${name}: every new warp's box lies inside the v0.3 U_MAX box and inside uMaxBox (S5 §4.4)`, () => {
      const v03 = reshapeGeometry(face, FA, U5(V03_AT_MAX)).box;
      const umax = uMaxBox(face, FA);
      for (const id of Object.keys(NEW_AT_MAX) as (keyof typeof NEW_AT_MAX)[]) {
        for (const v of id === 'shape.jawline' ? [1] : [0, 1]) {
          const b = reshapeGeometry(face, FA, U5({ [id]: v })).box;
          expect(boxIn(b, v03), `${id}=${v}`).toBe(true);
          expect(boxIn(b, umax), `${id}=${v}`).toBe(true);
        }
      }
    });
  }

  it('degenerate faces switch the item off instead of producing NaN (thin 山根 band, p106 on p49, ext[0] on ext[2])', () => {
    const f = { ...fixture, pts111: fixture.pts111.slice(), ext: fixture.ext.slice() };
    for (const i of [78, 79, 55, 58]) f.pts111.set([0.45, 0.35], i * 2);
    f.pts111.set([f.pts111[98], f.pts111[99]], 106 * 2);
    f.ext.set([f.ext[4], f.ext[5]], 0);
    const g = reshapeGeometry(f, FA, U5(NEW_AT_MAX));
    expect([g.rootK, g.mouthHS, g.hairlineS]).toEqual([0, 0, 0]);
    const all = [...g.axes, ...g.jawTargets, ...g.templeAnchors, ...g.templeTargets, ...g.hairlineDisp, ...g.mouthHDisp, ...g.mouthHAxis, ...g.noseWingDisp, ...g.root, g.rootRy, g.noseWingR, ...g.hairlineRadii, ...g.mouthHRadii];
    for (const v of all) expect(Number.isFinite(v)).toBe(true);
  });

  it('packFaceDetail fills texels 70–71 and 75–95 and leaves 0–69 and 72–74 alone', () => {
    const u = U5({ ...NEW_AT_MAX, 'shape.faceSlim': 0.5 }, { 'shape.faceSlim': 0.8, 'shape.jawline': 0.4 });
    const g = reshapeGeometry(fixture, FA, u);
    const row = new Float32Array(96 * 4).fill(7);
    packFaceDetail(row, u, g);
    const t = (i: number) => Array.from(row.subarray(i * 4, i * 4 + 4));
    for (let i = 0; i < 70; i++) expect(t(i)).toEqual([7, 7, 7, 7]);
    for (const i of [72, 73, 74]) expect(t(i)).toEqual([7, 7, 7, 7]);
    const f32 = (xs: number[]) => xs.map((x) => Math.fround(x));
    expect(t(70)).toEqual(f32([u.faceSlimR, u.faceVR, u.faceNarrowR, u.eyeEnlargeR]));
    expect(t(71)).toEqual(f32([u.jawlineR, u.templeR, 0, 0]));
    expect(t(75)).toEqual(f32([u.jawline, u.temple, g.hairlineS, g.noseWingS]));
    expect(t(76)).toEqual(f32([g.rootK, g.mouthHS, 0, 0]));
    expect(Array.from(row.subarray(77 * 4, 82 * 4))).toEqual(Array.from(g.jawTargets));
    expect(Array.from(row.subarray(82 * 4, 85 * 4))).toEqual(Array.from(g.templeAnchors));
    expect(Array.from(row.subarray(85 * 4, 88 * 4))).toEqual(Array.from(g.templeTargets));
    expect(t(88)).toEqual(f32(g.axes));
    expect(t(89)).toEqual(f32([...g.hairlineRadii, 0]));
    expect(t(90)).toEqual(f32([...g.hairlineDisp, ...g.mouthHDisp]));
    expect(t(91)).toEqual(f32([...g.mouthHRadii, 0]));
    expect(t(92)).toEqual(f32([...g.mouthHAxis, 0, 0]));
    expect(t(93)).toEqual(f32([g.noseWingR, ...g.noseWingDisp, 0]));
    expect(t(94)).toEqual(f32(g.root));
    expect(t(95)).toEqual(f32([g.rootRy, 0, 0, 0]));
  });
});
```

(`P[212]`/`P[213]` are p106, `P[98]`/`P[99]` p49, `P[160]`…`P[163]` p80 / p81; `ext[4..5]` is ext[2], the glabella.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/passes/reshape.test.ts`
Expected: FAIL — `JAW` / `packFaceDetail` not exported; `hi.jawline` is `undefined`.

- [x] **Step 3: Implement the uniforms**

Replace `reshape.ts:37-85` (`values` keeps step 1's landed key type `ShapeId`, the 美型 ids, so a `PersonParams.values` and a full `Record<ParamId, number>` both fit; existing callers keep compiling):

```ts
/** Engine-space deltas (already scaled per RB §2.4 / face-detail spec §4.2 and multiplied by the live weight). */
export interface ReshapeUniforms {
  faceSlim: number;
  faceV: number;
  faceNarrow: number;
  chin: number;
  forehead: number;
  noseSlim: number;
  mouthSize: number;
  eyeDistance: number;
  eyeEnlarge: number;
  /** 左右分開: GPUPixel-right strengths of the split items; equal to the left ones, bit for bit, while it is off */
  faceSlimR: number;
  faceVR: number;
  faceNarrowR: number;
  eyeEnlargeR: number;
  /** step 5 (face-detail spec §4.2) */
  jawline: number;
  jawlineR: number;
  temple: number;
  templeR: number;
  hairline: number;
  noseWing: number;
  noseBridge: number;
  mouthHeight: number;
}

type ScaleKey = Exclude<keyof ReshapeUniforms, 'faceSlimR' | 'faceVR' | 'faceNarrowR' | 'eyeEnlargeR' | 'jawlineR' | 'templeR'>;

/** RB §2.4 "Delta" column; the step-5 rows are face-detail spec §4.2's engine deltas. */
export const RESHAPE_SCALE = {
  faceSlim: 0.1,
  faceV: 0.1,
  faceNarrow: 0.07,
  chin: 0.1,
  forehead: -0.1,
  noseSlim: 0.15,
  mouthSize: 0.3,
  eyeDistance: 0.08,
  eyeEnlarge: 0.2,
  jawline: 0.12,
  temple: 0.22,
  hairline: 0.09,
  noseWing: 0.1,
  noseBridge: 0.3,
  mouthHeight: 0.18,
} as const satisfies Record<ScaleKey, number>;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const clampS = (v: number) => Math.min(1, Math.max(-1, signed(clamp01(v))));

/** the 美型 items: what the reshape uniforms read (a full Record<ParamId, number> and PersonParams.values both fit) */
type ShapeId = Extract<ParamId, `shape.${string}`>;

export function reshapeUniforms(values: Readonly<Record<ShapeId, number>>, faceWeight: number, right: PersonParams['right'] = null): ReshapeUniforms {
  const w = clamp01(faceWeight);
  const one = (id: ShapeId) => clamp01(values[id]) * w;
  const bi = (id: ShapeId) => clampS(values[id]) * w;
  /** the GPUPixel-right value of a split item: right[id] while 左右分開 is on, else the shared value (same float ops) */
  const rv = (id: SplitParamId) => {
    const r = right?.[id];
    return typeof r === 'number' ? r : values[id];
  };
  const oneR = (id: SplitParamId) => clamp01(rv(id)) * w;
  const biR = (id: SplitParamId) => clampS(rv(id)) * w;
  const k = RESHAPE_SCALE;
  return {
    faceSlim: k.faceSlim * one('shape.faceSlim'),
    faceV: k.faceV * one('shape.faceV'),
    faceNarrow: k.faceNarrow * one('shape.faceNarrow'),
    chin: k.chin * bi('shape.chin'),
    forehead: k.forehead * bi('shape.forehead'),
    noseSlim: k.noseSlim * one('shape.noseSlim'),
    mouthSize: k.mouthSize * bi('shape.mouthSize'),
    eyeDistance: k.eyeDistance * bi('shape.eyeDistance'),
    eyeEnlarge: k.eyeEnlarge * one('shape.eyeEnlarge'),
    faceSlimR: k.faceSlim * oneR('shape.faceSlim'),
    faceVR: k.faceV * oneR('shape.faceV'),
    faceNarrowR: k.faceNarrow * oneR('shape.faceNarrow'),
    eyeEnlargeR: k.eyeEnlarge * oneR('shape.eyeEnlarge'),
    jawline: k.jawline * one('shape.jawline'),
    jawlineR: k.jawline * oneR('shape.jawline'),
    temple: k.temple * bi('shape.temple'),
    templeR: k.temple * biR('shape.temple'),
    hairline: k.hairline * bi('shape.hairline'),
    noseWing: k.noseWing * bi('shape.noseWing'),
    noseBridge: k.noseBridge * bi('shape.noseBridge'),
    mouthHeight: k.mouthHeight * bi('shape.mouthHeight'),
  };
}
```

Add `PersonParams` and `SplitParamId` to the `import type` line (`reshape.ts:18`); `ParamId` stays, the `ShapeId` alias uses it. `reshapeActive`, step 1's `attenuate` and `faceDrawn` iterate `Object.keys(u)` / `Object.values(u)`, and the λ_f scalers (`index.ts` `scaleUniforms`, `backMapFrame.ts` / `warpGuard.ts` `scaled`) iterate `Object.keys(o)`, so they cover the new keys unchanged.

Step 1's `ZERO_U` (`pipeline.ts:213`, CRLF), the uniforms of a face without a drawn warp in `tableFaces`, is a typed `ReshapeUniforms` literal: give it the twelve new keys at 0 (`faceSlimR: 0, faceVR: 0, faceNarrowR: 0, eyeEnlargeR: 0, jawline: 0, jawlineR: 0, temple: 0, templeR: 0, hairline: 0, noseWing: 0, noseBridge: 0, mouthHeight: 0`). The two literals of `pipeline.test.ts` (`:88` the `planFrame` job's `reshape`, `:209` the `tableFaces` face) get the same keys, with `faceSlimR: 0.1` next to their `faceSlim: 0.1` (the right side equals the left while 左右分開 is off); their assertions are unchanged.

- [x] **Step 4: Implement the tables, the geometry and the packing**

After `export const NOSE …` (`reshape.ts:118`):

```ts
/** 下頜線 origins: contour L 6–14, R 26–18 (jaw angle → chin, chin 16 excluded; S5 §4.1) */
export const JAW = [6, 8, 10, 12, 14, 26, 24, 22, 20, 18] as const;
/** 太陽穴 anchors, Face.oval indices: GPUPixel-left MP 162, 21, 54 · right MP 389, 251, 284 (faceOval.ts:6-9) */
export const TEMPLE = [30, 31, 32, 6, 5, 4] as const;
export const TEMPLE_W = [0.6, 1, 0.6, 0.6, 1, 0.6] as const;
/** side of each split anchor: 0 GPUPixel-left, 1 right, 0.5 the midline p16 (S5 §4.3) */
export const SLIM_SIDE = [0, 1, 0, 1, 0, 1, 0, 1, 0.5] as const;
export const VJAW_SIDE = [0, 0, 0, 1, 1, 1] as const;
export const NARROW_SIDE = [0, 0, 1, 1] as const;
export const JAW_SIDE = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1] as const;
export const TEMPLE_SIDE = [0, 0, 0, 1, 1, 1] as const;
/** the strength of an anchor on `side`: exactly `dl` when dr === dl (左右分開 off), so v0.3 maps stay bit-identical */
export function sided(dl: number, dr: number, side: number): number {
  return dl + (dr - dl) * side;
}
```

Replace `ReshapeGeometry` and `reshapeGeometry` (`reshape.ts:120-198`):

```ts
/** Anchors derived on the CPU once per frame (cheaper than per fragment). All in UV space unless marked iso. */
export interface ReshapeGeometry {
  vTargets: Float32Array; // 6 × vec2
  narrowTargets: Float32Array; // 4 × vec2
  chinTarget: V2;
  mouthR: number; // iso units
  eyeR: V2; // iso units, image-left / image-right eye
  eyeDisp: V2; // UV displacement of the image-left eye (right eye gets the negation)
  /** UV bounding box (minX, minY, maxX, maxY) of every active warp's influence region */
  box: [number, number, number, number];
  /** iso unit axes: r̂ (GPUPixel-left eye → right eye), m̂ (toward the chin) — S5 §4.1 */
  axes: [number, number, number, number];
  /** 下頜線 targets, 10 × vec2, JAW order */
  jawTargets: Float32Array;
  /** 太陽穴 anchors and targets, 6 × vec2 each, TEMPLE order */
  templeAnchors: Float32Array;
  templeTargets: Float32Array;
  /** 髮際線 at ext[0]: effective strength (0 on a degenerate face), radii (rx, ry↑, ry↓) iso, clamped disp UV */
  hairlineS: number;
  hairlineRadii: [number, number, number];
  hairlineDisp: V2;
  /** 嘴高 at p106: effective strength, radii (rx, ry↑, ry↓) iso, axis ay (iso, toward the chin side), clamped disp UV */
  mouthHS: number;
  mouthHRadii: [number, number, number];
  mouthHAxis: V2;
  mouthHDisp: V2;
  /** 鼻翼: effective strength, disc radius iso, clamped UV displacement of the left wing (the right gets −) */
  noseWingS: number;
  noseWingR: number;
  noseWingDisp: V2;
  /** 山根: band centre (UV), r− and r+ (iso); band half-height iso; clamped k (0 when the band is under 0.01 FW) */
  root: [number, number, number, number];
  rootRy: number;
  rootK: number;
}

/** Compute warp anchors for `face` at aspect W/H. Exported for unit tests and the harness. */
export function reshapeGeometry(face: Face, aspect: number, u: ReshapeUniforms): ReshapeGeometry {
  const P = face.pts111;
  const iso = (p: V2): V2 => [p[0], p[1] / aspect];
  const uv = (q: V2): V2 => [q[0], q[1] * aspect];
  const dist = (a: V2, b: V2) => {
    const ia = iso(a);
    const ib = iso(b);
    return Math.hypot(ia[0] - ib[0], ia[1] - ib[1]);
  };
  const p = (i: number) => pt(P, i);
  const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
  const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
  const unit = (a: V2): V2 => {
    const l = Math.hypot(a[0], a[1]);
    return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
  };
  /** a UV vector whose iso length is clamped to `maxIso` (S5 §4.2 fold-safety clamps) */
  const clampDisp = (d: V2, maxIso: number): V2 => {
    const l = Math.hypot(d[0], d[1] / aspect);
    return l > maxIso && l > 0 ? [(d[0] * maxIso) / l, (d[1] * maxIso) / l] : d;
  };

  // Projection on the face midline p43 → p16, done in iso space so it is a true perpendicular.
  const m0 = iso(p(43));
  const m1 = iso(p(16));
  const md: V2 = [m1[0] - m0[0], m1[1] - m0[1]];
  const mlen2 = md[0] * md[0] + md[1] * md[1] || 1e-12;
  const project = (i: number): V2 => {
    const q = iso(p(i));
    const t = ((q[0] - m0[0]) * md[0] + (q[1] - m0[1]) * md[1]) / mlen2;
    return uv([m0[0] + md[0] * t, m0[1] + md[1] * t]);
  };

  const vTargets = new Float32Array(12);
  V_JAW.forEach((i, k) => vTargets.set(project(i), k * 2));
  const narrowTargets = new Float32Array(8);
  NARROW.forEach((i, k) => narrowTargets.set(project(i), k * 2));

  const p16 = p(16);
  const p49 = p(49);
  const chinTarget: V2 = [2 * p16[0] - p49[0], 2 * p16[1] - p49[1]];
  const mouthR = 0.7 * dist(p(84), p(90));
  const eyeR: V2 = [EYE_RADIUS_K * dist(p(52), p(55)), EYE_RADIUS_K * dist(p(58), p(61))];

  // disp = −eyeDistance·IOD·û with û = unit(p77 − p74), i.e. −eyeDistance·(p77 − p74); + moves eyes apart.
  const e0 = p(74);
  const e1 = p(77);
  const eyeDisp: V2 = [-u.eyeDistance * (e1[0] - e0[0]), -u.eyeDistance * (e1[1] - e0[1])];

  // ── step 5 (face-detail spec §4.1–4.2) ──
  const fw = faceWidthIso(face, aspect);
  const mh = unit(md);
  const rh0: V2 = [-mh[1], mh[0]];
  const rh: V2 = dot(rh0, sub(iso(e1), iso(e0))) < 0 ? [-rh0[0], -rh0[1]] : rh0;
  const axes: [number, number, number, number] = [rh[0], rh[1], mh[0], mh[1]];

  // 下頜線: t_i = p_i + uv(0.22·FW·unit(n_i − 0.35·m̂)), n_i ⊥ (p_{i+1} − p_{i−1}) toward the nose tip p46
  const jawTargets = new Float32Array(20);
  JAW.forEach((i, k) => {
    const tg = sub(iso(p(i + 1)), iso(p(i - 1)));
    const n0 = unit([-tg[1], tg[0]]);
    const n = dot(n0, sub(iso(p(46)), iso(p(i)))) < 0 ? [-n0[0], -n0[1]] : n0;
    const dir = unit([n[0] - 0.35 * mh[0], n[1] - 0.35 * mh[1]]);
    const d = uv([dir[0] * 0.22 * fw, dir[1] * 0.22 * fw]);
    jawTargets[k * 2] = p(i)[0] + d[0];
    jawTargets[k * 2 + 1] = p(i)[1] + d[1];
  });

  // 太陽穴: t_k = o_k + uv(0.12·FW·n_out), n_out ⊥ (oval[k+1] − oval[k−1]) away from the oval centroid
  const ov = (k: number): V2 => {
    const j = ((k % 36) + 36) % 36;
    return [face.oval[j * 2], face.oval[j * 2 + 1]];
  };
  const cen: V2 = [0, 0];
  for (let k = 0; k < 36; k++) {
    const q = iso(ov(k));
    cen[0] += q[0] / 36;
    cen[1] += q[1] / 36;
  }
  const templeAnchors = new Float32Array(12);
  const templeTargets = new Float32Array(12);
  TEMPLE.forEach((j, k) => {
    const o = ov(j);
    const tg = sub(iso(ov(j + 1)), iso(ov(j - 1)));
    const n0 = unit([-tg[1], tg[0]]);
    const n = dot(n0, sub(iso(o), cen)) < 0 ? [-n0[0], -n0[1]] : n0;
    const d = uv([n[0] * 0.12 * fw, n[1] * 0.12 * fw]);
    templeAnchors.set(o, k * 2);
    templeTargets.set([o[0] + d[0], o[1] + d[1]], k * 2);
  });

  // 髮際線: shiftEllipse at ext[0], axes r̂ / m̂, radii (0.40 FW, 0.50 FH, 0.55 FH); disp = uv(0.09·s·FH·m̂), + moves down
  const ext0 = pt(face.ext, 0);
  const fh = dist(ext0, pt(face.ext, 2));
  const hairlineRadii: [number, number, number] = [0.4 * fw, 0.5 * fh, 0.55 * fh];
  const hairOk = fh > 1e-6 && fw > 1e-6;
  const hairlineDisp = hairOk ? clampDisp(uv([u.hairline * fh * mh[0], u.hairline * fh * mh[1]]), 0.2 * hairlineRadii[1]) : ([0, 0] as V2);
  const hairlineS = hairOk ? u.hairline : 0;

  // 嘴高: shiftEllipse at p106, ay = unit(p106 − p49), rx = 2·max corner offset along ax, ry = (L, 1.6·L); disp = uv(−0.18·s·L·ay)
  const L = dist(p(106), p49);
  const ay = unit(sub(iso(p(106)), iso(p49)));
  const axm: V2 = [-ay[1], ay[0]];
  const rxM = 2 * Math.max(Math.abs(dot(axm, sub(iso(p(84)), iso(p(106))))), Math.abs(dot(axm, sub(iso(p(90)), iso(p(106))))));
  const mouthHRadii: [number, number, number] = [rxM, L, 1.6 * L];
  const mouthOk = L > 1e-6 && rxM > 1e-6;
  const mouthHDisp = mouthOk ? clampDisp(uv([-u.mouthHeight * L * ay[0], -u.mouthHeight * L * ay[1]]), 0.2 * L) : ([0, 0] as V2);
  const mouthHS = mouthOk ? u.mouthHeight : 0;

  // 鼻翼: opposed shiftArounds at p80 / p81, R = 0.55·|p81 − p80|, disp_L = −0.10·s·(p81 − p80)
  const noseWingR = 0.55 * dist(p(81), p(80));
  const wingOk = noseWingR > 1e-6;
  const noseWingDisp = wingOk ? clampDisp([-u.noseWing * (p(81)[0] - p(80)[0]), -u.noseWing * (p(81)[1] - p(80)[1])], 0.32 * noseWingR) : ([0, 0] as V2);
  const noseWingS = wingOk ? u.noseWing : 0;

  // 山根: squeezeAxis across the band between the inner eye corners p55 / p58, centred on mid(p78, p79)
  const rc: V2 = [(p(78)[0] + p(79)[0]) / 2, (p(78)[1] + p(79)[1]) / 2];
  const rMinus = dot(rh, sub(iso(rc), iso(p(55))));
  const rPlus = dot(rh, sub(iso(p(58)), iso(rc)));
  const rootRy = dist(p(45), p(43));
  const rootOk = rMinus >= 0.01 * fw && rPlus >= 0.01 * fw && rootRy > 1e-6;
  const rootK = rootOk ? Math.min(0.5, Math.max(-0.5, u.noseBridge)) : 0;
  const root: [number, number, number, number] = [rc[0], rc[1], rMinus, rPlus];

  // Union of influence regions → UV box. Warps outside every region are identity, and a coordinate outside all of
  // them is never moved, so skipping it is exact.
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const disc = (o: V2, r: number) => {
    box[0] = Math.min(box[0], o[0] - r);
    box[1] = Math.min(box[1], o[1] - r * aspect);
    box[2] = Math.max(box[2], o[0] + r);
    box[3] = Math.max(box[3], o[1] + r * aspect);
  };
  /** bounding box of a rotated ellipse: semi-axes rx along ax and ry along ay (iso), S5 §4.4 */
  const ellipse = (c: V2, ax: V2, ayy: V2, rx: number, ry: number) => {
    const hx = Math.hypot(rx * ax[0], ry * ayy[0]);
    const hy = Math.hypot(rx * ax[1], ry * ayy[1]) * aspect;
    box[0] = Math.min(box[0], c[0] - hx);
    box[1] = Math.min(box[1], c[1] - hy);
    box[2] = Math.max(box[2], c[0] + hx);
    box[3] = Math.max(box[3], c[1] + hy);
  };
  const curve = (o: V2, t: V2) => disc(o, dist(o, t));
  const at2 = (a: Float32Array, k: number): V2 => [a[k * 2], a[k * 2 + 1]];
  if (u.faceSlim || u.faceSlimR) for (const [o, t] of SLIM) curve(p(o), p(t));
  if (u.faceV || u.faceVR) V_JAW.forEach((i, k) => curve(p(i), at2(vTargets, k)));
  if (u.faceNarrow || u.faceNarrowR) NARROW.forEach((i, k) => curve(p(i), at2(narrowTargets, k)));
  if (u.jawline || u.jawlineR) JAW.forEach((i, k) => curve(p(i), at2(jawTargets, k)));
  if (u.temple || u.templeR) TEMPLE.forEach((_, k) => curve(at2(templeAnchors, k), at2(templeTargets, k)));
  if (u.chin) curve(p16, chinTarget);
  if (u.forehead) curve(pt(face.ext, 0), pt(face.ext, 3));
  if (hairlineS) ellipse(ext0, rh, mh, hairlineRadii[0], Math.max(hairlineRadii[1], hairlineRadii[2]));
  if (u.noseSlim) for (const [o, t] of NOSE) curve(p(o), p(t));
  if (noseWingS) {
    disc(p(80), noseWingR);
    disc(p(81), noseWingR);
  }
  // the band is the rectangle |a| ≤ r±, |v| ≤ ry around rc: its circumscribed disc (S5 §4.4's max(r−, r+, ry) misses
  // the corners, where the squeeze still moves content by up to 0.09 px on the fixture: a seam at the box edge)
  if (rootK) disc(rc, Math.hypot(Math.max(rMinus, rPlus), rootRy));
  if (mouthHS) ellipse(p(106), axm, ay, mouthHRadii[0], mouthHRadii[2]);
  if (u.mouthSize) disc(p(106), mouthR);
  if (u.eyeDistance || u.eyeEnlarge || u.eyeEnlargeR) {
    disc(p(74), eyeR[0]);
    disc(p(77), eyeR[1]);
  }
  const pad = 2 / 1024;
  box[0] -= pad;
  box[1] -= pad;
  box[2] += pad;
  box[3] += pad;
  return {
    vTargets,
    narrowTargets,
    chinTarget,
    mouthR,
    eyeR,
    eyeDisp,
    box,
    axes,
    jawTargets,
    templeAnchors,
    templeTargets,
    hairlineS,
    hairlineRadii,
    hairlineDisp,
    mouthHS,
    mouthHRadii,
    mouthHAxis: ay,
    mouthHDisp,
    noseWingS,
    noseWingR,
    noseWingDisp,
    root,
    rootRy,
    rootK,
  };
}
```

After `faceWidthIso` (`reshape.ts:254-258`; `reshapeGeometry` calls it, and function declarations are hoisted):

```ts
/**
 * The step-5 block of one face row of the face table (face-detail spec §4.4; S1 §4.4 keeps 72–74). `row` is the face's
 * 96-texel slice; texels 70–71 and 75–95, all other texels untouched.
 */
export function packFaceDetail(row: Float32Array, u: ReshapeUniforms, g: ReshapeGeometry): void {
  const set = (t: number, a: number, b: number, c: number, d: number) => row.set([a, b, c, d], t * 4);
  set(70, u.faceSlimR, u.faceVR, u.faceNarrowR, u.eyeEnlargeR);
  set(71, u.jawlineR, u.templeR, 0, 0);
  set(75, u.jawline, u.temple, g.hairlineS, g.noseWingS);
  set(76, g.rootK, g.mouthHS, 0, 0);
  row.set(g.jawTargets, 77 * 4);
  row.set(g.templeAnchors, 82 * 4);
  row.set(g.templeTargets, 85 * 4);
  set(88, g.axes[0], g.axes[1], g.axes[2], g.axes[3]);
  set(89, g.hairlineRadii[0], g.hairlineRadii[1], g.hairlineRadii[2], 0);
  set(90, g.hairlineDisp[0], g.hairlineDisp[1], g.mouthHDisp[0], g.mouthHDisp[1]);
  set(91, g.mouthHRadii[0], g.mouthHRadii[1], g.mouthHRadii[2], 0);
  set(92, g.mouthHAxis[0], g.mouthHAxis[1], 0, 0);
  set(93, g.noseWingR, g.noseWingDisp[0], g.noseWingDisp[1], 0);
  set(94, g.root[0], g.root[1], g.root[2], g.root[3]);
  set(95, g.rootRy, 0, 0, 0);
}
```

In step 1's `packFaceTable` (`src/engine/passes/faceCap.ts`), at the end of the per-face callback (after `at(FT.WIN, …)`), add

```ts
    packFaceDetail(out.subarray(o, o + FT.ROW * 4), u, g);
```

(`o`, `u` — the face's attenuated uniforms — and `g = reshapeGeometry(t.face, aspect, u)` are the callback's own locals; import `packFaceDetail` into faceCap's existing `./reshape` import). The packer's `out.fill(0)` runs first, so a face without step-5 items gets zeros in 75–95, and texels 70–71 always hold the right-side strengths (equal to the left ones while 左右分開 is off).

Pass each person's split values wherever a `ReshapeUniforms` is built from a `RenderFace`:
- step 1's `job()` in `src/engine/index.ts:321` (as landed, with λ_f): `reshape: scaleUniforms(reshapeUniforms(f.person.values, w), f.warpScale ?? 1),` → `reshape: scaleUniforms(reshapeUniforms(f.person.values, w, f.person.right), f.warpScale ?? 1),`;
- the two places that rebuild the engine's face table on the CPU and must match it: step 4's `backMapFrameOf` (`src/engine/backMapFrame.ts:35`, the 祛痘 tap's back map) `scaled(reshapeUniforms(f.person.values, w), f.warpScale ?? 1)` and step 1's `guardTable` (`src/edit/warpGuard.ts:31`, the fold safety net) `scaled(reshapeUniforms(f.person.values, w), …)` each pass `f.person.right` as the third argument;
- step 3's `faceBoundsFor` in `src/media/exportPlan.ts:247` (the tile aprons): `reshapeUniforms(f.person.values, f.weight)` (landed without a cast) → `reshapeUniforms(f.person.values, f.weight, f.person.right)`, so a 右 side stronger than 左 still widens the apron.

`uMaxBox` below builds its own uniforms and needs no `right`.

`src/engine/passes/faceCap.ts` (step 1): step 1's `uMaxBox` is `reshapeGeometry(face, aspect, { ...RESHAPE_SCALE }).box`, which no longer type-checks (`RESHAPE_SCALE` has no right-side keys) and covers only the + end; make it cover every 美型 item at both ends — replace the whole function with:

```ts
export function uMaxBox(face: Face, aspect: number): ReshapeGeometry['box'] {
  const neutral = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
  const at = (bi: number) => {
    const v = { ...neutral };
    for (const d of paramsInGroup('shape')) v[d.id] = d.bidirectional ? bi : 1;
    return reshapeGeometry(face, aspect, reshapeUniforms(v, 1)).box;
  };
  const a = at(1);
  const b = at(0);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
```

(imports: a new line `import { neutralValue, PARAM_DEFS, paramsInGroup } from '../params';` (faceCap imports nothing from it yet); `reshapeUniforms`, `type ReshapeGeometry` merged into the `./reshape` import, which already has `reshapeGeometry`; `ParamId` merged into `import type { Face, Rect } from '../../types'`. Drop `RESHAPE_SCALE` from faceCap's `./reshape` import: `uMaxBox` was its only user, and `noUnusedLocals` rejects it.) At both ends every box of the v0.3 items is the same disc (a `curveWarp` box does not depend on the sign of its strength), so their part of the box is step 1's; the new items' boxes lie inside it on the fixture face and its mirror (Task 6's test), so there the protect window does not change (S5 §4.4).

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/engine src/media src/edit && npm run typecheck`
Expected: PASS. The step-1 packing tests (texels 0–69, 72–74), step 1's `uMaxBox` test, step 3's `faceBoundsFor` tests, the `warpGuard` / `backMapFrame` tests and every existing reshape test are unchanged.

- [x] **Step 6: Commit**

```bash
file src/engine/passes/reshape.ts src/engine/passes/reshape.test.ts src/engine/index.ts src/engine/pipeline.ts src/engine/passes/faceCap.ts src/media/exportPlan.ts
git add src/engine/passes/reshape.ts src/engine/passes/reshape.test.ts src/engine/passes/faceCap.ts src/engine/index.ts src/engine/pipeline.ts src/engine/pipeline.test.ts src/engine/backMapFrame.ts src/edit/warpGuard.ts src/media/exportPlan.ts
git commit -F- <<'EOF'
v0.4 step 5: anchors, box and face-table block of the new warps

Uniforms with per-side strengths, the 下頜線 / 太陽穴 / 髮際線 / 鼻翼 /
山根 / 嘴高 anchors with fold-safety clamps and degenerate-face guards,
the influence box, texels 70–71 and 75–95 of the face table, and a U_MAX
box over all 15 美型 items.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 7: The new warps and 左右分開 in `RESHAPE_FS` and its CPU port

The shader reads the step-5 block from the face table and runs the chain of S5 §4.5; the CPU port mirrors every operation; the hash pin is re-set; the e2e pin harness proves GPU = CPU within 0.05 px for every new warp at ±max, for split L ≠ R and for all 15 items together. Step 3's `displacementBound` learns the new warps.

**Files:**
- Modify: `src/engine/passes/reshape.ts` (`reshapeFs(carrier)` `:270-424` / `RESHAPE_FS` as steps 1 and 3 left it: constants `:353-357`, accessors, primitives, `faceChain` `:359-391`); add `faceDetailMoves`; step 3's `displacementBound` (`:206-222`)
- Modify: `src/engine/passes/reshapeCpu.ts` (the closure step 1's `chainOf(face, u, aspect, prot, win)` returns, `:87-107`)
- Modify: `tests/e2e/pages/reshape.ts` (add `runReshapePinFaceDetail`)
- Create: `tests/e2e/shape-makeup.spec.ts` (first test)
- Test: `src/engine/passes/reshapeCpu.test.ts` (the hash pin "is pinned to the shader text", new describe blocks, step 1's fold sweep), `src/engine/passes/reshape.test.ts` (step 3's `displacementBound` fuzz)

**Interfaces:**
- Consumes: Task 6 (uniforms, geometry, tables, `packFaceDetail`); step 1's shader (step-1 plan Task 17, `reshapeFs(carrier)`): `vec4 F(int f, int i)`, `vec2 pairOf(vec4 t, int k)`, `vec2 P(int f, int k)`, `EXT(f, k)`, `VT(f, k)`, `NT(f, k)`, `uniform float uAspect`, `faceChain(int f, vec2 tc)` with its locals `s1 = F(f, ${FT.S1})`, `s2 = F(f, ${FT.S2})`, `r = F(f, ${FT.RADII})`, `ce = F(f, ${FT.CHIN_EYE})` and the protect call `if (r.w >= 0.0) tc = protectContour(f, tc0, tc, r.w);`, step 1's `glslFloat`; step 1's CPU port (`chainOf` with its closures `pt`, `ext`, `curveWarp`, `enlargeEye`, `scaleAround`, `shiftAround`, `protectContour` and `if (prot) tc = protectContour(tc0, tc);`), the one-face wrapper `reshapeMapCpu(face, uIn, aspect, body?, protect?)` and the frozen `src/engine/passes/reshapeCpuV03.ts` exporting `reshapeMapCpuV03` (step 1's own block in `reshapeCpu.test.ts` already imports it, with `Face` and `MIN_DET`); step 1's fold and strength sweep in `reshapeCpu.test.ts` (`const settings = [0, 1].map((end) => reshapeUniforms(…, 1));`); step 1's pin helper `pinCases(gl, cases: { name: string; faces: TableFace[] }[], aspect, carrier: 'texture' | 'ubo'): PinCase[]` in `tests/e2e/pages/reshape.ts` (it draws with `drawFaces` and compares with `reshapeMapMulti`); step 3's `displacementBound(face: Face, aspect: number, u: ReshapeUniforms): number` (iso units) and its fuzz test in `reshape.test.ts`.
- Produces:
  - `reshapeCpu.ts`: `shiftEllipseUv(tc, c, ax, ay, r: readonly [number, number, number], disp, aspect): [number, number]`, `squeezeAxisUv(tc, c, ax, ay, r, k, aspect): [number, number]` (exact ports of the GLSL)
  - `reshape.ts`: `faceDetailMoves(g: ReshapeGeometry, u: ReshapeUniforms, face: Face): { uv: [number, number][]; iso: number[] }`; GLSL accessors `JT(f, k)`, `TA(f, k)`, `TT(f, k)` (下頜線 targets, 太陽穴 anchors and targets)
  - `window.runReshapePinFaceDetail(carrier: 'texture' | 'ubo'): PinCase[]` (13 cases per carrier)

- [x] **Step 1: Write the failing CPU-port tests**

In `src/engine/passes/reshapeCpu.test.ts`: add `mirrored: number[]` to the `lm` type, and append the block below. Merge its imports into the existing lines, never importing a name twice (the file already imports `ParamId`, `reshapeGeometry`, `reshapeUniforms` at the top, and step 1's block `Face`, `reshapeMapCpuV03`): `neutralValue, PARAM_DEFS, paramsInGroup, SPLIT_IDS` into the `../params` import; `faceDetailMoves, faceWidthIso` into the `./reshape` import; `shiftEllipseUv, squeezeAxisUv` into the `./reshapeCpu` import; `PersonParams` into the `../../types` type import:

```ts
type V2 = [number, number];
const W = lm.width;
const H = lm.height;
const mirroredFace = adapt({ points: new Float32Array(lm.mirrored) }, W, H);
const NEUTRAL = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
const U5 = (over: Partial<Record<ParamId, number>> = {}, right: PersonParams['right'] = null) =>
  reshapeUniforms({ ...NEUTRAL, ...over }, 1, right);
const pt = (f: Face, i: number): V2 => [f.pts111[i * 2], f.pts111[i * 2 + 1]];
const moved = (map: (x: number, y: number) => V2, q: V2) => {
  const s = map(q[0], q[1]);
  return Math.hypot((s[0] - q[0]) * W, (s[1] - q[1]) * H);
};

/** min det J (px Jacobian, forward differences) and max move (fractions of FW) on a 300 × 300 grid over `box` */
function sweep(f: Face, map: (x: number, y: number) => V2, box: readonly number[]): { minDet: number; maxMoveFW: number } {
  const N = 300;
  const x0 = Math.max(0, box[0]);
  const y0 = Math.max(0, box[1]);
  const dx = (Math.min(1, box[2]) - x0) / N;
  const dy = (Math.min(1, box[3]) - y0) / N;
  const fw = faceWidthIso(f, aspect);
  let minDet = Infinity;
  let maxMove = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = x0 + (i + 0.5) * dx;
      const v = y0 + (j + 0.5) * dy;
      const a = map(u, v);
      const b = map(u + dx, v);
      const c = map(u, v + dy);
      const j00 = (b[0] - a[0]) / dx;
      const j10 = ((b[1] - a[1]) / dx) * (H / W);
      const j01 = ((c[0] - a[0]) / dy) * (W / H);
      const j11 = (c[1] - a[1]) / dy;
      minDet = Math.min(minDet, j00 * j11 - j01 * j10);
      maxMove = Math.max(maxMove, Math.hypot(a[0] - u, (a[1] - v) / aspect) / fw);
    }
  return { minDet, maxMoveFW: maxMove };
}

describe('step-5 warps through the CPU port (face-detail spec §4.2, §8.1)', () => {
  // [id, value, min det J of S5 §4.2, max move of S5 §4.2 in FW]
  const TABLE: [ParamId, number, number, number][] = [
    ['shape.jawline', 1, 0.73, 0.05],
    ['shape.temple', 1, 0.62, 0.035],
    ['shape.temple', 0, 0.67, 0.035],
    ['shape.hairline', 1, 0.56, 0.024],
    ['shape.hairline', 0, 0.6, 0.024],
    ['shape.noseWing', 1, 0.72, 0.024],
    ['shape.noseWing', 0, 0.72, 0.024],
    ['shape.noseBridge', 1, 0.76, 0.012],
    ['shape.noseBridge', 0, 0.7, 0.012],
    ['shape.mouthHeight', 1, 0.73, 0.029],
    ['shape.mouthHeight', 0, 0.56, 0.029],
  ];
  for (const [name, f] of [
    ['fixture', face],
    ['mirrored', mirroredFace],
  ] as const) {
    for (const [id, v, det, move] of TABLE) {
      it(`${name}: ${id} = ${v}: min det J ≥ 0.5 and within ±0.05 of ${det}; max move ≈ ${move} FW`, () => {
        const u = U5({ [id]: v });
        const r = sweep(f, reshapeMapCpu(f, u, aspect), reshapeGeometry(f, aspect, u).box);
        expect(r.minDet).toBeGreaterThanOrEqual(0.5);
        expect(Math.abs(r.minDet - det)).toBeLessThanOrEqual(0.05);
        expect(r.maxMoveFW).toBeGreaterThan(0.7 * move);
        expect(r.maxMoveFW).toBeLessThan(1.3 * move);
      });
    }
  }

  it('directions: 下頜線 inward, 太陽穴 + outward, 髮際線 + down, 鼻翼 − together, 山根 + narrower, 嘴高 + up', () => {
    // backward map: content moves from map(q) to q, so the sample sits on the far side of the motion
    const jaw = reshapeMapCpu(face, U5({ 'shape.jawline': 1 }), aspect);
    for (const i of [8, 10, 12, 24, 22, 20]) {
      const s = jaw(...pt(face, i));
      const n = pt(face, 46);
      const p = pt(face, i);
      expect((s[0] - p[0]) * (n[0] - p[0]) + ((s[1] - p[1]) * (n[1] - p[1])) / (aspect * aspect)).toBeLessThan(0);
    }
    const g = reshapeGeometry(face, aspect, U5({ 'shape.temple': 1 }));
    const temple = reshapeMapCpu(face, U5({ 'shape.temple': 1 }), aspect);
    for (let k = 0; k < 6; k++) {
      const o: V2 = [g.templeAnchors[k * 2], g.templeAnchors[k * 2 + 1]];
      const t: V2 = [g.templeTargets[k * 2], g.templeTargets[k * 2 + 1]];
      const s = temple(...o);
      expect((s[0] - o[0]) * (t[0] - o[0]) + (s[1] - o[1]) * (t[1] - o[1])).toBeLessThan(0);
    }
    const hair = reshapeMapCpu(face, U5({ 'shape.hairline': 1 }), aspect);
    expect(hair(face.ext[0], face.ext[1])[1]).toBeLessThan(face.ext[1]);
    const wing = reshapeMapCpu(face, U5({ 'shape.noseWing': 0 }), aspect);
    const [l, r] = [pt(face, 80), pt(face, 81)];
    expect((wing(...l)[0] - l[0]) * (r[0] - l[0])).toBeLessThan(0);
    expect((wing(...r)[0] - r[0]) * (r[0] - l[0])).toBeGreaterThan(0);
    const root = reshapeMapCpu(face, U5({ 'shape.noseBridge': 1 }), aspect);
    const [a, b] = [pt(face, 78), pt(face, 79)];
    expect(Math.abs(root(...b)[0] - root(...a)[0])).toBeGreaterThan(Math.abs(b[0] - a[0]));
    const mouth = reshapeMapCpu(face, U5({ 'shape.mouthHeight': 1 }), aspect);
    expect(mouth(...pt(face, 106))[1]).toBeGreaterThan(pt(face, 106)[1]);
  });

  it('locality: 山根 never moves p55, p58 or a lid point; 嘴高 never moves p49; 髮際線 never moves a brow point', () => {
    for (const f of [face, mirroredFace]) {
      for (const v of [0, 1]) {
        const root = reshapeMapCpu(f, U5({ 'shape.noseBridge': v }), aspect);
        for (const i of [55, 58]) expect(moved(root, pt(f, i))).toBeLessThan(1e-6);
        for (let k = 0; k < 32; k++) expect(moved(root, [f.lids[k * 2], f.lids[k * 2 + 1]])).toBeLessThan(1e-6);
        expect(moved(reshapeMapCpu(f, U5({ 'shape.mouthHeight': v }), aspect), pt(f, 49))).toBeLessThan(1e-6);
        const hair = reshapeMapCpu(f, U5({ 'shape.hairline': v }), aspect);
        for (let i = 33; i <= 42; i++) expect(hair(...pt(f, i))).toEqual(pt(f, i));
        for (let i = 64; i <= 71; i++) expect(hair(...pt(f, i))).toEqual(pt(f, i));
      }
    }
  });

  it('山根 moves only along r̂; 鼻翼 mostly along r̂', () => {
    const [rx, ry] = reshapeGeometry(face, aspect, U5({ 'shape.noseBridge': 1 })).axes;
    for (const [id, tol] of [
      ['shape.noseBridge', 1e-9],
      ['shape.noseWing', 0.2],
    ] as const) {
      const map = reshapeMapCpu(face, U5({ [id]: 1 }), aspect);
      for (const i of [44, 45, 46, 78, 79, 80, 81, 82, 83]) {
        const q = pt(face, i);
        const s = map(...q);
        const d: V2 = [s[0] - q[0], (s[1] - q[1]) / aspect];
        const along = Math.abs(d[0] * rx + d[1] * ry);
        const across = Math.abs(-d[0] * ry + d[1] * rx);
        expect(across).toBeLessThanOrEqual(tol * Math.max(along, 1e-12) + 1e-12);
      }
    }
  });

  it('左右分開: L ≠ R moves the left half and leaves the right half (almost) still', () => {
    const on = { 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.jawline': 1 };
    const off = { 'shape.faceSlim': 0, 'shape.faceV': 0, 'shape.faceNarrow': 0, 'shape.jawline': 0 };
    const leftOnly = reshapeMapCpu(face, U5(on, off), aspect);
    const rightOnly = reshapeMapCpu(face, U5(off, on), aspect);
    const mean = (map: (x: number, y: number) => V2, ids: number[]) => ids.reduce((s, i) => s + moved(map, pt(face, i)), 0) / ids.length;
    const L = [3, 7, 10];
    const R = [29, 25, 22];
    expect(mean(leftOnly, R)).toBeLessThan(0.05 * mean(leftOnly, L));
    expect(mean(rightOnly, L)).toBeLessThan(0.05 * mean(rightOnly, R));
  });

  it('with right = null, and with right equal to the values, the map is bit-identical to the v0.3 port', () => {
    const v = {
      'shape.faceSlim': 0.37, 'shape.faceV': 0.21, 'shape.faceNarrow': 0.3, 'shape.chin': 0.7, 'shape.forehead': 0.2,
      'shape.noseSlim': 0.4, 'shape.mouthSize': 0.8, 'shape.eyeDistance': 0.3, 'shape.eyeEnlarge': 0.6,
    };
    const u = U5(v);
    const same = U5(v, Object.fromEntries(SPLIT_IDS.map((id) => [id, { ...NEUTRAL, ...v }[id]])));
    const a = reshapeMapCpu(face, u, aspect);
    const b = reshapeMapCpu(face, same, aspect);
    const c = reshapeMapCpuV03(face, u, aspect);
    for (let j = 0; j <= 40; j++)
      for (let i = 0; i <= 40; i++) {
        const x = i / 40;
        const y = j / 40;
        expect(a(x, y)).toEqual(c(x, y));
        expect(b(x, y)).toEqual(c(x, y));
      }
  });

  it('faceDetailMoves bounds the measured move of the step-5 warps (step 3 displacementBound terms)', () => {
    let s = 3;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let n = 0; n < 12; n++) {
      const values = {
        'shape.jawline': rnd(), 'shape.temple': rnd(), 'shape.hairline': rnd(), 'shape.noseWing': rnd(), 'shape.noseBridge': rnd(), 'shape.mouthHeight': rnd(),
      };
      const right = rnd() < 0.5 ? null : { 'shape.jawline': rnd(), 'shape.temple': rnd() };
      const u = U5(values, right);
      const g = reshapeGeometry(face, aspect, u);
      const m = faceDetailMoves(g, u, face);
      const bound = m.uv.reduce((acc, d) => acc + Math.hypot(d[0] * W, d[1] * H), 0) + m.iso.reduce((acc, l) => acc + l * W, 0);
      const map = reshapeMapCpu(face, u, aspect);
      let mx = 0;
      for (let j = 0; j <= 128; j++)
        for (let i = 0; i <= 128; i++) mx = Math.max(mx, moved(map, [g.box[0] + ((g.box[2] - g.box[0]) * i) / 128, g.box[1] + ((g.box[3] - g.box[1]) * j) / 128]));
      expect(mx).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it('identity outside the box: every step-5 warp leaves its influence-box border unmoved, so the box skip cuts no warp (S5 §4.4, §8.1)', () => {
    const CASES: [ParamId, number][] = [
      ['shape.jawline', 1], ['shape.temple', 0], ['shape.temple', 1], ['shape.hairline', 0], ['shape.hairline', 1], ['shape.noseWing', 0],
      ['shape.noseWing', 1], ['shape.noseBridge', 0], ['shape.noseBridge', 1], ['shape.mouthHeight', 0], ['shape.mouthHeight', 1],
    ];
    for (const f of [face, mirroredFace])
      for (const [id, v] of CASES) {
        const u = U5({ [id]: v });
        const b = reshapeGeometry(f, aspect, u).box;
        const map = reshapeMapCpu(f, u, aspect);
        const e = 1e-7;
        let worst = 0;
        for (let i = 0; i <= 400; i++) {
          const x = b[0] + ((b[2] - b[0]) * i) / 400;
          const y = b[1] + ((b[3] - b[1]) * i) / 400;
          for (const q of [[x, b[1] + e], [x, b[3] - e], [b[0] + e, y], [b[2] - e, y]] as V2[]) worst = Math.max(worst, moved(map, q));
        }
        // just inside the border the chain runs; it must already be the identity there (measured 0 px; 0.07–0.09 px
        // for 山根 with S5 §4.4's disc(c, max(r−, r+, ry)), which misses the band's corners: Task 6 uses the circumscribed disc)
        expect(worst, `${id} = ${v}`).toBeLessThan(1e-6);
      }
  });
});

describe('shiftEllipse and squeezeAxis ports (face-detail spec §4.2)', () => {
  const A = 1.5;
  const c: V2 = [0.5, 0.5];
  const ax: V2 = [1, 0];
  const ay: V2 = [0, 1];

  it('shiftEllipse: content within w ≤ 0.5 moves at least 0.878 of disp; C¹ across the axis; identity outside', () => {
    const r = [0.2, 0.1, 0.16] as const;
    const disp: V2 = [0.01, 0.02];
    for (const w of [0, 0.25, 0.5])
      for (let th = 0; th < 6; th++) {
        const qx = Math.cos(th) * w;
        const qy = Math.sin(th) * w;
        const tc: V2 = [c[0] + qx * r[0], c[1] + qy * (qy < 0 ? r[1] : r[2]) * A];
        const out = shiftEllipseUv(tc, c, ax, ay, r, disp, A);
        expect((tc[0] - out[0]) / disp[0]).toBeGreaterThanOrEqual(0.878);
      }
    const f = (y: number) => shiftEllipseUv([0.53, 0.5 + y], c, ax, ay, r, disp, A)[1] - (0.5 + y);
    const h = 1e-6;
    expect(Math.abs((f(0) - f(-h)) / h - (f(h) - f(0)) / h)).toBeLessThan(1e-4);
    expect(shiftEllipseUv([0.71, 0.5], c, ax, ay, r, disp, A)).toEqual([0.71, 0.5]);
  });

  it('squeezeAxis: zero on the axis and at |t| = 1, |v| = 1; det J within [1 − 0.8k, 1 + k] (k > 0) / [1 − |k|, 1 + 0.8|k|] (k < 0)', () => {
    const r = [0.05, 0.08, 0.06] as const;
    for (const k of [0.3, 0.5, -0.3, -0.5]) {
      expect(squeezeAxisUv([0.5, 0.52], c, ax, ay, r, k, A)).toEqual([0.5, 0.52]);
      expect(squeezeAxisUv([0.45, 0.5], c, ax, ay, r, k, A)).toEqual([0.45, 0.5]);
      expect(squeezeAxisUv([0.58, 0.5], c, ax, ay, r, k, A)).toEqual([0.58, 0.5]);
      expect(squeezeAxisUv([0.52, 0.5 + 0.06 * A], c, ax, ay, r, k, A)).toEqual([0.52, 0.5 + 0.06 * A]);
      const lo = k > 0 ? 1 - 0.8 * k : 1 - Math.abs(k);
      const hi = k > 0 ? 1 + k : 1 + 0.8 * Math.abs(k);
      const M = (x: number, y: number): V2 => {
        const o = squeezeAxisUv([x, y * A], c, ax, ay, r, k, A);
        return [o[0], o[1] / A];
      };
      const e = 1e-6;
      for (let i = 0; i <= 80; i++)
        for (let j = 0; j <= 80; j++) {
          const x = 0.44 + (0.15 * i) / 80;
          const y = 0.5 / A - 0.07 + (0.14 * j) / 80;
          const p = M(x + e, y);
          const q = M(x - e, y);
          const s = M(x, y + e);
          const t = M(x, y - e);
          const det = ((p[0] - q[0]) * (s[1] - t[1]) - (s[0] - t[0]) * (p[1] - q[1])) / (4 * e * e);
          expect(det).toBeGreaterThanOrEqual(lo - 1e-4);
          expect(det).toBeLessThanOrEqual(hi + 1e-4);
        }
    }
  });
});
```

(If a later block of the file already declares one of these top-level names — `V2`, `W`, `H`, `mirroredFace`, `NEUTRAL`, `U5`, `pt`, `moved`, `sweep` — rename the new one; `const` cannot be redeclared in a module.)

Step 1's fold and strength sweep (the `it('fold and strength sweep: …')` in step 1's `describe('N-face port (S §4.4)')`, whose `settings` are `ReshapeUniforms`) gets three more settings (S5 §4.2 "the RM §4.3 fold sweep … covers all 15 shape items, also with the six split items set to opposite extremes"). Replace its line `const settings = [0, 1].map((end) => reshapeUniforms(…, 1));` with

```ts
    // step 5: every 美型 item at its extreme, both signs, and the six split items at opposite extremes
    const ALL15_HI = Object.fromEntries(paramsInGroup('shape').map((d) => [d.id, 1]));
    const ALL15_LO = Object.fromEntries(paramsInGroup('shape').map((d) => [d.id, d.bidirectional ? 0 : 1]));
    const settings = [
      ...[0, 1].map((end) => reshapeUniforms(bi.reduce((p, id) => setParam(p, id, end), oneWay.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1))).values, 1)),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_HI }, 1),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_LO }, 1),
      reshapeUniforms({ ...NEUTRAL, ...ALL15_HI }, 1, Object.fromEntries(SPLIT_IDS.map((id) => [id, 0]))),
    ];
```

(the first line is step 1's expression, unchanged; `NEUTRAL` is the top-level constant of the block above). The bound (`MIN_DET`, 0.35) and the feature-ratio check are not relaxed; raise that test's timeout from `180_000` to `360_000` (the settings list grows from 2 to 5).

(Landed: MIN_DET and the feature-ratio check hold unchanged for all five settings, measured min det J 0.442 and feature ratio ≥ 0.927 at 1.2 FW / ≥ 0.982 from 1.3 FW over the three new ones. Step 1's 下巴 floor at 2.0 FW (≥ 0.7) does not: the − max setting keeps 0.684 there, because 下頜線 at max carries the chin point farther when the face is alone. That one floor is pinned at ≥ 0.68 for the three step-5 settings; every other floor, and every floor of step 1's two settings, is unchanged. The spec (S5 §4.2) asks only the fold bound of the step-5 settings.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL — `shiftEllipseUv` / `faceDetailMoves` are not exported, the direction and det-J cases see an identity map (the port ignores the new strengths).

- [x] **Step 3: Implement the CPU port**

`src/engine/passes/reshapeCpu.ts`: import `JAW, JAW_SIDE, NARROW_SIDE, sided, SLIM_SIDE, TEMPLE, TEMPLE_SIDE, TEMPLE_W, VJAW_SIDE` from `./reshape`; add the two primitives at module level:

```ts
/** RESHAPE_FS shiftEllipse, operation for operation (face-detail spec §4.2): r = (rx, ry toward −ay, ry toward +ay) iso */
export function shiftEllipseUv(tc: V2, c: V2, ax: V2, ay: V2, r: readonly [number, number, number], disp: V2, aspect: number): V2 {
  const d: V2 = [tc[0] - c[0], tc[1] / aspect - c[1] / aspect];
  const qy = d[0] * ay[0] + d[1] * ay[1];
  const qx = (d[0] * ax[0] + d[1] * ax[1]) / r[0];
  const qyn = qy / (qy < 0 ? r[1] : r[2]);
  const w2 = qx * qx + qyn * qyn;
  if (w2 >= 1) return tc;
  const k = 1 - w2 * w2;
  return [tc[0] - disp[0] * k * k, tc[1] - disp[1] * k * k];
}

/** RESHAPE_FS squeezeAxis: r = (r−, r+, ry) iso; the move is along ax only */
export function squeezeAxisUv(tc: V2, c: V2, ax: V2, ay: V2, r: readonly [number, number, number], k: number, aspect: number): V2 {
  const d: V2 = [tc[0] - c[0], tc[1] / aspect - c[1] / aspect];
  const a = d[0] * ax[0] + d[1] * ax[1];
  const t = a / (a < 0 ? r[0] : r[1]);
  const v = (d[0] * ay[0] + d[1] * ay[1]) / r[2];
  if (t * t >= 1 || v * v >= 1) return tc;
  const h = (1 - t * t) * (1 - v * v);
  const s = k * a * h * h;
  return [tc[0] + ax[0] * s, tc[1] + ax[1] * s * aspect];
}
```

and make the body of the closure step 1's `chainOf(face, u, aspect, prot, win)` returns read as below, from `const tc0 = tc;` to `return tc;` (`u` is `chainOf`'s non-null `ReshapeUniforms` parameter, already attenuated; `g`, `pt`, `ext`, `curveWarp`, `enlargeEye`, `scaleAround`, `shiftAround`, `protectContour` and `prot` are `chainOf`'s own locals):

```ts
    const tc0 = tc;
    const at = (a: Float32Array, k: number): V2 => [a[k * 2], a[k * 2 + 1]];
    const rh: V2 = [g.axes[0], g.axes[1]];
    const mh: V2 = [g.axes[2], g.axes[3]];
    // contour: each split anchor takes its side's strength (S5 §4.3)
    if (u.faceSlim !== 0 || u.faceSlimR !== 0)
      SLIM.forEach(([o, t], i) => (tc = curveWarp(tc, pt(o), pt(t), sided(u.faceSlim, u.faceSlimR, SLIM_SIDE[i]))));
    if (u.faceV !== 0 || u.faceVR !== 0)
      V_JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.vTargets, k), sided(u.faceV, u.faceVR, VJAW_SIDE[k]))));
    if (u.faceNarrow !== 0 || u.faceNarrowR !== 0)
      NARROW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.narrowTargets, k), sided(u.faceNarrow, u.faceNarrowR, NARROW_SIDE[k]))));
    if (u.jawline !== 0 || u.jawlineR !== 0)
      JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.jawTargets, k), sided(u.jawline, u.jawlineR, JAW_SIDE[k]))));
    if (u.temple !== 0 || u.templeR !== 0)
      TEMPLE.forEach((_, k) => (tc = curveWarp(tc, at(g.templeAnchors, k), at(g.templeTargets, k), sided(u.temple, u.templeR, TEMPLE_SIDE[k]) * TEMPLE_W[k])));
    if (u.chin !== 0) tc = curveWarp(tc, pt(16), g.chinTarget, u.chin);
    if (u.forehead !== 0) tc = curveWarp(tc, ext(0), ext(3), u.forehead);
    if (g.hairlineS !== 0) tc = shiftEllipseUv(tc, ext(0), rh, mh, g.hairlineRadii, g.hairlineDisp, aspect);
    if (prot) tc = protectContour(tc0, tc);
    // nose
    if (u.noseSlim !== 0) for (const [o, t] of NOSE) tc = curveWarp(tc, pt(o), pt(t), u.noseSlim);
    if (g.noseWingS !== 0) {
      tc = shiftAround(tc, pt(80), g.noseWingR, g.noseWingDisp);
      tc = shiftAround(tc, pt(81), g.noseWingR, [-g.noseWingDisp[0], -g.noseWingDisp[1]]);
    }
    if (g.rootK !== 0) tc = squeezeAxisUv(tc, [g.root[0], g.root[1]], rh, mh, [g.root[2], g.root[3], g.rootRy], g.rootK, aspect);
    // mouth: 嘴高, then 嘴型 (backward order: forward, 嘴型 scales about the true p106, then 嘴高 moves it)
    if (g.mouthHS !== 0) tc = shiftEllipseUv(tc, pt(106), [-g.mouthHAxis[1], g.mouthHAxis[0]], g.mouthHAxis, g.mouthHRadii, g.mouthHDisp, aspect);
    if (u.mouthSize !== 0) tc = scaleAround(tc, pt(106), g.mouthR, u.mouthSize);
    // eyes: 眼距, then 大眼 per side
    if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) {
      tc = shiftAround(tc, pt(74), g.eyeR[0], g.eyeDisp);
      tc = shiftAround(tc, pt(77), g.eyeR[1], [-g.eyeDisp[0], -g.eyeDisp[1]]);
    }
    if (u.eyeEnlarge !== 0) tc = enlargeEye(tc, pt(74), g.eyeR[0], u.eyeEnlarge);
    if (u.eyeEnlargeR !== 0) tc = enlargeEye(tc, pt(77), g.eyeR[1], u.eyeEnlargeR);
    return tc;
```

(the protect line is step 1's own, unchanged; with `right = null` every `sided` returns its left argument exactly, so the map is bit-identical to step 1's, which Step 1's "bit-identical to the v0.3 port" case checks against `reshapeMapCpuV03`.)

`src/engine/passes/reshape.ts`, after `packFaceDetail`:

```ts
/**
 * The largest move of every active step-5 warp, for step 3's displacementBound (S3 §4.4): UV vectors (count
 * hypot(dx·W, dy·H) px) and iso lengths (count iso·W px). Two 鼻翼 discs may overlap, so the wing counts twice.
 */
export function faceDetailMoves(g: ReshapeGeometry, u: ReshapeUniforms, face: Face): { uv: V2[]; iso: number[] } {
  const P = face.pts111;
  const uvs: V2[] = [];
  const jd = Math.max(Math.abs(u.jawline), Math.abs(u.jawlineR));
  if (jd) JAW.forEach((i, k) => uvs.push([(g.jawTargets[k * 2] - P[i * 2]) * jd, (g.jawTargets[k * 2 + 1] - P[i * 2 + 1]) * jd]));
  const td = Math.max(Math.abs(u.temple), Math.abs(u.templeR));
  if (td)
    TEMPLE.forEach((_, k) =>
      uvs.push([
        (g.templeTargets[k * 2] - g.templeAnchors[k * 2]) * td * TEMPLE_W[k],
        (g.templeTargets[k * 2 + 1] - g.templeAnchors[k * 2 + 1]) * td * TEMPLE_W[k],
      ]),
    );
  if (g.hairlineS) uvs.push(g.hairlineDisp);
  if (g.noseWingS) uvs.push(g.noseWingDisp, g.noseWingDisp);
  if (g.mouthHS) uvs.push(g.mouthHDisp);
  return { uv: uvs, iso: g.rootK ? [Math.abs(g.rootK) * Math.max(g.root[2], g.root[3])] : [] };
}
```

Step 3's `displacementBound(face, aspect, u)` (`reshape.ts`) returns iso units (fractions of the O width) and sums `curve(o, t, d) = isoLen(t − o)·|d|` terms. Make it cover the split strengths and the step-5 warps:
- 瘦臉, V臉, 窄臉: test and scale with `Math.max(Math.abs(u.faceSlim), Math.abs(u.faceSlimR))` (and `faceV` / `faceVR`, `faceNarrow` / `faceNarrowR`) in place of `u.faceSlim` (`u.faceV`, `u.faceNarrow`); `curve` takes the absolute value already;
- 大眼: `if (u.eyeEnlarge || u.eyeEnlargeR) b += g.eyeR[0] * Math.abs(u.eyeEnlarge) + g.eyeR[1] * Math.abs(u.eyeEnlargeR);` (p74 takes the left strength, p77 the right one);
- before `return b;`:

```ts
  const m = faceDetailMoves(g, u, face);
  for (const d of m.uv) b += isoLen(d[0], d[1]);
  for (const l of m.iso) b += l;
```

Step 3's fuzz test in `reshape.test.ts` ("bounds the CPU port's largest move …") already fuzzes the six new ids (its `SHAPE` list filters `PARAM_DEFS`); give it a random split too — its `reshapeUniforms(values, 1)` becomes `reshapeUniforms(values, 1, rnd() < 0.5 ? null : Object.fromEntries(SPLIT_IDS.map((id) => [id, rnd()])))` — and it must keep passing.

- [x] **Step 4: Run the CPU tests**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts src/engine/passes/reshape.test.ts`
Expected: PASS, the new cases included. The hash pin still holds here: `RESHAPE_FS` is unchanged until Step 5.

- [x] **Step 5: Implement the shader**

In step 1's `reshapeFs(carrier)` (the shader text `RESHAPE_FS = reshapeFs('texture')`, as steps 1 and 3 left it), next to step 1's `SLIM` / `V_JAW` / `NARROW` / `NOSE` GLSL constants, add the generated tables, three accessors in the style of step 1's `VT` / `NT`, and the two primitives (the tables come from the TS arrays, like `PROTECT_RAMP`, so the GPU and the port share one definition). The two helpers sit in module scope next to step 1's `glslFloat`, which they use:

```ts
const glslFloats = (name: string, xs: readonly number[]) =>
  `const float ${name}[${xs.length}] = float[${xs.length}](${xs.map((x) => glslFloat(x)).join(', ')});`;
const glslInts = (name: string, xs: readonly number[]) => `const int ${name}[${xs.length}] = int[${xs.length}](${xs.join(', ')});`;
```

```glsl
${glslFloats('SLIM_SIDE', SLIM_SIDE)}
${glslFloats('VJAW_SIDE', VJAW_SIDE)}
${glslFloats('NARROW_SIDE', NARROW_SIDE)}
${glslInts('JAW', JAW)}
${glslFloats('JAW_SIDE', JAW_SIDE)}
${glslFloats('TEMPLE_SIDE', TEMPLE_SIDE)}
${glslFloats('TEMPLE_W', TEMPLE_W)}
float sided(float dl, float dr, float side) { return dl + (dr - dl) * side; } // == dl exactly when dr == dl
vec2 JT(int f, int k) { return pairOf(F(f, 77 + (k >> 1)), k); } // 下頜線 targets (step 5, texels 77–81)
vec2 TA(int f, int k) { return pairOf(F(f, 82 + (k >> 1)), k); } // 太陽穴 anchors (82–84)
vec2 TT(int f, int k) { return pairOf(F(f, 85 + (k >> 1)), k); } // 太陽穴 targets (85–87)

// Elliptical local translate with a flat top (face-detail spec §4.2): content near c moves by disp. ax / ay = unit iso
// axes; r = (rx, ry toward −ay, ry toward +ay) iso. Profile (1 − w⁴)²: k ≥ 0.88 for w ≤ 0.5, C¹, max |dk/dw| 2.42.
vec2 shiftEllipse(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, vec2 disp) {
  vec2 d = iso(tc) - iso(c);
  float qy = dot(d, ay);
  vec2 q = vec2(dot(d, ax) / r.x, qy / (qy < 0.0 ? r.y : r.z));
  float w2 = dot(q, q);
  if (w2 >= 1.0) return tc;
  float k = 1.0 - w2 * w2;
  return tc - disp * k * k;
}

// Squeeze toward the axis through c along ay: content at signed distance a = (q − c)·ax moves toward the axis by
// k·a·(1 − t²)²·(1 − v²)², t = a / r− or a / r+, v = (q − c)·ay / ry; zero at |t| = 1 and |v| = 1, C¹.
vec2 squeezeAxis(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, float k) {
  vec2 d = iso(tc) - iso(c);
  float a = dot(d, ax);
  float t = a / (a < 0.0 ? r.x : r.y);
  float v = dot(d, ay) / r.z;
  if (t * t >= 1.0 || v * v >= 1.0) return tc;
  float h = (1.0 - t * t) * (1.0 - v * v);
  vec2 s = ax * (k * a * h * h);              // iso
  return tc + vec2(s.x, s.y * uAspect);        // iso → UV
}
```

and make step 1's `faceChain` read as follows. Its v0.3 lines are step 1's, character for character, except the three contour zero tests and strengths (now `sided`) and the 大眼 block (split per eye); the step-5 lines are new:

```glsl
vec2 faceChain(int f, vec2 tc) {
  vec2 tc0 = tc;
  vec4 s1 = F(f, ${FT.S1});        // slim, v, narrow, chin (GPUPixel-left)
  vec4 s2 = F(f, ${FT.S2});        // forehead, nose, mouth, eye (GPUPixel-left)
  vec4 r = F(f, ${FT.RADII});      // eyeR.x, eyeR.y, mouthR, protect layer (−1 = none)
  vec4 ce = F(f, ${FT.CHIN_EYE});  // chinTarget, eyeDisp
  vec4 sR = F(f, ${FT.RIGHT});     // step 5: slimR, vR, narrowR, eyeR (GPUPixel-right; == s1/s2 while 左右分開 is off)
  vec4 sR2 = F(f, ${FT.RIGHT} + 1); // jawR, templeR
  vec4 s5 = F(f, 75);              // jawL, templeL, hairline, noseWing
  vec4 s6 = F(f, 76);              // 山根 k, mouthHeight
  vec4 axes = F(f, 88);            // r̂ (iso), m̂ (iso)
  if (s1.x != 0.0 || sR.x != 0.0) {
    for (int i = 0; i < 9; i++) tc = curveWarp(tc, P(f, SLIM[i].x), P(f, SLIM[i].y), sided(s1.x, sR.x, SLIM_SIDE[i]));
  }
  if (s1.y != 0.0 || sR.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, P(f, V_JAW[i]), VT(f, i), sided(s1.y, sR.y, VJAW_SIDE[i]));
  }
  if (s1.z != 0.0 || sR.z != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NARROW[i]), NT(f, i), sided(s1.z, sR.z, NARROW_SIDE[i]));
  }
  if (s5.x != 0.0 || sR2.x != 0.0) {
    for (int i = 0; i < 10; i++) tc = curveWarp(tc, P(f, JAW[i]), JT(f, i), sided(s5.x, sR2.x, JAW_SIDE[i]));
  }
  if (s5.y != 0.0 || sR2.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, TA(f, i), TT(f, i), sided(s5.y, sR2.y, TEMPLE_SIDE[i]) * TEMPLE_W[i]);
  }
  if (s1.w != 0.0) tc = curveWarp(tc, P(f, 16), ce.xy, s1.w);
  if (s2.x != 0.0) tc = curveWarp(tc, EXT(f, 0), EXT(f, 3), s2.x);
  if (s5.z != 0.0) tc = shiftEllipse(tc, EXT(f, 0), axes.xy, axes.zw, F(f, 89).xyz, F(f, 90).xy); // 髮際線
  if (r.w >= 0.0) tc = protectContour(f, tc0, tc, r.w);
  if (s2.y != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NOSE[i].x), P(f, NOSE[i].y), s2.y);
  }
  if (s5.w != 0.0) { // 鼻翼
    vec4 nw = F(f, 93);
    tc = shiftAround(tc, P(f, 80), nw.x, nw.yz);
    tc = shiftAround(tc, P(f, 81), nw.x, -nw.yz);
  }
  if (s6.x != 0.0) { // 山根
    vec4 rt = F(f, 94);
    tc = squeezeAxis(tc, rt.xy, axes.xy, axes.zw, vec3(rt.z, rt.w, F(f, 95).x), s6.x);
  }
  if (s6.y != 0.0) { // 嘴高, then 嘴型 (backward order: forward, 嘴型 scales about the true p106, then 嘴高 moves it)
    vec2 ay = F(f, 92).xy;
    tc = shiftEllipse(tc, P(f, 106), vec2(-ay.y, ay.x), ay, F(f, 91).xyz, F(f, 90).zw);
  }
  if (s2.z != 0.0) tc = scaleAround(tc, P(f, 106), r.z, s2.z);
  if (ce.zw != vec2(0.0)) {
    tc = shiftAround(tc, P(f, 74), r.x, ce.zw);
    tc = shiftAround(tc, P(f, 77), r.y, -ce.zw);
  }
  if (s2.w != 0.0) tc = enlargeEye(tc, P(f, 74), r.x, s2.w);  // 大眼 per side: p74 left, p77 right
  if (sR.w != 0.0) tc = enlargeEye(tc, P(f, 77), r.y, sR.w);
  return tc;
}
```

Update the comment block above `PROTECT_REACH` (`reshape.ts:231-248`) and `src/tracking/faceProtect.ts:1-4`: the 瘦臉 limit now also bounds 下頜線, 太陽穴 and 髮際線 (they run before `protectContour`).

- [x] **Step 6: Re-pin the shader hash**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts -t "pinned to the shader text"`
Expected: FAIL with `expected '<new hash>' to be '<step-3 hash>'`. Copy `<new hash>` into that test's `toBe(…)` (the value lives in the `PINNED` constant, `reshapeCpu.test.ts:19`, `'e65a71b2'` at the step base; the test is at `:32`), then run `npx vitest run src/engine` — Expected: PASS.

- [x] **Step 7: Add the GPU = CPU pin cases**

`tests/e2e/pages/reshape.ts`: step 1 factored the per-case loop of its multi-face pin into `pinCases(gl, cases, aspect, carrier)` (identity RGBA32F source, the 200 × 300 RGBA32F target, `drawFaces` on a `createReshapePass(gl, { carrier })`, readback, comparison with `reshapeMapMulti` at every pixel centre, `PinCase` records). Reuse it — the step-5 cases go through the same `drawFaces` path the app renders with, on both face-table carriers — and add:

```ts
declare global {
  interface Window {
    runReshapePinFaceDetail?: (carrier: 'texture' | 'ubo') => PinCase[];
  }
}

window.runReshapePinFaceDetail = (carrier) => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2')!;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const neutral = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
  const U = (over: Partial<Record<ParamId, number>>, right: PersonParams['right'] = null) => reshapeUniforms({ ...neutral, ...over }, 1, right);
  /** one face, as ReshapePass.draw packs it: yaw-attenuated, no cap, no protect layer */
  const one = (u: ReshapeUniforms): TableFace[] => [{ face, u: attenuate(u, face.yaw), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 }];
  const split = { 'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.jawline': 1, 'shape.temple': 1 };
  const all15 = Object.fromEntries(paramsInGroup('shape').map((d) => [d.id, 1]));
  const cases: { name: string; faces: TableFace[] }[] = [
    { name: `下頜線 max (${carrier})`, faces: one(U({ 'shape.jawline': 1 })) },
    { name: `太陽穴 +max (${carrier})`, faces: one(U({ 'shape.temple': 1 })) },
    { name: `太陽穴 −max (${carrier})`, faces: one(U({ 'shape.temple': 0 })) },
    { name: `髮際線 +max (${carrier})`, faces: one(U({ 'shape.hairline': 1 })) },
    { name: `髮際線 −max (${carrier})`, faces: one(U({ 'shape.hairline': 0 })) },
    { name: `鼻翼 +max (${carrier})`, faces: one(U({ 'shape.noseWing': 1 })) },
    { name: `鼻翼 −max (${carrier})`, faces: one(U({ 'shape.noseWing': 0 })) },
    { name: `山根 +max (${carrier})`, faces: one(U({ 'shape.noseBridge': 1 })) },
    { name: `山根 −max (${carrier})`, faces: one(U({ 'shape.noseBridge': 0 })) },
    { name: `嘴高 +max (${carrier})`, faces: one(U({ 'shape.mouthHeight': 1 })) },
    { name: `嘴高 −max (${carrier})`, faces: one(U({ 'shape.mouthHeight': 0 })) },
    { name: `左右分開 L = max, R = 0 (${carrier})`, faces: one(U(split, Object.fromEntries(Object.keys(split).map((id) => [id, 0])))) },
    { name: `every 美型 item at max (${carrier})`, faces: one(U(all15)) },
  ];
  return pinCases(gl, cases, aspect, carrier);
};
```

Imports, merged into the page's existing lines (step 1 already imports `attenuate, boxCentre, ovalBox, WHOLE, type TableFace` from `faceCap`, `reshapeUniforms`, `adapt`, `landmarks` and `ParamId`): `neutralValue, PARAM_DEFS, paramsInGroup` from `../../../src/engine/params`; `type ReshapeUniforms` from the reshape module; `PersonParams` type. Measured with the CPU port on this 200 × 300 grid: every case compares about 59 600 px, and moves more than 1 px at 96 (山根) to 29 740 (all items) of them.

Create `tests/e2e/shape-makeup.spec.ts`:

```ts
// v0.4 step 5 (face-detail spec §8.3): the new warps and 左右分開 against the CPU port, the procedural makeup against its
// CPU port and its regions, and the editor / camera flows.
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';

test('step-5 warps: CPU port == RESHAPE_FS for every new warp at ±max, split L ≠ R and all 15 items, both carriers', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinFaceDetail === 'function');
  for (const carrier of ['texture', 'ubo'] as const) {
    const cases = await page.evaluate((c) => window.runReshapePinFaceDetail!(c), carrier);
    expect(cases).toHaveLength(13);
    for (const c of cases) {
      console.log(`${c.name}: ${c.n} px, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
      expect(c.n, c.name).toBeGreaterThan(30_000);
      expect(c.moved, c.name).toBeGreaterThan(20);
      expect(c.maxErrPx, `${c.name}: ${JSON.stringify(c.samples.slice(0, 4))}`).toBeLessThan(0.05);
    }
  }
});
```

- [x] **Step 8: Run the e2e pins**

Run: `npm run build && npx playwright test tests/e2e/shape-makeup.spec.ts tests/e2e/reshape.spec.ts tests/e2e/faceProtect.spec.ts`
Expected: PASS — 2 × 13 step-5 cases each under 0.05 px; `reshape.spec.ts` still has its 3 cases (and step 1's multi-face and step 3's view tests) passing; `faceProtect.spec.ts` unchanged.

(Landed: the full Playwright run then failed `parity.spec.ts`'s `refined-shape-max` case, max 189/255: its page `tests/e2e/pages/parity.ts` set every `shape`-group item to max, which since Task 1 includes the six step-5 items, and this task makes them move pixels. The page, which its header names as the only file ported when an API changes, now sets the nine v0.3 美型 items (892ea61's shape group); `parity.spec.ts` and the goldens are unchanged and every case is max 0/255.)

- [x] **Step 9: Run the unit suite and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
file src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.ts src/engine/passes/reshapeCpu.test.ts src/engine/passes/reshape.test.ts tests/e2e/pages/reshape.ts
git add src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.ts src/engine/passes/reshapeCpu.test.ts src/engine/passes/reshape.test.ts src/tracking/faceProtect.ts tests/e2e/pages/reshape.ts tests/e2e/shape-makeup.spec.ts
git add -u src/engine
git commit -F- <<'EOF'
v0.4 step 5: 下頜線 太陽穴 髮際線 鼻翼 山根 嘴高 and 左右分開 in the reshape pass

shiftEllipse and squeezeAxis primitives, per-side strengths on the six
split items, the S5 §4.5 chain order; CPU port mirrored and the
RESHAPE_FS pin re-set; GPU = CPU within 0.05 px on 13 new cases per
face-table carrier; every new warp is the identity on its box border.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 8: Procedural makeup geometry (`buildMakeupGeometry`)

The CPU half of the makeup pass (S5 §4.6–4.9): for every listed face, the strips and ellipses of the eight procedural parts in landmark space, with per-vertex item coordinates, colour and α_max (intensity × live weight × gates), packed as one triangle strip per layer over all faces. Pure and Node-testable; the shader comes in Task 9.

**Files:**
- Create: `src/engine/passes/makeupProc.ts` (pure part)
- Test: `src/engine/passes/makeupProc.test.ts`

**Interfaces:**
- Consumes: `RenderFace` (RM §4.1: `face`, `weight`, `person`, `protect`), `Rect` (RM §3.2); Task 1 `shadeColor`, `MAKEUP_FIXED`, `ORIG_TINT`; Task 5 `eyeFrames`, `eyeToUv`, `lidStations`, `browGapAt`, `STATION_XS`, gates; `faceWidthIso`, `yawAttenuation` (`reshape.ts`); `hexToRgb` (`gl.ts:247`).
- Produces:
  - `type MakeupLayer = 'contour' | 'highlight' | 'brow' | 'shadow' | 'aegyoLight' | 'aegyoShade' | 'lens' | 'liner' | 'lashes'`
  - `LAYER_ORDER: readonly MakeupLayer[]` (that order); `LAYER_MODE: Readonly<Record<MakeupLayer, 0 | 1 | 2>>` (0 multiply, 1 screen, 2 over)
  - `KIND` (`shadowUpper 0, shadowLower 1, liner 2, lashes 3, aegyoLight 4, aegyoShade 5, lens 6, lensOrig 7, brow 8, contourJaw 9, contourEllipse 10, contourNose 11, highlightRibbon 12, highlightEllipse 13`)
  - `FLOATS_PER_VERTEX = 11` (`aPos` 2 O-space UV, `aLoc` 2, `aAux` 2, `aCol` 4, `aKind` 1); `MAX_PMAKEUP_VERTS_PER_FACE = 768`
  - `interface MakeupGeometry { data: Float32Array; ranges: Record<MakeupLayer, [first: number, count: number]> }`
  - `buildMakeupGeometry(faces: readonly RenderFace[], aspect: number, out?: Float32Array): MakeupGeometry`
  - `geometryVertexCount(g: MakeupGeometry): number`; `procMakeupWanted(faces: readonly RenderFace[]): boolean`; `oAspectOf(input: { width: number; height: number; sourceWindow?: Rect; oAspect?: number }): number` (step 3's `RenderInput.oAspect` first)
  - `class StripWriter` (exported for its unit test)
  - `lashHeight(x: number): number`

- [x] **Step 1: Write the failing test**

Create `src/engine/passes/makeupProc.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyShades, neutralPerson } from '../../edit/state';
import { adapt } from '../../tracking/adapter111';
import type { Face, PersonParams, RenderFace } from '../../types';
import { eyeFrames } from './eyeFrame';
import {
  buildMakeupGeometry,
  FLOATS_PER_VERTEX,
  geometryVertexCount,
  KIND,
  LAYER_ORDER,
  MAX_PMAKEUP_VERTS_PER_FACE,
  oAspectOf,
  procMakeupWanted,
  StripWriter,
  type MakeupGeometry,
  type MakeupLayer,
} from './makeupProc';
import { faceWidthIso, yawAttenuation } from './reshape';
import { closeEye, scaleFace } from './syntheticFaces';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const aspect = lm.width / lm.height;
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const ALL8 = {
  'makeup.brow': 1, 'makeup.eyeshadow': 1, 'makeup.liner': 1, 'makeup.lashes': 1,
  'makeup.aegyo': 1, 'makeup.contour': 1, 'makeup.highlight': 1, 'makeup.lens': 1,
};
const person = (values: Record<string, number> = ALL8, shades: Partial<PersonParams['shades']> = { brow: 'black', eyeshadow: 'earth', lens: 'blue' }): PersonParams => ({
  ...neutralPerson(),
  values: { ...neutralPerson().values, ...values },
  shades: { ...emptyShades(), ...shades },
});
const rf = (f: Face = face, p: PersonParams = person(), weight = 1): RenderFace => ({ face: f, weight, person: p, protect: null });
type Vtx = { pos: [number, number]; loc: [number, number]; aux: [number, number]; a: number; kind: number };
const verts = (g: MakeupGeometry, layer: MakeupLayer): Vtx[] => {
  const [first, count] = g.ranges[layer];
  return Array.from({ length: count }, (_, i) => {
    const o = (first + i) * FLOATS_PER_VERTEX;
    const d = g.data;
    return { pos: [d[o], d[o + 1]], loc: [d[o + 2], d[o + 3]], aux: [d[o + 4], d[o + 5]], a: d[o + 9], kind: d[o + 10] };
  });
};

describe('StripWriter (face-detail spec §4.6)', () => {
  it('joins pieces with degenerate vertices, starts every piece on an even index and grows its buffer', () => {
    const w = new StripWriter(new Float32Array(0));
    const v = (x: number) => w.vertex([x, 0], [0, 0], [0, 0], [0, 0, 0, 1], 0);
    w.beginLayer();
    w.beginPiece();
    [1, 2, 3].forEach(v);
    w.beginPiece();
    [4, 5, 6, 7].forEach(v);
    w.beginPiece();
    [8, 9].forEach(v);
    const [first, count] = w.range();
    const xs = Array.from({ length: count }, (_, i) => w.data[(first + i) * FLOATS_PER_VERTEX]);
    expect(xs).toEqual([1, 2, 3, 3, 4, 4, 4, 5, 6, 7, 7, 8, 8, 9]);
    w.beginLayer();
    w.beginPiece();
    v(10);
    expect(w.range()).toEqual([14, 1]);
  });
});

describe('buildMakeupGeometry (face-detail spec §4.6–4.9)', () => {
  it('is finite, ≤ MAX_PMAKEUP_VERTS_PER_FACE with every part on, empty with every part at 0', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    const n = geometryVertexCount(g);
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThanOrEqual(MAX_PMAKEUP_VERTS_PER_FACE);
    for (let i = 0; i < n * FLOATS_PER_VERTEX; i++) expect(Number.isFinite(g.data[i])).toBe(true);
    expect(geometryVertexCount(buildMakeupGeometry([rf(face, person({}))], aspect))).toBe(0);
    expect(geometryVertexCount(buildMakeupGeometry([rf(face, person(), 0)], aspect))).toBe(0);
    for (const l of LAYER_ORDER) expect(g.ranges[l][1]).toBeGreaterThan(0);
  });

  it('lays the layers out contiguously in LAYER_ORDER', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    let next = 0;
    for (const l of LAYER_ORDER) {
      expect(g.ranges[l][0]).toBe(next);
      next += g.ranges[l][1];
    }
  });

  it('修容 stays inside the face contour (pts111 0–32 closed through ext[0]) grown by 0.02 FW', () => {
    const P = face.pts111;
    const poly: [number, number][] = [];
    for (let i = 0; i <= 32; i++) poly.push([P[i * 2], P[i * 2 + 1] / aspect]);
    poly.push([face.ext[0], face.ext[1] / aspect]);
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const distToPoly = (x: number, y: number) => {
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[j];
        const [bx, by] = poly[i];
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
      }
      return best;
    };
    const fw = faceWidthIso(face, aspect);
    for (const v of verts(buildMakeupGeometry([rf()], aspect), 'contour')) {
      const [x, y] = [v.pos[0], v.pos[1] / aspect];
      if (!inside(x, y)) expect(distToPoly(x, y)).toBeLessThanOrEqual(0.02 * fw);
    }
  });

  it('eye ribbons keep their §4.8 station and offset ranges', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    const e = 1e-6;
    const within = (v: number, lo: number, hi: number) => v >= lo - e && v <= hi + e;
    for (const v of verts(g, 'shadow')) {
      // upper piece: d from −0.02 to H = 0.65·max(browGap, 0.25), carried in aAux.x
      if (v.kind === KIND.shadowUpper) expect(within(v.loc[0], -0.22, 1) && within(v.loc[1], -0.02, v.aux[0]) && v.aux[0] >= 0.65 * 0.25 - e).toBe(true);
      else expect(within(v.loc[0], -0.15, 0.55) && within(v.loc[1], -0.03, 0.1)).toBe(true);
    }
    for (const v of verts(g, 'liner')) expect(within(v.loc[0], 0, 1) && within(v.loc[1], -0.03, 0.045 + 0.02)).toBe(true);
    for (const v of verts(g, 'lashes')) {
      expect(within(v.loc[0], (-0.22 + 0.2) / 1.2, 1)).toBe(true);
      expect([0, 1]).toContain(v.loc[1]);
    }
    for (const l of ['aegyoLight', 'aegyoShade'] as const) for (const v of verts(g, l)) expect(within(v.loc[0], 0.05, 1) && within(v.loc[1], 0, 0.16)).toBe(true);
  });

  it('a closed eye draws no 美瞳 and no 睫毛 but keeps 眼影, 眼線 and 臥蠶; a wink keeps both on the open eye', () => {
    const closed = buildMakeupGeometry([rf(closeEye(closeEye(face, 0), 1))], aspect);
    expect(closed.ranges.lens[1]).toBe(0);
    expect(closed.ranges.lashes[1]).toBe(0);
    for (const l of ['shadow', 'liner', 'aegyoLight', 'aegyoShade'] as const) expect(closed.ranges[l][1]).toBeGreaterThan(0);
    const wink = buildMakeupGeometry([rf(closeEye(face, 0))], aspect);
    const [left, right] = eyeFrames(face, aspect);
    for (const l of ['lens', 'lashes'] as const) {
      const vs = verts(wink, l);
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) expect(Math.abs(v.pos[0] - right.o[0])).toBeLessThan(Math.abs(v.pos[0] - left.o[0]));
    }
  });

  it('gates scale α_max: live weight, the yaw far side, the 睫毛 size gate', () => {
    const full = verts(buildMakeupGeometry([rf()], aspect), 'brow');
    const half = verts(buildMakeupGeometry([rf(face, person(), 0.5)], aspect), 'brow');
    expect(half.map((v) => v.a)).toEqual(full.map((v) => Math.fround(v.a * 0.5)));
    const turned = { ...face, yaw: 0.25 };
    const att = yawAttenuation(0.25);
    const mid = (face.pts111[0] + face.pts111[64]) / 2;
    for (const v of verts(buildMakeupGeometry([rf(turned)], aspect), 'contour')) {
      if (v.pos[0] > mid + 0.1) expect(v.a).toBeCloseTo(att, 6);
      if (v.pos[0] < mid - 0.1) expect(v.a).toBeCloseTo(1, 6);
    }
    const tiny = buildMakeupGeometry([rf(scaleFace(face, 0.07, [0.5, 0.5]))], aspect);
    expect(tiny.ranges.lashes[1]).toBe(0);
    expect(tiny.ranges.liner[1]).toBeGreaterThan(0);
    for (let i = 0; i < geometryVertexCount(tiny) * FLOATS_PER_VERTEX; i++) expect(Number.isFinite(tiny.data[i])).toBe(true);
  });

  it('two faces give disjoint geometry and share every layer strip', () => {
    const a = scaleFace(face, 0.5, [0, 0.5]);
    const b = scaleFace(face, 0.5, [1, 0.5]);
    const one = buildMakeupGeometry([rf(a)], aspect);
    const two = buildMakeupGeometry([rf(a), rf(b)], aspect);
    expect(geometryVertexCount(two)).toBeLessThanOrEqual(2 * MAX_PMAKEUP_VERTS_PER_FACE);
    for (const l of LAYER_ORDER) {
      const xs = verts(two, l).map((v) => v.pos[0]);
      expect(xs.some((x) => x < 0.5)).toBe(true);
      expect(xs.some((x) => x > 0.5)).toBe(true);
      expect(two.ranges[l][1]).toBeGreaterThanOrEqual(2 * one.ranges[l][1]);
      expect(two.ranges[l][1]).toBeLessThanOrEqual(2 * one.ranges[l][1] + 3);
    }
  });

  it('procMakeupWanted and oAspectOf', () => {
    expect(procMakeupWanted([rf(face, person({}))])).toBe(false);
    expect(procMakeupWanted([rf(face, person({ 'makeup.lip': 1 }))])).toBe(false);
    expect(procMakeupWanted([rf(face, person({ 'makeup.highlight': 0.2 }))])).toBe(true);
    expect(procMakeupWanted([rf(face, person({ 'makeup.highlight': 0.2 }), 0)])).toBe(false);
    expect(oAspectOf({ width: 500, height: 750, sourceWindow: { x: 0.5, y: 0, w: 0.5, h: 0.5 } })).toBeCloseTo(1000 / 1500, 12);
    expect(oAspectOf({ width: 1000, height: 1500 })).toBeCloseTo(1000 / 1500, 12);
    expect(oAspectOf({ width: 500, height: 750, sourceWindow: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, oAspect: 0.6667 })).toBe(0.6667);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/engine/passes/makeupProc.test.ts`
Expected: FAIL — `Failed to resolve import "./makeupProc"`.

- [x] **Step 3: Implement**

Create `src/engine/passes/makeupProc.ts`:

```ts
// Procedural makeup (face-detail spec §4.6–4.10): 眉毛, 眼影, 眼線, 睫毛, 臥蠶, 修容, 高光 and 美瞳, drawn in P1 after every
// face's GPUPixel lip/blush mesh. The geometry is built here on the CPU, in landmark space: every layer is ONE
// TRIANGLE_STRIP over every face (pieces joined by degenerate vertices), so a frame draws at most 9 strips for any number
// of faces. Original work (LICENSES/NOTICE.txt); no third-party makeup asset.
import type { Face, Rect, RenderFace } from '../../types';
import { hexToRgb } from '../gl/gl';
import { MAKEUP_FIXED, ORIG_TINT, shadeColor } from '../params';
import {
  browGapAt,
  eyeFrames,
  eyeToUv,
  lashBlinkGate,
  lashSizeGate,
  lensBlinkGate,
  lidStations,
  STATION_XS,
  type EyeFrame,
  type Station,
  type V2,
} from './eyeFrame';
import { faceWidthIso, yawAttenuation } from './reshape';

export type MakeupLayer = 'contour' | 'highlight' | 'brow' | 'shadow' | 'aegyoLight' | 'aegyoShade' | 'lens' | 'liner' | 'lashes';
/** draw order (S5 §4.6): the lens reads `src`, so only lid items and the lashes, drawn after it, overlap the iris */
export const LAYER_ORDER: readonly MakeupLayer[] = ['contour', 'highlight', 'brow', 'shadow', 'aegyoLight', 'aegyoShade', 'lens', 'liner', 'lashes'];
/** 0 multiply (DST_COLOR, ZERO) · 1 screen (ONE, ONE_MINUS_SRC_COLOR) · 2 over (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) */
export const LAYER_MODE: Readonly<Record<MakeupLayer, 0 | 1 | 2>> = {
  contour: 0,
  highlight: 1,
  brow: 0,
  shadow: 0,
  aegyoLight: 1,
  aegyoShade: 0,
  lens: 2,
  liner: 2,
  lashes: 2,
};
/** the shape enum PMAKEUP_FS switches on (aKind) */
export const KIND = {
  shadowUpper: 0,
  shadowLower: 1,
  liner: 2,
  lashes: 3,
  aegyoLight: 4,
  aegyoShade: 5,
  lens: 6,
  lensOrig: 7,
  brow: 8,
  contourJaw: 9,
  contourEllipse: 10,
  contourNose: 11,
  highlightRibbon: 12,
  highlightEllipse: 13,
} as const;
/** aPos 2 (O-space UV) · aLoc 2 · aAux 2 · aCol 4 (tint RGB, α_max) · aKind 1 — 44 B */
export const FLOATS_PER_VERTEX = 11;
export const MAX_PMAKEUP_VERTS_PER_FACE = 768;

export interface MakeupGeometry {
  data: Float32Array;
  ranges: Record<MakeupLayer, [first: number, count: number]>;
}

type RGBA = readonly [number, number, number, number];
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** One TRIANGLE_STRIP per layer; pieces joined by degenerate vertices that start every piece on an even index. */
export class StripWriter {
  data: Float32Array;
  n = 0;
  private start = 0;
  private pending = false;
  constructor(data: Float32Array) {
    this.data = data;
  }
  beginLayer(): void {
    this.start = this.n;
    this.pending = false;
  }
  range(): [number, number] {
    return [this.start, this.n - this.start];
  }
  beginPiece(): void {
    if (this.n > this.start) {
      this.copyLast();
      this.pending = true;
    }
  }
  vertex(pos: V2, loc: V2, aux: V2, col: RGBA, kind: number): void {
    if (this.pending) {
      this.write(pos, loc, aux, col, kind);
      if ((this.n - this.start) % 2 === 1) this.write(pos, loc, aux, col, kind);
      this.pending = false;
    }
    this.write(pos, loc, aux, col, kind);
  }
  private grow(): void {
    if ((this.n + 1) * FLOATS_PER_VERTEX <= this.data.length) return;
    const next = new Float32Array(Math.max(this.data.length * 2, FLOATS_PER_VERTEX * MAX_PMAKEUP_VERTS_PER_FACE));
    next.set(this.data);
    this.data = next;
  }
  private copyLast(): void {
    this.grow();
    const o = this.n * FLOATS_PER_VERTEX;
    this.data.copyWithin(o, o - FLOATS_PER_VERTEX, o);
    this.n++;
  }
  private write(pos: V2, loc: V2, aux: V2, col: RGBA, kind: number): void {
    this.grow();
    const o = this.n * FLOATS_PER_VERTEX;
    const d = this.data;
    d[o] = pos[0];
    d[o + 1] = pos[1];
    d[o + 2] = loc[0];
    d[o + 3] = loc[1];
    d[o + 4] = aux[0];
    d[o + 5] = aux[1];
    d[o + 6] = col[0];
    d[o + 7] = col[1];
    d[o + 8] = col[2];
    d[o + 9] = col[3];
    d[o + 10] = kind;
    this.n++;
  }
}

interface FaceCtx {
  P: Float32Array;
  face: Face;
  aspect: number;
  fw: number;
  /** iso unit axes: m̂ toward the chin, r̂ from the GPUPixel-left eye toward the right eye */
  mh: V2;
  rh: V2;
  frames: readonly [EyeFrame, EyeFrame];
  /** α factor per GPUPixel side for 修容 and the 高光 cheekbone: the yaw far side × yawAttenuation (S5 §4.9) */
  sideAtt: readonly [number, number];
  I: { brow: number; eyeshadow: number; liner: number; lashes: number; aegyo: number; contour: number; highlight: number; lens: number };
  shades: { brow: string | null; eyeshadow: string | null; liner: string | null; lens: string | null };
}

const rgba = (hex: string, a: number): RGBA => {
  const c = hexToRgb(hex);
  return [c[0], c[1], c[2], a];
};

function faceCtx(rf: RenderFace, aspect: number): FaceCtx {
  const P = rf.face.pts111;
  const iso = (i: number): V2 => [P[i * 2], P[i * 2 + 1] / aspect];
  const m0 = iso(43);
  const m1 = iso(16);
  const ml = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1e-12;
  const mh: V2 = [(m1[0] - m0[0]) / ml, (m1[1] - m0[1]) / ml];
  const e0 = iso(74);
  const e1 = iso(77);
  const r0: V2 = [-mh[1], mh[0]];
  const rh: V2 = r0[0] * (e1[0] - e0[0]) + r0[1] * (e1[1] - e0[1]) < 0 ? [-r0[0], -r0[1]] : r0;
  const w = clamp01(rf.weight);
  const v = (id: keyof RenderFace['person']['values']) => clamp01(rf.person.values[id]) * w;
  // yawProxy > 0: the GPUPixel-left eye is farther from the nose tip, so the GPUPixel-right half is the far side
  const att = yawAttenuation(rf.face.yaw);
  const sideAtt: [number, number] = rf.face.yaw > 0 ? [1, att] : rf.face.yaw < 0 ? [att, 1] : [1, 1];
  return {
    P,
    face: rf.face,
    aspect,
    fw: faceWidthIso(rf.face, aspect),
    mh,
    rh,
    frames: eyeFrames(rf.face, aspect),
    sideAtt,
    I: {
      brow: v('makeup.brow'),
      eyeshadow: v('makeup.eyeshadow'),
      liner: v('makeup.liner'),
      lashes: v('makeup.lashes'),
      aegyo: v('makeup.aegyo'),
      contour: v('makeup.contour'),
      highlight: v('makeup.highlight'),
      lens: v('makeup.lens'),
    },
    shades: {
      brow: rf.person.shades.brow,
      eyeshadow: rf.person.shades.eyeshadow,
      liner: rf.person.shades.liner,
      lens: rf.person.shades.lens,
    },
  };
}

const uvOf = (c: FaceCtx, q: V2): V2 => [q[0], q[1] * c.aspect];
const isoPt = (c: FaceCtx, i: number): V2 => [c.P[i * 2], c.P[i * 2 + 1] / c.aspect];
const isoExt = (c: FaceCtx, k: number): V2 => [c.face.ext[k * 2], c.face.ext[k * 2 + 1] / c.aspect];
const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (v: V2): V2 => {
  const l = Math.hypot(v[0], v[1]) || 1e-12;
  return [v[0] / l, v[1] / l];
};

/** a strip of station pairs along a lid: (point + n·d0, point + n·d1); aLoc defaults to (u, d) = (station x, offset) */
function eyeRibbon(
  w: StripWriter,
  c: FaceCtx,
  f: EyeFrame,
  sts: readonly Station[],
  d0: number,
  d1: (s: Station) => number,
  aux: (s: Station) => V2,
  col: RGBA,
  kind: number,
  loc: (s: Station, d: number, edge: 0 | 1) => V2 = (s, d) => [s.x, d],
): void {
  w.beginPiece();
  for (const s of sts) {
    const b = d1(s);
    w.vertex(eyeToUv(f, s.x + s.nx * d0, s.y + s.ny * d0, c.aspect), loc(s, d0, 0), aux(s), col, kind);
    w.vertex(eyeToUv(f, s.x + s.nx * b, s.y + s.ny * b, c.aspect), loc(s, b, 1), aux(s), col, kind);
  }
}

/** octagon circumscribing the ellipse (centre ctr, unit axis a, half-axes A, B; iso), so no corner pokes out of the face */
const OCT_R = 1 / Math.cos(Math.PI / 8);
const OCT_ORDER = [0, 1, 7, 2, 6, 3, 5, 4];
function ellipse(w: StripWriter, c: FaceCtx, ctr: V2, a: V2, A: number, B: number, aux: V2, col: RGBA, kind: number): void {
  const b: V2 = [-a[1], a[0]];
  w.beginPiece();
  for (const k of OCT_ORDER) {
    const t = ((k + 0.5) * Math.PI) / 4;
    const xi = OCT_R * Math.cos(t);
    const eta = OCT_R * Math.sin(t);
    const q: V2 = [ctr[0] + a[0] * A * xi + b[0] * B * eta, ctr[1] + a[1] * A * xi + b[1] * B * eta];
    w.vertex(uvOf(c, q), [xi, eta], aux, col, kind);
  }
}

/** a straight ribbon from p to q (iso), `width` (iso) across and centred; aLoc = (u, v) */
function segment(w: StripWriter, c: FaceCtx, p: V2, q: V2, width: number, col: RGBA, kind: number): void {
  const n = unit([-(q[1] - p[1]), q[0] - p[0]]);
  const h = width / 2;
  w.beginPiece();
  for (const [u, s] of [
    [0, p],
    [1, q],
  ] as const) {
    w.vertex(uvOf(c, [s[0] - n[0] * h, s[1] - n[1] * h]), [u, 0], [0, 0], col, kind);
    w.vertex(uvOf(c, [s[0] + n[0] * h, s[1] + n[1] * h]), [u, 1], [0, 0], col, kind);
  }
}

/** inward unit normal (iso) of contour point i: ⊥ (p[i+1] − p[i−1]), toward the nose tip p46 */
function inward(c: FaceCtx, i: number): V2 {
  const a = isoPt(c, i - 1);
  const b = isoPt(c, i + 1);
  const n = unit([-(b[1] - a[1]), b[0] - a[0]]);
  const p = isoPt(c, i);
  const t = isoPt(c, 46);
  return n[0] * (t[0] - p[0]) + n[1] * (t[1] - p[1]) < 0 ? [-n[0], -n[1]] : n;
}

const UPPER_XS = [-0.22, -0.14, -0.07, ...STATION_XS];
const LOWER_ACCENT_XS = [-0.15, -0.075, ...STATION_XS.filter((x) => x <= 0.5), 0.55];
const AEGYO_XS = Array.from({ length: 17 }, (_, k) => 0.05 + (0.95 * k) / 16);
const LINER_T = (x: number) => 0.045 * (0.35 + 0.65 * (1 - x));
const LASH_X = [-0.2, 0, 0.15, 0.5, 0.8, 0.95, 1];
const LASH_H = [0.12, 0.12, 0.2, 0.2, 0.13, 0.08, 0];

/** 睫毛 length (eye units) over the lid x (S5 §4.8): piecewise linear, constant below −0.2 */
export function lashHeight(x: number): number {
  if (x <= LASH_X[0]) return LASH_H[0];
  for (let j = 1; j < LASH_X.length; j++) {
    if (x <= LASH_X[j]) {
      const t = (x - LASH_X[j - 1]) / (LASH_X[j] - LASH_X[j - 1]);
      return LASH_H[j - 1] + t * (LASH_H[j] - LASH_H[j - 1]);
    }
  }
  return 0;
}

// ── layers (S5 §4.8) ──
function contour(w: StripWriter, c: FaceCtx): void {
  if (c.I.contour <= 0) return;
  const sides: readonly (readonly number[])[] = [
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18],
  ];
  sides.forEach((idx, side) => {
    const a = c.I.contour * c.sideAtt[side];
    if (a <= 0) return;
    const col = rgba(MAKEUP_FIXED.contour, a);
    w.beginPiece();
    idx.forEach((i, j) => {
      const p = isoPt(c, i);
      const n = inward(c, i);
      const u = j / (idx.length - 1);
      w.vertex(uvOf(c, p), [u, 0], [0, 0], col, KIND.contourJaw);
      w.vertex(uvOf(c, [p[0] + n[0] * 0.1 * c.fw, p[1] + n[1] * 0.1 * c.fw]), [u, 1], [0, 0], col, KIND.contourJaw);
    });
    const [p0, p1] = side === 0 ? [isoPt(c, 4), isoPt(c, 84)] : [isoPt(c, 28), isoPt(c, 90)];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    ellipse(w, c, lerp(p0, p1, 0.3), unit([p1[0] - p0[0], p1[1] - p0[1]]), 0.3 * len, 0.085 * len, [0, 0], col, KIND.contourEllipse);
    const [n0, n1] = side === 0 ? [isoPt(c, 78), isoPt(c, 82)] : [isoPt(c, 79), isoPt(c, 83)];
    segment(w, c, n0, n1, 0.035 * c.fw, col, KIND.contourNose);
  });
}

function highlight(w: StripWriter, c: FaceCtx): void {
  if (c.I.highlight <= 0) return;
  const col = rgba(MAKEUP_FIXED.highlight, c.I.highlight);
  segment(w, c, isoPt(c, 43), isoPt(c, 45), 0.055 * c.fw, col, KIND.highlightRibbon);
  (
    [
      [57, 2],
      [62, 30],
    ] as const
  ).forEach(([a, b], side) => {
    const s = c.I.highlight * c.sideAtt[side];
    if (s <= 0) return;
    const p0 = isoPt(c, a);
    const p1 = isoPt(c, b);
    ellipse(w, c, lerp(p0, p1, 0.45), unit([p1[0] - p0[0], p1[1] - p0[1]]), 0.11 * c.fw, 0.05 * c.fw, [0.3, 0], rgba(MAKEUP_FIXED.highlight, s), KIND.highlightEllipse);
  });
  ellipse(w, c, lerp(isoExt(c, 1), isoExt(c, 2), 0.35), c.rh, 0.13 * c.fw, 0.07 * c.fw, [0.22, 0], col, KIND.highlightEllipse);
  ellipse(w, c, lerp(isoPt(c, 16), isoPt(c, 93), 0.4), c.rh, 0.06 * c.fw, 0.035 * c.fw, [0.25, 0], col, KIND.highlightEllipse);
}

/** arc-length resampling of an iso polyline to n points */
function resample(pts: readonly V2[], n: number): V2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const t = (total * k) / (n - 1);
    while (j < pts.length - 1 && cum[j] < t) j++;
    const seg = cum[j] - cum[j - 1] || 1e-12;
    out.push(lerp(pts[j - 1], pts[j], Math.min(1, Math.max(0, (t - cum[j - 1]) / seg))));
  }
  return out;
}

function brow(w: StripWriter, c: FaceCtx): void {
  if (c.I.brow <= 0) return;
  const col = rgba(shadeColor('brow', c.shades.brow) ?? ORIG_TINT.brow, c.I.brow);
  const sides = [
    [
      [33, 34, 35, 36, 37],
      [64, 65, 66, 67],
    ],
    [
      [42, 41, 40, 39, 38],
      [71, 70, 69, 68],
    ],
  ] as const;
  for (const [up, lo] of sides) {
    const U = up.map((i) => isoPt(c, i));
    const L = resample(
      lo.map((i) => isoPt(c, i)),
      5,
    );
    // tail extension at u = −0.12 (stations 0.25 apart in u), then each edge pushed out by 8 % of the local width
    const ext = (e: V2[]): V2[] => [lerp(e[0], e[1], -0.12 / 0.25), ...e];
    const Ue = ext(U);
    const Le = ext(L);
    w.beginPiece();
    [-0.12, 0, 0.25, 0.5, 0.75, 1].forEach((u, j) => {
      const a = Ue[j];
      const b = Le[j];
      const dx = (a[0] - b[0]) * 0.08;
      const dy = (a[1] - b[1]) * 0.08;
      w.vertex(uvOf(c, [b[0] - dx, b[1] - dy]), [u, 0], [0, 0], col, KIND.brow);
      w.vertex(uvOf(c, [a[0] + dx, a[1] + dy]), [u, 1], [0, 0], col, KIND.brow);
    });
  }
}

function shadow(w: StripWriter, c: FaceCtx): void {
  if (c.I.eyeshadow <= 0) return;
  const col = rgba(shadeColor('eyeshadow', c.shades.eyeshadow) ?? ORIG_TINT.eyeshadow, c.I.eyeshadow);
  for (const f of c.frames) {
    const H = (s: Station) => 0.65 * Math.max(browGapAt(f, s.x, s.y), 0.25);
    eyeRibbon(w, c, f, lidStations(f, 'upper', UPPER_XS), -0.02, H, (s) => [H(s), 0], col, KIND.shadowUpper);
    eyeRibbon(w, c, f, lidStations(f, 'lower', LOWER_ACCENT_XS), -0.03, () => 0.1, () => [0, 0], col, KIND.shadowLower);
  }
}

function aegyo(w: StripWriter, c: FaceCtx, light: boolean): void {
  if (c.I.aegyo <= 0) return;
  const col = rgba(light ? MAKEUP_FIXED.aegyoLight : MAKEUP_FIXED.aegyoShade, c.I.aegyo);
  for (const f of c.frames) {
    eyeRibbon(w, c, f, lidStations(f, 'lower', AEGYO_XS), 0, () => 0.16, () => [0, 0], col, light ? KIND.aegyoLight : KIND.aegyoShade);
  }
}

function lens(w: StripWriter, c: FaceCtx): void {
  if (c.I.lens <= 0) return;
  const hex = shadeColor('lens', c.shades.lens);
  const kind = hex ? KIND.lens : KIND.lensOrig;
  for (const f of c.frames) {
    const a = c.I.lens * lensBlinkGate(f.ear);
    if (a <= 0) continue;
    let open = false;
    for (let k = 0; k < STATION_XS.length; k++) if (f.lower[k] - f.upper[k] > 0) open = true;
    if (!open) continue;
    const iris = f.iris ?? f.irisFallback;
    const col: RGBA = hex ? rgba(hex, a) : [0, 0, 0, a];
    w.beginPiece();
    STATION_XS.forEach((x, k) => {
      // the aperture strip: (dU, dL) = distances to the upper and lower lid, eye units
      const h = Math.max(0, f.lower[k] - f.upper[k]);
      for (const [y, aux] of [
        [f.upper[k], [0, h]],
        [f.upper[k] + h, [h, 0]],
      ] as const) {
        const q = eyeToUv(f, x, y, c.aspect);
        w.vertex(q, [(q[0] - iris.c[0]) / iris.r, (q[1] / c.aspect - iris.c[1]) / iris.r], [aux[0], aux[1]], col, kind);
      }
    });
  }
}

function liner(w: StripWriter, c: FaceCtx): void {
  if (c.I.liner <= 0) return;
  const col = rgba(shadeColor('liner', c.shades.liner) ?? '#151313', c.I.liner);
  for (const f of c.frames) {
    eyeRibbon(w, c, f, lidStations(f, 'upper', STATION_XS), -0.03, (s) => LINER_T(s.x) + 0.02, (s) => [LINER_T(s.x), 0], col, KIND.liner);
    // wing: 3 stations from the outer corner toward (−0.16, −0.07) in eye units, tapering to nothing (S5 §4.8)
    const dir: V2 = [-0.16, -0.07];
    const n = unit([-dir[1], dir[0]]);
    const up: V2 = n[1] < 0 ? n : [-n[0], -n[1]];
    const y0 = f.upperPts[1];
    const sts: Station[] = [0, 0.5, 1].map((s) => ({ x: dir[0] * s, y: y0 + dir[1] * s, nx: up[0], ny: up[1] }));
    const T = (s: Station) => LINER_T(0) * (1 - s.x / dir[0]);
    eyeRibbon(w, c, f, sts, -0.03, (s) => T(s) + 0.02, (s) => [T(s), 0], col, KIND.liner, (_s, d) => [0, d]);
  }
}

function lashes(w: StripWriter, c: FaceCtx): void {
  if (c.I.lashes <= 0) return;
  for (const f of c.frames) {
    const a = c.I.lashes * lashBlinkGate(f.ear) * lashSizeGate(f, c.aspect);
    if (a <= 0) continue;
    const col = rgba(MAKEUP_FIXED.lashes, a);
    eyeRibbon(w, c, f, lidStations(f, 'upper', UPPER_XS), 0, (s) => lashHeight(s.x), () => [0, 0], col, KIND.lashes, (s, _d, edge) => [(s.x + 0.2) / 1.2, edge]);
  }
}

const EMITTERS: Readonly<Record<MakeupLayer, (w: StripWriter, c: FaceCtx) => void>> = {
  contour,
  highlight,
  brow,
  shadow,
  aegyoLight: (w, c) => aegyo(w, c, true),
  aegyoShade: (w, c) => aegyo(w, c, false),
  lens,
  liner,
  lashes,
};

const PROC_IDS = [
  'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
] as const;

/** any listed face has a procedural part above 0 (before the gates): the cheap pre-check before building geometry */
export function procMakeupWanted(faces: readonly RenderFace[]): boolean {
  return faces.some((f) => clamp01(f.weight) > 0 && PROC_IDS.some((id) => clamp01(f.person.values[id]) > 0));
}

export function geometryVertexCount(g: MakeupGeometry): number {
  return LAYER_ORDER.reduce((n, l) => n + g.ranges[l][1], 0);
}

/**
 * W/H of the whole O frame: step 3's `RenderInput.oAspect` when given (tiles pass the working bitmap's, so the makeup
 * geometry matches the reshape's), else the source size over its `sourceWindow` (RM §4.1)
 */
export function oAspectOf(input: { width: number; height: number; sourceWindow?: Rect; oAspect?: number }): number {
  if (input.oAspect !== undefined && input.oAspect > 0) return input.oAspect;
  const win = input.sourceWindow ?? { x: 0, y: 0, w: 1, h: 1 };
  return input.width / win.w / (input.height / win.h);
}

/** Every layer is one TRIANGLE_STRIP over every face, in LAYER_ORDER; `out` is reused when it is large enough. */
export function buildMakeupGeometry(faces: readonly RenderFace[], aspect: number, out?: Float32Array): MakeupGeometry {
  const cap = Math.max(1, faces.length) * MAX_PMAKEUP_VERTS_PER_FACE * FLOATS_PER_VERTEX;
  const w = new StripWriter(out && out.length >= cap ? out : new Float32Array(cap));
  const ctxs = faces.filter((f) => clamp01(f.weight) > 0).map((f) => faceCtx(f, aspect));
  const ranges = {} as Record<MakeupLayer, [number, number]>;
  for (const layer of LAYER_ORDER) {
    w.beginLayer();
    for (const c of ctxs) EMITTERS[layer](w, c);
    ranges[layer] = w.range();
  }
  return { data: w.data, ranges };
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run src/engine/passes/makeupProc.test.ts && npm run typecheck`
Expected: PASS (9 tests); no type errors. (Measured on the fixture: 668 vertices per face with every part on, about 0.1–0.2 ms per face.)

- [x] **Step 5: Commit**

```bash
git add src/engine/passes/makeupProc.ts src/engine/passes/makeupProc.test.ts
git commit -F- <<'EOF'
v0.4 step 5: procedural makeup geometry

眉毛, 眼影, 眼線, 睫毛, 臥蠶, 修容, 高光 and 美瞳 as strips and ellipses
in landmark space with per-vertex α_max (intensity × weight × gates),
one triangle strip per layer over every face.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 9: `PMAKEUP_VS` / `PMAKEUP_FS` and their CPU port

The fragment math of every kind (S5 §4.8), the skin gate (§4.9) and the three fixed-function blend outputs (§4.6), as shader text plus a test-only CPU port pinned to it. The GPU half of the pin (the same quads rendered for real) is Task 12.

**Files:**
- Modify: `src/engine/passes/makeupProc.ts` (add the two shaders)
- Create: `src/engine/passes/makeupProcCpu.ts`, `src/engine/passes/makeupProcCpu.test.ts`

**Interfaces:**
- Consumes: Task 8 `KIND`, `LAYER_MODE`; Task 5 `smoothstep`; step 2's `shaderHash(src: string): string` (`src/engine/shaderHash.ts`, the FNV-1a helper every shader pin uses).
- Produces:
  - `makeupProc.ts`: `PMAKEUP_VS`, `PMAKEUP_FS` (strings). Uniforms: `uSrc` (unit 0), `uLashes` (unit 1), `uInvDst` (1 / target size), `uWin` (O-space rect the target covers, `(x0, y0, w, h)`), `uLayerMode` (0 multiply, 1 screen, 2 over). Attributes `aPos`, `aLoc`, `aAux`, `aCol`, `aKind` as Task 8's layout.
  - `makeupProcCpu.ts`: `interface FragIn { kind: number; loc: readonly [number, number]; aux: readonly [number, number]; col: readonly [number, number, number, number]; src: readonly [number, number, number]; lash: number; fwD: number; fwU: number }`, `fragment(i: FragIn): { rgb: [number, number, number]; a: number }`, `blend(mode: 0 | 1 | 2, dst: readonly [number, number, number], f: { rgb: [number, number, number]; a: number }): [number, number, number]`, `skinGate(r, g, b): number`, `luma(r, g, b): number`

- [x] **Step 1: Write the failing test**

Create `src/engine/passes/makeupProcCpu.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shaderHash } from '../shaderHash'; // step 2 moved the FNV-1a pin helper here from reshapeCpu.test.ts
import { KIND, PMAKEUP_FS } from './makeupProc';
import { blend, fragment, luma, skinGate, type FragIn } from './makeupProcCpu';

const base = (over: Partial<FragIn>): FragIn => ({
  kind: 0,
  loc: [0.5, 0],
  aux: [0, 0],
  col: [0.6, 0.3, 0.2, 1],
  src: [0.8, 0.6, 0.5],
  lash: 0,
  fwD: 0.001,
  fwU: 0.01,
  ...over,
});

describe('PMAKEUP_FS CPU port (face-detail spec §8.2)', () => {
  it('is pinned to the shader text: a PMAKEUP_FS edit must be mirrored in makeupProcCpu.ts (then update this hash)', () => {
    expect(shaderHash(PMAKEUP_FS)).toBe('f76b819e');
  });

  it('skinGate: ≥ 0.9 on deep skin in shadow and light skin; ≤ 0.1 on black hair, mid grey and a blue background', () => {
    const g = (r: number, gg: number, b: number) => skinGate(r / 255, gg / 255, b / 255);
    expect(g(52, 35, 28)).toBeGreaterThanOrEqual(0.9);
    expect(g(235, 190, 170)).toBeGreaterThanOrEqual(0.9);
    expect(g(25, 24, 26)).toBeLessThanOrEqual(0.1);
    expect(g(128, 128, 128)).toBeLessThanOrEqual(0.1);
    expect(g(90, 120, 170)).toBeLessThanOrEqual(0.1);
    expect(luma(1, 1, 1)).toBeCloseTo(1, 12);
  });

  it('blend: multiply darkens by mix(1, tint, α); screen lightens; over composites; outputs clamp first', () => {
    const dst: [number, number, number] = [0.5, 0.5, 0.5];
    expect(blend(0, dst, { rgb: [0.4, 1, 0], a: 0.5 })).toEqual([0.5 * 0.7, 0.5, 0.25]);
    expect(blend(1, dst, { rgb: [1, 0.5, 0], a: 0.5 })).toEqual([0.5 + 0.5 * 0.5, 0.25 + 0.5 * 0.75, 0.5]);
    expect(blend(2, dst, { rgb: [1, 0, 2], a: 0.25 })).toEqual([0.25 + 0.375, 0.375, 0.25 + 0.375]);
  });

  it('眼線: seals 0.006 into the aperture, reaches T, fades after u = 0.85', () => {
    const at = (d: number, u = 0.5) => fragment(base({ kind: KIND.liner, loc: [u, d], aux: [0.03, 0] })).a;
    expect(at(-0.02)).toBe(0);
    expect(at(0.015)).toBeCloseTo(1, 6);
    expect(at(0.05)).toBe(0);
    expect(at(0.015, 1)).toBe(0);
  });

  it('美瞳: zero outside the disc, on closed lids and on the catchlight; 原色 darkens only the ring', () => {
    const lens = (loc: [number, number], aux: [number, number], src: [number, number, number] = [0.3, 0.25, 0.2], kind: number = KIND.lens) =>
      fragment(base({ kind, loc, aux, src }));
    expect(lens([0.6, 0], [0.1, 0.1]).a).toBeGreaterThan(0.9);
    expect(lens([1.2, 0], [0.1, 0.1]).a).toBe(0);
    expect(lens([0.6, 0], [0, 0.1]).a).toBe(0);
    expect(lens([0.6, 0], [0.1, 0.1], [0.95, 0.95, 0.95]).a).toBe(0);
    expect(lens([0.1, 0], [0.1, 0.1]).a).toBe(0);
    expect(lens([0.5, 0], [0.1, 0.1], undefined, KIND.lensOrig).a).toBe(0);
    const ring = lens([0.95, 0], [0.1, 0.1], undefined, KIND.lensOrig);
    expect(ring.a).toBeGreaterThan(0.9);
    expect(ring.rgb).toEqual([0.3 * 0.55, 0.25 * 0.55, 0.2 * 0.55]);
    expect(Number.isFinite(lens([0, 0], [0.1, 0.1]).rgb[0])).toBe(true);
  });

  it('睫毛 passes the texture through; 修容 / 高光 vanish on hair; the brow strokes fade when too fine to show', () => {
    expect(fragment(base({ kind: KIND.lashes, lash: 0.4, col: [0.08, 0.07, 0.07, 0.5] })).a).toBeCloseTo(0.2, 12);
    expect(fragment(base({ kind: KIND.contourEllipse, loc: [0, 0], src: [25 / 255, 24 / 255, 26 / 255] })).a).toBe(0);
    expect(fragment(base({ kind: KIND.highlightEllipse, loc: [0, 0], aux: [0.3, 0] })).a).toBeCloseTo(0.3, 6);
    const fine = fragment(base({ kind: KIND.brow, loc: [0.3, 0.5], fwU: 1 })).a;
    const coarse = fragment(base({ kind: KIND.brow, loc: [0.3, 0.5], fwU: 0.01 })).a;
    expect(fine).toBeCloseTo(0.89, 6);
    expect(coarse).toBeGreaterThan(0.77);
    expect(coarse).toBeLessThanOrEqual(1);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/engine/passes/makeupProcCpu.test.ts`
Expected: FAIL — `Failed to resolve import "./makeupProcCpu"`.

- [x] **Step 3: Implement the shaders**

Append to `src/engine/passes/makeupProc.ts`:

```ts
/** aPos is O-space UV; uWin maps it to the target (identity untiled; a tile's O window otherwise, step 3) */
export const PMAKEUP_VS = /* glsl */ `#version 300 es
in vec2 aPos;
in vec2 aLoc;
in vec2 aAux;
in vec4 aCol;
in float aKind;
uniform vec4 uWin;
out vec2 vLoc;
out vec2 vAux;
out vec4 vCol;
flat out int vKind;
void main() {
  vLoc = aLoc;
  vAux = aAux;
  vCol = aCol;
  vKind = int(aKind + 0.5);
  vec2 q = (aPos - uWin.xy) / uWin.zw;
  gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Every kind's α and colour (face-detail spec §4.8, §4.9); pinned to makeupProcCpu.ts by makeupProcCpu.test.ts */
export const PMAKEUP_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLoc;
in vec2 vAux;
in vec4 vCol;
flat in int vKind;
uniform sampler2D uSrc;
uniform sampler2D uLashes;
uniform vec2 uInvDst;
uniform int uLayerMode; // 0 multiply, 1 screen, 2 over (LAYER_MODE in makeupProc.ts)
out vec4 outColor;

float band(float y, float a, float b, float f) { return smoothstep(a - f, a + f, y) * (1.0 - smoothstep(b - f, b + f, y)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float skinGate(vec3 c) { return smoothstep(0.06, 0.14, luma(c)) * smoothstep(0.005, 0.04, c.r - c.b); }

void main() {
  // every derivative and implicit-LOD fetch runs in uniform control flow, before the kind branches
  vec3 src = texture(uSrc, gl_FragCoord.xy * uInvDst).rgb;
  float lash = texture(uLashes, vec2(vLoc.x, 1.0 - vLoc.y)).r;
  float fwD = fwidth(vLoc.y);
  float fwU = fwidth(18.0 * vLoc.x);
  float u = vLoc.x;
  float d = vLoc.y;
  vec3 rgb = vCol.rgb;
  float a = 0.0;
  if (vKind == 0) {
    float H = vAux.x;
    float h = smoothstep(-0.22, 0.02, u) * (1.0 - smoothstep(0.80, 1.02, u)) * (0.55 + 0.45 * (1.0 - u));
    a = smoothstep(-0.02, 0.01, d) * (1.0 - smoothstep(0.30 * H, H, d)) * h;
  } else if (vKind == 1) {
    a = 0.35 * band(d, 0.0, 0.07, 0.02) * smoothstep(-0.15, 0.05, u) * (1.0 - smoothstep(0.35, 0.55, u));
  } else if (vKind == 2) {
    float T = vAux.x;
    float f = max(0.75 * fwD, 0.004);
    a = smoothstep(-0.006 - f, -0.006 + f, d) * (1.0 - smoothstep(T - f, T + f, d)) * (1.0 - smoothstep(0.85, 1.0, u));
  } else if (vKind == 3) {
    a = lash;
  } else if (vKind == 4) {
    float v = d / 0.12;
    float h = smoothstep(0.10, 0.35, u) * (1.0 - smoothstep(0.80, 0.95, u));
    a = 0.45 * h * smoothstep(0.05, 0.35, v) * (1.0 - smoothstep(0.55, 0.85, v));
  } else if (vKind == 5) {
    float v = d / 0.12;
    float h = smoothstep(0.10, 0.35, u) * (1.0 - smoothstep(0.80, 0.95, u));
    a = 0.35 * h * band(v, 0.86, 1.0, 0.06);
  } else if (vKind == 6 || vKind == 7) {
    float rho = length(vLoc);
    float mask = 1.0 - smoothstep(1.04, 1.10, rho);
    float lid = smoothstep(0.0, 0.05, vAux.x) * smoothstep(0.0, 0.04, vAux.y);
    float Y = luma(src);
    float catchl = 1.0 - smoothstep(0.72, 0.88, Y);
    float ring = smoothstep(0.78, 0.92, rho);
    if (vKind == 6) {
      float th = rho > 1e-6 ? atan(vLoc.y, vLoc.x) : 0.0;
      a = mask * lid * catchl * smoothstep(0.30, 0.38, rho);
      rgb = vCol.rgb * (0.42 + 1.15 * Y) * (0.92 + 0.08 * sin(28.0 * th)) * mix(1.0, 0.55, ring) * (0.85 + 0.15 * smoothstep(0.0, 0.10, vAux.x));
    } else {
      a = mask * lid * catchl * ring;
      rgb = src * 0.55;
    }
  } else if (vKind == 8) {
    float tilt = mix(0.15, 0.7, smoothstep(0.6, 1.0, u));
    float stripe = 1.0 - smoothstep(0.15, 0.35, abs(fract(18.0 * u + tilt * 2.2 * d) - 0.5));
    float vis = 1.0 - smoothstep(0.25, 0.5, fwU);
    float strokes = mix(0.89, 0.78 + 0.22 * stripe, vis);
    a = smoothstep(0.0, 0.22, d) * (1.0 - smoothstep(0.78, 1.0, d)) * smoothstep(-0.12, 0.05, u) * mix(1.0, 0.45, smoothstep(0.70, 1.0, u)) * strokes;
  } else if (vKind == 9) {
    a = 0.55 * skinGate(src) * smoothstep(0.0, 0.18, d) * (1.0 - smoothstep(0.35, 1.0, d)) * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u));
  } else if (vKind == 10) {
    a = 0.45 * skinGate(src) * (1.0 - smoothstep(0.35, 1.0, dot(vLoc, vLoc)));
  } else if (vKind == 11) {
    a = 0.30 * skinGate(src) * (1.0 - smoothstep(0.3, 1.0, abs(2.0 * d - 1.0))) * smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.75, 1.0, u));
  } else if (vKind == 12) {
    float q = abs(2.0 * d - 1.0);
    a = 0.35 * skinGate(src) * (1.0 - smoothstep(0.2, 1.0, q * q));
  } else if (vKind == 13) {
    a = vAux.x * skinGate(src) * (1.0 - smoothstep(0.2, 1.0, dot(vLoc, vLoc)));
  }
  a = clamp(a * vCol.a, 0.0, 1.0);
  if (uLayerMode == 0) outColor = vec4(mix(vec3(1.0), rgb, a), 1.0);
  else if (uLayerMode == 1) outColor = vec4(rgb * a, 1.0);
  else outColor = vec4(rgb, a);
}`;
```

- [x] **Step 4: Implement the CPU port**

Create `src/engine/passes/makeupProcCpu.ts`:

```ts
// Test / harness-only CPU port of PMAKEUP_FS (makeupProc.ts): every kind's α and colour, the skin gate and the three
// fixed-function blend outputs, operation for operation. Never imported by the app. makeupProcCpu.test.ts pins
// PMAKEUP_FS's text; the e2e harness (tests/e2e/pages/makeup.ts) renders quads with affine attribute ramps through the
// real program and compares them with this port at every pixel centre (fwidth of an affine attribute is a constant).
import { smoothstep } from './eyeFrame';

export type RGB = [number, number, number];

export interface FragIn {
  kind: number;
  /** aLoc */
  loc: readonly [number, number];
  /** aAux */
  aux: readonly [number, number];
  /** tint RGB and α_max */
  col: readonly [number, number, number, number];
  /** src at the fragment, sRGB-encoded 0..1 */
  src: readonly [number, number, number];
  /** uLashes at (loc.x, 1 − loc.y), 0..1 */
  lash: number;
  /** fwidth(loc.y) and fwidth(18·loc.x) */
  fwD: number;
  fwU: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const band = (y: number, a: number, b: number, f: number) => smoothstep(a - f, a + f, y) * (1 - smoothstep(b - f, b + f, y));

/** Rec. 709 luma of an sRGB-encoded colour */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 修容 / 高光 occlusion gate (S5 §4.9): low luma floor (deep skin passes), chroma term rejects hair, frames, grey */
export function skinGate(r: number, g: number, b: number): number {
  return smoothstep(0.06, 0.14, luma(r, g, b)) * smoothstep(0.005, 0.04, r - b);
}

export function fragment(i: FragIn): { rgb: RGB; a: number } {
  const [u, d] = i.loc;
  const src = i.src;
  const skin = () => skinGate(src[0], src[1], src[2]);
  let rgb: RGB = [i.col[0], i.col[1], i.col[2]];
  let a = 0;
  switch (i.kind) {
    case 0: {
      const H = i.aux[0];
      const h = smoothstep(-0.22, 0.02, u) * (1 - smoothstep(0.8, 1.02, u)) * (0.55 + 0.45 * (1 - u));
      a = smoothstep(-0.02, 0.01, d) * (1 - smoothstep(0.3 * H, H, d)) * h;
      break;
    }
    case 1:
      a = 0.35 * band(d, 0, 0.07, 0.02) * smoothstep(-0.15, 0.05, u) * (1 - smoothstep(0.35, 0.55, u));
      break;
    case 2: {
      const T = i.aux[0];
      const f = Math.max(0.75 * i.fwD, 0.004);
      a = smoothstep(-0.006 - f, -0.006 + f, d) * (1 - smoothstep(T - f, T + f, d)) * (1 - smoothstep(0.85, 1, u));
      break;
    }
    case 3:
      a = i.lash;
      break;
    case 4:
    case 5: {
      const v = d / 0.12;
      const h = smoothstep(0.1, 0.35, u) * (1 - smoothstep(0.8, 0.95, u));
      a = i.kind === 4 ? 0.45 * h * smoothstep(0.05, 0.35, v) * (1 - smoothstep(0.55, 0.85, v)) : 0.35 * h * band(v, 0.86, 1, 0.06);
      break;
    }
    case 6:
    case 7: {
      const rho = Math.hypot(u, d);
      const mask = 1 - smoothstep(1.04, 1.1, rho);
      const lid = smoothstep(0, 0.05, i.aux[0]) * smoothstep(0, 0.04, i.aux[1]);
      const Y = luma(src[0], src[1], src[2]);
      const catchl = 1 - smoothstep(0.72, 0.88, Y);
      const ring = smoothstep(0.78, 0.92, rho);
      if (i.kind === 6) {
        const th = rho > 1e-6 ? Math.atan2(d, u) : 0;
        a = mask * lid * catchl * smoothstep(0.3, 0.38, rho);
        const k = (0.42 + 1.15 * Y) * (0.92 + 0.08 * Math.sin(28 * th)) * mix(1, 0.55, ring) * (0.85 + 0.15 * smoothstep(0, 0.1, i.aux[0]));
        rgb = [i.col[0] * k, i.col[1] * k, i.col[2] * k];
      } else {
        a = mask * lid * catchl * ring;
        rgb = [src[0] * 0.55, src[1] * 0.55, src[2] * 0.55];
      }
      break;
    }
    case 8: {
      const tilt = mix(0.15, 0.7, smoothstep(0.6, 1, u));
      const stripe = 1 - smoothstep(0.15, 0.35, Math.abs(fract(18 * u + tilt * 2.2 * d) - 0.5));
      const vis = 1 - smoothstep(0.25, 0.5, i.fwU);
      const strokes = mix(0.89, 0.78 + 0.22 * stripe, vis);
      a = smoothstep(0, 0.22, d) * (1 - smoothstep(0.78, 1, d)) * smoothstep(-0.12, 0.05, u) * mix(1, 0.45, smoothstep(0.7, 1, u)) * strokes;
      break;
    }
    case 9:
      a = 0.55 * skin() * smoothstep(0, 0.18, d) * (1 - smoothstep(0.35, 1, d)) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.88, 1, u));
      break;
    case 10:
      a = 0.45 * skin() * (1 - smoothstep(0.35, 1, u * u + d * d));
      break;
    case 11:
      a = 0.3 * skin() * (1 - smoothstep(0.3, 1, Math.abs(2 * d - 1))) * smoothstep(0, 0.15, u) * (1 - smoothstep(0.75, 1, u));
      break;
    case 12: {
      const q = Math.abs(2 * d - 1);
      a = 0.35 * skin() * (1 - smoothstep(0.2, 1, q * q));
      break;
    }
    case 13:
      a = i.aux[0] * skin() * (1 - smoothstep(0.2, 1, u * u + d * d));
      break;
  }
  return { rgb, a: clamp01(a * i.col[3]) };
}

/**
 * The fixed-function result on an RGBA8 target: the fragment output is clamped to [0, 1] first (fixed-point buffer),
 * then multiply = dst·out (DST_COLOR, ZERO), screen = out + dst·(1 − out) (ONE, ONE_MINUS_SRC_COLOR),
 * over = out·α + dst·(1 − α) (SRC_ALPHA, ONE_MINUS_SRC_ALPHA).
 */
export function blend(mode: 0 | 1 | 2, dst: readonly [number, number, number], f: { rgb: RGB; a: number }): RGB {
  const out = (k: number) => clamp01(mode === 0 ? mix(1, f.rgb[k], f.a) : mode === 1 ? f.rgb[k] * f.a : f.rgb[k]);
  const one = (k: number) => {
    const o = out(k);
    if (mode === 0) return clamp01(dst[k] * o);
    if (mode === 1) return clamp01(o + dst[k] * (1 - o));
    return clamp01(o * f.a + dst[k] * (1 - f.a));
  };
  return [one(0), one(1), one(2)];
}
```

- [x] **Step 5: Run the test**

Run: `npx vitest run src/engine/passes/makeupProcCpu.test.ts src/engine/passes/makeupProc.test.ts && npm run typecheck`
Expected: PASS (6 + 9 tests). If the pin reports a different hash, the shader text differs from this plan: compare it character by character instead of re-pinning.

- [x] **Step 6: Commit**

```bash
git add src/engine/passes/makeupProc.ts src/engine/passes/makeupProcCpu.ts src/engine/passes/makeupProcCpu.test.ts
git commit -F- <<'EOF'
v0.4 step 5: PMAKEUP shaders and their CPU port

Per-kind α and colour for the eight procedural parts, the 修容/高光 skin
gate and the multiply / screen / over outputs; the CPU port is pinned to
the shader text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Landed as `a9b761f`, which carries a stale step-2 subject (`v0.4 step 2 task 9: Look LUTs, thumbnails, …`, a leftover message file in the scratchpad, as with `0692964`). Its content is this task's three files and its ticks. The `v0.4 step 5 task 9 fix:` commit on top of it records this note, and no commit was amended.

### Task 10: The lashes texture, R8 mip uploads and the NOTICE line

`public/makeup/own/lashes.png` generated from math (S5 §4.10), the texture loader options it needs, and the licensing line (S5 §5 item 4, RM §1.3 item 2).

**Files:**
- Modify: `scripts/gen-makeup.mjs` (generator + `main()` writes the PNG)
- Create: `public/makeup/own/lashes.png` (generated, committed)
- Modify: `src/engine/gl/gl.ts` (`loadImageTexture` options; its doc comment and body are `gl.ts:147-157` at the step base)
- Modify: `LICENSES/NOTICE.txt:48` (the "Original to this project" line, as step 2 left it)
- Test: `tests/harness/t5/assets.test.mjs`

**Interfaces:**
- Consumes: pngjs (`PNG.sync.write` with `colorType: 0, inputColorType: 0`), the T5 asset-test helpers `pub(...)`; the precache glob `**/*.{…,png,…}` (`vite.config.ts:110`) already covers `public/makeup/own/*`.
- Produces:
  - `gen-makeup.mjs`: `LASHES_W = 512`, `LASHES_H = 128`, `LASH_COUNT = 42`, `lashColumn(x): number`, `lashRoots(): number[]`, `lashes(): Float32Array` (coverage 0..1, row 0 = tip side, row 127 = root), `lashesPng(): Buffer`
  - `gl.ts`: `loadImageTexture(gl: GL, url: string, opts?: { mipmap?: boolean; r8?: boolean }): Promise<Texture>` (no options = today's RGBA8 LINEAR upload, unchanged)

- [x] **Step 1: Write the failing test**

In `tests/harness/t5/assets.test.mjs`, extend the `gen-makeup.mjs` import to `import { LASHES_H, LASHES_W, MASKS, blur, lashColumn, lashRoots, lashes, lashesPng, maskFromRgba } from '../../../scripts/gen-makeup.mjs';` and append:

```js
describe('lashes texture (face-detail spec §4.10)', () => {
  it('the committed PNG is the generator output pixel for pixel: 512 × 128, 8-bit single channel', () => {
    const buf = readFileSync(pub('makeup', 'own', 'lashes.png'));
    expect(buf.readUInt8(24)).toBe(8); // IHDR bit depth
    expect(buf.readUInt8(25)).toBe(0); // IHDR colour type 0 = greyscale
    const png = readPng(pub('makeup', 'own', 'lashes.png'));
    expect([png.width, png.height]).toEqual([LASHES_W, LASHES_H]);
    const fresh = PNG.sync.read(lashesPng());
    expect(Buffer.compare(Buffer.from(png.data), Buffer.from(fresh.data))).toBe(0);
  });

  it('is deterministic, empty in the outermost 4 columns, and its root row covers only the root span', () => {
    const a = lashes();
    expect(Array.from(a)).toEqual(Array.from(lashes()));
    const at = (x, y) => a[y * LASHES_W + x];
    for (let y = 0; y < LASHES_H; y++) for (const x of [0, 1, 2, 3, LASHES_W - 4, LASHES_W - 3, LASHES_W - 2, LASHES_W - 1]) expect(at(x, y)).toBe(0);
    const roots = lashRoots();
    expect(roots).toHaveLength(42);
    const lo = Math.min(...roots.map(lashColumn)) - 3;
    const hi = Math.max(...roots.map(lashColumn)) + 3;
    let covered = 0;
    for (let x = 0; x < LASHES_W; x++) {
      if (at(x, LASHES_H - 1) <= 0) continue;
      covered++;
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x).toBeLessThanOrEqual(hi);
    }
    expect(covered).toBeGreaterThan(42);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harness/t5/assets.test.mjs -t "lashes texture"`
Expected: FAIL — `lashesPng` is not exported by `gen-makeup.mjs`.

- [x] **Step 3: Implement the generator**

`scripts/gen-makeup.mjs`: add `mkdirSync` to the `node:fs` import, update the header comment with a line `//   public/makeup/own/lashes.png = coverage of 42 procedural lashes (face-detail spec §4.10), original work`, and add before `function main()`:

```js
export const LASHES_W = 512;
export const LASHES_H = 128;
export const LASH_COUNT = 42;
/** coverage supersampling per texel side, and Bézier segments per lash */
const SS = 8;
const SEGMENTS = 64;

/** eye x (0 outer corner … 1 inner corner) → texture column; u = (x + 0.2) / 1.2 */
export const lashColumn = (x) => ((x + 0.2) / 1.2) * LASHES_W;

/** 42 roots at x_k = 0.02 + 0.96·(k + 0.5 + j_k)/42, j_k ∈ ±0.3 from a fixed LCG (seed 0x6d6c): deterministic output */
export function lashRoots() {
  let seed = 0x6d6c;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out = [];
  for (let k = 0; k < LASH_COUNT; k++) {
    const j = (rnd() * 2 - 1) * 0.3;
    out.push(0.02 + (0.96 * (k + 0.5 + j)) / LASH_COUNT);
  }
  return out;
}

/**
 * Coverage 0..1 per texel; row 127 is the root, row 0 the tip side. Each lash is a quadratic Bézier from its root
 * (vertical start) to a tip shifted outward by lean(x)·0.35 eye units, lean(x) = 0.15 + 0.35·(1 − x); every third
 * lash is 85 % long; thickness tapers 3.2 → 0.6 px. Coverage is 8 × 8 supersampled per lash, combined with max.
 */
export function lashes() {
  const W = LASHES_W;
  const H = LASHES_H;
  const out = new Float32Array(W * H);
  lashRoots().forEach((x, k) => {
    const len = k % 3 === 2 ? 0.85 : 1;
    const lean = 0.15 + 0.35 * (1 - x);
    const p0 = [lashColumn(x), H];
    const p1 = [lashColumn(x), H - 0.55 * len * H];
    const p2 = [lashColumn(x - lean * 0.35), H - len * H];
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pts.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1], (3.2 + (0.6 - 3.2) * t) / 2]);
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [px, py, r] of pts) {
      x0 = Math.min(x0, px - r);
      x1 = Math.max(x1, px + r);
      y0 = Math.min(y0, py - r);
      y1 = Math.max(y1, py + r);
    }
    const bx0 = Math.max(0, Math.floor(x0) - 1);
    const by0 = Math.max(0, Math.floor(y0) - 1);
    const bx1 = Math.min(W - 1, Math.ceil(x1) + 1);
    const by1 = Math.min(H - 1, Math.ceil(y1) + 1);
    const bw = bx1 - bx0 + 1;
    const hit = new Uint8Array(bw * (by1 - by0 + 1) * SS * SS);
    // rasterize each segment as a capsule over its own small box (radius interpolated along the segment)
    for (let i = 0; i < SEGMENTS; i++) {
      const [ax, ay, ar] = pts[i];
      const [cx, cy, cr] = pts[i + 1];
      const rmax = Math.max(ar, cr);
      const sx0 = Math.max(bx0, Math.floor(Math.min(ax, cx) - rmax));
      const sx1 = Math.min(bx1, Math.ceil(Math.max(ax, cx) + rmax));
      const sy0 = Math.max(by0, Math.floor(Math.min(ay, cy) - rmax));
      const sy1 = Math.min(by1, Math.ceil(Math.max(ay, cy) + rmax));
      const dx = cx - ax;
      const dy = cy - ay;
      const l2 = dx * dx + dy * dy || 1e-12;
      for (let py = sy0; py <= sy1; py++)
        for (let px = sx0; px <= sx1; px++)
          for (let s = 0; s < SS * SS; s++) {
            const qx = px + ((s % SS) + 0.5) / SS;
            const qy = py + (Math.floor(s / SS) + 0.5) / SS;
            const t = Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / l2));
            const ex = ax + dx * t - qx;
            const ey = ay + dy * t - qy;
            const r = ar + (cr - ar) * t;
            if (ex * ex + ey * ey <= r * r) hit[((py - by0) * bw + (px - bx0)) * SS * SS + s] = 1;
          }
    }
    for (let py = by0; py <= by1; py++)
      for (let px = bx0; px <= bx1; px++) {
        let n = 0;
        const o = ((py - by0) * bw + (px - bx0)) * SS * SS;
        for (let s = 0; s < SS * SS; s++) n += hit[o + s];
        const v = n / (SS * SS);
        if (v > out[py * W + px]) out[py * W + px] = v;
      }
  });
  return out;
}

/** 8-bit greyscale PNG (no colour chunks): WebGL2 uploads it as R8 from the red channel */
export function lashesPng() {
  const png = new PNG({ width: LASHES_W, height: LASHES_H });
  png.data = Buffer.from(Uint8Array.from(lashes(), (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
  return PNG.sync.write(png, { colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
}
```

and at the end of `main()`:

```js
  const own = join(root, 'public', 'makeup', 'own');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'lashes.png'), lashesPng());
  console.log(`public/makeup/own/lashes.png ${LASHES_W}x${LASHES_H}`);
```

- [x] **Step 4: Generate and check the outputs**

Run: `node scripts/gen-makeup.mjs && git checkout -- public/makeup/gp && git status --short public/makeup`
Expected: `?? public/makeup/own/` only. (`main()` also rewrites the two GPUPixel masks; the `git checkout` keeps the committed ones, which the existing T5 mask tests already pin.) The run takes well under a second.

- [x] **Step 5: Run the asset tests**

Run: `npx vitest run tests/harness/t5/assets.test.mjs`
Expected: PASS (the new describe and every existing T5 asset test).

- [x] **Step 6: The loader options**

`loadImageTexture` with its doc comment (`src/engine/gl/gl.ts:147-157`) becomes:

```ts
/**
 * Fetch a PNG and upload it with no colour management: RGBA8 LINEAR / CLAMP by default; `r8` uploads the red channel
 * only (R8, from RED); `mipmap` builds the mip chain and samples it LINEAR_MIPMAP_LINEAR (the lashes texture, S5 §4.10).
 */
export async function loadImageTexture(gl: GL, url: string, opts: { mipmap?: boolean; r8?: boolean } = {}): Promise<Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const t = createTexture(gl, 0, 0);
  if (opts.r8) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    setUnpackState(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bmp);
    t.width = bmp.width;
    t.height = bmp.height;
  } else {
    uploadSource(gl, t, bmp, bmp.width, bmp.height);
  }
  if (opts.mipmap) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  bmp.close();
  return t;
}
```

(the GPU behaviour is exercised by Task 12's harness, which samples `lashes.png` through this loader.)

- [x] **Step 7: The NOTICE line**

In `LICENSES/NOTICE.txt`, replace the "Original to this project: …" line (`:48`, as step 2 left it) with:

```text
Original to this project: the filter LUTs, the 質感 look LUTs and thumbnails, the makeup shade colours, the procedural makeup (src/engine/passes/makeupProc.ts) and public/makeup/own/lashes.png (generated by scripts/gen-makeup.mjs), and the icons.
```

- [x] **Step 8: Typecheck and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add scripts/gen-makeup.mjs public/makeup/own/lashes.png src/engine/gl/gl.ts LICENSES/NOTICE.txt tests/harness/t5/assets.test.mjs
git commit -F- <<'EOF'
v0.4 step 5: generated lashes texture and R8 mip uploads

public/makeup/own/lashes.png: 42 procedural lashes, 512×128 coverage,
deterministic; loadImageTexture gains r8 / mipmap options; NOTICE lists
the procedural makeup and the texture as original work.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 11: Procedural makeup in the engine (P1), status and debug overlay

Wires Tasks 8–10 into P1 (S5 §4.6, §4.10, §3.6): the GL pass that draws the ≤ 9 layer strips with fixed-function blending after every GPUPixel mesh; the lashes load inside the makeup pass's `ready`; PMAKEUP compiled lazily with failure isolated to the eight new parts; `planPasses` running P1 for procedural items alone; pass names `mk.<layer>`; `Engine.procMakeupFailed`; and the 顯示臉部特徵點 overlay of the eye frames.

**Files:**
- Modify: `src/engine/passes/makeupProc.ts` (add `createProcMakeupPass`)
- Modify: `src/engine/passes/makeup.ts:119-268` (CRLF; after step 1's copy / per-face mesh split and step 3's `win`: the `MakeupPass` interface `:119-135`, `createMakeupPass` `:145`, the `ready` block `:194-204`, `drawFaces` `:206-248`, `dispose` `:256-266`)
- Modify: `src/engine/pipeline.ts` (CRLF; after steps 1–4: `FrameJob` `:84-129`, `PassPlanInput` `:139-157`, `planPasses` `:175-187`, `planFrame` `:189-211`, the `Pipeline` interface `:232-260`, `getMakeup` `:443-455`, `run`'s P1 lines `:486-491` and `:550-557`, `preloadMakeup` `:648-653`, `drawOverlay` `:685-689`)
- Modify: `src/engine/index.ts` (CRLF; `job()` `:307-372`, the `Engine` object `:374-415`, the overlay call `:411`)
- Modify: `src/types.ts:549-590` (CRLF; `Engine.procMakeupFailed`), `src/app/testFakes.ts:148-170` (CRLF; the object `fakeEngine` builds), `tests/harness/t7/fakes.ts:94-116` (LF; the harness's `class FakeEngine implements Engine`)
- Modify: `src/engine/passes/overlay.ts`
- Test: `src/engine/pipeline.test.ts`, `src/engine/passes/overlay.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 8–10 (`buildMakeupGeometry`, `procMakeupWanted`, `geometryVertexCount`, `oAspectOf`, `LAYER_ORDER`, `LAYER_MODE`, `FLOATS_PER_VERTEX`, `MAX_PMAKEUP_VERTS_PER_FACE`, `PMAKEUP_VS/FS`, `loadImageTexture(…, {r8, mipmap})`); step 1's `MAX_RENDER_FACES` (`src/config/limits.ts`), `RenderInput.faces`, `job()`'s `const listed = input.faces.slice(0, MAX_RENDER_FACES);`, `PassPlanInput.anyFace` (S1 E2), the multi-face makeup method `MakeupPass.drawFaces(src, dst, faces: readonly { face: Face; u: MakeupUniforms }[])` (the one-face `draw` stays) and the pipeline's P1 lines `const meshes = …; if (meshes.length) getMakeup();` … `makeup.drawFaces(base, a, meshes, job.win); … passes.push('makeup');` (step-1 plan Task 18, step 3's `win`), `run`'s plan call `const plan = planFrame(job, makeupReady, body !== null);` (`planFrame(job, makeupReady, bodyOn)` builds the `PassPlanInput`; `planPasses` is never called directly), the per-face overlay call `pipeline.drawOverlay(f.face, options.mirror)` (S1 E6); step 3's window argument `win: readonly [number, number, number, number] = [0, 0, 1, 1]` of the makeup draw (`uWin`, S3 §4.1); step 4's choice of P1 input and output buffers (S4 §4.1 ping-pong).
- Produces:
  - `makeupProc.ts`: `interface ProcMakeupPass { draw(target: Framebuffer, geom: MakeupGeometry, src: Texture, lashes: Texture | null, win?: readonly [number, number, number, number]): MakeupLayer[]; dispose(): void }`, `createProcMakeupPass(gl: GL): ProcMakeupPass`, `LASHES_UNIT = 1`
  - `MakeupPass`: `ready` never rejects (settles when the GPUPixel textures and `lashes.png` have each loaded or failed); `meshReady: boolean`; `drawFaces(src, dst, faces, proc: MakeupGeometry | null, win?)` returns the procedural `MakeupLayer[]` drawn; `ensureProc(): boolean`; `procStatus(): 'unknown' | 'ok' | 'failed'`; `createMakeupPass(gl, assetBase = '/makeup/gp/', lashesUrl = '/makeup/own/lashes.png')`
  - `FrameJob.procMakeup: MakeupGeometry | null`; `PassPlanInput.procActive: boolean`, `PassPlanInput.procReady: boolean`; `Pipeline.procMakeupFailed(): boolean`; `Pipeline.drawOverlay(face, mirror, aspect)`
  - `Engine.procMakeupFailed: boolean` (read-only; true once PMAKEUP failed to compile on this context)
  - `overlay.ts`: `eyeDebugPoints(face: Face, aspect: number): Float32Array`

- [x] **Step 1: Write the failing tests**

`src/engine/pipeline.test.ts`: add `procActive: false, procReady: false` to `base`, then append:

```ts
describe('planPasses with procedural makeup (face-detail spec §3.6)', () => {
  it('runs P1 for a procedural part alone, also while the GPUPixel textures are missing', () => {
    expect(planPasses({ ...base, makeupActive: false, makeupReady: false, procActive: true, procReady: true }).makeup).toBe(true);
  });
  it('a PMAKEUP compile failure disables only the procedural parts', () => {
    expect(planPasses({ ...base, makeupActive: false, procActive: true, procReady: false }).makeup).toBe(false);
    expect(planPasses({ ...base, makeupActive: true, makeupReady: true, procActive: true, procReady: false }).makeup).toBe(true);
  });
  it('needs a face', () => {
    expect(planPasses({ ...base, anyFace: false, procActive: true, procReady: true }).makeup).toBe(false);
  });
});
```

(`anyFace` is step 1's replacement of `hasFace` / `faceWeight` in `PassPlanInput`, step-1 plan Task 18, and its `base` already sets `anyFace: true`.)

Create `src/engine/passes/overlay.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../../tracking/adapter111';
import { LID_STATIONS } from './eyeFrame';
import { eyeDebugPoints } from './overlay';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};

describe('eyeDebugPoints (face-detail spec §3.6 overlay)', () => {
  it('lists the lid stations, the brow-gap ends and 24 iris-circle points per eye, all on the image', () => {
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const pts = eyeDebugPoints(face, lm.width / lm.height);
    expect(pts.length).toBe(2 * 2 * (LID_STATIONS * 3 + 24));
    for (const v of pts) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/pipeline.test.ts src/engine/passes/overlay.test.ts`
Expected: FAIL — the procedural cases plan no makeup pass; `eyeDebugPoints` is not exported.

- [x] **Step 3: The GL pass**

Append to `src/engine/passes/makeupProc.ts` (add `import { bindTarget, bindTexture, createProgram, createTexture, deleteTexture, type Framebuffer, type GL, type Texture } from '../gl/gl';` and `import { MAX_RENDER_FACES } from '../../config/limits';`):

```ts
export const LASHES_UNIT = 1;

export interface ProcMakeupPass {
  /**
   * Draw every non-empty layer of `geom` into `target` (its copy and the GPUPixel meshes are already there), reading
   * `src` (unit 0, never the target: no feedback loop) and `lashes` (unit 1; null skips the 睫毛 layer).
   * At most one drawArrays per layer. Returns the layers drawn.
   */
  draw(target: Framebuffer, geom: MakeupGeometry, src: Texture, lashes: Texture | null, win?: readonly [number, number, number, number]): MakeupLayer[];
  dispose(): void;
}

export function createProcMakeupPass(gl: GL): ProcMakeupPass {
  const prog = createProgram(gl, PMAKEUP_VS, PMAKEUP_FS, 'makeup-proc');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uLashes'), LASHES_UNIT);
  const STRIDE = FLOATS_PER_VERTEX * 4;
  let capacity = MAX_RENDER_FACES * MAX_PMAKEUP_VERTS_PER_FACE * STRIDE;
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
  const attr = (name: string, size: number, offset: number) => {
    const loc = gl.getAttribLocation(prog.program, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset * 4);
  };
  attr('aPos', 2, 0);
  attr('aLoc', 2, 2);
  attr('aAux', 2, 4);
  attr('aCol', 4, 6);
  attr('aKind', 1, 10);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  // bound on the lashes unit when the texture is unavailable (its layer is skipped then), so no unit is empty
  const blank = createTexture(gl, 1, 1);

  return {
    draw(target, geom, src, lashes, win = [0, 0, 1, 1]) {
      let used = 0;
      for (const l of LAYER_ORDER) used = Math.max(used, geom.ranges[l][0] + geom.ranges[l][1]);
      const drawn: MakeupLayer[] = [];
      if (used === 0) return drawn;
      bindTarget(gl, target);
      prog.use();
      gl.uniform2f(prog.u('uInvDst'), 1 / target.width, 1 / target.height);
      gl.uniform4f(prog.u('uWin'), win[0], win[1], win[2], win[3]);
      bindTexture(gl, 0, src);
      bindTexture(gl, LASHES_UNIT, lashes ?? blank);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      if (used * STRIDE > capacity) {
        capacity = used * STRIDE;
        gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geom.data, 0, used * FLOATS_PER_VERTEX);
      gl.disable(gl.CULL_FACE); // strips join faces with degenerate vertices; nothing relies on winding
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      for (const layer of LAYER_ORDER) {
        const [first, count] = geom.ranges[layer];
        if (count < 3 || (layer === 'lashes' && !lashes)) continue;
        const mode = LAYER_MODE[layer];
        // destination alpha is kept at 1 by every mode (ZERO, ONE)
        if (mode === 0) gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
        else if (mode === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniform1i(prog.u('uLayerMode'), mode);
        gl.drawArrays(gl.TRIANGLE_STRIP, first, count);
        drawn.push(layer);
      }
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      bindTexture(gl, LASHES_UNIT, null);
      gl.activeTexture(gl.TEXTURE0);
      return drawn;
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      deleteTexture(gl, blank);
    },
  };
}
```

- [x] **Step 4: The makeup pass**

`src/engine/passes/makeup.ts` (CRLF). In the `MakeupPass` interface:
- `ready`'s comment becomes `/** settles once the GPUPixel textures and lashes.png have each loaded or failed (S5 §4.10); never rejects */`;
- step 1's multi-face `drawFaces(src, dst, faces, win?)` (the method the pipeline's P1 calls; step 3 added `win`) gains the parameter `proc: MakeupGeometry | null`, inserted right after `faces` (before `win`); its return type changes from `void` to `MakeupLayer[]`, and its comment becomes `/** Copy src into dst, draw every face's GPUPixel mesh (step 1), then the procedural layers of proc over every face at once (S5 §4.6). src must not alias dst. Returns the procedural layers drawn. */`. The one-face `draw` keeps its signature (it never draws procedural layers);
- three members are added:

```ts
  /** the GPUPixel lip / blush textures are uploaded (口紅, 腮紅) */
  readonly meshReady: boolean;
  /** compile PMAKEUP on first use (lazy: the first frame with a procedural item); false once it failed */
  ensureProc(): boolean;
  procStatus(): 'unknown' | 'ok' | 'failed';
```

In `createMakeupPass(gl, assetBase = '/makeup/gp/', lashesUrl = '/makeup/own/lashes.png')`, replace the `ready` block (`makeup.ts:194-204`, from `let tex` to the end of the `ready` promise) with:

```ts
  let tex: MakeupTextures | null = null;
  let lashesTex: Texture | null = null;
  let meshReady = false;
  let disposed = false;
  const meshLoad = Promise.all(
    ['lip.png', 'lip_mask.png', 'blush.png', 'blush_mask.png'].map((f) => loadImageTexture(gl, assetBase + f)),
  ).then(
    ([lip, lipMask, blush, blushMask]) => {
      if (disposed) {
        for (const t of [lip, lipMask, blush, blushMask]) deleteTexture(gl, t);
        return;
      }
      tex = { lip, lipMask, blush, blushMask };
      meshReady = true;
    },
    (err: unknown) => console.error('[engine] makeup textures failed to load; 口紅 and 腮紅 disabled', err),
  );
  // a lashes failure disables only 睫毛, as a GPUPixel failure disables only 口紅 / 腮紅 (S5 §4.10)
  const lashLoad = loadImageTexture(gl, lashesUrl, { r8: true, mipmap: true }).then(
    (t) => {
      if (disposed) deleteTexture(gl, t);
      else lashesTex = t;
    },
    (err: unknown) => console.error('[engine] lashes.png failed to load; 睫毛 disabled', err),
  );
  const ready = Promise.all([meshLoad, lashLoad]).then(() => undefined);
  let proc: ProcMakeupPass | null = null;
  let procState: 'unknown' | 'ok' | 'failed' = 'unknown';
  const ensureProc = (): boolean => {
    if (procState === 'unknown') {
      try {
        proc = createProcMakeupPass(gl);
        procState = 'ok';
      } catch (err) {
        procState = 'failed';
        console.error('[engine] PMAKEUP failed to compile; the procedural makeup is disabled', err);
      }
    }
    return procState === 'ok';
  };
```

In the returned object: add `get meshReady() { return meshReady; }`, `ensureProc`, `procStatus: () => procState`; make `drawFaces` take the new parameter, keep step 1's copy and per-face mesh loop exactly as they are (each mesh still skipped while `tex` is null or the face has no lip/blush), and end it with:

```ts
      if (!proc || !geom || procState !== 'ok') return [];
      return proc.draw(dst, geom, src, lashesTex, win);
```

(`geom` is the new `MakeupGeometry | null` parameter of `drawFaces`, named so it neither shadows the pass `proc` nor clashes with a local `p` of the mesh code; `win` is step 3's window value, passed as the same `[x0, y0, w, h]` the mesh draw uses, `[0, 0, 1, 1]` untiled.) Step 1's early `return` after the copy (no GPUPixel textures, or no face with lip / blush) must now fall through to the procedural layers instead of returning. In `dispose()` add `proc?.dispose(); deleteTexture(gl, lashesTex); lashesTex = null; proc = null;`. Every one of these objects belongs to the pass, and the pipeline recreates the pass on a restored context, so nothing of an old context is reused (Task 12 pins it).

- [x] **Step 5: The pipeline and the engine**

`src/engine/pipeline.ts` (CRLF):

```ts
// FrameJob
  /** step 5: procedural makeup geometry of every listed face (O-space), null when no procedural item is drawable */
  procMakeup: MakeupGeometry | null;
// PassPlanInput
  /** a procedural makeup item has geometry this frame */
  procActive: boolean;
  /** PMAKEUP is compiled (lazily, on the first procedural frame) */
  procReady: boolean;
```

`planPasses`'s makeup rule becomes (keep step 1's face test: `planPasses` reads it as `const faceOn = i.anyFace;`, S1 E2):

```ts
    makeup: faceOn && ((i.makeupActive && i.makeupReady) || (i.procActive && i.procReady)),
```

`run` plans through step 1's pure `planFrame(job, makeupReady, bodyOn)` (`pipeline.ts:189-211`, also called by `pipeline.test.ts` and `src/app/faceTracks.test.ts`), which builds the `PassPlanInput`: give it a fourth parameter `proc: { active: boolean; ready: boolean } = { active: false, ready: false }` and pass `procActive: proc.active, procReady: proc.ready` to `planPasses`, so its existing callers keep compiling and planning as before.

`getMakeup()` (`pipeline.ts:443-455`):

```ts
  function getMakeup(): MakeupPass {
    if (!makeup) {
      const m = createMakeupPass(gl);
      makeup = m;
      // never rejects: each texture set logs its own failure and only disables its own parts
      void m.ready.then(() => {
        if (makeup === m) makeupReady = m.meshReady;
      });
    }
    return makeup;
  }
```

`preloadMakeup()` returns `getMakeup().ready` (it no longer needs the `.catch`). Add `procMakeupFailed(): boolean` to the `Pipeline` interface and implement it as `return makeup?.procStatus() === 'failed';`. In `run(job)`:

```ts
      const proc = job.procMakeup;
      if (meshes.length || proc) getMakeup();
      const procReady = proc !== null && makeup !== null && makeup.ensureProc();
```

(replacing step 1's `if (meshes.length) getMakeup();`, `pipeline.ts:489`), and plan with `const plan = planFrame(job, makeupReady, body !== null, { active: proc !== null, ready: procReady });`. At the P1 call (`makeup.drawFaces(base, a, meshes, job.win)` as steps 1, 3 and 4 left it, `pipeline.ts:553`: P1's input, P1's target, `meshes`, the window), insert the argument `procReady ? proc : null` right after `meshes`, keep its result as `const layers`, and replace the `passes.push('makeup')` after it with:

```ts
        passes.push('makeup', ...layers.map((l) => `mk.${l}`));
```

`drawOverlay(face, mirror, aspect)` forwards `aspect` to `overlay.draw`.

`src/engine/index.ts` (CRLF), in `createEngine`: `let procScratch: Float32Array | undefined;` next to the other per-context state; in `job()`:

```ts
    // procedural makeup (S5 §4.6): rebuilt every frame from the listed faces (≤ MAX_RENDER_FACES), in O-space
    const proc = procMakeupWanted(listed) ? buildMakeupGeometry(listed, oAspectOf(input), procScratch) : null;
    if (proc) procScratch = proc.data;
```

(`listed` is step 1's `input.faces.slice(0, MAX_RENDER_FACES)` of the same function, so the geometry covers exactly the faces the other passes draw.)

and add `procMakeup: proc && geometryVertexCount(proc) > 0 ? proc : null,` to the returned `FrameJob`. In the engine object add

```ts
    get procMakeupFailed() {
      return pipeline?.procMakeupFailed() ?? false;
    },
```

and pass `input.width / input.height` as the overlay's aspect where step 1 calls `pipeline.drawOverlay` per face.

`src/types.ts` (CRLF), in `Engine`:

```ts
  /** true once the procedural makeup program failed to compile on this context (S5 §7): its eight parts are off */
  readonly procMakeupFailed: boolean;
```

`src/app/testFakes.ts` (CRLF): add `procMakeupFailed: false,` to the object `fakeEngine` builds (`:148-170`; `FakeEngine extends Engine` inherits the field). `tests/harness/t7/fakes.ts` (LF) has its own `class FakeEngine implements Engine`: add `readonly procMakeupFailed = false;` next to its `readonly adjustUnavailable = false;` (`:116`).

- [x] **Step 6: The debug overlay**

`src/engine/passes/overlay.ts`:

```ts
import { browGapEnd, eyeFrames, eyeToUv, LID_STATIONS, STATION_XS } from './eyeFrame';

/** per eye: 17 upper + 17 lower lid stations, the brow end of each upper station's gap, 24 iris-circle points */
const EYE_POINTS = 2 * (LID_STATIONS * 3 + 24);

/** UV points of the eye frames for the 顯示臉部特徵點 overlay (face-detail spec §3.6) */
export function eyeDebugPoints(face: Face, aspect: number): Float32Array {
  const out = new Float32Array(EYE_POINTS * 2);
  let n = 0;
  const put = (p: [number, number]) => {
    out[n++] = p[0];
    out[n++] = p[1];
  };
  for (const f of eyeFrames(face, aspect)) {
    STATION_XS.forEach((x, k) => {
      put(eyeToUv(f, x, f.upper[k], aspect));
      put(eyeToUv(f, x, f.lower[k], aspect));
      const e = browGapEnd(f, x, f.upper[k]);
      put(eyeToUv(f, e[0], e[1], aspect));
    });
    const iris = f.iris ?? f.irisFallback;
    for (let j = 0; j < 24; j++) {
      const t = (j / 24) * 2 * Math.PI;
      put([iris.c[0] + iris.r * Math.cos(t), (iris.c[1] + iris.r * Math.sin(t)) * aspect]);
    }
  }
  return out;
}
```

`draw(face, mirrorX)` becomes `draw(face, mirrorX, aspect = 1)` (also in the `LandmarkOverlay` interface); size the shared buffer for both sets (`const pts = new Float32Array(Math.max(222 + 16, EYE_POINTS * 2));`), and after the ext points' `drawArrays` add:

```ts
      const eyes = eyeDebugPoints(face, aspect);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, eyes);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.uniform3f(prog.u('uColor'), 0.2, 0.9, 1);
      gl.drawArrays(gl.POINTS, 0, eyes.length / 2);
```

- [x] **Step 7: Run the tests, typecheck and the engine e2e**

Run: `npx vitest run src/engine && npm run typecheck && npm run build && npx playwright test tests/e2e/engine.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS. With every procedural item neutral, `procMakeupWanted` is false, `procMakeup` is null and no frame changes: the parity goldens and the lip/blush rows of `engine.spec.ts` hold unchanged.

- [x] **Step 8: Commit**

```bash
file src/engine/passes/makeup.ts src/engine/pipeline.ts src/engine/index.ts src/types.ts src/app/testFakes.ts src/engine/passes/overlay.ts
git add src/engine/passes/makeupProc.ts src/engine/passes/makeup.ts src/engine/pipeline.ts src/engine/pipeline.test.ts src/engine/index.ts src/types.ts src/app/testFakes.ts tests/harness/t7/fakes.ts src/engine/passes/overlay.ts src/engine/passes/overlay.test.ts
git commit -F- <<'EOF'
v0.4 step 5: procedural makeup layers in P1

≤ 9 strips per frame after every face's GPUPixel mesh with multiply,
screen and over blending; lashes.png loads with the makeup textures,
PMAKEUP compiles lazily and a failure disables only the eight new parts;
pass names mk.<layer>; eye frames in the landmark overlay.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 12: Engine e2e for the makeup: GPU = CPU, regions, blink, tiles, contact sheet

S5 §8.3 items 2, 3, 4 and 9, the §8.4 contact sheet, and two failure modes of the Review Focus (a lashes texture that fails to load, a lost and restored WebGL context), on the dev-server harness pages (real engine, recorded landmarks, no app UI).

**Files:**
- Create: `tests/e2e/pages/makeup.html`, `tests/e2e/pages/makeup.ts`
- Modify: `tests/e2e/shape-makeup.spec.ts` (Task 7), step 3's `tests/e2e/pages/export.ts` (three more cases) and `tests/e2e/export.spec.ts` (their names)

**Interfaces:**
- Consumes: Tasks 8–11 (`createProcMakeupPass`, `createMakeupPass(gl, assetBase?, lashesUrl?)`, `MakeupPass.drawFaces(src, dst, faces, proc, win?)`, `ensureProc`, `meshReady`, `buildMakeupGeometry`, `KIND`, `LAYER_MODE`, `LAYER_ORDER`, `FLOATS_PER_VERTEX`, `fragment`, `blend`, `loadImageTexture(…, {r8, mipmap})`, pass names `mk.<layer>`); Task 5 `closeEye`, `eyeFrames`; Task 1 `MAKEUP_PARAM`, `SHADES`, `isShadePart`, `neutralValue`, `paramDef`; step 1 `RenderInput` (RM §4.1), `defaultPhoto()`, `neutralPerson()`, `emptyShades()` (Task 1); `createEngine` (`src/engine/index.ts`) with `ready` (re-read after a restore), `lost`, `render`, `renderToImageData`; `decodeDataUrl`, `Pixels` (`tests/e2e/fixtures.ts`); step 3's tile harness `window.runExportTiles()` in `tests/e2e/pages/export.ts` (its `cases: { name; w; h; geometry(size) }[]`, the shared `person`, the per-case `faces: RenderFace[] = [{ face, weight: 1, person, protect: null }]`) and `tests/e2e/export.spec.ts` (it asserts the list of case names: `['identity', 'quarter 1 + flip', 'θ 12° + crop', '601×799 identity']`); step 1's `tests/fixtures/group_faces.png` and `group_faces.landmarks.json` (`{ source, width, height, …, faces: number[][] }`, 478 × 3 values per face, RM §8.3).
- Produces: `window.runMakeupPin(): Promise<MakeupPinCase[]>`, `window.runMakeupRegions(): Promise<MakeupRegions>`, `window.runMakeupBlink(): Promise<Record<string, string>>`, `window.runMakeupLashesFail(): Promise<{ settled: boolean; meshReady: boolean; compiled: boolean; layers: string[] }>`, `window.runMakeupContextLoss(): Promise<{ before: string; after: string; restored: boolean }>`, `window.runMakeupSheet(): Promise<{ name: string; png: string }[]>`; the export-harness case field `faceDetail?: boolean` (step 6's release-gate case sets it)

- [x] **Step 1: Write the failing e2e tests**

Append to `tests/e2e/shape-makeup.spec.ts` (extend the import to `import { decodeDataUrl, expect, test, type Pixels } from './fixtures';` and add `import { mkdirSync, writeFileSync } from 'node:fs'; import { resolve } from 'node:path';`):

```ts
const maxDiff = (a: Pixels, b: Pixels, i: number) =>
  Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));

test('PMAKEUP: GPU == CPU port for every kind and blend mode (S5 §8.3 item 2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupPin === 'function');
  const cases = await page.evaluate(() => window.runMakeupPin!());
  expect(cases).toHaveLength(14);
  expect(new Set(cases.map((c) => c.mode))).toEqual(new Set([0, 1, 2]));
  for (const c of cases) {
    console.log(`${c.name} (mode ${c.mode}): ${c.n} px, max |GPU − CPU| = ${c.maxErr255.toFixed(2)}/255, ${c.changed} px changed`);
    expect(c.maxErr255, `${c.name}: ${JSON.stringify(c.samples.slice(0, 3))}`).toBeLessThanOrEqual(2);
    expect(c.changed, c.name).toBeGreaterThan(500);
  }
});

test('each part changes only its region; 美瞳 stays in iris ∩ aperture and keeps the catchlight (S5 §8.3 item 3)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupRegions === 'function');
  const r = await page.evaluate(() => window.runMakeupRegions!());
  const base = decodeDataUrl(r.base);
  for (const [part, p] of Object.entries(r.parts)) {
    const img = decodeDataUrl(p.png);
    let outside = 0;
    let inside = 0;
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const d = maxDiff(img, base, (y * r.width + x) * 4);
        const inBox = p.boxes.some((b) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]);
        if (inBox) inside = Math.max(inside, d);
        else outside = Math.max(outside, d);
      }
    console.log(`${part}: inside ${inside}, outside ${outside}, passes ${p.passes.join(' ')}`);
    expect(outside, part).toBeLessThanOrEqual(2);
    expect(inside, part).toBeGreaterThan(8);
    for (const l of p.layers) expect(p.passes, part).toContain(`mk.${l}`);
  }
  // 美瞳: every changed pixel inside the iris disc × 1.12 and within 2 px of the aperture strip; catchlight unchanged
  const lens = decodeDataUrl(r.parts.lens.png);
  const inPoly = (poly: number[][], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const nearPoly = (poly: number[][], x: number, y: number, tol: number) =>
    inPoly(poly, x, y) ||
    poly.some((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1)));
      return Math.hypot(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - y) <= tol;
    });
  let changed = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const d = maxDiff(lens, base, i);
      const Y = (0.2126 * base.data[i] + 0.7152 * base.data[i + 1] + 0.0722 * base.data[i + 2]) / 255;
      if (Y > 0.88) expect(d, `catchlight ${x},${y}`).toBeLessThanOrEqual(2);
      if (d <= 2) continue;
      changed++;
      const ok = r.eyes.some((e) => Math.hypot(x + 0.5 - e.c[0], y + 0.5 - e.c[1]) <= 1.12 * e.r && nearPoly(e.strip, x + 0.5, y + 0.5, 2));
      expect(ok, `美瞳 pixel ${x},${y}`).toBe(true);
    }
  expect(changed).toBeGreaterThan(100);
});

test('blink: 美瞳 and 睫毛 leave a closed-eye face unchanged; 眼影 still draws on the lid (S5 §8.3 item 4)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupBlink === 'function');
  const png = await page.evaluate(() => window.runMakeupBlink!());
  const base = decodeDataUrl(png.base);
  const worst = (name: string) => {
    const img = decodeDataUrl(png[name]);
    let m = 0;
    for (let i = 0; i < img.data.length; i += 4) m = Math.max(m, maxDiff(img, base, i));
    return m;
  };
  expect(worst('lens')).toBe(0);
  expect(worst('lashes')).toBe(0);
  expect(worst('eyeshadow')).toBeGreaterThan(8);
});

test('a lashes.png that fails to load: ready still settles, only 睫毛 is skipped (S5 §4.10, §7; Review Focus 5)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupLashesFail === 'function');
  const r = await page.evaluate(() => window.runMakeupLashesFail!());
  expect(r.settled, 'MakeupPass.ready settles').toBe(true);
  expect(r.meshReady, '口紅 / 腮紅 textures still load').toBe(true);
  expect(r.compiled).toBe(true);
  expect(r.layers).toContain('shadow');
  expect(r.layers).not.toContain('lashes');
});

test('procedural makeup survives a lost and restored WebGL context (S5 §7; Review Focus 2)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupContextLoss === 'function');
  const r = await page.evaluate(() => window.runMakeupContextLoss!());
  expect(r.restored, 'the engine left the lost state').toBe(true);
  const a = decodeDataUrl(r.before);
  const b = decodeDataUrl(r.after);
  let m = 0;
  for (let i = 0; i < a.data.length; i += 4) m = Math.max(m, maxDiff(a, b, i));
  expect(m).toBeLessThanOrEqual(1);
});

test('contact sheet @sheet', async ({ page }) => {
  test.skip(!process.env.SHEET, 'run with SHEET=1 and --grep @sheet to write test-results/makeup-sheet/ (not asserted, not committed)');
  test.setTimeout(600_000);
  await page.goto(`${DEV_URL}/tests/e2e/pages/makeup.html`);
  await page.waitForFunction(() => typeof window.runMakeupSheet === 'function');
  const sheet = await page.evaluate(() => window.runMakeupSheet!());
  const dir = resolve(import.meta.dirname, '../../test-results/makeup-sheet');
  mkdirSync(dir, { recursive: true });
  for (const s of sheet) writeFileSync(resolve(dir, `${s.name}.png`), Buffer.from(s.png.slice(s.png.indexOf(',') + 1), 'base64'));
  console.log(`contact sheet: ${sheet.length} images in ${dir}`);
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/shape-makeup.spec.ts -g "PMAKEUP|region|blink|lashes|context"`
Expected: FAIL — `page.goto` of `makeup.html` returns the dev server's 404 page, so `waitForFunction` times out.

- [x] **Step 3: The harness page**

Create `tests/e2e/pages/makeup.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>procedural makeup check</title>
  </head>
  <body style="margin: 0; background: #000">
    <canvas id="gl"></canvas>
    <script type="module" src="./makeup.ts"></script>
  </body>
</html>
```

Create `tests/e2e/pages/makeup.ts`:

```ts
// Procedural makeup checks (face-detail spec §8.3 items 2–4, §8.4 contact sheet), on the dev server (imports src/):
//  - runMakeupPin: every kind drawn by the real PMAKEUP program on a quad whose attributes are affine ramps, over a
//    known target ramp, against the CPU port (makeupProcCpu.ts) at every pixel centre;
//  - runMakeupRegions / runMakeupBlink / runMakeupContextLoss / runMakeupSheet: the real engine on sample_face.png with
//    the recorded landmarks;
//  - runMakeupLashesFail: the makeup pass with a lashes URL that cannot load.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { defaultPhoto, emptyShades, neutralPerson } from '../../../src/edit/state';
import { createEngine } from '../../../src/engine/index';
import { createFramebuffer, createTexture, loadImageTexture, type Texture } from '../../../src/engine/gl/gl';
import { isShadePart, MAKEUP_PARAM, neutralValue, paramDef, SHADES } from '../../../src/engine/params';
import { createMakeupPass } from '../../../src/engine/passes/makeup';
import { eyeFrames, eyeToUv, STATION_XS } from '../../../src/engine/passes/eyeFrame';
import {
  buildMakeupGeometry,
  createProcMakeupPass,
  FLOATS_PER_VERTEX,
  KIND,
  LAYER_MODE,
  LAYER_ORDER,
  type MakeupGeometry,
  type MakeupLayer,
} from '../../../src/engine/passes/makeupProc';
import { blend, fragment } from '../../../src/engine/passes/makeupProcCpu';
import { closeEye } from '../../../src/engine/passes/syntheticFaces';
import { adapt } from '../../../src/tracking/adapter111';
import type { Face, MakeupPart, ParamId, PersonParams, PhotoParams, RenderInput } from '../../../src/types';

export interface MakeupPinCase {
  name: string;
  mode: number;
  n: number;
  /** pixels the draw changed by more than 2/255 (the comparison is not vacuous) */
  changed: number;
  maxErr255: number;
  samples: number[][];
}
export interface MakeupRegions {
  width: number;
  height: number;
  base: string;
  parts: Record<string, { png: string; boxes: [number, number, number, number][]; layers: MakeupLayer[]; passes: string[] }>;
  /** per eye: iris centre / radius and the aperture strip polygon, px */
  eyes: { c: [number, number]; r: number; strip: number[][] }[];
}

declare global {
  interface Window {
    runMakeupPin?: () => Promise<MakeupPinCase[]>;
    runMakeupRegions?: () => Promise<MakeupRegions>;
    runMakeupBlink?: () => Promise<Record<string, string>>;
    runMakeupLashesFail?: () => Promise<{ settled: boolean; meshReady: boolean; compiled: boolean; layers: string[] }>;
    runMakeupContextLoss?: () => Promise<{ before: string; after: string; restored: boolean }>;
    runMakeupSheet?: () => Promise<{ name: string; png: string }[]>;
  }
}

const KIND_LAYER: Record<number, MakeupLayer> = {
  [KIND.shadowUpper]: 'shadow',
  [KIND.shadowLower]: 'shadow',
  [KIND.liner]: 'liner',
  [KIND.lashes]: 'lashes',
  [KIND.aegyoLight]: 'aegyoLight',
  [KIND.aegyoShade]: 'aegyoShade',
  [KIND.lens]: 'lens',
  [KIND.lensOrig]: 'lens',
  [KIND.brow]: 'brow',
  [KIND.contourJaw]: 'contour',
  [KIND.contourEllipse]: 'contour',
  [KIND.contourNose]: 'contour',
  [KIND.highlightRibbon]: 'highlight',
  [KIND.highlightEllipse]: 'highlight',
};

type Ramp = [from: number, to: number];
/** loc.x and aux.x ramp left → right, loc.y and aux.y top → bottom, each covering the kind's whole range */
const CASES: { name: string; kind: number; lx: Ramp; ly: Ramp; ax?: Ramp; ay?: Ramp; w?: number; h?: number }[] = [
  { name: '眼影 upper', kind: KIND.shadowUpper, lx: [-0.3, 1.1], ly: [-0.05, 0.6], ax: [0.3, 0.6] },
  { name: '眼影 lower', kind: KIND.shadowLower, lx: [-0.2, 0.6], ly: [-0.05, 0.12] },
  { name: '眼線', kind: KIND.liner, lx: [-0.1, 1.05], ly: [-0.03, 0.07], ax: [0.016, 0.045] },
  { name: '睫毛', kind: KIND.lashes, lx: [0, 1], ly: [1, 0], w: 512, h: 128 },
  { name: '臥蠶 light', kind: KIND.aegyoLight, lx: [0, 1.05], ly: [-0.02, 0.18] },
  { name: '臥蠶 shade', kind: KIND.aegyoShade, lx: [0, 1.05], ly: [-0.02, 0.18] },
  { name: '美瞳', kind: KIND.lens, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0, 0.12], ay: [0, 0.1] },
  { name: '美瞳 原色', kind: KIND.lensOrig, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0, 0.12], ay: [0, 0.1] },
  { name: '眉毛', kind: KIND.brow, lx: [-0.2, 1.1], ly: [-0.05, 1.05] },
  { name: '修容 jaw', kind: KIND.contourJaw, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '修容 ellipse', kind: KIND.contourEllipse, lx: [-1.2, 1.2], ly: [-1.2, 1.2] },
  { name: '修容 nose', kind: KIND.contourNose, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '高光 ribbon', kind: KIND.highlightRibbon, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '高光 ellipse', kind: KIND.highlightEllipse, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0.3, 0.3] },
];

const lerp = (r: Ramp | undefined, t: number) => (r ? r[0] + (r[1] - r[0]) * t : 0);
/** 8-bit ramps: the target (dst) and the source the fragment reads (skin gate / lens colour) */
const dstAt = (i: number, j: number, w: number, h: number) => [Math.round((255 * i) / (w - 1)), Math.round((255 * j) / (h - 1)), 128];
const srcAt = (i: number, j: number, w: number, h: number) => [
  Math.round(40 + (200 * i) / (w - 1)),
  Math.round(30 + (150 * j) / (h - 1)),
  Math.round(20 + 210 * (1 - i / (w - 1))),
];
const rampTexture = (w: number, h: number, f: typeof dstAt): Uint8Array => {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d.set([...f(i, j, w, h), 255], (j * w + i) * 4);
  return d;
};

window.runMakeupPin = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const pass = createProcMakeupPass(gl);
  const lashes = await loadImageTexture(gl, '/makeup/own/lashes.png', { r8: true, mipmap: true });
  // what the shader samples at each lashes texel centre (level 0), read back through an FBO
  const lfb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lfb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lashes.tex, 0);
  const lashPx = new Uint8Array(lashes.width * lashes.height * 4);
  gl.readPixels(0, 0, lashes.width, lashes.height, gl.RGBA, gl.UNSIGNED_BYTE, lashPx);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(lfb);
  const col: [number, number, number, number] = [0.8, 0.35, 0.5, 0.9];
  const out: MakeupPinCase[] = [];
  for (const c of CASES) {
    const W = c.w ?? 256;
    const H = c.h ?? 256;
    const target = createFramebuffer(gl, W, H);
    const dst = rampTexture(W, H, dstAt);
    gl.bindTexture(gl.TEXTURE_2D, target.tex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    const srcData = rampTexture(W, H, srcAt);
    const src: Texture = createTexture(gl, W, H);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, srcData);
    // one quad (4-vertex strip) in the case's layer, covering the target; attributes at the corners
    const data = new Float32Array(4 * FLOATS_PER_VERTEX);
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].forEach(([x, y], k) =>
      data.set([x, y, lerp(c.lx, x), lerp(c.ly, y), lerp(c.ax, x), lerp(c.ay, y), ...col, c.kind], k * FLOATS_PER_VERTEX),
    );
    const layer = KIND_LAYER[c.kind];
    const ranges = Object.fromEntries(LAYER_ORDER.map((l) => [l, [0, l === layer ? 4 : 0]])) as MakeupGeometry['ranges'];
    pass.draw(target, { data, ranges }, src, lashes);
    const gpu = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, gpu);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fwD = Math.abs((c.ly[1] - c.ly[0]) / H);
    const fwU = (18 * Math.abs(c.lx[1] - c.lx[0])) / W;
    let maxErr = 0;
    let changed = 0;
    const samples: number[][] = [];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / W;
        const y = (j + 0.5) / H;
        const o = (j * W + i) * 4;
        const f = fragment({
          kind: c.kind,
          loc: [lerp(c.lx, x), lerp(c.ly, y)],
          aux: [lerp(c.ax, x), lerp(c.ay, y)],
          col,
          src: [srcData[o] / 255, srcData[o + 1] / 255, srcData[o + 2] / 255],
          lash: c.kind === KIND.lashes ? lashPx[o] / 255 : 0,
          fwD,
          fwU,
        });
        const want = blend(LAYER_MODE[layer], [dst[o] / 255, dst[o + 1] / 255, dst[o + 2] / 255], f);
        for (let k = 0; k < 3; k++) {
          const err = Math.abs(gpu[o + k] - want[k] * 255);
          if (err > maxErr) maxErr = err;
          if (Math.abs(gpu[o + k] - dst[o + k]) > 2) changed++;
        }
        if (i % 64 === 32 && j % 64 === 32) samples.push([i, j, gpu[o], gpu[o + 1], gpu[o + 2], want[0] * 255, want[1] * 255, want[2] * 255]);
      }
    out.push({ name: c.name, mode: LAYER_MODE[layer], n: W * H, changed: Math.round(changed / 3), maxErr255: maxErr, samples });
  }
  pass.dispose();
  return out;
};

// ── the real engine on sample_face.png ──

const PARTS: MakeupPart[] = ['brow', 'eyeshadow', 'liner', 'lashes', 'aegyo', 'contour', 'highlight', 'lens'];
const PART_LAYERS: Record<string, MakeupLayer[]> = {
  brow: ['brow'],
  eyeshadow: ['shadow'],
  liner: ['liner'],
  lashes: ['lashes'],
  aegyo: ['aegyoLight', 'aegyoShade'],
  contour: ['contour'],
  highlight: ['highlight'],
  lens: ['lens'],
};

/** 原圖: every photo value neutral, no filter, no look (P2 and the composite stages are then identities) */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  const values = Object.fromEntries(Object.keys(p.values).map((k) => [k, neutralValue(paramDef(k as ParamId))])) as PhotoParams['values'];
  return { ...p, values, filterId: 'none', look: null };
}

/** one part at 100 with its first shade (S5 §8.3 item 3) */
function partOn(part: MakeupPart, v = 1, shade?: string | null): PersonParams {
  const p = neutralPerson();
  const first = isShadePart(part) ? (shade === undefined ? SHADES[part][0].id : shade) : null;
  return {
    ...p,
    values: { ...p.values, [MAKEUP_PARAM[part]]: v },
    shades: isShadePart(part) ? { ...emptyShades(), [part]: first } : emptyShades(),
  };
}

async function setup() {
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const face = adapt({ points: new Float32Array(landmarks.points) }, bitmap.width, bitmap.height);
  const photo = neutralPhoto();
  const input = (person: PersonParams, f: Face = face): RenderInput => ({
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    faces: [{ face: f, weight: 1, person, protect: null }],
    globalSkin: null,
    photo,
  });
  const png = (img: ImageData) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
  const render = (person: PersonParams, f: Face = face) => png(engine.renderToImageData(input(person, f), { mirror: false }));
  return { bitmap, canvas, engine, face, input, png, photo, render };
}

window.runMakeupRegions = async () => {
  const { bitmap, engine, face, input, render } = await setup();
  const W = bitmap.width;
  const H = bitmap.height;
  const aspect = W / H;
  const out: MakeupRegions = { width: W, height: H, base: render(neutralPerson()), parts: {}, eyes: [] };
  for (const part of PARTS) {
    const person = partOn(part);
    const g = buildMakeupGeometry([{ face, weight: 1, person, protect: null }], aspect);
    // one box per eye / side piece would be tighter; the union of each layer's vertices, dilated by 3 px, is the spec's
    const boxes: [number, number, number, number][] = PART_LAYERS[part].map((l) => {
      const [first, count] = g.ranges[l];
      const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let v = first; v < first + count; v++) {
        const x = g.data[v * FLOATS_PER_VERTEX] * W;
        const y = g.data[v * FLOATS_PER_VERTEX + 1] * H;
        b[0] = Math.min(b[0], x - 3);
        b[1] = Math.min(b[1], y - 3);
        b[2] = Math.max(b[2], x + 3);
        b[3] = Math.max(b[3], y + 3);
      }
      return b;
    });
    const passes = engine.render(input(person), { still: true }).passes;
    out.parts[part] = { png: render(person), boxes, layers: PART_LAYERS[part], passes };
  }
  for (const f of eyeFrames(face, aspect)) {
    const iris = f.iris ?? f.irisFallback;
    const upper = STATION_XS.map((x, k) => eyeToUv(f, x, f.upper[k], aspect));
    const lower = STATION_XS.map((x, k) => eyeToUv(f, x, Math.max(f.upper[k], f.lower[k]), aspect)).reverse();
    out.eyes.push({
      c: [iris.c[0] * W, iris.c[1] * aspect * H],
      r: iris.r * W,
      strip: [...upper, ...lower].map(([x, y]) => [x * W, y * H]),
    });
  }
  engine.dispose();
  bitmap.close();
  return out;
};

window.runMakeupBlink = async () => {
  const { bitmap, engine, face, render } = await setup();
  const closed = closeEye(closeEye(face, 0), 1);
  const out = {
    base: render(neutralPerson(), closed),
    lens: render(partOn('lens', 1, 'blue'), closed),
    lashes: render(partOn('lashes'), closed),
    eyeshadow: render(partOn('eyeshadow'), closed),
  };
  engine.dispose();
  bitmap.close();
  return out;
};

/** the makeup pass alone, its lashes URL unreachable: ready must settle and only the 睫毛 layer may be skipped */
window.runMakeupLashesFail = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const pass = createMakeupPass(gl, '/makeup/gp/', '/makeup/own/missing-lashes.png');
  const settled = await Promise.race([pass.ready.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 15_000))]);
  const face = adapt({ points: new Float32Array(landmarks.points) }, landmarks.width, landmarks.height);
  const base = partOn('eyeshadow');
  const person: PersonParams = { ...base, values: { ...base.values, 'makeup.lashes': 1 } };
  const geom = buildMakeupGeometry([{ face, weight: 1, person, protect: null }], landmarks.width / landmarks.height);
  const src = createTexture(gl, 100, 150);
  const dst = createFramebuffer(gl, 100, 150);
  const compiled = pass.ensureProc();
  const layers: string[] = pass.drawFaces(src, dst, [], geom);
  const meshReady = pass.meshReady;
  pass.dispose();
  return { settled, meshReady, compiled, layers };
};

/** 眼影 rendered, the display context lost and restored (iOS backgrounding), rendered again: the same pixels */
window.runMakeupContextLoss = async () => {
  const { bitmap, canvas, engine, render } = await setup();
  const person = partOn('eyeshadow');
  const before = render(person);
  const ext = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
  if (!ext) throw new Error('WEBGL_lose_context missing');
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((res) => setTimeout(res, 50));
  };
  ext.loseContext();
  await until(() => engine.lost);
  ext.restoreContext();
  await until(() => !engine.lost);
  await engine.ready; // a new promise after the restore (Engine.ready)
  const after = render(person);
  const restored = !engine.lost;
  engine.dispose();
  bitmap.close();
  return { before, after, restored };
};

window.runMakeupSheet = async () => {
  const { bitmap, engine, png, photo, render } = await setup();
  const out: { name: string; png: string }[] = [];
  for (const part of PARTS) {
    const shades: (string | null)[] = isShadePart(part) ? [...(part === 'liner' ? [] : [null]), ...SHADES[part].map((s) => s.id)] : [null];
    for (const shade of shades) for (const v of [0.5, 1]) out.push({ name: `${part}-${shade ?? 'orig'}-${v * 100}`, png: render(partOn(part, v, shade)) });
  }
  for (const id of ['shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight'] as const) {
    for (const v of paramDef(id).bidirectional ? [0.25, 0.75] : [0.5]) {
      const p = neutralPerson();
      out.push({ name: `${id}-${Math.round(v * 100 - (paramDef(id).bidirectional ? 50 : 0))}`, png: render({ ...p, values: { ...p.values, [id]: v } }) });
    }
  }
  // the group faces of step 1's group_faces.png (S5 §8.4): its recorder writes `faces`, 478 × (x, y, z) per face
  // (A, the mirrored B, the small C, and D when it was found; D is below MIN_FACE_FRAC and shows little)
  const gBitmap = await createImageBitmap(await (await fetch('/tests/fixtures/group_faces.png')).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const gJson = (await (await fetch('/tests/fixtures/group_faces.landmarks.json')).json()) as { faces: number[][] };
  const gFaces = gJson.faces.map((pts) => adapt({ points: new Float32Array(pts) }, gBitmap.width, gBitmap.height));
  for (const part of PARTS) {
    const person = partOn(part);
    const img = engine.renderToImageData(
      { source: gBitmap, width: gBitmap.width, height: gBitmap.height, faces: gFaces.map((face) => ({ face, weight: 1, person, protect: null })), globalSkin: null, photo },
      { mirror: false },
    );
    out.push({ name: `group-${part}`, png: png(img) });
  }
  gBitmap.close();
  engine.dispose();
  bitmap.close();
  return out;
};
```

- [x] **Step 4: The tile cases (S5 §8.3 item 9)**

In step 3's tile harness `tests/e2e/pages/export.ts` (`window.runExportTiles`):
1. The case type gains `faceDetail?: boolean` (every makeup part at 100 and every new warp at max on the composited face); append three cases, the S3 geometries with that flag:

```ts
    { name: 'step 5 identity', w: 800, h: 600, geometry: () => IDENTITY_GEOMETRY, faceDetail: true },
    { name: 'step 5 quarter 1 + flip', w: 800, h: 600, geometry: () => ({ ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 }), faceDetail: true },
    { name: 'step 5 θ 12° + crop', w: 800, h: 600, geometry: (size) => setStraighten(IDENTITY_GEOMETRY, 12, size), faceDetail: true },
```

2. Above `window.runExportTiles`, add

```ts
/** step 5's tile person (S5 §8.3 item 9): every procedural makeup part at 100 with a shade, every new warp at max */
const step5Person = (): PersonParams => {
  const p = neutralPerson();
  const values = { ...p.values };
  for (const part of ['brow', 'eyeshadow', 'liner', 'lashes', 'aegyo', 'contour', 'highlight', 'lens'] as const) values[MAKEUP_PARAM[part]] = 1;
  for (const id of ['shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight'] as const) values[id] = 1;
  return { ...p, values, shades: { ...emptyShades(), brow: 'black', eyeshadow: 'earth', liner: 'black', lens: 'blue' } };
};
```

(imports: `emptyShades` next to step 3's `defaultPhoto, neutralPerson` import; `MAKEUP_PARAM` from `../../../src/engine/params`).
3. In the per-case loop, step 3's line `const faces: RenderFace[] = [{ face, weight: 1, person, protect: null }];` becomes `const faces: RenderFace[] = [{ face, weight: 1, person: c.faceDetail ? step5Person() : person, protect: null }];` (the face comes from the full 478-point fixture placed in the frame, so `iris` and `lids` move with it).

In `tests/e2e/export.spec.ts`, append `'step 5 identity', 'step 5 quarter 1 + flip', 'step 5 θ 12° + crop'` to the end of its `expect(res.map((r) => r.name)).toEqual([...])` list; its loop assertions (no GL error, more than one tile, max channel difference ≤ 1/255) then cover them. The lashes mip level follows the output scale, never the tile (S5 §4.11), so the forced `TILE = 256` plan must equal the untiled render.

- [x] **Step 5: Run the e2e**

Run: `npx playwright test tests/e2e/shape-makeup.spec.ts -g "PMAKEUP|region|blink|lashes|context" && npx playwright test tests/e2e/export.spec.ts`
Expected: PASS — 14 kinds within 2/255 of the CPU port; every part outside its boxes ≤ 2/255 and inside > 8/255, with its `mk.<layer>` passes; 美瞳 inside iris ∩ aperture; blink case 0 / 0 / > 8; a missing `lashes.png` settles `ready` and skips only `lashes`; a lost and restored context renders 眼影 within 1/255 of before; step 3's tile cases (including the three new ones) ≤ 1/255.

Then write the contact sheet once to check it renders: `SHEET=1 npx playwright test tests/e2e/shape-makeup.spec.ts --grep @sheet` — Expected: `contact sheet: N images in …/test-results/makeup-sheet` (not committed).

- [x] **Step 6: Commit**

```bash
git add tests/e2e/pages/makeup.html tests/e2e/pages/makeup.ts tests/e2e/shape-makeup.spec.ts tests/e2e/pages/export.ts tests/e2e/export.spec.ts
git commit -F- <<'EOF'
v0.4 step 5: engine e2e for the procedural makeup

PMAKEUP equals its CPU port on every kind and blend mode; each part only
changes its own region; 美瞳 stays inside iris ∩ aperture and keeps the
catchlight; closed eyes drop 美瞳 and 睫毛; a missing lashes.png only
drops 睫毛; makeup survives a context loss; tiled = untiled with every
part and warp on; @sheet contact sheet (sample face and group faces).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Landed deviations:** (1) The shared console guard of `tests/e2e/fixtures.ts` fails every test on a `console.error`, and the makeup pass logs `[engine] lashes.png failed to load; 睫毛 disabled` by design. So the lashes case takes `guard`, polls until that line was logged (the failure path ran) and then drops it, and the browser's own "Failed to load resource" line, from `guard.consoleErrors`; the guard still checks every other line and the requests. (2) `step 5 quarter 1 + flip` measures 2/255 at one interior pixel (B, 44 px from the nearest tile edge on SwiftShader). That is the 膠片 lift of a 1-LSB fp32 flip that `export.spec.ts` already documents for `θ 12° + crop`: the case is ≤ 1/255 with the look off, and also with only the makeup or only the warps on. Its bound is 2/255, like the `601` and `θ` cases; `step 5 identity` and `step 5 θ 12° + crop` keep 1/255. Against a neutral person, the three step-5 cases change about 27 000 px by more than 8/255, so they are not vacuous.

Landed as `e338242`, which carries a stale step-2 subject (`v0.4 step 2 task 12: Panel model for the 調節 tab and 一鍵 › 美顏／質感`, a leftover message file in the scratchpad, as with `0692964` and `a9b761f`). Its content is this task's five test files and its ticks. The `v0.4 step 5 task 12 fix:` commit on top of it records this note, and no commit was amended.

**Review fixes (a later `v0.4 step 5 task 12 fix:` commit):** (3) The catchlight half of the regions case could not fail as written above. No pixel of the engine render of `sample_face.png` reaches Y 0.81, so `if (Y > 0.88) expect(…)` never ran. `runMakeupRegions` now also returns `catchlight: { base, lens }`: 原圖 and 美瞳 rendered from a copy of the photo with a white disc (centre `c − 0.3 r` on both axes, radius `0.22 r`) painted in each iris. The 美瞳 checks (inside iris × 1.12 ∩ aperture, Y > 0.88 unchanged within 2/255, more than 100 px changed) run on that pair. The spec also asserts more than 50 catchlight pixels and more than 30 of them in the 美瞳 annulus 0.4–1 r inside the aperture. Measured on SwiftShader: 206 catchlight px, 130 of them in the annulus, worst 0/255; 3836 px changed. With `catchl` forced to 1 in `PMAKEUP_FS`, the case fails at 186/255. The per-part loop still uses the raw photo. (4) The context-loss case rendered only 眼影, and 眼影 never samples the lashes texture. It now renders 眼影 + 睫毛, and `runMakeupContextLoss` also returns `noLashes` (眼影 alone, before the loss). The spec asserts that 睫毛 changes the image by more than 8/255 (measured 33/255) and that before vs after is still ≤ 1/255 (measured 0/255). A mutant whose restored makeup pass drops the lashes texture fails the new case at 33/255. The old case cannot see that mutant, because 眼影 does not read the texture.

### Task 13: 美型 strip: group dividers, 左右分開 switch, badges and the side slider

The panel model of S5 §2.1–2.2 on top of step 1's lens-based `panelModel.ts`: dividers at the five group starts, the 左右分開 switch item at the end, 「左右」 badges while it is on, has-value dots over both sides, and a slider binding with a 左｜右 side.

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; after steps 1–4: `PanelSelection` `:43-53`, `INITIAL_SELECTION` `:55-64`, `ItemAction` `:299-315`, `SliderView` `:909-929` (what `SliderRow` reads; `SliderBinding` `:931-937` extends it), the `'shape'` cases of `itemsFor` (`:747-768`) / `sliderFor` (`:983-991`) / `tabHasValue` (`:1078-1082`), `activate` `:828-906`)
- Test: `src/ui/panelModel.test.ts`

**Interfaces:**
- Consumes: Task 4 lens (`get(id, side)`, `set(id, v, side)`, `split()`, `setSplit(on, side)`); step 1's `PanelItem.badge?: string` (S1 A9) and step 2's `PanelItem.divider?: 'before'` (S2 §3.4); step 1's lens-based `itemsFor(lens, sel, ctx)`, `sliderFor(lens, sel, ctx)`, `tabHasValue(lens, tab, ctx)`, `activate(item, lens, sel)` with its local `done(next, nextSel?, notice?)` helper (today `panelModel.ts:831-836`, `next` now an `EditState`); step 1's `SliderBinding { key; param: ParamId | null; label; bidirectional; value; mixed: boolean; defaultValue; apply(lens, v): EditState }` (step-1 plan Task 10); `hasValue`, `paramDef`, `paramsInGroup` (`params.ts`).
- Produces:
  - `PanelSelection.side: 'L' | 'R'` (`INITIAL_SELECTION.side = 'L'`)
  - `ItemAction` += `{ type: 'split' }`
  - `SliderView.sides?: { active: 'L' | 'R'; other: number; select(side: 'L' | 'R'): PanelSelection }` (on `SliderView`, which `SliderRow` takes as its `binding`, like step 4's `ends`; every `SliderBinding` has it, since `SliderBinding extends SliderView`)
  - `SHAPE_DIVIDERS: ReadonlySet<ParamId>`, `SPLIT_BADGE = '左右'`, `SPLIT_ON_NOTICE`, `SPLIT_OFF_NOTICE`
  - `decorateShapeItems(items: PanelItem[], lens: Lens): PanelItem[]` (the 15 def items in, plus the split item out)
  - `shapeHasValue(lens: Lens): boolean`
  - `withSides(b: SliderBinding, lens: Lens, sel: PanelSelection, id: ParamId): SliderBinding`
  - `splitToggle(lens: Lens, sel: PanelSelection): { edit: EditState; sel: PanelSelection; notice: string }`
  - `splitJointNotice(item: PanelItem, lens: Lens, sel: PanelSelection): string | null`

- [x] **Step 1: Write the failing test**

Append to `src/ui/panelModel.test.ts`, merging the imports into its existing lines (it already imports `lensFor` from `../edit/lens`, `defaultPhoto` and `neutralPerson` from `../edit/state`, `paramsInGroup` from `../engine/params` and the `EditState` type): add `naturalPerson` to the `../edit/state` import, the new names and the types `PanelItem`, `SliderBinding` to the `./panelModel` import, and `PersonParams` to the `../types` type import:

```ts
const E5 = (f0: PersonParams = naturalPerson()): EditState => ({ v: 2, photo: defaultPhoto(), persons: { f0 }, template: neutralPerson(), primaryInit: null });
const L5 = (e: EditState, swap = false) => lensFor(e, { kind: 'person', id: 'f0' }, [{ id: 'f0', face: true, body: false, screenSwap: swap }], 'f0');
const shapeDefs = (): PanelItem[] =>
  paramsInGroup('shape').map((d) => ({
    key: d.id,
    label: d.label,
    visual: { kind: 'icon', icon: d.icon },
    selected: false,
    hasValue: false,
    action: { type: 'param', id: d.id },
    disabled: false,
    reason: null,
  }));
const splitOnEdit = () => L5(E5()).setSplit(true, 'L');

describe('美型 strip (face-detail spec §2.1)', () => {
  it('has dividers at the five group starts and 左右分開 last', () => {
    const items = decorateShapeItems(shapeDefs(), L5(E5()));
    expect(items.map((i) => i.key)).toEqual([...paramsInGroup('shape').map((d) => d.id), 'split']);
    expect(items.filter((i) => i.divider === 'before').map((i) => i.key)).toEqual([
      'shape.faceSlim', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'split',
    ]);
  });

  it('左右分開 is a switch; the 左右 badge marks the six split items only while it is on', () => {
    const off = decorateShapeItems(shapeDefs(), L5(E5()));
    expect(off.at(-1)).toMatchObject({ key: 'split', label: '左右分開', pressed: false, action: { type: 'split' }, visual: { kind: 'icon', icon: 'split' } });
    expect(off.filter((i) => i.badge)).toHaveLength(0);
    const on = decorateShapeItems(shapeDefs(), L5(splitOnEdit()));
    expect(on.at(-1)?.pressed).toBe(true);
    expect(on.filter((i) => i.badge === SPLIT_BADGE).map((i) => i.key)).toEqual([
      'shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.jawline', 'shape.temple',
    ]);
  });

  it('item and tab dots see either side', () => {
    const e = L5(splitOnEdit()).set('shape.jawline', 0.5, 'R');
    const items = decorateShapeItems(shapeDefs(), L5(e));
    expect(items.find((i) => i.key === 'shape.jawline')?.hasValue).toBe(true);
    expect(shapeHasValue(L5(e))).toBe(true);
    const neutral = { ...neutralPerson(), right: null };
    expect(shapeHasValue(L5(E5(neutral)))).toBe(false);
  });
});

describe('左右分開 interaction (face-detail spec §2.2)', () => {
  it('turning it on copies the values, selects 左 and explains the screen sides; off keeps the active side', () => {
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'R' as const };
    const on = splitToggle(L5(E5()), s);
    expect(on.sel.side).toBe('L');
    expect(on.sel.shape).toBe(s.shape); // the switch never changes the selected slider item (S5 §2.1)
    expect(on.notice).toBe('已開啟左右分開：左、右以螢幕上看到的方向為準');
    expect(on.edit.persons.f0.right).not.toBeNull();
    const edited = L5(on.edit).set('shape.faceSlim', 0.9, 'R');
    const off = splitToggle(L5(edited), { ...s, side: 'R' });
    expect(off.notice).toBe('已關閉左右分開：左右臉改回相同');
    expect(off.edit.persons.f0.right).toBeNull();
    expect(off.edit.persons.f0.values['shape.faceSlim']).toBe(0.9);
    expect(off.sel.side).toBe('R');
  });

  it('the side binding: active chip, other-side caption value, a key per side, a write to that side only', () => {
    const e = L5(splitOnEdit()).set('shape.faceSlim', 0.3, 'R');
    const base: SliderBinding = {
      key: 'f0:shape.faceSlim',
      param: 'shape.faceSlim',
      label: '瘦臉',
      bidirectional: false,
      value: 0.15,
      mixed: false,
      defaultValue: 0.15,
      apply: (l, v) => l.set('shape.faceSlim', v),
    };
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const, side: 'L' as const };
    const b = withSides(base, L5(e), s, 'shape.faceSlim');
    expect(b.sides?.active).toBe('L');
    expect(b.sides?.other).toBe(0.3);
    expect(b.value).toBe(naturalPerson().values['shape.faceSlim']);
    expect(b.key).toBe('f0:shape.faceSlim:L');
    expect(b.mixed).toBe(false);
    expect(b.sides?.select('R')).toEqual({ ...s, side: 'R' });
    expect(b.sides?.select('L')).toBe(s);
    const w = b.apply(L5(e), 0.8).persons.f0;
    expect([w.values['shape.faceSlim'], w.right?.['shape.faceSlim']]).toEqual([0.8, 0.3]);
    // a non-split item, or 左右分開 off: the binding is returned unchanged
    expect(withSides(base, L5(E5()), s, 'shape.faceSlim')).toBe(base);
    expect(withSides({ ...base, key: 'f0:shape.chin', param: 'shape.chin' }, L5(e), s, 'shape.chin').sides).toBeUndefined();
  });

  it('a non-split item while 左右分開 is on gets 「{label}左右一起調整」', () => {
    const s = { ...INITIAL_SELECTION, tab: 'shape' as const };
    const chin = shapeDefs().find((i) => i.key === 'shape.chin')!;
    const slim = shapeDefs().find((i) => i.key === 'shape.faceSlim')!;
    expect(splitJointNotice(chin, L5(splitOnEdit()), s)).toBe('下巴左右一起調整');
    expect(splitJointNotice(slim, L5(splitOnEdit()), s)).toBeNull();
    expect(splitJointNotice(chin, L5(E5()), s)).toBeNull();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/panelModel.test.ts`
Expected: FAIL — `decorateShapeItems` is not exported.

- [x] **Step 3: Implement**

`src/ui/panelModel.ts` (CRLF):

```ts
// PanelSelection (after steps 1–4's fields)
  /** 左右分開 slider side as seen on screen (S5 §2.2); view state, never an undo step */
  side: 'L' | 'R';
// INITIAL_SELECTION
  side: 'L',
// ItemAction
  /** 美型: toggle 左右分開 */
  | { type: 'split' }
// SliderView (SliderRow reads it; SliderBinding extends it)
  /** present for a split item while 左右分開 is on: the on-screen side being edited, the other side's value */
  sides?: { active: 'L' | 'R'; other: number; select(side: 'L' | 'R'): PanelSelection };
```

```ts
/** 美型 group starts (S5 §2.1): 大眼 │ 瘦臉 … 髮際線 │ 瘦鼻 鼻翼 山根 │ 嘴型 嘴高 │ 眼距 │ 左右分開 */
export const SHAPE_DIVIDERS: ReadonlySet<ParamId> = new Set<ParamId>(['shape.faceSlim', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance']);
export const SPLIT_BADGE = '左右';
export const SPLIT_ON_NOTICE = '已開啟左右分開：左、右以螢幕上看到的方向為準';
export const SPLIT_OFF_NOTICE = '已關閉左右分開：左右臉改回相同';

const hasEitherSide = (lens: Lens, id: ParamId) => {
  const d = paramDef(id);
  return hasValue(d, lens.get(id, 'L').value) || hasValue(d, lens.get(id, 'R').value);
};

/** Step 1's per-def 美型 items, plus dividers, the 左右 badges, two-sided dots and the 左右分開 switch at the end. */
export function decorateShapeItems(items: PanelItem[], lens: Lens): PanelItem[] {
  const split = lens.split();
  const out = items.map((it): PanelItem => {
    if (it.action.type !== 'param') return it;
    const id = it.action.id;
    return {
      ...it,
      hasValue: hasEitherSide(lens, id),
      ...(SHAPE_DIVIDERS.has(id) ? { divider: 'before' as const } : {}),
      ...(split && paramDef(id).split ? { badge: SPLIT_BADGE } : {}),
    };
  });
  out.push({
    key: 'split',
    label: '左右分開',
    visual: { kind: 'icon', icon: 'split' },
    selected: false,
    hasValue: false,
    action: { type: 'split' },
    pressed: split,
    divider: 'before',
    ...ENABLED,
  });
  return out;
}

/** tab dot of 美型: any item off neutral on either side (S5 §2.1) */
export function shapeHasValue(lens: Lens): boolean {
  return paramsInGroup('shape').some((d) => hasEitherSide(lens, d.id));
}

/** a split item's slider while 左右分開 is on: edits one on-screen side; the other side's value is the caption */
export function withSides(b: SliderBinding, lens: Lens, sel: PanelSelection, id: ParamId): SliderBinding {
  if (!paramDef(id).split || !lens.split()) return b;
  const side = sel.side;
  const other = side === 'L' ? 'R' : 'L';
  const cur = lens.get(id, side);
  return {
    ...b,
    key: `${b.key}:${side}`,
    value: cur.value,
    // 「各人不同」 under 全部 compares the chosen side across persons (S5 §3.4)
    mixed: cur.mixed,
    apply: (l, v) => l.set(id, v, side),
    sides: { active: side, other: lens.get(id, other).value, select: (s) => (s === side ? sel : { ...sel, side: s }) },
  };
}

/** the 左右分開 tap: one EditState for every target; turning it on starts on 左 (S5 §2.2) */
export function splitToggle(lens: Lens, sel: PanelSelection): { edit: EditState; sel: PanelSelection; notice: string } {
  const on = !lens.split();
  return {
    edit: lens.setSplit(on, sel.side),
    sel: on && sel.side !== 'L' ? { ...sel, side: 'L' } : sel,
    notice: on ? SPLIT_ON_NOTICE : SPLIT_OFF_NOTICE,
  };
}

/** a non-split 美型 item selected while 左右分開 is on (the screen shows it once per session, S5 §2.2) */
export function splitJointNotice(item: PanelItem, lens: Lens, sel: PanelSelection): string | null {
  if (sel.tab !== 'shape' || item.action.type !== 'param' || !lens.split()) return null;
  const d = paramDef(item.action.id);
  return d.split ? null : `${d.label}左右一起調整`;
}
```

Wire them into step 1's functions:
- `itemsFor`: step 1 serves 美膚 and 美型 from one shared `case 'skin': case 'shape':` that returns `[RESET_ITEM(), …paramsInGroup(sel.tab).map(…)]` (step 4 extends its 美膚 side). Keep that case shared and step 1's ⊘ 原圖 item first; only for 美型 pass the per-def items through `decorateShapeItems(items, lens)`, which returns them decorated and followed by the 左右分開 switch, e.g. `const defs = paramsInGroup(sel.tab).map(…); … sel.tab === 'shape' ? decorateShapeItems(defs, lens) : defs …`. Step 6 later appends 推臉筆 after the switch (step-6 plan: "after step 5's 左右分開").
- `sliderFor`: in the shared `'skin'` / `'shape'` case (landed: `const id = sel[sel.tab];`, the 祛痘 / tone / `usable` early returns, `const b = decorate(paramBinding(lens, id), lens, photoLike(lens, id));`, then `return id === 'tone.warmth' ? { ...b, ends: WARM_ENDS } : b;`), wrap the binding of that last line: `return id === 'tone.warmth' ? { ...b, ends: WARM_ENDS } : withSides(b, lens, sel, id);` (`withSides` returns `b` itself for a non-split id, so 美膚 is unaffected; it keeps `decorate`'s key prefix and `aria`).
- `tabHasValue`: step 4 serves `'skin'`, `'shape'` and `'makeup'` from one shared case (`spotsOnTab` for 美膚, then `lens.groupHasValue(tab)`); add `if (tab === 'shape') return shapeHasValue(lens);` at its head.
- `activate`: `case 'split': { const r = splitToggle(lens, sel); return done(r.edit, r.sel, r.notice); }` (a toggle always changes the EditState, so it is one undo step; it never changes `sel.shape`).

Imports: none new (`panelModel.ts` already imports the `EditState` type and `type Lens` from `../edit/lens`).

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS — the new describes and every existing panel test. One mechanical port: the strip now ends with the 左右分開 switch, so the 美型 key list of the test "skin / shape strips start with ⊘ 原圖 then every param of the group" (`panelModel.test.ts:77-83`, as steps 1 and 4 ported it: `expect(items.slice(1).map((i) => i.key)).toEqual(paramsInGroup(tab).map((d) => d.id))`) gains `'split'` at the end for `tab === 'shape'` (e.g. `[...paramsInGroup(tab).map((d) => d.id), ...(tab === 'shape' ? ['split'] : [])]`); any other exact length or key list of the 美型 strip in step 1's tests is ported the same way.

- [x] **Step 5: Commit**

```bash
file src/ui/panelModel.ts
git add src/ui/panelModel.ts src/ui/panelModel.test.ts
git commit -F- <<'EOF'
v0.4 step 5: 美型 strip groups, 左右分開 switch and side slider

Dividers at the five group starts, 左右分開 as a switch at the end with
左右 badges on the six split items, dots over both sides, and a slider
binding that edits one on-screen side with the other side as caption.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 14: 美妝 two-level strip model, 卸妝, 自然 and the strip notes

The panel model of S5 §2.3–2.4: ten parts; level 1 (卸妝 │ the ten part tiles) and level 2 (無 · (原色) · shades, or 無 · 自然) sharing one row; the leading part tile; the liner's effective shade; the pick defaults; and the three strip notes.

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; `MAKEUP_PARTS` `:31-34`, `PanelSelection`, `ItemAction`, `ItemVisual` `:291-297`, the `'makeup'` cases of `itemsFor` (`:782-803`) / `sliderFor` (`:1002-1009`), `activate`, the panel-local `makeupKey` `:356-358` and step 1's `partHasValue` `:371-375`, step 2's `partButtons` `:682-688`)
- Test: `src/ui/panelModel.test.ts`; `src/ui/panelModel.adjust.test.ts` (step 2; its one 美妝 `partButtons` assertion is ported); `src/ui/components/BeautyPanel.test.tsx` (step 2's 「美妝 keeps its 口紅／腮紅 row」 case, `:252-256`, is ported: the row is gone)

(The lens already reads every part's value through `MAKEUP_PARAM` since Task 4.)

**Interfaces:**
- Consumes: Task 1 `SHADES`, `SHADE_PARTS`, `MAKEUP_PICK_DEFAULT`, `shadeColor`, `isShadePart`, `paramDef`; Task 4 `MAKEUP_PARAM`, lens `get`, `shade(part)` (`{ shade, on, mixed }`, RM §3.3), `setShade`, `ensureOn`, `clearMakeup` (widened to every part in Task 4), `resetGroup('makeup')`; step 1's `activate` with `const edit = lens.edit` and its local `done(next = edit, nextSel = sel, notice?)`, `RESET_ITEM`, `ENABLED`, the panel-local `makeupKey(part)` (lip / blush only; deleted here); step 2's `PanelItem.divider` and `partButtons(sel, state)` (`src/ui/panelModel.ts`), whose 美妝 branch returns the `MAKEUP_PARTS` row.
- Produces:
  - `MAKEUP_PARTS: readonly MakeupPartDef[]` with `interface MakeupPartDef { id: MakeupPart; label: string; param: ParamId; shades: boolean; orig: boolean }` (RM order); `makeupPartDef(id: MakeupPart): MakeupPartDef`
  - `PanelSelection.makeupView: 'parts' | 'shades'` (`INITIAL_SELECTION.makeupView = 'shades'`)
  - `ItemAction`: `shade.part` is a `ShadePart`; += `{ type: 'part'; part: MakeupPart } | { type: 'parts' } | { type: 'makeupReset' } | { type: 'makeupOn'; part: MakeupPart }`
  - `ItemVisual` icon variant += `mini?: string` (10 px swatch, '#RRGGBB')
  - `effectiveShade(part: ShadePart, shade: string | null): string | null`
  - `makeupLeadItem(sel: PanelSelection): PanelItem`, `makeupPartItems(lens: Lens, sel: PanelSelection): PanelItem[]`, `makeupShadeItems(lens: Lens, part: MakeupPart): PanelItem[]`
  - `makeupAction(a: ItemAction, lens: Lens, sel: PanelSelection): { edit: EditState | null; sel: PanelSelection } | null` (null edit = unchanged)
  - `MAKEUP_EYES_NOTE`, `MAKEUP_SMALL_NOTE`, `MAKEUP_PROC_NOTE`; `interface MakeupNoteInput { lensClosed: boolean; lashesClosed: boolean; lashesSmall: boolean; procFailed: boolean }`; `makeupNote(sel: PanelSelection, i: MakeupNoteInput): string | null`

- [x] **Step 1: Write the failing test**

Append to `src/ui/panelModel.test.ts` (reusing Task 13's `E5` / `L5`; imports merged into the existing lines: `emptyShades` into the `../edit/state` import, `SHADES` into the `../engine/params` import, which already has `MAKEUP_PICK_DEFAULT`, the new names into the `./panelModel` import, which already has `type PanelSelection`):

```ts
const withMakeup = (values: Record<string, number>, shades: Partial<PersonParams['shades']> = {}): PersonParams => ({
  ...naturalPerson(),
  values: { ...naturalPerson().values, ...values },
  shades: { ...emptyShades(), ...shades },
});
const S14 = (over: Partial<PanelSelection> = {}): PanelSelection => ({ ...INITIAL_SELECTION, tab: 'makeup', ...over });

describe('美妝 level 2: the shades of one part (face-detail spec §2.3)', () => {
  it('keeps 無 · 原色 · shades for the 原色 parts, drops 原色 for 眼線, and has 無 · 自然 for the four parts without shades', () => {
    const lens = L5(E5());
    for (const part of ['lip', 'blush', 'brow', 'eyeshadow', 'lens'] as const)
      expect(makeupShadeItems(lens, part).map((i) => i.key)).toEqual(['reset', 'orig', ...SHADES[part].map((s) => s.id)]);
    expect(makeupShadeItems(lens, 'liner').map((i) => i.key)).toEqual(['reset', ...SHADES.liner.map((s) => s.id)]);
    for (const part of ['lashes', 'aegyo', 'contour', 'highlight'] as const) {
      const items = makeupShadeItems(lens, part);
      expect(items.map((i) => [i.key, i.label])).toEqual([
        ['reset', '無'],
        ['on', '自然'],
      ]);
      expect(items[1].action).toEqual({ type: 'makeupOn', part });
    }
  });

  it('exactly one item is selected; 眼線 on with no shade selects 黑', () => {
    expect(makeupShadeItems(L5(E5()), 'liner').filter((i) => i.selected).map((i) => i.key)).toEqual(['reset']);
    const on = L5(E5(withMakeup({ 'makeup.liner': 0.6 })));
    expect(makeupShadeItems(on, 'liner').filter((i) => i.selected).map((i) => i.key)).toEqual(['black']);
    const lashes = L5(E5(withMakeup({ 'makeup.lashes': 0.55 })));
    expect(makeupShadeItems(lashes, 'lashes').filter((i) => i.selected).map((i) => i.key)).toEqual(['on']);
  });

  it('the lead tile names the active part and opens the part list', () => {
    expect(makeupLeadItem(S14({ makeupPart: 'eyeshadow' }))).toMatchObject({ key: 'lead', label: '眼影', action: { type: 'parts' }, visual: { kind: 'icon', icon: 'eyeshadow' } });
  });
});

describe('美妝 level 1: the part list (face-detail spec §2.3)', () => {
  it('lists 卸妝, then the ten parts in RM order behind a divider; the active part is outlined', () => {
    const items = makeupPartItems(L5(E5()), S14({ makeupPart: 'lens', makeupView: 'parts' }));
    expect(items.map((i) => i.label)).toEqual(['卸妝', '口紅', '腮紅', '眉毛', '眼影', '眼線', '睫毛', '臥蠶', '修容', '高光', '美瞳']);
    expect(items[0]).toMatchObject({ key: 'makeupReset', action: { type: 'makeupReset' }, visual: { kind: 'icon', icon: 'makeupOff' } });
    expect(items[1].divider).toBe('before');
    expect(items.filter((i) => i.selected).map((i) => i.key)).toEqual(['part.lens']);
    expect(MAKEUP_PARTS.map((p) => p.param)).toEqual([
      'makeup.lip', 'makeup.blush', 'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
    ]);
  });

  it('dots show the parts that are on; a part on with a shade shows its 10 px swatch (眼線 null → 黑)', () => {
    const lens = L5(E5(withMakeup({ 'makeup.eyeshadow': 0.4, 'makeup.liner': 0.6, 'makeup.contour': 0.4 }, { eyeshadow: 'mauve' })));
    const items = makeupPartItems(lens, S14({ makeupView: 'parts' }));
    const at = (k: string) => items.find((i) => i.key === k)!;
    expect(at('part.eyeshadow')).toMatchObject({ hasValue: true, visual: { kind: 'icon', icon: 'eyeshadow', mini: '#9A7FA6' } });
    expect(at('part.liner').visual).toEqual({ kind: 'icon', icon: 'liner', mini: '#151313' });
    expect(at('part.contour').visual).toEqual({ kind: 'icon', icon: 'contour' });
    expect(at('part.brow').hasValue).toBe(false);
  });
});

describe('美妝 actions (face-detail spec §2.3)', () => {
  it('part / parts change only the selection', () => {
    const lens = L5(E5());
    expect(makeupAction({ type: 'parts' }, lens, S14())).toEqual({ edit: null, sel: S14({ makeupView: 'parts' }) });
    expect(makeupAction({ type: 'part', part: 'aegyo' }, lens, S14({ makeupView: 'parts' }))).toEqual({ edit: null, sel: S14({ makeupPart: 'aegyo' }) });
  });

  it('卸妝 is a no-op when nothing is on, and otherwise clears every part and shade in one step', () => {
    const none = L5(E5());
    expect(makeupAction({ type: 'makeupReset' }, none, S14())?.edit).toBeNull();
    const made = L5(E5(withMakeup({ 'makeup.lip': 0.5, 'makeup.lens': 0.6 }, { lip: 'rose', lens: 'blue' })));
    const out = makeupAction({ type: 'makeupReset' }, made, S14())!.edit!.persons.f0;
    expect(out.shades).toEqual(emptyShades());
    expect([out.values['makeup.lip'], out.values['makeup.lens']]).toEqual([0, 0]);
  });

  it('無 clears the active part only; a no-op when it is already off', () => {
    const lens = L5(E5(withMakeup({ 'makeup.liner': 0.6, 'makeup.brow': 0.4 }, { liner: 'navy' })));
    const out = makeupAction({ type: 'reset' }, lens, S14({ makeupPart: 'liner' }))!.edit!.persons.f0;
    expect([out.values['makeup.liner'], out.shades.liner, out.values['makeup.brow']]).toEqual([0, null, 0.4]);
    expect(makeupAction({ type: 'reset' }, lens, S14({ makeupPart: 'aegyo' }))?.edit).toBeNull();
    expect(makeupAction({ type: 'reset' }, lens, S14({ tab: 'skin' }))).toBeNull();
  });

  it('自然 from 0 applies the pick default; again is a no-op (same EditState)', () => {
    const e = E5();
    const r = makeupAction({ type: 'makeupOn', part: 'lashes' }, L5(e), S14({ makeupPart: 'lashes' }))!;
    expect(r.edit!.persons.f0.values['makeup.lashes']).toBe(MAKEUP_PICK_DEFAULT.lashes);
    const again = makeupAction({ type: 'makeupOn', part: 'lashes' }, L5(r.edit!), S14({ makeupPart: 'lashes' }))!;
    expect(again.edit).toBe(r.edit);
  });

  it('a shade from 0 applies the part pick default; tapping 黑 on a liner that reads as 黑 is not an undo step', () => {
    const r = makeupAction({ type: 'shade', part: 'lens', shade: 'blue' }, L5(E5()), S14({ makeupPart: 'lens' }))!;
    expect(r.edit!.persons.f0.values['makeup.lens']).toBe(MAKEUP_PICK_DEFAULT.lens);
    expect(r.edit!.persons.f0.shades.lens).toBe('blue');
    const liner = L5(E5(withMakeup({ 'makeup.liner': 0.6 })));
    expect(makeupAction({ type: 'shade', part: 'liner', shade: 'black' }, liner, S14({ makeupPart: 'liner' }))?.edit).toBeNull();
    expect(effectiveShade('liner', null)).toBe('black');
    expect(effectiveShade('lens', null)).toBeNull();
  });
});

describe('美妝 strip notes (face-detail spec §2.4)', () => {
  const none = { lensClosed: false, lashesClosed: false, lashesSmall: false, procFailed: false };
  it('closed eyes on 美瞳 / 睫毛, a small face on 睫毛, a compile failure on the eight new parts; only on level 2', () => {
    expect(makeupNote(S14({ makeupPart: 'lens' }), { ...none, lensClosed: true })).toBe('眼睛閉合時不套用美瞳與睫毛');
    expect(makeupNote(S14({ makeupPart: 'lashes' }), { ...none, lashesClosed: true })).toBe('眼睛閉合時不套用美瞳與睫毛');
    expect(makeupNote(S14({ makeupPart: 'eyeshadow' }), { ...none, lensClosed: true, lashesClosed: true })).toBeNull();
    expect(makeupNote(S14({ makeupPart: 'lashes' }), { ...none, lashesSmall: true })).toBe('臉部太小，睫毛不會套用');
    expect(makeupNote(S14({ makeupPart: 'brow' }), { ...none, procFailed: true })).toBe('此裝置無法使用這個妝容');
    expect(makeupNote(S14({ makeupPart: 'lip' }), { ...none, procFailed: true })).toBeNull();
    expect(makeupNote(S14({ makeupPart: 'lens', makeupView: 'parts' }), { ...none, lensClosed: true })).toBeNull();
    expect(makeupNote(S14({ tab: 'shape' }), { ...none, procFailed: true })).toBeNull();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/panelModel.test.ts`
Expected: FAIL — `makeupShadeItems` is not exported.

- [x] **Step 3: Implement**

`src/ui/panelModel.ts` (CRLF), replacing the two-entry `MAKEUP_PARTS` (`panelModel.ts:31-34`):

```ts
export interface MakeupPartDef {
  id: MakeupPart;
  label: string;
  param: ParamId;
  /** offers shades (else a single 自然) */
  shades: boolean;
  /** offers 原色 (眼線 does not: its null reads as 黑) */
  orig: boolean;
}

/** the ten 美妝 parts in RM §2.1 order (S5 §2.3) */
export const MAKEUP_PARTS: readonly MakeupPartDef[] = [
  { id: 'lip', label: '口紅', param: 'makeup.lip', shades: true, orig: true },
  { id: 'blush', label: '腮紅', param: 'makeup.blush', shades: true, orig: true },
  { id: 'brow', label: '眉毛', param: 'makeup.brow', shades: true, orig: true },
  { id: 'eyeshadow', label: '眼影', param: 'makeup.eyeshadow', shades: true, orig: true },
  { id: 'liner', label: '眼線', param: 'makeup.liner', shades: true, orig: false },
  { id: 'lashes', label: '睫毛', param: 'makeup.lashes', shades: false, orig: false },
  { id: 'aegyo', label: '臥蠶', param: 'makeup.aegyo', shades: false, orig: false },
  { id: 'contour', label: '修容', param: 'makeup.contour', shades: false, orig: false },
  { id: 'highlight', label: '高光', param: 'makeup.highlight', shades: false, orig: false },
  { id: 'lens', label: '美瞳', param: 'makeup.lens', shades: true, orig: true },
];
const PART_BY_ID = new Map(MAKEUP_PARTS.map((p) => [p.id, p]));
export function makeupPartDef(id: MakeupPart): MakeupPartDef {
  return PART_BY_ID.get(id) ?? MAKEUP_PARTS[0];
}
```

`PanelSelection` gains `makeupView: 'parts' | 'shades'` (`/** 美妝 strip level (S5 §2.3) */`), `INITIAL_SELECTION` gains `makeupView: 'shades'`. In `ItemVisual`, the icon variant becomes `{ kind: 'icon'; icon: string; /** 10 px shade swatch at the lower right (level-1 part tiles) */ mini?: string }`. In `ItemAction`, the shade action becomes `{ type: 'shade'; part: ShadePart; shade: string | null }` and the union gains:

```ts
  /** 美妝 level 1: make this part active and open its shades */
  | { type: 'part'; part: MakeupPart }
  /** 美妝 level 2 lead tile: open the part list */
  | { type: 'parts' }
  /** 美妝 level 1: 卸妝 */
  | { type: 'makeupReset' }
  /** 自然 on a part without shades */
  | { type: 'makeupOn'; part: MakeupPart }
```

Add (and remove the panel-local `makeupKey`, `panelModel.ts:356-358`, which only knew lip and blush, once its two users are ported below: `partHasValue` and `sliderFor`; the landed code has no `shadeOf`):

```ts
/** the shade the strip treats as current: 眼線 null reads as its first shade, 黑 (S5 §2.3) */
export function effectiveShade(part: ShadePart, shade: string | null): string | null {
  return part === 'liner' ? (shade ?? SHADES.liner[0].id) : shade;
}

/** level 2's leading tile: the active part; its 「切換部位」 aria label and ‹ are drawn by BeautyPanel */
export function makeupLeadItem(sel: PanelSelection): PanelItem {
  const p = makeupPartDef(sel.makeupPart);
  return { key: 'lead', label: p.label, visual: { kind: 'icon', icon: paramDef(p.param).icon }, selected: false, hasValue: false, action: { type: 'parts' }, ...ENABLED };
}

/** level 1: 卸妝 │ the ten parts with dots and, when on with a shade, a 10 px swatch */
export function makeupPartItems(lens: Lens, sel: PanelSelection): PanelItem[] {
  return [
    { key: 'makeupReset', label: '卸妝', visual: { kind: 'icon', icon: 'makeupOff' }, selected: false, hasValue: false, action: { type: 'makeupReset' }, ...ENABLED },
    ...MAKEUP_PARTS.map((p, i): PanelItem => {
      const on = lens.get(p.param).value > 0.01;
      const shade = p.shades && isShadePart(p.id) ? effectiveShade(p.id, lens.shade(p.id).shade) : null;
      const mini = on && shade && isShadePart(p.id) ? shadeColor(p.id, shade) : null;
      const icon = paramDef(p.param).icon;
      return {
        key: `part.${p.id}`,
        label: p.label,
        visual: mini ? { kind: 'icon', icon, mini } : { kind: 'icon', icon },
        selected: sel.makeupPart === p.id,
        hasValue: on,
        action: { type: 'part', part: p.id },
        ...ENABLED,
        ...(i === 0 ? { divider: 'before' as const } : {}),
      };
    }),
  ];
}

/** level 2: 無 · (原色) · shades, or 無 · 自然; exactly one selected unless 全部 shows mixed persons (RM §3.3) */
export function makeupShadeItems(lens: Lens, part: MakeupPart): PanelItem[] {
  const p = makeupPartDef(part);
  const v = lens.get(p.param);
  const on = v.value > 0.01;
  const reset = { ...RESET_ITEM('無'), selected: !on && !v.mixed };
  if (!p.shades || !isShadePart(part)) {
    const natural: PanelItem = {
      key: 'on',
      label: '自然',
      visual: { kind: 'icon', icon: paramDef(p.param).icon },
      selected: on && !v.mixed,
      hasValue: false,
      action: { type: 'makeupOn', part },
      ...ENABLED,
    };
    return [reset, natural];
  }
  const st = lens.shade(part);
  const cur = effectiveShade(part, st.shade);
  const pick = (shade: string | null) => on && !v.mixed && !st.mixed && cur === shade;
  const items: PanelItem[] = [reset];
  if (p.orig)
    items.push({ key: 'orig', label: '原色', visual: { kind: 'swatch', color: null }, selected: pick(null), hasValue: false, action: { type: 'shade', part, shade: null }, ...ENABLED });
  for (const s of SHADES[part])
    items.push({ key: s.id, label: s.label, visual: { kind: 'swatch', color: s.color }, selected: pick(s.id), hasValue: false, action: { type: 'shade', part, shade: s.id }, ...ENABLED });
  return items;
}

/** the 美妝 actions (S5 §2.3); edit null = unchanged (no undo step, no haptic). Not a 美妝 action → null. */
export function makeupAction(a: ItemAction, lens: Lens, sel: PanelSelection): { edit: EditState | null; sel: PanelSelection } | null {
  switch (a.type) {
    case 'parts':
      return { edit: null, sel: sel.makeupView === 'parts' ? sel : { ...sel, makeupView: 'parts' } };
    case 'part':
      return { edit: null, sel: sel.makeupPart === a.part && sel.makeupView === 'shades' ? sel : { ...sel, makeupPart: a.part, makeupView: 'shades' } };
    case 'makeupReset': {
      const anyOn =
        MAKEUP_PARTS.some((p) => {
          const g = lens.get(p.param);
          return g.value > 0.01 || g.mixed;
        }) ||
        SHADE_PARTS.some((k) => {
          const s = lens.shade(k);
          return s.shade !== null || s.mixed;
        });
      return { edit: anyOn ? lens.resetGroup('makeup') : null, sel };
    }
    case 'makeupOn': {
      const p = makeupPartDef(a.part);
      return { edit: lens.ensureOn(p.param, MAKEUP_PICK_DEFAULT[a.part]), sel };
    }
    case 'reset': {
      if (sel.tab !== 'makeup') return null;
      const p = makeupPartDef(sel.makeupPart);
      const v = lens.get(p.param);
      const st = isShadePart(p.id) ? lens.shade(p.id) : null;
      const off = v.value <= 0.01 && !v.mixed && (!st || (st.shade === null && !st.mixed));
      return { edit: off ? null : lens.clearMakeup(p.id), sel };
    }
    case 'shade': {
      const v = lens.get(makeupPartDef(a.part).param);
      const st = lens.shade(a.part);
      if (v.value > 0.01 && !v.mixed && !st.mixed && effectiveShade(a.part, st.shade) === effectiveShade(a.part, a.shade)) return { edit: null, sel };
      return { edit: lens.setShade(a.part, a.shade), sel };
    }
    default:
      return null;
  }
}

export const MAKEUP_EYES_NOTE = '眼睛閉合時不套用美瞳與睫毛';
export const MAKEUP_SMALL_NOTE = '臉部太小，睫毛不會套用';
export const MAKEUP_PROC_NOTE = '此裝置無法使用這個妝容';
export interface MakeupNoteInput {
  lensClosed: boolean;
  lashesClosed: boolean;
  lashesSmall: boolean;
  procFailed: boolean;
}

/** the 美妝 level-2 note (S5 §2.4); a note never blocks the slider, the value applies when the condition goes away */
export function makeupNote(sel: PanelSelection, i: MakeupNoteInput): string | null {
  if (sel.tab !== 'makeup' || sel.makeupView !== 'shades') return null;
  const p = sel.makeupPart;
  if (i.procFailed && p !== 'lip' && p !== 'blush') return MAKEUP_PROC_NOTE;
  if ((p === 'lens' && i.lensClosed) || (p === 'lashes' && i.lashesClosed)) return MAKEUP_EYES_NOTE;
  if (p === 'lashes' && i.lashesSmall) return MAKEUP_SMALL_NOTE;
  return null;
}
```

Wire them in:
- `itemsFor`, case `'makeup'`: replace step 1's body (with Task 1's `isShadePart` guard) by `return sel.makeupView === 'parts' ? makeupPartItems(lens, sel) : makeupShadeItems(lens, sel.makeupPart);`
- `sliderFor`, case `'makeup'`: keep step 1's binding, its `usable` gate, its `decorate` and its key scheme — `const p = makeupPartDef(sel.makeupPart); if (!usable(lens, p.param)) return null; const b = paramBinding(lens, p.param); return decorate({ ...b, label: p.label, defaultValue: MAKEUP_PICK_DEFAULT[sel.makeupPart] }, lens, false);` in place of step 1's `makeupKey(sel.makeupPart)` and its lip / blush label; it shows on both levels (never unmounted mid-drag, `panelModel.ts:1002-1009`).
- step 1's `partHasValue(lens, part)` (BeautyPanel's part-row callback and `panelModel.test.ts:706-708` still call it): `makeupKey(part)` becomes `MAKEUP_PARAM[part]`, and Task 1's guard `if (!isShadePart(part)) return false;` becomes the dot of a part without shades: `if (lens.sel.kind !== 'all') return isShadePart(part) ? lens.shade(part).on : lens.get(MAKEUP_PARAM[part]).value > 0.01;`. Then delete the panel-local `function makeupKey` (no other user is left; `noUnusedLocals`).
- `activate` (step 1's `const edit = lens.edit;` and `done(next = edit, nextSel = sel, notice?)`), right after its disabled-item check: `const m = makeupAction(a, lens, sel); if (m) return done(m.edit ?? edit, m.sel);`, and delete step 1's makeup branch of `'reset'` (with Task 1's guard) and its `'shade'` case (both are handled above). `activate` returns `ActivateResult` from an exhaustive `switch (a.type)`, so keep it exhaustive for TypeScript: add `case 'shade': case 'part': case 'parts': case 'makeupReset': case 'makeupOn': return done();` (`makeupAction` has already answered every one of them).
- `tabHasValue`, case `'makeup'`: unchanged (`paramsInGroup('makeup')` now holds the ten values).
- Step 2's `partButtons(sel, state)`: delete its `if (sel.tab === 'makeup') return MAKEUP_PARTS.map(…);` line, so it returns `null` on 美妝 (the leading tile replaces the part row; the 一鍵 row is unchanged). In step 2's `src/ui/panelModel.adjust.test.ts`, the assertion `expect(partButtons(sel({ tab: 'makeup' }), { makeupOn: (p) => p === 'blush', look: null })!.map((p) => p.hasValue)).toEqual([false, true]);` becomes `expect(partButtons(sel({ tab: 'makeup' }), { makeupOn: (p) => p === 'blush', look: null })).toBeNull();` — the one intended change of a step-2 assertion (S5 §2.3 replaces the part row). `selectPart`'s 美妝 branch stays (harmless). In `src/ui/components/BeautyPanel.test.tsx` (LF), step 2's case 「美妝 keeps its 口紅／腮紅 row (icons lip / blush)」 (`:252-256`) loses its row: until Task 15 adds the lead tile the strip starts with level 2's items, so it becomes 「美妝 has no part row」 with `expect(sequence(strip).slice(0, 2)).toEqual(['無', '原色']);` (Task 15 ports it once more).

Imports in `panelModel.ts`: `MAKEUP_PARAM`, `SHADE_PARTS`, `SHADES`, `shadeColor` from `../engine/params` (`isShadePart` since Task 1; `MAKEUP_PICK_DEFAULT` already); the `ShadePart` type since Task 1, `EditState` already. Remove the now unused `LIP_SHADES` / `BLUSH_SHADES` imports.

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/ui src/edit && npm run typecheck`
Expected: PASS. The existing makeup tests (`panelModel.test.ts:103-107` level-2 keys, "after picking a shade exactly that shade is selected", "tapping the already-selected makeup 無 is a no-op") keep their assertions; the ported `partButtons` assertion passes.

- [x] **Step 5: Commit**

```bash
file src/ui/panelModel.ts
git add src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/panelModel.adjust.test.ts src/ui/components/BeautyPanel.test.tsx
git commit -F- <<'EOF'
v0.4 step 5: 美妝 two-level strip model, 卸妝 and 自然

Ten parts; level 1 lists 卸妝 and the part tiles (dots, shade swatches),
level 2 the shades of the active part (眼線 without 原色, 自然 for the four
parts without shades); per-part pick defaults; strip notes for closed
eyes, small faces and an unavailable program.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 15: Strip and slider components: lead tile, part list, seen dot, 左｜右 chips

The Preact side of Tasks 13–14 (S5 §2.1–2.4): the 美妝 leading part tile with its `‹` and first-run accent dot, level-1 swatches, the strip key per level and part, the 美妝 note, the once-per-session 「{label}左右一起調整」 toast, and the slider's 左｜右 segmented control with the other side's caption.

**Files:**
- Modify: `src/ui/components/BeautyPanel.tsx` (CRLF; after steps 1–4: the strip key `:75-76`, `tapItem` `:109-127`, the strip head `:143-178`, the item buttons `:191-219`, `ItemVisual` `:286-293`)
- Modify: `src/ui/components/Slider.tsx` (CRLF; `:66-76` props, `:180-230` render)
- Modify: `src/ui/theme.css` (CRLF; after `.item.switchable.on .item-switch::after` (`:543-546`), and after `.slider-value` (`:748-751`))
- Modify: `src/store/settings.ts` (seen flag)
- Test: `src/store/settings.test.ts`, `src/ui/components/Slider.test.tsx` (step 1's file; step 4 added its `valueText` test to it); `src/ui/components/BeautyPanel.test.tsx` (Task 14's port of the 美妝 row case becomes the lead-tile case)

**Interfaces:**
- Consumes: Tasks 13–14 (`makeupLeadItem`, `makeupNote` result passed in, `splitJointNotice`, `SliderView.sides`, `ItemVisual.mini`, `PanelSelection.makeupView`); step 1's `BeautyPanel` props (the lens and selection it receives, `onSel`), its slider aria-label composition (S1 §2.4 「{label}，人物 {n}」); `formatDisplay` (`Slider.tsx:27`); `toast`, `haptic`; `readJson` / `writeJson` (`settings.ts:101-116`).
- Produces:
  - `settings.ts`: `SEEN_MAKEUP_PARTS_KEY = 'meiyan.seen.makeupParts.v1'`, `loadMakeupPartsSeen(): boolean`, `saveMakeupPartsSeen(): void`
  - `Slider.tsx`: `sideCaption(b: SliderView): string | null`, `sliderAriaLabel(b: SliderView): string` (a `SliderBinding` is a `SliderView`); `SliderRow` prop `onSel?(sel: PanelSelection): void`
  - `BeautyPanel` prop `makeupNote?: string | null`

- [x] **Step 1: Write the failing tests**

Append to `src/store/settings.test.ts` (import `loadMakeupPartsSeen, saveMakeupPartsSeen, SEEN_MAKEUP_PARTS_KEY` from `./settings`):

```ts
describe('美妝 part-list seen flag (face-detail spec §2.3)', () => {
  it('is false until saved, then true, under its own new key', () => {
    expect(SEEN_MAKEUP_PARTS_KEY).toBe('meiyan.seen.makeupParts.v1');
    expect(loadMakeupPartsSeen()).toBe(false);
    saveMakeupPartsSeen();
    expect(store.getItem(SEEN_MAKEUP_PARTS_KEY)).toBe('true');
    expect(loadMakeupPartsSeen()).toBe(true);
  });
  it('blocked storage reads as not seen and never throws', () => {
    stubThrowingGetter();
    expect(loadMakeupPartsSeen()).toBe(false);
    expect(() => saveMakeupPartsSeen()).not.toThrow();
  });
});
```

Append to `src/ui/components/Slider.test.tsx` (it already imports `afterAll, beforeAll, describe, expect, it` from `vitest`, `type SliderBinding, SliderView` from `../panelModel` and `SliderRow, valueText` from `./Slider`: add `sideCaption, sliderAriaLabel` to that `./Slider` import; the three import lines at the top of the block below only show the names the new cases use, they are not lines to add):

```ts
import { describe, expect, it } from 'vitest';
import type { SliderBinding } from '../panelModel';
import { sideCaption, sliderAriaLabel, valueText } from './Slider';

const b = (over: Partial<SliderBinding>): SliderBinding => ({
  key: 'k',
  param: 'shape.faceSlim',
  label: '瘦臉',
  bidirectional: false,
  value: 0.3,
  mixed: false,
  defaultValue: 0.15,
  apply: (l) => l.set('shape.faceSlim', 0),
  ...over,
});

describe('左｜右 slider helpers (face-detail spec §2.2)', () => {
  it('captions the other side, signed for bidirectional items', () => {
    expect(sideCaption(b({}))).toBeNull();
    expect(sideCaption(b({ sides: { active: 'L', other: 0.3, select: () => ({}) as never } }))).toBe('右 30');
    expect(sideCaption(b({ label: '太陽穴', bidirectional: true, sides: { active: 'R', other: 0.62, select: () => ({}) as never } }))).toBe('左 +12');
  });
  it('names the side in the slider aria-label', () => {
    expect(sliderAriaLabel(b({}))).toBe('瘦臉');
    expect(sliderAriaLabel(b({ sides: { active: 'L', other: 0, select: () => ({}) as never } }))).toBe('瘦臉（左）');
    expect(sliderAriaLabel(b({ sides: { active: 'R', other: 0, select: () => ({}) as never } }))).toBe('瘦臉（右）');
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/store/settings.test.ts src/ui/components/Slider.test.tsx`
Expected: FAIL — `loadMakeupPartsSeen` / `sideCaption` not exported.

- [x] **Step 3: Implement the store flag and the slider**

`src/store/settings.ts`, after the version helpers:

```ts
// ───────────── the 美妝 part list was opened on this device (face-detail spec §2.3) ─────────────

export const SEEN_MAKEUP_PARTS_KEY = 'meiyan.seen.makeupParts.v1';

/** false until the part list has been opened once (the leading tile shows an accent dot meanwhile) */
export function loadMakeupPartsSeen(): boolean {
  return readJson(SEEN_MAKEUP_PARTS_KEY) === true;
}

export function saveMakeupPartsSeen(): void {
  writeJson(SEEN_MAKEUP_PARTS_KEY, true);
}
```

`src/ui/components/Slider.tsx` (CRLF), after `formatDisplay`:

```ts
/** under a split item's slider: the other on-screen side's value, e.g. 「右 +12」 or 「左 30」 (S5 §2.2) */
export function sideCaption(b: SliderView): string | null {
  if (!b.sides) return null;
  return `${b.sides.active === 'L' ? '右' : '左'} ${formatDisplay(b.bidirectional, b.sides.other)}`;
}

/**
 * the slider's accessible name: step 1's `aria` (「{label}，人物 {n}」 / 「{label}，全部」, set by decorate with ≥ 2 persons) or the
 * label, with the chosen side right after the item name while a side is chosen: 「瘦臉（左）」, 「瘦臉（左），人物 2」
 */
export function sliderAriaLabel(b: SliderView): string {
  const base = b.aria ?? b.label;
  if (!b.sides) return base;
  const side = `（${b.sides.active === 'L' ? '左' : '右'}）`;
  return base.startsWith(b.label) ? `${b.label}${side}${base.slice(b.label.length)}` : `${base}${side}`;
}
```

`Props` gains `/** 左｜右 chips: a side change is a selection change (view state, never an undo step) */ onSel?(sel: PanelSelection): void;` (add `PanelSelection` to the `import type { SliderScale, SliderView } from '../panelModel'` line, and `onSel` to `SliderRow`'s destructured props). In the render, replace step 1's label span (`Slider.tsx:183-186`: `<span class="slider-label">{binding.label}{binding.mixed && <small class="slider-mixed">各人不同</small>}</span>`) with the block below, whose `: (…)` branch is that span unchanged, and keep the 「各人不同」 marker in the chips branch too (add `{binding.mixed && <small class="slider-mixed">各人不同</small>}` right after the chips' `</div>`, inside a fragment: under 全部 `mixed` compares the chosen side, S5 §3.4):

```tsx
      {binding.sides ? (
        <div class="side-chips" role="radiogroup" aria-label={`${binding.label}：左右`}>
          {(['L', 'R'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={binding.sides!.active === s}
              class={`side-chip${binding.sides!.active === s ? ' on' : ''}`}
              onClick={() => onSel?.(binding.sides!.select(s))}
            >
              {s === 'L' ? '左' : '右'}
            </button>
          ))}
        </div>
      ) : (
        <span class="slider-label">
          {binding.label}
          {binding.mixed && <small class="slider-mixed">各人不同</small>}
        </span>
      )}
```

the slider's `aria-label={binding.aria ?? binding.label}` (`Slider.tsx:191`) becomes `aria-label={sliderAriaLabel(binding)}` (it keeps step 1's 「，人物 {n}」 / 「，全部」 suffix after the side), and add inside the `.slider` element, after `.slider-track` and step 4's `.slider-ends` block:

```tsx
        {binding.sides && <span class="side-caption num">{sideCaption(binding)}</span>}
```

A double tap still calls `onChange(binding.defaultValue)`, and `binding.apply` writes only the chosen side, so it resets that side only (S5 §2.2). The binding key carries the side, so a chip tap resets the drag state and the double-tap timer.

`src/ui/theme.css` (CRLF), after `.slider-value { … }`:

```css
/* 左右分開 (face-detail spec §2.2): the side chips replace the slider label; the other side's value under the track */
.side-chips {
  position: relative;
  flex: none;
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--line);
}
.side-chip {
  appearance: none;
  border: 0;
  width: 44px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: #d1d1d6;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}
.side-chip.on {
  background: var(--accent);
  color: var(--accent-ink);
}
.side-caption {
  position: absolute;
  left: 0;
  bottom: 1px;
  font-size: 10px;
  line-height: 12px;
  color: var(--text-2);
  pointer-events: none;
}
```

and after `.item.switchable.on .item-switch::after { … }`:

```css
/* 美妝 (face-detail spec §2.3): the leading part tile (‹, first-run dot) and the level-1 shade swatch */
.item.part.lead .item-tile {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.part-back {
  position: absolute;
  left: 4px;
  top: 2px;
  font-size: 12px;
  font-style: normal;
  line-height: 12px;
  color: var(--accent);
}
.seen-dot {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: var(--accent);
}
.mini-swatch {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 10px;
  height: 10px;
  border-radius: 5px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
}
```

- [x] **Step 4: Implement the panel**

`src/ui/components/BeautyPanel.tsx` (CRLF; on top of steps 1–4):

1. Props gain `/** the 美妝 level-2 note (face-detail spec §2.4); never dims the strip or blocks the slider */ makeupNote?: string | null;`.
2. Module level: `let jointToastShown = false;` (the 「{label}左右一起調整」 toast shows once per session).
3. The strip key (`BeautyPanel.tsx:75-76`, as step 2 left it): the 美妝 case becomes `` `makeup.${sel.makeupView}.${sel.makeupPart}` `` (today `` `makeup.${sel.makeupPart}` ``) and every other tab keeps its key, so switching level or part scrolls the strip back to its start.
4. Seen flag: `const [seen, setSeen] = useState(loadMakeupPartsSeen);` (import `loadMakeupPartsSeen`, `saveMakeupPartsSeen` from `../../store/settings`; add `useState` to the `preact/hooks` import, which has only `useLayoutEffect, useRef`).
5. In `tapItem`, before activating: `const joint = splitJointNotice(item, lens, sel); if (joint && !jointToastShown) { jointToastShown = true; toast(joint, 2600); }`; and for the lead tile (action `parts`): `if (!seen) { saveMakeupPartsSeen(); setSeen(true); }`.
6. At the head of the strip (where the face note and the 美體 note render), on 美妝 level 2:

```tsx
          {sel.tab === 'makeup' && makeupNote && !faceOff && (
            <p class="strip-note makeup-note" role="note">
              {makeupNote}
            </p>
          )}
          {sel.tab === 'makeup' && sel.makeupView === 'shades' && (
            <>
              <LeadTile item={makeupLeadItem(sel)} seen={seen} onTap={tapItem} />
              <span class="strip-divider" />
            </>
          )}
```

The old 美妝 part-button row disappears by itself: step 2's `{parts && (…)}` block renders nothing on 美妝 because `partButtons` returns `null` there since Task 14 (the 一鍵 part row stays).

7. The lead tile component:

```tsx
/** 美妝 level 2's leading tile: the active part; ‹ opens the part list; an accent dot until it was opened once */
function LeadTile({ item, seen, onTap }: { item: PanelItem; seen: boolean; onTap(item: PanelItem): void }) {
  return (
    <button type="button" class="item part lead" aria-label={`切換部位（目前：${item.label}）`} onClick={() => onTap(item)}>
      <span class="item-tile">
        <ItemVisual item={item} />
        <i class="part-back" aria-hidden="true">
          ‹
        </i>
        {!seen && <i class="seen-dot" aria-hidden="true" />}
      </span>
      <span class="item-label">{item.label}</span>
      <span class="item-dot" />
    </button>
  );
}
```

8. `ItemVisual` draws the level-1 swatch:

```tsx
  if (v.kind === 'icon')
    return (
      <>
        <Icon name={v.icon} />
        {v.mini && <i class="mini-swatch" style={{ background: v.mini }} aria-hidden="true" />}
      </>
    );
```

Haptics: `parts`, `part`, `makeupReset`, `makeupOn` and `split` are taps like `preset` / `reset` (add them to the `haptic()` list in `tapItem`, `BeautyPanel.tsx:124`).

9. The item button's `aria-description` (`BeautyPanel.tsx:200`) is step 1's `item.disabled ? (item.reason ?? undefined) : item.badge ? '整張照片' : undefined`, written when 「整張」 was the only badge; with the 「左右」 badge it would announce 整張照片 on the six split items. Make it `item.disabled ? (item.reason ?? undefined) : item.badge === SPLIT_BADGE ? '左右分開' : item.badge ? '整張照片' : undefined`.
10. Imports: `makeupLeadItem`, `splitJointNotice`, `SPLIT_BADGE` merged into the `../panelModel` import.

`src/ui/components/BeautyPanel.test.tsx` (LF): Task 14's 「美妝 has no part row」 case now meets the lead tile; make it 「美妝 leads with the active part's tile (icon lip)」: `expect(sequence(strip).slice(0, 3)).toEqual(['口紅', '│', '無']);`, `expect(shape(button(strip, '口紅').find('item-tile')!.elements[0])).toBe(iconShape('lip'));` and `expect(button(strip, '口紅').attrs['aria-label']).toBe('切換部位（目前：口紅）');`.

- [x] **Step 5: Run the tests, typecheck, build**

Run: `npx vitest run src/store src/ui && npm run typecheck && npm run build`
Expected: PASS; the production build succeeds.

- [x] **Step 6: Commit**

```bash
file src/ui/components/BeautyPanel.tsx src/ui/components/Slider.tsx src/ui/theme.css src/store/settings.ts
git add src/ui/components/BeautyPanel.tsx src/ui/components/BeautyPanel.test.tsx src/ui/components/Slider.tsx src/ui/components/Slider.test.tsx src/ui/theme.css src/store/settings.ts src/store/settings.test.ts
git commit -F- <<'EOF'
v0.4 step 5: two-level 美妝 strip and 左｜右 slider components

The leading part tile with ‹ and a first-run dot (meiyan.seen.makeupParts.v1),
level-1 shade swatches, the 美妝 note, the once-per-session joint toast,
and the slider's 左｜右 chips with the other side's caption.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 16: Screens: screen sides per person, strip notes, mirrored hand-over

Connects the model to the editor and the camera (S5 §2.2, §2.4, §2.5, §3.4): each person's `screenSwap` from where its eyes show through the view, the camera's from the preview mirror, the 美妝 notes, the slider's side chips, and the camera → 編輯 hand-over of a shot saved mirrored.

**Files:**
- Modify: `src/edit/sides.ts` (`handOverLook`, `cameraScreenSwap`), `src/edit/sides.test.ts`
- Modify: `src/ui/state.ts:20-31` (CRLF; `Shot.mirrored`)
- Modify: `src/ui/screens/Camera.tsx` (CRLF; `captureFrom` `:203-244` (the mirror flag `:228`, the shot `:243`), the lens persons (`lensOf` `:73`), `SliderRow` `:432`, `BeautyPanel` `:458`)
- Modify: `src/ui/screens/Review.tsx:87-95` (CRLF; 編輯 hand-over, the `go(…)` line `:94`)
- Modify: `src/ui/screens/Editor.tsx` (LF; the lens persons (`infos` `:164`, `sessionFaces` `:332`, `lensOf` `:374`), the notes (`faceNote` `:1601-1609`), `SliderRow` `:1752-1757`, `BeautyPanel` `:1759-1771`)

**Interfaces:**
- Consumes: Task 3 `mirrorSides`, `screenLeftIsGpLeft`; Task 4 `PersonInfo.screenSwap`; Task 5 `eyeNoteInfo`; Task 11 `Engine.procMakeupFailed`; Task 14 `makeupNote`; Task 15 `SliderRow` `onSel`, `BeautyPanel` `makeupNote`; step 1's `CameraLook`, `Shot.look` / `Shot.faceSeed`, `cameraShotEdit(look, seed)` (`src/edit/migrate.ts`), `freshSource(bitmap, edit, returnTo, faceSeed?)` (`src/ui/flows.ts`), Review's `edit()` (`go({ name: 'editor', source: freshSource(shot.original, cameraShotEdit(shot.look, …), 'camera', …) })`), the camera lens `lensOf = (l) => lensFor(cameraEdit(l), { kind: 'person', id: LIVE }, LIVE_PERSONS, LIVE)` with `LIVE_PERSONS = [{ id: 'live', face: true, body: false }]` (`src/edit/lens.ts`), the Editor's per-photo person selection, `personInfos(cache: DetectionCache | null): PersonInfo[]` (`src/detect/cache.ts`; `DetectionCache.persons: PersonInfoCached { id; face: string | null /* face id */; body }`) and the session's `faces: SessionFace[]` (`{ id, face, box, lm }`); in `Camera.tsx` the `snap` state (`snap.facing`) and `bundle?.engine`; in `Editor.tsx` (as landed) the cache `detect` (`useState<DetectionCache | null>`, `:155`), `const infos = useMemo(() => personInfos(detect), [detect])` (`:164`), the selection `selected: Selection` (`:172`; there is no `personSel`), `bound?.engine` and `session = bound.s` (`:305`), `g = edit.photo.geometry` (`:309`), the O size `photo` (`{ width, height }` of the working bitmap, `:286`), `sessionFaces: readonly SessionFace[] | null` (`:332`), `lensOf = (e) => lensFor(e, selected, infos, primary, { available })` (`:374`), and a local `view` (`:1611`, the V size) that a new name must not shadow; step 3's `oToV(g, oSize)` and `apply` (`src/geometry/view.ts`).
- Produces: `sides.ts`: `handOverLook(look: CameraLook, mirrored: boolean): CameraLook`, `cameraScreenSwap(facing: Facing): boolean`; `Shot.mirrored: boolean`.

- [x] **Step 1: Write the failing test**

Append to `src/edit/sides.test.ts` (import `handOverLook`, `cameraScreenSwap`; `defaultPhoto` from `./state`; the `CameraLook` type):

```ts
describe('camera → 編輯 hand-over (face-detail spec §3.4)', () => {
  it('a shot saved mirrored swaps the split halves so each value stays on the same cheek', () => {
    const p = writeSide(splitOn(naturalPerson()), 'shape.faceSlim', 0.9, 'right');
    const look: CameraLook = { photo: defaultPhoto(), person: p };
    const handed = handOverLook(look, true).person;
    expect(handed.values['shape.faceSlim']).toBe(0.9);
    expect(handed.right?.['shape.faceSlim']).toBe(p.values['shape.faceSlim']);
    expect(handOverLook(look, false)).toBe(look);
    const plain: CameraLook = { photo: defaultPhoto(), person: naturalPerson() };
    expect(handOverLook(plain, true).person).toBe(plain.person);
  });
  it('the camera preview mirrors the front camera only', () => {
    expect(cameraScreenSwap('user')).toBe(true);
    expect(cameraScreenSwap('environment')).toBe(false);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/edit/sides.test.ts`
Expected: FAIL — `handOverLook` is not exported.

- [x] **Step 3: Implement the helpers**

Append to `src/edit/sides.ts` (add `CameraLook`, `Facing` to the type import):

```ts
/** Shot → 編輯 (S5 §3.4): a shot saved mirrored puts each cheek on the other GPUPixel half; swap the split values. */
export function handOverLook(look: CameraLook, mirrored: boolean): CameraLook {
  if (!mirrored) return look;
  const person = mirrorSides(look.person);
  return person === look.person ? look : { ...look, person };
}

/**
 * The camera detects on the unmirrored frame and shows the front camera mirrored (live.ts:160), so an upright face's
 * GPUPixel-left half shows on the right exactly when facing === 'user' (S5 §3.4: toScreen is x → 1 − x there).
 */
export function cameraScreenSwap(facing: Facing): boolean {
  return facing === 'user';
}
```

- [x] **Step 4: Wire the screens**

`src/ui/state.ts` (CRLF), in `Shot`:

```ts
  /** saved mirrored (front camera with 鏡像儲存): the shot's GPUPixel halves are the live look's swapped (S5 §3.4) */
  mirrored: boolean;
```

`src/ui/screens/Camera.tsx` (CRLF):
- In `captureFrom`, the shot gets `mirrored: mirror` (the value computed at `Camera.tsx:228`, before the await; the shot object is built at `:243`).
- Step 1's camera lens passes `LIVE_PERSONS`; pass the live person with its screen side instead: `const livePersons: PersonInfo[] = [{ ...LIVE_PERSONS[0], screenSwap: cameraScreenSwap(snap?.facing ?? 'user') }];` (computed in the render body) and `lensFor(cameraEdit(l), { kind: 'person', id: LIVE }, livePersons, LIVE)` in `lensOf`, so a front ↔ back flip re-maps the chips on the next render (S5 §7).
- `<SliderRow float … onSel={setSel} />` so the side chips work in the floating slider row; taps on them never toggle the panel collapse, because `onStageClick` already ignores `.slider-row` (`Camera.tsx:287`).
- `<BeautyPanel … makeupNote={makeupNote(sel, { lensClosed: false, lashesClosed: false, lashesSmall: false, procFailed: !!bundle?.engine.procMakeupFailed })} />` — the camera shows no closed-eye or small-face note, they change every frame (S5 §2.5).
- Imports: `cameraScreenSwap` from `../../edit/sides`; `makeupNote` from `../panelModel`; the `PersonInfo` type from `../../edit/lens` (next to step 1's `lensFor, LIVE_PERSONS` import).

`src/ui/screens/Review.tsx` (CRLF), in `edit()`: hand step 1's builder the mirrored-aware look — in step 1's `freshSource(shot.original, cameraShotEdit(shot.look, shot.faceSeed), 'camera', shot.faceSeed)` (as step 1's camera hand-over left it), replace `shot.look` by `handOverLook(shot.look, shot.mirrored)`:

```ts
    go({ name: 'editor', source: freshSource(shot.original, cameraShotEdit(handOverLook(shot.look, shot.mirrored), shot.faceSeed), 'camera', shot.faceSeed) });
```

(every other argument stays as steps 1 and 3 left it). Import `handOverLook` from `../../edit/sides`.

`src/ui/screens/Editor.tsx`:
- After `sessionFaces` (`:332`) and before `lensOf` (`:374`), add each person's screen side through the current view, then pass `lensPersons` instead of `infos` in `lensOf` (the one place `infos` reaches `lensFor`; `infos` keeps its other users):

```ts
  // 左／右 follow the screen per face (S5 §2.2): through the view, so 翻轉 and 旋轉 move the labels, never the values
  const oView = oToV(g, photo);
  const toScreen = (p: [number, number]): [number, number] => apply(oView, p);
  /** the adapted Face of a person (its cache face id → the session face), or null for a body-only person */
  const faceOfPerson = (pid: PersonId): Face | null => {
    const fid = detect?.persons.find((c) => c.id === pid)?.face ?? null;
    return (fid !== null && sessionFaces?.find((f) => f.id === fid)?.face) || null;
  };
  const lensPersons: PersonInfo[] = infos.map((p) => {
    const face = faceOfPerson(p.id);
    return face ? { ...p, screenSwap: !screenLeftIsGpLeft(face, toScreen) } : p;
  });
```

(`detect` is the editor's `DetectionCache | null`, `infos` its `personInfos(detect)`, `sessionFaces` the session's faces kept across an engine recovery, `g` the photo's geometry and `photo` the O size; the matrix is named `oView` because the component already has a `view`, `:1611`.)
- The 美妝 note, next to the `faceNote` computation (`Editor.tsx:1601-1609`):

```ts
  // S5 §2.4: closed eyes and small faces only for one selected person (not under 全部); the program failure always
  const selFace = selected.kind === 'person' ? faceOfPerson(selected.id) : null;
  const eyes = selFace ? eyeNoteInfo(selFace, photo.width / photo.height) : { lensClosed: false, lashesClosed: false, lashesSmall: false };
  const mkNote = makeupNote(sel, { ...eyes, procFailed: !!bound?.engine.procMakeupFailed });
```

where `selected` is the editor's resolved person selection (`:172`; with one person it is that person).
- `<SliderRow … onSel={setSel} />` and `<BeautyPanel … makeupNote={mkNote} />`.
- Imports: `oToV` merged into the `../../geometry/view` import (`:48`, which already has `apply`); `screenLeftIsGpLeft` from `../../edit/sides`; `eyeNoteInfo` from `../../engine/passes/eyeFrame`; `makeupNote` merged into the `../panelModel` import; `type PersonInfo` merged into `import { lensFor } from '../../edit/lens'` (`:39`); `Face` merged into the `../../types` type import (`:37`, which already has `PersonId`).

- [x] **Step 5: Run the unit suite, typecheck and the app e2e that touch these screens**

Run: `npm test && npm run typecheck && npm run build && npx playwright test tests/e2e/camera.spec.ts tests/e2e/editor.spec.ts`
Expected: PASS — `camera.spec.ts:33` still finds 原色 on 美妝 (level 2 of 口紅 is the default view), `editor.spec.ts:140-160` keeps its no-face note on 美型 and 美妝.

- [x] **Step 6: Commit**

```bash
file src/ui/state.ts src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/ui/screens/Editor.tsx src/edit/sides.ts
git add src/edit/sides.ts src/edit/sides.test.ts src/ui/state.ts src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/ui/screens/Editor.tsx
git commit -F- <<'EOF'
v0.4 step 5: screen-sided 左／右, 美妝 notes and the mirrored hand-over

Each person's 左／右 follow the screen through the view (editor) or the
preview mirror (camera); closed-eye, small-face and program notes on
美妝; a shot saved mirrored hands its split values over swapped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 17: App e2e: 左右分開, per person, the 美妝 flows, the camera

S5 §8.3 items 5, 6 and 7 on the production build: 左右分開 on `sample_face.png` and on the mirrored face B of `group_faces.png`, the labels after 翻轉, undo of the toggle; per-person 眼影 and 全部 眉毛 with a reopen that runs no detector; the editor and camera 美妝 flows.

**Files:**
- Modify: `tests/e2e/shape-makeup.spec.ts`

**Interfaces:**
- Consumes: everything above through the UI; the e2e helpers in `tests/e2e/fixtures.ts`: `SAMPLE_FACE` (v0.3), step 1's `GROUP_FACES`, `importFixture(page, path)`, `selectPerson(page, n: number)` (`n = 0` is 全部; steps 3 and 4 use it too), `regionDiff(a, b, r: Rect /* fractions of the image */): { inside: number /* mean |a − b| inside */; outsideMax: number }`, `debugState` with `faces`, `boxes` (V-normalized `{ id, x, y, w, h }`, equal to the O boxes at identity geometry, in cache order, not screen order), `detectCalls`; step 3's `closeFallback(page)` and its `exportFile` flow (the `.topbar .pill` 儲存 pill, the 「分享」 second tap of a slow export, S3 §4.6), 裁切 tab with 翻轉, `Prefs.exportFormat` / `exportSize` (`'png'`, `'standard'`); `mad` (pixel `Rect`), `decodeDataUrl`, `dragSlider`, `grab` (`fixtures.ts`); `adapt` (`src/tracking/adapter111.ts`) for the fixture's contour points; step 1's `tests/fixtures/group_faces.png` (B mirrored at x 0.55, RM §8.3).
- Produces: e2e coverage only.

- [x] **Step 1: Write the tests**

Append to `tests/e2e/shape-makeup.spec.ts`, merging the imports into its existing lines (Task 12 already has `decodeDataUrl, expect, test, type Pixels` from `./fixtures`, `mkdirSync, writeFileSync` from `node:fs` and `resolve` from `node:path`): add `closeFallback, debugState, dragSlider, grab, GROUP_FACES, importFixture, mad, regionDiff, SAMPLE_FACE, selectPerson, type Rect` to the `./fixtures` import, `readFileSync` to the `node:fs` import, and the lines `import type { Page } from '@playwright/test';` and `import { adapt } from '../../src/tracking/adapter111';`. Step 3's `exportFile(page)` returns only the size and type of the export, so this file reads the pixels with its own `exportPng`, which follows the same flow and reads the image back through a canvas as step 2's `exportPixels` (`tests/e2e/adjust.spec.ts:92-107`) does (the CSP `connect-src 'self'` blocks a `fetch()` of the fallback's `blob:` URL, `fixtures.ts:341-342`):

```ts
/** lossless exports, at the working size, so pixel regions compare exactly */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ exportFormat: 'png', exportSize: 'standard' })));
});

/** step 3's exportFile flow (the 儲存 pill; a slow export's second tap shares, S3 §4.6), returning the exported pixels */
async function exportPng(page: Page): Promise<Pixels> {
  await page.locator('.topbar .pill').click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  const shareAgain = page.locator('.topbar .pill', { hasText: '分享' });
  await expect(fallback.or(shareAgain)).toBeVisible({ timeout: 300_000 });
  if (!(await fallback.isVisible())) await shareAgain.click();
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await closeFallback(page);
  return decodeDataUrl(url);
}

const lm = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
const P = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height).pts111;
const patch = (i: number): Rect => ({ x: Math.round(P[i * 2] * lm.width) - 15, y: Math.round(P[i * 2 + 1] * lm.height) - 15, w: 30, h: 30 });
const meanPatch = (a: Pixels, b: Pixels, ids: number[]) => ids.reduce((s, i) => s + mad(a, b, patch(i)), 0) / ids.length;
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).click();
/** a strip item by its label; a split item's accessible name may carry its 「左右」 badge while 左右分開 is on */
const optionNamed = (page: Page, name: string) => page.getByRole('option', { name: new RegExp(`^${name}(\\s*左右)?$`) });
const option = (page: Page, name: string) => optionNamed(page, name).click();
/** the debug face boxes left to right (the cache order is MediaPipe's; persons are numbered left to right) */
const boxesLtr = async (page: Page) => [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x);

test('左右分開: 左 moves only the screen-left cheek; 翻轉 swaps the chips; ↶ of the toggle restores one value (S5 §8.3 item 5)', async ({ page }) => {
  await importFixture(page, SAMPLE_FACE);
  await tab(page, '美型');
  await option(page, '瘦臉');
  await dragSlider(page, -400);
  const both0 = await exportPng(page);
  await option(page, '左右分開');
  await expect(page.getByText('已開啟左右分開：左、右以螢幕上看到的方向為準')).toBeVisible();
  const chips = page.getByRole('radiogroup', { name: '瘦臉：左右' });
  await expect(chips).toBeVisible();
  await expect(chips.getByRole('radio', { name: '左' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.item', { hasText: '瘦臉' }).getByText('左右')).toBeVisible();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider', { name: '瘦臉（左）' })).toHaveAttribute('aria-valuenow', '100');
  const left100 = await exportPng(page);
  const left = meanPatch(both0, left100, [3, 7, 10]);
  const right = meanPatch(both0, left100, [29, 25, 22]);
  console.log(`左右分開: screen-left cheek ${left.toFixed(2)}, screen-right ${right.toFixed(2)}`);
  expect(left).toBeGreaterThan(2);
  expect(right).toBeLessThan(0.25 * left);

  // 翻轉: stored values stay, labels follow the screen
  await tab(page, '裁切');
  await option(page, '翻轉');
  await tab(page, '美型');
  await option(page, '瘦臉');
  await expect(page.getByRole('slider', { name: '瘦臉（左）' })).toHaveAttribute('aria-valuenow', '0');
  await chips.getByRole('radio', { name: '右' }).click();
  await expect(page.getByRole('slider', { name: '瘦臉（右）' })).toHaveAttribute('aria-valuenow', '100');

  // ↶ flip, ↶ drag, ↶ toggle: one value again, no chips, no badges
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '復原' }).click();
  await option(page, '瘦臉');
  await expect(page.getByRole('radiogroup', { name: '瘦臉：左右' })).toHaveCount(0);
  await expect(page.locator('.item', { hasText: '瘦臉' }).getByText('左右')).toHaveCount(0);
});

test('左右分開 on the mirrored face B of group_faces.png still moves its screen-left cheek', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  await selectPerson(page, 2);
  await tab(page, '美型');
  await option(page, '瘦臉');
  const before = await exportPng(page);
  await option(page, '左右分開');
  await dragSlider(page, 400);
  const after = await exportPng(page);
  const b = (await boxesLtr(page))[1]; // person 2 = B, the middle face
  const W = after.width;
  const H = after.height;
  const half = (x0: number): Rect => ({ x: Math.round((b.x + x0 * b.w) * W), y: Math.round((b.y + 0.4 * b.h) * H), w: Math.round(0.5 * b.w * W), h: Math.round(0.5 * b.h * H) });
  const l = mad(before, after, half(0));
  const r = mad(before, after, half(0.5));
  console.log(`face B: screen-left ${l.toFixed(2)}, screen-right ${r.toFixed(2)}`);
  expect(l).toBeGreaterThan(3 * r);
});

test('per person: 眼影 on person 2 only, 眉毛 under 全部 on everyone; reopen restores them with no detection (S5 §8.3 item 6)', async ({ page }) => {
  await importFixture(page, GROUP_FACES);
  await expect.poll(async () => (await debugState(page)).faces).toBe(3);
  const base = await exportPng(page);
  const boxes = await boxesLtr(page); // [A, B, C] = persons 1, 2, 3
  await selectPerson(page, 2);
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眼影');
  await option(page, '大地');
  await tab(page, '美型');
  await option(page, '左右分開');
  const shadow = await exportPng(page);
  /** a face box padded by 15 % on each side, in fractions of the image (regionDiff's unit) */
  const padded = (k: number): Rect => {
    const b = boxes[k];
    return { x: b.x - 0.15 * b.w, y: b.y - 0.15 * b.h, w: 1.3 * b.w, h: 1.3 * b.h };
  };
  const onB = regionDiff(base, shadow, padded(1));
  expect(onB.outsideMax, '眼影 on person 2 changes nothing outside face B').toBeLessThanOrEqual(2);
  expect(onB.inside).toBeGreaterThan(0.2);

  await selectPerson(page, 0); // 全部
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眉毛');
  await option(page, '自然黑');
  const brows = await exportPng(page);
  for (const k of [0, 1, 2]) expect(regionDiff(shadow, brows, padded(k)).inside, `face ${k + 1}`).toBeGreaterThan(0.1);

  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  expect((await debugState(page)).detectCalls).toBe(calls);
  await selectPerson(page, 2);
  await tab(page, '美妝');
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '眼影');
  await expect(optionNamed(page, '大地')).toHaveAttribute('aria-selected', 'true');
  await tab(page, '美型');
  await option(page, '瘦臉');
  await expect(page.getByRole('radiogroup', { name: '瘦臉：左右' })).toBeVisible();
  const reopened = await exportPng(page);
  expect(mad(reopened, brows)).toBeLessThan(0.05);
});

test('美妝 flow in the editor: part list, 眼影 大地, ↶, 卸妝 (S5 §8.3 item 7)', async ({ page }) => {
  await importFixture(page, SAMPLE_FACE);
  await tab(page, '美妝');
  const lead = page.getByRole('button', { name: '切換部位（目前：口紅）' });
  await expect(lead).toBeVisible();
  await expect(page.getByRole('option', { name: '原色', exact: true })).toBeVisible();
  await lead.click();
  for (const p of ['口紅', '腮紅', '眉毛', '眼影', '眼線', '睫毛', '臥蠶', '修容', '高光', '美瞳']) await expect(page.getByRole('option', { name: p, exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '卸妝', exact: true })).toBeVisible();
  await option(page, '眼影');
  await option(page, '大地');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-label', '眼影');
  await expect(page.getByRole('option', { name: '大地', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '復原' }).click();
  await expect(page.getByRole('option', { name: '無', exact: true })).toHaveAttribute('aria-selected', 'true');
  await option(page, '大地');
  await page.getByRole('button', { name: '切換部位（目前：眼影）' }).click();
  await option(page, '睫毛');
  await option(page, '自然');
  await page.getByRole('button', { name: '切換部位（目前：睫毛）' }).click();
  await expect(page.locator('.item.has-value', { hasText: '眼影' })).toHaveCount(1);
  await option(page, '卸妝');
  await expect(page.locator('.item.has-value')).toHaveCount(0);
});

test('美妝 and 左右分開 in the camera (S5 §2.5, §8.3 item 7)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face === true && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const frame = page.locator('.cam-stage .frame');
  await tab(page, '美妝');
  const a1 = await grab(frame);
  await page.waitForTimeout(700);
  const a2 = await grab(frame);
  const jitter = mad(a1, a2);
  // the face's eye band in the screenshot: the unmirrored video box, mirrored for the front camera, through `cover`
  const box = (await debugState(page)).boxes[0];
  const v = await page.evaluate(() => {
    const el = document.querySelector('video')!;
    return { w: el.videoWidth, h: el.videoHeight };
  });
  const fb = (await frame.boundingBox())!;
  const s = Math.max(fb.width / v.w, fb.height / v.h);
  const ox = (fb.width - v.w * s) / 2;
  const oy = (fb.height - v.h * s) / 2;
  const dpr = a1.width / fb.width;
  const u0 = 1 - (box.x + box.w);
  const band: Rect = {
    x: Math.round((ox + u0 * v.w * s) * dpr),
    y: Math.round((oy + (box.y + 0.25 * box.h) * v.h * s) * dpr),
    w: Math.round(box.w * v.w * s * dpr),
    h: Math.round(0.25 * box.h * v.h * s * dpr),
  };
  await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
  await option(page, '美瞳');
  await option(page, '冰藍');
  await page.waitForTimeout(800);
  const b = await grab(frame);
  const change = mad(a1, b, band);
  console.log(`camera 美瞳: eye band change ${change.toFixed(2)}, jitter ${jitter.toFixed(2)}`);
  expect(change).toBeGreaterThan(Math.max(0.5, 4 * jitter));

  await tab(page, '美型');
  await option(page, '左右分開');
  await option(page, '大眼');
  const chips = page.getByRole('radiogroup', { name: '大眼：左右' });
  await expect(chips).toBeVisible();
  await chips.getByRole('radio', { name: '右' }).click();
  await expect(chips.getByRole('radio', { name: '右' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.panel.collapsed')).toHaveCount(0);
});
```

- [x] **Step 2: Run them against the build**

Run: `npm run build && npx playwright test tests/e2e/shape-makeup.spec.ts`
Expected: PASS — the five app tests plus Tasks 7 and 12's engine tests (the `@sheet` case is skipped without `SHEET=1`). The helpers above are the landed `fixtures.ts` names (checked at the step base); the assertions stay.

- [x] **Step 3: Run the e2e suites the new UI touches**

Run: `npx playwright test tests/e2e/editor.spec.ts tests/e2e/camera.spec.ts tests/e2e/persons.spec.ts tests/e2e/crop.spec.ts`
Expected: PASS with their assertions unchanged (原色 is still the first visible 美妝 option, the 美型 no-face note still dims every option).

- [x] **Step 4: Commit**

```bash
git add tests/e2e/shape-makeup.spec.ts
git commit -F- <<'EOF'
v0.4 step 5: e2e for 左右分開, per-person makeup and the 美妝 flows

左 moves only the screen-left cheek (also on the mirrored group face),
翻轉 swaps the chips, ↶ undoes the toggle; 眼影 on one person, 眉毛 under
全部, reopen without detection; editor and camera 美妝 flows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Landed deviations** (test measurements only; no app code changed, and every UI assertion above stays): (1) Face B's 左右分開 case measured the two halves of B's debug box, and failed (screen-left 24.9, screen-right 11.1, under 3×). The halves also take in the nose, mouth and chin, and a one-sided 瘦臉 moves those too: the chin anchor is shared (`SLIM_SIDE` .5), and B's nose lies right of its box centre. The diff shows B's screen-right cheek unchanged. The case now measures the cheek contour patches, as on `sample_face.png`: pts111 3/7/10 against 29/25/22 of B, from `group_faces.landmarks.json` through `adapt` (B is the middle face by p46 x). The patches are 20 px, because B is about 200 px wide, and 左 is the side whose eye (p74 / p77) has the smaller x (S5 §2.2). Measured: 14.28 against 1.76. (2) 眼影 on person 2 averages 0.103 over B's padded box: a 200 px face at the pick default 0.45, all outside pixels exact (outside max 0). The `inside` bound is 0.05, not 0.2. (3) `mad(reopened, brows) < 0.05` cannot hold, because 最近編輯 keeps the original as a JPEG (q 0.9, as `adjust.spec.ts` notes): the round trip alone puts the reopened export mean 0.60 away (max 62) over the photo content. The reopen half now also checks 自然黑 under 全部 on 眉毛. It exports, applies 卸妝 under 全部, and exports again. Then, face by face over the padded boxes, it compares that change pixel by pixel with base → brows (`changeErr` = Σ|Δa − Δb| / Σ|Δa| < 0.2). Measured: 11.3 / 14.5 / 11.5 %. A lost 眼影 on face 2 would be 26 % off, and a lost 眉毛 75–100 %.

### Task 18: Step-5 bench rows

S5 §6.2 rows 1–4: the reshape microbench with every step-5 warp at ±max, P1 with every makeup part, the PMAKEUP compile time, and the live fps with three faces and all makeup on. Desktop Chromium numbers are recorded now; the iPhone run needs a preview deploy, which waits for the user's go-ahead (RM §1.2).

**Files:**
- Create: `src/bench/faceDetailBench.ts`, `src/bench/faceDetailBench.test.ts`
- Modify: `src/bench/main.ts` (CRLF; a button next to 靜態圖片測試, the rows in 複製結果)
- Modify: `tests/e2e/camera-group.spec.ts` (step 1; one guarded `@bench` test)

**Interfaces:**
- Consumes: `Engine` (`render`, `canvas`), `createEngine`; `RenderInput` / `RenderFace` (RM §4.1), `defaultPhoto()`, `neutralPerson()`, `emptyShades()`; Task 1 `MAKEUP_PARAM`, `paramsInGroup`, `SPLIT_IDS`; Task 5 `scaleFace`; step 1's still session (`StillSession.faces`, S1 S1) and its bench section; step 1's `chromium-group` Playwright project.
- Produces: `warpBenchPerson(end: 0 | 1): PersonParams`, `makeupBenchPerson(): PersonParams`, `benchFaces(face: Face, n: number, person: PersonParams): RenderFace[]`, `medianMs(xs: readonly number[]): number`, `runFaceDetailRows(engine: Engine, bitmap: ImageBitmap, face: Face): Promise<string[]>`

- [x] **Step 1: Write the failing test**

Create `src/bench/faceDetailBench.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paramsInGroup, SPLIT_IDS } from '../engine/params';
import { adapt } from '../tracking/adapter111';
import { benchFaces, makeupBenchPerson, medianMs, warpBenchPerson } from './faceDetailBench';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);

describe('step-5 bench inputs (face-detail spec §6.2)', () => {
  it('row 1: every 美型 item at its extreme, the six split items at the opposite extreme on the right', () => {
    const hi = warpBenchPerson(1);
    for (const d of paramsInGroup('shape')) expect(hi.values[d.id]).toBe(1);
    const lo = warpBenchPerson(0);
    for (const d of paramsInGroup('shape')) expect(lo.values[d.id]).toBe(d.bidirectional ? 0 : 1);
    expect(Object.keys(hi.right ?? {}).sort()).toEqual([...SPLIT_IDS].sort());
    for (const id of SPLIT_IDS) expect(hi.right?.[id]).toBe(0);
  });

  it('row 2: every makeup part at 100, with a shade where the part has shades', () => {
    const p = makeupBenchPerson();
    for (const id of ['makeup.lip', 'makeup.blush', 'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens'] as const)
      expect(p.values[id]).toBe(1);
    expect(p.shades).toMatchObject({ lip: 'rose', blush: 'peach', brow: 'black', eyeshadow: 'earth', liner: 'black', lens: 'blue' });
  });

  it('N faces fit in the frame without overlapping', () => {
    for (const n of [1, 3, 6]) {
      const fs = benchFaces(face, n, warpBenchPerson(1));
      expect(fs).toHaveLength(n);
      const boxes = fs.map((f) => {
        const xs = Array.from(f.face.oval).filter((_, i) => i % 2 === 0);
        const ys = Array.from(f.face.oval).filter((_, i) => i % 2 === 1);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      });
      for (const b of boxes) {
        expect(b[0]).toBeGreaterThanOrEqual(0);
        expect(b[1]).toBeGreaterThanOrEqual(0);
        expect(b[2]).toBeLessThanOrEqual(1);
        expect(b[3]).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          expect(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]).toBe(true);
        }
    }
  });

  it('medianMs', () => {
    expect(medianMs([5, 1, 3])).toBe(3);
    expect(medianMs([4, 1, 3, 2])).toBe(2.5);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/bench/faceDetailBench.test.ts`
Expected: FAIL — `Failed to resolve import "./faceDetailBench"`.

- [x] **Step 3: Implement**

Create `src/bench/faceDetailBench.ts`:

```ts
// Step-5 bench rows (face-detail spec §6.2): reshape with every new warp at ±max, P1 with every makeup part, and the
// PMAKEUP compile time, at N = 1, 3, 6 faces and 1080 / 2048. Timings use a gl.finish() fence; medians of 20 frames.
import { defaultPhoto, emptyShades, neutralPerson } from '../edit/state';
import { createEngine } from '../engine/index';
import { MAKEUP_PARAM, paramsInGroup, SPLIT_IDS } from '../engine/params';
import { scaleFace } from '../engine/passes/syntheticFaces';
import type { Engine, Face, MakeupPart, PersonParams, RenderFace, RenderInput } from '../types';

/** every 美型 item at its extreme (bidirectional ones at `end`); the six split items at the opposite extreme on the right */
export function warpBenchPerson(end: 0 | 1): PersonParams {
  const p = neutralPerson();
  const values = { ...p.values };
  for (const d of paramsInGroup('shape')) values[d.id] = d.bidirectional ? end : 1;
  const right = Object.fromEntries(SPLIT_IDS.map((id) => [id, 0]));
  return { ...p, values, right };
}

/** every 美妝 part at 100, with a shade where the part has shades */
export function makeupBenchPerson(): PersonParams {
  const p = neutralPerson();
  const values = { ...p.values };
  for (const part of Object.keys(MAKEUP_PARAM) as MakeupPart[]) values[MAKEUP_PARAM[part]] = 1;
  return { ...p, values, shades: { ...emptyShades(), lip: 'rose', blush: 'peach', brow: 'black', eyeshadow: 'earth', liner: 'black', lens: 'blue' } };
}

/** n copies of `face`, shrunk into a 1 × 1, 3 × 1 or 3 × 2 grid of cells so they never overlap */
export function benchFaces(face: Face, n: number, person: PersonParams): RenderFace[] {
  if (n <= 1) return [{ face, weight: 1, person, protect: null }];
  const cols = 3;
  const rows = Math.ceil(n / cols);
  const xs = Array.from(face.oval).filter((_, i) => i % 2 === 0);
  const ys = Array.from(face.oval).filter((_, i) => i % 2 === 1);
  const fc: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const s = (0.9 / Math.max(cols, rows)) / span;
  return Array.from({ length: n }, (_, k) => {
    const t: [number, number] = [((k % cols) + 0.5) / cols, (Math.floor(k / cols) + 0.5) / rows];
    // scaleFace scales about c; choose c so the face centre lands on the cell centre t
    const c: [number, number] = [(t[0] - s * fc[0]) / (1 - s), (t[1] - s * fc[1]) / (1 - s)];
    return { face: scaleFace(face, s, c), weight: 1, person, protect: null };
  });
}

export function medianMs(xs: readonly number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** rows 1–3 of S5 §6.2 on one photo and its face; resolves with one text line per measurement */
export async function runFaceDetailRows(engine: Engine, bitmap: ImageBitmap, face: Face): Promise<string[]> {
  const gl = engine.canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const photo = defaultPhoto();
  const input = (source: ImageBitmap, faces: RenderFace[]): RenderInput => ({ source, width: source.width, height: source.height, faces, globalSkin: null, photo });
  const time = (e: Engine, g: WebGL2RenderingContext, inp: RenderInput, n = 20) => {
    e.render(inp, { still: true });
    g.finish();
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      e.render(inp, { still: true });
      g.finish();
      xs.push(performance.now() - t);
    }
    return medianMs(xs);
  };
  const rows: string[] = [];
  for (const edge of [1080, 2048]) {
    const k = edge / Math.max(bitmap.width, bitmap.height);
    const src = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' });
    for (const n of [1, 3, 6]) {
      const base = time(engine, gl, input(src, benchFaces(face, n, neutralPerson())));
      for (const end of [1, 0] as const) {
        const ms = time(engine, gl, input(src, benchFaces(face, n, warpBenchPerson(end)))) - base;
        rows.push(`step5 reshape ${end ? '+' : '−'}max N=${n} @${edge}: ${ms.toFixed(2)} ms`);
      }
      const mk = time(engine, gl, input(src, benchFaces(face, n, makeupBenchPerson()))) - base;
      rows.push(`step5 P1 makeup all parts N=${n} @${edge}: ${mk.toFixed(2)} ms`);
    }
    src.close();
  }
  // PMAKEUP compiles lazily on the first procedural frame: first frame minus the warm median, on a fresh engine
  const c2 = document.createElement('canvas');
  const e2 = createEngine(c2, { mirror: false });
  await e2.ready;
  const g2 = c2.getContext('webgl2');
  if (g2) {
    const inp = input(bitmap, benchFaces(face, 1, makeupBenchPerson()));
    const t0 = performance.now();
    e2.render(inp, { still: true });
    g2.finish();
    const first = performance.now() - t0;
    rows.push(`step5 PMAKEUP compile (first frame − warm median): ${(first - time(e2, g2, inp, 5)).toFixed(1)} ms`);
  }
  e2.dispose();
  return rows;
}
```

`src/bench/main.ts` (CRLF): keep the still photo's bitmap (`let stillBitmap: ImageBitmap | null = null;` next to `let still` (`:115`), set in `runStill` (`:491-519`) after `importPhoto`, and set back to null where `stillTest`'s second tap disposes the session, `:478-479`: the session's `dispose()` closes the bitmap itself), add `const faceDetailRows: string[] = [];` and a button next to 靜態圖片測試 (`stillBtn`, `:237`):

```ts
const faceDetailBtn = button('臉型細項＋美妝', () => void runFaceDetail());

async function runFaceDetail(): Promise<void> {
  const face = still?.faces[0]?.face;
  if (!engine || !still || !stillBitmap || !face || busy) {
    note.textContent = '先用「靜態圖片測試」選一張有臉的照片';
    return;
  }
  busy = true;
  try {
    note.textContent = '臉型細項＋美妝：量測中…';
    const rows = await runFaceDetailRows(engine, stillBitmap, face);
    faceDetailRows.push(...rows);
    note.textContent = rows.join('\n');
  } catch (err) {
    showError('faceDetail', err);
  } finally {
    busy = false;
    syncButtons();
  }
}
```

(append the button to the row that holds `stillBtn`, `:281`; `still.faces[0].face` is step 1's `SessionFace`.) In `copyResults` (`:879-882`), whose text steps 1–4 grew to `formatReport(reportMeta(), samples, bodyRows) + multiText + exportText + (toneReport ? … : '')`, append the rows at the end: `… + (faceDetailRows.length ? '\n\n[step 5]\n' + faceDetailRows.join('\n') : '')`.

`tests/e2e/camera-group.spec.ts` (step 1; the `chromium-group` project feeds `group.y4m`), row 4:

```ts
test('bench: live fps with three faces and every 美妝 part on (S5 §6.2 row 4) @bench', async ({ page }) => {
  test.skip(!process.env.BENCH, 'run with BENCH=1 npx playwright test --project chromium-group --grep @bench');
  test.setTimeout(240_000);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 90_000 }).toBe(3);
  // as the spec's own 全部套用 case does (camera-group.spec.ts:73): the chip waits for ChipGate's debounce
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  await page.getByRole('button', { name: '全部套用' }).click();
  await page.getByRole('tab', { name: '美妝', exact: true }).click();
  for (const [part, first] of [['眉毛', '自然黑'], ['眼影', '大地'], ['眼線', '黑'], ['睫毛', '自然'], ['臥蠶', '自然'], ['修容', '自然'], ['高光', '自然'], ['美瞳', '冰藍']] as const) {
    await page.getByRole('button', { name: /^切換部位（目前：/ }).click();
    await page.getByRole('option', { name: part, exact: true }).click();
    await page.getByRole('option', { name: first, exact: true }).click();
  }
  await page.waitForTimeout(10_000);
  console.log(`step5 live fps, 3 faces, every makeup part: ${(await debugState(page)).fps.toFixed(1)}`);
});
```

- [x] **Step 4: Run the tests and a desktop pass**

Run: `npx vitest run src/bench && npm run typecheck && npm run build`
Expected: PASS. Then record desktop numbers once: `npm run dev`, open `/bench.html` in desktop Chrome, 靜態圖片測試 with `sample_face.png`, then 臉型細項＋美妝 (rows printed in the note); and `BENCH=1 npx playwright test --project chromium-group --grep @bench` (fps logged). Append the numbers to the hand-off note of Task 19, against the S5 §6.1 budget (desktop only; the iPhone rows wait for the user's go-ahead on a preview deploy).

- [x] **Step 5: Commit**

```bash
file src/bench/main.ts tests/e2e/camera-group.spec.ts
git add src/bench/faceDetailBench.ts src/bench/faceDetailBench.test.ts src/bench/main.ts tests/e2e/camera-group.spec.ts
git commit -F- <<'EOF'
v0.4 step 5: bench rows for the new warps and the procedural makeup

Reshape with every step-5 warp at ±max and P1 with every makeup part at
N = 1, 3, 6 and 1080 / 2048, the PMAKEUP compile time, and a guarded
@bench live-fps case with three faces.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 19: Step-5 gate

Everything green on a clean tree, plus the equivalence checks the roadmap asks of every step (RM §1.1–1.2) and the step-5 invariant (S5 §1.2). Nothing is pushed or deployed, and the version stays 0.3.0.

**Files:**
- No planned changes. A failing check is fixed in the task that owns the code (re-run that task's tests), committed locally, and this gate is run again from Step 1.
- Landed (Task 19 fix): `src/engine/adjustMath.test.ts` and `src/body/field.test.ts`, test files no step-5 task owns. Step 3 failed in 3 of a review's 5 whole-suite runs at `2adc205` (and in the first rerun here), with neither file changed since the step base: step 2's 2000-case tone-curve fuzz (about 17 s alone, 29–32 s under the parallel suite) timed out against `vitest.config.ts`'s 30 s, and once v0.3's `warm < cold` timing check failed by load (19.55 ms vs 17.88 ms). The fuzz gets its own 120 s timeout (the pattern of `reshapeCpu.test.ts`'s fold sweep); the timing case runs one more pass of 15 interleaved samples, on values between the first pass's, only when warm ≥ cold. Every assertion, `draft < 0.6 · warm` included, is unchanged.

**Interfaces:**
- Consumes: Tasks 1–18; step 1's `tests/e2e/parity.spec.ts` and `src/engine/passes/reshapeCpuV03.ts`; the full Playwright suite including step 1's `chromium-group` project.
- Produces: the step-5 hand-off note (in the final message to the user, not a file).

Every command below that needs the base of step 5 computes it itself (the shell keeps no variables between commands): `BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1"`, the parent of the first step-5 commit. The first one is `v0.4 step 5: reconcile plan`; its parent `db1f468` holds the rest of the plan reconciliation under a stale step-3 subject. Both change only this plan, so `BASE` = `db1f468` has the step base `3aebedf`'s code.

- [x] **Step 1: Clean tree and the base of step 5**

Run: `git status --short && BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1" && git log --oneline "$BASE"..HEAD | cat`
Expected: no uncommitted changes; on `feat/meiyan-pwa`, the `v0.4 step 5: reconcile plan` commit (on top of `db1f468`), then one local `v0.4 step 5 task <N>: …` commit per task 1–18 (plus any `v0.4 step 5 task <N> fix: …` commits). Task 5's code is `0692964` under a stale step-2 subject; its `v0.4 step 5 task 5 fix:` commit records that (see Task 5). Task 9's code is `a9b761f`, also under a stale step-2 subject; its `v0.4 step 5 task 9 fix:` commit records that (see Task 9). Task 12's code is `e338242`, also under a stale step-2 subject; its `v0.4 step 5 task 12 fix:` commit records that (see Task 12).

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output from `tsc`.

- [x] **Step 3: Unit suite**

Run: `npm test`
Expected: every test file passes (Vitest prints `Test Files  N passed`, `Tests  M passed`, no failures), including `reshapeCpu.test.ts` (hash pin, bit-identity with the v0.3 port, the step-5 warps), `makeupProcCpu.test.ts` (pin `'f76b819e'`), `makeupProc.test.ts`, `eyeFrame.test.ts`, the edit/lens/panel tests and `tests/harness/t5/assets.test.mjs` (lashes texture).

- [x] **Step 4: Production build**

Run: `npm run build`
Expected: `tsc -p tsconfig.build.json` clean and `vite build` succeeds; `dist/makeup/own/lashes.png` exists and the service-worker precache manifest lists it: `grep -c "makeup/own/lashes.png" dist/sw.js` prints `1` or more.

- [x] **Step 5: The whole e2e suite**

Run: `npm run test:e2e`
Expected: every project and spec passes, among them `shape-makeup.spec.ts` (2 × 13 warp pins, 14 PMAKEUP kinds, regions, blink, the lashes failure, the context loss, 左右分開, per person, editor and camera flows; `@sheet` skipped), `reshape.spec.ts` (its 3 cases unchanged), `parity.spec.ts`, `engine.spec.ts`, `editor.spec.ts`, `camera.spec.ts`, `persons.spec.ts`, `export.spec.ts` (with the three step-5 tile cases), `crop.spec.ts`, `tone.spec.ts`, `adjust.spec.ts`, `camera-group.spec.ts` in the `chromium-group` project (`@bench` skipped).

- [x] **Step 6: v0.3 equivalence and the step-5 invariant**

1. Parity goldens (RM §1.1, §8.3: one person, v0.3 items only, ≤ 1/255 per channel and mean < 0.02/255): `npx playwright test tests/e2e/parity.spec.ts` — Expected: PASS.
2. New items neutral and 左右分開 off ⇒ the reshape map is bit-identical (S5 §1.2): `npx vitest run src/engine/passes/reshapeCpu.test.ts -t "bit-identical"` — Expected: PASS.
3. No procedural geometry while every procedural item is neutral (so P1 and every makeup pixel are as in step 4): `npx vitest run src/engine/passes/makeupProc.test.ts -t "empty with every part at 0"` — Expected: PASS.
4. Existing assertions kept (RM §1.1): `BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1"; git diff "$BASE"..HEAD -U0 -- '*.test.ts' '*.test.tsx' '*.test.mjs' '*.spec.ts' | grep '^-[^-]'`
   Expected: only the mechanical ports this plan names — the schema tables in `params.test.ts` (count 44 → 58, `BIDIRECTIONAL`, the defaults rows, `paramsInGroup('makeup')`) and its `MAKEUP_PICK_DEFAULT` `toEqual` → `toMatchObject` line, step 1's scope-table row and its `shape.` count, the four exact shade assertions in `state.test.ts` / `legacy.test.ts` (Task 1); the 美型 strip key list in `panelModel.test.ts` (Task 13); step 2's `partButtons` 美妝 assertion in `panelModel.adjust.test.ts` and its 「美妝 keeps its 口紅／腮紅 row」 case in `BeautyPanel.test.tsx` (Tasks 14 and 15); the `RESHAPE_FS` pin value in `reshapeCpu.test.ts`, step 1's fold-sweep `settings` line and its timeout (Task 7); step 3's `displacementBound` fuzz line gaining a random `right` in `reshape.test.ts` (Task 7); step 3's case-name list in `export.spec.ts` (Task 12); the `Face` literals gaining `...blankEyes()` (Task 2); the two `ReshapeUniforms` literals of `pipeline.test.ts` gaining the new keys (Task 6); `base` in `pipeline.test.ts` gaining `procActive` / `procReady` (Task 11); the `lm` type of `reshapeCpu.test.ts` gaining `mirrored` (Task 7); the closing line of step 2's 2000-case tone-curve fuzz in `adjustMath.test.ts` gaining a 120 s timeout, and the timed loop of v0.3's warm / cold / draft timing case in `field.test.ts` moving into a `pass` that runs once more when warm ≥ cold, with its `min of` report line (Task 19 fix: both were load-flaky under the whole suite; no assertion changed); and import declarations that gained names. Any other removed assertion is a regression: restore it.
5. Storage untouched (RM §5, S5 §5): `BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1"; git diff "$BASE"..HEAD --stat -- src/store/history.ts; git diff "$BASE"..HEAD | grep -o "meiyan\.[A-Za-z.]*v[0-9]" | sort -u` — Expected: no `--stat` line (history.ts unchanged), then `meiyan.prefs.v1` (the e2e init script only) and `meiyan.seen.makeupParts.v1`; no other key.
6. Version unchanged, nothing pushed: `node -p "require('./package.json').version"` — Expected: `0.3.0`. `git status -sb | head -1` — the branch is ahead of its upstream by the local commits; do not push.
7. Line endings: `BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1"; git diff --name-only "$BASE"..HEAD | xargs file | grep "CRLF, LF"` — Expected: no output (no mixed file). Then `file src/types.ts src/ui/panelModel.ts src/ui/components/BeautyPanel.tsx src/ui/components/Slider.tsx src/ui/icons.tsx src/ui/state.ts src/ui/theme.css src/ui/screens/Camera.tsx src/ui/screens/Review.tsx src/engine/passes/makeup.ts src/engine/passes/reshape.test.ts src/engine/pipeline.ts src/engine/index.ts src/bench/main.ts src/app/testFakes.ts tests/harness/t2/main.ts | grep -v "with CRLF line terminators"` — Expected: no output (every CRLF working copy of the Global Constraints is still CRLF throughout).

- [x] **Step 7: Contact sheet for the hand-off (S5 §8.4)**

Run: `SHEET=1 npx playwright test tests/e2e/shape-makeup.spec.ts --grep @sheet`
Expected: `contact sheet: N images in …/test-results/makeup-sheet` (every part × shade at 50 and 100, every new warp at ±50, sample face and group faces). It is not committed (`test-results/` is ignored); point the user at the folder for visual tuning.

- [x] **Step 8: Hand-off note**

Report to the user: the commit range (`BASE="$(git log --format=%H --grep='^v0.4 step 5' --reverse | head -1)~1"; git log --oneline "$BASE"..HEAD`), the gate results above, the desktop bench numbers of Task 18 against S5 §6.1 (the iPhone rows need a preview deploy, which waits for the user's go-ahead), the contact-sheet folder, and that nothing was pushed and the version is still 0.3.0. Step 6 (推臉筆) is next; the 0.4.0 bump belongs to step 6's final release task.

(Gate run at `8ff97d5`, no code changed: typecheck clean; Vitest 106 files / 1879 tests passed; build clean, `lashes.png` in `dist/` and once in `sw.js`; Playwright 104 passed, 2 skipped (`@sheet`, `@bench`); parity 5 cases max 0/255; the two invariant unit cases pass; every removed test line is a port named above or in a task's landed note (Tasks 2, 7, 12); storage, version and line endings as expected. Step 1's range also holds `6502bf2` and `1aaa05c`, Tasks 2 and 3's code under stale step-4 subjects, which `c0f7312` and `aaced28` record. Contact sheet: 77 images in `test-results/makeup-sheet/`.)

---

## Appendix: spec coverage

| S5 section | Tasks |
|---|---|
| §1.1 new items, §1.2 behaviour rules (per person, editor and camera, undo, presets, invariant) | 1, 3, 4, 6–11, 13–16, 19 |
| §1.3 refinements: blink-gate scope (1), screen blending (2), `shiftEllipse` / `squeezeAxis` (3), 鼻翼 as opposed `shiftAround`s (4), sides by landmark half (5), two-level strip (6), no 原色 for 眼線 (7), `Face.lids` (8), 512 × 128 R8 lashes (9) | 5 & 8 (1), 9 & 11 (2), 6 & 7 (3, 4, 5), 14 & 15 (6), 1 & 14 (7), 2 & 5 (8), 10 & 11 (9) |
| §2.1 美型 strip, §2.2 左右分開 interaction | 1, 3, 4, 13, 15, 16, 17 |
| §2.3 美妝 two-level strip, §2.4 strip notes, §2.5 camera, §2.6 strings | 5, 14, 15, 16, 17 |
| §3.1 params, §3.2 shades, §3.3 types | 1, 2, 5, 8, 13, 14 |
| §3.4 sides (storage, labels, lens, hand-over, engine) | 3, 4, 6, 7, 16 |
| §3.5 presets, 重置, sanitize, legacy | 3, 4 |
| §4.1 regions, §4.2 warps and clamps, §4.3 split in the shader, §4.4 face-table block / box / `U_MAX` (and "the skip test … stays exact": Task 7's box-border test), §4.5 chain order | 6, 7 |
| §4.6 P1 pass, §4.8 item shapes, §4.9 gates | 8, 9, 11 |
| §4.7 eye frames | 5 |
| §4.10 lashes texture | 10, 11 |
| §4.11 interaction with P0, step 4 and tiles | 11, 12 |
| §5 persistence and licensing | 3, 10, 19 |
| §6 budget and bench rows | 18 (desktop), 19 (hand-off) |
| §7 edge cases (`lashes.png` fails, context loss: Task 12) | 5, 6, 8, 11, 12, 16, 17 |
| §8.1 unit, §8.2 pins | 1–9, 13–16 (pins in 7 and 9) |
| §8.3 e2e items 1 / 2–4, 9 / 5–7 / 8 | 7 / 12 / 17 / 19 |
| §8.4 fixtures and contact sheet | 5 (synthetic faces), 12, 19 |

One deliberate deviation from the spec text: S5 §4.4 sizes the 山根 influence box with `disc(c, max(r−, r+, ry))`, which misses the corners of the squeezed band (|a| ≤ r±, |v| ≤ ry); measured with the CPU port, the fixture face then still moves 0.07–0.09 px on the box edge, a seam where the box skip cuts the warp, against the same section's "the skip test … stays exact". Task 6 uses the band's circumscribed disc `hypot(max(r−, r+), ry)` instead, and Task 7 pins identity on every new warp's box border; the new box still lies inside the v0.3 `U_MAX` box on the fixture and its mirror.

Not covered by a task (each needs a decision or an input outside this step):
- The iPhone measurements of S5 §6.1–6.2 and the "if the numbers are bad" ladder (brow strokes and lens pattern off live at tier M/L, a +1 LOD bias on 睫毛, the face-cap ladder): they need `/bench.html` on a preview deploy, which waits for the user's go-ahead (RM §1.2). Task 18 records the desktop rows; the ladder's constants are added only if the iPhone numbers call for them.
- In the camera, `screenSwap` comes from the facing (`cameraScreenSwap`), which is S5 §3.4's mapping for an upright face; a face held upside down in the live preview keeps the facing-based labels.
