# v0.4 Step 6: 推臉筆＋恢復筆 (manual liquify) and the 0.4.0 release, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 推臉筆 / 恢復筆 manual liquify brush to 美型 and 美體 (strokes stored with the photo, one undo step per stroke, outermost backward map of P2), then release Mona Misa 美顏 0.4.0.

**Architecture:** Strokes are pure data (`PhotoParams.strokes`, O-frame points resampled at radius/4). A per-photo CPU `LiquifyModel` (`src/edit/liquify.ts`) rasterizes them into a 512-long-edge RG backward field with composing push stamps, scaling restore stamps and a per-stamp minimum-Jacobian guard; it keeps copy-on-write tile patches for fast undo and replays deterministically on reopen. The field is uploaded as RG16F and sampled first in RESHAPE_FS (`tc = o + L(o)`, then the body field at `tc`), so the source is still resampled once. A pure gesture reducer inside zoomPan decides draw versus pinch; a rAF queue feeds the live stroke without React state.

**Tech Stack:** TypeScript 5.9 (strict), Preact 10, WebGL2 (RG16F, `texture()` filtering), Vitest 5 (node environment), Playwright 1.63 (Chromium, SwiftShader, mobile viewport 393 × 852 @3x).

**Spec:** `docs/superpowers/specs/2026-10-12-push-brush-design.md` (called **PB** below) and the contract `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (**C**; status accepted, every §12 default adopted: #40 no 背景保護 on strokes, #41 恢復 only reverts strokes, #42 gain ¾ and no 力度 slider, #43 radii 16/28/44 px). Names consumed from steps 1–5 come from `2026-10-12-face-person-select-design.md` (**PS**), `2026-10-12-crop-and-fullres-export-design.md` (**CR**), `2026-10-12-skin-cleanup-tools-design.md` (**SK**) and `2026-10-12-face-detail-and-makeup-design.md` (**FD**).

## Reconciliation (step 6)

Checked against the code at the step base `d09e608` (steps 1–5 committed with their fixes); no code was changed. Every consumed name exists as the plan uses it unless an item below says otherwise, every file in the Global Constraints' CRLF / LF lists still has those line endings (`git ls-files --eol`), and nothing of step 6 exists yet (no `Stroke`, `liquify` or `brush*` name or file). These edits were made:

- **Anchors:** where a task needed one, its **Files** line or step now cites the `d09e608` line ("at `d09e608`"). The other `file:N` anchors are still v0.3's (`892ea61`): locate those by the name given, as the Global Constraints say.
- **Base:** the step base is `d09e608`. The `v0.4 step 6: reconcile plan` commit on top of it changes only this plan, so `STEP6_BASE` (`git rev-parse HEAD` before Task 1) has the step base's code.
- **Task 3:** step 3 moved `oSize` into `sanitizePhoto(raw, persons, oSize)`, so the strokes are sanitized in its literal (`r.strokes`), and `sanitizeEditState` needs no change of its own. `openState` re-validates only the geometry on the v2 paths that hand the stored edit back (no cache, a dropped one); the strokes are re-sanitized there too, or the migrate test 「drops only the corrupt record」 (an entry without a cache) keeps the corrupt record. `normalizeEntry` already passes `{ width, height }` (step 3, `history.ts:214`), so `history.ts` is unchanged. `splitLegacy`'s photo literal (`src/edit/legacy.ts:16`) gains `strokes: []`.
- **Task 4:** the protect unit's uniform is `uProtArr`; `reshapeCpu.ts` already defines `f16` (`:67`), which `liquifyAt` reuses; the hash pin is the `PINNED` constant (`reshapeCpu.test.ts:19`).
- **Task 5:** `run` plans through step 1's `planFrame(job, makeupReady, bodyOn, proc)`, which gains a fifth parameter `liquifyOn = false` that it forwards to `planPasses`. The `index.test.ts` 美體 block's `lastJob` / `input` are local to it: the new block declares its own copies.
- **Task 6:** `StillFrame` lives in `src/types.ts:570` (CRLF), which this task edits; `still.test.ts` already imports `defaultPhoto` and `StillFrame`; the t7 harness's `fakeStill` (`tests/harness/t7/fakes.ts`) gains `liquify` / `setLiquify`, or `typecheck` fails.
- **Task 7:** the entry point uses the page's `context()`, `floatTex()` and `rig()` helpers, as `runReshapePinView` does.
- **Task 11:** `sliderFor`'s shared case reads `const id = sel[sel.tab]`, and its `'body'` case gates with `bodyItemGate(lens, body, sel.body)`.
- **Task 12:** the Editor has no StillFrame ref: `frameOf(e, s)` builds the frame, and `planFor`, `encode`, `runWorking` and `runTiled` take the `EditState`. The encode effect's guard uses `exportBusy`, `save`'s guard is `if (!session || lost) return;`, and `setSel` keeps its `setDragging(false)`. `runTiled`'s working-size fallback passes `liq` on (which also keeps `noUnusedParameters` green before Task 13). Removing `body.spec.ts`'s `emptyPng` also removes its `PNG` import, and `darkestRow` moves to Task 14, its first user (`noUnusedLocals`). The `.editor-panel` snippet shows the landed `SpotControls` / `SliderRow` props.
- **Task 13:** the person tap maps `apply(vToO(g, photo), uv)` inline; the snippet now spells that out. `tapSpot` passes `geometry: shown`; `planFor` calls `s.bounds(frameOf(e, s), field, …)`.
- **Task 14:** defines `darkestRow` (moved from Task 12).
- **Task 15:** `buildFrame` has a required fifth parameter `primary`: `'p0'`. The new imports join `main.ts`'s existing `../edit/frame` and `../edit/state` lines (`Engine` is already imported). `liquifyOut` gets its own class (`liquify-note`), because `bench.spec.ts` pins `.gate .note` and `.panel .note` to one element each.
- **Task 16:** face A keeps the step-5 cases' `c.faceDetail ? step5Person() : person` as its base. Step 4 feeds the planner through `spotBounds(frame, oSize)` (an O-normalized `spotWindowGrowth` plus `oSpacePasses`), so the case spreads `spotBounds({ faces, photo }, decode)`; `Rect` is already imported by Task 13. `vite.config.ts` reads the version at `:37-44`.
- **Task 17:** the kept-assertions check also expects import declarations that gained names and `body.spec.ts`'s removed `PNG` import.
- **Commits:** the workflow's message format replaces the plan's `git commit -m` blocks: `v0.4 step 6 task <N>: <title>`, fixes `v0.4 step 6 task <N> fix: …`, then a blank line and the `Co-Authored-By` trailer, written to a file and committed with `git commit -F <file>` (heredocs break in this shell). A block's `git add` list shows the task's files; also stage every file this reconciliation adds to a task's **Files**.
- **Imports:** put new names into a file's existing import declarations; never import a name twice.

## Global Constraints

- **Base:** this plan runs after steps 1–5 are merged on `feat/meiyan-pwa`. Line anchors written `file:N` are at `892ea61` (v0.3.0, identical to `1f0273d` for `src/`); "after step N" names code that earlier steps reshape. Where step 1–5 code is edited, locate it by the name given here, not by the v0.3 line number.
- **Version:** `package.json` stays `"version": "0.3.0"` until Task 16 bumps it to `0.4.0` (C §1.3; `src/version.ts:6` and `vite.config.ts:37-44` read it). Nothing else hard-codes the version.
- **Git:** commits are LOCAL ONLY on `feat/meiyan-pwa`. Never `git push`, never deploy, never open a PR. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before Task 1, record the base in a file inside `.git` (shell variables do not survive between tool calls or subagents): `git rev-parse HEAD > "$(git rev-parse --git-dir)/STEP6_BASE"`. Task 17 reads it back with `STEP6_BASE=$(cat "$(git rev-parse --git-dir)/STEP6_BASE")`.
- **Line endings:** every edited file keeps its own line endings. CRLF today, among the files this plan edits: `src/types.ts`, `src/ui/panelModel.ts`, `src/ui/screens/zoomPan.ts`, `src/ui/components/BeautyPanel.tsx`, `src/ui/icons.tsx`, `src/ui/theme.css`, `src/ui/state.ts`, `src/ui/flows.ts`, `src/ui/screens/Home.tsx`, `src/ui/screens/Review.tsx`, `src/engine/pipeline.ts`, `src/engine/index.ts`, `src/engine/passes/reshape.test.ts`, `src/app/testFakes.ts`, `src/bench/main.ts`, `vite.config.ts`, `docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md`. LF: `src/ui/screens/Editor.tsx`, `src/app/still.ts`, `src/engine/passes/reshape.ts`, `reshapeCpu.ts`, `src/body/field.ts`, `src/store/history.ts`, `tests/e2e/*`, `docs/superpowers/specs/2026-10-12-v04-roadmap.md`. Check any other file with `git ls-files --eol <path>` before editing (`w/crlf` = keep CRLF; `.gitattributes` is `* text=auto eol=lf`, `core.autocrlf=true`). New files are LF.
- **Dependencies:** no new npm packages. MediaPipe stays `@mediapipe/tasks-vision` 0.10.35. CSP stays `connect-src 'self'`; no network access added.
- **Constants** (PB §3.3, copied verbatim; all in `src/config/limits.ts`): `LIQUIFY_LONG_EDGE = 512`; `BRUSH_PX = { s: 16, m: 28, l: 44 }`; `rMin(frame) = 4 / F`; `R_MAX = 0.25`; `STAMP_SPACING = 0.25`; `PUSH_GAIN = 0.75`; `RESTORE_GAIN = 0.5`; `SNAP = 2e-5`; `LIQUIFY_MIN_DET = 0.2`; `GUARD_STEPS = 6`; `MAX_STROKE_POINTS = 256`; `MAX_STROKES = 120`; `LIQUIFY_WORK_CAP = 12_000_000`; `LIQUIFY_SYNC_WORK = 1_500_000`; `PATCH_BUDGET = 1 MiB`; `PATCH_TILE = 32`; `PINCH_GRACE_MS = 200`; slices of 24 ms; ≤ 6 ms of stamps per pointer frame; `LIQUIFY_UNIT = 4`.
- **Copy** (繁體中文, exact): 推臉筆 · 推 · 恢復 · 筆刷模式 · 小 · 中 · 大 · 筆刷大小 · 全部清除 · 確定清除？ · 單指推動，雙指縮放 · 單指塗抹恢復，雙指縮放 · 推臉筆筆畫已達上限 · 正在套用推臉筆… · 整張照片.
- **Determinism:** the stamp maths uses only `+ − × ÷` and `Math.sqrt` on doubles stored to Float32 (no `Math.exp`, `pow`, `hypot` in stamps, PB §3.5), so Node and Safari replay bit for bit.
- **Invariant (C §1.1):** a photo with no strokes renders exactly as before this step (with `uLiqOn = 0` the body lookup is at the same coordinate), so every parity golden stays within 1/255 and `parity.spec.ts` stays green.
- **Memory:** nothing liquify-related is allocated until the first stroke; everything is freed when the strokes become empty and on editor unmount (PB §6.1, ≤ 5.2 MB while strokes exist).
- **UI:** no 9th tab (C §2.1). Brush bar 50 px tall, every target ≥ 44 pt. The brush is not in the camera (`live: false`); `CameraLook.photo.strokes` is always `[]`.
- **Commands:** `npm run typecheck` (`tsc --noEmit` over `src` and `tests`, so e2e pages and harnesses must typecheck too), `npm test` (Vitest), `npm run build`, e2e as `npm run build && npx playwright test <spec>`, full e2e `npm run test:e2e`. A run longer than 10 minutes (the full e2e suite, the clean-clone gate) goes in the background (`run_in_background`) and is waited for.
- **Names from steps 1–5** are the ones their plans define; where this plan edits their code it names the function or handler, never only a v0.3 line. The step-4 names it relies on: `ZoomPanOptions` and the shared `end` handler in `zoomPan.ts` (step-4 plan Task 15), `rememberable(sel)` and `CLEAR_CONFIRM_MS` in `panelModel.ts`, the Editor's `spotMode`, `tapSpot`, `SpotControls` branch and `onPersonTap` (step 1's tap handler, as step 4 calls it), and `backMapFrameOf(input: BackMapInput, oSize)` in `src/engine/backMapFrame.ts` (step-4 plan Task 17).

## Review Focus

1. **A debounced export firing mid-stroke** (an edit, then a stroke that outlasts the 400 ms encode debounce): it must never be cached under the pre-stroke `editKey`, so after ↶ the file 儲存 shares equals the pre-stroke file. Pinned by Task 14 test 「half a stroke is never exported」.
2. **The app backgrounded mid-stroke** (iOS home swipe, an incoming call: `visibilitychange` → hidden while the finger is down): the stroke drawn so far is committed as one undo step and written to 最近編輯 by the hidden-flush, the rest of the drag draws nothing, and a reopen shows it. Pinned by Task 14 test 「backgrounding mid-stroke commits and saves the stroke」.
3. **↶, ↷ or 全部清除 reached while a finger is still drawing** (a second finger on the top bar or the brush bar): nothing undoes or clears a half-built stroke; the buttons wait, and finger-up makes exactly one undo step. Pinned by Task 14 test 「↶ and 全部清除 wait while a finger draws」.
4. **A press on 按住對比 or 重置** (buttons inside `.frame`) in brush mode must not draw (zoomPan's target filter runs before the reducer), and holding 按住對比 must not leave a half stroke or a ring on screen. Pinned by Task 14 test 「a press on 按住對比 never draws」.
5. **WebGL context loss mid-stroke:** the field lives on the CPU, so the restored pipeline must receive and upload the same field object on its first frame. Pinned by Task 5 test 「the field reaches the job again after a context restore」.

(Checked and left out because the spec's own test list already pins them: the tier-L reopen grid, Task 3 「frame comes from the entry, not the decode」 and the history round trip; strokes drawn after rotate, flip, straighten or crop, Task 9 `brushMapping.test.ts` and Task 13's tiled 90° case.)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/config/limits.ts` | modify (step 1 created it) | The PB §3.3 constants |
| `src/types.ts` | modify | `Stroke` (if step 1 left it out), `LiquifyField`, `LiquifyFrame`, `BrushKind`, `BrushSize`, `PhotoParams.strokes`, `RenderInput.liquify`, `DebugState.liquify`; `StillFrame` also omits `'liquify'` (Task 6) |
| `src/body/field.ts` | modify | `fieldMinJacobianRect` (cell window); `fieldMinJacobian` becomes its full-rect call |
| `src/body/fieldRect.test.ts` | create | Rect version equals v0.3's full scan |
| `src/edit/liquify.ts` | create | Grid/units, `StrokeBuilder`, stamp operators, guard, `LiquifyModel`, `strokeWork`, `sanitizeStrokes`, `makeStrokeId`, `brushRadius` |
| `src/edit/strokeFixtures.ts` | create | Seeded `strokesS30`, `strokesCap`, `straightStroke` (tests and bench) |
| `tests/fixtures/strokes_s30.json`, `tests/fixtures/strokes_cap.json` | create | PB §8.4 / C §8.3 stroke fixtures: the generators' output on the 3:4 measuring frame, written by `liquify.test.ts` and pinned to the generators (our own data, no NOTICE line) |
| `src/edit/liquify.test.ts` | create | PB §8.1 unit tests |
| `src/edit/state.ts`, `state.test.ts` | modify | `defaultPhoto().strokes`, `withStrokes`, `clearStrokes`, `editKey` by stroke id, `sanitizePhoto` (so `sanitizeEditState`) → `sanitizeStrokes` |
| `src/edit/legacy.ts` | modify | `splitLegacy`'s photo literal gains `strokes: []` |
| `src/edit/migrate.ts`, `migrate.test.ts` | modify | `openState(...).frame`; the strokes re-sanitized with the geometry on every v2 path |
| `src/ui/state.ts`, `src/ui/flows.ts` | modify | `EditorSource.frame` |
| `src/store/history.test.ts` | modify | v2 round trip with stroke `Float32Array`s; a corrupt record dropped on read (`history.ts`'s `normalizeEntry` already sanitizes on the entry's own `width × height`, step 3) |
| `src/engine/passes/reshape.ts` | modify | `uLiqDisp`/`uLiqOn`, `LIQUIFY_UNIT = 4`, body lookup at the liquified coordinate, `draw(..., liquify)` |
| `src/engine/passes/reshapeCpu.ts`, `reshapeCpu.test.ts` | modify | `liquifyAt` (f16 texels), `liquify` argument applied first, hash pin re-set |
| `src/engine/pipeline.ts`, `pipeline.test.ts` | modify | `FrameJob.liquify`, `PassPlanInput.liquifyOn`, `planFrame(…, liquifyOn)`, `liquifyTexture()` |
| `src/engine/index.ts`, `index.test.ts` | modify | `job()` forwards `RenderInput.liquify` |
| `src/app/still.ts`, `still.test.ts` | modify | `setLiquify`, `liquify`, `StillSessionOptions.liquify`, `exportImageData(frame, body?, liquify?)`, `tileInput` |
| `tests/harness/t7/fakes.ts` | modify | the t7 `fakeStill` gains `liquify` / `setLiquify` |
| `tests/e2e/pages/reshape.ts`, `tests/e2e/reshape.spec.ts` | modify | GPU = CPU port with a liquify field |
| `src/ui/brushGesture.ts`, `brushGesture.test.ts` | create | PB §2.5 reducer |
| `src/ui/screens/zoomPan.ts` | modify | `opts.brush` hooks: one finger draws, two pinch, locked state |
| `src/ui/brushQueue.ts`, `brushQueue.test.ts` | create | The rAF stamp queue (≤ 6 ms per frame) |
| `src/ui/brushMapping.ts`, `brushMapping.test.ts` | create | Client → V → O through step 3's view module; radius at a client point |
| `src/ui/components/BrushBar.tsx`, `BrushOverlay.tsx`, `BrushHint.tsx` | create | PB §2.2, §2.3 |
| `src/ui/brushUi.test.ts` | create | Pure helpers of the three components |
| `src/ui/icons.tsx`, `src/ui/theme.css` | modify | `brush` icon; brush bar, ring, hint styles; face-off exemption |
| `src/ui/panelModel.ts`, `panelModel.test.ts` | modify | `'brush'` selection, items, `showsBrush`, `rememberSel`, `activate`, `sliderFor` |
| `src/ui/components/BeautyPanel.tsx` | modify | The brush item is exempt from `faceOff` dimming |
| `src/ui/screens/Editor.tsx` | modify | Model per photo, sync before render, live strokes, commit-before rules, export gating, brush bar, overlays, debug |
| `src/engine/backMapCpu.test.ts`, `src/media/exportPlan.test.ts` (step 3) | modify | The CPU back-map and the tile planner's liquify term (`TileBounds.liquifyMaxDisp`) with strokes |
| `src/engine/backMapFrame.ts`, `backMapFrame.test.ts` (step 4) | modify | `BackMapInput.liquify`: the 祛痘 tap back-map applies the strokes first |
| `tests/e2e/pages/strokeCases.ts` | create | Deterministic strokes + field for the export harness |
| `tests/e2e/fixtures.ts`, `tests/e2e/body.spec.ts` | modify | `brushDrag`, `touch`, `liquifyState`, `emptyPng` (moved), `linePng`, `savedPixels` |
| `tests/e2e/liquify.spec.ts` | create | PB §8.3 |
| `tests/e2e/export.spec.ts`, `tests/e2e/pages/export.ts` (step 3) | modify | Tiled = untiled with strokes and a 90° rotation; the release-gate case with every feature |
| `src/bench/liquifyBench.ts`, `liquifyBench.test.ts`, `src/bench/main.ts` | create / modify | PB §6.2 rows |
| `package.json`, `package-lock.json`, `src/ui/updateModel.test.ts` | modify | 0.4.0 |
| `docs/superpowers/specs/2026-10-12-v04-roadmap.md`, `docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md` | modify | Release notes section; DS pointers |

---

### Task 1: Types, limits and the windowed Jacobian

The shared names every later task uses, plus the one change to the body field module the fold guard needs: a Jacobian check restricted to the cells a stamp can have changed (PB §4.3; PB §3.7 row `src/body/field.ts:166-192`).

**Files:**
- Modify: `src/types.ts` (CRLF; at `d09e608`: `399-408` BodyField, `524-559` RenderInput, `231-246` PhotoParams, `741-777` DebugState)
- Modify: `src/config/limits.ts` (created by step 1, PS §3.5; LF)
- Modify: `src/body/field.ts:342-368` at `d09e608` (`fieldMinJacobian`)
- Create: `src/body/fieldRect.test.ts`

**Interfaces:**
- Consumes: `BodyField` (`types.ts:399-408` at `d09e608`); step 1's `Rect` (`{ x, y, w, h }`, PS §3.2) and `RenderInput` v0.4 (C §4.1); step 1's `src/config/limits.ts`.
- Produces:
  - `src/types.ts`: `interface Stroke { id: string; kind: 'push' | 'restore'; radius: number; strength: number; points: Float32Array }` (C §3.2, added here only if steps 1–5 did not), `type LiquifyField = BodyField`, `interface LiquifyFrame { width: number; height: number }`, `type BrushKind = Stroke['kind']`, `type BrushSize = 's' | 'm' | 'l'`, `RenderInput.liquify?: LiquifyField | null`, `DebugState.liquify?: { strokes: number; version: number; work: number; maxDisp: number; pending: boolean }`.
  - `src/config/limits.ts`: `LIQUIFY_LONG_EDGE`, `BRUSH_PX`, `R_MAX`, `STAMP_SPACING`, `PUSH_GAIN`, `RESTORE_GAIN`, `SNAP`, `LIQUIFY_MIN_DET`, `GUARD_STEPS`, `MAX_STROKE_POINTS`, `MAX_STROKES`, `LIQUIFY_WORK_CAP`, `LIQUIFY_SYNC_WORK`, `LIQUIFY_SLICE_MS`, `PATCH_BUDGET`, `PATCH_TILE`, `PINCH_GRACE_MS`, `STAMP_FRAME_MS`.
  - `src/body/field.ts`: `fieldMinJacobianRect(f: BodyField, x0: number, y0: number, x1: number, y1: number): number` over cells `x0 ≤ x < x1`, `y0 ≤ y < y1`, clipped to the grid, `Infinity` when no cell is left; `fieldMinJacobian(f)` = `fieldMinJacobianRect(f, 0, 0, w − 1, h − 1)` (1 when `w ≤ 1` or `h ≤ 1`, as today).

- [x] **Step 1: Write the failing test**

Create `src/body/fieldRect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BodyField } from '../types';
import { fieldMinJacobian, fieldMinJacobianRect } from './field';

/** v0.3's fieldMinJacobian, frozen: the refactor must not change a single result */
function referenceMinJacobian(f: BodyField): number {
  const { width: w, height: h, data } = f;
  let min = Infinity;
  const mx = (x: number, y: number) => x + data[(y * w + x) * 2] * w;
  const my = (x: number, y: number) => y + data[(y * w + x) * 2 + 1] * h;
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const ax0 = mx(x + 1, y) - mx(x, y);
      const ay0 = my(x + 1, y) - my(x, y);
      const ax1 = mx(x + 1, y + 1) - mx(x, y + 1);
      const ay1 = my(x + 1, y + 1) - my(x, y + 1);
      const bx0 = mx(x, y + 1) - mx(x, y);
      const by0 = my(x, y + 1) - my(x, y);
      const bx1 = mx(x + 1, y + 1) - mx(x + 1, y);
      const by1 = my(x + 1, y + 1) - my(x + 1, y);
      min = Math.min(min, ax0 * by0 - ay0 * bx0, ax0 * by1 - ay0 * bx1, ax1 * by0 - ay1 * bx0, ax1 * by1 - ay1 * bx1);
    }
  }
  return w > 1 && h > 1 ? min : 1;
}

/** smooth random fields, one with a fold at (fx, fy) */
function field(w: number, h: number, seed: number, fold?: [number, number]): BodyField {
  const data = new Float32Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2;
      data[i] = 0.02 * Math.sin(x * 0.3 + seed) * Math.cos(y * 0.2);
      data[i + 1] = 0.015 * Math.cos(x * 0.25 - seed) * Math.sin(y * 0.35);
    }
  if (fold) data[(fold[1] * w + fold[0]) * 2] += 3 / w; // one texel pushed past its right neighbour
  return { width: w, height: h, data, version: 1 };
}

describe('fieldMinJacobianRect (push-brush spec §4.3)', () => {
  it('over the full rect equals v0.3 fieldMinJacobian on every test field', () => {
    for (const f of [field(24, 36, 1), field(64, 48, 2), field(40, 40, 3, [20, 20]), field(1, 5, 4), field(5, 1, 5)]) {
      expect(fieldMinJacobian(f)).toBe(referenceMinJacobian(f));
      if (f.width > 1 && f.height > 1) expect(fieldMinJacobianRect(f, 0, 0, f.width - 1, f.height - 1)).toBe(referenceMinJacobian(f));
    }
  });

  it('sees only the cells of its rect: a fold outside is ignored, inside is found', () => {
    const f = field(40, 40, 3, [20, 20]);
    expect(fieldMinJacobianRect(f, 0, 0, 10, 10)).toBeGreaterThan(0.5);
    expect(fieldMinJacobianRect(f, 18, 18, 23, 23)).toBeLessThan(0);
    // clipped to the grid; an empty rect has no cell
    expect(fieldMinJacobianRect(f, -5, -5, 100, 100)).toBe(fieldMinJacobian(f));
    expect(fieldMinJacobianRect(f, 10, 10, 10, 30)).toBe(Infinity);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/body/fieldRect.test.ts`
Expected: FAIL — `SyntaxError: The requested module './field' does not provide an export named 'fieldMinJacobianRect'` (or the TS equivalent "has no exported member").

- [x] **Step 3: Split `fieldMinJacobian` into the windowed function**

In `src/body/field.ts`, replace the whole `fieldMinJacobian` function (`field.ts:342-368` at `d09e608`, starting at the comment `/** Smallest Jacobian determinant of the backward map …`) with:

```ts
/** Smallest Jacobian determinant of the backward map (debug / tests: must stay > 0.3, i.e. no fold-over). */
export function fieldMinJacobian(f: BodyField): number {
  return f.width > 1 && f.height > 1 ? fieldMinJacobianRect(f, 0, 0, f.width - 1, f.height - 1) : 1;
}

/**
 * fieldMinJacobian over the cells x0 ≤ x < x1, y0 ≤ y < y1 (cell (x, y) spans texels x…x+1, y…y+1), clipped to the
 * grid; Infinity when no cell is left. The 推臉筆 fold guard checks only the cells a stamp can have changed.
 */
export function fieldMinJacobianRect(f: BodyField, x0: number, y0: number, x1: number, y1: number): number {
  const { width: w, height: h, data } = f;
  // the engine samples the field bilinearly, so per cell det J is bilinear in the cell and its extremes are at the
  // corners: evaluating the four corner combinations of the cell's edge vectors is exact for that map
  let min = Infinity;
  const mx = (x: number, y: number) => x + data[(y * w + x) * 2] * w;
  const my = (x: number, y: number) => y + data[(y * w + x) * 2 + 1] * h;
  const xb = Math.min(w - 1, x1);
  const yb = Math.min(h - 1, y1);
  for (let y = Math.max(0, y0); y < yb; y++) {
    for (let x = Math.max(0, x0); x < xb; x++) {
      const ax0 = mx(x + 1, y) - mx(x, y);
      const ay0 = my(x + 1, y) - my(x, y);
      const ax1 = mx(x + 1, y + 1) - mx(x, y + 1);
      const ay1 = my(x + 1, y + 1) - my(x, y + 1);
      const bx0 = mx(x, y + 1) - mx(x, y);
      const by0 = my(x, y + 1) - my(x, y);
      const bx1 = mx(x + 1, y + 1) - mx(x + 1, y);
      const by1 = my(x + 1, y + 1) - my(x + 1, y);
      const d00 = ax0 * by0 - ay0 * bx0;
      const d01 = ax0 * by1 - ay0 * bx1;
      const d10 = ax1 * by0 - ay1 * bx0;
      const d11 = ax1 * by1 - ay1 * bx1;
      min = Math.min(min, d00, d01, d10, d11);
    }
  }
  return min;
}
```

(Keep the file's existing line endings. Step 1's multi-person builder keeps calling `fieldMinJacobian(field)`; nothing else changes.)

- [x] **Step 4: Add the shared types**

In `src/types.ts` (CRLF), first check what steps 1–5 already added:

Run: `grep -n "export interface Stroke\|LiquifyField\|LiquifyFrame\|liquify?" src/types.ts`

Add each item below that the grep did not find. Directly after `interface BodyField { … }` (`types.ts:399-408` at `d09e608`):

```ts
/** 推臉筆 field (push-brush spec §3.1): the BodyField layout, backward displacement in O UV units, row 0 = image top */
export type LiquifyField = BodyField;
/** the pixel size whose aspect and short edge the liquify grid is built on (push-brush spec §3.3) */
export interface LiquifyFrame {
  width: number;
  height: number;
}
```

Next to the other C §3.2 shapes (step 1 placed `PhotoParams` / `PersonParams` / `EditState` together; put these just above `PhotoParams`):

```ts
/** C §3.2 / push-brush spec §3.2. Immutable once committed. */
export interface Stroke {
  /** unique within the photo; also the stroke's equality key in editKey (C §3.4) */
  id: string;
  kind: 'push' | 'restore';
  /** brush radius, fraction of the frame's short edge (S units), clamped to [rMin(frame), R_MAX] */
  radius: number;
  /** per-stamp gain: PUSH_GAIN or RESTORE_GAIN when it was drawn, stored so retuning the constants never changes old photos */
  strength: number;
  /**
   * O-frame (x, y) pairs, 2…MAX_STROKE_POINTS pairs. Consecutive points are radius/4 apart in S units (to Float32
   * rounding), except the last gap, which is in [radius/8, radius/4). A continuation record starts with its
   * predecessor's last point.
   */
  points: Float32Array;
}
export type BrushKind = Stroke['kind'];
export type BrushSize = 's' | 'm' | 'l';
```

In `interface RenderInput` (after step 3 it holds `geometry`, `sourceWindow`, `output`), after `body?: BodyField | null;`:

```ts
  /** O-space backward map of the 推臉筆 strokes, the outermost map of P2 (push-brush spec §4.1); null / absent = none */
  liquify?: LiquifyField | null;
```

In `interface DebugState`, after `update?: …` (`types.ts:765` at `d09e608`):

```ts
  /** 推臉筆 (push-brush spec §3.2): written by the editor on commit, sync and rebuild end, not per stamp */
  liquify?: { strokes: number; version: number; work: number; maxDisp: number; pending: boolean };
```

(`PhotoParams.strokes` is added in Task 3 together with the code that fills it.)

- [x] **Step 5: Add the constants**

Append to `src/config/limits.ts` (keep its line endings):

```ts
// ── 推臉筆 (push-brush spec §3.3) ──
/** liquify field long edge in texels (RM §4.4, §4.7) */
export const LIQUIFY_LONG_EDGE = 512;
/** brush radius on screen, CSS px, per size */
export const BRUSH_PX = { s: 16, m: 28, l: 44 } as const;
/** largest brush radius in S units (fractions of the frame's short edge) */
export const R_MAX = 0.25;
/** stamp spacing, × radius */
export const STAMP_SPACING = 0.25;
/** content at the brush centre moves ¾ of a short drag */
export const PUSH_GAIN = 0.75;
/** per-stamp restore factor at the centre */
export const RESTORE_GAIN = 0.5;
/** a restored texel below this |L| (O UV) becomes exactly 0 */
export const SNAP = 2e-5;
/** fold-guard floor for strokes (the body field's MIN_DET is 0.35, field.ts:70) */
export const LIQUIFY_MIN_DET = 0.2;
/** per-stamp bisection steps */
export const GUARD_STEPS = 6;
/** points per stroke record */
export const MAX_STROKE_POINTS = 256;
/** records per photo (RM §5.3) */
export const MAX_STROKES = 120;
/** replay work cap, texel-stamps (≈ 1 s of replay on the test iPhone; Phase 0 rescales it) */
export const LIQUIFY_WORK_CAP = 12_000_000;
/** a rebuild above this many texel-stamps runs in slices */
export const LIQUIFY_SYNC_WORK = 1_500_000;
/** one slice of a chunked rebuild, ms */
export const LIQUIFY_SLICE_MS = 24;
/** undo patch ring, bytes */
export const PATCH_BUDGET = 1 << 20;
/** copy-on-write tile edge, texels */
export const PATCH_TILE = 32;
/** a second finger within this many ms cancels the stroke */
export const PINCH_GRACE_MS = 200;
/** stamps applied per animation frame while drawing, ms */
export const STAMP_FRAME_MS = 6;
```

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/body/fieldRect.test.ts src/body/field.test.ts src/body/straightness.test.ts`
Expected: PASS (every existing `fieldMinJacobian` assertion is unchanged).

Run: `npm run typecheck`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/config/limits.ts src/body/field.ts src/body/fieldRect.test.ts
git commit -m "feat(liquify): shared types, limits and a windowed Jacobian check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The liquify core (`src/edit/liquify.ts`)

Everything PB §3.1–§3.6, §4.2–§4.4 (CPU side) and §5.2 specify, as one pure-TS module with its tests: frame grid and S units, resampling into records, the composing push and SNAP-ed restore stamps, the per-stamp fold guard with bisection, the `LiquifyModel` (live gestures, the four `sync` cases, copy-on-write patches with a 1 MiB ring, chunked rebuilds into a staging buffer, caps on records and on actual work), `sanitizeStrokes`, ids and the radius conversion.

Two refinements of PB, both deliberate and covered by tests:
- **Seeded generators behind the JSON fixtures.** PB §8.4 and C §8.3 name `tests/fixtures/strokes_s30.json` and `strokes_cap.json`, "generated deterministically by a helper in liquify.test.ts". `src/edit/strokeFixtures.ts` generates the two lists from a seeded PRNG; the `stroke fixtures` tests in `liquify.test.ts` write the two JSON files when `WRITE_STROKE_FIXTURES=1` and otherwise assert that the committed files equal the generators' output, and the replay budget test replays the records read from the files. The bench (Task 15) calls the generators directly (a browser page cannot read the files without bundling them), which the pin makes the same data. S30 is 30 中 pushes of 2 radii on a 6 × 5 grid (measured: 0.84 M texel-stamps of actual work, below `LIQUIFY_SYNC_WORK`, so a reopen replays it synchronously); SCAP keeps 大 pushes while the replay's actual work stays within `LIQUIFY_WORK_CAP` (what the app itself allows).
- **A chunked rebuild fills a staging buffer** and swaps it into the field object when it finishes, so nothing half-built is ever drawn (the session may redraw on its own, e.g. when a filter LUT arrives). The field object keeps its identity; its `data` and `version` change, which the pipeline's upload key detects.

Measured on the 3:4 frame (384 × 512 grid, 中 at zoom 1 = 28.7 texels) with this code: a 0.5 R drag moves content at its start by 0.705× the drag; long straight drags saturate at 1.38 R with min det 0.249 and no bisection; a 1 R 中 push then one 大 恢復 pass leaves 10 % of max |L|, two passes 2 %, and the field is exactly 0 after 8; ten 1 R pushes from one start stop at 0.90 R (the third already resists). The tests assert these with margins.

**Files:**
- Create: `src/edit/liquify.ts`
- Create: `src/edit/strokeFixtures.ts`
- Create: `src/edit/liquify.test.ts`
- Create: `tests/fixtures/strokes_s30.json`, `tests/fixtures/strokes_cap.json` (written by the test in Step 5)

**Interfaces:**
- Consumes (Task 1): `fieldMinJacobianRect`, `fieldMinJacobian` (`src/body/field.ts`); `fieldSize(aspect, longEdge)` (`src/body/geom.ts:46-51`); `fieldAt`, `warpImage` (`src/body/cpuWarp.ts:7, 27`, tests only); the limits constants; `Stroke`, `LiquifyField`, `LiquifyFrame`, `BrushKind`, `Rect` (`src/types.ts`).
- Produces (`src/edit/liquify.ts`):
  - `interface LiquifyGrid { w: number; h: number; ax: number; ay: number; F: number }`, `liquifyGrid(frame: LiquifyFrame): LiquifyGrid`
  - `rMin(frame: LiquifyFrame): number`, `clampRadius(r: number, frame: LiquifyFrame): number`
  - `brushRadius(o0: {x,y}, o1: {x,y}, frame: LiquifyFrame): { radius: number; ringScale: number }`
  - `strokeWork(rec: Stroke, frame: LiquifyFrame): number` (base work)
  - `class StrokeBuilder { constructor(kind: BrushKind, radius: number, frame: LiquifyFrame, start: {x,y}); readonly count: number; point(i: number): {x,y}; add(o: {x,y}): number; stop(keep: number): void; finishPoint(): number; records(newId: () => string, strength: number): Stroke[]; finish(newId: () => string): Stroke[] }`
  - `interface LiveStroke { add(o: {x,y}): boolean; readonly state: 'ok' | 'resisting' | 'capped'; readonly stamped: boolean; commit(newId: () => string): Stroke[]; cancel(): void }`
  - `interface LiquifyModelOptions { now?: () => number; schedule?: (cb: () => void) => () => void; onSettled?: () => void; patchBudget?: number; syncWork?: number; sliceMs?: number; workCap?: number }`
  - `class LiquifyModel { constructor(frame: LiquifyFrame, opts?: LiquifyModelOptions); readonly field: LiquifyField | null; readonly pending: boolean; readonly work: number; readonly count: number; readonly records: Stroke[]; readonly patchBytes: number; readonly maxAbs: number; sync(strokes: readonly Stroke[]): { changed: boolean; pending: boolean }; begin(kind: BrushKind, radius: number, start: {x,y}): LiveStroke | null; maxDisp(r: Rect): number; backward(o: {x,y}): {x,y}; snapshot(): LiquifyField | null; settle(): void; dispose(): void }`
  - `maxDisp(r)` and `maxAbs` are lengths in long-edge units (`sqrt((dx·W)² + (dy·H)²) / max(W, H)` for the frame `W × H`): multiplied by the long edge of any decode of the photo they are pixels, which is exactly how step 3's planner uses `TileBounds.liquifyMaxDisp` (step-3 plan Task 9: `L = liquifyMaxDisp(rectO) * Math.max(decode.width, decode.height)`).
  - `makeStrokeId(taken: ReadonlySet<string>, rand?: (a: Uint8Array) => Uint8Array): string`
  - `sanitizeStrokes(raw: unknown, frame: LiquifyFrame | null): Stroke[]`
- Produces (`src/edit/strokeFixtures.ts`): `prng(seed: number): () => number`, `straightStroke(frame, kind, radius, a, b, id): Stroke[]`, `strokesS30(frame): Stroke[]`, `strokesCap(frame): Stroke[]`.

- [x] **Step 1: Write the failing tests**

Create `src/edit/liquify.test.ts`:

```ts
// 推臉筆 (push-brush spec §8.1): resampling, the stamp operators, the per-stamp fold guard, determinism, patches,
// caps, sanitize. Distances are in S units (fractions of the frame's short edge). Content travel is measured with an
// inverse of the backward map along the stroke line (bisection; the app itself never inverts the field).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldAt, warpImage } from '../body/cpuWarp';
import { fieldMinJacobian, fieldMinJacobianRect } from '../body/field';
import {
  GUARD_STEPS,
  LIQUIFY_MIN_DET,
  LIQUIFY_SYNC_WORK,
  LIQUIFY_WORK_CAP,
  MAX_STROKES,
  PATCH_TILE,
  PUSH_GAIN,
  R_MAX,
} from '../config/limits';
import type { LiquifyField, LiquifyFrame, Stroke } from '../types';
import {
  brushRadius,
  LiquifyModel,
  liquifyGrid,
  makeStrokeId,
  rMin,
  sanitizeStrokes,
  StrokeBuilder,
  strokeWork,
  type LiveStroke,
} from './liquify';
import { prng, straightStroke, strokesCap, strokesS30 } from './strokeFixtures';

/** 3:4, grid 384 × 512: the spec's measuring frame */
const FRAME: LiquifyFrame = { width: 1536, height: 2048 };
const G = liquifyGrid(FRAME);
/** 中 / 大 / 小 at zoom 1 (28.7 texels for 中) */
const RM = 28.7 / G.F;
const RL = RM * (44 / 28);
const RS = RM * (16 / 28);

const toO = (sx: number, sy: number) => ({ x: sx / G.ax, y: sy / G.ay });
let ids = 0;
const newId = () => `t${ids++}`;

/** a fresh model whose clock and scheduler the test drives */
function model(frame = FRAME, opts: { patchBudget?: number; syncWork?: number } = {}) {
  let t = 0;
  let settled = 0;
  const queue: (() => void)[] = [];
  const m = new LiquifyModel(frame, {
    now: () => t,
    onSettled: () => settled++,
    schedule: (cb) => {
      queue.push(cb);
      return () => queue.splice(queue.indexOf(cb), 1);
    },
    ...opts,
  });
  return {
    m,
    advance: (ms: number) => (t += ms),
    settled: () => settled,
    /** run scheduled slices until none is left */
    flush: () => {
      for (let i = 0; queue.length && i < 10_000; i++) queue.shift()!();
    },
  };
}

/** a live drag in S units: from (sx, sy) by (dx, dy), fed as `steps` raw points */
function drag(m: LiquifyModel, kind: Stroke['kind'], R: number, sx: number, sy: number, dx: number, dy: number, steps = 60): { recs: Stroke[]; live: LiveStroke } {
  const live = m.begin(kind, R, toO(sx, sy))!;
  expect(live).not.toBeNull();
  for (let k = 1; k <= steps; k++) live.add(toO(sx + (dx * k) / steps, sy + (dy * k) / steps));
  return { recs: live.commit(newId), live };
}

/** where content that sat at source (cx, cy) is shown now, along the line y = cy (S units) */
function contentX(m: LiquifyModel, cx: number, cy: number, span: number): number {
  const M = (x: number) => m.backward(toO(x, cy)).x * G.ax;
  let lo = cx - span;
  let hi = cx + span;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (M(mid) < cx) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const maxLen = (f: LiquifyField | null) => {
  if (!f) return 0;
  let m = 0;
  for (let i = 0; i < f.data.length; i += 2) m = Math.max(m, Math.hypot(f.data[i], f.data[i + 1]));
  return m;
};

/** bit-for-bit equality of two Float32Arrays (expect().toEqual walks 400 k elements slowly) */
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);
const f16Field = (f: LiquifyField): LiquifyField => ({ ...f, data: f.data.map((v) => f16(v)) });

/** tests/fixtures/strokes_*.json (PB §8.4): { frame, strokes } with the points as plain arrays */
const fixturePath = (name: string) => resolve(import.meta.dirname, '../../tests/fixtures', name);
const fixtureJson = (recs: Stroke[]) => `${JSON.stringify({ frame: FRAME, strokes: recs.map((r) => ({ ...r, points: Array.from(r.points) })) })}\n`;
const readFixture = (name: string): Stroke[] => {
  const raw = JSON.parse(readFileSync(fixturePath(name), 'utf8')) as { frame: LiquifyFrame; strokes: unknown };
  return sanitizeStrokes(raw.strokes, raw.frame);
};

describe('StrokeBuilder: resampling (§3.4)', () => {
  const gaps = (recs: Stroke[], frame: LiquifyFrame) => {
    const g = liquifyGrid(frame);
    const out: number[] = [];
    for (const r of recs)
      for (let i = 1; i < r.points.length / 2; i++)
        out.push(Math.hypot((r.points[i * 2] - r.points[i * 2 - 2]) * g.ax, (r.points[i * 2 + 1] - r.points[i * 2 - 1]) * g.ay));
    return out;
  };

  it('emits a point every radius/4 in S units; the last gap is in [radius/8, radius/4)', () => {
    const sb = new StrokeBuilder('push', RM, FRAME, toO(0.3, 0.4));
    sb.add(toO(0.3 + 1.1 * RM, 0.4 + 0.5 * RM));
    sb.add(toO(0.3 + 2.3 * RM, 0.4 - 0.2 * RM));
    const [rec] = sb.finish(newId);
    const gs = gaps([rec], FRAME);
    for (const d of gs.slice(0, -1)) expect(Math.abs(d / (RM / 4) - 1)).toBeLessThan(1e-6);
    expect(gs[gs.length - 1]).toBeGreaterThanOrEqual(RM / 8 - 1e-7);
    expect(gs[gs.length - 1]).toBeLessThan((RM / 4) * (1 + 1e-6));
    expect(rec.strength).toBe(PUSH_GAIN);
    expect(rec.radius).toBe(RM);
  });

  it('is speed independent: the same straight path fed as 3 or 300 raw points gives the same records', () => {
    const run = (n: number) => {
      const sb = new StrokeBuilder('push', RM, FRAME, toO(0.2, 0.5));
      for (let k = 1; k <= n; k++) sb.add(toO(0.2 + (3 * RM * k) / n, 0.5 + (RM * k) / n));
      return sb.finish(newId)[0].points;
    };
    const a = run(3);
    const b = run(300);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
  });

  it('a tap emits no second point and so no record', () => {
    const sb = new StrokeBuilder('push', RM, FRAME, toO(0.3, 0.3));
    sb.add(toO(0.3 + RM / 16, 0.3));
    expect(sb.finish(newId)).toEqual([]);
  });

  it('splits 700 points into 3 records whose continuations repeat the last point', () => {
    const sb = new StrokeBuilder('push', 0.02, FRAME, toO(0.05, 0.5));
    // 699 gaps of r/4 = 0.005: a straight line of 3.495 S units does not fit, so zig-zag within the frame
    let x = 0.05;
    let dir = 1;
    let y = 0.5;
    while (sb.count < 700) {
      x += dir * 0.0125;
      if (x > 0.7 || x < 0.05) {
        dir = -dir;
        y += 0.01;
      }
      sb.add(toO(x, y));
    }
    sb.stop(700);
    const recs = sb.records(newId, PUSH_GAIN);
    expect(recs.map((r) => r.points.length / 2)).toEqual([256, 256, 190]);
    expect(recs[1].points.slice(0, 2)).toEqual(recs[0].points.slice(-2));
    expect(recs[2].points.slice(0, 2)).toEqual(recs[1].points.slice(-2));
  });

  it('works in S units: a circle stays a circle on 3:4 and 16:9 frames', () => {
    for (const frame of [FRAME, { width: 1920, height: 1080 }]) {
      const g = liquifyGrid(frame);
      const sb = new StrokeBuilder('push', 0.05, frame, { x: (0.4 + 0.1) / g.ax, y: 0.4 / g.ay });
      for (let k = 1; k <= 400; k++) {
        const a = (k / 400) * Math.PI * 2;
        sb.add({ x: (0.4 + 0.1 * Math.cos(a)) / g.ax, y: (0.4 + 0.1 * Math.sin(a)) / g.ay });
      }
      const [rec] = sb.finish(newId);
      for (let i = 0; i < rec.points.length / 2; i++) {
        const r = Math.hypot(rec.points[i * 2] * g.ax - 0.4, rec.points[i * 2 + 1] * g.ay - 0.4);
        expect(Math.abs(r - 0.1)).toBeLessThan(0.002); // chords of a 0.1 circle at 0.0125 spacing
      }
    }
  });

  it('grids follow the frame: 3:4 → 384 × 512, a 4:1 panorama → 512 × 128 with rMin = 4/128', () => {
    expect([G.w, G.h, G.F]).toEqual([384, 512, 384]);
    const pano = { width: 4000, height: 1000 };
    const g = liquifyGrid(pano);
    expect([g.w, g.h]).toEqual([512, 128]);
    expect(rMin(pano)).toBeCloseTo(4 / 128, 12);
  });

  it('brushRadius: two O points 1 brush apart → S units, clamped, with the ring scale of the clamp', () => {
    const o = toO(0.5, 0.5);
    expect(brushRadius(o, toO(0.5 + RM, 0.5), FRAME).radius).toBeCloseTo(RM, 9);
    expect(brushRadius(o, toO(0.5 + RM, 0.5), FRAME).ringScale).toBeCloseTo(1, 9);
    const deep = brushRadius(o, toO(0.5 + rMin(FRAME) / 5, 0.5), FRAME); // zoomed far in
    expect(deep.radius).toBe(rMin(FRAME));
    expect(deep.ringScale).toBeCloseTo(5, 9);
    expect(brushRadius(o, toO(0.5, 0.5 + 1), FRAME).radius).toBe(R_MAX);
  });

  it('clamps raw points to [−1, 2]²', () => {
    const sb = new StrokeBuilder('push', 0.22, FRAME, { x: -5, y: 0.5 });
    sb.add({ x: 9, y: 0.5 });
    const [rec] = sb.finish(newId);
    expect(rec.points[0]).toBe(-1);
    expect(rec.points[rec.points.length - 2]).toBe(2);
  });
});

describe('push stamp (§4.2)', () => {
  it('one stamp on an empty field is toUV(−g·w(|X − c|)·Δ) inside the disc and exactly 0 outside', () => {
    const { m } = model();
    // the stamp centre and Δ come from the Float32 points, as the model stores them
    const c = { x: Math.fround(0.4 / G.ax) * G.ax, y: Math.fround(0.5 / G.ay) * G.ay };
    const live = m.begin('push', RM, toO(0.4, 0.5))!;
    live.add(toO(0.4 + 1.5 * (RM / 4), 0.5)); // exactly one stamp: Δ = (R/4, 0)
    const dx = Math.fround((0.4 + RM / 4) / G.ax) * G.ax - c.x;
    const f = m.field!;
    const R2 = RM * RM;
    let inside = 0;
    let outsideNonZero = 0;
    let worst = 0;
    for (let j = 0; j < f.height; j++)
      for (let i = 0; i < f.width; i++) {
        const X = ((i + 0.5) / f.width) * G.ax - c.x;
        const Y = ((j + 0.5) / f.height) * G.ay - c.y;
        const d2 = X * X + Y * Y;
        const k = (j * f.width + i) * 2;
        if (d2 >= R2) {
          if (f.data[k] !== 0 || f.data[k + 1] !== 0) outsideNonZero++;
          continue;
        }
        inside++;
        const q = 1 - d2 / R2;
        worst = Math.max(worst, Math.abs(f.data[k] - (-PUSH_GAIN * q * q * q * dx) / G.ax), Math.abs(f.data[k + 1]));
      }
    expect(inside).toBeGreaterThan(2000);
    expect(outsideNonZero).toBe(0);
    expect(worst).toBeLessThan(1e-9);
    live.cancel();
    expect(m.field).toBeNull();
  });

  it('a stroke touches exactly the texels of its predicted boxes (base work = touched-box texels)', () => {
    const { m } = model();
    const { recs } = drag(m, 'push', RM, 0.3, 0.6, 0.8 * RM, 0.3 * RM);
    const f = m.field!;
    const P = recs[0].points;
    let nonZero = 0;
    for (let j = 0; j < f.height; j++)
      for (let i = 0; i < f.width; i++) {
        const k = (j * f.width + i) * 2;
        if (f.data[k] === 0 && f.data[k + 1] === 0) continue;
        nonZero++;
        // push stamp c = p[i − 1]: every touched texel lies within R of a stamp centre
        const X = ((i + 0.5) / f.width) * G.ax;
        const Y = ((j + 0.5) / f.height) * G.ay;
        let near = Infinity;
        for (let c = 0; c < P.length / 2 - 1; c++) near = Math.min(near, Math.hypot(X - P[c * 2] * G.ax, Y - P[c * 2 + 1] * G.ay));
        expect(near).toBeLessThan(RM);
      }
    expect(nonZero).toBeGreaterThan(0);
    expect(nonZero).toBeLessThanOrEqual(strokeWork(recs[0], FRAME));
  });

  it('content at the start of a 0.5 R drag moves 0.6–0.8× the drag', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.375, 0.5, 0.5 * RM, 0);
    const travel = (contentX(m, 0.375, 0.5, 3 * RM) - 0.375) / (0.5 * RM);
    expect(travel).toBeGreaterThan(0.6);
    expect(travel).toBeLessThan(0.8);
  });

  it('a 6 R straight drag moves content by at most 2 R, and a single straight drag never bisects', () => {
    const { m } = model();
    const { recs } = drag(m, 'push', RM, 0.15, 0.5, 6 * RM, 0, 300);
    const travel = (contentX(m, 0.15, 0.5, 8 * RM) - 0.15) / RM;
    expect(travel).toBeGreaterThan(1);
    expect(travel).toBeLessThanOrEqual(2);
    expect(m.work).toBe(recs.reduce((s, r) => s + strokeWork(r, FRAME), 0));
    expect(fieldMinJacobian(m.field!)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET);
  });
});

describe('restore stamp (§4.2)', () => {
  it('a 中 push then 大 restore passes: ≤ 12 % after one, ≤ 3 % after two, exactly 0 within 10', () => {
    const { m } = model();
    const cx = 0.3;
    const cy = 0.5;
    drag(m, 'push', RM, cx, cy, RM, 0);
    const m0 = maxLen(m.field);
    const left: number[] = [];
    let zeroAfter = -1;
    for (let p = 1; p <= 10 && zeroAfter < 0; p++) {
      drag(m, 'restore', RL, cx - 0.5 * RL, cy, RM + RL, 0, 80);
      left.push(maxLen(m.field) / m0);
      if (m.field!.data.every((v) => v === 0)) zeroAfter = p;
    }
    expect(left[0]).toBeLessThanOrEqual(0.12);
    expect(left[1]).toBeLessThanOrEqual(0.03);
    expect(zeroAfter).toBeGreaterThan(0);
    // then the area is exactly the slider-only image: the CPU warp with the field equals the one without it, bit for bit
    const img = Uint8ClampedArray.from({ length: 96 * 128 * 4 }, (_, i) => (i * 37) % 251);
    expect(Array.from(warpImage(img, 96, 128, 4, m.field))).toEqual(Array.from(warpImage(img, 96, 128, 4, null)));
  });

  it('a restore over an untouched area is a no-op gesture: no record', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.2, 0.2, RM, 0);
    const before = m.field!.data.slice();
    const { recs } = drag(m, 'restore', RM, 0.6, 0.9, RM, 0);
    expect(recs).toEqual([]);
    expect(m.count).toBe(1);
    expect(same(m.field!.data, before)).toBe(true);
  });

  it('a restore on a photo without strokes leaves nothing allocated', () => {
    const { m } = model();
    const { recs } = drag(m, 'restore', RM, 0.6, 0.9, RM, 0);
    expect(recs).toEqual([]);
    expect(m.field).toBeNull();
  });
});

describe('fold guard (§4.3)', () => {
  it('fuzz: 200 random push / restore scribbles, circles and scrubs never fold and stay finite', () => {
    const rnd = prng(7);
    const frame = { width: 600, height: 800 };
    const g = liquifyGrid(frame);
    const sizes = [16, 28, 44].map((px) => (px / 28) * (28.7 / g.F));
    for (let s = 0; s < 200; s++) {
      const { m } = model(frame);
      const strokes = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < strokes; k++) {
        const kind = rnd() < 0.7 ? 'push' : 'restore';
        const R = sizes[Math.floor(rnd() * 3)];
        const cx = 0.2 + 0.4 * rnd();
        const cy = 0.2 + 0.6 * rnd();
        const live = m.begin(kind, R, { x: cx / g.ax, y: cy / g.ay });
        if (!live) break;
        const shape = Math.floor(rnd() * 3);
        // texel box of everything this gesture can reach (the stamps change nothing outside it)
        const box = { x0: cx - 3 * R, x1: cx + 3 * R, y0: cy - 2 * R, y1: cy + 2 * R };
        for (let i = 1; i <= 24; i++) {
          const t = i / 24;
          const p =
            shape === 0
              ? { x: cx + (rnd() - 0.5) * 2 * R, y: cy + (rnd() - 0.5) * 2 * R } // scribble, within ±R
              : shape === 1
                ? { x: cx + R * Math.cos(t * 4 * Math.PI) - R, y: cy + R * Math.sin(t * 4 * Math.PI) } // two circles
                : { x: cx + R * Math.sin(t * 6 * Math.PI), y: cy }; // back-and-forth scrub
          live.add({ x: p.x / g.ax, y: p.y / g.ay });
          if (!m.field) continue;
          const i0 = Math.floor((box.x0 / g.ax) * g.w) - 2;
          const i1 = Math.ceil((box.x1 / g.ax) * g.w) + 2;
          const j0 = Math.floor((box.y0 / g.ay) * g.h) - 2;
          const j1 = Math.ceil((box.y1 / g.ay) * g.h) + 2;
          expect(fieldMinJacobianRect(m.field, i0, j0, i1, j1)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
        }
        live.commit(newId);
      }
      if (m.field) {
        expect(fieldMinJacobian(m.field)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
        expect(m.field.data.every(Number.isFinite)).toBe(true);
      }
    }
  }, 120_000);

  it('a 小 restore line across a 4 R 大 push is guarded too, and the f16 upload keeps min det > 0.1', () => {
    const { m } = model();
    drag(m, 'push', RL, 0.2, 0.5, 4 * RL, 0, 200);
    drag(m, 'restore', RS, 0.2 + 2 * RL, 0.5 - 1.5 * RL, 0, 3 * RL, 120);
    expect(fieldMinJacobian(m.field!)).toBeGreaterThanOrEqual(LIQUIFY_MIN_DET - 1e-6);
    expect(fieldMinJacobian(f16Field(m.field!))).toBeGreaterThan(0.1);
  });

  it('ten 1 R pushes from one start: travel never decreases, stops growing, and the brush resists', () => {
    const { m } = model();
    const cx = 0.3;
    const cy = 0.5;
    const travel: number[] = [];
    const states: string[] = [];
    for (let k = 0; k < 10; k++) {
      const live = m.begin('push', RM, toO(cx, cy))!;
      for (let s = 1; s <= 40; s++) live.add(toO(cx + (RM * s) / 40, cy));
      states.push(live.state);
      live.commit(newId);
      travel.push((contentX(m, cx, cy, 4 * RM) - cx) / RM);
    }
    for (let k = 1; k < 10; k++) expect(travel[k]).toBeGreaterThanOrEqual(travel[k - 1] - 1e-9);
    expect(travel[9]).toBeLessThanOrEqual(1);
    expect(travel[9] - travel[4]).toBeLessThan(0.01);
    expect(states[9]).toBe('resisting');
    expect(fieldMinJacobian(f16Field(m.field!))).toBeGreaterThan(0.1);
  });
});

describe('determinism, patches, sync (§3.5)', () => {
  const draw = (m: LiquifyModel) => {
    const all: Stroke[] = [];
    all.push(...drag(m, 'push', RM, 0.3, 0.4, 2 * RM, 0.5 * RM).recs);
    all.push(...drag(m, 'push', RL, 0.5, 0.6, -RL, 2 * RL).recs);
    all.push(...drag(m, 'restore', RS, 0.35, 0.35, RM, RM).recs);
    all.push(...drag(m, 'push', RM, 0.6, 0.3, 0, 3 * RM).recs);
    return all;
  };

  it('live drawing, sync of the same records into a fresh model, and revert + re-apply are bit-identical', () => {
    const a = model();
    const recs = draw(a.m);
    const b = model();
    expect(b.m.sync(recs)).toEqual({ changed: true, pending: false });
    expect(same(b.m.field!.data, a.m.field!.data)).toBe(true);
    const live = a.m.field!.data.slice();
    expect(a.m.sync(recs.slice(0, 2))).toEqual({ changed: true, pending: false });
    const c = model();
    c.m.sync(recs.slice(0, 2));
    expect(same(a.m.field!.data, c.m.field!.data)).toBe(true); // revert by patches = rebuild of the prefix
    a.m.sync(recs);
    expect(same(a.m.field!.data, live)).toBe(true);
  });

  it('after patch eviction sync falls back to a rebuild with the same result', () => {
    const a = model(FRAME, { patchBudget: 8 * 1024 }); // one tile: every older patch is evicted
    const recs = draw(a.m);
    expect(a.m.patchBytes).toBeLessThanOrEqual(8 * 1024 + PATCH_TILE * PATCH_TILE * 8);
    a.m.sync(recs.slice(0, 1));
    const c = model();
    c.m.sync(recs.slice(0, 1));
    expect(same(a.m.field!.data, c.m.field!.data)).toBe(true);
  });

  it("a live gesture's patch is kept past the budget during the grace and evicted after it", () => {
    const a = model(FRAME, { patchBudget: 1 });
    const live = a.m.begin('push', RL, toO(0.3, 0.5))!;
    live.add(toO(0.3 + RL, 0.5));
    expect(a.m.patchBytes).toBeGreaterThan(0);
    a.advance(250);
    live.add(toO(0.3 + 2 * RL, 0.5)); // a new tile is patched → the budget is enforced again
    expect(a.m.patchBytes).toBe(0);
    live.cancel(); // falls back to a rebuild of nothing: the field is gone
    expect(a.m.field).toBeNull();
  });

  it('cancel restores the exact pre-gesture field and makes no record', () => {
    const { m } = model();
    drag(m, 'push', RM, 0.3, 0.4, RM, 0);
    const before = m.field!.data.slice();
    const live = m.begin('push', RL, toO(0.4, 0.5))!;
    live.add(toO(0.4 + RL, 0.5));
    live.cancel();
    expect(same(m.field!.data, before)).toBe(true);
    expect(m.count).toBe(1);
  });

  it('sync([]) frees everything; ↶ afterwards replays to the same bits', () => {
    const a = model();
    const recs = draw(a.m);
    const bits = a.m.field!.data.slice();
    expect(a.m.sync([])).toEqual({ changed: true, pending: false });
    expect(a.m.field).toBeNull();
    expect(a.m.patchBytes).toBe(0);
    a.m.sync(recs);
    expect(same(a.m.field!.data, bits)).toBe(true);
  });

  it('a rebuild above the sync work runs in slices; a new sync restarts it; the result equals a synchronous one', () => {
    const recs = strokesS30(FRAME);
    const a = model(FRAME, { syncWork: 20_000 });
    expect(a.m.sync(recs)).toEqual({ changed: true, pending: true });
    expect(a.m.pending).toBe(true);
    expect(a.m.field).toBeNull(); // nothing half-built is ever shown
    expect(a.m.begin('push', RM, toO(0.5, 0.5))).toBeNull(); // brush input is refused
    expect(a.m.sync(recs.slice(0, 20))).toEqual({ changed: true, pending: true }); // restarted
    a.flush();
    expect(a.m.pending).toBe(false);
    expect(a.settled()).toBe(1);
    const b = model();
    b.m.sync(recs.slice(0, 20));
    expect(same(a.m.field!.data, b.m.field!.data)).toBe(true);
  });

  it('settle() finishes a pending rebuild at once, with the same bits', () => {
    const recs = strokesS30(FRAME);
    const a = model(FRAME, { syncWork: 20_000 });
    a.m.sync(recs);
    a.m.settle();
    expect(a.m.pending).toBe(false);
    a.flush(); // the cancelled slice does nothing
    expect(a.settled()).toBe(0);
    const b = model();
    b.m.sync(recs);
    expect(same(a.m.field!.data, b.m.field!.data)).toBe(true);
  });

  it('S30 replays synchronously; SCAP (at the work cap) goes to slices (records read from tests/fixtures)', () => {
    const s30 = readFixture('strokes_s30.json');
    expect(s30.length).toBeGreaterThanOrEqual(30);
    expect(model().m.sync(s30).pending).toBe(false);
    const cap = readFixture('strokes_cap.json');
    const w = cap.reduce((s, r) => s + strokeWork(r, FRAME), 0);
    expect(w).toBeGreaterThan(LIQUIFY_SYNC_WORK);
    expect(w).toBeLessThanOrEqual(LIQUIFY_WORK_CAP);
    const c = model();
    expect(c.m.sync(cap).pending).toBe(true);
    c.flush();
    expect(c.m.pending).toBe(false);
    expect(c.m.count).toBe(cap.length);
  }, 60_000);
});

describe('caps and work (§3.6)', () => {
  it('begin returns null at MAX_STROKES records and at the work cap', () => {
    const { m } = model();
    const recs: Stroke[] = [];
    for (let k = 0; k < MAX_STROKES; k++)
      recs.push(...straightStroke(FRAME, 'push', RS, toO(0.1 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), toO(0.12 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), `c${k}`));
    m.sync(recs);
    expect(m.count).toBe(MAX_STROKES);
    expect(m.begin('push', RM, toO(0.5, 0.5))).toBeNull();
    const one = straightStroke(FRAME, 'push', RM, toO(0.3, 0.3), toO(0.3 + 2 * RM, 0.3), 'w');
    const c = new LiquifyModel(FRAME, { workCap: strokeWork(one[0], FRAME) });
    c.sync(one);
    expect(c.begin('push', RM, toO(0.6, 0.6))).toBeNull();
  });

  it('a gesture crossing the work cap is capped and commits only the stamps that fit', () => {
    const c = new LiquifyModel(FRAME, { workCap: 60_000, now: () => 0 });
    const live = c.begin('push', RM, toO(0.2, 0.5))!;
    for (let k = 1; k <= 200 && live.state !== 'capped'; k++) live.add(toO(0.2 + (k * RM) / 8, 0.5));
    expect(live.state).toBe('capped');
    expect(live.add(toO(0.9, 0.5))).toBe(false);
    const recs = live.commit(newId);
    expect(recs).toHaveLength(1);
    expect(c.work).toBeLessThanOrEqual(60_000);
    // the refused stamp would have crossed the cap: the room left is less than one stamp box
    expect(c.work + strokeWork({ ...recs[0], points: recs[0].points.slice(-4) }, FRAME)).toBeGreaterThan(60_000 - 3500);
  });

  it('a gesture crossing the record cap is capped and commits only the stamps before it', () => {
    const { m } = model();
    const recs: Stroke[] = [];
    for (let k = 0; k < MAX_STROKES - 1; k++)
      recs.push(...straightStroke(FRAME, 'push', RS, toO(0.1 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), toO(0.12 + (k % 10) * 0.05, 0.1 + Math.floor(k / 10) * 0.07), `c${k}`));
    m.sync(recs);
    // a tiny radius and a long path: more than 255 points, i.e. a second record → over the cap
    const r = rMin(FRAME);
    const live = m.begin('push', r, toO(0.1, 0.95))!;
    for (let k = 1; k <= 300 && live.state !== 'capped'; k++) live.add(toO(0.1 + k * (r / 4) * 1.01, 0.95));
    expect(live.state).toBe('capped');
    const out = live.commit(newId);
    expect(out).toHaveLength(1);
    expect(out[0].points.length / 2).toBe(256);
    expect(m.count).toBe(MAX_STROKES);
  });

  it('actual work ≥ base work, and equals base × (1 + bisection steps) per stamp', () => {
    const { m } = model();
    const cx = 0.3;
    for (let k = 0; k < 4; k++) {
      const live = m.begin('push', RM, toO(cx, 0.5))!;
      for (let s = 1; s <= 40; s++) live.add(toO(cx + (RM * s) / 40, 0.5));
      live.commit(newId);
    }
    const recs = sanitizeStrokes(m.records, FRAME);
    const base = recs.reduce((s, r) => s + strokeWork(r, FRAME), 0);
    expect(m.work).toBeGreaterThan(base); // repeated pushes bisect
    // each stamp's actual work is base·1 or base·(1 + GUARD_STEPS)
    const extra = (m.work - base) / GUARD_STEPS;
    expect(Number.isInteger(extra)).toBe(true);
  });
});

describe('sanitizeStrokes (§5.2)', () => {
  const ok = (id: string, over: Partial<Stroke> = {}): Stroke => ({
    id,
    kind: 'push',
    radius: RM,
    strength: PUSH_GAIN,
    points: Float32Array.of(0.2, 0.2, 0.21, 0.2),
    ...over,
  });

  it('keeps valid records in order and drops each malformed one alone', () => {
    const raw: unknown[] = [
      ok('a'),
      { ...ok('b'), kind: 'twirl' },
      ok('a'), // duplicate id: the first is kept
      { ...ok('c'), id: '' },
      { ...ok('d'), points: Float32Array.of(0.2, 0.2, 0.3) }, // odd length
      { ...ok('e'), points: Float32Array.of(0.2, 0.2) }, // one point
      { ...ok('f'), points: Float32Array.of(0.2, 0.2, 2.5, 0.2) }, // outside [−1, 2]
      { ...ok('g'), points: Float32Array.of(0.2, NaN, 0.3, 0.2) },
      { ...ok('h'), radius: Infinity },
      { ...ok('i'), strength: NaN },
      { ...ok('j'), points: [0.2, 0.2, 0.25, 0.2] }, // an array is converted
      { ...ok('k'), radius: 9, strength: 4 }, // clamped
      { ...ok('l'), radius: 0 },
      null,
      'x',
    ];
    const out = sanitizeStrokes(raw, FRAME);
    expect(out.map((r) => r.id)).toEqual(['a', 'j', 'k', 'l']);
    expect(out[1].points).toBeInstanceOf(Float32Array);
    expect(out[2].radius).toBe(R_MAX);
    expect(out[2].strength).toBe(1);
    expect(out[3].radius).toBe(rMin(FRAME));
  });

  it('drops the first over-cap record and every later one', () => {
    const many = Array.from({ length: MAX_STROKES + 5 }, (_, i) => ok(`r${i}`));
    expect(sanitizeStrokes(many, FRAME)).toHaveLength(MAX_STROKES);
    const [big] = straightStroke(FRAME, 'push', R_MAX, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, 'big');
    const per = strokeWork(big, FRAME);
    const fit = Math.floor(LIQUIFY_WORK_CAP / per);
    expect(fit + 2).toBeLessThan(MAX_STROKES); // the work cap binds first
    const list = [...Array.from({ length: fit + 1 }, (_, i) => ({ ...big, id: `big${i}` })), ok('tail')];
    expect(sanitizeStrokes(list, FRAME).map((r) => r.id)).toEqual(list.slice(0, fit).map((r) => r.id));
  });

  it('without a frame (the camera look) every stroke is dropped', () => {
    expect(sanitizeStrokes([ok('a')], null)).toEqual([]);
    expect(sanitizeStrokes('nope', FRAME)).toEqual([]);
  });
});

describe('maxDisp, backward, ids', () => {
  it('maxDisp bounds |L| (in long-edge units: × the decode long edge = px) on a dense sample of the rect; backward = o + L(o)', () => {
    const { m } = model();
    drag(m, 'push', RL, 0.3, 0.4, 2 * RL, RL);
    const r = { x: 0.2, y: 0.25, w: 0.3, h: 0.2 };
    const bound = m.maxDisp(r);
    const long = Math.max(FRAME.width, FRAME.height);
    let seen = 0;
    for (let j = 0; j <= 100; j++)
      for (let i = 0; i <= 100; i++) {
        const o = { x: r.x + (r.w * i) / 100, y: r.y + (r.h * j) / 100 };
        const b = m.backward(o);
        if (i % 10 === 0 && j % 10 === 0) {
          // backward(o) = o + L(o) with the bilinear, clamp-to-edge read (fieldAt's arithmetic)
          const [du, dv] = fieldAt(m.field!, o.x, o.y);
          expect([b.x, b.y]).toEqual([o.x + du, o.y + dv]);
        }
        // the displacement in pixels of a 4096-long decode, over that long edge
        seen = Math.max(seen, Math.hypot(((b.x - o.x) * FRAME.width) / long, ((b.y - o.y) * FRAME.height) / long));
      }
    expect(seen).toBeGreaterThan(0);
    expect(bound).toBeGreaterThanOrEqual(seen);
    expect(m.maxAbs).toBeLessThanOrEqual(bound);
    expect(m.maxAbs).toBeGreaterThan(0);
    expect(model().m.maxDisp(r)).toBe(0);
    expect(model().m.maxAbs).toBe(0);
  });

  it('makeStrokeId: 8 base-36 characters, redrawn on a collision', () => {
    let n = 0;
    const rand = (a: Uint8Array) => a.fill(n++ === 0 ? 0 : 1);
    expect(makeStrokeId(new Set(['00000000']), rand)).toBe('11111111');
    expect(makeStrokeId(new Set())).toMatch(/^[0-9a-z]{8}$/);
  });
});

// PB §8.4 / C §8.3: the replay fixtures are the generators' output, committed. `WRITE_STROKE_FIXTURES=1` (re)writes
// them; a normal run asserts the committed files still equal what the generators produce.
describe('stroke fixtures (tests/fixtures/strokes_*.json)', () => {
  for (const [name, gen] of [
    ['strokes_s30.json', strokesS30],
    ['strokes_cap.json', strokesCap],
  ] as const) {
    it(`${name} is the generator's output on the measuring frame`, () => {
      const recs = gen(FRAME);
      const json = fixtureJson(recs);
      if (process.env.WRITE_STROKE_FIXTURES === '1') writeFileSync(fixturePath(name), json);
      expect(existsSync(fixturePath(name)), `missing: run WRITE_STROKE_FIXTURES=1 npx vitest run src/edit/liquify.test.ts -t "stroke fixtures"`).toBe(true);
      expect(JSON.parse(readFileSync(fixturePath(name), 'utf8'))).toEqual(JSON.parse(json));
      const back = readFixture(name);
      expect(back.map((r) => r.id)).toEqual(recs.map((r) => r.id));
      expect(back.every((r) => r.points instanceof Float32Array)).toBe(true);
    }, 60_000);
  }
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/edit/liquify.test.ts`
Expected: FAIL — `Failed to load url ./liquify` (the module does not exist yet; the stroke-fixture files do not exist either).

- [x] **Step 3: Write the stroke generators**

Create `src/edit/strokeFixtures.ts`:

```ts
// Deterministic stroke lists for the replay tests and the bench (push-brush spec §6.2, §8.4): our own data, generated
// from a seeded PRNG. tests/fixtures/strokes_s30.json and strokes_cap.json are these lists on the 3:4 measuring frame,
// pinned to them by liquify.test.ts. S30 = 30 typical strokes (a cheek push is about 9 stamps); SCAP = records up to
// LIQUIFY_WORK_CAP of actual work.
import { LIQUIFY_WORK_CAP, MAX_STROKES } from '../config/limits';
import type { LiquifyFrame, Stroke } from '../types';
import { LiquifyModel, liquifyGrid, StrokeBuilder } from './liquify';

/** mulberry32: a small seeded PRNG (tests and bench only) */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** one straight record from O point a to b (raw points every radius/16 in S units) */
export function straightStroke(
  frame: LiquifyFrame,
  kind: Stroke['kind'],
  radius: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  id: string,
): Stroke[] {
  const g = liquifyGrid(frame);
  const len = Math.hypot((b.x - a.x) * g.ax, (b.y - a.y) * g.ay);
  const n = Math.max(1, Math.ceil(len / (radius / 16)));
  const sb = new StrokeBuilder(kind, radius, frame, a);
  for (let k = 1; k <= n; k++) sb.add({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  let i = 0;
  return sb.finish(() => (i++ === 0 ? id : `${id}-${i - 1}`));
}

/** 30 typical strokes: 中 pushes of 2 radii (about 9 stamps each) on a 6 × 5 grid, each in its own direction */
export function strokesS30(frame: LiquifyFrame): Stroke[] {
  const g = liquifyGrid(frame);
  const R = 28.7 / g.F;
  const out: Stroke[] = [];
  for (let k = 0; k < 30; k++) {
    const cx = 0.1 + 0.16 * (k % 6);
    const cy = 0.1 + 0.2 * Math.floor(k / 6);
    const ang = (k * 2 * Math.PI) / 7;
    const a = { x: cx / g.ax, y: cy / g.ay };
    const b = { x: (cx + 2 * R * Math.cos(ang)) / g.ax, y: (cy + 2 * R * Math.sin(ang)) / g.ay };
    out.push(...straightStroke(frame, 'push', R, a, b, `s30-${k}`));
  }
  return out;
}

/** 大 pushes across the photo, kept while the replay's actual work stays within LIQUIFY_WORK_CAP (what the app allows) */
export function strokesCap(frame: LiquifyFrame): Stroke[] {
  const r = prng(4242);
  const g = liquifyGrid(frame);
  const R = (28.7 / g.F) * (44 / 28);
  const m = new LiquifyModel(frame, { syncWork: Infinity, now: () => 0 });
  const out: Stroke[] = [];
  for (let k = 0; ; k++) {
    const a = { x: 0.1 + 0.8 * r(), y: 0.1 + 0.8 * r() };
    const b = { x: 0.1 + 0.8 * r(), y: 0.1 + 0.8 * r() };
    const next = [...out, ...straightStroke(frame, 'push', R, a, b, `cap-${k}`)];
    if (next.length > MAX_STROKES) break;
    m.sync(next);
    if (m.work > LIQUIFY_WORK_CAP) break;
    out.splice(0, out.length, ...next);
  }
  m.dispose();
  return out;
}
```

- [x] **Step 4: Write the module**

Create `src/edit/liquify.ts`:

```ts
// 推臉筆 (push-brush spec §3–§5): strokes → an O-space backward displacement field, on the CPU.
import { fieldMinJacobianRect } from '../body/field';
import { fieldSize } from '../body/geom';
import {
  GUARD_STEPS,
  LIQUIFY_LONG_EDGE,
  LIQUIFY_MIN_DET,
  LIQUIFY_SLICE_MS,
  LIQUIFY_SYNC_WORK,
  LIQUIFY_WORK_CAP,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  PATCH_BUDGET,
  PATCH_TILE,
  PINCH_GRACE_MS,
  PUSH_GAIN,
  R_MAX,
  RESTORE_GAIN,
  SNAP,
  STAMP_SPACING,
} from '../config/limits';
import type { BrushKind, LiquifyField, LiquifyFrame, Rect, Stroke } from '../types';

// ───────────────────────── frame, grid, units ─────────────────────────

/** The liquify grid of a frame (§3.1): texel (i, j) is centred at ((i + 0.5)/w, (j + 0.5)/h) in O UV. */
export interface LiquifyGrid {
  w: number;
  h: number;
  /** S units per O-UV unit on x and y: S = (x·W/S₀, y·H/S₀) */
  ax: number;
  ay: number;
  /** texels per S unit, min(w, h) */
  F: number;
}

export function liquifyGrid(frame: LiquifyFrame): LiquifyGrid {
  const W = Math.max(1, frame.width);
  const H = Math.max(1, frame.height);
  const [w, h] = fieldSize(W / H, LIQUIFY_LONG_EDGE);
  const s0 = Math.min(W, H);
  return { w, h, ax: W / s0, ay: H / s0, F: Math.min(w, h) };
}

/** smallest brush radius in S units: 4 texels (§3.3) */
export function rMin(frame: LiquifyFrame): number {
  return 4 / liquifyGrid(frame).F;
}

export function clampRadius(r: number, frame: LiquifyFrame): number {
  return Math.min(R_MAX, Math.max(rMin(frame), r));
}

/**
 * The brush radius (S units) from two O points BRUSH_PX[size] apart on screen (§3.3: evaluated at stroke start with the
 * current zoom and geometry), clamped to [rMin, R_MAX]. ringScale = radius / unclamped: the ring grows on screen by it
 * when a deep zoom clamps the radius to rMin (§2.3).
 */
export function brushRadius(o0: { x: number; y: number }, o1: { x: number; y: number }, frame: LiquifyFrame): { radius: number; ringScale: number } {
  const g = liquifyGrid(frame);
  const raw = Math.hypot((o1.x - o0.x) * g.ax, (o1.y - o0.y) * g.ay);
  const radius = clampRadius(raw, frame);
  return { radius, ringScale: raw > 0 ? radius / raw : 1 };
}

const clampO = (v: number) => Math.min(2, Math.max(-1, v));

// ───────────────────────── stamp box and base work ─────────────────────────

interface Box {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** texels whose centre may lie within R of (cx, cy) (S units), clipped to the grid; null = none */
function stampBox(g: LiquifyGrid, cx: number, cy: number, R: number): Box | null {
  const i0 = Math.max(0, Math.ceil(((cx - R) / g.ax) * g.w - 0.5));
  const i1 = Math.min(g.w - 1, Math.floor(((cx + R) / g.ax) * g.w - 0.5));
  const j0 = Math.max(0, Math.ceil(((cy - R) / g.ay) * g.h - 0.5));
  const j1 = Math.min(g.h - 1, Math.floor(((cy + R) / g.ay) * g.h - 0.5));
  return i0 > i1 || j0 > j1 ? null : { i0, i1, j0, j1 };
}

const boxArea = (b: Box | null) => (b ? (b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1) : 0);

/** centre of stamp i (1 ≤ i < n) of a record, in S units: push at p[i−1], restore at p[i] */
function stampCentre(rec: Stroke, i: number, g: LiquifyGrid): [number, number] {
  const k = rec.kind === 'push' ? i - 1 : i;
  return [rec.points[k * 2] * g.ax, rec.points[k * 2 + 1] * g.ay];
}

/** base work of a record (§3.6): the texel count of every stamp's clipped box */
export function strokeWork(rec: Stroke, frame: LiquifyFrame): number {
  const g = liquifyGrid(frame);
  const n = rec.points.length / 2;
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const [cx, cy] = stampCentre(rec, i, g);
    sum += boxArea(stampBox(g, cx, cy, rec.radius));
  }
  return sum;
}

// ───────────────────────── stroke building (§3.4) ─────────────────────────

export class StrokeBuilder {
  private readonly g: LiquifyGrid;
  private readonly step: number;
  /** emitted points, O UV, Float32-rounded */
  private readonly pts: number[] = [];
  /** last raw point and last emitted point, S units */
  private rx: number;
  private ry: number;
  private lx: number;
  private ly: number;
  private stopped = false;
  readonly kind: BrushKind;
  readonly radius: number;

  constructor(kind: BrushKind, radius: number, frame: LiquifyFrame, start: { x: number; y: number }) {
    this.kind = kind;
    this.radius = radius;
    this.g = liquifyGrid(frame);
    this.step = radius * STAMP_SPACING;
    const x = Math.fround(clampO(start.x));
    const y = Math.fround(clampO(start.y));
    this.pts.push(x, y);
    this.rx = this.lx = x * this.g.ax;
    this.ry = this.ly = y * this.g.ay;
  }

  /** points emitted so far */
  get count(): number {
    return this.pts.length / 2;
  }

  /** point i, O UV */
  point(i: number): { x: number; y: number } {
    return { x: this.pts[i * 2], y: this.pts[i * 2 + 1] };
  }

  private emit(sx: number, sy: number): void {
    const x = Math.fround(sx / this.g.ax);
    const y = Math.fround(sy / this.g.ay);
    this.pts.push(x, y);
    this.lx = x * this.g.ax;
    this.ly = y * this.g.ay;
  }

  /** feed a raw O-frame pointer point (clamped to [−1, 2]²); returns how many resampled points it emitted */
  add(o: { x: number; y: number }): number {
    if (this.stopped) return 0;
    const bx = clampO(o.x) * this.g.ax;
    const by = clampO(o.y) * this.g.ay;
    const ax = this.rx;
    const ay = this.ry;
    const dx = bx - ax;
    const dy = by - ay;
    const dd = dx * dx + dy * dy;
    let out = 0;
    if (dd > 0) {
      const h2 = this.step * this.step;
      let t0 = 0;
      for (;;) {
        // first t ≥ t0 where the raw segment leaves the circle of radius `step` about the last emitted point
        const fx = ax + t0 * dx - this.lx;
        const fy = ay + t0 * dy - this.ly;
        const fd = fx * dx + fy * dy;
        const disc = fd * fd - dd * (fx * fx + fy * fy - h2);
        if (disc < 0) break;
        const t = t0 + (-fd + Math.sqrt(disc)) / dd;
        if (!(t <= 1)) break;
        this.emit(ax + t * dx, ay + t * dy);
        out++;
        t0 = t;
      }
    }
    this.rx = bx;
    this.ry = by;
    return out;
  }

  /** stop accepting input (a cap was hit); `keep` = how many points to keep */
  stop(keep: number): void {
    this.stopped = true;
    this.pts.length = Math.min(this.pts.length, keep * 2);
  }

  /** finger up: emit the final point when the remainder is ≥ radius/8; returns 1 when it did */
  finishPoint(): number {
    if (this.stopped) return 0;
    this.stopped = true;
    const dx = this.rx - this.lx;
    const dy = this.ry - this.ly;
    if (dx * dx + dy * dy < (this.step / 2) * (this.step / 2)) return 0;
    this.emit(this.rx, this.ry);
    return 1;
  }

  /** the records (≤ MAX_STROKE_POINTS points each; a continuation repeats its predecessor's last point) */
  records(newId: () => string, strength: number): Stroke[] {
    const n = this.count;
    const out: Stroke[] = [];
    for (let s = 0; s < n - 1; s += MAX_STROKE_POINTS - 1) {
      const e = Math.min(n, s + MAX_STROKE_POINTS);
      out.push({ id: newId(), kind: this.kind, radius: this.radius, strength, points: Float32Array.from(this.pts.slice(s * 2, e * 2)) });
    }
    return out;
  }

  /** finish() of the spec: final point + records */
  finish(newId: () => string): Stroke[] {
    this.finishPoint();
    return this.records(newId, this.kind === 'push' ? PUSH_GAIN : RESTORE_GAIN);
  }
}

// ───────────────────────── stamp operators (§4.2, §4.3) ─────────────────────────

/** bilinear, clamp-to-edge read of `d` (RG) at O UV (u, v): fieldAt's arithmetic (src/body/cpuWarp.ts) */
function readField(d: Float32Array, w: number, h: number, u: number, v: number, out: Float64Array): void {
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 2; c++) {
    const a = d[(y0 * w + x0) * 2 + c] * (1 - fx) + d[(y0 * w + x1) * 2 + c] * fx;
    const b = d[(y1 * w + x0) * 2 + c] * (1 - fx) + d[(y1 * w + x1) * 2 + c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
}

interface StampResult {
  /** base work × (1 + bisection steps) */
  work: number;
  /** λ the stamp was applied with (0 = skipped by the guard) */
  lambda: number;
  /** any texel value changed */
  changed: boolean;
}

/** Shared scratch for the stamp operators (one stamp at a time). */
class Scratch {
  out = new Float32Array(0);
  backup = new Float32Array(0);
  tmp = new Float64Array(2);
  ensure(n: number): void {
    if (this.out.length < n) {
      this.out = new Float32Array(n);
      this.backup = new Float32Array(n);
    }
  }
  release(): void {
    this.out = new Float32Array(0);
    this.backup = new Float32Array(0);
  }
}

/** Copy the box of `d` to/from `buf` (row-major box order). */
function copyBox(d: Float32Array, w: number, b: Box, buf: Float32Array, toBuf: boolean): void {
  const bw = b.i1 - b.i0 + 1;
  for (let j = b.j0; j <= b.j1; j++) {
    const row = (j * w + b.i0) * 2;
    const at = (j - b.j0) * bw * 2;
    if (toBuf) buf.set(d.subarray(row, row + bw * 2), at);
    else d.set(buf.subarray(at, at + bw * 2), row);
  }
}

/**
 * Apply one stamp with gain g·λ into `f` (§4.2): push composes L' = toUV(B) + L(X + B) with B = −g·w·Δ, restore scales
 * L' = (1 − k·w)·L with the SNAP. Reads only pre-stamp values (computed into the scratch, then copied back).
 */
function applyStamp(
  f: LiquifyField,
  g: LiquifyGrid,
  b: Box,
  kind: BrushKind,
  cx: number,
  cy: number,
  ddx: number,
  ddy: number,
  R: number,
  gain: number,
  s: Scratch,
): void {
  const { width: w, height: h, data } = f;
  const R2 = R * R;
  const bw = b.i1 - b.i0 + 1;
  const out = s.out;
  const tmp = s.tmp;
  const snap2 = SNAP * SNAP;
  for (let j = b.j0; j <= b.j1; j++) {
    const v = (j + 0.5) / h;
    const ey = v * g.ay - cy;
    for (let i = b.i0; i <= b.i1; i++) {
      const u = (i + 0.5) / w;
      const ex = u * g.ax - cx;
      const d2 = ex * ex + ey * ey;
      const k = (j * w + i) * 2;
      const o = ((j - b.j0) * bw + (i - b.i0)) * 2;
      if (d2 >= R2) {
        out[o] = data[k];
        out[o + 1] = data[k + 1];
        continue;
      }
      const q = 1 - d2 / R2;
      const wt = q * q * q;
      if (kind === 'push') {
        const bu = (-gain * wt * ddx) / g.ax;
        const bv = (-gain * wt * ddy) / g.ay;
        readField(data, w, h, u + bu, v + bv, tmp);
        out[o] = bu + tmp[0];
        out[o + 1] = bv + tmp[1];
      } else {
        const m = 1 - gain * wt;
        const nx = m * data[k];
        const ny = m * data[k + 1];
        if (nx * nx + ny * ny < snap2) {
          out[o] = 0;
          out[o + 1] = 0;
        } else {
          out[o] = nx;
          out[o + 1] = ny;
        }
      }
    }
  }
  copyBox(data, w, b, out, false);
}

/** One guarded stamp (§4.3): apply, check the box + 1 texel, bisect λ on a failure. */
function guardedStamp(
  f: LiquifyField,
  g: LiquifyGrid,
  rec: Stroke,
  i: number,
  s: Scratch,
  beforeWrite: (b: Box) => void,
): StampResult {
  const [cx, cy] = stampCentre(rec, i, g);
  const b = stampBox(g, cx, cy, rec.radius);
  if (!b) return { work: 0, lambda: 1, changed: false };
  const area = boxArea(b);
  const P = rec.points;
  const ddx = rec.kind === 'push' ? (P[i * 2] - P[(i - 1) * 2]) * g.ax : 0;
  const ddy = rec.kind === 'push' ? (P[i * 2 + 1] - P[(i - 1) * 2 + 1]) * g.ay : 0;
  beforeWrite(b);
  s.ensure(area * 2);
  copyBox(f.data, f.width, b, s.backup, true);
  const ok = () => fieldMinJacobianRect(f, b.i0 - 1, b.j0 - 1, b.i1 + 1, b.j1 + 1) >= LIQUIFY_MIN_DET;
  const run = (lambda: number) => applyStamp(f, g, b, rec.kind, cx, cy, ddx, ddy, rec.radius, rec.strength * lambda, s);
  run(1);
  let lambda = 1;
  let steps = 0;
  if (!ok()) {
    let lo = 0;
    let hi = 1;
    for (; steps < GUARD_STEPS; steps++) {
      copyBox(f.data, f.width, b, s.backup, false);
      const m = (lo + hi) / 2;
      run(m);
      if (ok()) lo = m;
      else hi = m;
    }
    copyBox(f.data, f.width, b, s.backup, false);
    if (lo > 0) run(lo);
    lambda = lo;
  }
  let changed = false;
  const bw = b.i1 - b.i0 + 1;
  for (let j = b.j0; j <= b.j1 && !changed; j++) {
    const row = (j * f.width + b.i0) * 2;
    const at = (j - b.j0) * bw * 2;
    for (let k = 0; k < bw * 2; k++) {
      if (f.data[row + k] !== s.backup[at + k]) {
        changed = true;
        break;
      }
    }
  }
  return { work: area * (1 + steps), lambda, changed };
}

// ───────────────────────── the model (§3.5) ─────────────────────────

interface Group {
  /** tile index → its values before the group's first write; null = evicted (an undo of it rebuilds) */
  patch: Map<number, Float32Array> | null;
  /** bytes held by `patch` */
  bytes: number;
  /** clock time a live gesture began; -1 once committed, and for replayed records */
  liveSince: number;
}

interface AppliedRec {
  rec: Stroke;
  /** actual work (§3.6) */
  work: number;
  /** the patch group: one per committed gesture, one per replayed record */
  group: Group;
}

export interface LiveStroke {
  /** feed a raw O-frame pointer point; true when the field changed */
  add(o: { x: number; y: number }): boolean;
  /** ring colour (§2.3): resisting = the last stamp was skipped by the guard; capped = a cap refused a stamp */
  readonly state: 'ok' | 'resisting' | 'capped';
  /** a stamp of this gesture changed a texel (a gesture without one is a tap: it may fit the view) */
  readonly stamped: boolean;
  /** finger up: the records under fresh ids; [] for a no-op gesture */
  commit(newId: () => string): Stroke[];
  /** restore the gesture's tiles (second finger within the grace) */
  cancel(): void;
}

export interface LiquifyModelOptions {
  /** ms clock (default performance.now) */
  now?: () => number;
  /** runs `cb` on a later animation frame and returns a canceller (default requestAnimationFrame) */
  schedule?: (cb: () => void) => () => void;
  /** a chunked rebuild finished: `field` now matches the last sync target */
  onSettled?: () => void;
  /** test hooks; defaults from src/config/limits.ts */
  patchBudget?: number;
  syncWork?: number;
  sliceMs?: number;
  workCap?: number;
}

interface Job {
  target: readonly Stroke[];
  /** the buffer being filled; swapped into the field when the job finishes */
  buf: LiquifyField;
  applied: AppliedRec[];
  groups: Group[];
  rec: number;
  stamp: number;
  cancel: (() => void) | null;
}

let versionCounter = 0;

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id);
const isPrefix = (p: readonly { id: string }[], of: readonly { id: string }[]) =>
  p.length <= of.length && p.every((r, i) => r.id === of[i].id);
const recsOf = (a: readonly AppliedRec[]) => a.map((x) => x.rec);

const defaultSchedule = (cb: () => void): (() => void) => {
  const id = requestAnimationFrame(cb);
  return () => cancelAnimationFrame(id);
};

export class LiquifyModel {
  private readonly frame: LiquifyFrame;
  private readonly g: LiquifyGrid;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => () => void;
  private readonly onSettled: () => void;
  private readonly patchBudget: number;
  private readonly syncWork: number;
  private readonly sliceMs: number;
  private readonly workCap: number;
  private readonly scratch = new Scratch();
  private _field: LiquifyField | null = null;
  private applied: AppliedRec[] = [];
  private groups: Group[] = [];
  private job: Job | null = null;
  private live: Group | null = null;

  constructor(frame: LiquifyFrame, opts: LiquifyModelOptions = {}) {
    this.frame = { width: frame.width, height: frame.height };
    this.g = liquifyGrid(this.frame);
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? defaultSchedule;
    this.onSettled = opts.onSettled ?? (() => undefined);
    this.patchBudget = opts.patchBudget ?? PATCH_BUDGET;
    this.syncWork = opts.syncWork ?? LIQUIFY_SYNC_WORK;
    this.sliceMs = opts.sliceMs ?? LIQUIFY_SLICE_MS;
    this.workCap = opts.workCap ?? LIQUIFY_WORK_CAP;
  }

  /** the field for the records applied so far; null = no strokes (nothing allocated) */
  get field(): LiquifyField | null {
    return this._field;
  }

  /** a rebuild is running in slices: `field` still shows the previous strokes */
  get pending(): boolean {
    return this.job !== null;
  }

  /** actual work of the applied records (§3.6) */
  get work(): number {
    let s = 0;
    for (const a of this.applied) s += a.work;
    return s;
  }

  /** records applied to the field, in replay order */
  get count(): number {
    return this.applied.length;
  }

  /** the records applied to the field, in replay order (shared with EditState, never copied) */
  get records(): Stroke[] {
    return recsOf(this.applied);
  }

  /** bytes held by the undo patch ring */
  get patchBytes(): number {
    let n = 0;
    for (const g of this.allGroups()) n += g.bytes;
    return n;
  }

  private allGroups(): Group[] {
    return this.job ? [...this.groups, ...this.job.groups] : this.groups;
  }

  private ensureField(): LiquifyField {
    this._field ??= {
      width: this.g.w,
      height: this.g.h,
      data: new Float32Array(this.g.w * this.g.h * 2),
      version: ++versionCounter,
    };
    return this._field;
  }

  private free(): void {
    this.job?.cancel?.();
    this.job = null;
    this._field = null;
    this.applied = [];
    this.groups = [];
    this.live = null;
    this.scratch.release();
  }

  // ── patches (copy-on-write tiles) ──

  private tileBox(t: number): Box {
    const tw = Math.ceil(this.g.w / PATCH_TILE);
    const tx = t % tw;
    const ty = Math.floor(t / tw);
    return {
      i0: tx * PATCH_TILE,
      i1: Math.min(this.g.w, (tx + 1) * PATCH_TILE) - 1,
      j0: ty * PATCH_TILE,
      j1: Math.min(this.g.h, (ty + 1) * PATCH_TILE) - 1,
    };
  }

  /** save every tile of `b` that `group` has not saved yet, then keep the ring within its budget */
  private patchBox(group: Group, data: Float32Array, b: Box): void {
    if (!group.patch) return;
    const tw = Math.ceil(this.g.w / PATCH_TILE);
    let added = false;
    for (let ty = Math.floor(b.j0 / PATCH_TILE); ty <= Math.floor(b.j1 / PATCH_TILE); ty++) {
      for (let tx = Math.floor(b.i0 / PATCH_TILE); tx <= Math.floor(b.i1 / PATCH_TILE); tx++) {
        const t = ty * tw + tx;
        if (group.patch.has(t)) continue;
        const tb = this.tileBox(t);
        const buf = new Float32Array(boxArea(tb) * 2);
        copyBox(data, this.g.w, tb, buf, true);
        group.patch.set(t, buf);
        group.bytes += buf.byteLength;
        added = true;
      }
    }
    if (added) this.enforceBudget();
  }

  /** evict the oldest groups' patches until the ring fits; a live gesture is exempt during its cancel grace */
  private enforceBudget(): void {
    const all = this.allGroups();
    let total = 0;
    for (const g of all) total += g.bytes;
    for (const g of all) {
      if (total <= this.patchBudget) return;
      if (!g.patch) continue;
      if (g.liveSince >= 0 && this.now() - g.liveSince <= PINCH_GRACE_MS) continue;
      total -= g.bytes;
      g.patch = null;
      g.bytes = 0;
    }
  }

  private revertGroup(group: Group, data: Float32Array): void {
    for (const [t, buf] of group.patch!) copyBox(data, this.g.w, this.tileBox(t), buf, false);
  }

  // ── replay ──

  /** stamps of `rec` from index `from` into `buf` while `more()` (at least one); returns the next stamp index */
  private replay(buf: LiquifyField, rec: Stroke, from: number, group: Group, more: () => boolean, spend: (w: number) => void): number {
    const n = rec.points.length / 2;
    let i = from;
    for (; i < n; i++) {
      if (i > from && !more()) break;
      spend(guardedStamp(buf, this.g, rec, i, this.scratch, (b) => this.patchBox(group, buf.data, b)).work);
    }
    return i;
  }

  /**
   * Fill a staging buffer with `target`, starting from the applied prefix `keep` (0 = from zero): synchronously while
   * the work stays within syncWork, then in sliceMs slices. The displayed field is untouched until the swap.
   */
  private runJob(target: readonly Stroke[], keep: number): { changed: boolean; pending: boolean } {
    this.job?.cancel?.();
    this.job = null;
    if (keep === 0) {
      // a rebuild from zero: every old patch describes a buffer that is about to be replaced
      for (const g of this.groups) {
        g.patch = null;
        g.bytes = 0;
      }
      this.groups = [];
    }
    const cur = this._field;
    const data = keep > 0 && cur ? cur.data.slice() : new Float32Array(this.g.w * this.g.h * 2);
    const buf: LiquifyField = { width: this.g.w, height: this.g.h, data, version: 0 };
    const job: Job = { target, buf, applied: this.applied.slice(0, keep), groups: [], rec: keep, stamp: 1, cancel: null };
    this.job = job;
    let spent = 0;
    if (this.advance(job, () => spent <= this.syncWork, (w) => (spent += w))) return { changed: true, pending: false };
    const slice = () => {
      job.cancel = null;
      if (this.job !== job) return;
      const t0 = this.now();
      if (this.advance(job, () => this.now() - t0 < this.sliceMs, () => undefined)) this.onSettled();
      else job.cancel = this.schedule(slice);
    };
    job.cancel = this.schedule(slice);
    return { changed: true, pending: true };
  }

  /** advance a job while `more()`; true once it finished (the field then holds its buffer) */
  private advance(job: Job, more: () => boolean, spend: (w: number) => void): boolean {
    while (job.rec < job.target.length) {
      const rec = job.target[job.rec];
      let entry = job.applied[job.rec];
      if (!entry) {
        const group: Group = { patch: new Map(), bytes: 0, liveSince: -1 };
        job.groups.push(group);
        entry = { rec, work: 0, group };
        job.applied.push(entry);
      }
      const e = entry;
      const next = this.replay(job.buf, rec, job.stamp, e.group, more, (w) => {
        e.work += w;
        spend(w);
      });
      if (next < rec.points.length / 2) {
        job.stamp = next;
        return false;
      }
      job.rec++;
      job.stamp = 1;
      if (job.rec < job.target.length && !more()) return false;
    }
    // the swap: the field object keeps its identity (the session holds it), its buffer and version change
    if (this._field) {
      this._field.data = job.buf.data;
      this._field.version = ++versionCounter;
    } else this._field = { ...job.buf, version: ++versionCounter };
    this.applied = job.applied;
    this.groups = [...this.groups, ...job.groups];
    this.job = null;
    this.enforceBudget();
    return true;
  }

  /**
   * Bring the field to exactly these strokes (§3.5): equal → nothing; an extension → apply the extra records; a prefix
   * whose removed gestures still hold their patches → copy them back; anything else → rebuild. [] frees everything.
   * Ignored during a live stroke (the editor re-syncs when the stroke ends).
   */
  sync(target: readonly Stroke[]): { changed: boolean; pending: boolean } {
    if (this.live) return { changed: false, pending: false };
    if (target.length === 0) {
      const had = this._field !== null;
      this.free();
      return { changed: had, pending: false };
    }
    const applied = recsOf(this.applied);
    if (this.job) {
      if (sameIds(target, this.job.target)) return { changed: false, pending: true };
      return this.runJob(target, isPrefix(applied, target) ? applied.length : 0);
    }
    if (sameIds(target, applied)) return { changed: false, pending: false };
    if (isPrefix(applied, target)) return this.runJob(target, applied.length);
    if (isPrefix(target, applied) && this.revertTo(target.length)) return { changed: true, pending: false };
    return this.runJob(target, 0);
  }

  /** copy the removed groups' patches back, newest first; false when a boundary or a patch is missing */
  private revertTo(keep: number): boolean {
    const removed = this.applied.slice(keep);
    if (keep > 0 && this.applied[keep - 1].group === removed[0].group) return false;
    const gs: Group[] = [];
    for (const a of removed) if (gs[gs.length - 1] !== a.group) gs.push(a.group);
    if (gs.some((g) => !g.patch)) return false;
    const f = this._field!;
    for (let k = gs.length - 1; k >= 0; k--) this.revertGroup(gs[k], f.data);
    this.groups = this.groups.filter((g) => !gs.includes(g));
    this.applied = this.applied.slice(0, keep);
    f.version = ++versionCounter;
    return true;
  }

  /** start a gesture; null when a cap is already reached or a rebuild is pending */
  begin(kind: BrushKind, radius: number, start: { x: number; y: number }): LiveStroke | null {
    if (this.live || this.job) return null;
    if (this.applied.length >= MAX_STROKES || this.work >= this.workCap) return null;
    const f = this.ensureField();
    const g = this.g;
    const R = clampRadius(radius, this.frame);
    const strength = kind === 'push' ? PUSH_GAIN : RESTORE_GAIN;
    const builder = new StrokeBuilder(kind, R, this.frame, start);
    const group: Group = { patch: new Map(), bytes: 0, liveSince: this.now() };
    this.groups.push(group);
    this.live = group;
    const appliedCount = this.applied.length;
    const appliedWork = this.work;
    /** actual work of the stamp at point n */
    const works: number[] = [];
    let gestureWork = 0;
    let state: LiveStroke['state'] = 'ok';
    let stamped = false;
    let ended = false;
    const end = () => {
      ended = true;
      this.live = null;
      group.liveSince = -1;
    };
    /** the stamp at point n ≥ 1; false when it would cross a cap (§3.6) */
    const stampAt = (n: number): boolean => {
      const p0 = builder.point(n - 1);
      const p1 = builder.point(n);
      const two: Stroke = { id: '', kind, radius: R, strength, points: Float32Array.of(p0.x, p0.y, p1.x, p1.y) };
      const [cx, cy] = stampCentre(two, 1, g);
      const base = boxArea(stampBox(g, cx, cy, R));
      const records = appliedCount + Math.ceil(n / (MAX_STROKE_POINTS - 1));
      if (records > MAX_STROKES || appliedWork + gestureWork + base > this.workCap) return false;
      const r = guardedStamp(f, g, two, 1, this.scratch, (b) => this.patchBox(group, f.data, b));
      works[n] = r.work;
      gestureWork += r.work;
      if (r.changed) {
        stamped = true;
        f.version = ++versionCounter;
      }
      state = r.lambda === 0 ? 'resisting' : 'ok';
      return true;
    };
    const feed = (count: number): boolean => {
      let changed = false;
      for (let n = builder.count - count; n < builder.count; n++) {
        if (!stampAt(n)) {
          builder.stop(n);
          state = 'capped';
          break;
        }
        changed = true;
      }
      return changed;
    };
    const dropGroup = () => {
      this.groups = this.groups.filter((x) => x !== group);
    };
    return {
      add: (o) => (ended || state === 'capped' ? false : feed(builder.add(o))),
      get state() {
        return state;
      },
      get stamped() {
        return stamped;
      },
      commit: (newId) => {
        if (ended) return [];
        if (state !== 'capped') feed(builder.finishPoint());
        end();
        if (!stamped) {
          dropGroup();
          if (this.applied.length === 0) this.free();
          return [];
        }
        const recs = builder.records(newId, strength);
        recs.forEach((rec, r) => {
          const s0 = r * (MAX_STROKE_POINTS - 1);
          let w = 0;
          for (let n = s0 + 1; n < s0 + rec.points.length / 2; n++) w += works[n] ?? 0;
          this.applied.push({ rec, work: w, group });
        });
        this.enforceBudget();
        return recs;
      },
      cancel: () => {
        if (ended) return;
        end();
        dropGroup();
        if (this.applied.length === 0) {
          this.free();
          return;
        }
        if (group.patch) {
          this.revertGroup(group, f.data);
          f.version = ++versionCounter;
        } else this.runJob(recsOf(this.applied), 0);
      },
    };
  }

  /**
   * The largest |L| over the texels covering an O rect, as a length in long-edge units: sqrt((dx·W)² + (dy·H)²) / max(W, H)
   * for the frame's W × H. Multiplied by the long edge of any decode of this frame it is a pixel length (step 3's planner
   * does exactly that with TileBounds.liquifyMaxDisp).
   */
  private maxAbsIn(r: Rect): number {
    const f = this._field!;
    const { w, h } = this.g;
    const long = Math.max(this.frame.width, this.frame.height);
    const kx = this.frame.width / long;
    const ky = this.frame.height / long;
    const i0 = Math.max(0, Math.floor(r.x * w - 0.5));
    const i1 = Math.min(w - 1, Math.ceil((r.x + r.w) * w - 0.5));
    const j0 = Math.max(0, Math.floor(r.y * h - 0.5));
    const j1 = Math.min(h - 1, Math.ceil((r.y + r.h) * h - 0.5));
    let m2 = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = (j * w + i) * 2;
        const dx = f.data[k] * kx;
        const dy = f.data[k + 1] * ky;
        m2 = Math.max(m2, dx * dx + dy * dy);
      }
    }
    return Math.sqrt(m2);
  }

  /**
   * An upper bound of |L| over an O rect in long-edge units (see maxAbsIn): the largest covering texel plus one texel
   * (§4.4). This is TileBounds.liquifyMaxDisp: the planner multiplies it by the decode's long edge.
   */
  maxDisp(r: Rect): number {
    if (!this._field) return 0;
    const long = Math.max(this.frame.width, this.frame.height);
    return this.maxAbsIn(r) + Math.max(this.frame.width / long / this.g.w, this.frame.height / long / this.g.h);
  }

  /** the largest |L| over the whole frame, long-edge units (debug: __meiyan.liquify.maxDisp); 0 without strokes */
  get maxAbs(): number {
    return this._field ? this.maxAbsIn({ x: 0, y: 0, w: 1, h: 1 }) : 0;
  }

  /** finish a pending rebuild now (an export or a history flush needs the committed strokes) */
  settle(): void {
    const job = this.job;
    if (!job) return;
    job.cancel?.();
    job.cancel = null;
    this.advance(job, () => true, () => undefined);
  }

  /** o + L(o), bilinear: a tap on the output → the auto-warped image (§4.5) */
  backward(o: { x: number; y: number }): { x: number; y: number } {
    const f = this._field;
    if (!f) return { x: o.x, y: o.y };
    const t = new Float64Array(2);
    readField(f.data, f.width, f.height, o.x, o.y, t);
    return { x: o.x + t[0], y: o.y + t[1] };
  }

  /** a copy of the field for an export asked for now (like the Editor's snapshotField) */
  snapshot(): LiquifyField | null {
    const f = this._field;
    return f ? { ...f, data: f.data.slice() } : null;
  }

  dispose(): void {
    this.free();
  }
}


// ───────────────────────── ids, sanitize ─────────────────────────

/** 8 base-36 characters from `rand` (crypto.getRandomValues), redrawn on a collision with `taken` */
export function makeStrokeId(taken: ReadonlySet<string>, rand: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  for (;;) {
    const bytes = rand(new Uint8Array(8));
    let id = '';
    for (const b of bytes) id += (b % 36).toString(36);
    if (!taken.has(id)) return id;
  }
}

/** §5.2: drop malformed records and everything from the first over-cap record on; null frame drops all */
export function sanitizeStrokes(raw: unknown, frame: LiquifyFrame | null): Stroke[] {
  if (!frame || !Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  const ids = new Set<string>();
  let work = 0;
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue;
    const s = r as Record<string, unknown>;
    if (s.kind !== 'push' && s.kind !== 'restore') continue;
    if (typeof s.id !== 'string' || s.id.length < 1 || s.id.length > 64 || ids.has(s.id)) continue;
    let pts: Float32Array;
    if (s.points instanceof Float32Array) pts = s.points;
    else if (Array.isArray(s.points) && s.points.every((v) => typeof v === 'number')) pts = Float32Array.from(s.points as number[]);
    else continue;
    const n = pts.length / 2;
    if (pts.length % 2 !== 0 || n < 2 || n > MAX_STROKE_POINTS) continue;
    if (!pts.every((v) => Number.isFinite(v) && v >= -1 && v <= 2)) continue;
    if (typeof s.radius !== 'number' || !Number.isFinite(s.radius)) continue;
    if (typeof s.strength !== 'number' || !Number.isFinite(s.strength)) continue;
    const rec: Stroke = { id: s.id, kind: s.kind, radius: clampRadius(s.radius, frame), strength: Math.min(1, Math.max(0, s.strength)), points: pts };
    work += strokeWork(rec, frame);
    if (out.length + 1 > MAX_STROKES || work > LIQUIFY_WORK_CAP) break;
    ids.add(rec.id);
    out.push(rec);
  }
  return out;
}
```

Notes for the reviewer, each pinned by a test above:
- `sync` compares record **ids** (`recsOf(this.applied)` against the target): passing `this.applied` straight to `sameIds` is a type error that would silently turn every extension into a full rebuild.
- The live path stamps from 2-point records built from the Float32-rounded points, so preview, commit and replay run identical arithmetic (`determinism` tests).
- A gesture is refused a stamp when `records > MAX_STROKES` or `work + gesture work + this stamp's base work > workCap`; it then keeps only the points it stamped (`builder.stop(n)`), so its records replay exactly what was drawn.

- [x] **Step 5: Write the stroke fixtures, then run the tests**

Run: `WRITE_STROKE_FIXTURES=1 npx vitest run src/edit/liquify.test.ts -t "stroke fixtures"`
Expected: PASS, 2 tests; `tests/fixtures/strokes_s30.json` and `tests/fixtures/strokes_cap.json` now exist (LF, one line each; S30 a few KB, SCAP some tens of KB).

Run: `npx vitest run src/edit/liquify.test.ts`
Expected: PASS, 37 tests (about 16 s; the fuzz is about 12 s of it). Running it a second time changes neither file (`git status --short tests/fixtures` lists only the two new files).

Run: `npm run typecheck`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/edit/liquify.ts src/edit/strokeFixtures.ts src/edit/liquify.test.ts tests/fixtures/strokes_s30.json tests/fixtures/strokes_cap.json
git commit -m "feat(liquify): stroke model, stamp operators, fold guard and LiquifyModel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Strokes in EditState, sanitize, the liquify frame and persistence

Strokes become part of the undoable, persisted edit (C §3.2, §3.4, §5; PB §3.3, §3.7 rows `state.ts`, `migrate.ts`, `ui/state.ts`, `flows.ts`; PB §5). The grid is built on the history entry's stored size, never the decode size, so a tier-L reopen replays bit for bit (PB §3.3, §7; PB §8.1's history row).

**Files:**
- Modify: `src/types.ts` (CRLF; `PhotoParams`, created by step 1 from C §3.2; `types.ts:231-246` at `d09e608`)
- Modify: `src/edit/state.ts`, `src/edit/state.test.ts` (step 1; LF; at `d09e608`: `defaultPhoto` `:61-66`, `editKey` `:69-71`, `sanitizePhoto` `:272-295`, `sanitizeEditState` `:309-323`)
- Modify: `src/edit/legacy.ts` (LF; `splitLegacy`'s photo literal, `:16` at `d09e608`)
- Modify: `src/edit/migrate.ts`, `src/edit/migrate.test.ts` (step 1, PS §5.3; LF; `OpenedState` `:17-28`, `openState` `:50-86` at `d09e608`)
- Modify: `src/ui/state.ts` (CRLF; `EditorSource`, `state.ts:35-62` at `d09e608`)
- Modify: `src/ui/flows.ts` (CRLF; `freshSource` / `openInEditor`, `flows.ts:16-53` at `d09e608`)
- Unchanged: `src/store/history.ts` (LF; `normalizeEntry` already sanitizes with `sanitizeEditState(r.edit, null, { width, height })`, step 3, `:214` at `d09e608`)
- Modify: `src/store/history.test.ts`

**Interfaces:**
- Consumes (step-1 plan Tasks 4, 5, 6, 8, 9, 12; step-3 plan Task 3): `EditState`, `PhotoParams`, `defaultPhoto()`, `naturalPerson()`, `neutralPerson()`, `resetAll(edit)` (重置), `editKey(edit)` (step 1: `stableKey(edit)`), `sanitizePhoto(raw, persons)` (builds the photo layer as a literal), `sanitizeEditState(raw, personIds | null, oSize?: Size)` (step 3 added `oSize`, delta D13), `isEditStateRecord(raw)`, `lensFor(edit, sel, persons, primary)` and `P0_INFO` (`src/edit/lens.ts`) with `Lens.applyPreset(id, amount)` and `Lens.resetGroup(group)`, `openState(entry, size): OpenedState` (`{ edit, detect, needsFaceDetect, rematch, v1Body, cacheDropped }`; step 3 makes it pass `{ width: entry.width, height: entry.height }` to `sanitizeEditState`), `normalizeEntry(raw)` in `src/store/history.ts` (step 1 sanitizes `r.edit` there), `freshSource(bitmap, edit, returnTo, faceSeed?)` and `openInEditor(blob, { entry?, returnTo })` in `src/ui/flows.ts`, `stableKey` (`src/store/undo.ts:65`). Task 2: `sanitizeStrokes`, `rMin`, `LiquifyFrame`, `Stroke`.
- Produces:
  - `PhotoParams.strokes: readonly Stroke[]` (replay order); `defaultPhoto().strokes` is `[]`.
  - `withStrokes(edit: EditState, recs: readonly Stroke[]): EditState` — appends; shares the existing records by reference; returns `edit` itself for `[]`.
  - `clearStrokes(edit: EditState): EditState` — `strokes: []`; returns `edit` itself when there are none.
  - `editKey(edit)` serializes each stroke as its `id` (never its points).
  - `sanitizeEditState(raw, personIds, oSize?)` sets `photo.strokes = sanitizeStrokes(raw.photo.strokes, oSize ?? null)`.
  - `OpenedState.frame: LiquifyFrame` = `{ width: entry.width, height: entry.height }` (the same object step 3 passes to `sanitizeEditState`).
  - `EditorSource.frame: LiquifyFrame` (a reopen: `openState(...).frame`; a new import or camera shot: the decoded bitmap's size, set by `freshSource`, which the first `addEntry` stores as `width × height`, `writeHistory`, `Editor.tsx:739-770` at `d09e608`).
  - `normalizeEntry` sanitizes a stored v2 edit with the record's own `{ width, height }` as `oSize`, so `getEntry` / `listEntries` keep the strokes (and step 3's geometry) instead of dropping them for want of a frame.

- [x] **Step 1: Write the failing tests**

Append to `src/edit/state.test.ts` (merge the imports into the file's existing import lines):

```ts
import type { EditState, Stroke } from '../types';
import { clearStrokes, defaultPhoto, editKey, naturalPerson, neutralPerson, resetAll, sanitizeEditState, withStrokes } from './state';
import { lensFor, P0_INFO } from './lens';

describe('strokes in EditState (push-brush spec §3.4, §5)', () => {
  const rec = (id: string, x = 0.3): Stroke => ({ id, kind: 'push', radius: 0.05, strength: 0.75, points: Float32Array.of(x, 0.3, x + 0.0125, 0.3) });
  const base = (): EditState => ({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
  const SIZE = { width: 1536, height: 2048 };

  it('defaultPhoto has no strokes; withStrokes appends and shares the records already there', () => {
    expect(defaultPhoto().strokes).toEqual([]);
    const e0 = base();
    expect(withStrokes(e0, [])).toBe(e0);
    const a = rec('a');
    const e1 = withStrokes(e0, [a]);
    const e2 = withStrokes(e1, [rec('b'), rec('c')]);
    expect(e2.photo.strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(e2.photo.strokes[0]).toBe(a); // shared, never copied
    expect(e0.photo.strokes).toEqual([]); // immutable
  });

  it('clearStrokes empties the list and returns the same object when there is nothing to clear', () => {
    const e0 = base();
    expect(clearStrokes(e0)).toBe(e0);
    const e1 = clearStrokes(withStrokes(e0, [rec('a')]));
    expect(e1.photo.strokes).toEqual([]);
    expect(editKey(e1)).toBe(editKey(e0));
  });

  it('editKey compares strokes by id: equal for the same ids with other points, different for other ids', () => {
    const e0 = base();
    const a1 = withStrokes(e0, [rec('a', 0.3)]);
    const a2 = withStrokes(e0, [rec('a', 0.6)]);
    const b = withStrokes(e0, [rec('b', 0.3)]);
    expect(editKey(a1)).toBe(editKey(a2));
    expect(editKey(a1)).not.toBe(editKey(b));
    expect(editKey(a1)).not.toBe(editKey(e0));
    expect(editKey(a1)).not.toContain('0.30000001'); // no point is ever serialized
  });

  it('sanitizeEditState keeps valid strokes with the O size and drops them without one (the camera look)', () => {
    const raw = withStrokes(base(), [rec('ok'), { ...rec('bad'), kind: 'twirl' } as unknown as Stroke]);
    const withSize = sanitizeEditState(structuredClone(raw), ['p0'], SIZE);
    expect(withSize.photo.strokes.map((s) => s.id)).toEqual(['ok']);
    expect(withSize.photo.strokes[0].points).toBeInstanceOf(Float32Array);
    expect(sanitizeEditState(structuredClone(raw), ['p0']).photo.strokes).toEqual([]);
    // an entry written before step 6 has no `strokes` field at all
    const old = structuredClone(base()) as unknown as { photo: Record<string, unknown> };
    delete old.photo.strokes;
    expect(sanitizeEditState(old, ['p0'], SIZE).photo.strokes).toEqual([]);
  });

  it('presets and ⊘ never touch strokes (C §3.4); 重置 clears them (defaultPhoto has none)', () => {
    const e = withStrokes(base(), [rec('a')]);
    const lens = lensFor(e, { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(lens.applyPreset('refined', 1).photo.strokes).toBe(e.photo.strokes);
    expect(lens.applyPreset('original', 1).photo.strokes).toBe(e.photo.strokes);
    expect(lens.resetGroup('shape').photo.strokes).toBe(e.photo.strokes);
    expect(lens.resetGroup('body').photo.strokes).toBe(e.photo.strokes);
    expect(defaultPhoto().strokes).toHaveLength(0);
    expect(resetAll(e).photo.strokes).toEqual([]); // 重置 is one undo step that removes every stroke
  });
});
```

Append to `src/edit/migrate.test.ts` (merge imports; `defaultParams` is `src/engine/params.ts`; the helper names below avoid step 1's `v1()` / `v2()`):

```ts
import { defaultParams } from '../engine/params';
import type { EditState, HistoryEntry, Stroke } from '../types';
import { defaultPhoto, naturalPerson, neutralPerson } from './state';
import { openState } from './migrate';

describe('openState: the liquify frame (push-brush spec §3.3, §5)', () => {
  const rec = (id: string): Stroke => ({ id, kind: 'push', radius: 0.05, strength: 0.75, points: Float32Array.of(0.3, 0.3, 0.3125, 0.3) });
  const withStrokesEntry = (strokes: unknown[]): HistoryEntry => {
    const edit = { v: 2, photo: { ...defaultPhoto(), strokes }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null } as unknown as EditState;
    return { id: 'e1', createdAt: 1, updatedAt: 1, original: new Blob(['o']), thumb: new Blob(['t']), width: 1536, height: 2048, params: defaultParams(), schema: 2, edit } as HistoryEntry;
  };

  it('frame comes from the entry, not the decode (a tier-L reopen decodes at 1440)', () => {
    const st = openState(withStrokesEntry([rec('a')]), { width: 1080, height: 1440 });
    expect(st.frame).toEqual({ width: 1536, height: 2048 });
    expect(st.edit.photo.strokes.map((s) => s.id)).toEqual(['a']);
  });

  // PB §5.2 is normative: a malformed record drops alone (rules 1–4); only the caps (rule 5) drop everything after them.
  // (PB §7's row "along with every later record" contradicts §5.2; this plan follows §5.2.)
  it('drops only the corrupt record and keeps the replay order of the rest', () => {
    const bad = { ...rec('x'), points: Float32Array.of(0.3, NaN, 0.31, 0.3) };
    const st = openState(withStrokesEntry([rec('a'), bad, rec('b')]), { width: 1536, height: 2048 });
    expect(st.edit.photo.strokes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('a v1 entry has no strokes', () => {
    const v1Entry = { id: 'e0', createdAt: 1, updatedAt: 1, original: new Blob(['o']), thumb: new Blob(['t']), width: 1536, height: 2048, params: defaultParams() } as HistoryEntry;
    const st = openState(v1Entry, { width: 1536, height: 2048 });
    expect(st.edit.photo.strokes).toEqual([]);
    expect(st.frame).toEqual({ width: 1536, height: 2048 });
  });
});
```

Append to `src/store/history.test.ts` (it already installs fake-indexeddb, `history.test.ts:1-40`; merge imports):

```ts
import { rMin } from '../edit/liquify';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import type { EditState, Stroke } from '../types';

describe('v2 entries with strokes (push-brush spec §5.1, §5.2)', () => {
  const edit = (strokes: Stroke[]): EditState => ({
    v: 2,
    photo: { ...defaultPhoto(), strokes },
    persons: { p0: naturalPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });

  it('round-trips the stroke records with their Float32Array points', async () => {
    const points = Float32Array.of(0.3, 0.3, 0.3125, 0.3, 0.325, 0.31);
    const id = await addEntry({ ...entry('s'), schema: 2, edit: edit([{ id: 'k1', kind: 'push', radius: 0.05, strength: 0.75, points }]) });
    const got = await getEntry(id);
    const s = got!.edit!.photo.strokes[0];
    expect(s.points).toBeInstanceOf(Float32Array);
    expect(Array.from(s.points)).toEqual(Array.from(points));
    expect(s.id).toBe('k1');
  });

  it("drops a corrupt record on read and sanitizes on the entry's own width × height", async () => {
    const ok = (id: string, radius = 0.05): Stroke => ({ id, kind: 'push', radius, strength: 0.75, points: Float32Array.of(0.3, 0.3, 0.3125, 0.3) });
    const bad = { ...ok('x'), points: Float32Array.of(0.3, NaN, 0.31, 0.3) };
    // entry('s') is 1536 × 2048: a radius of 0 clamps to rMin of exactly that frame (4 texels of its 384-wide grid)
    const id = await addEntry({ ...entry('s'), schema: 2, edit: edit([ok('a'), bad, ok('b', 0)]) });
    const got = (await getEntry(id))!.edit!.photo.strokes;
    expect(got.map((s) => s.id)).toEqual(['a', 'b']);
    expect(got[1].radius).toBe(rMin({ width: 1536, height: 2048 }));
    expect((await listEntries())[0].edit!.photo.strokes).toHaveLength(2);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/edit/state.test.ts src/edit/migrate.test.ts src/store/history.test.ts`
Expected: FAIL — `withStrokes` / `clearStrokes` are not exported, `defaultPhoto().strokes` is `undefined`, `st.frame` is `undefined`, the history read has no strokes at all (`sanitizePhoto`'s literal does not copy the field yet) (and TS errors on `photo.strokes`).

- [x] **Step 3: Add `strokes` to `PhotoParams`**

In `src/types.ts`, in `interface PhotoParams` (C §3.2), after the last field steps 1–5 added (`spots` from step 4):

```ts
  /** 推臉筆 records in replay order (push-brush spec §3.2); photo-level, one may cross several persons */
  strokes: readonly Stroke[];
```

- [x] **Step 4: Implement the state helpers**

In `src/edit/state.ts`:

1. Add `import { sanitizeStrokes } from './liquify';` and `Stroke` to the type import from `'../types'`.
2. In `defaultPhoto()`'s literal add `strokes: []`. In `sanitizePhoto(raw, persons, oSize)`'s photo literal (step 3 gave it the `oSize` parameter; `r` is the raw photo record there), next to step 3's `geometry: sanitizeGeometry(r.geometry, oSize),` and step 4's `spots: …` line, add:

```ts
    strokes: sanitizeStrokes(r.strokes, oSize ?? null),
```

(`sanitizePhoto` also builds the camera look's photo layer, `settings.ts:52`, without an `oSize`, so the look never has strokes.) In `src/edit/legacy.ts`, `splitLegacy`'s photo literal (`:16`) gets `strokes: []`. Add `strokes: []` to any other `PhotoParams` literal `npm run typecheck` reports (the rest spread `defaultPhoto()` and need nothing).
3. Add, next to the other edit-state reducers (step 3 put `rotateLeft` / `flipView` wrappers there):

```ts
/** one 推臉筆 gesture (one undo step): append its records; the records already there are shared, never copied (push-brush spec §5.4) */
export function withStrokes(edit: EditState, recs: readonly Stroke[]): EditState {
  if (!recs.length) return edit;
  return { ...edit, photo: { ...edit.photo, strokes: [...edit.photo.strokes, ...recs] } };
}

/** 全部清除 (one undo step); the same object when there is nothing to clear */
export function clearStrokes(edit: EditState): EditState {
  return edit.photo.strokes.length ? { ...edit, photo: { ...edit.photo, strokes: [] } } : edit;
}
```

4. Replace the body of `editKey` (step 1 made it `stableKey` of the edit) so strokes are keyed by id (C §3.4: stroke arrays are never stringified for comparison):

```ts
/** the undo / output de-dupe key: stableKey with every stroke reduced to its id (C §3.4) */
export function editKey(edit: EditState): string {
  return stableKey({ ...edit, photo: { ...edit.photo, strokes: edit.photo.strokes.map((s) => s.id) } });
}
```

5. `sanitizeEditState(raw, personIds, oSize?)` needs no edit of its own: it returns `{ v: 2, photo: sanitizePhoto(r.photo, new Set(Object.keys(persons)), oSize), persons, template, primaryInit }` (`state.ts:322` at `d09e608`), so item 2's line sanitizes the strokes on `oSize`. Without `oSize` (the camera look, and any caller without an entry size) the strokes are always `[]` (PB §4.5 row Camera).

- [x] **Step 5: Return the frame from `openState`; sanitize stored edits on their own frame**

In `src/edit/migrate.ts`:

1. `interface OpenedState` gains `/** the size the 推臉筆 grid is built on: the entry's stored width × height (push-brush spec §3.3) */ frame: LiquifyFrame;` (import `LiquifyFrame` from `'../types'`).
2. In `openState(entry, size)`, compute `const frame: LiquifyFrame = { width: entry.width, height: entry.height };` at the top of the function. Step 3's v2 path already builds the same size as `const oSize = { width: entry.width, height: entry.height };` and passes it to `sanitizeGeometry` and to the one `sanitizeEditState(edit, d.persons.map((p) => p.id), oSize)` call: replace that literal with `frame` (`const oSize = frame;`, or use `frame` in both places). Step 3 re-validates the geometry on every v2 path, the ones that hand the stored edit back as it is included (`let edit: EditState = { ...v2Edit, photo: { ...v2Edit.photo, geometry: sanitizeGeometry(v2Edit.photo.geometry, oSize) } };`); re-sanitize the strokes in that same photo, so those paths drop a malformed record too:

```ts
  let edit: EditState = {
    ...v2Edit,
    photo: { ...v2Edit.photo, geometry: sanitizeGeometry(v2Edit.photo.geometry, frame), strokes: sanitizeStrokes(v2Edit.photo.strokes, frame) },
  };
```

(import `sanitizeStrokes` from `'./liquify'`). Then add `frame` to every object the function returns, the v1 paths included.

`src/store/history.ts` needs no change: `normalizeEntry` already sanitizes the stored edit on the entry's own size (`if (isEditStateRecord(r.edit)) entry.edit = sanitizeEditState(r.edit, null, { width, height });`, step 3, `history.ts:214` at `d09e608`), so `getEntry` / `listEntries` keep the strokes once `sanitizePhoto` reads them; the history tests below pin it.

- [x] **Step 6: Carry the frame to the editor**

In `src/ui/state.ts`, in `interface EditorSource` (after steps 1 and 3 it holds `edit`, `detect`, `source`, …), add:

```ts
  /** the size the 推臉筆 grid is built on: the entry's stored width × height, or the imported bitmap's size (push-brush spec §3.3) */
  frame: LiquifyFrame;
```

In `src/ui/flows.ts` (step 1): `freshSource(bitmap, edit, returnTo, faceSeed)` adds `frame: { width: bitmap.width, height: bitmap.height }` to the source it returns (a new import, and a camera shot whose 編輯 opens the shot's own bitmap), and `openInEditor`'s entry branch (`source = { ...freshSource(bitmap, o.edit, opts.returnTo), historyId: entry.id, detect: o.detect, … }`) adds `frame: o.frame`, so a reopen uses the stored size. Fix every other `EditorSource` literal `npm run typecheck` reports (tests and the t7 harness fakes included) with `frame: { width: bitmap.width, height: bitmap.height }`.

- [x] **Step 7: Run the tests**

Run: `npx vitest run src/edit src/store src/ui`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [x] **Step 8: Commit**

```bash
git add src/types.ts src/edit/state.ts src/edit/state.test.ts src/edit/legacy.ts src/edit/migrate.ts src/edit/migrate.test.ts src/ui/state.ts src/ui/flows.ts src/store/history.test.ts
git add -u
git commit -m "feat(liquify): strokes in EditState, keyed by id, sanitized on the entry's frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: RESHAPE_FS samples the liquify field first; the CPU port follows

The shader contract of PB §4.4 and C §4.2: `tc = o + L(o)`, then the body field at `tc`, then the face chains; one resample. With no strokes (`uLiqOn = 0`) the body lookup coordinate is exactly the old one, so v0.3 output is bit-identical. The CPU port reads each texel f16-rounded (what RG16F gives back), and the hash pin is re-set in the same commit (C §8.2).

**Files:**
- Modify: `src/engine/passes/reshape.ts` (LF; at `d09e608`: units `445-448`, `reshapeFs` `542-755` with `main()` `723-755`, `ReshapePass` `792-823`, `createReshapePass` `825-958`)
- Modify: `src/engine/passes/reshapeCpu.ts` (LF; at `d09e608`: `f16` `:67`, `protectAt` `69-84`, `reshapeMapMulti` `177-222`, `reshapeMapCpu` `227-231`)
- Modify: `src/engine/passes/reshapeCpu.test.ts` (LF; the hash pin is the `PINNED` constant, `:19` at `d09e608`, re-set by steps 1, 3, 5)

**Interfaces:**
- Consumes: Task 1 `LiquifyField`. From the step-1 plan (Tasks 16–17) and the step-3 plan (Task 7): the shader text lives in `reshapeFs(carrier: 'texture' | 'ubo')` (`RESHAPE_FS = reshapeFs('texture')`), whose `main()` after step 3 starts `vec2 v = uTile.xy + vUv * uTile.zw; vec2 o = (uGeo * vec3(v, 1.0)).xy; vec2 tcB = o; if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, o).xy;` and ends `outColor = texture(uSrc, (tc - uWin.xy) / uWin.zw);`; `ReshapePass.drawFaces(src, dst, faces: readonly TableFace[], opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[]; view?: ReshapeView })`; the one-face wrapper `ReshapePass.draw(src, dst, face, u, aspect?, body?, protect?, view?)` that calls `drawFaces`; `BODY_UNIT = 1`, `PROTECT_UNIT = 2`, the face table on unit 3 (PS §4.8). CPU: `reshapeMapMulti(faces: readonly TableFace[], aspect: number, opts?: { body?: BodyField | null; protects?: readonly FaceProtect[] }): UvMap` (the N-face port, whose map starts `let tcB: V2 = [x, y]; if (body) { const d = fieldAt(body, x, y); … }`) and the one-face wrapper `reshapeMapCpu(face, u, aspect, body?, protect?)`; step 3's `withView(map, view)` (geometry around any `UvMap`).
- Produces:
  - `LIQUIFY_UNIT = 4` (exported from `reshape.ts`).
  - `drawFaces` options gain `liquify?: Texture | null`; the one-face `ReshapePass.draw(src, dst, face, u, aspect?, body?, protect?, view?, liquify?)` gains it as its new last parameter and forwards it. Absent / null binds the 1 × 1 `zero` texture and sets `uLiqOn = 0`.
  - `liquifyAt(f: LiquifyField, u: number, v: number): [number, number]` (bilinear, clamp-to-edge, f16 texels).
  - `reshapeMapMulti(faces, aspect, opts?: { body?; protects?; liquify?: LiquifyField | null })`; `reshapeMapCpu(face, u, aspect, body?, protect?, liquify?)`.

- [x] **Step 1: Write the failing tests**

Append to `src/engine/passes/reshapeCpu.test.ts` (the file already defines `face`, `aspect`, `params` at `:27-30` and imports `reshapeUniforms` and `reshapeMapCpu`; keep using them):

```ts
describe('reshapeMapCpu with a 推臉筆 field', () => {
  const liq = (dx: number) => ({ width: 2, height: 2, data: new Float32Array([dx, 0, dx, 0, dx, 0, dx, 0]), version: 1 });

  it('a null liquify field is the identity of the old map', () => {
    const u = reshapeUniforms(params(['shape.faceSlim']), 1);
    const a = reshapeMapCpu(face, u, aspect, null, null, null)(0.5, 0.6);
    const b = reshapeMapCpu(face, u, aspect)(0.5, 0.6);
    expect(a).toEqual(b);
  });

  it('applies liquify first, then samples the body field at the liquified point (f16 texels)', () => {
    const d = 0.01;
    const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);
    const dq = f16(d);
    // a body field that varies along x, so where it is sampled matters
    const body = { width: 4, height: 1, data: new Float32Array([0, 0, 0.004, 0, 0.008, 0, 0.012, 0]), version: 1 };
    const map = reshapeMapCpu(null, null, aspect, body, null, liq(d));
    const [x] = map(0.3, 0.5);
    const shifted = reshapeMapCpu(null, null, aspect, body)(0.3 + dq, 0.5);
    expect(x).toBeCloseTo(shifted[0], 12);
    expect(x).not.toBeCloseTo(reshapeMapCpu(null, null, aspect, body)(0.3, 0.5)[0] + dq, 6);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: FAIL — the second test: `x` equals the body-only map at 0.3 (the 6th argument is ignored), and TS reports "Expected 3-5 arguments, but got 6".

- [x] **Step 3: Port the CPU side**

In `src/engine/passes/reshapeCpu.ts`:

1. Add `LiquifyField` to the type import from `'../../types'`.
2. Directly below `protectAt` (`:69-84` at `d09e608`; the file's `const f16` at `:67`, which `protectAt` uses, serves `liquifyAt` too: do not declare it again), add:

```ts
/**
 * Bilinear, clamp-to-edge lookup of the 推臉筆 field at UV with every texel rounded to f16 first: what the shader
 * reads back from the RG16F upload (push-brush spec §4.4), like protectAt.
 */
export function liquifyAt(f: LiquifyField, u: number, v: number): [number, number] {
  const { width: w, height: h, data } = f;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const t = (i: number) => f16(data[i * 2 + c]);
    const a = t(y0 * w + x0) * (1 - fx) + t(y0 * w + x1) * fx;
    const b = t(y1 * w + x0) * (1 - fx) + t(y1 * w + x1) * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}
```

3. Add `liquify?: LiquifyField | null` to the options of `reshapeMapMulti` and as the 6th parameter of the one-face wrapper `reshapeMapCpu(face, u, aspect, body?, protect?, liquify?)`, which forwards it from **both** of its returns (step 1's wrapper returns early for a null face or null uniforms; the second test above takes that path):

```ts
export function reshapeMapCpu(face: Face | null, uIn: ReshapeUniforms | null, aspect: number, body?: BodyField | null, protect?: FaceProtect | null, liquify?: LiquifyField | null): UvMap {
  if (!face || !uIn) return reshapeMapMulti([], aspect, { body, liquify });
  // … step 1's TableFace `t`, unchanged …
  return reshapeMapMulti([t], aspect, { body, protects: protect ? [protect] : [], liquify });
}
```
4. In `reshapeMapMulti`'s returned map, replace the start (step 1: `let tcB: V2 = [x, y]; if (body) { const d = fieldAt(body, x, y); tcB = [x + d[0], y + d[1]]; }`) so that the liquify field is applied first and the body field is sampled at the result:

```ts
    let tcB: V2 = [x, y];
    // 推臉筆 first (the outermost map), then the 美體 field sampled at the liquified point (push-brush spec §4.1)
    if (liquify) {
      const d = liquifyAt(liquify, tcB[0], tcB[1]);
      tcB = [tcB[0] + d[0], tcB[1] + d[1]];
    }
    if (body) {
      const d = fieldAt(body, tcB[0], tcB[1]);
      tcB = [tcB[0] + d[0], tcB[1] + d[1]];
    }
```

with `const liquify = opts.liquify ?? null;` next to `const body = opts.body ?? null;` (`:186` at `d09e608`). With no liquify field `tcB` is still `(x, y)` where the body is sampled, so every existing CPU result is unchanged. (The one-face wrapper calls `reshapeMapMulti` on both of its returns at `d09e608`, so item 3 is its only change.)

- [x] **Step 4: Run the CPU tests**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: the two new tests PASS; the hash-pin test still passes (the shader text has not changed yet).

- [x] **Step 5: Change the shader**

In `src/engine/passes/reshape.ts`:

1. Below `export const FACE_TABLE_UNIT = 3;` (`:448` at `d09e608`, after `BODY_UNIT = 1` and `PROTECT_UNIT = 2`):

```ts
/** texture unit of uLiqDisp: after BODY_UNIT 1, PROTECT_UNIT 2 and the face table on 3 (push-brush spec §4.4, C §4.3: 5 units in P2) */
export const LIQUIFY_UNIT = 4;
```

2. In the shader text (`reshapeFs`, so both face-table carriers get it), after the `uBodyOn` uniform (`:549` at `d09e608`):

```glsl
uniform sampler2D uLiqDisp; // RG16F 推臉筆 backward displacement in O UV units, row 0 = image top (LIQUIFY_UNIT)
uniform float uLiqOn;
```

3. In `main()`, the two lines step 3 wrote after `vec2 o = …` and its comment (`vec2 tcB = o;` and `if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, o).xy;`, `:728-729` at `d09e608`) become three, so the body field is sampled at the liquified coordinate (step 3 samples it at `o`; with `uLiqOn = 0` `tcB` equals `o` there, so the output is bit-identical):

```glsl
  vec2 tcB = o;
  if (uLiqOn != 0.0) tcB += texture(uLiqDisp, o).xy;
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, tcB).xy;
```

4. In `createReshapePass`, after `gl.uniform1i(prog.u('uProtArr'), PROTECT_UNIT);` (`:831` at `d09e608`; step 1's protect array replaced v0.3's `uFaceProt`):

```ts
  gl.uniform1i(prog.u('uLiqDisp'), LIQUIFY_UNIT);
```

5. Add `liquify?: Texture | null` to `drawFaces`' options type in `interface ReshapePass` (doc: `RG16F 推臉筆 field (O UV units), the outermost map; null = none`) and as the last parameter of the one-face `ReshapePass.draw(src, dst, face, u, aspect?, body?, protect?, view?, liquify?)` (interface and implementation, `:941-944` at `d09e608`), which forwards it in the options it passes to `drawFaces`. In `drawFaces`, next to the body-texture binding (`:924-925` at `d09e608`, `o` = the options argument):

```ts
      bindTexture(gl, LIQUIFY_UNIT, o.liquify ?? zero);
      gl.uniform1f(prog.u('uLiqOn'), o.liquify ? 1 : 0);
```

and after `drawFullscreen(gl)`, next to `bindTexture(gl, BODY_UNIT, null);` (`:932` at `d09e608`):

```ts
      bindTexture(gl, LIQUIFY_UNIT, null);
```

- [x] **Step 6: Re-set the hash pin**

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts -t "pinned"`
Expected: FAIL with `expected '<new hash>' to be '<old hash>'` (the old one is `'913c3d3b'` at `d09e608`). Copy `<new hash>` into the `PINNED` constant the test compares with (`const PINNED = '…';`, `reshapeCpu.test.ts:19`).

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts`
Expected: PASS.

- [x] **Step 7: Typecheck and run the engine tests**

Run: `npm run typecheck && npx vitest run src/engine`
Expected: no errors; PASS. (`pipeline.ts` does not pass the new argument yet; it is optional.)

- [x] **Step 8: Commit**

```bash
git add src/engine/passes/reshape.ts src/engine/passes/reshapeCpu.ts src/engine/passes/reshapeCpu.test.ts
git commit -m "feat(liquify): RESHAPE_FS samples the liquify field first; CPU port and hash pin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pipeline and engine: upload the field and plan P2 for strokes

PB §4.4 "Pipeline": a strokes-only frame runs P2 and maskWarp; the field uploads as RG16F on version change, deleted when it becomes null; no full-buffer finite scan (the model is finite by construction, PB §3.5).

**Files:**
- Modify: `src/engine/pipeline.ts` (CRLF; at `d09e608`: `FrameJob` `85-132`, `PassPlanInput` `142-163`, `planPasses` `182-195`, `planFrame` `201-225`, `let bodyTex …` `404-406`, `bodyTexture` `427-458`, `run`'s `const body = bodyTexture(job.body);` / `planFrame(…)` `507-508` and its two `reshape.drawFaces(…)` calls `585`, `596`, `dispose` `710-735`)
- Modify: `src/engine/pipeline.test.ts` (LF; the `base` fixture `:23-36`)
- Modify: `src/engine/index.ts` (CRLF; `job()` `310-375` at `d09e608`, `body: input.body ?? null,` `:353`)
- Modify: `src/engine/index.test.ts` (LF; the 美體 block `:116-150`)

**Interfaces:**
- Consumes: Task 1 `LiquifyField`, `RenderInput.liquify`; Task 4 `drawFaces(…, { …, liquify })`; `bodyFieldValid`, `bodyUploadNeeded`, `BodyUploadKey` (`pipeline.ts:283-360` at `d09e608`); step 1's `planFrame(job, makeupReady, bodyOn, proc = { active: false, ready: false })`, through which `run` plans (step 5 added `proc`); the two `reshape.drawFaces(…)` calls steps 1 and 3 left in `run` (the image draw and maskWarp, `:585`, `:596` at `d09e608`).
- Produces: `FrameJob.liquify: LiquifyField | null`; `PassPlanInput.liquifyOn: boolean` (`reshape` is on when it is); `planFrame(job, makeupReady, bodyOn, proc?, liquifyOn = false)`; the pass name `'liquify'` in `RenderStats.passes` when the field is applied.

- [x] **Step 1: Write the failing tests**

Append to `src/engine/pipeline.test.ts` (`base` is the file's `PassPlanInput` fixture, `:23-36` at `d09e608`; steps 1–5 extended it; spread it as the other blocks do; `bodyFieldValid` and `MAX_BODY_FIELD_EDGE` are already imported):

```ts
describe('planPasses with a 推臉筆 field (push-brush spec §4.4)', () => {
  it('a strokes-only frame runs reshape (and so maskWarp) and nothing else face-related', () => {
    const off = planPasses({ ...base, liquifyOn: false, bodyOn: false, reshapeActive: false });
    expect(off.reshape).toBe(false);
    const on = planPasses({ ...base, liquifyOn: true, bodyOn: false, reshapeActive: false });
    expect(on.reshape).toBe(true);
    expect({ ...on, reshape: false }).toEqual(off);
  });

  it('liquify fields use the body field validity rule (same layout, MAX_BODY_FIELD_EDGE)', () => {
    const f = { width: 384, height: 512, data: new Float32Array(384 * 512 * 2), version: 1 };
    expect(bodyFieldValid(f)).toBe(true);
    expect(bodyFieldValid({ ...f, width: MAX_BODY_FIELD_EDGE + 1 })).toBe(false);
  });
});
```

Append to `src/engine/index.test.ts` a new `describe` right after `'createEngine: 美體 field'` (`:116-150` at `d09e608`). That block's `lastJob` and `input` helpers are local to it, so the new block declares the same two (leave the 美體 block as it is):

```ts
describe('createEngine: 推臉筆 field', () => {
  // the 美體 block's two helpers (local to it)
  const lastJob = (): FrameJob => {
    const pipe = vi.mocked(createPipeline).mock.results.at(-1)!.value as { run: { mock: { calls: [FrameJob][] } } };
    return pipe.run.mock.calls.at(-1)![0];
  };
  const input = () => ({ source: {} as TexImageSource, width: 640, height: 480, ...legacyFrame(defaultParams(), null, 0) });
  const liquify = { width: 384, height: 512, data: new Float32Array(384 * 512 * 2), version: 3 };

  it('passes RenderInput.liquify to the job of render and of renderToImageData (preview = export)', async () => {
    const { canvas } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render({ ...input(), liquify }, { still: true });
    expect(lastJob().liquify).toBe(liquify);
    expect(() => engine.renderToImageData({ ...input(), liquify }, { mirror: false })).toThrow('no output buffer');
    expect(lastJob().liquify).toBe(liquify);
    engine.render(input());
    expect(lastJob().liquify).toBeNull();
  });

  it('the field reaches the job again after a context restore (a fresh pipeline uploads it, push-brush spec §7)', async () => {
    const { canvas, fire } = fakeCanvas();
    const engine = createEngine(canvas);
    await engine.ready;
    engine.render({ ...input(), liquify }, { still: true });
    const pipelinesBefore = vi.mocked(createPipeline).mock.results.length;
    fire('webglcontextlost');
    fire('webglcontextrestored');
    await engine.ready;
    expect(vi.mocked(createPipeline).mock.results.length).toBeGreaterThan(pipelinesBefore); // a new pipeline: no upload key
    engine.render({ ...input(), liquify }, { still: true });
    expect(lastJob().liquify).toBe(liquify);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/pipeline.test.ts src/engine/index.test.ts`
Expected: FAIL — `liquifyOn` is not part of `PassPlanInput` (reshape stays false) and `lastJob().liquify` is `undefined`.

- [x] **Step 3: Plan and upload**

In `src/engine/pipeline.ts` (CRLF):

1. Import `LiquifyField` with the other types.
2. In `interface FrameJob`, after `body`:

```ts
  /** 推臉筆 backward field (O UV units), the outermost map of P2; null = no strokes. Not scaled by any weight. */
  liquify: LiquifyField | null;
```

3. In `interface PassPlanInput`, after `bodyOn`:

```ts
  /** a valid 推臉筆 field will be applied */
  liquifyOn: boolean;
```

and add `liquifyOn: false,` to the `base: PassPlanInput` fixture of `src/engine/pipeline.test.ts` (`:23-36` at `d09e608`) and to any other `PassPlanInput` literal `npm run typecheck` reports.

4. In `planPasses`, add `|| i.liquifyOn` to the `reshape` expression (`:191` at `d09e608`: `(faceOn && i.reshapeActive) || i.bodyOn || i.geoIdentity === false || i.windowed === true`). `planFrame` (`:201-225`) builds the `PassPlanInput` literal for `run`: give it a fifth parameter `liquifyOn = false` after `proc` and pass `liquifyOn,` in that literal (its existing callers, `pipeline.test.ts` and `src/app/faceTracks.test.ts:207`, keep compiling with the default).
5. In `createPipeline`, next to `let bodyTex …` (`:404-406` at `d09e608`):

```ts
  let liqTex: Texture | null = null;
  let liqKey: BodyUploadKey | null = null;
  let liqWarned = false;
```

and after `bodyTexture` (`:427-458` at `d09e608`):

```ts
  /**
   * The 推臉筆 field's texture: bodyTexture's upload rule without its finite scan (the model's stamps are bounded, so
   * the field is finite by construction, push-brush spec §3.5; the scan would cost about 400 k calls per drawn frame).
   * The texture is deleted when the strokes become empty (null field).
   */
  function liquifyTexture(f: LiquifyField | null): Texture | null {
    if (!f) {
      if (liqTex) deleteTexture(gl, liqTex);
      liqTex = null;
      liqKey = null;
      return null;
    }
    if (!bodyFieldValid(f)) {
      if (!liqWarned) console.warn('[engine] ignoring malformed liquify field', { width: f.width, height: f.height });
      liqWarned = true;
      return null;
    }
    if (!bodyUploadNeeded(liqKey, f)) return liqTex;
    const n = f.width * f.height * 2;
    const data = f.data.length === n ? f.data : f.data.subarray(0, n);
    liqKey = { field: f, data: f.data, version: f.version, width: f.width, height: f.height, usable: true };
    liqTex ??= createTexture(gl, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, liqTex.tex);
    setUnpackState(gl);
    if (liqTex.width === f.width && liqTex.height === f.height) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.width, f.height, gl.RG, gl.FLOAT, data);
    } else {
      // RG16F from FLOAT data: core WebGL2, filterable (LINEAR) without extensions
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, f.width, f.height, 0, gl.RG, gl.FLOAT, data);
      liqTex.width = f.width;
      liqTex.height = f.height;
    }
    return liqTex;
  }
```

6. In `run`, next to `const body = bodyTexture(job.body);` (`:507` at `d09e608`): `const liq = liquifyTexture(job.liquify);`, and pass `liq !== null` as the new fifth argument of the `planFrame(job, makeupReady, body !== null, { active: proc !== null, ready: procReady })` call on the next line. Add `liquify: liq` to the options of **both** `reshape.drawFaces` calls (the image draw, `:585`, and maskWarp, `:596`), and after `if (body) passes.push('body');` (`:589`) add `if (liq) passes.push('liquify');`.
7. In `dispose`, delete and reset it with the others: `deleteTexture(gl, liqTex);` next to `deleteTexture(gl, bodyTex);` in the `!lost` branch (`:721` at `d09e608`) and `liqTex = null; liqKey = null;` with `bodyTex = null; bodyKey = null;` (`:728-729`).

- [x] **Step 4: Forward it from the engine**

In `src/engine/index.ts` `job()` (`:310-375` at `d09e608`), after `body: input.body ?? null,` (`:353`):

```ts
      // preview, export and every tile share this path, so the strokes are applied identically to all of them
      liquify: input.liquify ?? null,
```

Fix any other `FrameJob` literal `npm run typecheck` reports (test fakes) with `liquify: null`.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/engine`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/engine/pipeline.ts src/engine/pipeline.test.ts src/engine/index.ts src/engine/index.test.ts
git add -u
git commit -m "feat(liquify): RG16F field upload and a strokes-only P2 plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: StillSession carries the field into every render, export and tile

PB §3.7 row `src/app/still.ts`: `setLiquify`, `liquify`, the seed option for a replacement session, and the export snapshot parameter, the same shape as the body field (at `d09e608`: `StillSession` `still.ts:21-85`, `StillSessionOptions` `117-129`, `let body` `162`, `input` `174-181`, `get body` / `setBody` `323-330`, `exportImageData` `342-350`, `tileInput` `367-375`, `bounds` `376-379`).

**Files:**
- Modify: `src/types.ts` (CRLF; `StillFrame`, `:570` at `d09e608`: step 1 put it there, `still.ts` imports it)
- Modify: `src/app/still.ts`
- Modify: `src/app/still.test.ts`
- Modify: `tests/harness/t7/fakes.ts` (LF; `fakeStill`, `:270-340` at `d09e608`: a `StillSession` object literal, so it needs the two new members)

**Interfaces:**
- Consumes: Task 1 `LiquifyField`; step 1's `StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body'>` (`src/types.ts`), `render(frame)`, `exportImageData(frame, body?)` and the builder `input(f, b)` (PS §3.4 S1); step 3's `tileInput(frame: StillFrame, body?: BodyField | null): TileInputBase` and `bounds(frame: StillFrame, body?: BodyField | null): TileBounds` (step-3 plan Task 11), and `TileBounds.liquifyMaxDisp?: (rectO: Rect) => number` (step-3 plan Task 9).
- Produces: `StillSession.setLiquify(field: LiquifyField | null): void`, `readonly liquify: LiquifyField | null`, `StillSessionOptions.liquify?: LiquifyField | null`, `exportImageData(frame, body?, liquify?)` (`undefined` = the field set last, `null` = none), `tileInput(frame, body?, liquify?)` (same rule), `bounds(frame, body?, liquifyMaxDisp?: (rectO: Rect) => number)`; `StillFrame` also omits `'liquify'`.

- [x] **Step 1: Write the failing tests**

Append inside `describe('createStillSession', …)` in `src/app/still.test.ts` (it already imports `defaultPhoto` from `'../edit/state'` and `StillFrame` from `'../types'`, `still.test.ts:5`, `:10`):

```ts
  /** a frame without faces: the strokes are photo-level and need none */
  const naturalFrame: StillFrame = { faces: [], obstacles: [], globalSkin: null, photo: defaultPhoto() };
  const liq = (v = 1) => ({ width: 384, height: 512, data: new Float32Array(384 * 512 * 2), version: v });

  it('setLiquify: the 推臉筆 field reaches every render and export (preview = export); null removes it', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    expect(s.liquify).toBeNull();
    s.render(naturalFrame);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify ?? null).toBeNull();
    const f = liq();
    s.setLiquify(f);
    expect(s.liquify).toBe(f);
    vi.advanceTimersByTime(16); // setLiquify alone redraws
    expect(engine.lastInput()!.liquify).toBe(f);
    s.exportImageData(naturalFrame);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBe(f);
    s.setLiquify(null);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify).toBeNull();
  });

  it('tile inputs carry the snapshot; bounds carry the liquify term only when given', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap(), { liquify: liq(1) });
    const snap = liq(2);
    expect(s.tileInput(naturalFrame, undefined, snap).liquify).toBe(snap);
    expect(s.tileInput(naturalFrame).liquify).toBe(s.liquify);
    const m = (_r: { x: number; y: number; w: number; h: number }) => 0.01;
    expect(s.bounds(naturalFrame, undefined, m).liquifyMaxDisp).toBe(m);
    expect(s.bounds(naturalFrame).liquifyMaxDisp).toBeUndefined();
  });

  it('an export takes the snapshot it is given, while the preview keeps the live field', () => {
    const engine = fakeEngine();
    const live = liq(1);
    const s = createStillSession(engine, fakeTracker(), bitmap(), { liquify: live });
    s.render(naturalFrame);
    const snap = liq(1);
    s.exportImageData(naturalFrame, undefined, snap);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBe(snap);
    s.exportImageData(naturalFrame, undefined, null);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBeNull();
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify).toBe(live); // a replacement session draws the strokes on its first frame
  });
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app/still.test.ts`
Expected: FAIL — `s.liquify` is `undefined` / `s.setLiquify is not a function`.

- [x] **Step 3: Implement**

In `src/app/still.ts`:

1. Add `LiquifyField` to `still.ts`'s type import from `'../types'`. In `src/types.ts` (CRLF), make `StillFrame` omit `'liquify'` too: `export type StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body' | 'liquify'>;`.
2. In `interface StillSession`, after `readonly body: BodyField | null;` (`:46` at `d09e608`):

```ts
  /**
   * 推臉筆 field (null = no strokes), applied to every later render and export like the body field. The editor's
   * LiquifyModel refills it in place (new `version`): pass the same object again and it redraws.
   */
  setLiquify(field: LiquifyField | null): void;
  /** the field set last (a replacement session is seeded with it) */
  readonly liquify: LiquifyField | null;
```

and change `exportImageData` to `exportImageData(frame: StillFrame, body?: BodyField | null, liquify?: LiquifyField | null): ImageData;` with the doc line `` `liquify` as `body`: the snapshot taken when the export was asked for; omitted → the field set last ``.
3. In `StillSessionOptions`, after `body?` (`:128` at `d09e608`):

```ts
  /** 推臉筆 field to start with (a replacement session draws the strokes on its first frame) */
  liquify?: LiquifyField | null;
```

4. Next to `let body: BodyField | null = opts.body ?? null;` (`:162` at `d09e608`): `let liquify: LiquifyField | null = opts.liquify ?? null;`
5. Give `input` a third parameter and pass it into the `RenderInput` (`:174-181` at `d09e608`; the display path `engine.render({ ...input(frame), geometry: viewGeometry(frame) }, …)` then draws the field set last): `const input = (f: StillFrame, b: BodyField | null = body, l: LiquifyField | null = liquify): RenderInput => ({ …, body: b, liquify: l })`.
6. In the returned object, next to `get body()` / `setBody` (`:323-330` at `d09e608`):

```ts
    get liquify() {
      return liquify;
    },
    setLiquify(field) {
      if (disposed) return;
      liquify = field;
      schedule();
    },
```

7. In `exportImageData(f, b, l)` (`:342-350` at `d09e608`): `engine.renderToImageData(input(f, b === undefined ? body : b, l === undefined ? liquify : l), { mirror: false })`.
8. Step 3's `tileInput(f, b)` (`:367-375`) builds its result from `input(f, b === undefined ? body : b)` (step 4 adds `toneSource` to it): give it a third parameter `l?: LiquifyField | null` and pass `l === undefined ? liquify : l` as `input`'s third argument, so the tile input carries the export snapshot (Task 13 wires the caller). Step 3's `bounds(f, b)` (`:376-379`, which returns `{ body: …, faces: faceBoundsFor(f.faces, width / height), ...spotBounds(f, { width, height }) }`) gains a third parameter `liquifyMaxDisp?: (rectO: Rect) => number` and spreads `...(liquifyMaxDisp ? { liquifyMaxDisp } : {})` into that object (keep every field steps 3 and 4 put there). Update the two interface signatures (`:75`, `:77`) to match.
9. In `tests/harness/t7/fakes.ts`, `fakeStill` returns a `StillSession` object literal: next to its `let body = opts.body ?? null;` add `let liquify: LiquifyField | null = null;` (add `LiquifyField` to its type import from `'../../../src/types'`), and next to its `get body()` / `setBody(f)` members add the same pair for the field (the 2D fake engine cannot warp, so it is only recorded):

```ts
    get liquify() {
      return liquify;
    },
    setLiquify(f) {
      liquify = f;
      if (!raf) raf = requestAnimationFrame(paint);
    },
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/app/still.test.ts && npm run typecheck`
Expected: PASS; no errors (callers that ignore the new optional arguments compile unchanged; fix any other fake of `StillSession` that `typecheck` reports the same way as item 9).

- [x] **Step 5: Commit**

```bash
git add src/types.ts src/app/still.ts src/app/still.test.ts tests/harness/t7/fakes.ts
git add -u
git commit -m "feat(liquify): StillSession carries the field into renders, exports and tiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Landed as `a5257db`, which carries a stale step-2 subject (`v0.4 step 2 task 6: The 調節 composite variant, its CPU port and the hash pins`, from a leftover message file in the scratchpad). Its content is this task's four files and its ticks. The `v0.4 step 6 task 6 fix:` commit on top of it records this note, and no commit was amended.

---

### Task 7: The GPU reshape matches the CPU port with a liquify field

PB §8.2: render RESHAPE_FS on the coordinate texture with a field built by `src/edit/liquify.ts` from a fixed record list (a push across the face contour and a restore over half of it, with the body field and face warps on); the GPU map must equal `reshapeMapCpu` within 0.05 px, as the existing cases do (`reshape.spec.ts:16-20`).

**Files:**
- Modify: `tests/e2e/pages/reshape.ts`
- Modify: `tests/e2e/reshape.spec.ts`

**Interfaces:**
- Consumes: Task 2 `LiquifyModel`, `straightStroke`, `liquifyGrid`; Task 4 `ReshapePass.draw(src, dst, face, u, aspect?, body?, protect?, view?, liquify?)`, `reshapeMapCpu(face, u, aspect, body?, protect?, liquify?)`; the page's module-level `PinCase` and imports (`landmarks`, `createReshapePass`, `reshapeUniforms`, `reshapeMapCpu`, `applyPreset`, `setParam`, `adapt`, `BodyField`, `ParamId`; `pages/reshape.ts:1-36` at `d09e608`) and its helpers `context()`, `floatTex(gl, w, h, internal, format, data)` and `rig(gl)` (`{ src, dst, compare(name, map): PinCase, dispose() }` over a 200 × 300 RGBA32F target; `:44-110`). The new entry point builds its own GL state with them, as step 3's `runReshapePinView` does, so it does not depend on how `runReshapePin` is structured.
- Produces: `window.runReshapePinLiquify(): PinCase[]` (one case).

- [x] **Step 1: Add the failing spec test**

Append to `tests/e2e/reshape.spec.ts` (leave the three existing tests, which still expect their own cases, untouched; the file defines `DEV_URL`):

```ts
test('reshape CPU port == RESHAPE_FS with a 推臉筆 field as the outermost map (push + half restore, body, contour)', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/reshape.html`);
  await page.waitForFunction(() => typeof window.runReshapePinLiquify === 'function');
  const [c] = await page.evaluate(() => window.runReshapePinLiquify!());
  console.log(`${c.name}: ${c.n} px compared, ${c.moved} moved > 1 px, max |GPU − CPU| = ${c.maxErrPx.toFixed(4)} px`);
  expect(c.n).toBeGreaterThan(30_000);
  expect(c.moved).toBeGreaterThan(1_000);
  expect(c.maxErrPx, JSON.stringify(c.samples.slice(0, 4))).toBeLessThan(0.05);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/reshape.spec.ts`
Expected: FAIL — `waitForFunction` times out (`runReshapePinLiquify` is undefined).

- [x] **Step 3: Add the harness case**

In `tests/e2e/pages/reshape.ts`:

1. Add imports (and `LiquifyField` to the page's existing type import from `'../../../src/types'`):

```ts
import { LiquifyModel, liquifyGrid } from '../../../src/edit/liquify';
import { straightStroke } from '../../../src/edit/strokeFixtures';
```

2. Extend the `Window` declaration with `runReshapePinLiquify?: () => PinCase[];`.
3. Add, at the end of the file (the existing entry points stay as steps 1 and 3 left them):

```ts
/** A field from a fixed record list on the photo's own frame: a 大 push across the left cheek contour, a 大 restore over half of it. */
function liquifyCase(W: number, H: number): LiquifyField {
  const frame = { width: W, height: H };
  const g = liquifyGrid(frame);
  const R = (44 / 28) * (28.7 / g.F);
  const m = new LiquifyModel(frame, { now: () => 0, syncWork: Infinity });
  const push = straightStroke(frame, 'push', R, { x: 0.3, y: 0.55 }, { x: 0.3 + (1.5 * R) / g.ax, y: 0.55 }, 'pin-push');
  const half = straightStroke(frame, 'restore', R, { x: 0.3, y: 0.5 }, { x: 0.3 + (1.5 * R) / g.ax, y: 0.5 }, 'pin-restore');
  m.sync([...push, ...half]);
  const f = m.snapshot()!;
  m.dispose();
  return f;
}

/** runReshapePin's 'body field + contour' case with the 推臉筆 field as the outermost map (push-brush spec §8.2). */
window.runReshapePinLiquify = () => {
  // the page's own GL context, identity source, 200 × 300 RGBA32F target and GPU/CPU comparison (context, rig)
  const gl = context();
  const r = rig(gl);
  const { width: W, height: H } = landmarks;
  const aspect = W / H;
  // the same smooth body field as runReshapePin, RG16F from FLOAT data like the engine
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
  // the 推臉筆 field, uploaded RG16F like pipeline.ts liquifyTexture; the CPU port rounds its texels to f16 the same way
  const liqField = liquifyCase(W, H);
  const liqTex = floatTex(gl, liqField.width, liqField.height, gl.RG16F, gl.RG, liqField.data);
  const face = adapt({ points: new Float32Array(landmarks.points) }, W, H);
  const at = (ids: ParamId[]) => ids.reduce((p, k) => setParam(p, k, 1), applyPreset('original', 1)).values;
  const u = reshapeUniforms(at(['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow']), 1);
  const pass = createReshapePass(gl);
  // runReshapePin's one-face draw (protect null, view undefined = identity) plus the liquify texture as the new last argument
  pass.draw(r.src, r.dst, face, u, aspect, bodyTex, null, undefined, liqTex);
  const res = [r.compare('liquify + body field + contour', reshapeMapCpu(face, u, aspect, bodyField, null, liqField))];
  pass.dispose();
  gl.deleteTexture(bodyTex.tex);
  gl.deleteTexture(liqTex.tex);
  r.dispose();
  return res;
};
```

(`context()`, `floatTex(gl, …)` and `rig(gl)` are the page's helpers, `pages/reshape.ts:44-110` at `d09e608`; `rig`'s `compare` reads the target back and counts `n`, `moved` and `maxErrPx` exactly as `runReshapePin` does. `createReshapePass(gl)` takes no required options there.)

- [x] **Step 4: Run it**

Run: `npx playwright test tests/e2e/reshape.spec.ts`
Expected: PASS (the three existing tests and the new one), and the log line shows `max |GPU − CPU|` below 0.05 px.

- [x] **Step 5: Commit**

```bash
git add tests/e2e/pages/reshape.ts tests/e2e/reshape.spec.ts
git commit -m "test(liquify): GPU reshape equals the CPU port with a liquify field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Brush gestures: the reducer and zoomPan's brush mode

PB §2.5: in brush mode zoomPan's own listener arbitrates (so a pinch never loses its first finger to an overlay), through a pure reducer with states `idle → stroke → pinch → locked`: one finger draws from the first move; a second finger within `PINCH_GRACE_MS` cancels the stroke, later it commits it, then pinches; one finger left after a pinch neither pans nor draws; `pointercancel` commits; a third finger is ignored; only a stamp-free tap pair fits the view. The hooks are read through a ref, so the effect still keys only on `enabled` (`zoomPan.ts:189` at `d09e608`).

**Files:**
- Create: `src/ui/brushGesture.ts`, `src/ui/brushGesture.test.ts`
- Modify: `src/ui/screens/zoomPan.ts` (CRLF; at `d09e608`: `ZoomPanOptions` `66-76`, `useZoomPan` `78-201` with `optsRef` `:86-87`, `twoPoint` / `begin` `118-131`, `down` `133-140` (target check `:134`), `move` `141-152`, the shared `end` `153-180`, the effect's `[enabled]` `:189`)

**Interfaces:**
- Consumes: Task 1 `PINCH_GRACE_MS`; step 1's `useZoomPan(stage, layer, enabled, opts?)` with the options read through a ref (`optsRef`, PS §2.3); step 4's `export interface ZoomPanOptions { onTap?(uv): void; spotTap?(uv): void }` (step 3 adds `resetWhen` to it) and its handlers `down`, `move` and `end` (`end` is registered for both `pointerup` and `pointercancel` and tells them apart by `e.type`; step-4 plan Task 15).
- Produces:
  - `BRUSH_DOUBLE_TAP_MS = 300`; `type BrushGestureState`; `type BrushGestureEvent = { type: 'down'; id; t } | { type: 'up'; id; t; stamped: boolean } | { type: 'cancel'; id }`; `type BrushEffect = 'strokeStart' | 'strokeCommit' | 'strokeCancel' | 'pinchStart' | 'pinchEnd' | 'fit'`; `BRUSH_IDLE`; `brushGesture(s, e): { state; effects }`; `brushMoveAction(s, id): 'feed' | 'pinch' | 'none'`; `brushPointers(s): number[]`.
  - `interface BrushHooks { start(p: {x,y}): void; move(ps: readonly {x,y}[]): void; commit(): void; cancel(): void; stamped(): boolean; pinch(on: boolean): void }` exported from `zoomPan.ts`; `ZoomPanOptions.brush?: BrushHooks | null`.

- [x] **Step 1: Write the failing test**

Create `src/ui/brushGesture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PINCH_GRACE_MS } from '../config/limits';
import {
  BRUSH_DOUBLE_TAP_MS,
  BRUSH_IDLE,
  brushGesture,
  brushMoveAction,
  brushPointers,
  type BrushEffect,
  type BrushGestureEvent,
  type BrushGestureState,
} from './brushGesture';

/** run events from idle; returns the final state and every effect in order */
function run(events: BrushGestureEvent[], from: BrushGestureState = BRUSH_IDLE) {
  let s = from;
  const fx: BrushEffect[] = [];
  for (const e of events) {
    const r = brushGesture(s, e);
    s = r.state;
    fx.push(...r.effects);
  }
  return { s, fx };
}

describe('brushGesture (push-brush spec §2.5)', () => {
  it('one finger draws: down starts, moves feed, up commits', () => {
    const { s, fx } = run([{ type: 'down', id: 1, t: 0 }]);
    expect(fx).toEqual(['strokeStart']);
    expect(brushMoveAction(s, 1)).toBe('feed');
    expect(brushMoveAction(s, 2)).toBe('none');
    expect(run([{ type: 'up', id: 1, t: 500, stamped: true }], s).fx).toEqual(['strokeCommit']);
  });

  it(`a second finger at ${PINCH_GRACE_MS - 1} ms cancels the stroke and pinches`, () => {
    const { s, fx } = run([
      { type: 'down', id: 1, t: 1000 },
      { type: 'down', id: 2, t: 1000 + PINCH_GRACE_MS - 1 },
    ]);
    expect(fx).toEqual(['strokeStart', 'strokeCancel', 'pinchStart']);
    expect(s).toEqual({ kind: 'pinch', ids: [1, 2] });
    expect(brushMoveAction(s, 1)).toBe('pinch');
    expect(brushMoveAction(s, 2)).toBe('pinch');
  });

  it(`exactly at the grace (${PINCH_GRACE_MS} ms) it still cancels; at ${PINCH_GRACE_MS + 1} ms it commits`, () => {
    expect(run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: PINCH_GRACE_MS }]).fx).toContain('strokeCancel');
    const late = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: PINCH_GRACE_MS + 1 }]);
    expect(late.fx).toEqual(['strokeStart', 'strokeCommit', 'pinchStart']);
  });

  it('pinch → one finger lifts → locked (no pan, no draw) → last finger lifts → idle', () => {
    let { s, fx } = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: 50 }]);
    ({ s, fx } = run([{ type: 'up', id: 1, t: 400, stamped: false }], s));
    expect(fx).toEqual(['pinchEnd']);
    expect(s).toEqual({ kind: 'locked', id: 2 });
    expect(brushMoveAction(s, 2)).toBe('none');
    ({ s, fx } = run([{ type: 'up', id: 2, t: 600, stamped: false }], s));
    expect(fx).toEqual([]);
    expect(s).toEqual(BRUSH_IDLE);
  });

  it('a finger landing while locked pinches again; a third finger is ignored', () => {
    let { s, fx } = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: 50 }, { type: 'up', id: 1, t: 100, stamped: false }]);
    ({ s, fx } = run([{ type: 'down', id: 3, t: 200 }], s));
    expect(fx).toEqual(['pinchStart']);
    expect(s).toEqual({ kind: 'pinch', ids: [2, 3] });
    ({ s, fx } = run([{ type: 'down', id: 4, t: 300 }], s));
    expect(fx).toEqual([]);
    expect(brushPointers(s)).toEqual([2, 3]);
  });

  it('pointercancel during a stroke commits it (an iOS system gesture)', () => {
    expect(run([{ type: 'down', id: 1, t: 0 }, { type: 'cancel', id: 1 }]).fx).toEqual(['strokeStart', 'strokeCommit']);
  });

  it('a double tap without stamps fits; a gesture with stamps is never a tap', () => {
    const tap = (id: number, t: number, stamped = false): BrushGestureEvent[] => [
      { type: 'down', id, t },
      { type: 'up', id, t: t + 40, stamped },
    ];
    expect(run([...tap(1, 0), ...tap(2, 200)]).fx).toEqual(['strokeStart', 'strokeCommit', 'strokeStart', 'strokeCommit', 'fit']);
    expect(run([...tap(1, 0, true), ...tap(2, 200)]).fx).not.toContain('fit');
    expect(run([...tap(1, 0), ...tap(2, 200, true)]).fx).not.toContain('fit');
    expect(run([...tap(1, 0), ...tap(2, 40 + BRUSH_DOUBLE_TAP_MS + 10)]).fx).not.toContain('fit');
  });

  it('events of untracked pointers change nothing', () => {
    const s0 = run([{ type: 'down', id: 1, t: 0 }]).s;
    expect(brushGesture(s0, { type: 'up', id: 9, t: 10, stamped: false })).toEqual({ state: s0, effects: [] });
    expect(brushGesture(BRUSH_IDLE, { type: 'up', id: 9, t: 10, stamped: false })).toEqual({ state: BRUSH_IDLE, effects: [] });
    expect(brushPointers(BRUSH_IDLE)).toEqual([]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/brushGesture.test.ts`
Expected: FAIL — `Failed to load url ./brushGesture`.

- [x] **Step 3: Write the reducer**

Create `src/ui/brushGesture.ts`:

```ts
// 推臉筆 gestures (push-brush spec §2.5): which pointer draws, when a second finger cancels or commits the stroke and
// pinches, and when a stamp-free tap pair fits the view. Pure: zoomPan feeds it pointer events with their time and
// carries out the effects, so the rules are unit-tested without a DOM.
import { PINCH_GRACE_MS } from '../config/limits';

/** two stamp-free taps within this many ms fit the view (zoomPan.ts DOUBLE_TAP_MS) */
export const BRUSH_DOUBLE_TAP_MS = 300;

export type BrushGestureState =
  /** lastTap: when the last stamp-free tap ended (0 = none) */
  | { kind: 'idle'; lastTap: number }
  | { kind: 'stroke'; id: number; downAt: number; lastTap: number }
  | { kind: 'pinch'; ids: readonly [number, number] }
  /** one finger of a pinch is still down: it neither pans nor draws */
  | { kind: 'locked'; id: number };

export type BrushGestureEvent =
  | { type: 'down'; id: number; t: number }
  /** `stamped`: the live stroke applied a stamp (then it is never a tap) */
  | { type: 'up'; id: number; t: number; stamped: boolean }
  | { type: 'cancel'; id: number };

export type BrushEffect = 'strokeStart' | 'strokeCommit' | 'strokeCancel' | 'pinchStart' | 'pinchEnd' | 'fit';

export const BRUSH_IDLE: BrushGestureState = { kind: 'idle', lastTap: 0 };

export function brushGesture(s: BrushGestureState, e: BrushGestureEvent): { state: BrushGestureState; effects: BrushEffect[] } {
  const same = { state: s, effects: [] as BrushEffect[] };
  switch (s.kind) {
    case 'idle':
      if (e.type !== 'down') return same;
      return { state: { kind: 'stroke', id: e.id, downAt: e.t, lastTap: s.lastTap }, effects: ['strokeStart'] };
    case 'stroke':
      if (e.type === 'down') {
        const early = e.t - s.downAt <= PINCH_GRACE_MS;
        return { state: { kind: 'pinch', ids: [s.id, e.id] }, effects: [early ? 'strokeCancel' : 'strokeCommit', 'pinchStart'] };
      }
      if (e.id !== s.id) return same;
      if (e.type === 'cancel') return { state: BRUSH_IDLE, effects: ['strokeCommit'] };
      if (e.stamped) return { state: BRUSH_IDLE, effects: ['strokeCommit'] };
      if (s.lastTap > 0 && e.t - s.lastTap < BRUSH_DOUBLE_TAP_MS) return { state: BRUSH_IDLE, effects: ['strokeCommit', 'fit'] };
      return { state: { kind: 'idle', lastTap: e.t }, effects: ['strokeCommit'] };
    case 'pinch': {
      if (e.type === 'down') return same; // a third finger is ignored
      const [a, b] = s.ids;
      if (e.id !== a && e.id !== b) return same;
      return { state: { kind: 'locked', id: e.id === a ? b : a }, effects: ['pinchEnd'] };
    }
    case 'locked':
      if (e.type === 'down') return { state: { kind: 'pinch', ids: [s.id, e.id] }, effects: ['pinchStart'] };
      return e.id === s.id ? { state: BRUSH_IDLE, effects: [] } : same;
  }
}

/** what a pointer move does in this state */
export function brushMoveAction(s: BrushGestureState, id: number): 'feed' | 'pinch' | 'none' {
  if (s.kind === 'stroke') return s.id === id ? 'feed' : 'none';
  if (s.kind === 'pinch') return s.ids.includes(id) ? 'pinch' : 'none';
  return 'none';
}

/** the pointers this state tracks (zoomPan forgets every other one) */
export function brushPointers(s: BrushGestureState): number[] {
  if (s.kind === 'stroke' || s.kind === 'locked') return [s.id];
  if (s.kind === 'pinch') return [...s.ids];
  return [];
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/ui/brushGesture.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Wire brush mode into zoomPan**

In `src/ui/screens/zoomPan.ts` (CRLF):

1. Imports:

```ts
import { BRUSH_IDLE, brushGesture, brushMoveAction, brushPointers, type BrushEffect, type BrushGestureState } from '../brushGesture';
```

2. Above `useZoomPan`:

```ts
/** What brush mode (推臉筆) needs from the editor (push-brush spec §2.5). */
export interface BrushHooks {
  /** the first finger went down at a client point: start a live stroke there */
  start(p: { x: number; y: number }): void;
  /** client points of the drawing finger, coalesced events included, oldest first */
  move(ps: readonly { x: number; y: number }[]): void;
  /** finger up, a late second finger, pointercancel: commit the live stroke */
  commit(): void;
  /** a second finger within PINCH_GRACE_MS: cancel the live stroke (no undo step) */
  cancel(): void;
  /** the live stroke applied a stamp (queued points are applied first); false = it was a tap */
  stamped(): boolean;
  /** pinching started (true) or ended (false): the ring hides while pinching */
  pinch(on: boolean): void;
}
```

3. Add to step 4's `ZoomPanOptions` (the type of `useZoomPan`'s `opts`, read through `optsRef`):

```ts
  /** step 6 (推臉筆): brush mode — one finger draws, two fingers pinch and pan; onTap and spotTap are not called */
  brush?: BrushHooks | null;
```

Keep reading it through the same ref (`optsRef.current`); the effect still depends only on `[enabled]`.
4. Inside the effect, after `twoPoint` / `begin` (`:118-131` at `d09e608`), add the brush branch:

```ts
    // ── 推臉筆 brush mode (push-brush spec §2.5): the reducer decides; one finger never pans ──
    let bstate: BrushGestureState = BRUSH_IDLE;
    let bhooks: BrushHooks | null = null;
    const brushFx = (fx: BrushEffect[], b: BrushHooks, e: PointerEvent) => {
      for (const f of fx) {
        if (f === 'strokeStart') b.start({ x: e.clientX, y: e.clientY });
        else if (f === 'strokeCommit') b.commit();
        else if (f === 'strokeCancel') b.cancel();
        else if (f === 'pinchStart') {
          begin();
          b.pinch(true);
        } else if (f === 'pinchEnd') b.pinch(false);
        else if (f === 'fit') apply({ s: 1, x: 0, y: 0 }, true);
      }
    };
    /** the hooks of this event; a new hooks object (mode re-entered) restarts the reducer */
    const brushOf = (): BrushHooks | null => {
      const b = optsRef.current?.brush ?? null;
      if (b !== bhooks) {
        bhooks = b;
        bstate = BRUSH_IDLE;
      }
      return b;
    };
    const brushDown = (e: PointerEvent, b: BrushHooks) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = brushGesture(bstate, { type: 'down', id: e.pointerId, t: performance.now() });
      bstate = r.state;
      const keep = brushPointers(bstate); // a third finger is forgotten at once
      for (const id of [...pts.keys()]) if (!keep.includes(id)) pts.delete(id);
      brushFx(r.effects, b, e);
    };
    const brushMove = (e: PointerEvent, b: BrushHooks) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const act = brushMoveAction(bstate, e.pointerId);
      if (act === 'feed') {
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        b.move(list.length ? list.map((c) => ({ x: c.clientX, y: c.clientY })) : [{ x: e.clientX, y: e.clientY }]);
      } else if (act === 'pinch' && pts.size >= 2) {
        const t = twoPoint();
        apply(pinchView(start, m0, t.mid, t.dist / d0));
      }
    };
    const brushEnd = (e: PointerEvent, b: BrushHooks, cancelled: boolean) => {
      if (!pts.has(e.pointerId)) return;
      const drawing = bstate.kind === 'stroke' && bstate.id === e.pointerId;
      const r = brushGesture(
        bstate,
        cancelled
          ? { type: 'cancel', id: e.pointerId }
          : { type: 'up', id: e.pointerId, t: performance.now(), stamped: drawing ? b.stamped() : false },
      );
      bstate = r.state;
      pts.delete(e.pointerId);
      brushFx(r.effects, b, e);
    };
```

5. Route step 4's three handlers through it. At the top of `down`, **after** the button / `.slider-row` / `.status` target check (`:134` at `d09e608`, so 重置 and 按住對比 never start a stroke — Review Focus 4) and before its `stage.setPointerCapture` and step 4's gesture recording:

```ts
      const b = brushOf();
      if (b) {
        if (e.pointerType === 'mouse' && e.button !== 0) return; // the mouse's primary button draws (PB §2.5)
        brushDown(e, b);
        return;
      }
```

At the top of `move`: `const b = brushOf(); if (b) { brushMove(e, b); return; }`. At the top of step 4's `end` (one handler for `pointerup` and `pointercancel`, told apart by `e.type`, as step 4's `record` does):

```ts
      const b = brushOf();
      if (b) {
        brushEnd(e, b, e.type === 'pointercancel');
        return;
      }
```

The registrations stay as step 4 left them. In brush mode neither `onTap` nor `spotTap` is ever called and no tap is recorded (the brush branch returns before step 4's `record` / `tapOutcome`), and one finger never pans (the single-pointer pan in `move` is not reached).

- [x] **Step 6: Typecheck and run the UI tests**

Run: `npm run typecheck && npx vitest run src/ui`
Expected: no errors; PASS (`ui.test.ts` still covers `clampView` / `pinchView`; the brush branch is exercised end to end by Task 14).

- [x] **Step 7: Commit**

```bash
git add src/ui/brushGesture.ts src/ui/brushGesture.test.ts src/ui/screens/zoomPan.ts
git commit -m "feat(liquify): brush gesture reducer and zoomPan brush mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Live-stroke plumbing: the stamp queue and client → O mapping

PB §3.5 "Editor wiring": pointer points are queued and one animation frame drains up to 6 ms of stamps, then hands the field to the session once; the rest waits, so no point is dropped. PB §3.1/§3.3: a client point goes to V through the transformed `.zoom-layer` rect, then to O through step 3's `vToO`; the radius is `BRUSH_PX[size]` CSS px measured there, clamped. Pinned under every geometry (PB §8.1's `view.test.ts` row: every flip and quarter turn, straighten with a crop, zoom 1 and 5).

**Files:**
- Create: `src/ui/brushQueue.ts`, `src/ui/brushQueue.test.ts`
- Create: `src/ui/brushMapping.ts`, `src/ui/brushMapping.test.ts`

**Interfaces:**
- Consumes: Task 1 `STAMP_FRAME_MS`, `BRUSH_PX`; Task 2 `brushRadius`, `rMin`; step 3's `src/geometry/view.ts` (CR §3.2–§3.3): `vToO(g: Geometry, oSize: Size): Affine`, `oToV(g, oSize): Affine`, `apply(m: Affine, p: Vec2): [number, number]` with `type Vec2 = readonly [number, number]`, `setStraighten(start: Geometry, theta: number, oSize): Geometry`, `IDENTITY_GEOMETRY` (step-3 plan Task 1).
- Produces:
  - `interface BrushQueueDeps { add(o: {x,y}): boolean; changed(): void; now(): number; raf(cb: () => void): number; cancelRaf(id: number): void }`; `class BrushQueue { constructor(deps, budgetMs = STAMP_FRAME_MS); readonly size: number; push(o): void; drain(): void; finish(): void; clear(): void }`.
  - `interface ClientRect { left: number; top: number; width: number; height: number }`; `clientToO(c: {x,y}, layer: ClientRect, g: Geometry, oSize: LiquifyFrame): {x,y}`; `brushAt(c: {x,y}, size: BrushSize, layer: ClientRect, g: Geometry, oSize: LiquifyFrame): { o: {x,y}; radius: number; ringPx: number }`.

- [x] **Step 1: Write the failing tests**

Create `src/ui/brushQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BrushQueue } from './brushQueue';

/** a fake frame loop and clock: each add costs `cost` ms */
function rig(cost = 1) {
  let t = 0;
  const frames: (() => void)[] = [];
  const added: number[] = [];
  let changed = 0;
  const q = new BrushQueue(
    {
      add: (o) => {
        t += cost;
        added.push(o.x);
        return o.y !== 0; // y = 0 → this point changed nothing
      },
      changed: () => changed++,
      now: () => t,
      raf: (cb) => frames.push(cb),
      cancelRaf: (id) => {
        frames[id - 1] = () => undefined;
      },
    },
    6,
  );
  return {
    q,
    added,
    changes: () => changed,
    frame: () => frames.shift()?.(),
    pendingFrames: () => frames.length,
  };
}

describe('BrushQueue', () => {
  it('drains at most 6 ms of stamps per frame and keeps the rest for the next frame', () => {
    const r = rig(1);
    for (let i = 0; i < 10; i++) r.q.push({ x: i, y: 1 });
    expect(r.pendingFrames()).toBe(1); // one frame requested, not ten
    r.frame();
    expect(r.added).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.changes()).toBe(1); // one setLiquify per frame
    r.frame();
    expect(r.added).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.changes()).toBe(2);
    expect(r.q.size).toBe(0);
  });

  it('applies at least one point per frame even when one stamp exceeds the budget', () => {
    const r = rig(50);
    r.q.push({ x: 1, y: 1 });
    r.q.push({ x: 2, y: 1 });
    r.frame();
    expect(r.added).toEqual([1]);
    r.frame();
    expect(r.added).toEqual([1, 2]);
  });

  it('finish applies everything now; clear drops it', () => {
    const r = rig(1);
    for (let i = 0; i < 20; i++) r.q.push({ x: i, y: 1 });
    r.q.finish();
    expect(r.added).toHaveLength(20);
    expect(r.changes()).toBe(1);
    r.q.push({ x: 99, y: 1 });
    r.q.clear();
    r.frame();
    expect(r.added).toHaveLength(20);
  });

  it('a frame whose points changed nothing does not hand the field over', () => {
    const r = rig(1);
    r.q.push({ x: 1, y: 0 });
    r.frame();
    expect(r.changes()).toBe(0);
  });
});
```

Create `src/ui/brushMapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rMin } from '../edit/liquify';
import { apply, IDENTITY_GEOMETRY, oToV, setStraighten } from '../geometry/view';
import type { Geometry } from '../types';
import { brushAt, clientToO, type ClientRect } from './brushMapping';

const OS = { width: 1536, height: 2048 };
/** the view on screen at a fixed density: 0.2 CSS px per O pixel at zoom 1 (unrounded V size: crop × E size) */
const layerFor = (g: Geometry, zoom = 1): ClientRect => {
  const eW = g.quarter % 2 ? OS.height : OS.width;
  const eH = g.quarter % 2 ? OS.width : OS.height;
  return { left: 40, top: 100, width: g.crop.w * eW * 0.2 * zoom, height: g.crop.h * eH * 0.2 * zoom };
};
const ALL: Geometry[] = [false, true].flatMap((flipH) =>
  ([0, 1, 2, 3] as const).map((quarter) => ({ ...IDENTITY_GEOMETRY, flipH, quarter })),
);
const centre = (r: ClientRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

describe('client → V → O for brush points (push-brush spec §3.1, §8.1 view.test row)', () => {
  it('identity: the layer corners are the O corners', () => {
    const r = layerFor(IDENTITY_GEOMETRY);
    const o0 = clientToO({ x: r.left, y: r.top }, r, IDENTITY_GEOMETRY, OS);
    expect(o0.x).toBeCloseTo(0, 12);
    expect(o0.y).toBeCloseTo(0, 12);
    const o = clientToO({ x: r.left + r.width, y: r.top + r.height }, r, IDENTITY_GEOMETRY, OS);
    expect(o.x).toBeCloseTo(1, 12);
    expect(o.y).toBeCloseTo(1, 12);
  });

  it('every flip and quarter turn, and straighten 12° with its crop: inside the layer maps inside O, and back to the same client point', () => {
    const geos = [...ALL, setStraighten(IDENTITY_GEOMETRY, 12, OS), setStraighten({ ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 }, -7.3, OS)];
    for (const g of geos) {
      const r = layerFor(g);
      for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3], [0.2, 0.95]]) {
        const c = { x: r.left + fx * r.width, y: r.top + fy * r.height };
        const o = clientToO(c, r, g, OS);
        expect(o.x).toBeGreaterThanOrEqual(-1e-9);
        expect(o.x).toBeLessThanOrEqual(1 + 1e-9);
        expect(o.y).toBeGreaterThanOrEqual(-1e-9);
        expect(o.y).toBeLessThanOrEqual(1 + 1e-9);
        const v = apply(oToV(g, OS), [o.x, o.y]);
        expect(v[0]).toBeCloseTo(fx, 9);
        expect(v[1]).toBeCloseTo(fy, 9);
      }
    }
  });

  it('the 中 radius is the same S length under every geometry (rigid view), and 1/5 of it at zoom 5', () => {
    const expected = (28 / 0.2) / Math.min(OS.width, OS.height); // 28 CSS px at 0.2 px per O px, in short edges
    for (const g of [...ALL, setStraighten(IDENTITY_GEOMETRY, 12, OS)]) {
      const r = layerFor(g);
      expect(brushAt(centre(r), 'm', r, g, OS).radius).toBeCloseTo(expected, 9);
      const r5 = layerFor(g, 5);
      expect(brushAt(centre(r5), 'm', r5, g, OS).radius).toBeCloseTo(expected / 5, 9);
      expect(brushAt(centre(r5), 'm', r5, g, OS).ringPx).toBeCloseTo(28, 9);
    }
  });

  it('at a very deep zoom the radius clamps to rMin and the ring grows on screen to show it', () => {
    const r = layerFor(IDENTITY_GEOMETRY, 400);
    const b = brushAt(centre(r), 's', r, IDENTITY_GEOMETRY, OS);
    expect(b.radius).toBe(rMin(OS));
    expect(b.ringPx).toBeGreaterThan(16);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ui/brushQueue.test.ts src/ui/brushMapping.test.ts`
Expected: FAIL — `Failed to load url ./brushQueue` and `./brushMapping`.

- [x] **Step 3: Write the queue**

Create `src/ui/brushQueue.ts`:

```ts
// The live stroke's pointer queue (push-brush spec §3.5 "Editor wiring"): pointer points are queued and one animation
// frame drains up to STAMP_FRAME_MS of stamps, then hands the field to the session once. What does not fit waits for
// the next frame, so points are never dropped. No React state is touched per point.
import { STAMP_FRAME_MS } from '../config/limits';

export interface BrushQueueDeps {
  /** feed one O-frame point to the live stroke; true when the field changed */
  add(o: { x: number; y: number }): boolean;
  /** the field changed during this drain (the editor calls session.setLiquify) */
  changed(): void;
  now(): number;
  raf(cb: () => void): number;
  cancelRaf(id: number): void;
}

export class BrushQueue {
  private readonly q: { x: number; y: number }[] = [];
  private frame = 0;
  private readonly deps: BrushQueueDeps;
  private readonly budgetMs: number;

  constructor(deps: BrushQueueDeps, budgetMs = STAMP_FRAME_MS) {
    this.deps = deps;
    this.budgetMs = budgetMs;
  }

  get size(): number {
    return this.q.length;
  }

  push(o: { x: number; y: number }): void {
    this.q.push(o);
    if (!this.frame) this.frame = this.deps.raf(() => this.drain());
  }

  /** one frame's worth: at least one point, then until the budget is spent */
  drain(): void {
    this.frame = 0;
    const t0 = this.deps.now();
    let changed = false;
    while (this.q.length) {
      if (this.deps.add(this.q.shift()!)) changed = true;
      if (this.deps.now() - t0 >= this.budgetMs) break;
    }
    if (changed) this.deps.changed();
    if (this.q.length && !this.frame) this.frame = this.deps.raf(() => this.drain());
  }

  /** apply everything still queued now (before a commit) */
  finish(): void {
    this.cancelFrame();
    let changed = false;
    while (this.q.length) if (this.deps.add(this.q.shift()!)) changed = true;
    if (changed) this.deps.changed();
  }

  /** drop everything queued (a cancelled stroke) */
  clear(): void {
    this.cancelFrame();
    this.q.length = 0;
  }

  private cancelFrame(): void {
    if (this.frame) this.deps.cancelRaf(this.frame);
    this.frame = 0;
  }
}
```

- [x] **Step 4: Write the mapping**

Create `src/ui/brushMapping.ts`:

```ts
// 推臉筆 points and radius (push-brush spec §3.1, §3.3): a client point → V through the transformed .zoom-layer rect
// (the HeightBandOverlay / onTap convention, so it is right at any zoom) → O through step 3's view transform.
// Strokes live in the output O frame, so they stay on what the user pushed when the geometry changes later.
import { BRUSH_PX } from '../config/limits';
import { brushRadius } from '../edit/liquify';
import { apply, vToO } from '../geometry/view';
import type { BrushSize, Geometry, LiquifyFrame } from '../types';

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clientToO(c: { x: number; y: number }, layer: ClientRect, g: Geometry, oSize: LiquifyFrame): { x: number; y: number } {
  const [x, y] = apply(vToO(g, oSize), [(c.x - layer.left) / layer.width, (c.y - layer.top) / layer.height]);
  return { x, y };
}

/**
 * The stroke start: its O point, the brush radius (S units; BRUSH_PX[size] CSS px measured at that point with the
 * current zoom and geometry, clamped to [rMin, R_MAX]) and the ring radius in CSS px (larger when clamped to rMin).
 */
export function brushAt(
  c: { x: number; y: number },
  size: BrushSize,
  layer: ClientRect,
  g: Geometry,
  oSize: LiquifyFrame,
): { o: { x: number; y: number }; radius: number; ringPx: number } {
  const o = clientToO(c, layer, g, oSize);
  const r = brushRadius(o, clientToO({ x: c.x + BRUSH_PX[size], y: c.y }, layer, g, oSize), oSize);
  return { o, radius: r.radius, ringPx: BRUSH_PX[size] * r.ringScale };
}
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/ui/brushQueue.test.ts src/ui/brushMapping.test.ts && npm run typecheck`
Expected: PASS (4 + 4 tests); no errors.

- [x] **Step 6: Commit**

```bash
git add src/ui/brushQueue.ts src/ui/brushQueue.test.ts src/ui/brushMapping.ts src/ui/brushMapping.test.ts
git commit -m "feat(liquify): rAF stamp queue and client-to-O brush mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Brush UI components: bar, ring, hint, icon, styles

PB §2.2 (the bar that replaces the slider row: 推 · 恢復, 小 · 中 · 大, 全部清除 with the 「確定清除？」 second tap within 3 s), §2.3 (the ring, drawn in screen space outside `.zoom-layer`, moved imperatively; the hint pill for 2.5 s with a 300 ms fade) and §2.1 (our own `brush` icon, 1.5–2 px strokes, DS §7.1).

**Files:**
- Create: `src/ui/components/BrushBar.tsx`, `src/ui/components/BrushOverlay.tsx`, `src/ui/components/BrushHint.tsx`
- Create: `src/ui/brushUi.test.ts`
- Modify: `src/ui/icons.tsx` (CRLF; the "panel extras" block, `:369-400` at `d09e608`, `custom` at `:394-400`; no `brush` key exists yet)
- Modify: `src/ui/theme.css` (CRLF; after the Editor block that ends with `.editor-bottom-pad`, `:1976-1983` at `d09e608`)

**Interfaces:**
- Consumes: `Segmented` (`src/ui/components/Controls.tsx:47-74`), `haptic` (`src/ui/platform.ts`), Task 1 `BRUSH_PX`, `BrushKind`, `BrushSize`; Task 2 `LiveStroke['state']`; step 4's `CLEAR_CONFIRM_MS = 3000` (`src/ui/panelModel.ts`, the 祛痘 全部清除 window: both clears share it, C §12 #30).
- Produces:
  - `BrushBar(props: { kind: BrushKind; size: BrushSize; strokes: number; busy: boolean; onKind(k: BrushKind): void; onSize(s: BrushSize): void; onClear(): void })`; `BRUSH_KINDS`, `BRUSH_SIZES`.
  - `type RingLook = 'push' | 'restore' | 'dim'`; `ringLook(kind: BrushKind, state: LiveStroke['state']): RingLook`; `interface RingHandle { show(x: number, y: number, r: number, look: RingLook): void; hide(): void }`; `BrushOverlay(props: { handle: { current: RingHandle | null } })`.
  - `hintText(kind: BrushKind): string`; `BRUSH_HINT_MS = 2800`; `BrushHint(props: { kind: BrushKind })`.
  - icon key `brush`.

- [x] **Step 1: Write the failing test**

Create `src/ui/brushUi.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BRUSH_PX } from '../config/limits';
import { BRUSH_KINDS, BRUSH_SIZES } from './components/BrushBar';
import { BRUSH_HINT_MS, hintText } from './components/BrushHint';
import { ringLook } from './components/BrushOverlay';
import { hasIcon } from './icons';
import { CLEAR_CONFIRM_MS } from './panelModel';

describe('brush UI (push-brush spec §2.2–§2.4)', () => {
  it('segments and copy', () => {
    expect(BRUSH_KINDS.map((o) => o.label)).toEqual(['推', '恢復']);
    expect(BRUSH_SIZES.map((o) => o.label)).toEqual(['小', '中', '大']);
    expect(BRUSH_SIZES.map((o) => BRUSH_PX[o.value])).toEqual([16, 28, 44]);
    expect(hintText('push')).toBe('單指推動，雙指縮放');
    expect(hintText('restore')).toBe('單指塗抹恢復，雙指縮放');
    expect(CLEAR_CONFIRM_MS).toBe(3000);
    expect(BRUSH_HINT_MS).toBe(2800); // 2.5 s shown + 300 ms fade
  });

  it('the ring: 推 accent, 恢復 dashed white, dim while the brush resists or a cap is hit', () => {
    expect(ringLook('push', 'ok')).toBe('push');
    expect(ringLook('restore', 'ok')).toBe('restore');
    expect(ringLook('push', 'resisting')).toBe('dim');
    expect(ringLook('restore', 'capped')).toBe('dim');
  });

  it('has its own brush icon', () => {
    expect(hasIcon('brush')).toBe(true);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/brushUi.test.ts`
Expected: FAIL — `Failed to load url ./components/BrushBar`.

- [x] **Step 3: Write the components**

Create `src/ui/components/BrushBar.tsx`:

```tsx
// 推臉筆 bar (push-brush spec §2.2): replaces the slider row while the brush is the selected strip item.
// 推／恢復 and the size are remembered by the editor for the app session; neither is an undo step.
import { useEffect, useState } from 'preact/hooks';
import type { BrushKind, BrushSize } from '../../types';
// 全部清除 → 確定清除？ stays armed this long: step 4's constant, shared with the 祛痘 clear (the 重置 pattern in Editor.tsx)
import { CLEAR_CONFIRM_MS } from '../panelModel';
import { haptic } from '../platform';
import { Segmented } from './Controls';

export const BRUSH_KINDS: readonly { value: BrushKind; label: string }[] = [
  { value: 'push', label: '推' },
  { value: 'restore', label: '恢復' },
];
export const BRUSH_SIZES: readonly { value: BrushSize; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
];

interface Props {
  kind: BrushKind;
  size: BrushSize;
  /** stroke records of the photo (全部清除 is disabled at 0) */
  strokes: number;
  /** a stroke is being drawn */
  busy: boolean;
  onKind(k: BrushKind): void;
  onSize(s: BrushSize): void;
  /** the second tap: one undo step */
  onClear(): void;
}

export function BrushBar({ kind, size, strokes, busy, onKind, onSize, onClear }: Props) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), CLEAR_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    if (strokes === 0) setConfirm(false);
  }, [strokes]);
  const tapClear = () => {
    haptic();
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    onClear();
  };
  return (
    <div class="slider-row brush-bar" role="group" aria-label="推臉筆">
      <Segmented label="筆刷模式" value={kind} options={BRUSH_KINDS} onChange={onKind} />
      <Segmented label="筆刷大小" value={size} options={BRUSH_SIZES} onChange={onSize} />
      <button type="button" class={`brush-clear${confirm ? ' confirm' : ''}`} disabled={strokes === 0 || busy} onClick={tapClear}>
        {confirm ? '確定清除？' : '全部清除'}
      </button>
    </div>
  );
}
```

Create `src/ui/components/BrushOverlay.tsx`:

```tsx
// 推臉筆 ring (push-brush spec §2.3): an SVG in .frame, outside .zoom-layer, so it is drawn in screen space and needs no
// zoom value. The editor moves it through `handle` on every pointer frame: no re-render per move.
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { LiveStroke } from '../../edit/liquify';
import type { BrushKind } from '../../types';

export type RingLook = 'push' | 'restore' | 'dim';

/** 推: --accent · 恢復: white, dashed 4/4 · --dim while the brush resists (the guard skipped the last stamp) or a cap is hit */
export function ringLook(kind: BrushKind, state: LiveStroke['state']): RingLook {
  return state === 'ok' ? kind : 'dim';
}

export interface RingHandle {
  /** centre in .frame px, radius in CSS px */
  show(x: number, y: number, r: number, look: RingLook): void;
  hide(): void;
}

export function BrushOverlay({ handle }: { handle: { current: RingHandle | null } }) {
  const ref = useRef<SVGCircleElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    handle.current = {
      show(x, y, r, look) {
        c.setAttribute('cx', x.toFixed(1));
        c.setAttribute('cy', y.toFixed(1));
        c.setAttribute('r', Math.max(1, r).toFixed(1));
        c.setAttribute('class', `brush-ring ${look}`);
      },
      hide() {
        c.setAttribute('class', 'brush-ring hidden');
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);
  return (
    <svg class="brush-overlay" aria-hidden="true">
      <circle ref={ref} class="brush-ring hidden" cx="0" cy="0" r="1" />
    </svg>
  );
}
```

Create `src/ui/components/BrushHint.tsx`:

```tsx
// 推臉筆 hint pill (push-brush spec §2.3): top centre of .frame, outside the zoom layer; shown 2.5 s on entering the
// mode and on each 推／恢復 switch, then fades over 300 ms (CSS). The editor unmounts it after BRUSH_HINT_MS.
import type { BrushKind } from '../../types';

export const BRUSH_HINT_MS = 2800;

export function hintText(kind: BrushKind): string {
  return kind === 'push' ? '單指推動，雙指縮放' : '單指塗抹恢復，雙指縮放';
}

export function BrushHint({ kind }: { kind: BrushKind }) {
  return (
    <div class="brush-hint" role="status">
      {hintText(kind)}
    </div>
  );
}
```

- [x] **Step 4: Add the icon**

In `src/ui/icons.tsx` (CRLF), in the `// ── panel extras ──` block after `custom` (`:394-400` at `d09e608`, before the `// ── 裁切` block):

```tsx
  /** 推臉筆: a fingertip pushing content sideways (our own line icon, DS §7.1) */
  brush: (
    <>
      <circle cx="9" cy="12" r="4.6" />
      <path d="M13.6 12h6.6M17.6 9.4l2.6 2.6-2.6 2.6" />
      <path d="M4.4 7.2c-1.2 1.4-1.6 3-1.6 4.8s.4 3.4 1.6 4.8" />
    </>
  ),
```

- [x] **Step 5: Add the styles**

In `src/ui/theme.css` (CRLF), after the `.editor-bottom-pad` rule (`:1980-1983` at `d09e608`):

```css
/* ───────────── 推臉筆 (push-brush spec §2.2, §2.3) ───────────── */

/* the bar takes the slider row's place: 50 px tall (.editor-panel .slider-row), every target ≥ 44 pt */
.editor-panel .brush-bar {
  justify-content: space-between;
  gap: 0;
}
.brush-bar .segmented {
  flex: none;
}
.brush-bar .segmented:nth-of-type(1) button {
  min-width: 48px;
}
.brush-bar .segmented:nth-of-type(2) button {
  min-width: 44px;
}
.brush-clear {
  width: 88px;
  min-height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  background: rgba(0, 0, 0, 0.35);
  transition: background-color 140ms;
}
.brush-clear.confirm {
  background: var(--danger);
  color: #fff;
}
.brush-clear:disabled {
  opacity: 0.38;
}
.brush-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 2;
}
.brush-ring {
  fill: none;
  stroke-width: 1.5px;
}
.brush-ring.push {
  stroke: var(--accent);
}
.brush-ring.restore {
  stroke: #fff;
  stroke-dasharray: 4 4;
}
.brush-ring.dim {
  stroke: var(--dim);
}
.brush-ring.hidden {
  display: none;
}
.brush-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  padding: 6px 12px;
  border-radius: 14px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  animation: brush-hint 2800ms forwards;
}
@keyframes brush-hint {
  0%,
  89% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
/* 推臉筆 is never gated: it stays bright while the face note dims the rest of 美型 (push-brush spec §2.1) */
.strip.face-off .item.brush-item {
  opacity: 1;
}
```

Width at 375 pt: 100 (2 × 48 + 4) + 136 (3 × 44 + 4) + 88 = 324 ≤ 343 (375 − 2 × 16), so `space-between` leaves about 9 pt between the groups.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/ui/brushUi.test.ts && npm run typecheck`
Expected: PASS (3 tests); no errors.

- [x] **Step 7: Commit**

```bash
git add src/ui/components/BrushBar.tsx src/ui/components/BrushOverlay.tsx src/ui/components/BrushHint.tsx src/ui/brushUi.test.ts src/ui/icons.tsx src/ui/theme.css
git commit -m "feat(liquify): brush bar, ring overlay, hint pill, icon and styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The 推臉筆 item in the 美型 and 美體 strips

PB §2.1: last item of both strips (after step 5's 左右分開 in 美型, after 背景保護 in 美體), **never gated** (no face, 基本模式, body-only person, 美體 loading / none / error), has-value dot when the photo has strokes (tab dots do not count strokes), `sliderFor` returns null in brush mode, and the module-level `lastSel` never stores `'brush'` (it keeps the item selected before the brush, so the next photo never opens in brush mode).

**Files:**
- Modify: `src/ui/panelModel.ts` (CRLF; at `d09e608`: `BodySel` `:14`, `PanelSelection` `66-80`, `showsHeightBand` `306-309`, `ItemAction` `328-354`, `bodyItems` `420-461`, `rememberable` `559-562`, `itemsFor` `992-1058` (shared `'skin'` / `'shape'` case `1012-1035`, `'body'` `1036-1037`), `activate` `1077-1153` (`'height'` case `1121-1122`), `sliderFor` `1226-1276` (shared case `1242-1250`, `'body'` `1251-1255`))
- Modify: `src/ui/panelModel.test.ts` (LF)
- Modify: `src/ui/components/BeautyPanel.tsx` (CRLF; at `d09e608`: `faceOff` `:112`, `tapItem` `121-157` (its haptic list `141-151`), the items map `233-262`)
- Modify (found while implementing): `tests/e2e/editor.spec.ts` (LF): the test 「no face in the photo: 美型 / 美妝 are dimmed…」 expected every 美型 option to be `aria-disabled`; 推臉筆 is exempt (PB §2.1), so its loop now expects 推臉筆 enabled and every other option disabled. Four existing `panelModel.test.ts` strip-order assertions (the 美型 and 美體 key lists, the idle / loading / none / error enabled list, and the 美型 wiring test that ended with the 左右分開 switch) now end with `BRUSH_KEY`. These are intended assertion changes for Task 17's kept-assertions check.

**Interfaces:**
- Consumes (step-1 plan Task 10, step-4 plan Tasks 16–17): `itemsFor(lens: Lens, sel: PanelSelection, body?: BodyContext, skin?: SkinPanelContext): PanelItem[]` (step 4 added `skin`, which the camera never passes), `activate(item, lens, sel, ctx?): ActivateResult` with `ActivateResult { edit: EditState; sel; changed; notice?; retryLook? }` and its local `done(next = edit, nextSel = sel, notice?)` (the `'height'` case is `return done(edit, sel.body === 'height' ? sel : { ...sel, body: 'height' });`; `makeupAction` answers first and returns null for every non-美妝 action, and the switch has no `default`, so `'brush'` needs its own case), `sliderFor(lens, sel, body?, skin?)` (the shared `'skin'` / `'shape'` case starts `const id = sel[sel.tab]; if (id === 'spot') return null;`, and the `'body'` case starts `if (!bodyItemGate(lens, body, sel.body).ok) return null;`), `Lens.edit`; `lensFor`, `CAMERA_BODY` (`panelModel.ts:141-145` at `d09e608`, what the camera passes as `body`), `INITIAL_SELECTION`, `PanelSelection` (step 4: `skin: SkinSel`), `BodySel`; step 4's `rememberable(sel)` (lastSel never keeps `'spot'`); step 5's 左右分開 toggle item at the end of the 美型 strip (FD §2.2); Task 3's `withStrokes`, `defaultPhoto`; Task 10's `brush` icon.
- Produces:
  - `PanelSelection.shape: ParamId | 'brush'`, `PanelSelection.body: BodySel | 'brush'`; `ItemAction` gains `{ type: 'brush' }`.
  - `BRUSH_KEY = 'brush'`, `BRUSH_LABEL = '推臉筆'`; `brushItem(sel: PanelSelection, strokes: number): PanelItem`; `showsBrush(sel: PanelSelection): boolean`; `brushSel(sel: PanelSelection): PanelSelection`; `rememberSel(next: PanelSelection, last: PanelSelection): PanelSelection` (composed with step 4's `rememberable` by the Editor, Task 12).
  - The strip reads the stroke count from `lens.edit.photo.strokes.length` (no new parameter).

- [x] **Step 1: Write the failing tests**

Append to `src/ui/panelModel.test.ts` (step 1's port already imports `activate`, `itemsFor`, `sliderFor`, `tabHasValue`, `INITIAL_SELECTION` and `CAMERA_BODY`; add any of them that is missing, and merge the imports below into the file's):

```ts
import { defaultPhoto, naturalPerson, neutralPerson, withStrokes } from '../edit/state';
import { lensFor, P0_INFO } from '../edit/lens';
import type { BodyContext } from './panelModel';
import type { EditState, Stroke } from '../types';
import { BRUSH_KEY, brushItem, rememberSel, showsBrush, type PanelSelection } from './panelModel';

describe('推臉筆 in the strips (push-brush spec §2.1)', () => {
  const rec: Stroke = { id: 'k', kind: 'push', radius: 0.05, strength: 0.75, points: Float32Array.of(0.3, 0.3, 0.3125, 0.3) };
  const edit0 = (): EditState => ({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
  // P0_INFO[0] carries every PersonInfo field later steps may add; only face / body vary here
  const lensOf = (e: EditState, face = true, body = true) => lensFor(e, { kind: 'person', id: 'p0' }, [{ ...P0_INFO[0], face, body }], 'p0');
  const at = (tab: 'shape' | 'body', brush = false): PanelSelection => ({
    ...INITIAL_SELECTION,
    tab,
    ...(brush ? (tab === 'shape' ? { shape: 'brush' as const } : { body: 'brush' as const }) : {}),
  });

  it('is the last item of 美型 and of 美體, selected only in brush mode', () => {
    for (const tab of ['shape', 'body'] as const) {
      const items = itemsFor(lensOf(edit0()), at(tab));
      expect(items.at(-1)!.key).toBe(BRUSH_KEY);
      expect(items.at(-1)!.label).toBe('推臉筆');
      expect(items.at(-1)!.selected).toBe(false);
      expect(itemsFor(lensOf(edit0()), at(tab, true)).at(-1)!.selected).toBe(true);
    }
  });

  it('is never gated: a body-only person, 美體 idle / loading / none / error', () => {
    const shape = itemsFor(lensOf(edit0(), false, true), at('shape')).at(-1)!;
    expect(shape.disabled).toBe(false);
    for (const status of ['idle', 'loading', 'none', 'error'] as const) {
      const body: BodyContext = { status, availability: () => ({ ok: false, reason: 'x' }), people: 0 };
      const item = itemsFor(lensOf(edit0()), at('body'), body).at(-1)!;
      expect(item.key).toBe(BRUSH_KEY);
      expect(item.disabled).toBe(false);
    }
  });

  it('shows the has-value dot when the photo has strokes; tab dots ignore strokes', () => {
    const e = withStrokes(edit0(), [rec]);
    expect(brushItem(at('shape'), 1).hasValue).toBe(true);
    expect(brushItem(at('body'), 0).hasValue).toBe(false);
    expect(itemsFor(lensOf(e), at('body')).at(-1)!.hasValue).toBe(true);
    expect(itemsFor(lensOf(edit0()), at('body')).at(-1)!.hasValue).toBe(false);
    // a tab dot keeps meaning "a slider item here has a value": strokes never change it
    for (const tab of ['shape', 'body'] as const) expect(tabHasValue(lensOf(e), tab)).toBe(tabHasValue(lensOf(edit0()), tab));
  });

  it('activate selects the brush without an edit (no undo step); sliderFor is null in brush mode', () => {
    const e = edit0();
    const item = brushItem(at('shape'), 0);
    const r = activate(item, lensOf(e), at('shape'));
    expect(r.changed).toBe(true);
    expect(r.sel.shape).toBe('brush');
    expect(r.edit).toBe(e);
    expect(activate(item, lensOf(e), at('shape', true)).changed).toBe(false);
    expect(showsBrush(at('shape', true))).toBe(true);
    expect(showsBrush(at('body', true))).toBe(true);
    expect(showsBrush({ ...at('shape', true), tab: 'skin' })).toBe(false);
    expect(sliderFor(lensOf(e), at('shape', true))).toBeNull();
    expect(sliderFor(lensOf(e), at('body', true))).toBeNull();
  });

  it('is editor-only: the camera context drops it from 美型 and 美體 (live: false, C §2.4)', () => {
    for (const tab of ['shape', 'body'] as const) {
      expect(itemsFor(lensOf(edit0()), at(tab), CAMERA_BODY).some((i) => i.key === BRUSH_KEY)).toBe(false);
    }
  });

  it('lastSel never holds the brush: it keeps the item selected before it', () => {
    const last = { ...INITIAL_SELECTION, tab: 'shape' as const, shape: 'shape.faceSlim' as const };
    const next = rememberSel({ ...last, shape: 'brush' }, last);
    expect(next.shape).toBe('shape.faceSlim');
    expect(next.tab).toBe('shape');
    const body = rememberSel({ ...last, tab: 'body', body: 'brush' }, last);
    expect(body.body).toBe(last.body);
    expect(rememberSel(last, INITIAL_SELECTION)).toEqual(last);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ui/panelModel.test.ts`
Expected: FAIL — `brushItem` / `showsBrush` / `rememberSel` are not exported.

- [x] **Step 3: Implement the panel model**

In `src/ui/panelModel.ts` (CRLF):

1. Selection and action types (`PanelSelection` `:66-80` and `ItemAction` `:328-354` at `d09e608`):

```ts
  shape: ParamId | 'brush';
  body: BodySel | 'brush';
```

and in `ItemAction`:

```ts
  /** 美型 / 美體: select 推臉筆 (the screen shows the brush bar and draws strokes) */
  | { type: 'brush' };
```

2. Next to `showsHeightBand` (`:306-309` at `d09e608`):

```ts
export const BRUSH_KEY = 'brush';
export const BRUSH_LABEL = '推臉筆';

/** brush mode: 推臉筆 is the selected item of 美型 or 美體 (push-brush spec §2.1) */
export function showsBrush(sel: PanelSelection): boolean {
  return (sel.tab === 'shape' && sel.shape === 'brush') || (sel.tab === 'body' && sel.body === 'brush');
}

/** The 推臉筆 strip item: last in 美型 and 美體, never gated; the dot shows when the photo has strokes. */
export function brushItem(sel: PanelSelection, strokes: number): PanelItem {
  return {
    key: BRUSH_KEY,
    label: BRUSH_LABEL,
    visual: { kind: 'icon', icon: 'brush' },
    selected: showsBrush(sel),
    hasValue: strokes > 0,
    action: { type: 'brush' },
    ...ENABLED,
  };
}

/** What the module-level lastSel keeps (Editor.tsx lastSel): never 'brush', so the next photo never opens in brush mode. */
export function rememberSel(next: PanelSelection, last: PanelSelection): PanelSelection {
  if (next.shape !== 'brush' && next.body !== 'brush') return next;
  return { ...next, shape: next.shape === 'brush' ? last.shape : next.shape, body: next.body === 'brush' ? last.body : next.body };
}
```

3. Below `brushItem`:

```ts
/** 推臉筆 closes the 美型 and 美體 strips in the editor; the camera (CAMERA_BODY, status 'unsupported') has no brush (live: false, C §2.4) */
function withBrush(items: PanelItem[], lens: Lens, sel: PanelSelection, body: BodyContext | undefined): PanelItem[] {
  return body?.status === 'unsupported' ? items : [...items, brushItem(sel, lens.edit.photo.strokes.length)];
}
```

4. In `itemsFor`: the shared `case 'skin': case 'shape':` (`:1012-1035` at `d09e608`) builds `defs` and returns one array literal, `[RESET_ITEM(), ...(sel.tab === 'shape' ? decorateShapeItems(defs, lens) : defs), ...(sel.tab === 'skin' && skin ? [...toneItems(lens, sel, skin), spotItem(sel, skin)] : [])]` (step 5's `decorateShapeItems` ends the 美型 items with the 左右分開 switch). Bind that literal, unchanged, to a constant and close only the 美型 strip with the brush, so it comes after the switch and `'skin'` gets none:

```ts
    case 'skin':
    case 'shape': {
      const defs = /* … step 1's paramsInGroup(sel.tab).map(…), unchanged … */;
      const items: PanelItem[] = [/* … the literal steps 1, 4 and 5 left here, unchanged … */];
      return sel.tab === 'shape' ? withBrush(items, lens, sel, body) : items;
    }
```

and in `case 'body':` return `withBrush(bodyItems(lens, sel, body), lens, sel, body)` (after 背景保護). The item never goes through `gated(…)` or any per-person or 美體 gating.
5. Below `rememberSel`:

```ts
/** the selection with 推臉筆 selected in the current tab (美型 or 美體) */
export function brushSel(sel: PanelSelection): PanelSelection {
  return sel.tab === 'shape' ? { ...sel, shape: 'brush' } : { ...sel, body: 'brush' };
}
```

In `activate`, add a case directly after step 1's `'height'` case (`case 'height': return done(edit, sel.body === 'height' ? sel : { ...sel, body: 'height' });`, `:1121-1122` at `d09e608`; `makeupAction`'s `default` returns null for `'brush'`, so the switch reaches it):

```ts
    case 'brush':
      // selection only: no edit, so no undo step and no flip to 自訂
      return done(edit, showsBrush(sel) ? sel : brushSel(sel));
```

With the brush already selected the selection is returned unchanged, so `changed` is false.
6. In `sliderFor`, return null for the brush before anything reads the selection as a `ParamId`. The shared case starts `case 'skin': case 'shape': { const id = sel[sel.tab]; if (id === 'spot') return null;` (`:1242-1245` at `d09e608`), followed by the tone and `usable` guards; add one line right after the `'spot'` line:

```ts
      if (id === 'brush') return null; // the brush bar replaces the slider row (push-brush spec §2.2)
```

(TypeScript then narrows `id` to `ParamId` for `isToneId`, `paramBinding(lens, id)` and `withSides(…, id)` below, next to step 4's own narrowing of `'spot'`.) In `case 'body':` the existing first line (`:1253`) becomes:

```ts
      if (sel.body === 'brush' || !bodyItemGate(lens, body, sel.body).ok) return null;
```

7. `npm run typecheck` now reports every place that still treats `sel.shape` / `sel.body` as a `ParamId` (at `d09e608` the readers are `panelModel.ts` itself, with `sliderFor` covered by item 6, and Editor's `ruler: sel.tab === 'body' && sel.body === 'body.legs' …`, which compiles as is). Narrow each one it reports with the brush check above; none of them may run for `'brush'`.

- [x] **Step 4: Exempt the item from the face-off dimming**

In `src/ui/components/BeautyPanel.tsx` (CRLF):
1. Add `BRUSH_KEY` to the existing import from `'../panelModel'`.
2. In the items map (`:233-262` at `d09e608`): `aria-disabled={(faceOff && item.key !== BRUSH_KEY) || item.disabled ? 'true' : undefined}` (`:241`) and add `${item.key === BRUSH_KEY ? ' brush-item' : ''}` to the item's class list (`:244`; Task 10's `.strip.face-off .item.brush-item` keeps it bright).
3. In `tapItem` (`:121-157`): add `a === 'brush'` to the actions that call `haptic()` (the `a === 'preset' || … || a === 'split'` list, `:141-151`).

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS; no errors.

- [x] **Step 6: Commit**

```bash
git add src/ui/panelModel.ts src/ui/panelModel.test.ts src/ui/components/BeautyPanel.tsx
git add -u
git commit -m "feat(liquify): 推臉筆 strip item in 美型 and 美體, never gated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Editor wiring: draw, commit, undo, persist and export the strokes

PB §3.5 "Editor wiring", §2.5 (commit before anything that ends the editing context), §3.6 (caps and the toast), §2.1–§2.4 (bar in place of the slider row, also when `faceOff`; ring and hint; face boxes hidden, person strip dimmed with 「整張照片」; no person selection by tap), §5 (one gesture = one undo step, autosave carries the whole `EditState`). The test for this task is the first end-to-end test of `tests/e2e/liquify.spec.ts`: it fails until the editor draws.

**Files:**
- Modify: `src/ui/screens/Editor.tsx` (LF; anchors at `d09e608`: `143` lastSel, `154-156` `edit` / `editRef`, `402-405` `frameOf`, `407-416` `planFor`, `444-453` undo, `455-461` setSel, `467-487` update, `554-642` session (its `deps.createStillSession(…)` options `602-607`), `771-812` flushHistory, `814-831` visibilitychange, `833-860` unmount, `970-975` snapshotField, `1075-1082` render effect, `1095-1100` encode, `1109-1178` encode / autosave effect, `1180-1186` hold, `1212-1247` save, `1262-1283` runWorking, `1290-1342` runTiled, `1355-1388` undo / redo, `1389-1402` 重置, `1485-1541` tapSpot, `1555-1564` onPersonTap, `1566-1570` zoomPan, `1588` scope, `1613` showBoxes, `1616-1624` faceNote / faceOff, `1633-1658` overlay chain, `1660-1797` JSX)
- Modify: `tests/e2e/fixtures.ts` (LF), `tests/e2e/body.spec.ts` (LF; `emptyPng` moves out, `:44-58` at `d09e608`, and with it the file's only use of `PNG`, `:10`)
- Create: `tests/e2e/liquify.spec.ts`
- Modify (found while implementing): `src/edit/state.ts`, `src/edit/state.test.ts` (LF): `rebaseStrokes(e, from, to)`. `update`'s `commitLive()` commits the live stroke before the edit it was called with, but a strip item's edit (`BeautyPanel` computes it from the rendered `edit`, which never holds the live stroke; e.g. 背景保護 or a preset tapped with a second finger) would then replace the committed state and drop the stroke from it. `commitLive` records the list it replaced and the one it made (`committed`), and `update` hands an edit that still holds exactly the replaced list (by identity) the committed one; 全部清除 and 重置 make a new list, so they still clear. Pinned by a unit test and by a second e2e test in `liquify.spec.ts` (「a strip item tapped while a finger draws…」, seen failing with the rebase disabled). Also: `enterBrush` first waits for the hint pill to appear (it mounts in an effect after the bar, so the count-0 check could pass before it existed and the 「before」 grab then held the pill); `setBrushSize`'s 700 ms preview timer is kept in a ref and restarted by a later size tap; `move` ignores an empty point list.

**Interfaces:**
- Consumes: Task 2 `LiquifyModel`, `LiveStroke`, `makeStrokeId`; Task 3 `withStrokes`, `clearStrokes`, `editKey`, `EditorSource.frame`; Task 6 `StillSession.setLiquify / liquify`, `StillSessionOptions.liquify`, `exportImageData(frame, body?, liquify?)`; Task 8 `BrushHooks`, `useZoomPan(…, { onTap, brush })`; Task 9 `BrushQueue`, `brushAt`, `clientToO`; Task 10 `BrushBar`, `BrushOverlay`, `RingHandle`, `ringLook`, `BrushHint`, `BRUSH_HINT_MS`; Task 11 `showsBrush`, `rememberSel`. From step 1 (PS §3.3, §3.4 U1–U5): the `edit` state and `editRef` (`:154-156` at `d09e608`), `update(e, commit, user = true)`, `UndoStack<EditState>` with `{ clone: false, key: editKey }`, `setSel`, the `Selection` state, `buildFrame` → `session.render(frame)`, `OutputStamp.key = editKey(edit)`, the `FaceBoxes` / `PersonStrip` components with their photo-level flag (A11), the person-tap handler (`onPersonTap`, as step 4 names it). From step 4 (step-4 plan Task 17): `spotMode`, `tapSpot`, `setSel` storing `lastSel = rememberable(s)`, the `{spotMode ? <SpotControls …/> : <SliderRow …/>}` ternary in `.editor-panel`, and its `useZoomPan(…, { onTap: spotMode ? undefined : onPersonTap, spotTap: spotMode ? tapSpot : undefined })`. From step 3 (step-3 plan Tasks 14 and 17), as landed: `cropMode = sel.tab === 'crop'`; `useZoomPan(stageRef, layerRef, !!session && !cropMode, { onTap, spotTap, resetWhen: cropMode })`; no StillFrame ref: `frameOf(e: EditState, s = sessionRef.current)` builds the frame session `s` renders and exports for `e` (`buildFrame(…)`), and every export takes the `EditState`: `planFor(s, e, src, field)` → `planExport(…, s.bounds(frameOf(e, s), field), …)`; `encode(s, e, field, plan)` (renders `s.exportImageData(frameOf(e, s), field)`); `runWorking(s, e, field, plan, key, gen, t0)` and `runTiled(s, e, field, plan, key, gen, t0)` (which takes `const frame = frameOf(e, s)` and calls `deps.runTiledExport(engine, blob, plan, s.tileInput(frame, field), …)`, and on a failure falls back to `runWorking(sessionRef.current ?? s, e, field, working, key, gen, t0)`); `snapshotField()` and `settleField()`; the debounced encode effect that computes `plan` with `planFor`, guarded by `exportBusy` (a tiled export runs). (This task's DOM ref for the `.frame` element is called `frameEl`.)
- Produces: `window.__meiyan.liquify` = `{ strokes, version, work, maxDisp, pending }` (written on mount, sync, commit, cancel and rebuild end); e2e helpers `emptyPng`, `LINE`, `linePng`, `liquifyState`, `brushDrag`, `touch`, `savedPixels` in `tests/e2e/fixtures.ts`.

- [x] **Step 1: Add the e2e helpers**

In `tests/e2e/fixtures.ts` (LF; it already imports `PNG` and `Page`), append:

```ts
/** A person-free photo: a soft gradient with a straight dark row band at y 640–660 (moved from body.spec.ts). */
export function emptyPng(width = 600, height = 900): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = y > 640 && y < 660 ? 40 : 120 + Math.round((80 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 4;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** A person-free photo with one dark vertical line at x = 298…302: the 推臉筆 tests measure where it moves. */
export const LINE = { width: 600, height: 900, x: 300 } as const;
export function linePng(): Buffer {
  const { width, height } = LINE;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.abs(x - LINE.x) <= 2 ? 40 : 130 + Math.round((60 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 4;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** The editor's 推臉筆 debug state (window.__meiyan.liquify); null before the editor published one. */
export async function liquifyState(page: Page): Promise<NonNullable<DebugState['liquify']> | null> {
  return page.evaluate(() => window.__meiyan?.liquify ?? null);
}

/** A one-finger (mouse: the primary button draws) brush drag between two client points. */
export async function brushDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

export interface TouchFrame {
  type: 'touchStart' | 'touchMove' | 'touchEnd';
  /** every finger still down after this event (touchEnd lists the ones that remain) */
  points: { x: number; y: number; id: number }[];
  /** wait after dispatching, ms */
  waitMs?: number;
}

/** Multi-touch through CDP (Chromium turns it into pointer events with pointerType 'touch'). */
export async function touch(page: Page, frames: TouchFrame[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const f of frames) {
    await cdp.send('Input.dispatchTouchEvent', { type: f.type, touchPoints: f.points });
    if (f.waitMs) await page.waitForTimeout(f.waitMs);
  }
  await cdp.detach();
}

/** The file 儲存 shares, decoded: Chromium has no share sheet, so it is the long-press fallback image (editor.spec.ts:98-107). */
export async function savedPixels(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dialog = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const img = dialog.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await dialog.getByRole('button', { name: '關閉' }).click();
  return decodeDataUrl(url);
}
```

In `tests/e2e/body.spec.ts`, delete the local `emptyPng` (its doc comment and function, `:44-58` at `d09e608`), add `emptyPng` to the import from `'./fixtures'`, and delete `import { PNG } from 'pngjs';` (`:10`): `emptyPng` was its only user, and `noUnusedLocals` would fail `typecheck` on it.

- [x] **Step 2: Write the failing e2e test**

Create `tests/e2e/liquify.spec.ts`:

```ts
// 推臉筆 (push-brush spec §8.3) against the production build: one finger pushes, 恢復 restores, ↶ ↷, persistence,
// two-finger gestures, the 美型 entry and 全部清除, photos without a face or with a person, and the export rules.
// Distances are measured on element screenshots (CSS px × dpr 3) of synthetic photos (fixtures.ts linePng, emptyPng).
import type { Page } from '@playwright/test';
import { brushDrag, expect, LINE, linePng, liquifyState, mad, settled, test, type Pixels } from './fixtures';

const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });

async function openPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}

/** Select 推臉筆 in a tab and wait until the hint pill has gone (it floats over the frame). */
async function enterBrush(page: Page, tab: '美型' | '美體'): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
}

/** The column (grab px) with the lowest mean luma over rows y0…y1, searched within columns x0…x1. */
function darkestColumn(p: Pixels, [y0, y1]: [number, number], [x0, x1]: [number, number]): number {
  let best = x0;
  let bestV = Infinity;
  for (let x = Math.max(0, x0); x <= Math.min(p.width - 1, x1); x++) {
    let s = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * p.width + x) * 4;
      s += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    }
    if (s < bestV) {
      bestV = s;
      best = x;
    }
  }
  return best;
}

/** Client point of a photo pixel (identity geometry, zoom 1), and grab px per CSS px. */
async function photoToClient(page: Page, size: { width: number; height: number }) {
  const box = (await page.locator('.editor-stage .frame').boundingBox())!;
  return {
    box,
    at: (px: number, py: number) => ({ x: box.x + (px / size.width) * box.width, y: box.y + (py / size.height) * box.height }),
  };
}

const strokes = async (page: Page) => (await liquifyState(page))?.strokes ?? -1;

test('美體 › 推臉筆: one finger moves the line under the brush, nothing far away; one stroke is one ↶ step', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const frame = page.locator('.editor-stage .frame');
  await enterBrush(page, '美體');
  await expect.poll(() => strokes(page)).toBe(0);
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, LINE);
  const k = before.width / box.width;
  const yPhoto = 450;
  const start = at(LINE.x, yPhoto);
  await brushDrag(page, start, { x: start.x + 24, y: start.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const row = Math.round((yPhoto / LINE.height) * before.height);
  const band: [number, number] = [row - 6, row + 6];
  const x0 = darkestColumn(before, band, [0, before.width - 1]);
  const x1 = darkestColumn(after, band, [x0 - Math.round(4 * k), x0 + Math.round(40 * k)]);
  const ratio = (x1 - x0) / (24 * k);
  console.log(`推臉筆: the line moved ${((x1 - x0) / k).toFixed(1)} CSS px for a 24 px drag (${ratio.toFixed(2)}×)`);
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  expect(ratio).toBeLessThanOrEqual(0.85);
  // more than two brush radii away (bottom-left corner) nothing changed
  const far = { x: 0, y: Math.round(before.height * 0.8), w: Math.round(before.width * 0.3), h: Math.round(before.height * 0.2) - 1 };
  expect(mad(before, after, far)).toBeLessThan(0.5);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  expect(mad(before, await settled(frame))).toBeLessThanOrEqual(0.5);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  expect(mad(after, await settled(frame))).toBeLessThanOrEqual(0.5);
});
```

- [x] **Step 3: Run it to verify it fails**

Run: `npm run build && npx playwright test tests/e2e/liquify.spec.ts`
Expected: FAIL — `option(page, '推臉筆')` resolves (Task 11), but `radiogroup 筆刷模式` never appears (the editor still shows the slider row) and `liquifyState` is `null`.

- [x] **Step 4: The model per photo and its state**

In `src/ui/screens/Editor.tsx`:

1. Imports:

```ts
import { LiquifyModel, makeStrokeId, type LiveStroke } from '../../edit/liquify';
import { clearStrokes, withStrokes } from '../../edit/state';
import type { BrushKind, BrushSize } from '../../types';
import { BrushBar } from '../components/BrushBar';
import { BRUSH_HINT_MS, BrushHint } from '../components/BrushHint';
import { BrushOverlay, ringLook, type RingHandle } from '../components/BrushOverlay';
import { brushAt, clientToO } from '../brushMapping';
import { BrushQueue } from '../brushQueue';
import { rememberSel, showsBrush } from '../panelModel';
import type { BrushHooks } from './zoomPan';
import { debug } from '../debug';
```

(merge with the existing import lines: `Editor.tsx` already imports `debug` from `'../debug'`, `editKey` / `editSetGeometry` / `P0` from `'../../edit/state'`, a type list from `'../../types'` and a long list from `'../panelModel'`; add the new names to those declarations.)

2. Module level, next to `let lastSel` (`:143` at `d09e608`):

```ts
/** 推／恢復 and the size: remembered for the app session, never persisted, never undo steps (push-brush spec §2.2) */
let lastBrushKind: BrushKind = 'push';
let lastBrushSize: BrushSize = 'm';
```

3. `setSel` (`:455-461` at `d09e608`; step 4 made it store `lastSel = rememberable(s)`, and it ends with `setDragging(false)`) becomes:

```ts
  const setSel = (s: PanelSelection) => {
    commitLive(); // a tab or strip-item tap ends the editing context (push-brush spec §2.5)
    // never 'spot' (step 4) and never 'brush': the next photo opens in neither mode; the brush falls back to the item before it
    lastSel = rememberSel(rememberable(s), lastSel);
    setSelState(s);
    // another item's slider: a drag of the old one can no longer commit (its row was replaced)
    setDragging(false);
  };
```

(`rememberable` comes from `'../panelModel'`, already imported by step 4.)

4. Inside the component, after the `edit` state and `editRef` (`:154-156` at `d09e608`):

```ts
  // ── 推臉筆 (push-brush spec §3.5) ──
  /** bumped when a live stroke ends (commit or cancel) and when a chunked rebuild settles: re-arms sync, render and export */
  const [liquifyTick, setLiquifyTick] = useState(0);
  const [liquify] = useState(
    () => new LiquifyModel(source.frame, { onSettled: () => setLiquifyTick((n) => n + 1) }),
  );
  /** a stroke is live (finger down): ↶ ↷ and 全部清除 wait, the encode / autosave waits */
  const [drawing, setDrawing] = useState(false);
  /** 「正在套用推臉筆…」 after 300 ms of a chunked rebuild */
  const [liquifyBusy, setLiquifyBusy] = useState(false);
  const [brushKind, setBrushKindState] = useState<BrushKind>(lastBrushKind);
  const [brushSize, setBrushSizeState] = useState<BrushSize>(lastBrushSize);
  const [hint, setHint] = useState<{ kind: BrushKind; gen: number } | null>(null);
  const ring = useRef<RingHandle | null>(null);
  const frameEl = useRef<HTMLDivElement>(null); // the .frame element (frameOf builds the StillFrame)
  /** the live stroke; `kind` is the one it started with (a 推／恢復 switch mid-stroke applies to the next stroke) */
  const live = useRef<{ stroke: LiveStroke; kind: BrushKind; queue: BrushQueue; ringPx: number; last: { x: number; y: number }; capToast: boolean } | null>(null);

  const publishLiquify = () =>
    debug({
      liquify: {
        strokes: editRef.current.photo.strokes.length,
        version: liquify.field?.version ?? 0,
        work: liquify.work,
        maxDisp: liquify.maxAbs,
        pending: liquify.pending,
      },
    });
```

- [x] **Step 5: Commit and cancel a live stroke**

Below `publishLiquify`:

```ts
  /** finger up, a late second finger, pointercancel, or anything that ends the editing context: one undo step */
  const commitLive = () => {
    const cur = live.current;
    if (!cur) return;
    live.current = null;
    cur.queue.finish(); // stamps still queued are applied first: what was drawn is what is committed
    const taken = new Set(editRef.current.photo.strokes.map((s) => s.id));
    const recs = cur.stroke.commit(() => {
      const id = makeStrokeId(taken);
      taken.add(id);
      return id;
    });
    ring.current?.hide();
    setDrawing(false);
    if (recs.length) {
      const next = withStrokes(editRef.current, recs);
      editRef.current = next; // a flush right after (unmount, hidden) must see it before the next render
      update(next, true);
    }
    sessionRef.current?.setLiquify(liquify.field);
    setLiquifyTick((n) => n + 1); // a no-op gesture made no edit: the export it held back still has to run
    publishLiquify();
  };

  /** a second finger within PINCH_GRACE_MS: the preview reverts, no undo step */
  const cancelLive = () => {
    const cur = live.current;
    if (!cur) return;
    live.current = null;
    cur.queue.clear();
    cur.stroke.cancel();
    ring.current?.hide();
    setDrawing(false);
    sessionRef.current?.setLiquify(liquify.field);
    setLiquifyTick((n) => n + 1);
    publishLiquify();
  };

  // The latest commitLive / cancelLive for callers created once: the brush hooks (memoized on brushOn) and
  // flushHistory, which the visibilitychange and unmount effects (deps []) captured on the first render; a stale
  // commitLive there would call that render's `update`.
  const commitRef = useRef(commitLive);
  commitRef.current = commitLive;
  const cancelRef = useRef(cancelLive);
  cancelRef.current = cancelLive;
```

At the very top of `update(e, commit, user = true)` (`:467-487` at `d09e608`, before its `dropFinished()`), add `commitLive();` (a no-op unless a stroke is live; `commitLive` clears `live.current` before it calls `update`, so there is no recursion). This covers 重置, 全部清除, presets and every other edit made with a second finger while the first one draws.

- [x] **Step 6: The brush hooks and brush mode**

Place this block after `const hold = useHold(…)` (`:1180-1186` at `d09e608`), because `brushOn` reads `hold.held`, and before the `useZoomPan(…)` call (`:1566-1570`), which takes `brushHooks`; right after `hold` is a good place, since `showBoxes` (`:1613`) and `scope` (`:1588`) read `brushOn` too (Step 10). The hooks object is memoized on `brushOn` only, so it calls the latest `commitLive` / `cancelLive` through Step 5's `commitRef` / `cancelRef`:

```ts
  const brushOn = !!session && !fatal && !lost && !hold.held && showsBrush(sel);

  const frameXY = (p: { x: number; y: number }) => {
    const r = frameEl.current?.getBoundingClientRect();
    return r ? { x: p.x - r.left, y: p.y - r.top } : p;
  };
  const layerRect = () => layerRef.current?.getBoundingClientRect() ?? null;
  const kindRef = useRef(brushKind);
  kindRef.current = brushKind;
  const sizeRef = useRef(brushSize);
  sizeRef.current = brushSize;

  const brushHooks = useMemo<BrushHooks | null>(() => {
    if (!brushOn) return null;
    return {
      start(p) {
        if (live.current) return;
        const r = layerRect();
        if (!r) return;
        const g = editRef.current.photo.geometry;
        const b = brushAt(p, sizeRef.current, r, g, source.frame);
        const kind = kindRef.current; // fixed for the stroke: a switch mid-stroke applies to the next one
        const stroke = liquify.begin(kind, b.radius, b.o);
        if (!stroke) {
          // a cap is already reached (a pending rebuild refuses input silently: its status shows)
          if (!liquify.pending) toast('推臉筆筆畫已達上限', 2600);
          return;
        }
        const queue = new BrushQueue({
          add: (o) => stroke.add(o),
          changed: () => {
            sessionRef.current?.setLiquify(liquify.field); // the session coalesces renders to one per frame
            const cur = live.current;
            if (!cur || cur.stroke !== stroke) return; // drained by a commit: the ring is already hidden
            const f = frameXY(cur.last);
            ring.current?.show(f.x, f.y, cur.ringPx, ringLook(kind, stroke.state));
            if (stroke.state === 'capped' && !cur.capToast) {
              cur.capToast = true; // once per gesture (push-brush spec §2.4)
              toast('推臉筆筆畫已達上限', 2600);
            }
          },
          now: () => performance.now(),
          raf: (cb) => requestAnimationFrame(cb),
          cancelRaf: (id) => cancelAnimationFrame(id),
        });
        live.current = { stroke, kind, queue, ringPx: b.ringPx, last: p, capToast: false };
        setDrawing(true);
        const f = frameXY(p);
        ring.current?.show(f.x, f.y, b.ringPx, ringLook(kind, stroke.state));
      },
      move(ps) {
        const cur = live.current;
        const r = layerRect();
        if (!cur || !r) return;
        const g = editRef.current.photo.geometry;
        for (const p of ps) cur.queue.push(clientToO(p, r, g, source.frame));
        cur.last = ps[ps.length - 1];
        const f = frameXY(cur.last);
        ring.current?.show(f.x, f.y, cur.ringPx, ringLook(cur.kind, cur.stroke.state));
      },
      commit: () => commitRef.current(),
      cancel: () => cancelRef.current(),
      stamped() {
        const cur = live.current;
        if (!cur) return false;
        cur.queue.finish();
        return cur.stroke.stamped;
      },
      pinch(on) {
        if (on) ring.current?.hide();
      },
    };
  }, [brushOn]);

  // leaving brush mode (tab, item, 按住對比, crop, a lost context) commits a live stroke first
  useEffect(() => {
    if (!brushOn) commitLive();
  }, [brushOn]);

  // the hint pill: on entering the mode and on each 推／恢復 switch, for BRUSH_HINT_MS
  useEffect(() => {
    if (!brushOn) {
      setHint(null);
      return;
    }
    setHint((h) => ({ kind: brushKind, gen: (h?.gen ?? 0) + 1 }));
    const t = window.setTimeout(() => setHint(null), BRUSH_HINT_MS);
    return () => clearTimeout(t);
  }, [brushOn, brushKind]);

  const setBrushKind = (k: BrushKind) => {
    lastBrushKind = k;
    setBrushKindState(k); // applies to the next stroke (a live one keeps its kind)
  };
  const setBrushSize = (s: BrushSize) => {
    lastBrushSize = s;
    setBrushSizeState(s);
    // a preview ring at the centre of the frame for 700 ms, at the size the brush will have there
    const fr = frameEl.current?.getBoundingClientRect();
    const lr = layerRect();
    if (!fr || !lr || live.current) return;
    const c = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
    const b = brushAt(c, s, lr, editRef.current.photo.geometry, source.frame);
    ring.current?.show(fr.width / 2, fr.height / 2, b.ringPx, ringLook(kindRef.current, 'ok'));
    window.setTimeout(() => {
      if (!live.current) ring.current?.hide();
    }, 700);
  };
  const clearAllStrokes = () => update(clearStrokes(editRef.current), true); // update commits a live stroke first
```

(The 700 ms is PB §2.2's preview duration.)

Pass the hooks to zoomPan (`:1566-1570` at `d09e608`, which passes `onTap: spotMode ? undefined : onPersonTap`, `spotTap: spotMode ? tapSpot : undefined` and `resetWhen: cropMode`). The call keeps every option steps 1, 3 and 4 give it, under their names, and gains `brush`; the person tap is also left out in brush mode (PB §2.5 last row: no person selection by tap):

```ts
  useZoomPan(stageRef, layerRef, !!session && !cropMode, {
    onTap: spotMode || brushOn ? undefined : onPersonTap,
    spotTap: spotMode ? tapSpot : undefined,
    resetWhen: cropMode,
    brush: brushHooks,
  });
```

(`brushOn` and `spotMode` are never both true: they need the 美型／美體 and the 美膚 tab respectively. zoomPan reads `brush` before `spotTap` and `onTap`, Task 8.)

- [x] **Step 7: Sync before render; hold the render while a rebuild is pending**

Directly **above** the render effect (`:1075-1082` at `d09e608`: `if (!session) return; … session.render(frameOf(edit, session)) …`, deps `[session, edit, protects, detect]`), add:

```ts
  // the field follows the committed strokes (undo, redo, 全部清除, 重置, reopen). Declared before the render effect, so a
  // frame never draws new strokes with an old field (push-brush spec §3.5)
  useEffect(() => {
    const r = liquify.sync(edit.photo.strokes);
    if (!r.pending) sessionRef.current?.setLiquify(liquify.field);
    publishLiquify();
    if (!r.pending) {
      setLiquifyBusy(false);
      return;
    }
    const t = window.setTimeout(() => setLiquifyBusy(liquify.pending), 300);
    return () => clearTimeout(t);
  }, [edit.photo.strokes, liquifyTick]);
```

In the render effect, return early while a rebuild is pending (the canvas keeps its previous frame; on a reopen there is none yet and the status shows), and add `liquifyTick` to its dependencies:

```ts
    if (!session || liquify.pending) return;
```

In the session creation (`:602-607` at `d09e608`, `deps.createStillSession(…, { ownsBitmap: false, faces: …, obstacles: …, body: fieldMemo.field })`), seed the strokes so a replacement session (engine swap, re-detect) draws them on its first frame:

```ts
              liquify: liquify.field,
```

In the overlay chain (`:1633-1658` at `d09e608`), after the `exporting` branch and before `else if (lost)`:

```ts
  } else if (liquifyBusy) {
    overlay = <Status spinner title="正在套用推臉筆…" />;
```

- [x] **Step 8: Exports always match the committed strokes**

1. **flushHistory** (`:771-812` at `d09e608`): insert at its very top, before `const s = sessionRef.current;` and its guard `if (!s || fatalRef.current) return;`:

```ts
    // through the ref: the visibilitychange and unmount effects hold the first render's flushHistory
    commitRef.current(); // a live stroke is committed before the editing context ends (hidden, unmount)
    liquify.settle(); // a pending rebuild finishes now: the thumbnail must show the committed strokes
    sessionRef.current?.setLiquify(liquify.field);
```

and both of its `s.exportImageData(frameOf(e, s), field)` calls (the synchronous thumbnail and the corrected one) pass `liq` as the third argument, from one `const liq = liquify.snapshot();` taken next to its `const field = snapshotField();`. `flushHistory` reads the edit from `editRef.current`, which `commitLive` has already set to the state with the new records, so the flushed key, params and thumbnail include the stroke. (Review fix: the `liquify.settle(); sessionRef.current?.setLiquify(liquify.field);` pairs here and in `save` became one `settleLiquify()` declared next to `cancelLive`, which also bumps `liquifyTick` when a rebuild was pending. `LiquifyModel.settle()` does not call `onSettled` (Task 2 pins that), so without the bump a 儲存 or a flush during a reopen's chunked replay left 「正在套用推臉筆…」, `__meiyan.liquify.pending` and the held render (a blank canvas on a reopen) stale. Pinned by 「a reopen whose replay runs in slices…」 in `liquify.spec.ts`, seen failing before the fix.)
2. **encode** (`encode(s, e, field, plan)`, `:1095-1100` at `d09e608`) gains a last parameter `liq: LiquifyField | null` and renders with `s.exportImageData(frameOf(e, s), field, liq)` (add `LiquifyField` to the type import from `'../../types'`).
3. **The encode / autosave effect** (`:1109-1178` at `d09e608`, whose guard is `if (!session || lost || exportBusy) return;`): return early while a stroke is live or a rebuild is pending, and re-arm when either ends:

```ts
    if (!session || lost || exportBusy || drawing || liquify.pending) return;
```

add `drawing` and `liquifyTick` to its dependency list (`[session, edit, lost, fieldTick, protectTick, exportBusy, prefs]`; the `drawing` flip cancels a debounce timer that was armed before the stroke, so a debounced export can never fire mid-stroke and cache half a stroke under the pre-stroke `editKey` — Review Focus 1). Inside the timer, next to `const field = snapshotField();`, take `const liq = liquify.snapshot();` and pass it to every export the effect makes: `encode(s, edit, field, plan, liq)` and both `s.exportImageData(frameOf(edit, s), field, liq)`.
4. **save** (`:1212-1247` at `d09e608`): directly after its guard `if (!session || lost) return;`, insert

```ts
    commitLive();
    liquify.settle();
    sessionRef.current?.setLiquify(liquify.field);
```

next to `const field = snapshotField();` add `const liq = liquify.snapshot();` (the user's strokes at the tap, the `snapshotField` rule, `Editor.tsx:965-975` at `d09e608`), and give `runWorking` and `runTiled` a last parameter `liq: LiquifyField | null`: `runWorking` passes it to `encode(x, e, field, plan, liq)` (its `exportOnLatest(s, (x) => encode(x, e, field, plan), …)`); `runTiled` passes it to its working-size fallback, `runWorking(sessionRef.current ?? s, e, field, working, key, gen, t0, liq)`, and its tiles are wired in Task 13. `save` calls both with `liq`.

- [x] **Step 9: Undo, redo and unmount**

1. ↶ ↷ are disabled while a stroke is live (PB §2.5): the two `IconButton`s (`:1665-1666` at `d09e608`) get `disabled={!undo?.canUndo || drawing}` / `disabled={!undo?.canRedo || drawing}`, and `doUndo` / `doRedo` (`:1355-1388`) start with `if (drawing) return;`.
2. In the unmount cleanup (`:833-860` at `d09e608`), after `flushHistory()` (which commits and snapshots), dispose the model inside `release` so its buffers go with the session: `const release = () => { s?.dispose(); liquify.dispose(); … }`. Also clear a live queue first: `live.current?.queue.clear(); live.current = null;` right after `flushHistory()`.

- [x] **Step 10: Render the brush UI**

In the JSX (`:1660-1797` at `d09e608`):
1. Add `ref={frameEl}` to the `.frame` div (`:1674`, the one whose class also takes ` crop-mode` in 裁切).
2. Inside `.frame`, **outside** `.zoom-layer` (next to the `.corner-label`s, `:1735-1736`):

```tsx
          {brushOn && <BrushOverlay handle={ring} />}
          {brushOn && hint && <BrushHint key={hint.gen} kind={hint.kind} />}
```

3. Hide step 1's face boxes in brush mode (C §2.2: "hidden … in 祛痘, 推臉筆 and 裁切 modes"): `const showBoxes = … && !spotMode;` (`:1613` at `d09e608`) gains `&& !brushOn`.
4. Dim step 1's person strip with 「整張照片」 in brush mode (PB §1.2, C §2.2): the photo-level flag `PersonStrip` gets as `photoScope` (A11: dims the chips, shows the caption), `const scope = multi && photoScoped(sel, lens);` (`:1588`), becomes `const scope = multi && (photoScoped(sel, lens) || brushOn);`.
5. In `.editor-panel` (`:1757-1795` at `d09e608`; step 4 made it `{spotMode ? <SpotControls …/> : <SliderRow …/>}`), put the brush bar first, so it takes the slider row's place also when `faceOff` (the brush is never gated):

```tsx
        {brushOn ? (
          <BrushBar
            kind={brushKind}
            size={brushSize}
            strokes={edit.photo.strokes.length}
            busy={drawing || liquifyBusy}
            onKind={setBrushKind}
            onSize={setBrushSize}
            onClear={clearAllStrokes}
          />
        ) : spotMode ? (
          <SpotControls
            size={spotSize}
            onSize={setSpotSize}
            label={clearLabel(inScope, clearSc !== 'all', confirmUntil > 0)}
            disabled={inScope === 0}
            confirming={confirmUntil > 0}
            onClear={onClear}
          />
        ) : (
          <SliderRow
            binding={session && !faceOff ? (cropMode ? straightenView(g) : binding) : null}
            onChange={(v) => (cropMode ? straightenTo(v, false) : binding && slide(binding, v, false))}
            onCommit={(v) => (cropMode ? straightenTo(v, true) : binding && slide(binding, v, true))}
            emptyText={session && !faceOff ? sliderEmptyText(lens, sel) : null}
            onSel={setSel}
          />
        )}
```

Only the outer `brushOn ?` level is new. The `SpotControls` and `SliderRow` elements shown are the ones at `d09e608` (steps 2–5 gave the slider row its 裁切 binding, `emptyText` and `onSel`); move the ones in the file as they are, with every prop they have, rather than retyping them from here.

6. Nothing to pass for the item's dot: `BeautyPanel` already gets step 1's `lens`, and the item reads `lens.edit.photo.strokes` (Task 11).

- [x] **Step 11: Run the test**

Run: `npm run typecheck && npm run build && npx playwright test tests/e2e/liquify.spec.ts`
Expected: PASS; the log line reports a ratio near 0.7×.

Run: `npx playwright test tests/e2e/editor.spec.ts tests/e2e/body.spec.ts tests/e2e/parity.spec.ts`
Expected: PASS (no stroke anywhere: unchanged behaviour).

- [x] **Step 12: Commit**

```bash
git add src/ui/screens/Editor.tsx tests/e2e/fixtures.ts tests/e2e/body.spec.ts tests/e2e/liquify.spec.ts
git commit -m "feat(liquify): editor draws, commits, undoes, persists and exports strokes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Taps, the CPU back-map and tiled export see the strokes

Three consumers of P2's backward map must apply the liquify field first, exactly as the shader does (PB §4.4 "Tiled export", §4.5 rows Overlays and 祛痘 spots, C §4.6):
- a photo tap that selects a person (step 1's `hitPerson`) goes through `model.backward(o)` before the body field;
- step 4's spot tap goes through `backMapCpu(v, backMapFrameOf(input, photo))`, whose O-space part `oMap` step 4 builds with `reshapeMapMulti(t.faces, aspect, { body, protects })` in `src/engine/backMapFrame.ts` ("if a later step adds an O-space map to P2 — step 6's liquify — it extends this function too"): `BackMapInput` gains `liquify`;
- step 3's tile planner already has the hook (`TileBounds.liquifyMaxDisp`, step-3 plan Task 9): it multiplies the value by the decode's long edge, adds it to the window pad and grows every face's "near" test by it, which is PB §4.4's dilation (the body term is the field's global maximum, so it needs no dilation). This task feeds the hook from the model and renders every tile with the export snapshot.

**Files:**
- Modify: `src/ui/screens/Editor.tsx` (at `d09e608`: `onPersonTap` `1555-1564`; `tapSpot` `1485-1541`; `planFor` `407-416` and `runTiled` `1290-1342`)
- Modify: `src/engine/backMapFrame.ts` (LF; `BackMapInput` `:13-18`, the `reshapeMapMulti` call `:45` at `d09e608`), `src/engine/backMapFrame.test.ts` (step 4)
- Modify: `src/engine/backMapCpu.test.ts`, `src/media/exportPlan.test.ts` (step 3; `describe('planTiles (S §4.4)', …)` `:140-237` at `d09e608`)
- Create: `tests/e2e/pages/strokeCases.ts`
- Modify: `tests/e2e/pages/export.ts` (LF; `cases` `:77-86`, the per-case loop `:87-151` at `d09e608`), `tests/e2e/export.spec.ts` (step 3's tile-equivalence harness, step-3 plan Task 9; the name list `:11-19`)

**Interfaces:**
- Consumes: Task 2 `LiquifyModel` (`backward`, `maxDisp` in long-edge units, `snapshot`), `straightStroke`, `liquifyGrid`; Task 4 `liquifyAt`, `reshapeMapCpu(face, u, aspect, body?, protect?, liquify?)`, `reshapeMapMulti(faces, aspect, { body, protects, liquify })`; Task 6 `tileInput(frame, body?, liquify?)`, `bounds(frame, body?, liquifyMaxDisp?)`; Task 12's `liq` snapshot in `save` / `runTiled`. Step 3 (plan Task 9): `backMapCpu(v: Vec2, frame: BackMapFrame): [number, number]` with `BackMapFrame { geometry; oSize; oMap: UvMap }`, `backMapperCpu(frame)`, `planTiles(grid: TileGrid, bounds: TileBounds, T)`, `TileBounds { body; faces; liquifyMaxDisp? }`, `displacementBound`, `reshapeGeometry`, the imports of its coverage test in `exportPlan.test.ts`; the harness `window.runExportTiles(): Promise<TileCheck[]>` whose `cases` entries are `{ name; w; h; geometry(size) }` and whose per-case loop builds `photo`, `base: Omit<RenderInput, 'source' | 'width' | 'height'>` and `bounds = { body, faces }`; `tests/e2e/export.spec.ts`, which asserts the list of case names. Step 1: `hitPerson(uv, ctx: HitCtx)` (it adds the body field at `uv` first) and the editor's person-tap handler (`onPersonTap`). Step 4 (plan Task 17): `interface BackMapInput { faces: readonly RenderFace[]; obstacles?; body?: BodyField | null; geometry: Geometry }`, `backMapFrameOf(input, oSize): BackMapFrame` (`src/engine/backMapFrame.ts`) and its test file's `FACE`, `O_SIZE`; the editor's `tapSpot`, which calls `backMapCpu(v, backMapFrameOf({ faces, obstacles, body: s.body, geometry }, photo))` (SK §3.4).
- Produces: `BackMapInput.liquify?: LiquifyField | null`; `buildStrokeCase(frame: LiquifyFrame): { strokes: Stroke[]; field: LiquifyField; model: LiquifyModel }`; the harness case `'strokes + 90° turn'`.

- [ ] **Step 1: Write the unit tests**

Append to `src/engine/backMapCpu.test.ts` (it already defines `oSize`, `face`, `values` and imports `IDENTITY_GEOMETRY`, `reshapeUniforms`, `reshapeMapCpu`, `backMapCpu`; `liquifyAt` joins its existing `import { reshapeMapCpu, withView } from './passes/reshapeCpu';`):

```ts
import { liquifyAt } from './passes/reshapeCpu';

describe('backMapCpu with a 推臉筆 field (push-brush spec §4.4, §4.5)', () => {
  const liquify = { width: 4, height: 4, data: new Float32Array(32).map((_, i) => (i % 2 === 0 ? 0.02 : -0.01)), version: 1 };

  it('an oMap built with the liquify field applies it first (f16 texels, like the GPU)', () => {
    const aspect = oSize.width / oSize.height;
    const oMap = reshapeMapCpu(null, null, aspect, null, null, liquify);
    const v: [number, number] = [0.4, 0.6];
    const got = backMapCpu(v, { geometry: IDENTITY_GEOMETRY, oSize, oMap });
    const d = liquifyAt(liquify, v[0], v[1]);
    expect(got[0]).toBeCloseTo(v[0] + d[0], 12);
    expect(got[1]).toBeCloseTo(v[1] + d[1], 12);
  });

  it('then the face chain runs at the liquified point', () => {
    const u = reshapeUniforms(values, 1);
    const aspect = oSize.width / oSize.height;
    const both = reshapeMapCpu(face, u, aspect, null, null, liquify);
    const faceOnly = reshapeMapCpu(face, u, aspect);
    const v: [number, number] = [0.45, 0.5];
    const d = liquifyAt(liquify, v[0], v[1]);
    const a = backMapCpu(v, { geometry: IDENTITY_GEOMETRY, oSize, oMap: both });
    const b = faceOnly(v[0] + d[0], v[1] + d[1]);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
  });
});
```

Append to `src/engine/backMapFrame.test.ts` (step 4's file: it defines `FACE` and `O_SIZE` and imports `backMapCpu`, `backMapFrameOf`, `IDENTITY_GEOMETRY`, `neutralPerson`; `liquifyAt` joins its existing `import { reshapeMapCpu } from './passes/reshapeCpu';`):

```ts
import { liquifyAt } from './passes/reshapeCpu';

describe('backMapFrameOf with the 推臉筆 field (push-brush spec §4.5: a 祛痘 tap lands on what the finger touched)', () => {
  const liquify = { width: 4, height: 4, data: new Float32Array(32).map((_, i) => (i % 2 === 0 ? 0.02 : -0.01)), version: 1 };

  it('applies the strokes first, then the face chain at the liquified point', () => {
    const person = neutralPerson();
    const values = { ...person.values, 'shape.faceSlim': 0.6 };
    const faces = [{ face: FACE, weight: 1, person: { ...person, values }, protect: null }];
    const withStrokes = backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY, liquify }, O_SIZE);
    const without = backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY }, O_SIZE);
    for (const v of [[0.4, 0.6], [0.45, 0.5], [0.7, 0.3]] as [number, number][]) {
      const d = liquifyAt(liquify, v[0], v[1]);
      const a = backMapCpu(v, withStrokes);
      const b = backMapCpu([v[0] + d[0], v[1] + d[1]], without);
      expect(a[0]).toBeCloseTo(b[0], 12);
      expect(a[1]).toBeCloseTo(b[1], 12);
    }
    // no field (or null) is today's back-map exactly
    expect(backMapCpu([0.4, 0.6], backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY, liquify: null }, O_SIZE))).toEqual(backMapCpu([0.4, 0.6], without));
  });
});
```

In `src/media/exportPlan.test.ts`, inside `describe('planTiles (S §4.4)', …)` after step 3's coverage test, add one with strokes and a 90° turn (the same structure: every buffer pixel's back-mapped sample lies inside its tile's window), and add `import { LiquifyModel, liquifyGrid } from '../edit/liquify';` and `import { straightStroke } from '../edit/strokeFixtures';` to the file's imports (`readFileSync`, `PARAM_DEFS`, `adapt`, `reshapeUniforms`, `reshapeGeometry`, `displacementBound`, `reshapeMapCpu`, `backMapperCpu`, `rotateLeft`, `viewSize`, `IDENTITY_GEOMETRY`, `planTiles`, `TileBounds`, `BodyField`, `ParamId` are already imported by step 3's tests):

```ts
  it('coverage with 推臉筆 strokes, a body field, a face and a 90° 旋轉 (liquifyMaxDisp feeds the window)', () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
      width: number;
      height: number;
      points: number[];
    };
    const decode = { width: 400, height: 600 };
    const aspect = decode.width / decode.height;
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const values = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
    for (const id of ['shape.faceSlim', 'shape.eyeEnlarge'] as ParamId[]) values[id] = 1;
    const u = reshapeUniforms(values, 1);
    const bd = new Float32Array(16 * 24 * 2).map((_, i) => (i % 2 === 0 ? 0.015 * Math.sin(i * 0.37) : 0.01 * Math.cos(i * 0.21)));
    const body: BodyField = { width: 16, height: 24, data: bd, version: 1 };
    // strokes on this frame: two 大 pushes of 2 radii, through the app's own model
    const g6 = liquifyGrid(decode);
    const R = (44 / 28) * (28.7 / g6.F);
    const model = new LiquifyModel(decode, { now: () => 0, syncWork: Infinity });
    model.sync([
      ...straightStroke(decode, 'push', R, { x: 0.45, y: 0.5 }, { x: 0.45 + (2 * R) / g6.ax, y: 0.5 }, 'c1'),
      ...straightStroke(decode, 'push', R, { x: 0.6, y: 0.35 }, { x: 0.6, y: 0.35 + (2 * R) / g6.ay }, 'c2'),
    ]);
    const oMap = reshapeMapCpu(face, u, aspect, body, null, model.snapshot());
    const bounds: TileBounds = {
      body,
      faces: [{ box: reshapeGeometry(face, aspect, u).box, bound: displacementBound(face, aspect, u) }],
      liquifyMaxDisp: (r) => model.maxDisp(r),
    };
    const g = rotateLeft(IDENTITY_GEOMETRY);
    const V = viewSize(g, decode);
    const grid = { V, decode, geometry: g, oAspect: aspect, fullShortEdge: 400 };
    const tiles = planTiles(grid, bounds, 64);
    const back = backMapperCpu({ geometry: g, oSize: decode, oMap });
    let checked = 0;
    const outside: number[][] = [];
    for (const t of tiles)
      for (let y = t.buf.y; y < t.buf.y + t.buf.h; y += 3)
        for (let x = t.buf.x; x < t.buf.x + t.buf.w; x += 3) {
          const o = back([(x + 0.5) / V.width, (y + 0.5) / V.height]);
          const px = o[0] * decode.width;
          const py = o[1] * decode.height;
          const inX = (t.win.x === 0 || px >= t.win.x) && (t.win.x + t.win.w === decode.width || px <= t.win.x + t.win.w);
          const inY = (t.win.y === 0 || py >= t.win.y) && (t.win.y + t.win.h === decode.height || py <= t.win.y + t.win.h);
          if (!inX || !inY) outside.push([x, y, px, py]);
          checked++;
        }
    expect(checked).toBeGreaterThan(5000);
    expect(outside.slice(0, 5)).toEqual([]);
    // the hook is what grew the windows: without it some window is smaller
    const blind = planTiles(grid, { ...bounds, liquifyMaxDisp: undefined }, 64);
    expect(blind.some((t, i) => t.win.w < tiles[i].win.w || t.win.h < tiles[i].win.h)).toBe(true);
  });
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/engine/backMapCpu.test.ts src/engine/backMapFrame.test.ts src/media/exportPlan.test.ts`
Expected: `backMapFrame.test.ts` FAILS (TS: `liquify` does not exist in type `BackMapInput`; at run time the strokes are ignored); the others PASS (Tasks 2 and 4 provide the CPU composition and the long-edge `maxDisp`; step 3 provides the hook). These tests pin the composition and that the hook is what keeps every sample inside its window; if the coverage test reports samples outside a window, `maxDisp`'s unit no longer matches the planner's `× max(decode.width, decode.height)` — fix `maxDisp`, not the test.

- [ ] **Step 2b: Extend the tap back-map**

In `src/engine/backMapFrame.ts` (step 4): `BackMapInput` gains

```ts
  /** 推臉筆 field, the outermost O-space map of P2 (push-brush spec §4.1); absent / null = no strokes */
  liquify?: LiquifyField | null;
```

(import `LiquifyField` with the other types), and the `reshapeMapMulti` call in `backMapFrameOf` passes it: `reshapeMapMulti(t.faces, aspect, { body: input.body ?? null, protects: t.protects, liquify: input.liquify ?? null })`.

Run: `npx vitest run src/engine/backMapFrame.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire the editor**

In `src/ui/screens/Editor.tsx`:
1. **Person taps** (`onPersonTap`, `:1555-1564` at `d09e608`, PS §2.3): it maps the tap V → O inline and hit-tests at once, `const hit = hitPerson(apply(vToO(g, photo), uv), hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect));`. Between the two, map the point through the strokes, so the hit test sees P2's map without the face chains:

```ts
        const o = apply(vToO(g, photo), uv);
        const lq = liquify.backward({ x: o[0], y: o[1] }); // 推臉筆 first (push-brush spec §4.5); hitPerson then adds the body field
        const hit = hitPerson([lq.x, lq.y], hitCtxOf(d, sel.tab === 'body', fieldMemo.field, rect));
```

2. **Spot taps** (step 4's `tapSpot`, `:1485-1541` at `d09e608`, SK §3.4): its `backMapFrameOf({ faces: f.faces, obstacles: f.obstacles, body: s.body, geometry: shown }, photo)` argument (`:1501`) gains `liquify: liquify.field`, so a spot tapped after strokes lands on what the finger touched (PB §4.5 row 祛痘 spots).
3. **Tiled export** (`planFor` `:407-416` and `runTiled` `:1290-1342` at `d09e608`): in `planFor`, the bounds argument `s.bounds(frameOf(e, s), field)` becomes

```ts
      s.bounds(frameOf(e, s), field, liquify.field ? (r) => liquify.maxDisp(r) : undefined),
```

and in `runTiled` (with Task 12's `liq` parameter) the runner gets `s.tileInput(frame, field, liq)`.

- [ ] **Step 4: The tiled = untiled e2e case**

Create `tests/e2e/pages/strokeCases.ts`:

```ts
// Deterministic 推臉筆 strokes and their field for the export harness (push-brush spec §8.3 test 9, the release gate):
// built with the app's own LiquifyModel, so the harness renders exactly what the editor would.
import { LiquifyModel, liquifyGrid } from '../../../src/edit/liquify';
import { straightStroke } from '../../../src/edit/strokeFixtures';
import type { LiquifyField, LiquifyFrame, Stroke } from '../../../src/types';

/** two pushes and a half restore around the middle of the frame (O UV), at 中 and 大 */
export function buildStrokeCase(frame: LiquifyFrame): { strokes: Stroke[]; field: LiquifyField; model: LiquifyModel } {
  const g = liquifyGrid(frame);
  const M = 28.7 / g.F;
  const L = M * (44 / 28);
  const strokes = [
    ...straightStroke(frame, 'push', L, { x: 0.35, y: 0.45 }, { x: 0.35 + (2 * L) / g.ax, y: 0.45 }, 'tile-a'),
    ...straightStroke(frame, 'push', M, { x: 0.6, y: 0.3 }, { x: 0.6 - M / g.ax, y: 0.3 + (2 * M) / g.ay }, 'tile-b'),
    ...straightStroke(frame, 'restore', M, { x: 0.35, y: 0.42 }, { x: 0.35 + L / g.ax, y: 0.42 }, 'tile-c'),
  ];
  const model = new LiquifyModel(frame, { now: () => 0, syncWork: Infinity });
  model.sync(strokes);
  return { strokes, field: model.snapshot()!, model };
}
```

In `tests/e2e/pages/export.ts` (step 3's harness):
1. Imports: `import { buildStrokeCase } from './strokeCases';`, add `rotateLeft` to the import from `'../../../src/geometry/view'` and `Rect` to the type import.
2. The case type gains `strokes?: boolean`; append the case

```ts
    { name: 'strokes + 90° turn', w: 800, h: 600, geometry: () => rotateLeft(IDENTITY_GEOMETRY), strokes: true },
```

3. In the per-case loop, right after `const decode = …`:

```ts
    const sc = c.strokes ? buildStrokeCase(decode) : null;
```

then put `strokes: sc ? sc.strokes : []` into `photo`, `liquify: sc ? sc.field : null` into `base`, and build the bounds as

```ts
    const bounds = {
      body: base.body ?? null,
      faces: faceBoundsFor(faces, oAspect),
      ...(sc ? { liquifyMaxDisp: (r: Rect) => sc.model.maxDisp(r) } : {}),
    };
```

In `tests/e2e/export.spec.ts`, append `'strokes + 90° turn'` at the end of the `expect(res.map((r) => r.name)).toEqual([...])` list (after any names steps 4 and 5 appended). The loop's existing assertions (`glError` 0, more than one tile, max channel difference ≤ 1) then cover the new case.

- [ ] **Step 5: Run the e2e case**

Run: `npx playwright test tests/e2e/export.spec.ts`
Expected: PASS; the log has a line `strokes + 90° turn: 600×800, N tiles, max channel diff 0/255` (at most 1/255).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/ui/screens/Editor.tsx src/engine/backMapFrame.ts src/engine/backMapFrame.test.ts src/engine/backMapCpu.test.ts src/media/exportPlan.test.ts tests/e2e/pages/strokeCases.ts tests/e2e/pages/export.ts tests/e2e/export.spec.ts
git commit -m "feat(liquify): taps, spot back-map and tiled export apply the strokes first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: End-to-end: 恢復, persistence, two fingers, 美型 and 全部清除, no face, a person, the export rules

The rest of PB §8.3 (tests 2 and 4–8), the four Review Focus cases that only a real pointer stream exercises (1–4), the 美體 entry on a person photo while body detection runs (PB §2.1: "never gated by `bodyGate`"), and C §2.2's brush mode on a group photo (the strip reads 「整張照片」, a tap selects nobody). All tests append to `tests/e2e/liquify.spec.ts` from Task 12 and reuse its helpers (`openPhoto`, `enterBrush`, `darkestColumn`, `photoToClient`, `strokes`); `darkestRow`, whose first user is the no-face test here, is added with them (in Task 12 it would be an unused local, which `noUnusedLocals` rejects).

**Files:**
- Modify: `tests/e2e/liquify.spec.ts`

**Interfaces:**
- Consumes: Task 12's helpers in `tests/e2e/fixtures.ts` (`brushDrag`, `touch`, `liquifyState`, `savedPixels`, `emptyPng`, `linePng`, `LINE`) and in `liquify.spec.ts`; `debugState`, `SAMPLE_FACE` (`fixtures.ts`); step 1's debug fields `__meiyan.detectCalls`, `persons`, `selected` (PS §3.2) and fixture `tests/fixtures/group_faces.png` (PS §8.3); the v0.3 no-face note 「未偵測到臉部，臉型與美妝不會套用」 (`Editor.tsx:1619` at `d09e608`, kept by step 1, PS §2.6).
- Produces: nothing new (tests only).

- [ ] **Step 1: Write the tests**

Extend the import from `'./fixtures'` in `tests/e2e/liquify.spec.ts` with `debugState, emptyPng, SAMPLE_FACE, savedPixels, touch` and add `import { resolve } from 'node:path';`, then append:

```ts
const GROUP = resolve(import.meta.dirname, '../fixtures/group_faces.png');
const FULLBODY_LINES = resolve(import.meta.dirname, '../fixtures/fullbody_lines.jpg');

/** The row (grab px) with the lowest mean luma over columns x0…x1, searched within rows y0…y1. */
function darkestRow(p: Pixels, [x0, x1]: [number, number], [y0, y1]: [number, number]): number {
  let best = y0;
  let bestV = Infinity;
  for (let y = Math.max(0, y0); y <= Math.min(p.height - 1, y1); y++) {
    let s = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * p.width + x) * 4;
      s += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    }
    if (s < bestV) {
      bestV = s;
      best = y;
    }
  }
  return best;
}

/** push the line right by 24 CSS px at photo row 450 with the current brush; returns the measurement inputs */
async function pushLine(page: Page) {
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, LINE);
  const k = before.width / box.width;
  const start = at(LINE.x, 450);
  await brushDrag(page, start, { x: start.x + 24, y: start.y });
  await expect.poll(() => strokes(page)).toBeGreaterThan(0);
  const after = await settled(frame);
  const row = Math.round((450 / LINE.height) * before.height);
  const band: [number, number] = [row - 6, row + 6];
  const x0 = darkestColumn(before, band, [0, before.width - 1]);
  const x1 = darkestColumn(after, band, [x0 - Math.round(4 * k), x0 + Math.round(40 * k)]);
  return { frame, before, after, start, k, row, band, x0, x1 };
}

/** the zoom layer's scale (1 = fitted) */
const zoomScale = (page: Page) =>
  page.locator('.zoom-layer').evaluate((el) => {
    const t = getComputedStyle(el).transform;
    return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
  });

test('恢復 (大, two passes along the push) brings the photo back; the hint follows the mode', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { frame, before, start, k, row, x0 } = await pushLine(page);
  const pushed = (await liquifyState(page))!.maxDisp;
  expect(pushed).toBeGreaterThan(0);
  await page.getByRole('radio', { name: '恢復' }).click();
  await expect(page.getByText('單指塗抹恢復，雙指縮放')).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  await page.getByRole('radio', { name: '大' }).click();
  for (let pass = 0; pass < 2; pass++) await brushDrag(page, { x: start.x - 22, y: start.y }, { x: start.x + 24 + 22, y: start.y }, 16);
  await expect.poll(() => strokes(page)).toBe(3);
  const restored = await settled(frame);
  const R = Math.round(2 * 44 * k); // two 大 radii around the push
  const box = { x: Math.max(0, x0 - R), y: Math.max(0, row - R), w: 2 * R, h: 2 * R };
  expect(mad(before, restored, box)).toBeLessThanOrEqual(1);
  expect((await liquifyState(page))!.maxDisp).toBeLessThanOrEqual(0.05 * pushed);
});

test('strokes persist: reopening from 最近編輯 shows them with no detector call and no pending rebuild', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { band, x1, k } = await pushLine(page);
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => strokes(page)).toBe(1);
  expect((await liquifyState(page))!.pending).toBe(false);
  expect((await debugState(page)).detectCalls).toBe(calls);
  const reopened = await settled(page.locator('.editor-stage .frame'));
  // the stored original is a JPEG re-encode, so compare where the line is, not every pixel
  const xr = darkestColumn(reopened, band, [x1 - Math.round(20 * k), x1 + Math.round(20 * k)]);
  expect(Math.abs(xr - x1)).toBeLessThanOrEqual(2);
});

test('two fingers pinch and never draw (second finger 30 ms after the first)', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const c = at(300, 450);
  const frames = [
    { type: 'touchStart' as const, points: [{ x: c.x - 40, y: c.y, id: 1 }], waitMs: 30 },
    { type: 'touchStart' as const, points: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      type: 'touchMove' as const,
      points: [{ x: c.x - 40 - 7 * i, y: c.y, id: 1 }, { x: c.x + 40 + 7 * i, y: c.y, id: 2 }],
      waitMs: 16,
    })),
    { type: 'touchEnd' as const, points: [] },
  ];
  await touch(page, frames);
  await expect.poll(() => zoomScale(page)).toBeGreaterThan(1);
  expect(await strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
});

test('a second finger after the grace commits the stroke drawn so far (one ↶ step), then pinches', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const c = at(300, 450);
  const draw = [1, 2, 3, 4, 5, 6].map((i) => ({ type: 'touchMove' as const, points: [{ x: c.x + 4 * i, y: c.y, id: 1 }], waitMs: 50 }));
  const last = { x: c.x + 24, y: c.y, id: 1 };
  await touch(page, [
    { type: 'touchStart', points: [{ x: c.x, y: c.y, id: 1 }], waitMs: 16 },
    ...draw, // 300 ms of drawing
    { type: 'touchStart', points: [last, { x: c.x + 120, y: c.y + 60, id: 2 }] },
    ...[1, 2, 3, 4].map((i) => ({ type: 'touchMove' as const, points: [{ ...last, x: last.x - 8 * i }, { x: c.x + 120 + 8 * i, y: c.y + 60, id: 2 }], waitMs: 16 })),
    { type: 'touchEnd', points: [] },
  ]);
  await expect.poll(() => strokes(page)).toBe(1);
  expect(await zoomScale(page)).not.toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(undo).toBeDisabled();
});

test('美型 › 推臉筆 on a face; 全部清除 needs 確定清除？ and is one ↶ step', async ({ page }) => {
  await openPhoto(page, SAMPLE_FACE);
  await enterBrush(page, '美型');
  const { at } = await photoToClient(page, { width: 1000, height: 1500 });
  const s = at(330, 820); // the left cheek
  await brushDrag(page, s, { x: s.x + 24, y: s.y });
  await expect.poll(() => strokes(page)).toBe(1);
  await expect(option(page, '推臉筆')).toHaveClass(/has-value/);
  await page.getByRole('button', { name: '全部清除' }).click();
  await expect(page.getByRole('button', { name: '確定清除？' })).toBeVisible();
  expect(await strokes(page)).toBe(1); // the first tap only arms it
  await page.getByRole('button', { name: '確定清除？' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '全部清除' })).toBeDisabled();
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
});

test('no face: 推臉筆 stays enabled under the face note and pushes the floor line down', async ({ page }) => {
  await openPhoto(page, { name: 'empty.png', mimeType: 'image/png', buffer: emptyPng() });
  await page.getByRole('tab', { name: '美型' }).click();
  await expect(page.getByText('未偵測到臉部，臉型與美妝不會套用')).toBeVisible();
  await expect(option(page, '推臉筆')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const size = { width: 600, height: 900 };
  const { box, at } = await photoToClient(page, size);
  const k = before.width / box.width;
  const s = at(300, 650);
  await brushDrag(page, s, { x: s.x, y: s.y + 24 });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const col = Math.round((300 / size.width) * before.width);
  const cols: [number, number] = [col - 6, col + 6];
  const y0 = darkestRow(before, cols, [0, before.height - 1]);
  const y1 = darkestRow(after, cols, [y0 - Math.round(4 * k), y0 + Math.round(40 * k)]);
  expect((y1 - y0) / (24 * k)).toBeGreaterThanOrEqual(0.45);
});

test('美體 › 推臉筆 on a person works while 美體 detection is still running', async ({ page }) => {
  await openPhoto(page, FULLBODY_LINES);
  await page.getByRole('tab', { name: '美體' }).click();
  // not gated by bodyGate: enabled whatever the detection is doing
  await expect(option(page, '推臉筆')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, { width: 638, height: 1000 });
  const k = before.width / box.width;
  const s = at(230, 130); // the left door line on the wall
  await brushDrag(page, s, { x: s.x + 24, y: s.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const near = { x: Math.round((s.x - box.x - 30) * k), y: Math.round((s.y - box.y - 30) * k), w: Math.round(84 * k), h: Math.round(60 * k) };
  expect(mad(before, after, near)).toBeGreaterThan(1);
  const far = { x: 0, y: Math.round(before.height * 0.85), w: Math.round(before.width * 0.25), h: Math.round(before.height * 0.15) - 1 };
  expect(mad(before, after, far)).toBeLessThan(0.5);
});

test('half a stroke is never exported: a slow stroke past the 400 ms debounce, then ↶, shares the pre-stroke file', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const a = await savedPixels(page);
  await page.getByRole('tab', { name: '美體' }).click();
  const { at } = await photoToClient(page, LINE);
  const s = at(LINE.x, 450);
  // an edit that arms the debounced encode / autosave (背景保護 has no visible effect on a photo without a person) …
  await option(page, '背景保護').click();
  // … and the stroke starts before the 400 ms debounce has fired: without the export gating it would fire mid-stroke
  await option(page, '推臉筆').click();
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(s.x + 2 * i, s.y);
  await page.waitForTimeout(700); // finger held still past the encode debounce (ENCODE_DEBOUNCE_MS 400)
  for (let i = 7; i <= 12; i++) await page.mouse.move(s.x + 2 * i, s.y);
  await page.mouse.up();
  await expect.poll(() => strokes(page)).toBe(1);
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  const b = await savedPixels(page);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  expect(mad(a, b)).toBeLessThanOrEqual(0.5);
});

test('a press on 按住對比 in brush mode never draws, and nothing is half-committed', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const holdBtn = page.getByRole('button', { name: '按住對比' });
  const hb = (await holdBtn.boundingBox())!;
  const { at } = await photoToClient(page, LINE);
  const target = at(LINE.x, 450);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + hb.width / 2 + ((target.x - hb.x - hb.width / 2) * i) / 10, hb.y + hb.height / 2 + ((target.y - hb.y - hb.height / 2) * i) / 10);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
  await expect(page.locator('.brush-ring.hidden')).toHaveCount(1); // the ring is not left on screen
});

test('group photo: brush mode dims the person strip with 整張照片, and a tap selects nobody', async ({ page }) => {
  await openPhoto(page, GROUP);
  await expect.poll(async () => (await debugState(page)).persons).toBeGreaterThanOrEqual(2);
  await enterBrush(page, '美型');
  await expect(page.getByText('整張照片', { exact: true }).first()).toBeVisible();
  const selected = (await debugState(page)).selected;
  const box = (await page.locator('.editor-stage .frame').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4); // on face B: a tap is not a stroke
  await page.waitForTimeout(300);
  expect((await debugState(page)).selected).toBe(selected);
  expect(await strokes(page)).toBe(0);
});

/** what iOS does when the user swipes home or a call comes in: the page turns hidden (Editor's flushHistory listener) */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('backgrounding mid-stroke commits and saves the stroke; the rest of the drag draws nothing', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const s = at(LINE.x, 450);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(s.x + 3 * i, s.y);
  await setVisibility(page, 'hidden');
  // committed by the hidden-flush while the finger is still down: one record, one undo step
  await expect.poll(() => strokes(page)).toBe(1);
  for (let i = 9; i <= 16; i++) await page.mouse.move(s.x + 3 * i, s.y); // the finger keeps moving
  await page.mouse.up();
  await setVisibility(page, 'visible');
  await page.waitForTimeout(300);
  expect(await strokes(page)).toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(undo).toBeDisabled(); // the drag after the flush made no second step
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  // the flush wrote the entry: a reopen shows the stroke
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => strokes(page)).toBe(1);
});

test('↶ and 全部清除 wait while a finger draws; finger-up makes exactly one undo step', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const a = at(LINE.x, 300);
  await brushDrag(page, a, { x: a.x + 24, y: a.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  const clear = page.getByRole('button', { name: '全部清除' });
  await expect(undo).toBeEnabled();
  await expect(clear).toBeEnabled();
  const b = at(LINE.x, 600);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 3 * i, b.y);
  // a stroke is live: nothing may undo or clear a half-built stroke
  await expect(undo).toBeDisabled();
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled();
  await expect(clear).toBeDisabled();
  await page.mouse.up();
  await expect.poll(() => strokes(page)).toBe(2);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(1); // only the second stroke went
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
});
```

(`option` is defined at the top of the file by Task 12; `settled` and `mad` are already imported there.)

- [ ] **Step 2: Run them**

Run: `npm run build && npx playwright test tests/e2e/liquify.spec.ts`
Expected: PASS, 13 tests. If one fails, it is a defect in Tasks 8–13, not in the test: fix the code (the expected values come from PB §8.3 and the measured behaviour in Task 2), keeping the assertions.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/liquify.spec.ts
git commit -m "test(liquify): restore, persistence, gestures, clear, no-face, person, export rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Bench rows for the brush

PB §6.2: `liquify.stamp` (ns per texel-stamp for push, bisecting push and restore at 小／中／大, plus S30's share of bisected work), `liquify.upload` (full 512² RG16F upload), `liquify.frame` (a 2048 frame with strokes), `liquify.replay` (S30 and SCAP). Desktop now; the iPhone only through `/bench.html` after the user's go-ahead for a preview deploy (C §6.2), which this plan does not do. Rows carry their PB §6.1 budget so 複製結果 shows `ok` / `OVER`.

**Files:**
- Create: `src/bench/liquifyBench.ts`, `src/bench/liquifyBench.test.ts`
- Modify: `src/bench/main.ts` (CRLF; at `d09e608`: imports `9-58`, `let busy` `:124`, `const bodyRows` / `faceDetailRows` `:126-129`, `gateBodyBtn` `:202`, `gate` `:206-219`, `bodyBtn` `:245`, `panel` `:282-292` (the button row `:287`), `nextPaint` `:648`, `runBodyBench` `650-683`, `copyResults` `911-930`; steps 1–5 added their rows)

**Interfaces:**
- Consumes: Task 2 `LiquifyModel`, `liquifyGrid`, `strokeWork`, `straightStroke`, `strokesS30`, `strokesCap`; Task 1 `GUARD_STEPS`; step 1's `buildFrame(edit, faces, obstacles, protects, primary, warpScales?)` (`src/edit/frame.ts:17-25` at `d09e608`, PS §3.1; `primary` is required) and `defaultPhoto` / `naturalPerson` / `neutralPerson`; `Engine.renderToImageData`; main.ts's `el`, `button`, `nextPaint`, `busy`, `showError`, `errText`, `engine`, `gate`, `panel`.
- Produces: `interface LiquifyBenchRow { name: string; value: number; unit: 'ns/texel-stamp' | 'ms' | '%'; budget: number | null }`; `benchStamps(frame, now?)`, `benchReplay(frame, now?, withCap = true)`, `uploadMs(gl, field, now?)`, `formatLiquifyReport(rows)`; the bench page's 「推臉筆」 button.

- [ ] **Step 1: Write the failing test**

Create `src/bench/liquifyBench.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { benchReplay, benchStamps, formatLiquifyReport } from './liquifyBench';

/** a clock that advances 1 ms per read: the rows are deterministic and positive */
const tick = () => {
  let t = 0;
  return () => (t += 1);
};

describe('liquify bench rows (push-brush spec §6.2)', () => {
  const frame = { width: 300, height: 400 };

  it('stamp rows: push, bisecting push and restore at 小／中／大, in ns per texel-stamp with the 80 ns budget', () => {
    const rows = benchStamps(frame, tick());
    expect(rows.map((r) => r.name)).toEqual([
      'liquify.stamp push 小',
      'liquify.stamp push bisecting 小',
      'liquify.stamp restore 小',
      'liquify.stamp push 中',
      'liquify.stamp push bisecting 中',
      'liquify.stamp restore 中',
      'liquify.stamp push 大',
      'liquify.stamp push bisecting 大',
      'liquify.stamp restore 大',
    ]);
    for (const r of rows) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.unit).toBe('ns/texel-stamp');
      expect(r.budget).toBe(80);
    }
  });

  it('replay rows (S30 only here: SCAP is the slow one) and the report', () => {
    const rows = benchReplay(frame, tick(), false);
    expect(rows.map((r) => r.name)).toEqual(['liquify.replay S30', 'liquify.bisected S30']);
    expect(rows[0].budget).toBe(100);
    const text = formatLiquifyReport(rows);
    expect(text).toContain('推臉筆');
    expect(text.split('\n').filter((l) => l.startsWith('liquify.'))).toHaveLength(2);
    expect(formatLiquifyReport([])).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/bench/liquifyBench.test.ts`
Expected: FAIL — `Failed to load url ./liquifyBench`.

- [ ] **Step 3: Write the rows**

Create `src/bench/liquifyBench.ts`:

```ts
// 推臉筆 bench rows (push-brush spec §6.2): ns per texel-stamp for push (straight, no bisection), push into a stretched
// area (bisecting) and restore, at 小／中／大; the replay of S30 and SCAP; the share of bisected work on S30; and the
// RG16F upload of a full field. Pure apart from `uploadMs`, which takes a WebGL2 context. Rules if the iPhone misses a
// budget are in the spec's table (rescale LIQUIFY_WORK_CAP / LIQUIFY_SYNC_WORK, dirty-tile uploads, a smaller ring).
import { GUARD_STEPS } from '../config/limits';
import { LiquifyModel, liquifyGrid, strokeWork } from '../edit/liquify';
import { straightStroke, strokesCap, strokesS30 } from '../edit/strokeFixtures';
import type { BrushSize, LiquifyField, LiquifyFrame, Stroke } from '../types';

export interface LiquifyBenchRow {
  /** e.g. liquify.stamp push 中 */
  name: string;
  value: number;
  unit: 'ns/texel-stamp' | 'ms' | '%';
  /** the PB §6.1 budget for the row, in the row's unit (null = informational) */
  budget: number | null;
}

const SIZE_PX: Record<BrushSize, number> = { s: 16, m: 28, l: 44 };
const SIZE_LABEL: Record<BrushSize, string> = { s: '小', m: '中', l: '大' };

/** the radius of a size at zoom 1 on this frame: 中 = 28.7 texels on the 3:4 measuring frame (PB §0) */
function radiusOf(frame: LiquifyFrame, size: BrushSize): number {
  return (SIZE_PX[size] / 28) * (28.7 / liquifyGrid(frame).F);
}

function timeSync(frame: LiquifyFrame, recs: Stroke[], now: () => number): { ms: number; work: number } {
  const m = new LiquifyModel(frame, { now, syncWork: Infinity });
  const t0 = now();
  m.sync(recs);
  const ms = now() - t0;
  const work = m.work;
  m.dispose();
  return { ms, work };
}

/** ns per texel-stamp of the three operators at each size */
export function benchStamps(frame: LiquifyFrame, now: () => number = () => performance.now()): LiquifyBenchRow[] {
  const g = liquifyGrid(frame);
  const rows: LiquifyBenchRow[] = [];
  for (const size of ['s', 'm', 'l'] as const) {
    const R = radiusOf(frame, size);
    const across = (k: number, kind: Stroke['kind'], y: number) =>
      straightStroke(frame, kind, R, { x: 0.15, y }, { x: 0.15 + (4 * R) / g.ax, y }, `${kind}-${size}-${k}`);
    // straight pushes on fresh ground: the guard check runs, no bisection
    const push = [0.2, 0.4, 0.6, 0.8].flatMap((y, k) => across(k, 'push', y));
    const p = timeSync(frame, push, now);
    rows.push({ name: `liquify.stamp push ${SIZE_LABEL[size]}`, value: (p.ms * 1e6) / p.work, unit: 'ns/texel-stamp', budget: 80 });
    // the same push five times from one start: the later stamps bisect (GUARD_STEPS each)
    const again = [0, 1, 2, 3, 4].flatMap((k) => straightStroke(frame, 'push', R, { x: 0.3, y: 0.5 }, { x: 0.3 + R / g.ax, y: 0.5 }, `again-${size}-${k}`));
    const b = timeSync(frame, again, now);
    rows.push({ name: `liquify.stamp push bisecting ${SIZE_LABEL[size]}`, value: (b.ms * 1e6) / b.work, unit: 'ns/texel-stamp', budget: 80 });
    // a restore pass over each push
    const restore = [...push, ...[0.2, 0.4, 0.6, 0.8].flatMap((y, k) => across(k, 'restore', y))];
    const r = timeSync(frame, restore, now);
    // the restore passes alone: the run with them minus the pushes' own run
    const restoreMs = Math.max(0, r.ms - p.ms);
    const restoreWork = Math.max(1, r.work - p.work);
    rows.push({ name: `liquify.stamp restore ${SIZE_LABEL[size]}`, value: (restoreMs * 1e6) / restoreWork, unit: 'ns/texel-stamp', budget: 80 });
  }
  return rows;
}

/** replay of S30 (budget 100 ms, synchronous) and SCAP (≈ 1 s of work), and S30's share of bisected work */
export function benchReplay(frame: LiquifyFrame, now: () => number = () => performance.now(), withCap = true): LiquifyBenchRow[] {
  const s30 = strokesS30(frame);
  const r = timeSync(frame, s30, now);
  const base = s30.reduce((s, x) => s + strokeWork(x, frame), 0);
  const rows: LiquifyBenchRow[] = [
    { name: 'liquify.replay S30', value: r.ms, unit: 'ms', budget: 100 },
    { name: 'liquify.bisected S30', value: (100 * (r.work - base)) / (GUARD_STEPS * Math.max(1, base)), unit: '%', budget: null },
  ];
  if (withCap) {
    const c = timeSync(frame, strokesCap(frame), now);
    rows.push({ name: 'liquify.replay SCAP', value: c.ms, unit: 'ms', budget: 1000 });
  }
  return rows;
}

/** ms for a full RG16F upload of `field` (median of 5, gl.finish included) */
export function uploadMs(gl: WebGL2RenderingContext, field: LiquifyField, now: () => number = () => performance.now()): number {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, field.width, field.height, 0, gl.RG, gl.FLOAT, field.data);
  gl.finish();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = now();
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, field.width, field.height, gl.RG, gl.FLOAT, field.data);
    gl.finish();
    times.push(now() - t0);
  }
  gl.deleteTexture(tex);
  times.sort((a, b) => a - b);
  return times[2];
}

/** tab-separated rows for 複製結果 */
export function formatLiquifyReport(rows: readonly LiquifyBenchRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r) => [r.name, r.value.toFixed(r.unit === 'ms' ? 1 : 2), r.unit, r.budget === null ? '–' : String(r.budget), r.budget === null || r.value <= r.budget ? 'ok' : 'OVER'].join('\t'));
  return ['', '推臉筆', ['row', 'value', 'unit', 'budget', ''].join('\t'), ...lines].join('\n');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/bench/liquifyBench.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the 推臉筆 button to the bench page**

In `src/bench/main.ts` (CRLF):

1. Imports (`main.ts` already has `import { legacyFrame } from '../edit/frame';` and `import { defaultPhoto, neutralPerson } from '../edit/state';`: add `buildFrame` and `naturalPerson` to those two lines; `Engine` is already in its type import from `'../types'`):

```ts
import { LiquifyModel } from '../edit/liquify';
import { strokesS30 } from '../edit/strokeFixtures';
import { benchReplay, benchStamps, formatLiquifyReport, uploadMs, type LiquifyBenchRow } from './liquifyBench';
```

2. Next to `const bodyRows …` (`:126` at `d09e608`): `const liquifyRows: LiquifyBenchRow[] = [];`
3. Next to `gateBodyBtn` (`:202` at `d09e608`, before `const gate`):

```ts
const gateLiquifyBtn = button('推臉筆', () => void liquifyBench());
const liquifyBtn = button('推臉筆', () => void liquifyBench());
// own class, not .note: bench.spec.ts and tests/harness/t8/run-bench*.mjs need '.gate .note' and '.panel .note' to stay unique
const liquifyOut = el('pre', { className: 'liquify-note' });
```

add `gateLiquifyBtn` to the `gate` element's children right after `gateBodyBtn` (`:214`; the gate lists its children in one `el('div', { className: 'gate' }, …)` call) and `liquifyBtn` to the panel's button row after `bodyBtn` (`:287`).
4. Below `runBodyBench` (`:650-683` at `d09e608`):

```ts
/** A 1536 × 2048 frame through the whole pipeline with the S30 strokes: the readback makes it a complete GPU frame. */
function liquifyFrameMs(eng: Engine, m: LiquifyModel): number {
  const src = el('canvas', { width: 1536, height: 2048 });
  const ctx = src.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 1536, 2048);
    grad.addColorStop(0, '#806050');
    grad.addColorStop(1, '#d0b0a0');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1536, 2048);
  }
  const edit = { v: 2 as const, photo: { ...defaultPhoto(), strokes: m.records }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
  // no faces, no obstacles, no protects: the strokes-only frame (step 1's buildFrame with its empty inputs; p0 is the primary)
  const input = { ...buildFrame(edit, [], [], new Map(), 'p0'), source: src, width: 1536, height: 2048, liquify: m.field };
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    eng.renderToImageData(input, { mirror: false });
    if (i > 0) times.push(performance.now() - t0); // the first one compiles and uploads
  }
  times.sort((a, b) => a - b);
  return times[2];
}

async function liquifyBench(): Promise<void> {
  if (busy) return;
  busy = true;
  gateLiquifyBtn.disabled = liquifyBtn.disabled = true;
  (gate.hidden ? panel : gate).append(liquifyOut);
  try {
    liquifyRows.length = 0;
    const frame = { width: 1536, height: 2048 };
    liquifyOut.textContent = '推臉筆：量測筆刷…';
    await nextPaint();
    liquifyRows.push(...benchStamps(frame));
    liquifyOut.textContent = '推臉筆：量測重播…';
    await nextPaint();
    liquifyRows.push(...benchReplay(frame));
    const m = new LiquifyModel(frame, { syncWork: Infinity });
    m.sync(strokesS30(frame));
    const gl = el('canvas').getContext('webgl2');
    if (gl && m.field) liquifyRows.push({ name: 'liquify.upload', value: uploadMs(gl, m.field), unit: 'ms', budget: 2 });
    // the frame row needs the engine: run 開始 first
    if (engine) liquifyRows.push({ name: 'liquify.frame', value: liquifyFrameMs(engine, m), unit: 'ms', budget: 33 });
    m.dispose();
    liquifyOut.textContent = formatLiquifyReport(liquifyRows).trim();
  } catch (err) {
    showError('liquify', err);
    liquifyOut.textContent = `失敗：${errText(err)}`;
  } finally {
    busy = false;
    gateLiquifyBtn.disabled = liquifyBtn.disabled = false;
  }
}
```

(`buildFrame`'s fourth parameter is a `ReadonlyMap<string, FaceProtect>`, so `new Map()` fits; its fifth, `primary`, is required.)
5. In `copyResults` (`:911-930` at `d09e608`), whose text steps 1–5 grew to `formatReport(reportMeta(), samples, bodyRows) + multiText + exportText + (toneReport ? … : '') + (faceDetailRows.length ? … : '')`, append the rows at the end: `… + formatLiquifyReport(liquifyRows)`.

- [ ] **Step 6: Run the checks**

Run: `npm run typecheck && npx vitest run src/bench && npm run build && npx playwright test tests/e2e/bench.spec.ts`
Expected: no errors; PASS (the bench page still starts; the new button is not exercised by the e2e).

- [ ] **Step 7: Commit**

```bash
git add src/bench/liquifyBench.ts src/bench/liquifyBench.test.ts src/bench/main.ts
git commit -m "feat(bench): 推臉筆 rows (stamp, replay, upload, frame)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Release 0.4.0

C §1.3 items 1 and 2, and the release gate of C §8.4: one export-harness case with every v0.4 feature on at once must give a forced `TILE = 256` export equal to the untiled export within 1/255. Then the version becomes 0.4.0 (single source `package.json`, read by `src/version.ts:6` and `vite.config.ts:37-44`, so `displayVersion('0.4.0')` = `v0.4` and the banner reads 「有新版本 v0.4」 with no code change, `src/ui/updateModel.ts:60-62`). The update e2e derives both of its versions from `package.json` (`tests/e2e/update.spec.ts:25-26`: A = the package version, B = its patch + 1), so nothing there hard-codes 0.3. Steps 4 and 5 of C §1.3 (`/code-review`, the clean-clone gate) run in Task 17; item 5 (push, deploy) is **not** part of this plan.

**Files:**
- Modify: `tests/e2e/pages/export.ts`, `tests/e2e/export.spec.ts` (LF; the release-gate case in step 3's tile harness; at `d09e608` the loop's `faces` line is `:98`, `photo` `:103-108`, `base` `:112`, `bounds` `:114`, before Task 13's lines)
- Modify: `package.json`, `package-lock.json` (LF)
- Modify: `src/ui/updateModel.test.ts` (LF; `describe('banner text', …)` `:97-103`, `describe('已更新至 notice …', …)` `:119-` at `d09e608`)
- Modify: `docs/superpowers/specs/2026-10-12-v04-roadmap.md` (LF; append §13 Release notes after §12, the last section)
- Modify: `docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md` (CRLF; §3 Scope `:42-48`, §7.3 BeautyPanel `:134-146`; no `v04-roadmap` pointer at `d09e608`)

**Interfaces:**
- Consumes: step 3's harness `window.runExportTiles()` and its `cases` loop (step-3 plan Task 9: the loop's locals `decode`, `bitmap`, `pts` (the fixture landmarks placed in the frame), `face`, `faces`, the shared `person`, `photo`, `base`, `bounds`), as extended by Task 13 (`strokes?: boolean`, `buildStrokeCase`); `rotateLeft`, `setStraighten`, `IDENTITY_GEOMETRY` (`src/geometry/view.ts`); `neutralPerson`, `defaultPhoto` (`src/edit/state.ts`); `adapt` (`src/tracking/adapter111.ts`); `RenderFace`, `PersonParams`, `PhotoParamId`, `Spot`, `Rect` (`src/types.ts`); step 2's `adjust.*` ids; step 4's `tone.*` ids, `PhotoParams.spots`, `RenderInput.toneSource` and `spotBounds(frame: Pick<StillFrame, 'faces' | 'photo'>, oSize): Pick<TileBounds, 'spotWindowGrowth' | 'oSpacePasses'>` (`src/media/exportPlan.ts:306-312` at `d09e608`; what `StillSession.bounds` spreads), which feeds step 3's `TileBounds.spotWindowGrowth` hook with the O-normalized `spotWindowGrowth(winO, spots, oSize)` and sets `oSpacePasses` while a step-4 pass runs; step 5's ids `shape.jawline`, `shape.noseWing`, `makeup.contour`, `makeup.lashes` (C §3.1). Step 4 checks its own tiles in a separate harness (`tests/e2e/pages/tone.ts`, `runToneTiles`), so this case sets the step-4 inputs itself.
- Produces: the harness case `'everything'`; version 0.4.0; release notes.

- [ ] **Step 1: Write the failing release-gate expectation**

In `tests/e2e/export.spec.ts`, append `'everything'` at the end of the `expect(res.map((r) => r.name)).toEqual([...])` list (after `'strokes + 90° turn'`). The loop's assertions (no GL error, more than one tile, max channel difference ≤ 1, i.e. 1/255) apply to it like to every case.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/export.spec.ts`
Expected: FAIL — the list of case names lacks `'everything'`.

- [ ] **Step 3: Add the `everything` case to the harness**

In `tests/e2e/pages/export.ts`:
1. Imports: `adapt` from `'../../../src/tracking/adapter111'` (already imported by step 3), `spotBounds` added to the existing import from `'../../../src/media/exportPlan'` (`faceBoundsFor`, `planTiles`, `TileGrid`), and `PhotoParamId`, `Spot` added to the type import from `'../../../src/types'` (`Rect` is there since Task 13). The case type gains `twoFaces?: boolean`, `skinTools?: boolean` and `adjust?: Partial<Record<PhotoParamId, number>>`.
2. Append the case (C §8.4, last paragraph: every v0.4 feature at once):

```ts
    {
      name: 'everything',
      w: 800,
      h: 600,
      // a crop at θ = 12° after a 旋轉 (setStraighten keeps the max-fit crop)
      geometry: (size) => setStraighten(rotateLeft(IDENTITY_GEOMETRY), 12, size),
      strokes: true,
      twoFaces: true,
      skinTools: true,
      adjust: { 'adjust.contrast': 0.7, 'adjust.temperature': 0.35 },
    },
```

so the case holds two faces with different 美型 and makeup (v0.3 and step-5 items), a body field, 調節 and a look, the crop after a 旋轉, spots with 勻膚 and 黑眼圈, and strokes.
3. Module level, next to `bodyField()`:

```ts
/** step 4 in the release gate: two 祛痘 spots on face A's cheeks (O, r and donor offset in short edges) */
const GATE_SPOTS: Spot[] = [
  { x: 0.4, y: 0.6, r: 0.012, dx: 0.03, dy: 0, owner: null },
  { x: 0.6, y: 0.62, r: 0.012, dx: -0.03, dy: 0, owner: null },
];
```

4. In the per-case loop, where `faces` is built (at `d09e608`: `const faces: RenderFace[] = [{ face, weight: 1, person: c.faceDetail ? step5Person() : person, protect: null }];`, step 5's cases using `step5Person()`), give face A the step-4 and step-5 items in this case and add the second face with its own person, adapted from its own landmarks (so every `Face` field, step 5's `iris` and `lids` included, is consistent):

```ts
    const personBase: PersonParams = c.faceDetail ? step5Person() : person;
    const personA: PersonParams = c.skinTools
      ? { ...personBase, values: { ...personBase.values, 'tone.even': 0.5, 'tone.darkCircle': 1, 'shape.jawline': 0.6, 'makeup.contour': 0.6 } }
      : personBase;
    const faces: RenderFace[] = [{ face, weight: 1, person: personA, protect: null }];
    if (c.twoFaces) {
      // the fixture face again at 0.45 scale towards the top left, with its own 美型 and makeup
      const ptsB = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) {
        ptsB[i] = 0.08 + pts[i] * 0.45;
        ptsB[i + 1] = 0.05 + pts[i + 1] * 0.45;
        ptsB[i + 2] = pts[i + 2] * 0.45;
      }
      const personB: PersonParams = {
        ...neutralPerson(),
        values: { ...neutralPerson().values, 'shape.faceV': 0.8, 'shape.noseSlim': 0.6, 'shape.noseWing': 0.7, 'makeup.blush': 0.6, 'makeup.lashes': 0.7 },
      };
      faces.push({ face: adapt({ points: ptsB }, c.w, c.h), weight: 1, person: personB, protect: null });
    }
```

(this replaces step 3's `faces` line). Where `photo` is built, spread `...c.adjust` into `photo.values` after the case's `'adjust.grain'` / `'adjust.vignette'` (the base case already sets those, the 膠片 look and the body field) and add `spots: c.skinTools ? GATE_SPOTS : []` next to Task 13's `strokes`. In `base`, add `...(c.skinTools ? { toneSource: { source: bitmap, width: c.w, height: c.h } } : {})` (every tile rebuilds the tone field from the whole working image, as step 4's runner does). In `bounds`, next to Task 13's liquify term, add what `StillSession.bounds` adds for step 4 (`still.ts`: `...spotBounds(f, { width, height })`), from this case's own faces and photo:

```ts
      // step 4: the window holds every spot (and donor) whose quad meets it, and B is budgeted at window size while a
      // 膚質 pass runs (spotBounds: TileBounds.spotWindowGrowth, O-normalized, and oSpacePasses)
      ...(c.skinTools ? spotBounds({ faces, photo }, decode) : {}),
```

(step 4's own coverage test in `src/media/exportPlan.test.ts` builds its bounds the same way.)

The comparison is the harness's own (one tile covering V vs the forced TILE = 256 plan); nothing about it changes.

- [ ] **Step 4: Run it**

Run: `npx playwright test tests/e2e/export.spec.ts`
Expected: PASS; the log line `everything: …, max channel diff 0/255` (at most 1/255).

- [ ] **Step 5: Bump the version**

Run: `npm version 0.4.0 --no-git-tag-version`
Expected: prints `v0.4.0`; `git diff --stat` lists only `package.json` and `package-lock.json`, and `git diff package-lock.json` changes exactly the two `"version": "0.3.0"` lines of the root package (lines 3 and 9) to `"0.4.0"`.

Append to `src/ui/updateModel.test.ts`, inside `describe('banner text', …)` (`:97-103` at `d09e608`) and `describe('已更新至 notice (first launch of a new version)', …)` (`:119-` at `d09e608`) respectively (`bannerTitle`, `updatedNotice` and the `available(…)` helper are already there):

```ts
  it('names 0.4.0 as v0.4 (C §1.3)', () => {
    expect(bannerTitle(available({ next: '0.4.0' }))).toBe('有新版本 v0.4');
  });
```

```ts
  it('after the 0.4.0 update', () => {
    expect(updatedNotice('0.3.0', '0.4.0', true)).toBe('已更新至 v0.4');
  });
```

Check that no test pins the old version:

Run: `grep -rnE "['\"\`]v?0\.3(\.0)?['\"\`]" tests src --include=*.ts --include=*.tsx --include=*.mjs | grep -v "updateModel.test.ts\|version.test.ts"`
Expected: no output (`version.test.ts` and `updateModel.test.ts` use 0.3 only as example inputs). The pattern matches only quoted version strings; comments that mention "v0.3" behaviour, the `parity-v03` goldens and `reshapeCpuV03.ts` are not version pins. A hit is a defect only if it is compared with the running app's version (`APP_VERSION`, `package.json`, `/version.json`).

- [ ] **Step 6: Release notes and the DS pointers**

Append to `docs/superpowers/specs/2026-10-12-v04-roadmap.md`:

```markdown
---

## 13. Release notes: 0.4.0 (2026-10-12)

**繁體中文**
- 選臉／選人：合照可以一位一位調整磨皮、紅潤、美型、美妝與局部美體；相機可點選要美顏的臉，或「全部套用」。
- 調節與一鍵質感：亮度、曝光、對比、高光、陰影、色溫、色調、飽和、鮮艷度、褪色、顆粒、暗角；質感 膠片、CCD、直閃、藍調、電影感。
- 裁切／旋轉／翻轉／拉直，以原始解析度（最長邊 4096）輸出 JPEG 或 PNG。
- 膚質：祛痘、勻膚、膚色、黑眼圈、法令紋、白牙、亮眼。
- 臉型細項（鼻翼、山根、嘴高、太陽穴、髮際線、下頜線、左右分開）與美妝擴充（眉毛、眼影、眼線、睫毛、臥蠶、修容、高光、美瞳）。
- 推臉筆＋恢復筆：在美型或美體用單指推動臉或身體，雙指縮放；筆畫隨照片保存，可以復原。

**English**
- Per-person editing of group photos; tap-to-select and 全部套用 in the camera.
- 調節 (12 adjustments) and five one-tap looks, live in the camera.
- Crop, rotate, flip and straighten; full-resolution (long edge ≤ 4096) JPEG or PNG export.
- Skin tools: blemish removal, even tone, skin tone, dark circles, nasolabial folds, teeth whitening, eye brightening.
- Face-detail warps with left/right split, and eight more procedural makeup parts.
- 推臉筆 / 恢復筆 manual liquify on face and body, saved with the photo and undoable.

**Compatibility**
- 「最近編輯」 entries from 0.3 open unchanged (read as v1 and migrated lazily, C §5.2).
- A rollback to 0.3 opens 0.4 entries with the primary person's look and without 推臉筆 strokes, crop or the other v0.4-only edits: the legacy `params` projection cannot hold them (C §5.1, push-brush spec §5.1).
```

In `docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md` (CRLF), unless a v0.4 pointer is already there (`grep -n "v04-roadmap" docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md`):
- in §3 Scope, after the 「Added 2026-10-07 — 美體 P1」 paragraph (`:46`): `**Added 2026-10-12 — v0.4:** six features (選臉／選人, 調節＋一鍵質感, 裁切＋原解析度／PNG, 膚質, 臉型細項＋美妝擴充, 推臉筆＋恢復筆); the contract is [2026-10-12-v04-roadmap.md](2026-10-12-v04-roadmap.md) and its six sub-specs. Items of the "Out of v1" list below that v0.4 now ships (multi-face, 亮眼, 祛法令紋, 祛黑眼圈, 白牙, eye-shadow/brow/liner makeup) are in scope from 0.4.0.`
- in §7.3 BeautyPanel, below the tab line (`:136`): `**v0.4:** eight tabs 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節 · 裁切 (seven in the camera, no 裁切); the strips are in [2026-10-12-v04-roadmap.md §2.1](2026-10-12-v04-roadmap.md).`

Verify that every derived image fixture v0.4 committed is in `LICENSES/NOTICE.txt` (C §1.3 item 2, §8.3). This step adds no image: `tests/fixtures/strokes_s30.json` and `strokes_cap.json` are our own data and need no line (PB §8.4), so the check looks at images only, by file name or by their directory (the parity goldens are listed as `tests/fixtures/parity-v03/`):

Run: `for f in $(git diff --name-only --diff-filter=A 892ea61 -- 'tests/fixtures/*.png' 'tests/fixtures/*.jpg'); do grep -qF "$(basename "$f")" LICENSES/NOTICE.txt || grep -qF "$(dirname "$f")/" LICENSES/NOTICE.txt || echo "missing in NOTICE: $f"; done`
Expected: no output. (A `missing` line names a fixture an earlier step forgot: add its NOTICE line in the style of the `fullbody_lines.jpg` entry, `NOTICE.txt:58` at `d09e608` — "modified derivative of … (Apache-2.0 §4(b) change notice): …".)

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/ui/updateModel.test.ts src/version.test.ts && npm run build && npx playwright test tests/e2e/update.spec.ts tests/e2e/settings.spec.ts`
Expected: PASS; the update e2e builds A = 0.4.0 and B = 0.4.1 and its banner reads 「有新版本 v0.4.1」.

- [ ] **Step 8: Commit (local only, no tag, no push)**

```bash
git add package.json package-lock.json src/ui/updateModel.test.ts tests/e2e/pages/export.ts tests/e2e/export.spec.ts docs/superpowers/specs/2026-10-12-v04-roadmap.md docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md
git add -u LICENSES
git commit -m "release: Mona Misa 美顏 0.4.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Step gate (step 6 and the whole v0.4)

The gate of C §1.2 for step 6, which is also the gate of the release: everything green, the v0.3-equivalence checks of C §1.1 / §8.4, and the clean-clone build of C §1.3 item 4 (project rule: fresh clone through the long path, `npm ci`, build, then the tests). Nothing is pushed, merged or deployed: C §1.3 item 5 waits for the user.

**Files:** none (verification only; a failure is fixed in the task that owns the code, with its own commit).

**Interfaces:**
- Consumes: everything above; step 1's `tests/e2e/parity.spec.ts` and goldens `tests/fixtures/parity-v03/*.png` (C §8.3).
- Produces: a green, committed `feat/meiyan-pwa` at version 0.4.0.

- [ ] **Step 1: Static checks and unit tests**

Run: `npm run typecheck`
Expected: exit 0, no output.

Run: `npm test`
Expected: every test file passes (the run includes `src/edit/liquify.test.ts`, about 16 s, which also checks that `tests/fixtures/strokes_*.json` still equal the generators).

Run: `npm run build`
Expected: exit 0; `dist/version.json` contains `{"version":"0.4.0"}`:

Run: `cat dist/version.json`
Expected: `{"version":"0.4.0"}`

- [ ] **Step 2: The whole e2e suite**

Run: `npm run test:e2e` (in the background: the suite takes longer than one 10-minute tool call)
Expected: every project and spec passes, among them `liquify.spec.ts` (13), `reshape.spec.ts` (with the liquify pin), `export.spec.ts` (strokes case and release gate), `parity.spec.ts`, `camera.spec.ts`, `camera-group.spec.ts`, `update.spec.ts`.

- [ ] **Step 3: v0.3 equivalence (C §1.1, §8.4)**

1. Parity goldens with no strokes:

Run: `npx playwright test tests/e2e/parity.spec.ts`
Expected: PASS — every golden within max channel diff 1/255 and mean < 0.02/255.

2. No strokes means the old map exactly: the Task 4 test `a null liquify field is the identity of the old map` and the GPU pin:

Run: `npx vitest run src/engine/passes/reshapeCpu.test.ts && npx playwright test tests/e2e/reshape.spec.ts`
Expected: PASS.

3. Existing tests kept their assertions: the only intended assertion changes in this step are the `RESHAPE_FS` hash pin and the moved `emptyPng` helper.

Run: `STEP6_BASE=$(cat "$(git rev-parse --git-dir)/STEP6_BASE") && git diff --stat "$STEP6_BASE" -- '*.test.ts' '*.test.tsx' 'tests/e2e/*.spec.ts'` (the commit recorded before Task 1, see Global Constraints) and read every changed hunk of a file that existed before this step.
Expected: additions only, except `reshapeCpu.test.ts` (the pinned hash), `body.spec.ts` (`emptyPng` now imported from `fixtures.ts`, its local copy and the `PNG` import removed), Task 11's 推臉筆 changes (four `panelModel.test.ts` strip assertions now end with `BRUSH_KEY`; `editor.spec.ts`'s no-face loop expects 推臉筆 enabled, see Task 11's **Files**), and import declarations that gained names (for example `state.test.ts`, `migrate.test.ts`, `history.test.ts`, `panelModel.test.ts`, `backMapCpu.test.ts`, `backMapFrame.test.ts`, `exportPlan.test.ts`). (The `liquifyOn: false` line in `pipeline.test.ts`'s `base` fixture and the appended `export.spec.ts` case names are additions.)

4. The camera never gets the brush (`live: false`, C §2.4):

Run: `grep -n "推臉筆\|BrushBar\|liquify" src/ui/screens/Camera.tsx src/app/live.ts src/app/liveCore.ts`
Expected: no output.

- [ ] **Step 4: Clean-clone gate (C §1.3 item 4; local only)**

Stop every dev / preview server of the working copy first (Playwright would otherwise reuse them and test the wrong build); `CI=1` makes Playwright start its own servers and fail loudly if a port is taken.

```bash
GATE=/c/Users/jeff_chen/AppData/Local/Temp/meiyan-gate-step6
rm -rf "$GATE"
git clone --branch feat/meiyan-pwa D:/GitSource/MonaLisa "$GATE"
cd "$GATE" && npm ci && npm run build && npm test && CI=1 npm run test:e2e
```

Expected: `npm ci` installs from the lockfile without changing it, then build, unit tests and the whole e2e suite pass in the fresh clone (run the command in the background and wait for it; it takes well over 10 minutes). The clone lives on the **long** path (`C:/Users/jeff_chen/...`), never under `JEFF_C~1` (project memory: the short 8.3 path breaks the build). Remove it afterwards with `rm -rf /c/Users/jeff_chen/AppData/Local/Temp/meiyan-gate-step6` (a new shell call does not know `$GATE`).

- [ ] **Step 5: Review and hand-off (no push)**

Review the whole v0.4 diff (`git diff 892ea61..HEAD`, C §1.3 item 3) with the `advance-codex-review` skill, which is what the user asked for once every feature is written (C §12 「決定」: 「全部功能寫完後，跑advance codex review」); it runs the review rounds and fixes, and so covers C §1.3's `/code-review`. Fix real findings in the owning task's files, each fix committed locally with the attribution line; if any fix landed, re-run Steps 1–4 (the clean clone included) on the final commit. Then stop: report the gate results and the commit range to the user, and ask before any `git push`, merge to `main` or deploy (C §1.3 item 5; after a deploy the user's checklist polls the Vercel status and `https://mona-lisa-jeff-s-projects7.vercel.app/version.json` for `0.4.0`).

Run: `git status --short && git log --oneline -20`
Expected: a clean tree; the step-6 commits and `release: Mona Misa 美顏 0.4.0` on top of steps 1–5; nothing pushed (`git status` shows the branch ahead of its upstream, if it has one).
